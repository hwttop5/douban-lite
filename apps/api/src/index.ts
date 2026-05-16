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
        apiTarget: `http://localhost:${port}`,
        updatedAt: new Date().toISOString(),
        pid: process.pid
      },
      null,
      2
    )
  );
}

function maybeWriteDevTargets(port: number, nodeEnv: string) {
  if (nodeEnv === "production") {
    return;
  }
  try {
    writeDevTargets(port);
  } catch (error) {
    console.warn("Unable to write local dev targets.", error);
  }
}

const context = createApp();
context.sync.start();
maybeWriteDevTargets(context.config.port, context.config.nodeEnv);

context.app.listen(context.config.port, () => {
  console.log(`douban-lite api listening on http://localhost:${context.config.port}`);
});
