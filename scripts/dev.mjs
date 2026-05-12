import { spawn } from "node:child_process";
import net from "node:net";
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

function spawnWorkspace(command, args, env) {
  const executable = process.platform === "win32" ? "cmd.exe" : "npm";
  const spawnArgs = process.platform === "win32" ? ["/d", "/s", "/c", `npm ${args.join(" ")}`] : args;
  const child = spawn(executable, spawnArgs, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
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

const apiPort = await findAvailablePort(Number(process.env.PORT ?? 8787));
const webPort = await findAvailablePort(Number(process.env.WEB_PORT ?? 5173));
const apiTarget = `http://127.0.0.1:${apiPort}`;

console.log(`[dev] douban-lite web -> http://127.0.0.1:${webPort}`);
console.log(`[dev] douban-lite api -> ${apiTarget}`);

const children = [
  spawnWorkspace("@douban-lite/api", ["run", "dev", "--workspace", "@douban-lite/api"], {
    PORT: String(apiPort)
  }),
  spawnWorkspace("@douban-lite/web", ["run", "dev", "--workspace", "@douban-lite/web", "--", "--host", "127.0.0.1", "--port", String(webPort)], {
    VITE_API_PROXY_TARGET: apiTarget
  })
];

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  process.exit(code);
}

for (const child of children) {
  child.once("exit", (code) => {
    if (shuttingDown) {
      return;
    }
    shutdown(code ?? 0);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
