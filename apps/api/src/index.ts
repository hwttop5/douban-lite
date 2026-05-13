import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./server";

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const devTargetsFile = join(workspaceRoot, ".codex-run", "dev-targets.json");

function writeDevTargets(port: number) {
  mkdirSync(dirname(devTargetsFile), { recursive: true });
  writeFileSync(
    devTargetsFile,
    JSON.stringify(
      {
        apiPort: port,
        apiTarget: `http://127.0.0.1:${port}`,
        updatedAt: new Date().toISOString(),
        pid: process.pid
      },
      null,
      2
    )
  );
}

const context = createApp();
context.sync.start();
writeDevTargets(context.config.port);

context.app.listen(context.config.port, () => {
  console.log(`douban-lite api listening on http://localhost:${context.config.port}`);
});
