# Repository Guidelines

## Project Structure & Module Organization
- `src/`: React + TypeScript frontend (entry: `src/main.tsx`, UI: `src/App.tsx`, styles/assets under `src/`).
- `public/`: static assets copied as-is by Vite.
- `src-tauri/`: Tauri (Rust) backend (entry: `src-tauri/src/main.rs`, commands in `src-tauri/src/lib.rs`, config in `src-tauri/tauri.conf.json`).
- `docs/`: project notes and usage details.

## Build, Test, and Development Commands
Use `pnpm` (lockfile: `pnpm-lock.yaml`).
- `pnpm dev`: run the Vite dev server on `http://localhost:1420`.
- `pnpm build`: typecheck (`tsc`) then build the web assets into `dist/`.
- `pnpm preview`: serve the built `dist/` locally.
- `pnpm tauri dev`: run the desktop app in dev mode (starts Vite via `beforeDevCommand`).
- `pnpm tauri build`: produce a bundled desktop build.
- Rust checks: `cd src-tauri; cargo check` (optional: `cargo fmt`, `cargo clippy`).

## Coding Style & Naming Conventions
- TypeScript/React: 2-space indentation; prefer named components in `PascalCase` and hooks as `useThing`.
- Rust: run `rustfmt` (`cargo fmt`) before PRs; keep modules/types `snake_case`/`PascalCase` per Rust conventions.
- Keep Tauri commands in `src-tauri/src/lib.rs` behind `#[tauri::command]` and wire them through `tauri::generate_handler!`.

## Testing Guidelines
No dedicated test runner is configured currently (no `vitest/jest` scripts detected). If you add tests, document the framework and add a `pnpm test` script.

## VMware Control Notes
- Be careful when changing encrypted/password-protected VM start behavior in `src-tauri/src/lib.rs`.
- VMware behaves differently across direct `vmrun`, Windows Scheduled Tasks, and locked/black-screen host sessions.
- No saved VM password: call direct `vmrun start` so VMware can immediately return "password required".
- Saved VM password: keep the Scheduled Task start path first; this is the path that reliably starts the VM on the remote Windows host.
- Wrong saved VM password: Scheduled Task may only report that the task started while the VM never appears in `vmrun list`. If the task path does not reach running state, run direct `vmrun -vp ... start ...` only to collect the explicit password error.
- Do not replace the password start flow with a direct `vmrun -vp` preflight only; that can break correct-password startup even though it improves wrong-password reporting.
- Do not require matching `vmware-vmx.exe` command lines as the sole startup success condition; `vmrun list` is the more reliable app-level signal for this project.
- For VM start/stop changes, run real e2e against the Windows 11 VM for all three cases: no password, wrong password, and correct password.

## Commit & Pull Request Guidelines
- Commits follow a lightweight Conventional Commits style: `feat: …`, `fix: …`, `chore: …`, `docs: …`.
- PRs: include a short description, steps to verify (commands + expected behavior), and screenshots/gifs for UI changes.

## Security & Configuration Tips
- Avoid committing secrets (SSH keys, tokens). The app expects you to upload an SSH private key via the UI and stores it under the OS app data directory; keep real keys out of git.
- When changing remote/VM control behavior, validate both Windows and Android paths if applicable (see `pnpm android` script and `src-tauri/gen/android/`).
