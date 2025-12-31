import { invoke } from "@tauri-apps/api/core";
import * as tauri from "./tauri";
import type { SshConfig, VmStopMode } from "./types";

type E2EEvent = {
  name: string;
  ok: boolean;
  durationMs: number;
  error?: string;
  meta?: Record<string, unknown>;
};

function envFlag(value: unknown): boolean {
  if (value == null) return false;
  const text = String(value).trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

function envText(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value);
  return text.trim() ? text : undefined;
}

function envJson<T>(value: unknown): T | undefined {
  const text = envText(value);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(label: string, ms: number, fn: () => Promise<T>): Promise<T> {
  let timeoutHandle: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timeoutHandle != null) window.clearTimeout(timeoutHandle);
  }
}

async function withRetry<T>(
  label: string,
  attempts: number,
  delayMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(delayMs);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${String(lastError)}`);
}

function buildSshFromEnv(): SshConfig | null {
  const host = envText(import.meta.env.VITE_E2E_SSH_HOST);
  const user = envText(import.meta.env.VITE_E2E_SSH_USER);
  const portText = envText(import.meta.env.VITE_E2E_SSH_PORT);
  if (!host || !user) return null;
  const port = portText ? Number(portText) : 22;
  return { host, user, port: Number.isFinite(port) && port > 0 ? port : 22 };
}

function newRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function runStep<T>(
  events: E2EEvent[],
  name: string,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  const started = performance.now();
  try {
    const res = await fn();
    events.push({ name, ok: true, durationMs: Math.round(performance.now() - started), meta });
    return res;
  } catch (err) {
    events.push({
      name,
      ok: false,
      durationMs: Math.round(performance.now() - started),
      error: err instanceof Error ? err.message : String(err),
      meta,
    });
    throw err;
  }
}

async function vmIsRunning(ssh: SshConfig, vmxPath: string, requestId: string): Promise<boolean> {
  const list = await tauri.vmwareListRunning(ssh, requestId);
  return list.some((p) => p.localeCompare(vmxPath, undefined, { sensitivity: "accent" }) === 0 || p.toLowerCase() === vmxPath.toLowerCase());
}

async function tryStopVm(
  ssh: SshConfig,
  vmxPath: string,
  mode: VmStopMode,
  requestId: string,
  vmPassword?: string,
): Promise<void> {
  await withRetry(`vmware_stop_vm(${mode})`, 2, 800, async () => {
    await tauri.vmwareStopVm(ssh, vmxPath, mode, requestId, vmPassword || undefined);
  });
}

async function tryStartVm(ssh: SshConfig, vmxPath: string, requestId: string, vmPassword?: string): Promise<void> {
  await withRetry("vmware_start_vm", 2, 800, async () => {
    await tauri.vmwareStartVmWithPassword(ssh, vmxPath, vmPassword || undefined, requestId);
  });
}

export async function runE2EInvokeSuite(): Promise<{ ok: boolean; events: E2EEvent[] }> {
  const events: E2EEvent[] = [];
  const ssh = buildSshFromEnv();

  if (!ssh) {
    events.push({
      name: "env_check",
      ok: false,
      durationMs: 0,
      error: "Missing VITE_E2E_SSH_HOST or VITE_E2E_SSH_USER (and optionally VITE_E2E_SSH_PORT).",
    });
    return { ok: false, events };
  }

  const vmxPath = envText(import.meta.env.VITE_E2E_VM_VMX_PATH);
  const vmPassword = envText(import.meta.env.VITE_E2E_VM_PASSWORD);
  const scanRoots = envJson<string[]>(import.meta.env.VITE_E2E_SCAN_ROOTS);
  const keyText = envText(import.meta.env.VITE_E2E_SSH_KEY_TEXT);
  const runHardStop = envFlag(import.meta.env.VITE_E2E_RUN_HARD_STOP);
  const timeoutMs = Number(envText(import.meta.env.VITE_E2E_TIMEOUT_MS) || "120000");

  try {
    await runStep(events, "trace_clear", () => tauri.traceClear());

    const keyPresent = await runStep(events, "ssh_key_status", () => tauri.sshKeyStatus());
    if (!keyPresent) {
      if (!keyText) throw new Error("SSH key missing; set VITE_E2E_SSH_KEY_TEXT or configure key in app first.");
      await runStep(events, "ssh_set_private_key", () => tauri.sshSetPrivateKey(keyText));
      const presentAfter = await runStep(events, "ssh_key_status_after_set", () => tauri.sshKeyStatus());
      if (!presentAfter) throw new Error("ssh_set_private_key reported success, but ssh_key_status is still false.");
    }

    await runStep(events, "ssh_exec_hostname", () =>
      withTimeout("ssh_exec", timeoutMs, () => tauri.sshExec(ssh, 'powershell -NoProfile -NonInteractive -Command "hostname"', newRequestId("ssh_exec"))),
    );

    await runStep(events, "vmware_list_running", () =>
      withTimeout("vmware_list_running", timeoutMs, () => tauri.vmwareListRunning(ssh, newRequestId("vmware_list_running"))),
    );

    // Not wrapped by src/app/tauri.ts today; still needs to be covered by the suite.
    await runStep(events, "vmware_status_for_known", () =>
      withTimeout("vmware_status_for_known", timeoutMs, async () => {
        const known = vmxPath ? [vmxPath] : [];
        return invoke("vmware_status_for_known", { ssh, knownVmxPaths: known, requestId: newRequestId("vmware_status_for_known") }) as Promise<unknown>;
      }),
      { hasVmxPath: Boolean(vmxPath) },
    );

    if (vmxPath) {
      await runStep(events, "vmware_stop_soft_preflight", async () => {
        const wasRunning = await withTimeout("vmware preflight status", timeoutMs, () =>
          vmIsRunning(ssh, vmxPath, newRequestId("preflight_list")),
        );
        if (wasRunning) await tryStopVm(ssh, vmxPath, "soft", newRequestId("vmware_stop_soft_preflight"), vmPassword);
      });

      await runStep(events, "vmware_start_vm", () =>
        withTimeout("vmware_start_vm", timeoutMs, async () => {
          await tryStartVm(ssh, vmxPath, newRequestId("vmware_start_vm"), vmPassword);
          const isRunning = await vmIsRunning(ssh, vmxPath, newRequestId("vmware_list_running_after_start"));
          if (!isRunning) throw new Error("vmware_start_vm returned success but VM is not running.");
        }),
      );

      await runStep(events, "vmware_stop_soft", () =>
        withTimeout("vmware_stop_vm(soft)", timeoutMs, async () => {
          await tryStopVm(ssh, vmxPath, "soft", newRequestId("vmware_stop_soft"), vmPassword);
          await sleep(400);
          const stillRunning = await vmIsRunning(ssh, vmxPath, newRequestId("vmware_list_running_after_stop_soft"));
          if (stillRunning) throw new Error("vmware_stop_vm(soft) returned success but VM is still running.");
        }),
      );

      if (runHardStop) {
        await runStep(events, "vmware_start_vm_for_hard_stop", () =>
          withTimeout("vmware_start_vm (hard stop pre)", timeoutMs, async () => {
            await tryStartVm(ssh, vmxPath, newRequestId("vmware_start_vm_for_hard_stop"), vmPassword);
          }),
        );

        await runStep(events, "vmware_stop_hard", () =>
          withTimeout("vmware_stop_vm(hard)", timeoutMs, async () => {
            await tryStopVm(ssh, vmxPath, "hard", newRequestId("vmware_stop_hard"), vmPassword);
            await sleep(400);
            const stillRunning = await vmIsRunning(ssh, vmxPath, newRequestId("vmware_list_running_after_stop_hard"));
            if (stillRunning) throw new Error("vmware_stop_vm(hard) returned success but VM is still running.");
          }),
        );
      }
    } else {
      events.push({
        name: "vmware_start_stop_skipped",
        ok: true,
        durationMs: 0,
        meta: { reason: "VITE_E2E_VM_VMX_PATH not set" },
      });
    }

    await runStep(events, "vmware_scan_default_vmx", () =>
      withTimeout("vmware_scan_default_vmx", timeoutMs, () => tauri.vmwareScanDefaultVmx(ssh, newRequestId("vmware_scan_default_vmx"))),
    );

    if (Array.isArray(scanRoots) && scanRoots.length) {
      await runStep(events, "vmware_scan_vmx", () =>
        withTimeout("vmware_scan_vmx", timeoutMs, () => tauri.vmwareScanVmx(ssh, scanRoots, newRequestId("vmware_scan_vmx"))),
        { rootsCount: scanRoots.length },
      );
    } else {
      events.push({
        name: "vmware_scan_vmx_skipped",
        ok: true,
        durationMs: 0,
        meta: { reason: "VITE_E2E_SCAN_ROOTS not set or empty" },
      });
    }

    await runStep(events, "trace_list", () => tauri.traceList());
    return { ok: true, events };
  } catch {
    try {
      await tauri.traceList();
    } catch {
      // ignore: suite is failing already
    }
    return { ok: false, events };
  } finally {
    if (keyText) {
      try {
        await tauri.sshClearPrivateKey();
      } catch {
        // ignore cleanup failure
      }
    }
  }
}

export async function maybeRunE2EInvokeSuite() {
  const enabled = envFlag(import.meta.env.VITE_E2E);
  if (!enabled) return;

  const globalAny = globalThis as unknown as { __TAURI_APP_E2E_RUNNING__?: boolean };
  if (globalAny.__TAURI_APP_E2E_RUNNING__) return;
  globalAny.__TAURI_APP_E2E_RUNNING__ = true;

  const report = await runE2EInvokeSuite();
  const payload = {
    ok: report.ok,
    at: new Date().toISOString(),
    events: report.events,
  };

  // Keep output compact but usable in CI logs.
  // eslint-disable-next-line no-console
  console.log(`[e2e] ${payload.ok ? "PASS" : "FAIL"} ${JSON.stringify(payload)}`);

  // Exit the app so callers can rely on the process exit code.
  await invoke("e2e_exit", { code: report.ok ? 0 : 1 });
}

