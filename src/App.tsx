import { useEffect, useMemo, useState } from "react";
import "./App.css";

import type { KnownVm, SshConfig, Toast, VmStopMode } from "./app/types";
import { readLocalStorageJson, writeLocalStorageJson, newId } from "./app/storage";
import { useHashRoute } from "./app/useHashRoute";
import * as tauri from "./app/tauri";
import { guessVmNameFromVmxPath } from "./app/vmName";
import type { LogAction, LogEvent } from "./app/log";
import { summarizeSsh, summarizeStopMode, summarizeVmxPath } from "./app/log";
import { ui } from "./components/ui";
import { ToastViewport } from "./components/ToastViewport";
import { Modal } from "./components/Modal";
import { ConsolePage } from "./pages/ConsolePage";
import { SettingsPage } from "./pages/SettingsPage";

const LS = {
  ssh: "vmware.ssh",
  knownVms: "vmware.knownVms.v2",
  knownVmsLegacy: "vmware.knownVms",
  scanRoots: "vmware.scanRoots",
  diagCommand: "diag.command",
  opLog: "vmware.opLog.v1",
};

function defaultSsh(): SshConfig {
  return { host: "192.168.5.100", port: 22, user: "rin" };
}

function defaultScanRoots(): string[] {
  return ["$env:USERPROFILE\\Documents\\Virtual Machines", "$env:PUBLIC\\Documents\\Shared Virtual Machines"];
}

