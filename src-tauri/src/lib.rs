use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use russh::client;
use russh::keys::{decode_secret_key, PrivateKey, PrivateKeyWithHashAlg};
use russh::{ChannelMsg, Disconnect};
use base64::Engine as _;
use serde::Deserialize;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::net::ToSocketAddrs;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn truncate_text(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        return text.to_string();
    }
    let head = &text[..max_len.saturating_sub(1)];
    format!("{head}…")
}

fn format_exit_status(status: u32) -> String {
    if status > i32::MAX as u32 {
        format!("{status} ({})", status as i32)
    } else {
        status.to_string()
    }
}

fn remote_exit_error(status: u32) -> String {
    format!("Remote command exited with status {}", format_exit_status(status))
}

fn powershell_encoded(script: &str) -> String {
    let trimmed = script.trim();
    let mut utf16le = Vec::with_capacity(trimmed.len().saturating_mul(2));
    for unit in trimmed.encode_utf16() {
        utf16le.extend_from_slice(&unit.to_le_bytes());
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(utf16le);
    format!(
        "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand {encoded}"
    )
}

fn powershell_prelude() -> &'static str {
    r#"$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()"#
}

const VM_PASSWORD_REQUIRED: &str = "VM_PASSWORD_REQUIRED";
const VM_PASSWORD_INVALID: &str = "VM_PASSWORD_INVALID";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TraceEntry {
    id: u64,
    at: u64,
    action: String,
    ok: bool,
    duration_ms: u64,
    command: String,
    output: String,
    error: Option<String>,
    request_id: Option<String>,
}

#[derive(Default)]
struct TraceStore {
    next_id: AtomicU64,
    entries: Mutex<VecDeque<TraceEntry>>,
}

impl TraceStore {
    fn push(&self, mut entry: TraceEntry) {
        entry.id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let mut guard = self.entries.lock().expect("trace store poisoned");
        guard.push_front(entry);
        while guard.len() > 200 {
            guard.pop_back();
        }
    }

    fn list(&self) -> Vec<TraceEntry> {
        let guard = self.entries.lock().expect("trace store poisoned");
        guard.iter().cloned().collect()
    }

    fn clear(&self) {
        let mut guard = self.entries.lock().expect("trace store poisoned");
        guard.clear();
    }
}

#[tauri::command]
fn trace_list(store: tauri::State<'_, TraceStore>) -> Vec<TraceEntry> {
    store.list()
}

#[tauri::command]
fn trace_clear(store: tauri::State<'_, TraceStore>) {
    store.clear();
}

fn decode_remote_output(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);

    if bytes.len() >= 2 {
        if bytes.starts_with(&[0xFF, 0xFE]) && (bytes.len() % 2 == 0) {
            let u16s: Vec<u16> = bytes[2..]
                .chunks_exact(2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect();
            return String::from_utf16_lossy(&u16s);
        }
        if bytes.starts_with(&[0xFE, 0xFF]) && (bytes.len() % 2 == 0) {
            let u16s: Vec<u16> = bytes[2..]
                .chunks_exact(2)
                .map(|b| u16::from_be_bytes([b[0], b[1]]))
                .collect();
            return String::from_utf16_lossy(&u16s);
        }
    }

    let (gbk_text, _, gbk_had_errors) = encoding_rs::GBK.decode(bytes);

    if let Ok(utf8_text) = std::str::from_utf8(bytes) {
        fn score_cjk(s: &str) -> usize {
            s.chars()
                .filter(|ch| {
                    matches!(
                        *ch as u32,
                        0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0xF900..=0xFAFF
                    )
                })
                .count()
        }

        fn score_mojibake(s: &str) -> usize {
            s.chars()
                .filter(|ch| matches!(*ch as u32, 0x00C0..=0x00FF) || *ch == '�')
                .count()
        }

        let utf8 = utf8_text;
        let gbk = gbk_text.as_ref();

        let utf8_cjk = score_cjk(utf8);
        let gbk_cjk = score_cjk(gbk);
        let utf8_moji = score_mojibake(utf8);
        let gbk_moji = score_mojibake(gbk);

        if !gbk_had_errors
            && (gbk_cjk > utf8_cjk.saturating_add(2) || utf8_moji > gbk_moji.saturating_add(4))
        {
            return gbk.to_string();
        }

        return utf8.to_string();
    }

    gbk_text.into_owned()
}

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

