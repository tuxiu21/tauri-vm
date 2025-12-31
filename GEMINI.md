# Tauri VM Console (Gemini Context)

## Project Overview

This is a **Tauri** desktop application designed to remotely manage **VMware Workstation** virtual machines on a Windows host via **SSH**. It provides a GUI for discovering, starting, stopping, and monitoring VMs.

### key Technologies

*   **Frontend:** React 19, TypeScript, Tailwind CSS, Vite.
*   **Backend:** Rust (Tauri v2), `russh` (SSH client), `tokio`.
*   **Communication:** Tauri Command/Invoke system.
*   **Remote Control:** Executes PowerShell commands via SSH to interact with `vmrun.exe`.

## Architecture

*   **Frontend (`src/`):**
    *   `src/App.tsx`: Main application component.
    *   `src/app/tauri.ts`: Wrappers for Tauri backend commands.
    *   `src/app/storage.ts`: Likely handles local storage for app settings.
    *   `src/components/`: Reusable UI components.
    *   `src/pages/`: Application pages (Console, Settings, etc.).

*   **Backend (`src-tauri/`):**
    *   `src/lib.rs`: **Core Logic.** Contains SSH connection handling, PowerShell command generation for `vmrun.exe`, and the `TraceStore` for logging.
    *   `src/main.rs`: Entry point.
    *   `tauri.conf.json`: Application configuration and permissions.

## Key Features

1.  **SSH Connection:** Connects to a remote Windows machine using a private key (uploaded by user, stored in `AppData`).
2.  **VM Discovery:** Scans common directories or user-specified paths for `.vmx` files using remote PowerShell.
3.  **VM Control:**
    *   **List Running:** Checks `vmrun list`.
    *   **Start:** `vmrun start <path> nogui`.
    *   **Stop:** `vmrun stop <path> <soft|hard>`.
4.  **Tracing:** Logs all remote command executions (duration, output, success/fail) to an in-memory `TraceStore` for debugging.

## Building and Running

The project uses `pnpm`.

*   **Install Dependencies:**
    ```bash
    pnpm install
    ```
*   **Development Mode (Frontend + Desktop):**
    ```bash
    pnpm tauri dev
    ```
*   **Frontend Only (Browser Mode):**
    ```bash
    pnpm dev
    ```
*   **Build Production App:**
    ```bash
    pnpm tauri build
    ```
*   **Rust Checks:**
    ```bash
    cd src-tauri
    cargo check
    cargo clippy
    ```

## Development Conventions

*   **Tauri Commands:** Defined in `src-tauri/src/lib.rs` with `#[tauri::command]`. Expose them in `src/app/tauri.ts`.
*   **Styling:** Utility-first CSS using **Tailwind**.
*   **Remote Execution:** All remote operations are wrapped in `powershell -NoProfile ...` calls generated in `lib.rs` to ensure consistent execution on the remote Windows host.
*   **Error Handling:** Backend returns `Result<T, String>` which translates to Promise rejection on the frontend.
