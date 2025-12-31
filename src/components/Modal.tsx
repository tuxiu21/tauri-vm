import { useEffect } from "react";
import { ui } from "./ui";

export function Modal(props: {
  title: string;
  description?: string;
  children: React.ReactNode;
  primaryAction?: { label: string; onClick: () => void; disabled?: boolean };
  secondaryAction?: { label: string; onClick: () => void; disabled?: boolean };
  onClose: () => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [props]);

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className={`w-full max-w-[720px] p-4 shadow-2xl ${ui.cardStrong}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="m-0 text-[1.1rem] font-semibold">{props.title}</h3>
            {props.description ? <p className={`m-0 mt-1 text-sm ${ui.muted}`}>{props.description}</p> : null}
          </div>
          <button
            type="button"
            className="rounded-xl border border-transparent px-3 py-2 text-sm opacity-80 hover:bg-slate-900/5 hover:opacity-100 dark:hover:bg-white/10"
            onClick={props.onClose}
          >
            关闭
          </button>
        </div>

        <div className="mt-4">{props.children}</div>

        {props.primaryAction || props.secondaryAction ? (
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5">
            {props.secondaryAction ? (
              <button
                type="button"
                className={ui.button}
                onClick={props.secondaryAction.onClick}
                disabled={props.secondaryAction.disabled}
              >
                {props.secondaryAction.label}
              </button>
            ) : null}
            {props.primaryAction ? (
              <button
                type="button"
                className={`${ui.button} ${ui.buttonPrimary}`}
                onClick={props.primaryAction.onClick}
                disabled={props.primaryAction.disabled}
              >
                {props.primaryAction.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

