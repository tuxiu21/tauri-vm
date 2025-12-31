import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type SshConfig = {
  host: string;
  port: number;
  user: string;
};

type KnownVm = {
  id: string;
  name: string;
  vmxPath: string;
};

type VmStopMode = "soft" | "hard";

function safeJsonParse<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function newId(): string {
  if ("randomUUID" in crypto) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const mutedText = "text-slate-600 dark:text-slate-300/70";
const fieldLabelText = "text-sm text-slate-700/80 dark:text-slate-200/80";
const controlBase =
  "rounded-lg border border-slate-200 bg-white px-4 py-2 text-base font-medium text-slate-950 shadow-sm outline-none transition-colors focus:border-blue-400 dark:border-slate-700 dark:bg-white/5 dark:text-white";
const controlPlaceholder = "placeholder:text-slate-400 dark:placeholder:text-slate-400/60";
const buttonBase = `${controlBase} cursor-pointer`;
const buttonPrimary =
  "border-blue-500/35 bg-gradient-to-b from-blue-500/15 to-blue-500/10 hover:border-blue-500/70";
const buttonDanger =
  "border-red-500/35 bg-gradient-to-b from-red-500/20 to-red-500/10 hover:border-red-500/80";
const buttonDangerOutline = "border-red-500/60 bg-transparent";
const pillBase =
  "flex-none rounded-full border border-slate-900/10 bg-slate-900/5 px-2.5 py-1 text-[0.82rem] text-slate-700 dark:border-slate-400/20 dark:bg-white/5 dark:text-slate-200/75";

function App() {
  const [activeTab, setActiveTab] = useState<"vm" | "diag">("vm");
  const [sshKeyPresent, setSshKeyPresent] = useState<boolean | null>(null);
  const [sshKeyError, setSshKeyError] = useState("");
  const [isKeyWorking, setIsKeyWorking] = useState(false);
  const keyInputRef = useRef<HTMLInputElement | null>(null);

  const [ssh, setSsh] = useState<SshConfig>(() => {
    return (
      safeJsonParse<SshConfig>(localStorage.getItem("vmware.ssh")) ?? {
        host: "192.168.5.100",
        port: 22,
        user: "rin",
      }
    );
  });

  const [knownVms, setKnownVms] = useState<KnownVm[]>(() => {
    return safeJsonParse<KnownVm[]>(localStorage.getItem("vmware.knownVms")) ?? [];
  });

  const [search, setSearch] = useState("");
  const [runningVmxPaths, setRunningVmxPaths] = useState<string[]>([]);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);

  const [globalError, setGlobalError] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionVmId, setActionVmId] = useState<string | null>(null);
  const [actionText, setActionText] = useState<string>("");

  const [stopModalVm, setStopModalVm] = useState<KnownVm | null>(null);
  const stopModalInitialFocusRef = useRef<HTMLButtonElement | null>(null);

  const [dirOutput, setDirOutput] = useState("");
  const [diagError, setDiagError] = useState("");
  const [isDiagRunning, setIsDiagRunning] = useState(false);
  const [diagCommand, setDiagCommand] = useState<string>(() => {
    return (
      safeJsonParse<string>(localStorage.getItem("diag.command")) ??
      '& "C:\\Program Files (x86)\\VMware\\VMware Workstation\\vmrun.exe" -T ws list'
    );
  });

  useEffect(() => {
    localStorage.setItem("vmware.ssh", JSON.stringify(ssh));
  }, [ssh]);

  useEffect(() => {
    localStorage.setItem("vmware.knownVms", JSON.stringify(knownVms));
  }, [knownVms]);

  useEffect(() => {
    localStorage.setItem("diag.command", JSON.stringify(diagCommand));
  }, [diagCommand]);

  useEffect(() => {
    if (!stopModalVm) return;
    const t = window.setTimeout(() => stopModalInitialFocusRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [stopModalVm]);

  const runningSet = useMemo(() => {
    return new Set(runningVmxPaths.map((p) => p.toLowerCase()));
  }, [runningVmxPaths]);

  const filteredVms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return knownVms;
    return knownVms.filter((vm) => {
      return (
        vm.name.toLowerCase().includes(q) ||
        vm.vmxPath.toLowerCase().includes(q) ||
        vm.id.toLowerCase().includes(q)
      );
    });
  }, [knownVms, search]);

  const unknownRunning = useMemo(() => {
    const knownSet = new Set(knownVms.map((vm) => vm.vmxPath.toLowerCase()));
    return runningVmxPaths.filter((p) => !knownSet.has(p.toLowerCase()));
  }, [knownVms, runningVmxPaths]);

  async function refresh() {
    setIsRefreshing(true);
    setGlobalError("");
    try {
      const running = await invoke<string[]>("vmware_list_running", { ssh });
      setRunningVmxPaths(running);
      setLastRefreshAt(Date.now());
    } catch (err) {
      setGlobalError(String(err));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function refreshKeyStatus() {
    try {
      const ok = await invoke<boolean>("ssh_key_status");
      setSshKeyPresent(ok);
    } catch (err) {
      setSshKeyPresent(false);
      setSshKeyError(String(err));
    }
  }

  async function uploadSshKey(file: File) {
    setIsKeyWorking(true);
    setSshKeyError("");
    try {
      if (file.size > 256 * 1024) throw new Error("Key too large");
      const keyText = await file.text();
      await invoke<void>("ssh_set_private_key", { keyText });
      setSshKeyPresent(true);
      if (keyInputRef.current) keyInputRef.current.value = "";
    } catch (err) {
      setSshKeyError(String(err));
    } finally {
      setIsKeyWorking(false);
    }
  }

  async function clearSshKey() {
    setIsKeyWorking(true);
    setSshKeyError("");
    try {
      await invoke<void>("ssh_clear_private_key");
      setSshKeyPresent(false);
    } catch (err) {
      setSshKeyError(String(err));
    } finally {
      setIsKeyWorking(false);
    }
  }

  async function startVm(vm: KnownVm) {
    setActionVmId(vm.id);
    setActionText("正在启动…");
    setGlobalError("");
    try {
      await invoke<string>("vmware_start_vm", { ssh, vmxPath: vm.vmxPath });
      await refresh();
    } catch (err) {
      setGlobalError(String(err));
    } finally {
      setActionVmId(null);
      setActionText("");
    }
  }

  async function stopVm(vm: KnownVm, mode: VmStopMode) {
    setActionVmId(vm.id);
    setActionText(mode === "hard" ? "正在硬关机…" : "正在软关机…");
    setGlobalError("");
    try {
      await invoke<string>("vmware_stop_vm", { ssh, vmxPath: vm.vmxPath, mode });
      await refresh();
    } catch (err) {
      setGlobalError(String(err));
    } finally {
      setActionVmId(null);
      setActionText("");
    }
  }

  async function runDir() {
    setIsDiagRunning(true);
    setDirOutput("");
    setDiagError("");
    try {
      const output = await invoke<string>("ssh_dir", { ssh });
      setDirOutput(output);
    } catch (err) {
      setDiagError(String(err));
    } finally {
      setIsDiagRunning(false);
    }
  }

  async function runDiagCommand() {
    setIsDiagRunning(true);
    setDirOutput("");
    setDiagError("");
    try {
      const output = await invoke<string>("ssh_exec", { ssh, command: diagCommand });
      setDirOutput(output);
    } catch (err) {
      setDiagError(String(err));
    } finally {
      setIsDiagRunning(false);
    }
  }

  function addVm(form: HTMLFormElement) {
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const vmxPath = String(data.get("vmxPath") ?? "").trim();
    if (!vmxPath) return;
    const defaultName = vmxPath.split(/[\\/]/).pop()?.replace(/\.vmx$/i, "") || "VM";
    setKnownVms((prev) => [
      {
        id: newId(),
        name: name || defaultName,
        vmxPath,
      },
      ...prev,
    ]);
    form.reset();
  }

  function removeVm(id: string) {
    setKnownVms((prev) => prev.filter((v) => v.id !== id));
  }

  useEffect(() => {
    void refresh();
    void refreshKeyStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-6 pb-12 pt-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 tracking-tight">VM 控制台</h1>
          <p className={`mt-1.5 max-w-[70ch] ${mutedText}`}>
            通过 SSH 调用 VMware Workstation 的 vmrun，实现远程启停与状态查看。
          </p>
        </div>
        <nav
          className="flex flex-wrap gap-2 rounded-xl border border-slate-900/10 bg-white/70 p-1.5 dark:border-slate-400/20 dark:bg-white/5"
          aria-label="Sections"
        >
          <button
            type="button"
            className={`rounded-lg border border-transparent bg-transparent px-3 py-2 text-slate-700 shadow-none dark:text-slate-200/80 ${
              activeTab === "vm"
                ? "border-slate-900/10 bg-white text-slate-950 dark:border-slate-400/20 dark:bg-white/10 dark:text-white"
                : ""
            }`}
            onClick={() => setActiveTab("vm")}
          >
            虚拟机
          </button>
          <button
            type="button"
            className={`rounded-lg border border-transparent bg-transparent px-3 py-2 text-slate-700 shadow-none dark:text-slate-200/80 ${
              activeTab === "diag"
                ? "border-slate-900/10 bg-white text-slate-950 dark:border-slate-400/20 dark:bg-white/10 dark:text-white"
                : ""
            }`}
            onClick={() => setActiveTab("diag")}
          >
            诊断
          </button>
        </nav>
      </header>

      {globalError ? (
        <section
          className="rounded-2xl border border-red-500/35 bg-red-100/80 px-3.5 py-3 text-red-900 dark:bg-red-950/25 dark:text-red-100/90"
          role="alert"
        >
          <strong>操作失败：</strong> {globalError}
        </section>
      ) : null}

      {activeTab === "vm" ? (
        <>
          <section className="grid gap-4 grid-cols-[1.1fr_0.9fr] max-[920px]:grid-cols-1">
            <div className="max-w-full rounded-2xl border border-slate-900/10 bg-white/85 p-4 backdrop-blur dark:border-slate-400/20 dark:bg-white/5">
              <div>
                <h2 className="m-0 text-[1.05rem]">连接设置</h2>
                <p className={`mt-1.5 ${mutedText}`}>用于连接运行 VMware 的主机（Windows OpenSSH）。</p>
              </div>
              <div className="mt-3 grid gap-3 grid-cols-[1.2fr_0.6fr_0.8fr] max-[920px]:grid-cols-1">
                <label className="flex flex-col gap-1.5">
                  <span className={fieldLabelText}>Host</span>
                  <input
                    className={`${controlBase} ${controlPlaceholder}`}
                    value={ssh.host}
                    onChange={(e) => setSsh((p) => ({ ...p, host: e.target.value }))}
                    placeholder="192.168.5.100"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={fieldLabelText}>Port</span>
                  <input
                    className={controlBase}
                    inputMode="numeric"
                    value={String(ssh.port)}
                    onChange={(e) =>
                      setSsh((p) => ({
                        ...p,
                        port: Math.max(1, Math.min(65535, Number(e.target.value) || 22)),
                      }))
                    }
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={fieldLabelText}>User</span>
                  <input
                    className={`${controlBase} ${controlPlaceholder}`}
                    value={ssh.user}
                    onChange={(e) => setSsh((p) => ({ ...p, user: e.target.value }))}
                    placeholder="rin"
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  className={`${buttonBase} ${buttonPrimary}`}
                  onClick={refresh}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "刷新中…" : "刷新状态"}
                </button>
                <div className={`inline-flex max-w-full select-none flex-wrap items-center gap-2 ${mutedText}`}>
                  <span>
                    运行中：<strong>{runningVmxPaths.length}</strong>
                  </span>
                  <span className="opacity-60" aria-hidden="true">
                    ·
                  </span>
                  <span>
                    已配置：<strong>{knownVms.length}</strong>
                  </span>
                  {lastRefreshAt ? (
                    <>
                      <span className="opacity-60" aria-hidden="true">
                        ·
                      </span>
                      <span className={mutedText}>更新于 {new Date(lastRefreshAt).toLocaleTimeString()}</span>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-3">
                <div className="mt-0 flex flex-wrap items-center justify-between gap-3">
                  <span
                    className={`${pillBase} ${
                      sshKeyPresent
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                        : "border-slate-400/60 bg-slate-400/15 text-slate-800 dark:text-slate-200/85"
                    }`}
                  >
                    SSH key: {sshKeyPresent ? "configured" : "missing"}
                  </span>
                  <div className="inline-flex flex-wrap justify-end gap-2">
                    <input
                      ref={keyInputRef}
                      type="file"
                      className={controlBase}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadSshKey(file);
                      }}
                      disabled={isKeyWorking}
                    />
                    {sshKeyPresent ? (
                      <button
                        type="button"
                        className={buttonBase}
                        onClick={() => void clearSshKey()}
                        disabled={isKeyWorking}
                      >
                        Clear key
                      </button>
                    ) : null}
                  </div>
                </div>
                {sshKeyError ? (
                  <p className="font-semibold text-red-700 dark:text-red-200">{sshKeyError}</p>
                ) : null}
                <p className={`m-0 ${mutedText}`}>
                  Private key is stored locally in the app data directory (not bundled in the app).
                </p>
              </div>
            </div>

            <div className="max-w-full rounded-2xl border border-slate-900/10 bg-white/85 p-4 backdrop-blur dark:border-slate-400/20 dark:bg-white/5">
              <div>
                <h2 className="m-0 text-[1.05rem]">添加虚拟机</h2>
                <p className={`mt-1.5 ${mutedText}`}>填写 VMX 路径即可控制启停（路径在远程 Windows 主机上）。</p>
              </div>
              <form
                className="mt-3 flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  addVm(e.currentTarget);
                }}
              >
                <label className="flex flex-col gap-1.5">
                  <span className={fieldLabelText}>名称（可选）</span>
                  <input
                    className={`${controlBase} ${controlPlaceholder}`}
                    name="name"
                    placeholder="例如：Ubuntu Server"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={fieldLabelText}>VMX 路径</span>
                  <input
                    className={`${controlBase} ${controlPlaceholder}`}
                    name="vmxPath"
                    placeholder="C:\\VMs\\Ubuntu\\Ubuntu.vmx"
                    required
                  />
                </label>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <button type="submit" className={`${buttonBase} ${buttonPrimary}`}>
                    添加
                  </button>
                </div>
              </form>
            </div>
          </section>

          <section className="max-w-full rounded-2xl border border-slate-900/10 bg-white/85 p-4 backdrop-blur dark:border-slate-400/20 dark:bg-white/5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="m-0 text-[1.05rem]">虚拟机列表</h2>
                <p className={`mt-1.5 ${mutedText}`}>开始/停止按钮会在执行期间锁定，避免重复操作。</p>
              </div>
              <div className="w-full max-w-[260px] max-[920px]:max-w-none">
                <input
                  className={`${controlBase} ${controlPlaceholder} w-full`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索名称或路径…"
                />
              </div>
            </div>

            {filteredVms.length ? (
              <ul className="mt-3 flex list-none flex-col gap-2.5 p-0" aria-label="Virtual machines">
                {filteredVms.map((vm) => {
                  const isRunning = runningSet.has(vm.vmxPath.toLowerCase());
                  const isBusy = actionVmId === vm.id;
                  return (
                    <li
                      key={vm.id}
                      className="flex max-w-full items-center justify-between gap-3 rounded-2xl border border-slate-900/10 bg-white/70 p-3 dark:border-slate-400/20 dark:bg-white/5 max-[920px]:flex-wrap"
                    >
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="overflow-hidden text-ellipsis whitespace-nowrap font-bold">{vm.name}</span>
                          <span
                            className={`${pillBase} ${
                              isRunning
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                                : "border-slate-400/60 bg-slate-400/15 text-slate-800 dark:text-slate-200/85"
                            }`}
                          >
                            {isRunning ? "运行中" : "已停止"}
                          </span>
                        </div>
                        <div
                          className={`min-w-0 max-w-[72ch] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-sm ${mutedText}`}
                          title={vm.vmxPath}
                        >
                          {vm.vmxPath}
                        </div>
                      </div>
                      <div className="flex max-w-full flex-none items-center gap-2 max-[920px]:w-full max-[920px]:justify-end">
                        {isBusy ? <span className={`pr-1.5 text-sm ${mutedText}`}>{actionText}</span> : null}
                        {isRunning ? (
                          <button
                            type="button"
                            className={`${buttonBase} ${buttonDanger}`}
                            onClick={() => setStopModalVm(vm)}
                            disabled={isRefreshing || isBusy}
                          >
                            停止
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={`${buttonBase} ${buttonPrimary}`}
                            onClick={() => void startVm(vm)}
                            disabled={isRefreshing || isBusy}
                          >
                            启动
                          </button>
                        )}
                        <button
                          type="button"
                          className={buttonBase}
                          onClick={() => removeVm(vm.id)}
                          disabled={isRefreshing || isBusy}
                        >
                          移除
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="pb-1.5 pt-4">
                <p className={mutedText}>还没有添加虚拟机。先在上方填入 VMX 路径。</p>
              </div>
            )}

            {unknownRunning.length ? (
              <div className="mt-3.5 border-t border-slate-900/10 pt-3 dark:border-slate-400/20">
                <h3 className="m-0 text-sm font-semibold">其他运行中的 VM</h3>
                <ul className="mt-2.5 list-disc pl-5">
                  {unknownRunning.map((p) => (
                    <li key={p}>
                      <code className="break-all">{p}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {stopModalVm ? (
            <div
              className="fixed inset-0 grid place-items-center bg-slate-950/50 p-4"
              role="dialog"
              aria-modal="true"
              aria-label="Stop virtual machine"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setStopModalVm(null);
              }}
            >
              <div className="w-full max-w-[640px] rounded-2xl border border-slate-900/15 bg-white/95 p-4 shadow-2xl dark:border-slate-400/20 dark:bg-slate-900/80">
                <h3 className="mb-2 mt-0">停止虚拟机</h3>
                <p className={mutedText}>
                  目标：<strong>{stopModalVm.name}</strong>
                </p>
                <p
                  className={`max-w-full whitespace-normal break-words overflow-visible text-clip font-mono text-sm ${mutedText}`}
                >
                  {stopModalVm.vmxPath}
                </p>
                <div className="mt-3.5 flex flex-wrap justify-end gap-2.5">
                  <button
                    ref={stopModalInitialFocusRef}
                    type="button"
                    className={`${buttonBase} ${buttonDanger}`}
                    onClick={() => {
                      const vm = stopModalVm;
                      setStopModalVm(null);
                      void stopVm(vm, "soft");
                    }}
                  >
                    软关机（推荐）
                  </button>
                  <button
                    type="button"
                    className={`${buttonBase} ${buttonDangerOutline}`}
                    onClick={() => {
                      const vm = stopModalVm;
                      setStopModalVm(null);
                      void stopVm(vm, "hard");
                    }}
                  >
                    硬关机
                  </button>
                  <button type="button" className={buttonBase} onClick={() => setStopModalVm(null)}>
                    取消
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <section className="max-w-full rounded-2xl border border-slate-900/10 bg-white/85 p-4 backdrop-blur dark:border-slate-400/20 dark:bg-white/5">
          <div>
            <h2 className="m-0 text-[1.05rem]">SSH 诊断</h2>
            <p className={`mt-1.5 ${mutedText}`}>用于验证 SSH 通路与远程命令执行是否正常（使用上方连接设置）。</p>
          </div>

          <div className="mt-3 flex flex-wrap gap-2.5">
            <button
              type="button"
              className={buttonBase}
              onClick={() =>
                setDiagCommand('& "C:\\Program Files (x86)\\VMware\\VMware Workstation\\vmrun.exe" -T ws list')
              }
              disabled={isDiagRunning}
            >
              填入 vmrun list
            </button>
            <button type="button" className={buttonBase} onClick={() => setDiagCommand("dir")} disabled={isDiagRunning}>
              填入 dir
            </button>
          </div>

          <label className="mt-3 flex w-full flex-col gap-1.5">
            <span className={fieldLabelText}>远程命令</span>
            <textarea
              className={`${controlBase} ${controlPlaceholder} w-full resize-y font-mono leading-snug`}
              value={diagCommand}
              onChange={(e) => setDiagCommand(e.target.value)}
              rows={3}
              placeholder='例如：powershell -NoProfile -Command "Get-Date"'
            />
          </label>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              className={`${buttonBase} ${buttonPrimary}`}
              onClick={runDiagCommand}
              disabled={isDiagRunning}
            >
              {isDiagRunning ? "执行中…" : "执行命令"}
            </button>
            <button type="button" className={buttonBase} onClick={runDir} disabled={isDiagRunning}>
              {isDiagRunning ? "执行中…" : "Run dir (legacy)"}{" "}
            </button>
          </div>
          {diagError ? <p className="font-semibold text-red-700 dark:text-red-200">{diagError}</p> : null}
          <pre
            className={`mt-3 w-full max-w-full whitespace-pre-wrap break-words rounded-xl border border-slate-900/10 bg-white/80 p-3 text-slate-950 dark:border-slate-400/20 dark:bg-white/5 dark:text-slate-200 min-h-[220px] overflow-auto`}
          >
            {dirOutput || "Waiting for output..."}
          </pre>
        </section>
      )}
    </main>
  );
}

export default App;
