/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_E2E?: string;
  readonly VITE_E2E_SSH_HOST?: string;
  readonly VITE_E2E_SSH_PORT?: string;
  readonly VITE_E2E_SSH_USER?: string;
  readonly VITE_E2E_SSH_KEY_TEXT?: string;
  readonly VITE_E2E_VM_VMX_PATH?: string;
  readonly VITE_E2E_VM_PASSWORD?: string;
  readonly VITE_E2E_RUN_HARD_STOP?: string;
  readonly VITE_E2E_SCAN_ROOTS?: string;
  readonly VITE_E2E_TIMEOUT_MS?: string;
}