struct ExecCollected {
    output: String,
    exit_status: Option<u32>,
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

    async fn exec_collect_full(&mut self, command: &str) -> Result<ExecCollected, String> {
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

        let output_text = decode_remote_output(&output);
        Ok(ExecCollected {
            output: output_text,
            exit_status,
        })
    }

    async fn exec_collect(&mut self, command: &str) -> Result<String, String> {
        let res = self.exec_collect_full(command).await?;
        if let Some(status) = res.exit_status {
            if status != 0 {
                let trimmed = res.output.trim();
                if trimmed.is_empty() {
                    return Err(remote_exit_error(status));
                }
                return Err(trimmed.to_string());
            }
        }

        Ok(res.output)
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
fn e2e_exit(code: i32) {
    if code == 0 {
        println!("[e2e] PASS");
    } else {
        println!("[e2e] FAIL");
    }
    std::process::exit(code);
}

#[tauri::command]
fn e2e_write_report(report_json: String) -> Result<String, String> {
    fn find_repo_root(mut dir: std::path::PathBuf) -> Option<std::path::PathBuf> {
        loop {
            if dir.join("package.json").is_file() {
                return Some(dir);
            }
            if !dir.pop() {
                return None;
            }
        }
    }

    let cwd = std::env::current_dir().map_err(|err| format!("{err:?}"))?;
    let root = find_repo_root(cwd)
        .ok_or_else(|| "Could not locate repo root (package.json) from current_dir".to_string())?;
    let tmp_dir = root.join("tmp");
    std::fs::create_dir_all(&tmp_dir).map_err(|err| format!("{err:?}"))?;
    let path = tmp_dir.join("e2e-report.json");
    std::fs::write(&path, report_json).map_err(|err| format!("{err:?}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn e2e_log(message: String) {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return;
    }
    let max_len = 8 * 1024;
    let safe = if trimmed.len() > max_len {
        let head = &trimmed[..max_len.saturating_sub(1)];
        format!("{head}…")
    } else {
        trimmed.to_string()
    };
    println!("[e2e] {safe}");
}

fn load_ssh_private_key(app: &AppHandle) -> Result<PrivateKey, String> {
    let key_path = ssh_private_key_path(app)?;
    let key_text = std::fs::read_to_string(&key_path).map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            "SSH private key not configured. Please upload it in the app UI.".to_string()
        } else {
            format!("{err:?}")
        }
    })?;

    decode_secret_key(&key_text, None).map_err(|err| format!("{err:?}"))
}

fn ssh_private_key_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("{err:?}"))?
        .join("ssh");

    std::fs::create_dir_all(&dir).map_err(|err| format!("{err:?}"))?;
    Ok(dir.join("private_key"))
}

#[tauri::command]
fn ssh_key_status(app: AppHandle) -> Result<bool, String> {
    let key_path = ssh_private_key_path(&app)?;
    Ok(key_path.is_file())
}

#[tauri::command]
fn ssh_set_private_key(app: AppHandle, key_text: String) -> Result<(), String> {
    if key_text.len() > 256 * 1024 {
        return Err("Key too large".to_string());
    }

    // Validate key format early to return a friendly error.
    decode_secret_key(&key_text, None).map_err(|err| format!("{err:?}"))?;

    let key_path = ssh_private_key_path(&app)?;
    std::fs::write(&key_path, key_text).map_err(|err| format!("{err:?}"))?;
    Ok(())
}

#[tauri::command]
fn ssh_clear_private_key(app: AppHandle) -> Result<(), String> {
    let key_path = ssh_private_key_path(&app)?;
    match std::fs::remove_file(&key_path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("{err:?}")),
    }
}

fn vm_passwords_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("{err:?}"))?
        .join("vmware");

    std::fs::create_dir_all(&dir).map_err(|err| format!("{err:?}"))?;
    Ok(dir.join("vm_passwords.json"))
}

