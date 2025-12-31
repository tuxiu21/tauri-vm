import { useMemo, useRef, useState } from "react";
import type { SshConfig } from "../app/types";
import { ui } from "../components/ui";

export function SettingsPage(props: {
  ssh: SshConfig;
  onChangeSsh: (next: SshConfig) => void;
  sshKeyPresent: boolean | null;
  sshKeyError: string;
  isKeyWorking: boolean;
  onUploadKeyText: (keyText: string) => void;
  onClearKey: () => void;
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
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [newRoot, setNewRoot] = useState("");
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
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-900/10 bg-white/60 px-3 py-2 dark:border-slate-400/20 dark:bg-white/5"
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

        <pre className="mt-3 min-h-[220px] w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-slate-900/10 bg-white/60 p-3 text-sm dark:border-slate-400/20 dark:bg-white/5">
          {props.diagOutput || "等待输出…"}
        </pre>
      </details>
    </div>
  );
}

