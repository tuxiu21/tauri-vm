use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use russh::client;
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use russh::{ChannelMsg, Disconnect};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tokio::net::ToSocketAddrs;

struct Client;

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

struct SshSession {
    session: client::Handle<Client>,
}

impl SshSession {
    async fn connect<A: ToSocketAddrs>(
        key_path: &Path,
        user: &str,
        addr: A,
    ) -> Result<Self, String> {
        let key_pair = load_secret_key(key_path, None).map_err(|err| format!("{err:?}"))?;
        let mut config = client::Config::default();
        config.inactivity_timeout = Some(Duration::from_secs(10));
        let config = Arc::new(config);
        let mut session = client::connect(config, addr, Client {})
            .await
            .map_err(|err| format!("{err:?}"))?;

        let auth_res = session
            .authenticate_publickey(
                user,
                PrivateKeyWithHashAlg::new(
                    Arc::new(key_pair),
                    session
                        .best_supported_rsa_hash()
                        .await
                        .map_err(|err| format!("{err:?}"))?
                        .flatten(),
                ),
            )
            .await
            .map_err(|err| format!("{err:?}"))?;

        if !auth_res.success() {
            return Err("SSH authentication failed".to_string());
        }

        Ok(Self { session })
    }

    async fn exec_collect(&mut self, command: &str) -> Result<String, String> {
        let mut channel = self
            .session
            .channel_open_session()
            .await
            .map_err(|err| format!("{err:?}"))?;
        channel
            .exec(true, command)
            .await
            .map_err(|err| format!("{err:?}"))?;

        let mut output = Vec::new();
        let mut exit_status = None;

        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { data } => output.extend_from_slice(data.as_ref()),
                ChannelMsg::ExtendedData { data, .. } => output.extend_from_slice(data.as_ref()),
                ChannelMsg::ExitStatus { exit_status: status } => exit_status = Some(status),
                _ => {}
            }
        }

        let output_text = String::from_utf8_lossy(&output).to_string();
        if let Some(status) = exit_status {
            if status != 0 && output_text.trim().is_empty() {
                return Err(format!("Remote command exited with status {status}"));
            }
        }

        Ok(output_text)
    }

    async fn close(&mut self) -> Result<(), String> {
        self.session
            .disconnect(Disconnect::ByApplication, "", "English")
            .await
            .map_err(|err| format!("{err:?}"))
    }
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn ssh_dir(app: AppHandle) -> Result<String, String> {
    let key_path = app
        .path()
        .resolve("resources/mypc", BaseDirectory::Resource)
        .map_err(|err| format!("{err:?}"))?;
    let mut session = SshSession::connect(&key_path, "rin", ("192.168.5.100", 22)).await?;
    let output = session.exec_collect("dir").await?;
    let _ = session.close().await;
    Ok(output)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, ssh_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
