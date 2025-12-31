import { invoke } from "@tauri-apps/api/core";
import type { SshConfig, VmStopMode } from "./types";

export async function sshKeyStatus() {
  return invoke<boolean>("ssh_key_status");
}

export async function sshSetPrivateKey(keyText: string) {
  return invoke<void>("ssh_set_private_key", { keyText });
}

export async function sshClearPrivateKey() {
  return invoke<void>("ssh_clear_private_key");
}

export async function sshExec(ssh: SshConfig, command: string) {
  return invoke<string>("ssh_exec", { ssh, command });
}

export async function vmwareListRunning(ssh: SshConfig) {
  return invoke<string[]>("vmware_list_running", { ssh });
}

export async function vmwareStartVm(ssh: SshConfig, vmxPath: string) {
  return invoke<string>("vmware_start_vm", { ssh, vmxPath });
}

export async function vmwareStopVm(ssh: SshConfig, vmxPath: string, mode?: VmStopMode) {
  return invoke<string>("vmware_stop_vm", { ssh, vmxPath, mode });
}

export async function vmwareScanDefaultVmx(ssh: SshConfig) {
  return invoke<string[]>("vmware_scan_default_vmx", { ssh });
}

export async function vmwareScanVmx(ssh: SshConfig, roots: string[]) {
  return invoke<string[]>("vmware_scan_vmx", { ssh, roots });
}