fn normalize_vmx_key(vmx_path: &str) -> String {
    // Best-effort normalization so a password saved from one UI path string
    // can be retrieved even if the path formatting differs (quotes/slashes/case).
    vmx_path
        .trim()
        .trim_matches('"')
        .replace('/', "\\")
        .to_lowercase()
}

fn load_vm_passwords(app: &AppHandle) -> Result<HashMap<String, String>, String> {
    let path = vm_passwords_path(app)?;
    let text = match std::fs::read_to_string(&path) {
        Ok(v) => v,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(err) => return Err(format!("{err:?}")),
    };
    if text.trim().is_empty() {
        return Ok(HashMap::new());
    }
    serde_json::from_str::<HashMap<String, String>>(&text).map_err(|err| format!("{err:?}"))
}

fn save_vm_passwords(app: &AppHandle, map: &HashMap<String, String>) -> Result<(), String> {
    let path = vm_passwords_path(app)?;
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(map).map_err(|err| format!("{err:?}"))?;
    std::fs::write(&tmp, bytes).map_err(|err| format!("{err:?}"))?;
    std::fs::rename(&tmp, &path).map_err(|err| format!("{err:?}"))?;
    Ok(())
}

fn get_vm_password(app: &AppHandle, vmx_path: &str) -> Result<Option<String>, String> {
    let map = load_vm_passwords(app)?;
    let key = normalize_vmx_key(vmx_path);
    if let Some(v) = map.get(&key) {
        return Ok(Some(v.clone()));
    }

    // Backward compatibility: older versions only used trim+lowercase.
    let legacy_key = vmx_path.trim().to_lowercase();
    if let Some(v) = map.get(&legacy_key) {
        return Ok(Some(v.clone()));
    }

    // Last resort: normalize stored keys and compare.
    for (k, v) in map.iter() {
        if normalize_vmx_key(k) == key {
            return Ok(Some(v.clone()));
        }
    }

    Ok(None)
}

#[tauri::command]
fn vm_password_status(app: AppHandle, vmx_path: String) -> Result<bool, String> {
    Ok(get_vm_password(&app, &vmx_path)?.is_some())
}

#[tauri::command]
fn vm_password_set(app: AppHandle, vmx_path: String, vm_password: String) -> Result<(), String> {
    if vm_password.trim().is_empty() {
        return Err("VM password cannot be empty.".to_string());
    }
    if vm_password.len() > 4096 {
        return Err("VM password too large.".to_string());
    }

    let mut map = load_vm_passwords(&app)?;
    map.insert(normalize_vmx_key(&vmx_path), vm_password);
    save_vm_passwords(&app, &map)?;
    Ok(())
}

#[tauri::command]
fn vm_password_clear(app: AppHandle, vmx_path: String) -> Result<(), String> {
    let mut map = load_vm_passwords(&app)?;
    map.remove(&normalize_vmx_key(&vmx_path));
    save_vm_passwords(&app, &map)?;
    Ok(())
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
async fn ssh_dir(app: AppHandle, ssh: SshConfig) -> Result<String, String> {
    let mut session = ssh_connect(&app, &ssh).await?;
    let output = session.exec_collect("dir").await?;
    let _ = session.close().await;
    Ok(output)
}

#[tauri::command]
async fn ssh_exec(
    app: AppHandle,
    store: tauri::State<'_, TraceStore>,
    ssh: SshConfig,
    command: String,
    request_id: Option<String>,
) -> Result<String, String> {
    if command.len() > 8192 {
        return Err("Command too long".to_string());
    }

    let mut session = ssh_connect(&app, &ssh).await?;
    let started = Instant::now();
    let res = session.exec_collect_full(&command).await?;
    let _ = session.close().await;

    let ok = res.exit_status.unwrap_or(0) == 0;
    store.push(TraceEntry {
        id: 0,
        at: now_ms(),
        action: "ssh_exec".to_string(),
        ok,
        duration_ms: started.elapsed().as_millis() as u64,
        command: truncate_text(&command, 16 * 1024),
        output: truncate_text(&res.output, 64 * 1024),
        error: if ok {
            None
        } else {
            Some(truncate_text(res.output.trim(), 8 * 1024))
        },
        request_id,
    });

    if ok {
        Ok(res.output)
    } else if res.output.trim().is_empty() {
        Err(remote_exit_error(res.exit_status.unwrap_or(1)))
    } else {
        Err(res.output.trim().to_string())
    }
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
        .filter(|line| !line.to_ascii_lowercase().starts_with("total"))
        .map(|line| line.trim_matches('"').to_string())
        .collect()
}

fn parse_json_string_array(output: &str) -> Result<Vec<String>, String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let candidate = trimmed
        .lines()
        .map(|line| line.trim())
        .find(|line| !line.is_empty())
        .unwrap_or(trimmed);

    if let Ok(list) = serde_json::from_str::<Vec<String>>(candidate) {
        return Ok(list);
    }

    if let Ok(single) = serde_json::from_str::<String>(candidate) {
        return Ok(vec![single]);
    }

    Err(format!(
        "Failed to parse JSON array from output (first line: {})",
        truncate_text(candidate, 240)
    ))
}

