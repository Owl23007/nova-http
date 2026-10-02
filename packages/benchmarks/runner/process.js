import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * 启动独立目标并限定就绪等待时间
 * @param {object} target 目标配置
 * @param {string} scenario 场景名称
 * @param {{timeout?: number, signal?: AbortSignal, server?: URL}} options 生命周期配置
 */
export async function startTarget(
  target,
  scenario,
  { timeout = 15000, signal, server = new URL("../adapters/server.js", import.meta.url) } = {},
) {
  const child = fork(fileURLToPath(server), [JSON.stringify(target), scenario], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let log = "";
  const capture = (chunk) => {
    log = (log + chunk.toString()).slice(-16000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 1500);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(undefined);
      });
      child.kill();
    });
  };
  try {
    const port = await new Promise((resolve, reject) => {
      const fail = (error) => {
        cleanup();
        reject(error);
      };
      const exited = () => fail(new Error(`服务提前退出: ${log}`));
      const aborted = () => fail(new Error("运行取消"));
      const timer = setTimeout(() => fail(new Error(`服务就绪超时: ${log}`)), timeout);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", aborted);
        child.removeListener("exit", exited);
        child.removeListener("error", fail);
      };
      child.once("error", fail);
      child.once("exit", exited);
      signal?.addEventListener("abort", aborted, { once: true });
      child.once("message", (message) => {
        if (
          !message ||
          typeof message !== "object" ||
          !("port" in message) ||
          typeof message.port !== "number" ||
          !Number.isInteger(message.port) ||
          message.port < 1 ||
          message.port > 65535
        )
          return fail(new Error("服务端口无效"));
        cleanup();
        resolve(message.port);
      });
      if (signal?.aborted) aborted();
    });
    return { child, port, stop, log: () => log };
  } catch (error) {
    await stop();
    throw error;
  }
}
