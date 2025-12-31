import { useEffect } from "react";
import type { Toast } from "../app/types";

function toastStyles(kind: Toast["kind"]) {
  if (kind === "success") return "border-emerald-500/35 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100";
  if (kind === "error") return "border-rose-500/35 bg-rose-500/10 text-rose-950 dark:text-rose-100";
  return "border-slate-900/10 bg-white/70 text-slate-950 dark:border-slate-400/20 dark:bg-white/5 dark:text-white";
}

export function ToastViewport(props: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  useEffect(() => {
    if (!props.toasts.length) return;
    const timers = props.toasts.map((t) =>
      window.setTimeout(() => props.onDismiss(t.id), t.kind === "error" ? 8000 : 3500),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [props]);

  if (!props.toasts.length) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-4">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col items-end gap-2">
        {props.toasts.map((t) => (
          <div
            key={t.id}
            className={`w-full max-w-[560px] rounded-2xl border px-4 py-3 shadow-xl backdrop-blur ${toastStyles(
              t.kind,
            )}`}
            role="status"
            aria-live={t.kind === "error" ? "assertive" : "polite"}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 font-semibold">{t.title}</p>
                {t.message ? <p className="m-0 mt-1 break-words text-sm opacity-85">{t.message}</p> : null}
              </div>
              <button
                type="button"
                className="rounded-lg border border-transparent px-2 py-1 text-sm opacity-80 hover:bg-slate-900/5 hover:opacity-100 dark:hover:bg-white/10"
                onClick={() => props.onDismiss(t.id)}
              >
                关闭
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

