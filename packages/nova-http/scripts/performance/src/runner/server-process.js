import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export function startServerProcess(config) {
  // runner 以子进程启动被测服务，保证每次压测都有独立、干净的应用生命周期。
  const serverScript = fileURLToPath(new URL("../app/server.js", import.meta.url));
  const server = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      PROD_API_HOST: config.host,
      PROD_API_PORT: String(config.port),
      PROD_API_METRICS_TOKEN: config.metricsToken,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  let stdout = "";
  let exitCode = null;
  let signalCode = null;

  server.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  server.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  server.once("exit", (code, signal) => {
    exitCode = code;
    signalCode = signal;
  });

  return {
    process: server,
    getStdout: () => stdout,
    getStderr: () => stderr,
    getExitStatus: () => ({ exitCode, signalCode }),
  };
}

export async function stopServerProcess(server) {
  if (!server || server.killed) return;
  if (server.exitCode !== null || server.signalCode !== null) return;

  // 先发 SIGTERM 走优雅关闭，超时后再兜底 SIGKILL。
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (!server.killed) {
        server.kill("SIGKILL");
      }
    }, 3_000);

    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    server.kill("SIGTERM");
  });
}
