import { scenarios } from "../http/scenarios.js";

// 正交覆盖连接数与流水线深度，避免只比较两个同时改变多个变量的负载
export const loads = Object.fromEntries(
  [1, 10, 100].flatMap((connections) =>
    [1, 10].map((pipelining) => [`c${connections}-p${pipelining}`, { connections, pipelining }]),
  ),
);
export const presets = {
  smoke: { warmup: 1, duration: 1, rounds: 1, iterations: 1000 },
  diagnostic: { warmup: 3, duration: 5, rounds: 3, iterations: 100000 },
  full: { warmup: 40, duration: 40, rounds: 3, iterations: 300000 },
};

export function select(value, allowed) {
  // 在构建或启动进程之前拒绝拼写错误及重复项，防止意外重复长时间压测
  const keys = value ? value.split(",") : Object.keys(allowed);
  if (
    !keys.length ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => !Object.hasOwn(allowed, key))
  )
    throw new Error(`Invalid selection: ${value}`);
  return keys;
}

export function matrix(scenarioNames, loadNames, targets) {
  // 固定 JSON 对照仅用于 json-small，不能跳过参数读取或请求体解析来制造收益
  select(scenarioNames.join(","), scenarios);
  select(loadNames.join(","), loads);
  return scenarioNames
    .flatMap((scenario) =>
      loadNames.map((load) => ({
        scenario,
        load,
        targets: targets.filter((target) => !target.diagnostic || scenario === "json-small"),
      })),
    )
    .filter((cell) => cell.targets.length);
}
