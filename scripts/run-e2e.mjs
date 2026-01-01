import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

function parseDotenv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function mergeEnv(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (target[k] == null || String(target[k]).trim() === "") target[k] = v;
  }
}

function loadEnvFile(filepath) {
  try {
    if (!fs.existsSync(filepath)) return {};
    return parseDotenv(fs.readFileSync(filepath, "utf8"));
  } catch {
    return {};
  }
}

const repoRoot = path.resolve(process.cwd());
const env = { ...process.env, VITE_E2E: "1" };
const envFile = env.E2E_ENV_FILE
  ? path.resolve(repoRoot, env.E2E_ENV_FILE)
  : path.join(repoRoot, ".env.e2e");
mergeEnv(env, loadEnvFile(envFile));
mergeEnv(env, loadEnvFile(path.join(repoRoot, ".env.e2e.local")));

const required = ["VITE_E2E_SSH_HOST", "VITE_E2E_SSH_USER"];
const missing = required.filter((name) => !(env[name] && String(env[name]).trim()));
if (missing.length) {
  console.error(
    `[e2e] Missing required env vars: ${missing.join(", ")}. ` +
      "Set them (or put them in .env.e2e / .env.e2e.local) and re-run `pnpm e2e`.",
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
