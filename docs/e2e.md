# E2E Invoke Suite

This project includes an in-app E2E runner that performs real frontend `invoke()` calls against the Rust backend and exits the app with a pass/fail exit code.

## How It Works

- The runner lives in `src/app/e2eRunner.ts`.
- When `VITE_E2E=1`, it runs on startup (`src/main.tsx`) and calls all registered commands via `invoke()`.
- At the end it calls the Rust command `e2e_exit` to terminate the process with exit code `0` (pass) or `1` (fail).
- The run prints a single JSON report line to the console prefixed with `[e2e]`.

## Environment Variables

All variables are read from `import.meta.env`, so they must be prefixed with `VITE_`.

- `VITE_E2E=1` (required): enable the runner.
- `VITE_E2E_SSH_HOST` (required): remote Windows host (SSH).
- `VITE_E2E_SSH_PORT` (optional, default `22`).
- `VITE_E2E_SSH_USER` (required).
- `VITE_E2E_SSH_KEY_TEXT` (optional): SSH private key content; used only if the app key is not configured.
- `VITE_E2E_VM_VMX_PATH` (optional): enables real start/stop tests against this `.vmx` path.
- `VITE_E2E_VM_PASSWORD` (optional): VMware VM password (if required).
- `VITE_E2E_RUN_HARD_STOP=1` (optional): also test `vmware_stop_vm` with `hard`.
- `VITE_E2E_WAIT_AFTER_START_MS` (optional, default `0`): extra delay after `vmware_start_vm` returns (before polling `vmware_list_running`).
- `VITE_E2E_SCAN_ROOTS` (optional): JSON array of roots for `vmware_scan_vmx`, e.g. `["$env:USERPROFILE\\\\Documents\\\\Virtual Machines"]`.
- `VITE_E2E_EXPECT_VMX_SUBSTR` (optional): if set, `vmware_scan_default_vmx` must return a path containing this substring (case-insensitive) or the suite fails.
- `VITE_E2E_TIMEOUT_MS` (optional, default `120000`): per-step timeout.

## Example (PowerShell)

```powershell
$env:VITE_E2E="1"
$env:VITE_E2E_SSH_HOST="192.168.5.100"
$env:VITE_E2E_SSH_USER="rin"
$env:VITE_E2E_SSH_PORT="22"
$env:VITE_E2E_VM_VMX_PATH="C:\\Users\\rin\\Documents\\Virtual Machines\\TestVM\\TestVM.vmx"
$env:VITE_E2E_EXPECT_VMX_SUBSTR="C:\\Users\\rin\\Documents\\Virtual Machines\\TestVM\\TestVM.vmx"
$env:VITE_E2E_SCAN_ROOTS='["$env:USERPROFILE\\\\Documents\\\\Virtual Machines"]'

pnpm tauri dev
```

## Quick Start (pnpm script)

```powershell
pnpm e2e
```

## Avoid Re-Typing Env Vars

Create a local `.env.e2e.local` (gitignored) in the repo root:

```dotenv
VITE_E2E_SSH_HOST=192.168.5.100
VITE_E2E_SSH_USER=rin
VITE_E2E_SSH_PORT=22
```

Then run:

```powershell
pnpm e2e
```

## Notes

- `vmrun.exe` must exist on the remote host at one of the paths hard-coded in `src-tauri/src/lib.rs`.
- Use a dedicated test VM for start/stop tests to avoid disrupting your real environments.
