import type { SshConfig, VmStopMode } from "./types";

export type LogStatus = "success" | "error";

export type LogAction =
  | "app_init"
  | "refresh_key_status"
  | "refresh_running"
  | "test_connection"
  | "upload_key"
  | "clear_key"
  | "scan_vmx_default"
  | "scan_vmx_custom"
  | "import_scan_results"
  | "add_vm_manual"
  | "start_vm"
  | "stop_vm"
  | "run_diag";

export type LogEvent = {
  id: string;
  at: number;
  action: LogAction;
  status: LogStatus;
  durationMs?: number;
  summary?: string;
  error?: string;
  meta?: Record<string, unknown>;
  requestId?: string;
};

export function summarizeSsh(ssh: SshConfig) {
  return { host: ssh.host, port: ssh.port, user: ssh.user };
}

export function summarizeVmxPath(vmxPath: string) {
  const trimmed = vmxPath.trim();
  return trimmed.length > 140 ? `${trimmed.slice(0, 100)}…${trimmed.slice(-35)}` : trimmed;
}

export function summarizeStopMode(mode: VmStopMode) {
  return mode === "hard" ? "hard" : "soft";
}