function normalizeKnownVms(vms: KnownVm[]): KnownVm[] {
  const seen = new Set<string>();
  return vms
    .filter((v) => v.vmxPath?.trim())
    .map((v) => ({
      id: v.id || newId(),
      vmxPath: v.vmxPath,
      createdAt: v.createdAt || Date.now(),
      pinned: v.pinned || false,
      nameOverride: v.nameOverride,
    }))
    .filter((v) => {
      const key = v.vmxPath.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export default function App() {
  const { route, navigate } = useHashRoute();

  const [ssh, setSsh] = useState<SshConfig>(() => readLocalStorageJson<SshConfig>(LS.ssh, defaultSsh()));
  const [knownVms, setKnownVms] = useState<KnownVm[]>(() => {
    const v2 = readLocalStorageJson<KnownVm[]>(LS.knownVms, []);
    if (v2.length) return normalizeKnownVms(v2);

    const legacy = readLocalStorageJson<Array<{ id?: string; name?: string; vmxPath: string }>>(LS.knownVmsLegacy, []);
    const migrated: KnownVm[] = legacy.map((vm) => ({
      id: vm.id || newId(),
      vmxPath: vm.vmxPath,
      createdAt: Date.now(),
      nameOverride: vm.name?.trim() || guessVmNameFromVmxPath(vm.vmxPath),
    }));
    return normalizeKnownVms(migrated);
  });
  const [scanRoots, setScanRoots] = useState<string[]>(() =>
    readLocalStorageJson<string[]>(LS.scanRoots, defaultScanRoots()),
  );

  const [sshKeyPresent, setSshKeyPresent] = useState<boolean | null>(null);
  const [sshKeyError, setSshKeyError] = useState("");
  const [isKeyWorking, setIsKeyWorking] = useState(false);
  const [vmPassword, setVmPassword] = useState<string>("");

  const [runningVmxPaths, setRunningVmxPaths] = useState<string[]>([]);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [globalError, setGlobalError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [actionVmId, setActionVmId] = useState<string | null>(null);
  const [actionText, setActionText] = useState<string>("");

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [opLog, setOpLog] = useState<LogEvent[]>(() => readLocalStorageJson<LogEvent[]>(LS.opLog, []));
  const [traces, setTraces] = useState<tauri.TraceEntry[]>([]);
  const [isTracesLoading, setIsTracesLoading] = useState(false);

  const [scanWizardOpen, setScanWizardOpen] = useState(false);
  const [scanMode, setScanMode] = useState<"custom" | "default">("custom");
  const [scanError, setScanError] = useState("");
  const [scanResults, setScanResults] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanSelection, setScanSelection] = useState<Record<string, boolean>>({});

  const [diagOutput, setDiagOutput] = useState("");
  const [diagError, setDiagError] = useState("");
  const [isDiagRunning, setIsDiagRunning] = useState(false);
  const [diagCommand, setDiagCommand] = useState<string>(() =>
    readLocalStorageJson<string>(
      LS.diagCommand,
      '& "C:\\Program Files (x86)\\VMware\\VMware Workstation\\vmrun.exe" -T ws list',
    ),
  );

  useEffect(() => writeLocalStorageJson(LS.ssh, ssh), [ssh]);
  useEffect(() => writeLocalStorageJson(LS.knownVms, knownVms), [knownVms]);
  useEffect(() => writeLocalStorageJson(LS.scanRoots, scanRoots), [scanRoots]);
  useEffect(() => writeLocalStorageJson(LS.diagCommand, diagCommand), [diagCommand]);
  useEffect(() => writeLocalStorageJson(LS.opLog, opLog), [opLog]);

  function pushToast(toast: Omit<Toast, "id">) {
    setToasts((prev) => [{ id: newId(), ...toast }, ...prev].slice(0, 3));
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function pushLog(entry: Omit<LogEvent, "id" | "at">) {
    setOpLog((prev) => [{ id: newId(), at: Date.now(), ...entry }, ...prev].slice(0, 200));
  }

  async function withLog<T>(
    action: LogAction,
    fn: (requestId: string) => Promise<T>,
    opts?: { summary?: string; meta?: Record<string, unknown> },
  ): Promise<T> {
    const requestId = newId();
    const started = performance.now();
    try {
      const result = await fn(requestId);
      const durationMs = Math.round(performance.now() - started);
      pushLog({
        action,
        status: "success",
        durationMs,
        summary: opts?.summary,
        meta: opts?.meta,
        requestId,
      });
      return result;
    } catch (err) {
      const durationMs = Math.round(performance.now() - started);
      pushLog({
        action,
        status: "error",
        durationMs,
        summary: opts?.summary,
        error: String(err),
        meta: opts?.meta,
        requestId,
      });
      throw err;
    }
  }

  async function refreshKeyStatus() {
    setSshKeyError("");
    try {
      const present = await withLog("refresh_key_status", () => tauri.sshKeyStatus(), {
        meta: { ssh: summarizeSsh(ssh) },
      });
      setSshKeyPresent(present);
    } catch (err) {
      setSshKeyPresent(false);
      setSshKeyError(String(err));
    }
  }

  async function refreshTraces() {
    setIsTracesLoading(true);
    try {
      const list = await tauri.traceList();
      setTraces(list);
    } finally {
      setIsTracesLoading(false);
    }
  }

  async function clearTraces() {
    await tauri.traceClear();
    await refreshTraces();
  }

  async function refresh() {
    setIsRefreshing(true);
    setGlobalError("");
    try {
      const running = await withLog("refresh_running", (requestId) => tauri.vmwareListRunning(ssh, requestId), {
        summary: "List running VMs",
        meta: { ssh: summarizeSsh(ssh) },
      });
      setRunningVmxPaths(running);
      setLastRefreshAt(Date.now());
    } catch (err) {
      setGlobalError(String(err));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function testConnection() {
    setGlobalError("");
    try {
      const out = await withLog("test_connection", (requestId) =>
        tauri.sshExec(ssh, 'powershell -NoProfile -NonInteractive -Command "hostname"', requestId), {
          summary: "hostname",
          meta: { ssh: summarizeSsh(ssh) },
        });
      pushToast({ kind: "success", title: "连接正常", message: out.trim() || "OK" });
    } catch (err) {
      setGlobalError(String(err));
      pushToast({ kind: "error", title: "连接失败", message: String(err) });
    }
  }

  async function uploadSshKeyText(keyText: string) {
    setIsKeyWorking(true);
    setSshKeyError("");
    try {
      await withLog("upload_key", () => tauri.sshSetPrivateKey(keyText), {
        summary: "Upload SSH private key",
        meta: { keySize: keyText.length },
      });
      setSshKeyPresent(true);
      pushToast({ kind: "success", title: "私钥已保存" });
    } catch (err) {
      setSshKeyPresent(false);
      setSshKeyError(String(err));
      pushToast({ kind: "error", title: "私钥保存失败", message: String(err) });
    } finally {
      setIsKeyWorking(false);
    }
  }

  async function clearSshKey() {
    setIsKeyWorking(true);
    setSshKeyError("");
    try {
      await withLog("clear_key", () => tauri.sshClearPrivateKey(), { summary: "Clear SSH private key" });
      setSshKeyPresent(false);
      pushToast({ kind: "success", title: "已清除私钥" });
    } catch (err) {
      setSshKeyError(String(err));
      pushToast({ kind: "error", title: "清除失败", message: String(err) });
    } finally {
      setIsKeyWorking(false);
    }
  }

  function addVmByPath(vmxPath: string) {
    const trimmed = vmxPath.trim();
    if (!trimmed) return;
    pushLog({
      action: "add_vm_manual",
      status: "success",
      summary: "Add VM manually",
      meta: { vmxPath: summarizeVmxPath(trimmed) },
    });
    setKnownVms((prev) =>
      normalizeKnownVms([
        ...prev,
        {
          id: newId(),
          vmxPath: trimmed,
          createdAt: Date.now(),
          nameOverride: guessVmNameFromVmxPath(trimmed),
        },
      ]),
    );
    pushToast({ kind: "success", title: "已添加", message: guessVmNameFromVmxPath(trimmed) });
  }

  function removeVm(id: string) {
    setKnownVms((prev) => prev.filter((v) => v.id !== id));
    pushToast({ kind: "info", title: "已移除虚拟机" });
  }

  function pinVm(id: string, pinned: boolean) {
    setKnownVms((prev) => prev.map((v) => (v.id === id ? { ...v, pinned } : v)));
  }

  async function startVm(vm: KnownVm) {
    setActionVmId(vm.id);
    setActionText("启动中…");
    setGlobalError("");
    try {
      await withLog(
        "start_vm",
        (requestId) => tauri.vmwareStartVmWithPassword(ssh, vm.vmxPath, vmPassword || undefined, requestId),
        {
        summary: vm.nameOverride || guessVmNameFromVmxPath(vm.vmxPath),
        meta: { ssh: summarizeSsh(ssh), vmxPath: summarizeVmxPath(vm.vmxPath) },
        },
      );
      pushToast({ kind: "success", title: "已启动", message: vm.nameOverride || guessVmNameFromVmxPath(vm.vmxPath) });
      await refresh();
    } catch (err) {
      setGlobalError(String(err));
      pushToast({ kind: "error", title: "启动失败", message: String(err) });
    } finally {
      setActionVmId(null);
      setActionText("");
    }
  }

  async function stopVm(vm: KnownVm, mode: VmStopMode) {
    setActionVmId(vm.id);
    setActionText(mode === "hard" ? "硬关机中…" : "软关机中…");
    setGlobalError("");
    try {
      await withLog(
        "stop_vm",
        (requestId) => tauri.vmwareStopVm(ssh, vm.vmxPath, mode, requestId, vmPassword || undefined),
        {
        summary: vm.nameOverride || guessVmNameFromVmxPath(vm.vmxPath),
        meta: { ssh: summarizeSsh(ssh), vmxPath: summarizeVmxPath(vm.vmxPath), mode: summarizeStopMode(mode) },
        },
      );
      pushToast({ kind: "success", title: "已停止", message: vm.nameOverride || guessVmNameFromVmxPath(vm.vmxPath) });
      await refresh();
    } catch (err) {
      setGlobalError(String(err));
      pushToast({ kind: "error", title: "停止失败", message: String(err) });
    } finally {
      setActionVmId(null);
      setActionText("");
    }
  }

  async function runDiagCommand() {
    setIsDiagRunning(true);
    setDiagError("");
    try {
      const out = await withLog("run_diag", (requestId) => tauri.sshExec(ssh, diagCommand, requestId), {
        summary: "Run diagnostic command",
        meta: { ssh: summarizeSsh(ssh) },
      });
      setDiagOutput(out);
      pushToast({ kind: "success", title: "诊断命令已执行" });
    } catch (err) {
      setDiagError(String(err));
      pushToast({ kind: "error", title: "诊断失败", message: String(err) });
    } finally {
      setIsDiagRunning(false);
    }
  }

  async function runScan() {
    setIsScanning(true);
    setScanError("");
    setScanResults([]);
    try {
      const results =
        scanMode === "default"
          ? await withLog("scan_vmx_default", (requestId) => tauri.vmwareScanDefaultVmx(ssh, requestId), {
              summary: "Scan default roots",
              meta: { ssh: summarizeSsh(ssh) },
            })
          : await withLog("scan_vmx_custom", (requestId) => tauri.vmwareScanVmx(ssh, scanRoots, requestId), {
              summary: "Scan custom roots",
              meta: { ssh: summarizeSsh(ssh), rootsCount: scanRoots.length },
            });
      setScanResults(results);
      setScanSelection(Object.fromEntries(results.map((p) => [p, true])));
      pushToast({ kind: "success", title: "扫描完成", message: `找到 ${results.length} 个 VMX` });
    } catch (err) {
      setScanError(String(err));
      pushToast({ kind: "error", title: "扫描失败", message: String(err) });
    } finally {
      setIsScanning(false);
    }
  }

  function importSelected() {
    const selected = scanResults.filter((p) => scanSelection[p]);
    if (!selected.length) return;
    pushLog({
      action: "import_scan_results",
      status: "success",
      summary: "Import scan results",
      meta: { selectedCount: selected.length, totalCount: scanResults.length },
    });
    setKnownVms((prev) =>
      normalizeKnownVms([
        ...prev,
        ...selected.map((vmxPath) => ({
          id: newId(),
          vmxPath,
          createdAt: Date.now(),
          nameOverride: guessVmNameFromVmxPath(vmxPath),
        })),
      ]),
    );
    pushToast({ kind: "success", title: "已导入", message: `导入 ${selected.length} 个虚拟机` });
    setScanWizardOpen(false);
  }

  const unknownRunning = useMemo(() => {
    const knownSet = new Set(knownVms.map((v) => v.vmxPath.toLowerCase()));
    return runningVmxPaths.filter((p) => !knownSet.has(p.toLowerCase()));
  }, [knownVms, runningVmxPaths]);

  useEffect(() => {
    pushLog({ action: "app_init", status: "success", summary: "App init" });
    void refreshKeyStatus();
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (route !== "settings") return;
    void refreshTraces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  return (
    <div className={ui.page}>
      <main className={ui.shell}>
        {route === "console" ? (
          <ConsolePage
            ssh={ssh}
            sshKeyPresent={sshKeyPresent}
            knownVms={knownVms}
            runningVmxPaths={runningVmxPaths}
            lastRefreshAt={lastRefreshAt}
            globalError={globalError}
            isRefreshing={isRefreshing}
            actionVmId={actionVmId}
            actionText={actionText}
            unknownRunning={unknownRunning}
            onRefresh={refresh}
            onNavigateSettings={() => navigate("settings")}
            onStartVm={(vm) => void startVm(vm)}
            onStopVm={(vm, mode) => void stopVm(vm, mode)}
            onRemoveVm={removeVm}
            onPinVm={pinVm}
            onOpenScanWizard={() => setScanWizardOpen(true)}
            onAddVmByPath={addVmByPath}
          />
        ) : (
          <SettingsPage
            ssh={ssh}
            onChangeSsh={setSsh}
            sshKeyPresent={sshKeyPresent}
            sshKeyError={sshKeyError}
            isKeyWorking={isKeyWorking}
            onUploadKeyText={(text) => void uploadSshKeyText(text)}
            onClearKey={() => void clearSshKey()}
            vmPassword={vmPassword}
            onChangeVmPassword={setVmPassword}
            scanRoots={scanRoots}
            onSetScanRoots={setScanRoots}
            diagCommand={diagCommand}
            onSetDiagCommand={setDiagCommand}
            isDiagRunning={isDiagRunning}
            diagError={diagError}
            diagOutput={diagOutput}
            onRunDiag={() => void runDiagCommand()}
            onTestConnection={() => void testConnection()}
            onBack={() => navigate("console")}
            opLog={opLog}
            onClearOpLog={() => setOpLog([])}
            traces={traces}
            isTracesLoading={isTracesLoading}
            onRefreshTraces={() => void refreshTraces()}
            onClearTraces={() => void clearTraces()}
          />
        )}
      </main>

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />

      {scanWizardOpen ? (
        <Modal
          title="扫描并导入"
          description="先扫描远端目录的 .vmx 文件，再一键导入到控制台。"
          onClose={() => setScanWizardOpen(false)}
          primaryAction={{
            label: "导入选中项",
            onClick: importSelected,
            disabled: isScanning || !scanResults.some((p) => scanSelection[p]),
          }}
          secondaryAction={{
            label: isScanning ? "扫描中…" : "开始扫描",
            onClick: () => void runScan(),
            disabled: isScanning || sshKeyPresent === false,
          }}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`${ui.button} ${scanMode === "custom" ? ui.buttonPrimary : ""}`}
                  onClick={() => setScanMode("custom")}
                >
                  自定义目录
                </button>
                <button
                  type="button"
                  className={`${ui.button} ${scanMode === "default" ? ui.buttonPrimary : ""}`}
                  onClick={() => setScanMode("default")}
                >
                  默认目录
                </button>
              </div>
              <span className={ui.pill}>
                SSH 私钥：
                {sshKeyPresent ? "已配置" : sshKeyPresent === false ? "缺失" : "检查中"}
              </span>
            </div>

            {scanMode === "custom" ? (
              <div className="rounded-2xl border border-slate-900/10 bg-white/60 p-3 dark:border-slate-700/60 dark:bg-slate-900/60">
                <p className="m-0 font-semibold">扫描目录</p>
                <p className={`m-0 mt-1 text-sm ${ui.muted}`}>可在设置中维护目录列表。</p>
                <ul className="m-0 mt-2 list-disc pl-5">
                  {scanRoots.map((r) => (
                    <li key={r} className="break-words font-mono text-sm">
                      {r}
                    </li>
                  ))}
                </ul>
                <div className="mt-2">
                  <button type="button" className={ui.button} onClick={() => navigate("settings")}>
                    去设置编辑
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={`rounded-2xl border border-slate-900/10 bg-white/60 p-3 text-sm ${ui.muted} dark:border-slate-700/60 dark:bg-slate-900/60`}
              >
                默认目录会扫描用户文档与公共共享 VM 目录。
              </div>
            )}

            {scanError ? <p className="m-0 font-semibold text-rose-700 dark:text-rose-200">{scanError}</p> : null}

            {scanResults.length ? (
              <div className="rounded-2xl border border-slate-900/10 bg-white/60 p-3 dark:border-slate-700/60 dark:bg-slate-900/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="m-0 font-semibold">扫描结果（{scanResults.length}）</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={ui.button}
                      onClick={() => setScanSelection(Object.fromEntries(scanResults.map((p) => [p, true])))}
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      className={ui.button}
                      onClick={() => setScanSelection(Object.fromEntries(scanResults.map((p) => [p, false])))}
                    >
                      全不选
                    </button>
                  </div>
                </div>

                <ul className="mt-3 flex max-h-[360px] list-none flex-col gap-2 overflow-auto p-0">
                  {scanResults.map((path) => (
                    <li
                      key={path}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-900/10 bg-white/70 px-3 py-2 dark:border-slate-700/60 dark:bg-slate-900/60"
                    >
                      <label className="flex min-w-0 items-start gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(scanSelection[path])}
                          onChange={(e) => setScanSelection((prev) => ({ ...prev, [path]: e.target.checked }))}
                        />
                        <span className="min-w-0">
                          <span className="block font-semibold">{guessVmNameFromVmxPath(path)}</span>
                          <span className={`block break-words font-mono text-sm ${ui.muted}`}>{path}</span>
                        </span>
                      </label>
                      <button type="button" className={ui.button} onClick={() => addVmByPath(path)}>
                        直接添加
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div
                className={`rounded-2xl border border-slate-900/10 bg-white/60 p-3 text-sm ${ui.muted} dark:border-slate-700/60 dark:bg-slate-900/60`}
              >
                点“开始扫描”获取结果。
              </div>
            )}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
