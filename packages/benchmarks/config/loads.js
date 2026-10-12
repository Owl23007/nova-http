// 负载配置，定义连接数和管道化数
export const loads = Object.freeze({
  "pipeline-1": { connections: 100, pipelining: 1 },
  "pipeline-10": { connections: 100, pipelining: 10 },
});

// 负载配置别名，定义不同的基准场景组合
export const defaultLoads = Object.freeze({
  smoke: "pipeline-1",
  pr: "pipeline-10",
  full: "pipeline-10",
});
