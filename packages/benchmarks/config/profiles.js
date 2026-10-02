export const profiles = Object.freeze({
  smoke: { connections: 10, pipelining: 1, warmup: 1, duration: 1, rounds: 1 },
  pr: { connections: 100, pipelining: 10, warmup: 10, duration: 10, rounds: 3 },
  fastify: { connections: 100, pipelining: 10, warmup: 40, duration: 40, rounds: 3 },
  "no-pipeline": { connections: 100, pipelining: 1, warmup: 40, duration: 40, rounds: 3 },
});

export function orderForRound(targets, round) {
  const offset = round % targets.length;
  return [...targets.slice(offset), ...targets.slice(0, offset)];
}
