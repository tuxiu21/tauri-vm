import { spawn } from "node:child_process";
import readline from "node:readline";

const env = { ...process.env, VITE_E2E: "1" };

const required = ["VITE_E2E_SSH_HOST", "VITE_E2E_SSH_USER"];
const missing = required.filter((name) => !(env[name] && String(env[name]).trim()));
if (missing.length) {
  console.error(
    `[e2e] Missing required env vars: ${missing.join(", ")}. ` +
      "Set them (and optionally VITE_E2E_SSH_PORT / VITE_E2E_SSH_KEY_TEXT / VITE_E2E_VM_VMX_PATH) then re-run `pnpm e2e`.",
  );
  process.exit(2);
}

const child = spawn("pnpm", ["tauri", "dev"], {
  stdio: ["inherit", "pipe", "pipe"],
  env,
  shell: process.platform === "win32",
});

const timeoutMs = Number(env.VITE_E2E_TIMEOUT_MS || "120000") + 60_000;
const startedAt = Date.now();
let settled = false;

function settle(exitCode, reason) {
  if (settled) return;
  settled = true;
  if (reason) console.error(reason);
  try {
    child.kill();
  } catch {
    // ignore
  }
  process.exit(exitCode);
}

function onLine(line) {
  const m = /^\[e2e\]\s+(PASS|FAIL)\b/.exec(line);
  if (!m) return;
  settle(m[1] === "PASS" ? 0 : 1);
}

const outRl = readline.createInterface({ input: child.stdout });
outRl.on("line", (line) => {
  process.stdout.write(`${line}\n`);
  onLine(line);
});

const errRl = readline.createInterface({ input: child.stderr });
errRl.on("line", (line) => {
  process.stderr.write(`${line}\n`);
  onLine(line);
});

const timer = setInterval(() => {
  if (settled) return;
  if (Date.now() - startedAt > timeoutMs) {
    settle(3, `[e2e] Timed out after ${timeoutMs}ms without receiving a [e2e] PASS/FAIL line.`);
  }
}, 250);

child.on("exit", (code) => {
  clearInterval(timer);
  if (settled) return;
  settle(4, `[e2e] Process exited (code=${code ?? "null"}) before emitting a [e2e] PASS/FAIL line.`);
});
