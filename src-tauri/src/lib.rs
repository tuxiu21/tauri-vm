use std::sync::Arc;
use std::time::Duration;

use russh::client;
use russh::keys::{decode_secret_key, PrivateKey, PrivateKeyWithHashAlg};
use russh::{ChannelMsg, Disconnect};
use serde::Deserialize;
use serde::Serialize;
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
        private_key: PrivateKey,
        user: &str,
        addr: A,
    ) -> Result<Self, String> {
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
                    Arc::new(private_key),
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
                ChannelMsg::ExitStatus {
                    exit_status: status,
                } => exit_status = Some(status),
                _ => {}
            }
        }

        let output_text = String::from_utf8_lossy(&output).to_string();
        if let Some(status) = exit_status {
            if status != 0 {
                let trimmed = output_text.trim();
                if trimmed.is_empty() {
                    return Err(format!("Remote command exited with status {status}"));
                }
                return Err(trimmed.to_string());
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

fn load_ssh_private_key(app: &AppHandle) -> Result<PrivateKey, String> {
    let resource_path = app
        .path()
        .resolve("resources/mypc", BaseDirectory::Resource)
        .map_err(|err| format!("{err:?}"))?;

    let key_text = std::fs::read_to_string(&resource_path).unwrap_or_else(|_| {
        include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/mypc")).to_string()
    });

    decode_secret_key(&key_text, None).map_err(|err| format!("{err:?}"))
}

#[derive(Debug, Clone, Deserialize)]
struct SshConfig {
    host: String,
    #[serde(default = "default_ssh_port")]
    port: u16,
    user: String,
}

fn default_ssh_port() -> u16 {
    22
}

async fn ssh_connect(app: &AppHandle, cfg: &SshConfig) -> Result<SshSession, String> {
    let private_key = load_ssh_private_key(app)?;
    SshSession::connect(private_key, &cfg.user, (cfg.host.as_str(), cfg.port)).await
}

#[tauri::command]
async fn ssh_dir(app: AppHandle) -> Result<String, String> {
    let private_key = load_ssh_private_key(&app)?;
    let mut session = SshSession::connect(private_key, "rin", ("192.168.5.100", 22)).await?;
    let output = session.exec_collect("dir").await?;
    let _ = session.close().await;
    Ok(output)
}

#[tauri::command]
async fn ssh_exec(app: AppHandle, ssh: SshConfig, command: String) -> Result<String, String> {
    if command.len() > 8192 {
        return Err("Command too long".to_string());
    }

    let mut session = ssh_connect(&app, &ssh).await?;
    let output = session.exec_collect(&command).await?;
    let _ = session.close().await;
    Ok(output)
}

fn ps_single_quote_escape(text: &str) -> String {
    text.replace('\'', "''")
}

fn vmrun_locator_ps() -> &'static str {
    r#"$paths=@('C:\Program Files (x86)\VMware\VMware Workstation\vmrun.exe','C:\Program Files\VMware\VMware Workstation\vmrun.exe');$vmrun=$paths|Where-Object{Test-Path -LiteralPath $_}|Select-Object -First 1;if(-not $vmrun){throw 'vmrun.exe not found (check VMware Workstation install path)'}"#
}

fn parse_vmrun_list_output(output: &str) -> Vec<String> {
    output
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .filter(|line| !line.to_ascii_lowercase().starts_with("total "))
        .map(|line| line.trim_matches('"').to_string())
        .collect()
}

#[derive(Debug, Clone, Serialize)]
struct VmItem {
    vmx_path: String,
    is_running: bool,
}

#[tauri::command]
async fn vmware_list_running(app: AppHandle, ssh: SshConfig) -> Result<Vec<String>, String> {
    let mut session = ssh_connect(&app, &ssh).await?;
    let ps = format!(
        r#"& {{ {} ; $out = & $vmrun -T ws list 2>&1; if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}; $out }}"#,
        vmrun_locator_ps()
    );
    let command = format!(
        r#"powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "{}""#,
        ps.replace('"', r#"""""#)
    );
    let output = session.exec_collect(&command).await?;
    let _ = session.close().await;
    Ok(parse_vmrun_list_output(&output))
}

#[tauri::command]
async fn vmware_status_for_known(
    app: AppHandle,
    ssh: SshConfig,
    known_vmx_paths: Vec<String>,
) -> Result<Vec<VmItem>, String> {
    let running = vmware_list_running(app, ssh).await?;
    Ok(known_vmx_paths
        .into_iter()
        .map(|vmx_path| VmItem {
            is_running: running.iter().any(|p| p.eq_ignore_ascii_case(&vmx_path)),
            vmx_path,
        })
        .collect())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
enum VmStopMode {
    Soft,
    Hard,
}

impl VmStopMode {
    fn as_str(&self) -> &'static str {
        match self {
            VmStopMode::Soft => "soft",
            VmStopMode::Hard => "hard",
        }
    }
}

#[tauri::command]
async fn vmware_start_vm(
    app: AppHandle,
    ssh: SshConfig,
    vmx_path: String,
) -> Result<String, String> {
    let mut session = ssh_connect(&app, &ssh).await?;
    let vmx_quoted = ps_single_quote_escape(&vmx_path);
    let ps = format!(
        r#"& {{ {} ; $out = & $vmrun -T ws start '{}' nogui 2>&1; if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}; $out }}"#,
        vmrun_locator_ps(),
        vmx_quoted
    );
    let command = format!(
        r#"powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "{}""#,
        ps.replace('"', r#"""""#)
    );
    let output = session.exec_collect(&command).await?;
    let _ = session.close().await;
    Ok(output)
}

#[tauri::command]
async fn vmware_stop_vm(
    app: AppHandle,
    ssh: SshConfig,
    vmx_path: String,
    mode: Option<VmStopMode>,
) -> Result<String, String> {
    let mut session = ssh_connect(&app, &ssh).await?;
    let vmx_quoted = ps_single_quote_escape(&vmx_path);
    let mode = mode.unwrap_or(VmStopMode::Soft);
    let ps = format!(
        r#"& {{ {} ; $out = & $vmrun -T ws stop '{}' {} 2>&1; if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}; $out }}"#,
        vmrun_locator_ps(),
        vmx_quoted,
        mode.as_str()
    );
    let command = format!(
        r#"powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "{}""#,
        ps.replace('"', r#"""""#)
    );
    let output = session.exec_collect(&command).await?;
    let _ = session.close().await;
    Ok(output)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            ssh_dir,
            ssh_exec,
            vmware_list_running,
            vmware_status_for_known,
            vmware_start_vm,
            vmware_stop_vm
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
