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

function App() {
  const [activeTab, setActiveTab] = useState<"vm" | "diag">("vm");

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
      const output = await invoke<string>("ssh_dir");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="container">
      <header className="header">
        <div>
          <h1 className="title">VM 控制台</h1>
          <p className="subtitle">通过 SSH 调用 VMware Workstation 的 vmrun，实现远程启停与状态查看。</p>
        </div>
        <nav className="tabs" aria-label="Sections">
          <button
            type="button"
            className={`tab ${activeTab === "vm" ? "active" : ""}`}
            onClick={() => setActiveTab("vm")}
          >
            虚拟机
          </button>
          <button
            type="button"
            className={`tab ${activeTab === "diag" ? "active" : ""}`}
            onClick={() => setActiveTab("diag")}
          >
            诊断
          </button>
        </nav>
      </header>

      {globalError ? (
        <section className="alert" role="alert">
          <strong>操作失败：</strong> {globalError}
        </section>
      ) : null}

      {activeTab === "vm" ? (
        <>
          <section className="grid">
            <div className="card">
              <div className="cardHeader">
                <h2>连接设置</h2>
                <p className="muted">用于连接运行 VMware 的主机（Windows OpenSSH）。</p>
              </div>
              <div className="formRow">
                <label className="field">
                  <span>Host</span>
                  <input
                    value={ssh.host}
                    onChange={(e) => setSsh((p) => ({ ...p, host: e.target.value }))}
                    placeholder="192.168.5.100"
                  />
                </label>
                <label className="field">
                  <span>Port</span>
                  <input
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
                <label className="field">
                  <span>User</span>
                  <input
                    value={ssh.user}
                    onChange={(e) => setSsh((p) => ({ ...p, user: e.target.value }))}
                    placeholder="rin"
                  />
                </label>
              </div>
              <div className="actionsRow">
                <button type="button" className="primary" onClick={refresh} disabled={isRefreshing}>
                  {isRefreshing ? "刷新中…" : "刷新状态"}
                </button>
                <div className="meta">
                  <span>
                    运行中：<strong>{runningVmxPaths.length}</strong>
                  </span>
                  <span className="dot" aria-hidden="true">
                    ·
                  </span>
                  <span>
                    已配置：<strong>{knownVms.length}</strong>
                  </span>
                  {lastRefreshAt ? (
                    <>
                      <span className="dot" aria-hidden="true">
                        ·
                      </span>
                      <span className="muted">更新于 {new Date(lastRefreshAt).toLocaleTimeString()}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="cardHeader">
                <h2>添加虚拟机</h2>
                <p className="muted">填写 VMX 路径即可控制启停（路径在远程 Windows 主机上）。</p>
              </div>
              <form
                className="formStack"
                onSubmit={(e) => {
                  e.preventDefault();
                  addVm(e.currentTarget);
                }}
              >
                <label className="field">
                  <span>名称（可选）</span>
                  <input name="name" placeholder="例如：Ubuntu Server" />
                </label>
                <label className="field">
                  <span>VMX 路径</span>
                  <input name="vmxPath" placeholder="C:\\VMs\\Ubuntu\\Ubuntu.vmx" required />
                </label>
                <div className="actionsRow">
                  <button type="submit" className="primary">
                    添加
                  </button>
                </div>
              </form>
            </div>
          </section>

          <section className="card">
            <div className="cardHeader cardHeaderRow">
              <div>
                <h2>虚拟机列表</h2>
                <p className="muted">开始/停止按钮会在执行期间锁定，避免重复操作。</p>
              </div>
              <div className="toolbar">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索名称或路径…" />
              </div>
            </div>

            {filteredVms.length ? (
              <ul className="vmList" aria-label="Virtual machines">
                {filteredVms.map((vm) => {
                  const isRunning = runningSet.has(vm.vmxPath.toLowerCase());
                  const isBusy = actionVmId === vm.id;
                  return (
                    <li key={vm.id} className="vmRow">
                      <div className="vmMain">
                        <div className="vmTitleRow">
                          <span className="vmName">{vm.name}</span>
                          <span className={`pill ${isRunning ? "ok" : "idle"}`}>
                            {isRunning ? "运行中" : "已停止"}
                          </span>
                        </div>
                        <div className="vmPath" title={vm.vmxPath}>
                          {vm.vmxPath}
                        </div>
                      </div>
                      <div className="vmActions">
                        {isBusy ? <span className="busy">{actionText}</span> : null}
                        {isRunning ? (
                          <button
                            type="button"
                            className="danger"
                            onClick={() => setStopModalVm(vm)}
                            disabled={isRefreshing || isBusy}
                          >
                            停止
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="primary"
                            onClick={() => void startVm(vm)}
                            disabled={isRefreshing || isBusy}
                          >
                            启动
                          </button>
                        )}
                        <button type="button" onClick={() => removeVm(vm.id)} disabled={isRefreshing || isBusy}>
                          移除
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="empty">
                <p className="muted">还没有添加虚拟机。先在上方填入 VMX 路径。</p>
              </div>
            )}

            {unknownRunning.length ? (
              <div className="unknown">
                <h3>其他运行中的 VM</h3>
                <ul className="unknownList">
                  {unknownRunning.map((p) => (
                    <li key={p}>
                      <code>{p}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {stopModalVm ? (
            <div
              className="modalOverlay"
              role="dialog"
              aria-modal="true"
              aria-label="Stop virtual machine"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setStopModalVm(null);
              }}
            >
              <div className="modal">
                <h3>停止虚拟机</h3>
                <p className="muted">
                  目标：<strong>{stopModalVm.name}</strong>
                </p>
                <p className="vmPath">{stopModalVm.vmxPath}</p>
                <div className="modalActions">
                  <button
                    ref={stopModalInitialFocusRef}
                    type="button"
                    className="danger"
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
                    className="dangerOutline"
                    onClick={() => {
                      const vm = stopModalVm;
                      setStopModalVm(null);
                      void stopVm(vm, "hard");
                    }}
                  >
                    硬关机
                  </button>
                  <button type="button" onClick={() => setStopModalVm(null)}>
                    取消
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <section className="card">
          <div className="cardHeader">
            <h2>SSH 诊断</h2>
            <p className="muted">用于验证 SSH 通路与远程命令执行是否正常（使用上方连接设置）。</p>
          </div>

          <div className="diagPresets">
            <button
              type="button"
              onClick={() =>
                setDiagCommand('& "C:\\Program Files (x86)\\VMware\\VMware Workstation\\vmrun.exe" -T ws list')
              }
              disabled={isDiagRunning}
            >
              填入 vmrun list
            </button>
            <button type="button" onClick={() => setDiagCommand("dir")} disabled={isDiagRunning}>
              填入 dir
            </button>
          </div>

          <label className="field" style={{ width: "100%" }}>
            <span>远程命令</span>
            <textarea
              className="commandInput"
              value={diagCommand}
              onChange={(e) => setDiagCommand(e.target.value)}
              rows={3}
              placeholder='例如：powershell -NoProfile -Command "Get-Date"'
            />
          </label>

          <div className="actionsRow">
            <button type="button" className="primary" onClick={runDiagCommand} disabled={isDiagRunning}>
              {isDiagRunning ? "执行中…" : "执行命令"}
            </button>
            <button type="button" onClick={runDir} disabled={isDiagRunning}>
              {isDiagRunning ? "执行中…" : "Run dir (legacy)"}{" "}
            </button>
          </div>
          {diagError ? <p className="error">{diagError}</p> : null}
          <pre className="output">{dirOutput || "Waiting for output..."}</pre>
        </section>
      )}
    </main>
  );
}

export default App;
