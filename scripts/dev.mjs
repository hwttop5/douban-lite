import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(preferredPort, attempts = 20) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = preferredPort + offset;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new Error(`Unable to find a free port near ${preferredPort}.`);
}

function spawnWorkspace(command, cwd, args, env) {
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      ...env
    }
  });
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[${command}] ${chunk}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[${command}] ${chunk}`);
  });
  child.once("error", (error) => {
    console.error(`[dev] failed to start ${command}:`, error);
  });
  return child;
}

function describeExit(code, signal) {
  if (signal) {
    return `signal ${signal}`;
  }
  return `code ${code ?? 0}`;
}

function isChildRunning(child) {
  return child.exitCode == null && child.signalCode == null;
}

function killWorkspace(child) {
  if (!child.pid || !isChildRunning(child)) {
    return Promise.resolve();
  }

  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    });
  }

  return new Promise((resolve) => {
    const finish = () => resolve();
    child.once("exit", finish);
    try {
      child.kill("SIGTERM");
    } catch {
      child.off("exit", finish);
      resolve();
      return;
    }

    setTimeout(() => {
      if (!isChildRunning(child)) {
        return;
      }
      try {
        child.kill("SIGKILL");
      } catch {
        // Ignore final kill failures during shutdown.
      }
    }, 3000).unref();
  });
}

const apiPort = await findAvailablePort(Number(process.env.PORT ?? 8787));
const webPort = await findAvailablePort(Number(process.env.WEB_PORT ?? 5173));
const apiTarget = `http://localhost:${apiPort}`;
const rootDir = process.cwd();
const tsxCliPath = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");
const viteCliPath = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");

console.log(`[dev] douban-lite web -> http://127.0.0.1:${webPort}`);
console.log(`[dev] douban-lite api -> ${apiTarget}`);

const children = [
  {
    command: "@douban-lite/api",
    child: spawnWorkspace("@douban-lite/api", path.join(rootDir, "apps", "api"), [tsxCliPath, "watch", "src/index.ts"], {
      PORT: String(apiPort)
    })
  },
  {
    command: "@douban-lite/web",
    child: spawnWorkspace("@douban-lite/web", path.join(rootDir, "apps", "web"), [viteCliPath, "--host", "127.0.0.1", "--port", String(webPort)], {
      VITE_API_PROXY_TARGET: apiTarget
    })
  }
];

let shuttingDown = false;

async function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await Promise.all(children.map(({ child }) => killWorkspace(child)));
  process.exit(code);
}

for (const { command, child } of children) {
  child.once("exit", (code, signal) => {
    console.log(`[dev] ${command} exited with ${describeExit(code, signal)}`);
    if (shuttingDown) {
      return;
    }
    const exitCode = code && code > 0 ? code : 1;
    void shutdown(exitCode);
  });
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
