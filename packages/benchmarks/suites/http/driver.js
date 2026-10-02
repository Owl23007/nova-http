import autocannon from "autocannon";
import { validBody } from "./scenarios.js";

export function measure(port, scenario, profile, duration, { signal, child } = {}) {
  return new Promise((resolve, reject) => {
    let checked = 0;
    let invalid = 0;
    let settled = false;
    const finish = (error, raw) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      child?.removeListener("exit", exited);
      if (error) reject(error);
      else resolve({ raw, checked, invalid, sampling: "all-responses" });
    };
    const instance = autocannon(
      {
        url: `http://127.0.0.1:${port}${scenario.path}`,
        connections: profile.connections,
        pipelining: profile.pipelining,
        duration,
        method: scenario.method,
        body: scenario.body,
        headers: scenario.body ? { "content-type": "application/json" } : {},
        verifyBody(body) {
          checked++;
          const valid = validBody(body, scenario.expected);
          if (!valid) invalid++;
          return valid;
        },
      },
      finish,
    );
    const abort = () => {
      finish(new Error("运行取消"));
      instance.stop();
    };
    const exited = () => {
      finish(new Error("测量期间服务退出"));
      instance.stop();
    };
    const timer = setTimeout(
      () => {
        finish(new Error("压测超时"));
        instance.stop();
      },
      (duration + 15) * 1000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    child?.once("exit", exited);
    if (signal?.aborted) abort();
    if (child && (child.exitCode !== null || child.signalCode !== null)) exited();
  });
}
