import { invoke } from "@tauri-apps/api/core";
import type { SshConfig, VmPassword, VmStopMode } from "./types";

export async function sshKeyStatus() {
  return invoke<boolean>("ssh_key_status");
}

export async function sshSetPrivateKey(keyText: string) {
  return invoke<void>("ssh_set_private_key", { keyText });
}

export async function sshClearPrivateKey() {
  return invoke<void>("ssh_clear_private_key");
}

export async function sshExec(ssh: SshConfig, command: string, requestId?: string) {
  return invoke<string>("ssh_exec", { ssh, command, requestId });
}

export async function vmwareListRunning(ssh: SshConfig, requestId?: string) {
  return invoke<string[]>("vmware_list_running", { ssh, requestId });
}

export async function vmwareStartVm(ssh: SshConfig, vmxPath: string, requestId?: string) {
  return invoke<string>("vmware_start_vm", { ssh, vmxPath, requestId });
}

export async function vmwareStartVmWithPassword(
  ssh: SshConfig,
  vmxPath: string,
  vmPassword?: VmPassword,
  requestId?: string,
) {
  return invoke<string>("vmware_start_vm", { ssh, vmxPath, vmPassword, requestId });
}

export async function vmwareStopVm(
  ssh: SshConfig,
  vmxPath: string,
  mode?: VmStopMode,
  requestId?: string,
  vmPassword?: VmPassword,
) {
  return invoke<string>("vmware_stop_vm", { ssh, vmxPath, mode, requestId, vmPassword });
}

export async function vmwareScanDefaultVmx(ssh: SshConfig, requestId?: string) {
  return invoke<string[]>("vmware_scan_default_vmx", { ssh, requestId });
}

export async function vmwareScanVmx(ssh: SshConfig, roots: string[], requestId?: string) {
  return invoke<string[]>("vmware_scan_vmx", { ssh, roots, requestId });
}

export type TraceEntry = {
  id: number;
  at: number;
  action: string;
  ok: boolean;
  durationMs: number;
  command: string;
  output: string;
  error?: string | null;
  requestId?: string | null;
};

export async function traceList() {
  return invoke<TraceEntry[]>("trace_list");
}

export async function traceClear() {
  return invoke<void>("trace_clear");
}