#[derive(Debug, Clone, Serialize)]
struct VmItem {
    vmx_path: String,
    is_running: bool,
}

#[tauri::command]
async fn vmware_list_running(
    app: AppHandle,
    store: tauri::State<'_, TraceStore>,
    ssh: SshConfig,
    request_id: Option<String>,
) -> Result<Vec<String>, String> {
    let mut session = ssh_connect(&app, &ssh).await?;
    let ps = format!(
        r#"
{}
{}
$out = & $vmrun -T ws list 2>&1
$code = $LASTEXITCODE
if ($null -eq $code) {{ $code = 1 }}
if ($code -ne 0) {{ if ($out) {{ $out }} else {{ 'vmrun failed with exit code ' + $code }}; exit $code }}
$out
"#,
        powershell_prelude(),
        vmrun_locator_ps()
    );
    let exec_command = powershell_encoded(&ps);
    let started = Instant::now();
    let res = session.exec_collect_full(&exec_command).await?;
    let _ = session.close().await;

    let ok = res.exit_status.unwrap_or(0) == 0;
    store.push(TraceEntry {
        id: 0,
        at: now_ms(),
        action: "vmware_list_running".to_string(),
        ok,
        duration_ms: started.elapsed().as_millis() as u64,
        command: truncate_text(ps.trim(), 16 * 1024),
        output: truncate_text(&res.output, 64 * 1024),
        error: if ok {
            None
        } else {
            Some(truncate_text(res.output.trim(), 8 * 1024))
        },
        request_id,
    });

    if ok {
        Ok(parse_vmrun_list_output(&res.output))
    } else if res.output.trim().is_empty() {
        Err(remote_exit_error(res.exit_status.unwrap_or(1)))
    } else {
        Err(res.output.trim().to_string())
    }
}

