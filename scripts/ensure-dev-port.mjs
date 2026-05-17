import net from "node:net";
import { spawnSync } from "node:child_process";
import process from "node:process";

const DEFAULT_PORT = 1420;
const RETRY_ATTEMPTS = 10;
const RETRY_DELAY_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canListenOnHost(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", (error) => {
      if (error?.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      if (error?.code === "EADDRNOTAVAIL" || error?.code === "EAFNOSUPPORT") {
        resolve(true);
        return;
      }
      resolve(false);
    });
    server.listen({ port, host }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function isPortFree(port) {
  for (const host of ["127.0.0.1", "::1"]) {
    if (!(await canListenOnHost(port, host))) {
      return false;
    }
  }
  return true;
}

function getPidsFromPortWindows(port) {
  const result = spawnSync(
    "cmd",
    ["/c", `netstat -ano -p tcp | findstr :${port}`],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).at(-1))
    .map((value) => Number.parseInt(value ?? "", 10))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function getPidsFromPortUnix(port) {
  const result = spawnSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  return result.stdout
    .trim()
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function getCommandLineUnix(pid) {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function getCommandLineWindows(pid) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
    ],
    { encoding: "utf8" },
  );
  return result.status === 0 ? result.stdout.trim() : "";
}

function getCommandLine(pid) {
  return process.platform === "win32" ? getCommandLineWindows(pid) : getCommandLineUnix(pid);
}

function canAutoTerminate(commandLine) {
  const normalized = commandLine.toLowerCase();
  return (
    normalized.includes("vite") ||
    normalized.includes("tauri") ||
    normalized.includes("npm run dev") ||
    normalized.includes("bun run dev") ||
    normalized.includes("pnpm dev") ||
    normalized.includes("yarn dev")
  );
}

function terminatePid(pid, force = false) {
  if (process.platform === "win32") {
    const args = force ? ["/PID", String(pid), "/T", "/F"] : ["/PID", String(pid), "/T"];
    return spawnSync("taskkill", args, { stdio: "ignore" }).status === 0;
  }

  try {
    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

async function releasePort(port) {
  const pids = process.platform === "win32" ? getPidsFromPortWindows(port) : getPidsFromPortUnix(port);
  const uniquePids = [...new Set(pids)].filter((pid) => pid !== process.pid);
  if (uniquePids.length === 0) {
    return false;
  }

  let terminatedAny = false;
  for (const pid of uniquePids) {
    const commandLine = getCommandLine(pid);
    if (!commandLine || !canAutoTerminate(commandLine)) {
      continue;
    }
    terminatedAny = terminatePid(pid) || terminatedAny;
  }

  if (!terminatedAny) {
    return false;
  }

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    if (await isPortFree(port)) {
      return true;
    }
    await sleep(RETRY_DELAY_MS);
  }

  for (const pid of uniquePids) {
    terminatePid(pid, true);
  }
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    if (await isPortFree(port)) {
      return true;
    }
    await sleep(RETRY_DELAY_MS);
  }
  return false;
}

async function main() {
  const port = Number.parseInt(process.env.TAURI_DEV_PORT ?? "", 10) || DEFAULT_PORT;
  if (await isPortFree(port)) {
    return;
  }

  console.warn(`ensure-dev-port: port ${port} is in use, attempting to release it...`);
  if (await releasePort(port)) {
    console.warn(`ensure-dev-port: released port ${port}.`);
    return;
  }

  console.error(`ensure-dev-port: port ${port} is still occupied. Close the process using this port and retry.`);
  process.exit(1);
}

try {
  await main();
} catch (error) {
  console.error(`ensure-dev-port: failed\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
