# 测试报告

本文档用于归档后续执行 `Vitest` 测试及 `Benchmark` 后的各项数据报表。

## 单元与集成测试结果

> 待开发完成后执行 `pnpm vitest run --coverage` 收集数据。

- 总用例数: 待统计
- 成功数: 待统计
- 分支覆盖率: 待统计 (%)

## 性能基准测试结果 (Benchmark)

在 `scripts/benchmark/` 下执行基准测试脚本后，比较 `Nova` 与现有 Node 原生服务的请求处理能力。

| 测试目标 | QPS (Req/s) | 延迟 (ms) | 内存占用 |
| --- | --- | --- | --- |
| Node.js 原生 http | - | - | - |
| Nova Http Server | - | - | - |
