# Nova benchmarks

独立私有工作区包，依赖精确锁定在根 `pnpm-lock.yaml`，普通测试不启动长时间压测

完整测试与归档 ZIP 白名单校验需要 Python 3，GitHub Ubuntu runner 已提供 Python；本地 HTTP 测量只需要 Node 与 pnpm

```sh
pnpm install --frozen-lockfile
pnpm --filter nova-http build
pnpm --filter @nova-http/benchmarks test
pnpm --filter @nova-http/benchmarks typecheck
pnpm --filter @nova-http/benchmarks bench
pnpm --filter @nova-http/benchmarks bench --profile pr --scenario params-query
pnpm --filter @nova-http/benchmarks bench --profile fastify --scenario json-small
pnpm --filter @nova-http/benchmarks bench --baseline-root /absolute/path/to/baseline
```

HTTP CLI 自动构建被测 checkout，不依赖调用目录，默认写入仓库 `.tmp/benchmark/results/<timestamp>-<pid>/`，历史包隔离安装到 `.tmp/benchmark/work/`

## 公平性与结果边界

- 四个常规目标是当前 Nova、Fastify schema、Fastify 无 schema、node:http，历史版本仅通过 `--historical` 显式启用
- 固定 Node 24.21.0、Fastify 5.6.1、autocannon 8.0.0，CI 使用 ubuntu-24.04 并记录实际镜像版本、CPU、内存、架构和版本
- 所有目标顺序运行，每轮重新启动，每轮轮换顺序，先语义与流水线验证，再完整预热、正式测量、结束验证和进程清理
- 每个响应都调用相同正文验证函数，记录检查次数及失败次数；状态码与 content-type 在前后验证，额外响应头保留在 JSON
- JSON POST 实际解析输入，参数路由实际读取不同参数与查询，GET 不全局安装 body parser
- `middleware-5` 为扩展场景，五层同步操作计数相同，框架调度机制并不相同，不能与基础场景混为一个排行榜
- 连接错误、超时、non-2xx、正文错误、启动失败均保留为失败，缺失指标拒绝处理，不填零也不纳入成功统计
- 三轮中位数、均值、总体标准差、CV 是描述统计，不能证明显著改善；轮次 p99 的中位数不是合并请求的 p99
- smoke 只有一秒预热与一秒测量，只验证功能，不是性能成绩
- 同批次使用相同驱动测 baseline 与 target，baseline SHA、PR head SHA、实际构建 SHA、驱动 SHA 分开记录，脏工作区不会被正式归档接受

| Profile     | 连接 | 流水线 | 预热秒数 | 测量秒数 | 轮数 |
| ----------- | ---: | -----: | -------: | -------: | ---: |
| smoke       |   10 |      1 |        1 |        1 |    1 |
| pr          |  100 |     10 |       10 |       10 |    3 |
| fastify     |  100 |     10 |       40 |       40 |    3 |
| no-pipeline |  100 |      1 |       40 |       40 |    3 |

## 独立 suite

`bench:parser` 保留原解析器输入分片与计时语义，使用 `parser-v1`，不套用 HTTP profiles，不与 HTTP QPS 混排，原生绑定不可用时 `bench:parser:native` 输出 unsupported 并以非零状态退出

`bench:production` 启动业务服务，`bench:production:stress` 运行原 Redis、SQLite 场景，使用 `production-v1`，外部服务必须显式准备，历史报告仍留在 `packages/nova-http/scripts/performance/reports/`，新结果带原报告来源标识

`bench:stream` 保留原流式场景，使用独立的 `production-stream-v1`，结果放在统一忽略目录

旧 nova-http 命令和脚本委托到新包，production 历史模块仅保留导出委托，不再通过 npm exec 临时下载压测工具

## CI 与正式归档

`benchmark.yml` 的 PR 测量同 job 构建 baseline 与实际 merge checkout，权限仅只读，输出 Summary 和唯一 Artifact，文档及纯结果 PR 跳过测量

正式 master、定时和手动测量成功结束后，`benchmark-archive.yml` 在新 runner 用 master 校验器核对真实 run、attempt、workflow、SHA、事件和 Artifact，再创建 `codex/benchmark-<run>-<attempt>` 临时归档 PR

`benchmark-data.yml` 始终对 PR 运行，使用 `pull_request_target` 的受保护 master 校验器，通过 API 读取 PR JSON，不 checkout 或执行 PR 源码，不安装 PR 依赖

只允许 Action 机器人在本仓库创建的归档 PR，只追加新批次 JSON，拒绝普通用户写数据、符号链接、目录逃逸、覆盖、删除、重命名、混入其他文件、缺失或过期 Artifact、API 不可用及内容不一致

`.benchmark` 只保存 JSON，不保存 Markdown、源码、脚本或依赖，`node packages/benchmarks/report/render.js` 从正式 JSON 按批次重建 `.tmp/benchmark/results/archive-summary.md`

仓库管理员需在工作流合并后启用：

1. master 必需检查 `Benchmark data validation`，要求分支保持最新，要求 CODEOWNERS 审核并撤销过期审核，禁止绕过检查直接提交
2. 允许 GitHub Actions 创建 PR，必要时批准由 GITHUB_TOKEN 创建的 PR 的工作流
3. 自动删除已合并分支，归档 Artifact 在 30 天有效期内完成核验

本地单元测试不能证明 GitHub 的权限、事件触发、分支保护及真实 Artifact 下载链路已经生效，合并后必须进行一次正式试跑

## 历史初始化

`config/historical.json` 固化 0.1.1、0.2.0、0.2.1 的真实 registry 时间、tarball 和 sha512，npm gitHead 与标签 SHA 不混用

```sh
pnpm --filter @nova-http/benchmarks bench --historical --profile smoke
```

历史入口再次核对 registry，先验证 tarball，再禁用安装脚本且不生成第二份锁文件进行隔离安装，用实际发布包执行全部五个场景的响应与流水线预检

正式链路稳定后，在 master 手动运行 Benchmark 的 historical 选项，先选 fastify；首批成功后只保存 Artifact，不创建 PR。再选 no-pipeline，并将首批的 run ID 与确切 attempt 填入 historical_base_run、historical_base_attempt。第二批开始测量前先核实首批成功来源及 Artifact，不能只凭输入自述恢复

两个 profile 保持独立批次，各自在 45 分钟预算内以同一个 job 测三个发布包和三个对照，不拼接跨 job 的绝对 QPS。第二批成功后，归档器重新验证两个 run、attempt、SHA 和各自 Artifact，向首批身份对应的固定临时分支一次性追加两个批次目录，只创建一个初始化归档 PR。第二批重试仍使用相同分支，不因新的第二批 run ID 另建初始化分支

首批 manifest 保持 incomplete 原文不变，第二批 manifest 引用首批身份并记录 complete，PR 校验器必须同时验证两批数据才允许合并。任一批失败、Artifact 过期或证据不全都不创建或放行归档 PR。第二批失败可重新运行 no-pipeline 并继续引用仍有效的首批 Artifact，不重测已成功的 fastify。初始化合并后拒绝重复运行，两次测量和 PR 核验都必须在首批 Artifact 的 30 天有效期内完成
