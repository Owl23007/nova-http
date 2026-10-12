// 基准配置，定义不同的基准场景组合
export const profiles = Object.freeze({
  smoke: { warmup: 1, duration: 1, rounds: 1 },
  pr: { warmup: 10, duration: 10, rounds: 3 },
  full: { warmup: 40, duration: 40, rounds: 3 },
});

// 计算每轮的目标顺序，确保不同轮次的测量顺序不同
export function orderForRound(targets, round) {
  const offset = round % targets.length;
  return [...targets.slice(offset), ...targets.slice(0, offset)];
}
