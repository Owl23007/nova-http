---
description: 区分微基准与生产场景，复现现有性能套件并阅读历史报告。
---

# 性能验证

微基准用于定位解析、路由和输出开销，生产场景套件用于测量业务、Redis、SQLite 与框架共同参与时的表现。结果必须关联版本、环境和压测配置。

## 运行套件

先构建框架。生产套件需要支持 node:sqlite 的 Node.js 和本地 Redis，独立依赖位于 `packages/nova-http/scripts/performance`。

```sh
pnpm -F nova-http build
pnpm --dir packages/nova-http/scripts/performance install
pnpm -F nova-http bench:production:stress
```

`bench:production` 仅启动场景服务；`bench:production:stress` 才编排服务与压测。解析器与响应微基准可使用包 scripts 中的 bench:parser、bench:stream 等命令。

## 默认配置

| 环境变量                  | 默认值 | 单位               |
| ------------------------- | ------ | ------------------ |
| STRESS_DURATION           | 30     | 秒                 |
| STRESS_WARMUP_DURATION    | 5      | 秒                 |
| STRESS_CONNECTIONS        | 200    | 连接               |
| STRESS_PIPELINING         | 1      | 每连接流水线请求数 |
| STRESS_PORT               | 3910   | 端口               |
| STRESS_MAX_P99_LATENCY_MS | 250    | 毫秒               |
| STRESS_MAX_ERROR_RATE     | 0.01   | 错误率比例         |

PowerShell 示例：

```powershell
$env:STRESS_DURATION = '60'
$env:STRESS_CONNECTIONS = '200'
pnpm -F nova-http bench:production:stress
```

## 如何比较

固定硬件、Node 版本、提交、依赖版本、连接数、流水线、预热与正式时长。记录吞吐、延迟分位、错误率、CPU、RSS 和事件循环延迟，重复运行并报告分布。不同 body 大小、缓存命中率与数据库负载不能直接归结为框架性能差异。

## 历史报告

[2026 年 5 月压力测试报告](https://github.com/Owl23007/nova-http/blob/master/packages/nova-http/scripts/performance/reports/performance-report-4.6.md)记录了 read-user、search-list 和 create-order 七轮测试，使用 Node.js 22.19.0、200 连接、30 秒正式压测。

该报告属于历史场景结果，未完整记录硬件与基线提交，不能作为当前工作区的性能保证或框架横向排名。原始报告保留图表和测量数据，新基准应补齐环境元数据后再比较。
