import { Session } from "node:inspector/promises";
import { createProbe } from "./telemetry.js";

let stop;
let session;
// 诊断入口复用正式适配器，仅在预热和测量边界响应采样指令
// CPU profile 只覆盖正式测量窗口，其开销必须与普通测量分开解读
process.on("message", async (payload) => {
  const message = /** @type {{probeId?: number, action?: string, cpuProfile?: boolean}} */ (
    payload
  );
  if (!message?.probeId) return;
  try {
    let result;
    if (message.action === "start") {
      if (stop) throw new Error("Probe already started");
      if (message.cpuProfile) {
        session = new Session();
        session.connect();
        await session.post("Profiler.enable");
        await session.post("Profiler.start");
      }
      stop = createProbe();
      result = { started: true };
    } else if (message.action === "stop") {
      if (!stop) throw new Error("Probe not started");
      result = stop();
      stop = undefined;
      if (session) {
        result.profile = (await session.post("Profiler.stop")).profile;
        session.disconnect();
        session = undefined;
      }
    } else throw new Error("Unknown probe action");
    process.send({ probeId: message.probeId, result });
  } catch (error) {
    process.send({ probeId: message.probeId, error: error.message });
  }
});
await import("../../adapters/server.js");