#[tauri::command]
async fn vmware_status_for_known(
    app: AppHandle,
    store: tauri::State<'_, TraceStore>,
    ssh: SshConfig,
    known_vmx_paths: Vec<String>,
    request_id: Option<String>,
) -> Result<Vec<VmItem>, String> {
    let running = vmware_list_running(app, store, ssh, request_id).await?;
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
async fn vmware_start_vm_inner(
    app: &AppHandle,
    store: &TraceStore,
    ssh: SshConfig,
    vmx_path: String,
    vm_password: Option<String>,
    request_id: Option<String>,
) -> Result<String, String> {
    let mut session = ssh_connect(app, &ssh).await?;
    let vmx_quoted = ps_single_quote_escape(&vmx_path);
    let (ps_exec, ps_log) = if let Some(vm_password) = vm_password {
        let pw_quoted = ps_single_quote_escape(&vm_password);
        (
            format!(
                r#"
{prelude}
{locator}
$vmx = '{vmx}'
$vmPassword = '{pw}'
$args = @('-T', 'ws', '-vp', $vmPassword, 'start', $vmx, 'nogui')
$out = & $vmrun @args 2>&1
$code = $LASTEXITCODE
if ($null -eq $code) {{ $code = 1 }}
if ($code -ne 0) {{
  if ($out) {{ $out }} else {{ 'vmrun start failed with exit code ' + $code }}
  exit $code
}}
function Parse-RunningList([string]$listOut) {{
  $running=@()
  foreach($line in ($listOut -split "`n")) {{
    if ($null -eq $line) {{ continue }}
    $t = $line.Trim().TrimEnd("`r").Trim('"')
    if (-not $t) {{ continue }}
    if ($t.ToLowerInvariant().StartsWith('total')) {{ continue }}
    $running += $t
  }}
  return $running
}}

$isRunning = $false
for ($i = 0; $i -lt 15; $i += 1) {{
  Start-Sleep -Seconds 1
  $listOut = & $vmrun -T ws list 2>&1
  $running = Parse-RunningList $listOut
  foreach($p in $running) {{
    if ($p -ieq $vmx) {{ $isRunning = $true; break }}
  }}
  if ($isRunning) {{ break }}
}}

if (-not $isRunning) {{
  if ($out) {{ $out }} else {{ 'vmrun start returned success but VM is not running' }}
  $listOut
  exit 2
}}
$out
"#,
                prelude = powershell_prelude(),
                locator = vmrun_locator_ps(),
                vmx = vmx_quoted,
                pw = pw_quoted
            ),
            format!(
                r#"
{prelude}
{locator}
$vmx = '{vmx}'
$vmPassword = '[REDACTED]'
$args = @('-T', 'ws', '-vp', $vmPassword, 'start', $vmx, 'nogui')
$out = & $vmrun @args 2>&1
$code = $LASTEXITCODE
if ($null -eq $code) {{ $code = 1 }}
if ($code -ne 0) {{
  if ($out) {{ $out }} else {{ 'vmrun start failed with exit code ' + $code }}
  exit $code
}}
function Parse-RunningList([string]$listOut) {{
  $running=@()
  foreach($line in ($listOut -split "`n")) {{
    if ($null -eq $line) {{ continue }}
    $t = $line.Trim().TrimEnd("`r").Trim('"')
    if (-not $t) {{ continue }}
    if ($t.ToLowerInvariant().StartsWith('total')) {{ continue }}
    $running += $t
  }}
  return $running
}}

$isRunning = $false
for ($i = 0; $i -lt 15; $i += 1) {{
  Start-Sleep -Seconds 1
  $listOut = & $vmrun -T ws list 2>&1
  $running = Parse-RunningList $listOut
  foreach($p in $running) {{
    if ($p -ieq $vmx) {{ $isRunning = $true; break }}
  }}
  if ($isRunning) {{ break }}
}}

if (-not $isRunning) {{
  if ($out) {{ $out }} else {{ 'vmrun start returned success but VM is not running' }}
  $listOut
  exit 2
}}
$out
"#,
                prelude = powershell_prelude(),
                locator = vmrun_locator_ps(),
                vmx = vmx_quoted
            ),
        )
    } else {
        let ps = format!(
            r#"
{}
{}
$out = & $vmrun -T ws start '{}' nogui 2>&1
$code = $LASTEXITCODE
if ($null -eq $code) {{ $code = 1 }}
if ($code -ne 0) {{ if ($out) {{ $out }} else {{ 'vmrun failed with exit code ' + $code }}; exit $code }}
$out
"#,
            powershell_prelude(),
            vmrun_locator_ps(),
            vmx_quoted
        );
        (ps.clone(), ps)
    };
    let exec_command = powershell_encoded(&ps_exec);
    let started = Instant::now();
    let res = session.exec_collect_full(&exec_command).await?;
    let _ = session.close().await;

    let ok = res.exit_status.unwrap_or(0) == 0;
    store.push(TraceEntry {
        id: 0,
        at: now_ms(),
        action: "vmware_start_vm".to_string(),
        ok,
        duration_ms: started.elapsed().as_millis() as u64,
        command: truncate_text(ps_log.trim(), 16 * 1024),
        output: truncate_text(&res.output, 64 * 1024),
        error: if ok {
            None
        } else {
            Some(truncate_text(res.output.trim(), 8 * 1024))
        },
        request_id,
    });

    if ok {
        Ok(res.output)
    } else if res.output.trim().is_empty() {
        Err(remote_exit_error(res.exit_status.unwrap_or(1)))
    } else {
        Err(res.output.trim().to_string())
    }
}

fn vmrun_requires_password(output: &str) -> bool {
    let t = output.to_lowercase();

    // English
    if t.contains("password") {
        return t.contains("encrypted")
            || t.contains("protection")
            || t.contains("requires")
            || t.contains("need")
            || t.contains("not correct")
            || t.contains("incorrect");
    }

    // Chinese (common VMware Workstation messages on Windows)
    // e.g. "此操作需要输入密码"
    output.contains("密码") || output.contains("需要输入密码") || output.contains("需要輸入密碼")
}

fn vmrun_bad_password(output: &str) -> bool {
    let t = output.to_lowercase();
    if t.contains("password") {
        return t.contains("password is incorrect") || t.contains("incorrect password") || t.contains("not correct");
    }

    // Chinese variants
    output.contains("密码不正确") || output.contains("密碼不正確") || output.contains("密码错误") || output.contains("密碼錯誤")
}

#[tauri::command]
async fn vmware_start_vm(
    app: AppHandle,
    store: tauri::State<'_, TraceStore>,
    ssh: SshConfig,
    vmx_path: String,
    vm_password: Option<String>,
    request_id: Option<String>,
) -> Result<String, String> {
    vmware_start_vm_inner(&app, &store, ssh, vmx_path, vm_password, request_id).await
}

#[tauri::command]
async fn vmware_start_vm_auto(
    app: AppHandle,
    store: tauri::State<'_, TraceStore>,
    ssh: SshConfig,
    vmx_path: String,
    request_id: Option<String>,
) -> Result<String, String> {
    if let Some(password) = get_vm_password(&app, &vmx_path)? {
        return match vmware_start_vm_inner(&app, &store, ssh, vmx_path, Some(password), request_id).await {
            Ok(out) => Ok(out),
            Err(err2) if vmrun_bad_password(&err2) => Err(VM_PASSWORD_INVALID.to_string()),
            Err(err2) => Err(err2),
        };
    }

    match vmware_start_vm_inner(&app, &store, ssh.clone(), vmx_path.clone(), None, request_id.clone()).await {
        Ok(out) => Ok(out),
        Err(err) => {
            if vmrun_requires_password(&err) {
                Err(VM_PASSWORD_REQUIRED.to_string())
            } else {
                Err(err)
            }
        }
    }
}

#[tauri::command]
async fn vmware_stop_vm_inner(
    app: &AppHandle,
    store: &TraceStore,
    ssh: SshConfig,
    vmx_path: String,
    mode: Option<VmStopMode>,
    vm_password: Option<String>,
    request_id: Option<String>,
) -> Result<String, String> {
    let mut session = ssh_connect(app, &ssh).await?;
    let vmx_quoted = ps_single_quote_escape(&vmx_path);
    let mode = mode.unwrap_or(VmStopMode::Soft);
    let mode_str = mode.as_str();
    let (ps_exec, ps_log) = if let Some(vm_password) = vm_password {
        let pw_quoted = ps_single_quote_escape(&vm_password);
        (
            format!(
                r#"
{prelude}
{locator}
$vmx = '{vmx}'
$vmPassword = '{pw}'
$args = @('-T', 'ws', '-vp', $vmPassword, 'stop', $vmx, '{mode}')
$out = & $vmrun @args 2>&1
$code = $LASTEXITCODE
if ($null -eq $code) {{ $code = 1 }}
if ($code -ne 0) {{ if ($out) {{ $out }} else {{ 'vmrun failed with exit code ' + $code }}; exit $code }}
$out
"#,
                prelude = powershell_prelude(),
                locator = vmrun_locator_ps(),
                vmx = vmx_quoted,
                pw = pw_quoted,
                mode = mode_str
            ),
            format!(
                r#"
{prelude}
{locator}
$vmx = '{vmx}'
$vmPassword = '[REDACTED]'
$args = @('-T', 'ws', '-vp', $vmPassword, 'stop', $vmx, '{mode}')
$out = & $vmrun @args 2>&1
$code = $LASTEXITCODE
if ($null -eq $code) {{ $code = 1 }}
if ($code -ne 0) {{ if ($out) {{ $out }} else {{ 'vmrun failed with exit code ' + $code }}; exit $code }}
$out
"#,
                prelude = powershell_prelude(),
                locator = vmrun_locator_ps(),
                vmx = vmx_quoted,
                mode = mode_str
            ),
        )
    } else {
        let ps = format!(
            r#"
{}
{}
$out = & $vmrun -T ws stop '{}' {} 2>&1
$code = $LASTEXITCODE
if ($null -eq $code) {{ $code = 1 }}
if ($code -ne 0) {{ if ($out) {{ $out }} else {{ 'vmrun failed with exit code ' + $code }}; exit $code }}
$out
"#,
            powershell_prelude(),
            vmrun_locator_ps(),
            vmx_quoted,
            mode_str
        );
        (ps.clone(), ps)
    };
    let exec_command = powershell_encoded(&ps_exec);
    let started = Instant::now();
    let res = session.exec_collect_full(&exec_command).await?;
    let _ = session.close().await;

    let ok = res.exit_status.unwrap_or(0) == 0;
    store.push(TraceEntry {
        id: 0,
        at: now_ms(),
        action: "vmware_stop_vm".to_string(),
        ok,
        duration_ms: started.elapsed().as_millis() as u64,
        command: truncate_text(ps_log.trim(), 16 * 1024),
        output: truncate_text(&res.output, 64 * 1024),
        error: if ok {
            None
        } else {
            Some(truncate_text(res.output.trim(), 8 * 1024))
        },
        request_id,
    });

    if ok {
        Ok(res.output)
    } else if res.output.trim().is_empty() {
        Err(remote_exit_error(res.exit_status.unwrap_or(1)))
    } else {
        Err(res.output.trim().to_string())
    }
}

#[tauri::command]
async fn vmware_stop_vm(
    app: AppHandle,
    store: tauri::State<'_, TraceStore>,
    ssh: SshConfig,
    vmx_path: String,
    mode: Option<VmStopMode>,
    vm_password: Option<String>,
    request_id: Option<String>,
) -> Result<String, String> {
    vmware_stop_vm_inner(&app, &store, ssh, vmx_path, mode, vm_password, request_id).await
}

#[tauri::command]
async fn vmware_stop_vm_auto(
    app: AppHandle,
    store: tauri::State<'_, TraceStore>,
    ssh: SshConfig,
    vmx_path: String,
    mode: Option<VmStopMode>,
    request_id: Option<String>,
) -> Result<String, String> {
    if let Some(password) = get_vm_password(&app, &vmx_path)? {
        return match vmware_stop_vm_inner(&app, &store, ssh, vmx_path, mode, Some(password), request_id).await {
            Ok(out) => Ok(out),
            Err(err2) if vmrun_bad_password(&err2) => Err(VM_PASSWORD_INVALID.to_string()),
            Err(err2) => Err(err2),
        };
    }

    match vmware_stop_vm_inner(&app, &store, ssh.clone(), vmx_path.clone(), mode.clone(), None, request_id.clone()).await
    {
        Ok(out) => Ok(out),
        Err(err) => {
            if vmrun_requires_password(&err) {
                Err(VM_PASSWORD_REQUIRED.to_string())
            } else {
                Err(err)
            }
        }
    }
}

#[tauri::command]
async fn vmware_scan_default_vmx(
    app: AppHandle,
    store: tauri::State<'_, TraceStore>,
    ssh: SshConfig,
    request_id: Option<String>,
) -> Result<Vec<String>, String> {
    let mut session = ssh_connect(&app, &ssh).await?;
    let ps = r#"
$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
$ProgressPreference = 'SilentlyContinue'
$roots=@()
if($env:USERPROFILE){ $roots += (Join-Path $env:USERPROFILE 'Documents\Virtual Machines') }
if($env:PUBLIC){ $roots += (Join-Path $env:PUBLIC 'Documents\Shared Virtual Machines') }
$roots = $roots | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

$paths=@()
foreach($root in $roots){
  $paths += Get-ChildItem -LiteralPath $root -Recurse -File -Filter *.vmx -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -ieq '.vmx' } |
    Select-Object -ExpandProperty FullName
}

$paths = $paths | Sort-Object -Unique | Select-Object -First 500
@($paths) | ConvertTo-Json -Compress
"#;
    let exec_command = powershell_encoded(ps);
    let started = Instant::now();
    let res = session.exec_collect_full(&exec_command).await?;
    let _ = session.close().await;

    let ok = res.exit_status.unwrap_or(0) == 0;
    store.push(TraceEntry {
        id: 0,
        at: now_ms(),
        action: "vmware_scan_default_vmx".to_string(),
        ok,
        duration_ms: started.elapsed().as_millis() as u64,
        command: truncate_text(ps.trim(), 16 * 1024),
        output: truncate_text(&res.output, 64 * 1024),
        error: if ok {
            None
        } else {
            Some(truncate_text(res.output.trim(), 8 * 1024))
        },
        request_id,
    });

    if ok {
        parse_json_string_array(&res.output)
    } else if res.output.trim().is_empty() {
        Err(remote_exit_error(res.exit_status.unwrap_or(1)))
    } else {
        Err(res.output.trim().to_string())
    }
}

