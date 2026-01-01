import { useMemo, useState } from "react";
import type { KnownVm, SshConfig } from "../app/types";
import { guessVmNameFromVmxPath } from "../app/vmName";
import { ui } from "../components/ui";
import { Modal } from "../components/Modal";

type ConsoleVm = KnownVm & {
  isRunning: boolean;
  isBusy: boolean;
  busyText?: string;
  displayName: string;
};

function copyText(text: string) {
  return navigator.clipboard.writeText(text);
}

export function ConsolePage(props: {
  ssh: SshConfig;
  sshKeyPresent: boolean | null;
  knownVms: KnownVm[];
  runningVmxPaths: string[];
  vmPasswordStatusByVmxPath: Record<string, boolean | null>;
  lastRefreshAt: number | null;
  globalError: string;
  isRefreshing: boolean;
  actionVmId: string | null;
  actionText: string;
  unknownRunning: string[];
  onRefresh: () => void;
  onNavigateSettings: () => void;
  onStartVm: (vm: KnownVm) => void;
  onStopVm: (vm: KnownVm, mode: "soft" | "hard") => void;
  onEditVmPassword: (vm: KnownVm) => void;
  onRemoveVm: (id: string) => void;
  onPinVm: (id: string, pinned: boolean) => void;
  onOpenScanWizard: () => void;
  onAddVmByPath: (vmxPath: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [stopConfirmVm, setStopConfirmVm] = useState<ConsoleVm | null>(null);
  const [addPath, setAddPath] = useState("");
  const [filter, setFilter] = useState<"all" | "running" | "stopped" | "unknown">("all");

  const runningSet = useMemo(
    () => new Set(props.runningVmxPaths.map((p) => p.toLowerCase())),
    [props.runningVmxPaths],
  );

  const vms = useMemo<ConsoleVm[]>(() => {
    return props.knownVms
      .map((vm) => {
        const isRunning = runningSet.has(vm.vmxPath.toLowerCase());
        const displayName = (vm.nameOverride?.trim() || guessVmNameFromVmxPath(vm.vmxPath)).trim();
        return {
          ...vm,
          isRunning,
          isBusy: props.actionVmId === vm.id || props.isRefreshing,
          busyText: props.actionVmId === vm.id ? props.actionText : undefined,
          displayName,
        };
      })
      .sort((a, b) => {
        const ap = a.pinned ? 1 : 0;
        const bp = b.pinned ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return a.displayName.localeCompare(b.displayName, "zh");
      });
  }, [props.actionText, props.actionVmId, props.isRefreshing, props.knownVms, runningSet]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base =
      filter === "all"
        ? vms
        : filter === "running"
          ? vms.filter((v) => v.isRunning)
          : filter === "stopped"
            ? vms.filter((v) => !v.isRunning)
            : [];

    const list = q
      ? base.filter((vm) => vm.displayName.toLowerCase().includes(q) || vm.vmxPath.toLowerCase().includes(q))
      : base;

    if (filter === "unknown") return [];
    return list;
  }, [filter, search, vms]);

  const connectionHealthy = props.globalError === "" && props.lastRefreshAt != null;
  const needsSetup = props.sshKeyPresent === false || !connectionHealthy;

  return (
    <div className="flex flex-col gap-4">
      <section className={`relative overflow-hidden p-5 ${ui.cardStrong}`}>
        <div className="absolute -right-28 -top-28 h-64 w-64 rounded-full bg-gradient-to-br from-indigo-500/30 via-fuchsia-500/20 to-sky-500/20 blur-2xl dark:opacity-60" />
        <div className="absolute -left-28 -bottom-28 h-64 w-64 rounded-full bg-gradient-to-br from-sky-500/20 via-indigo-500/20 to-emerald-500/15 blur-2xl dark:opacity-60" />

        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className={ui.h1}>VM 控制台</h1>
              <p className={`mt-1.5 max-w-[70ch] ${ui.muted}`}>导入虚拟机，一键启动/停止。</p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                className={`${ui.button} ${ui.buttonPrimary}`}
                onClick={() => (needsSetup ? props.onNavigateSettings() : props.onOpenScanWizard())}
              >
                {needsSetup ? "去设置修复" : "扫描并导入"}
              </button>
              <button type="button" className={ui.button} onClick={props.onRefresh} disabled={props.isRefreshing}>
                {props.isRefreshing ? "刷新中…" : "刷新"}
              </button>
              <button type="button" className={ui.button} onClick={props.onNavigateSettings}>
                设置
              </button>
            </div>
          </div>

          <div className={`mt-4 flex flex-wrap items-center gap-2 ${ui.muted}`}>
            <span className={ui.pill}>
              连接：{connectionHealthy ? "已连接" : "未确认"}
              {props.lastRefreshAt ? (
                <span className="opacity-70"> · {new Date(props.lastRefreshAt).toLocaleTimeString()}</span>
              ) : null}
            </span>
            <span className={ui.pill}>
              SSH 私钥：
              {props.sshKeyPresent ? "已配置" : props.sshKeyPresent === false ? "缺失" : "检查中"}
            </span>
            <span className={ui.pill}>运行中：{props.runningVmxPaths.length}</span>
            <span className={ui.pill}>已导入：{props.knownVms.length}</span>
          </div>
        </div>
      </section>

      {props.globalError ? (
        <section
          className="rounded-2xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-rose-950 dark:text-rose-100"
          role="alert"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="m-0 font-semibold">操作失败</p>
              <p className="m-0 mt-1 break-words text-sm opacity-90">{props.globalError}</p>
            </div>
            <button type="button" className={ui.button} onClick={props.onNavigateSettings}>
              打开设置
            </button>
          </div>
        </section>
      ) : null}

      <section className={`p-4 ${ui.card}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className={ui.h2}>虚拟机</h2>
            <p className={`mt-1.5 ${ui.muted}`}>卡片右上角可置顶、复制路径或移除。</p>
          </div>

          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["all", "全部"],
                  ["running", "运行中"],
                  ["stopped", "已停止"],
                  ["unknown", `其他运行中 (${props.unknownRunning.length})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`${ui.button} ${filter === key ? ui.buttonPrimary : ""}`}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative w-full max-w-[320px]">
              <input
                type="search"
                className={`${ui.input} ${ui.inputPlaceholder} ${search ? "pr-16" : ""}`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索名称或路径…"
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  setSearch("");
                }}
              />
              {search ? (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border border-transparent px-2 py-1 text-sm text-slate-600 hover:bg-slate-900/5 hover:text-slate-950 dark:text-slate-200/70 dark:hover:bg-white/10 dark:hover:text-white"
                  onClick={() => setSearch("")}
                >
                  清除
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {filter === "unknown" ? (
          props.unknownRunning.length ? (
            <div className="mt-4 rounded-2xl border border-slate-900/10 bg-white/60 p-3 dark:border-slate-700/60 dark:bg-slate-900/60">
              <p className={`m-0 ${ui.muted}`}>这些虚拟机正在运行，但尚未导入到列表。</p>
              <ul className="mt-2.5 list-disc pl-5">
                {props.unknownRunning.map((p) => (
                  <li key={p} className="mt-1 break-words font-mono text-sm">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className={`m-0 mt-4 ${ui.muted}`}>没有发现其他运行中的 VM。</p>
          )
        ) : filtered.length ? (
          <ul className="mt-4 grid list-none grid-cols-2 gap-3 p-0 max-[920px]:grid-cols-1" aria-label="虚拟机列表">
            {filtered.map((vm) => (
              <li key={vm.id} className={`relative p-4 ${ui.cardStrong}`}>
                <div className="absolute right-3 top-3 flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-transparent px-2 py-1 text-sm opacity-70 hover:bg-slate-900/5 hover:opacity-100 dark:hover:bg-white/10"
                    onClick={() => props.onPinVm(vm.id, !vm.pinned)}
                    title={vm.pinned ? "取消置顶" : "置顶"}
                  >
                    {vm.pinned ? "已置顶" : "置顶"}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-transparent px-2 py-1 text-sm opacity-70 hover:bg-slate-900/5 hover:opacity-100 dark:hover:bg-white/10"
                    onClick={() => void copyText(vm.vmxPath)}
                    title="复制 VMX 路径"
                  >
                    复制路径
                  </button>
                </div>

                <div className="min-w-0 pr-28">
                  <p className="m-0 text-lg font-semibold">{vm.displayName}</p>
                  <p className={`m-0 mt-1 truncate font-mono text-sm ${ui.muted}`} title={vm.vmxPath}>
                    {vm.vmxPath}
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`${ui.pill} ${
                      vm.isRunning
                        ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                        : ""
                    }`}
                  >
                    {vm.isBusy ? "执行中…" : vm.isRunning ? "运行中" : "已停止"}
                  </span>

                  <span
                    className={`${ui.pill} ${
                      props.vmPasswordStatusByVmxPath[vm.vmxPath.toLowerCase()]
                        ? "border-indigo-500/35 bg-indigo-500/10 text-indigo-900 dark:text-indigo-200"
                        : ""
                    }`}
                    title="VM 密码按每台 VM 单独保存（以 VMX 路径区分），仅在 vmrun 提示需要密码时使用。"
                  >
                    VM 密码：
                    {props.vmPasswordStatusByVmxPath[vm.vmxPath.toLowerCase()] == null
                      ? "未知"
                      : props.vmPasswordStatusByVmxPath[vm.vmxPath.toLowerCase()]
                        ? "已保存"
                        : "未设置"}
                  </span>

                  <div className="flex flex-wrap items-center gap-2">
                    {vm.isBusy && vm.busyText ? <span className={`text-sm ${ui.muted}`}>{vm.busyText}</span> : null}
                    {vm.isRunning ? (
                      <button
                        type="button"
                        className={`${ui.button} ${ui.buttonDanger}`}
                        onClick={() => setStopConfirmVm(vm)}
                        disabled={vm.isBusy}
                      >
                        停止
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`${ui.button} ${ui.buttonPrimary}`}
                        onClick={() => props.onStartVm(vm)}
                        disabled={vm.isBusy}
                      >
                        启动
                      </button>
                    )}
                    <button
                      type="button"
                      className={ui.button}
                      onClick={() => props.onEditVmPassword(vm)}
                      disabled={vm.isBusy}
                    >
                      VM 密码
                    </button>
                    <button
                      type="button"
                      className={ui.button}
                      onClick={() => props.onRemoveVm(vm.id)}
                      disabled={vm.isBusy}
                    >
                      移除
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 rounded-2xl border border-slate-900/10 bg-white/60 p-4 dark:border-slate-700/60 dark:bg-slate-900/60">
            <p className="m-0 font-semibold">还没有导入虚拟机</p>
            <p className={`m-0 mt-1 ${ui.muted}`}>推荐先扫描目录导入（可在设置中自定义扫描路径）。</p>
            <div className="mt-3 flex flex-wrap gap-2.5">
              <button
                type="button"
                className={`${ui.button} ${ui.buttonPrimary}`}
                onClick={props.onOpenScanWizard}
                disabled={needsSetup}
              >
                扫描并导入
              </button>
              <button type="button" className={ui.button} onClick={props.onNavigateSettings}>
                打开设置
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 border-t border-slate-900/10 pt-4 dark:border-slate-400/20">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 font-semibold">手动添加</p>
            <p className={`m-0 text-sm ${ui.muted}`}>粘贴远端 Windows 上的 VMX 路径即可。</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              className={`${ui.input} ${ui.inputPlaceholder} min-w-[280px] flex-1`}
              value={addPath}
              onChange={(e) => setAddPath(e.target.value)}
              placeholder="C:\\VMs\\Ubuntu\\Ubuntu.vmx"
            />
            <button
              type="button"
              className={`${ui.button} ${ui.buttonPrimary}`}
              onClick={() => {
                const trimmed = addPath.trim();
                if (!trimmed) return;
                props.onAddVmByPath(trimmed);
                setAddPath("");
              }}
            >
              添加
            </button>
          </div>
        </div>
      </section>

      {stopConfirmVm ? (
        <Modal title="停止虚拟机" description="默认推荐软关机；如果卡住再使用硬关机。" onClose={() => setStopConfirmVm(null)}>
          <div className="rounded-2xl border border-slate-900/10 bg-white/60 p-3 dark:border-slate-700/60 dark:bg-slate-900/60">
            <p className="m-0 font-semibold">{stopConfirmVm.displayName}</p>
            <p className={`m-0 mt-1 break-words font-mono text-sm ${ui.muted}`}>{stopConfirmVm.vmxPath}</p>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2.5">
            <button
              type="button"
              className={`${ui.button} ${ui.buttonDanger}`}
              onClick={() => {
                const vm = stopConfirmVm;
                setStopConfirmVm(null);
                props.onStopVm(vm, "soft");
              }}
            >
              软关机（推荐）
            </button>
            <button
              type="button"
              className={`${ui.button} ${ui.buttonDanger}`}
              onClick={() => {
                const vm = stopConfirmVm;
                setStopConfirmVm(null);
                props.onStopVm(vm, "hard");
              }}
            >
              硬关机
            </button>
            <button type="button" className={ui.button} onClick={() => setStopConfirmVm(null)}>
              取消
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
