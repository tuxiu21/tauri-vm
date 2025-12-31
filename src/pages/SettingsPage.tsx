import { useMemo, useRef, useState } from "react";
import type { SshConfig } from "../app/types";
import { ui } from "../components/ui";
import type { LogEvent } from "../app/log";
import type { TraceEntry } from "../app/tauri";

export function SettingsPage(props: {
  ssh: SshConfig;
  onChangeSsh: (next: SshConfig) => void;
  sshKeyPresent: boolean | null;
  sshKeyError: string;
  isKeyWorking: boolean;
  onUploadKeyText: (keyText: string) => void;
  onClearKey: () => void;
  vmPassword: string;
  onChangeVmPassword: (next: string) => void;
  scanRoots: string[];
  onSetScanRoots: (roots: string[]) => void;
  diagCommand: string;
  onSetDiagCommand: (cmd: string) => void;
  isDiagRunning: boolean;
  diagError: string;
  diagOutput: string;
  onRunDiag: () => void;
  onTestConnection: () => void;
  onBack: () => void;
  opLog: LogEvent[];
  onClearOpLog: () => void;
  traces: TraceEntry[];
  isTracesLoading: boolean;
  onRefreshTraces: () => void;
  onClearTraces: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [newRoot, setNewRoot] = useState("");
  const [logFilter, setLogFilter] = useState<"all" | "success" | "error">("all");
  const defaultRoots = useMemo(
    () => ["$env:USERPROFILE\\Documents\\Virtual Machines", "$env:PUBLIC\\Documents\\Shared Virtual Machines"],
    [],
  );

  function addRoot(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    const next = [...props.scanRoots, trimmed].filter((v, idx, arr) => arr.indexOf(v) === idx);
    props.onSetScanRoots(next);
    setNewRoot("");
  }

  async function readKeyFile(file: File) {
    const text = await file.text();
    props.onUploadKeyText(text);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const filteredLog = useMemo(() => {
    if (logFilter === "all") return props.opLog;
    return props.opLog.filter((e) => e.status === logFilter);
  }, [logFilter, props.opLog]);

  const traceMap = useMemo(() => {
    const map = new Map<string, TraceEntry>();
    for (const trace of props.traces) {
      if (trace.requestId) map.set(trace.requestId, trace);
    }
    return map;
  }, [props.traces]);

  function copyEvent(event: LogEvent) {
    return navigator.clipboard.writeText(JSON.stringify(event, null, 2));
  }

  return (
    <div className="flex flex-col gap-4">
      <section className={`p-4 ${ui.card}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className={ui.h2}>设置</h2>
            <p className={`mt-1.5 ${ui.muted}`}>把复杂项收在这里。日常操作回到控制台。</p>
          </div>
          <button type="button" className={ui.button} onClick={props.onBack}>
            返回控制台
          </button>
        </div>
      </section>

      <section className={`p-4 ${ui.card}`}>
        <div className={ui.cardHeader}>
          <div>
            <h2 className={ui.h2}>连接设置</h2>
            <p className={`mt-1.5 ${ui.muted}`}>固定 Windows + VMware Workstation 主机。</p>
          </div>
          <button type="button" className={`${ui.button} ${ui.buttonPrimary}`} onClick={props.onTestConnection}>
            测试连接
          </button>
        </div>
        <div className="mt-3 grid gap-3 grid-cols-[1.2fr_0.6fr_0.8fr] max-[920px]:grid-cols-1">
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Host</span>
            <input
              className={`${ui.input} ${ui.inputPlaceholder}`}
              value={props.ssh.host}
              onChange={(e) => props.onChangeSsh({ ...props.ssh, host: e.target.value })}
              placeholder="192.168.5.100"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Port</span>
            <input
              className={ui.input}
              type="number"
              inputMode="numeric"
              min={1}
              max={65535}
              step={1}
              value={String(props.ssh.port)}
              onChange={(e) =>
                props.onChangeSsh({
                  ...props.ssh,
                  port: Math.max(1, Math.min(65535, Number(e.target.value) || 22)),
                })
              }
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>User</span>
            <input
              className={`${ui.input} ${ui.inputPlaceholder}`}
              value={props.ssh.user}
              onChange={(e) => props.onChangeSsh({ ...props.ssh, user: e.target.value })}
              placeholder="rin"
            />
          </label>
        </div>
        <div className="mt-3 grid gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>VM Password (optional)</span>
            <input
              className={`${ui.input} ${ui.inputPlaceholder}`}
              type="password"
              value={props.vmPassword}
              onChange={(e) => props.onChangeVmPassword(e.target.value)}
              placeholder="Only kept in memory"
              autoComplete="off"
            />
          </label>
          <p className={`m-0 text-sm ${ui.muted}`}>仅用于受保护/需要密码的 VM，不会保存到本地。</p>
        </div>
      </section>

      <section className={`p-4 ${ui.card}`}>
        <div className={ui.cardHeader}>
          <div>
            <h2 className={ui.h2}>SSH 私钥</h2>
            <p className={`mt-1.5 ${ui.muted}`}>私钥仅保存在本机应用数据目录，不会打包进应用。</p>
          </div>
          <span className={ui.pill}>
            状态：{props.sshKeyPresent ? "已配置" : props.sshKeyPresent === false ? "缺失" : "检查中"}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pem,.key,.ppk"
            className={ui.input}
            disabled={props.isKeyWorking}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readKeyFile(file);
            }}
          />
          <button type="button" className={ui.button} onClick={props.onClearKey} disabled={props.isKeyWorking}>
            清除私钥
          </button>
        </div>
        {props.sshKeyError ? (
          <p className="m-0 mt-2 font-semibold text-rose-700 dark:text-rose-200">{props.sshKeyError}</p>
        ) : null}
      </section>

      <section className={`p-4 ${ui.card}`}>
        <div className={ui.cardHeader}>
          <div>
            <h2 className={ui.h2}>扫描目录</h2>
            <p className={`mt-1.5 ${ui.muted}`}>用于扫描远端主机上的 VMX 文件（支持环境变量写法）。</p>
          </div>
          <button type="button" className={ui.button} onClick={() => props.onSetScanRoots(defaultRoots)} title="恢复默认">
            恢复默认
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {props.scanRoots.length ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {props.scanRoots.map((root) => (
                <li
                  key={root}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-900/10 bg-white/60 px-3 py-2 dark:border-slate-700/60 dark:bg-slate-900/60"
                >
                  <code className="break-all text-sm">{root}</code>
                  <button
                    type="button"
                    className={ui.button}
                    onClick={() => props.onSetScanRoots(props.scanRoots.filter((r) => r !== root))}
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={`m-0 ${ui.muted}`}>尚未配置扫描目录。</p>
          )}

          <div className="mt-1 flex flex-wrap gap-2">
            <input
              className={`${ui.input} ${ui.inputPlaceholder} min-w-[280px] flex-1`}
              value={newRoot}
              onChange={(e) => setNewRoot(e.target.value)}
              placeholder="例如：D:\\VMs 或 $env:USERPROFILE\\VMs"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                addRoot(newRoot);
              }}
            />
            <button type="button" className={`${ui.button} ${ui.buttonPrimary}`} onClick={() => addRoot(newRoot)}>
              添加目录
            </button>
          </div>
        </div>
      </section>

      <details className={`${ui.card} p-4`} open={false}>
        <summary className="cursor-pointer select-none text-[1.05rem] font-semibold">高级诊断</summary>
        <p className={`mt-1.5 ${ui.muted}`}>需要时再用。用于验证 SSH 通路与远程命令执行。</p>

        <label className="mt-3 flex w-full flex-col gap-1.5">
          <span className={ui.label}>远程命令</span>
          <textarea
            className={`${ui.input} ${ui.inputPlaceholder} w-full resize-y font-mono leading-snug`}
            value={props.diagCommand}
            onChange={(e) => props.onSetDiagCommand(e.target.value)}
            rows={3}
            placeholder='例如：powershell -NoProfile -Command "Get-Date"'
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className={`${ui.button} ${ui.buttonPrimary}`}
            onClick={props.onRunDiag}
            disabled={props.isDiagRunning}
          >
            {props.isDiagRunning ? "执行中…" : "执行命令"}
          </button>
          {props.diagError ? <p className="m-0 font-semibold text-rose-700 dark:text-rose-200">{props.diagError}</p> : null}
        </div>

        <pre className="mt-3 min-h-[220px] w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-slate-900/10 bg-white/60 p-3 text-sm dark:border-slate-700/60 dark:bg-slate-900/60">
          {props.diagOutput || "等待输出…"}
        </pre>
      </details>

      <section className={`p-4 ${ui.card}`}>
        <div className={ui.cardHeader}>
          <div>
            <h2 className={ui.h2}>操作日志</h2>
            <p className={`mt-1.5 ${ui.muted}`}>
              记录按钮触发的操作，可展开查看原始命令与执行结果（不记录私钥内容）。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`${ui.button} ${logFilter === "all" ? ui.buttonPrimary : ""}`}
              onClick={() => setLogFilter("all")}
            >
              全部
            </button>
            <button
              type="button"
              className={`${ui.button} ${logFilter === "success" ? ui.buttonPrimary : ""}`}
              onClick={() => setLogFilter("success")}
            >
              成功
            </button>
            <button
              type="button"
              className={`${ui.button} ${logFilter === "error" ? ui.buttonPrimary : ""}`}
              onClick={() => setLogFilter("error")}
            >
              失败
            </button>
            <button
              type="button"
              className={`${ui.button} ${ui.buttonPrimary}`}
              onClick={props.onRefreshTraces}
              disabled={props.isTracesLoading}
            >
              {props.isTracesLoading ? "刷新中…" : "刷新"}
            </button>
            <button
              type="button"
              className={ui.button}
              onClick={() => {
                props.onClearOpLog();
                props.onClearTraces();
              }}
              disabled={!props.opLog.length && !props.traces.length}
            >
              清空
            </button>
          </div>
        </div>

        {filteredLog.length ? (
          <ul className="mt-3 flex max-h-[420px] list-none flex-col gap-2 overflow-auto p-0">
            {filteredLog.map((e) => (
              <li
                key={e.id}
                className={`rounded-2xl border px-3 py-2 ${
                  e.status === "error"
                    ? "border-rose-500/35 bg-rose-500/10 text-rose-950 dark:text-rose-100"
                    : "border-slate-900/10 bg-white/60 text-slate-950 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-white"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="m-0 font-semibold">
                      {e.action}
                      <span className={`ml-2 text-sm ${ui.muted}`}>
                        {new Date(e.at).toLocaleString()}
                        {typeof e.durationMs === "number" ? ` · ${e.durationMs}ms` : ""}
                      </span>
                    </p>
                    {e.summary ? <p className={`m-0 mt-1 text-sm ${ui.muted}`}>{e.summary}</p> : null}
                    {e.error ? <p className="m-0 mt-1 break-words text-sm opacity-90">{e.error}</p> : null}
                  </div>
                  <button type="button" className={ui.button} onClick={() => void copyEvent(e)}>
                    复制
                  </button>
                </div>

                <details className="mt-2">
                  <summary className={`cursor-pointer select-none text-sm ${ui.muted}`}>查看详情</summary>
                  <div className="mt-2 grid gap-2">
                    {e.meta ? (
                      <div className="rounded-2xl border border-slate-900/10 bg-white/70 p-3 dark:border-slate-700/60 dark:bg-slate-900/60">
                        <p className="m-0 text-sm font-semibold">Meta</p>
                        <pre className={`m-0 mt-1 whitespace-pre-wrap break-words font-mono text-sm ${ui.muted}`}>
                          {JSON.stringify(e.meta, null, 2)}
                        </pre>
                      </div>
                    ) : null}

                    {e.requestId && traceMap.has(e.requestId) ? (
                      <>
                        <div className="rounded-2xl border border-slate-900/10 bg-white/70 p-3 dark:border-slate-700/60 dark:bg-slate-900/60">
                          <p className="m-0 text-sm font-semibold">Command</p>
                          <pre className={`m-0 mt-1 whitespace-pre-wrap break-words font-mono text-sm ${ui.muted}`}>
                            {traceMap.get(e.requestId)?.command}
                          </pre>
                        </div>
                        <div className="rounded-2xl border border-slate-900/10 bg-white/70 p-3 dark:border-slate-700/60 dark:bg-slate-900/60">
                          <p className="m-0 text-sm font-semibold">Output</p>
                          <pre className={`m-0 mt-1 whitespace-pre-wrap break-words font-mono text-sm ${ui.muted}`}>
                            {traceMap.get(e.requestId)?.output || "(empty)"}
                          </pre>
                        </div>
                      </>
                    ) : (
                      <p className={`m-0 text-sm ${ui.muted}`}>暂无命令追踪数据。</p>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`m-0 mt-3 ${ui.muted}`}>暂无记录。</p>
        )}
      </section>
    </div>
  );
}