#[tauri::command]
async fn vmware_scan_vmx(
    app: AppHandle,
    store: tauri::State<'_, TraceStore>,
    ssh: SshConfig,
    roots: Vec<String>,
    request_id: Option<String>,
) -> Result<Vec<String>, String> {
    let mut session = ssh_connect(&app, &ssh).await?;
    let roots_json = serde_json::to_string(&roots).map_err(|err| format!("{err:?}"))?;

    let ps = format!(
        r#"
$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
$ProgressPreference = 'SilentlyContinue'
$inputRoots = '{roots_json}' | ConvertFrom-Json
$roots=@()
foreach($r in $inputRoots){{
  if(-not $r){{ continue }}
  $roots += [string]$r
}}
$roots = $roots | Select-Object -Unique

$expanded=@()
foreach($root in $roots){{
  $resolved = $ExecutionContext.InvokeCommand.ExpandString($root)
  if($resolved -and (Test-Path -LiteralPath $resolved)){{
    $expanded += $resolved
  }}
}}
$expanded = $expanded | Select-Object -Unique

$paths=@()
foreach($root in $expanded){{
  $paths += Get-ChildItem -LiteralPath $root -Recurse -File -Filter *.vmx -ErrorAction SilentlyContinue |
    Where-Object {{ $_.Extension -ieq '.vmx' }} |
    Select-Object -ExpandProperty FullName
}}

$paths = $paths | Sort-Object -Unique | Select-Object -First 500
@($paths) | ConvertTo-Json -Compress
"#
    );

    let exec_command = powershell_encoded(&ps);
    let started = Instant::now();
    let res = session.exec_collect_full(&exec_command).await?;
    let _ = session.close().await;

    let ok = res.exit_status.unwrap_or(0) == 0;
    store.push(TraceEntry {
        id: 0,
        at: now_ms(),
        action: "vmware_scan_vmx".to_string(),
        ok,
        duration_ms: started.elapsed().as_millis() as u64,
        command: truncate_text(ps.trim(), 16 * 1024),
        output: truncate_text(&res.output, 64 * 1024),
        error: if ok {
            None
        } else {
            Some(truncate_text(res.output.trim(), 8 * 1024))
        },
        request_id,
    });

    if ok {
        parse_json_string_array(&res.output)
    } else if res.output.trim().is_empty() {
        Err(remote_exit_error(res.exit_status.unwrap_or(1)))
    } else {
        Err(res.output.trim().to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(TraceStore::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            e2e_exit,
            e2e_write_report,
            e2e_log,
            trace_list,
            trace_clear,
            ssh_key_status,
            ssh_set_private_key,
            ssh_clear_private_key,
            vm_password_status,
            vm_password_set,
            vm_password_clear,
            ssh_dir,
            ssh_exec,
            vmware_list_running,
            vmware_status_for_known,
            vmware_start_vm,
            vmware_start_vm_auto,
            vmware_stop_vm,
            vmware_stop_vm_auto,
            vmware_scan_default_vmx,
            vmware_scan_vmx
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
