# Nova Benchmarks

`@nova-http/benchmarks` 是 Nova 的性能测试工具集，用于比较 HTTP 服务性能、检查解析器开销和测量生产业务场景。它是私有 workspace 包，测试工具与依赖由仓库统一管理，不随 `nova-http` 发布

不同套件关注的成本不同，结果分别保存和解读，不能合并成一个框架性能排行榜

## 测试范围

| 套件       | 测试内容                            | 适用场景                 |
| ---------- | ----------------------------------- | ------------------------ |
| HTTP       | 请求处理、路由、JSON 解析和响应输出 | 比较 Nova 版本及框架对照 |
| Parser     | 连续输入和分片输入下的 HTTP 解析    | 分析解析器开销           |
| Production | 业务路由、Redis 缓存和 SQLite 读写  | 观察完整业务链路         |
| Streaming  | 流式响应吞吐、首字节时间和内存占用  | 检查大响应与背压行为     |

HTTP 默认测试当前 Nova、Fastify schema、Fastify 无 schema 和 `node:http`。历史发布版本只在显式指定 `--historical` 时参与

## 环境准备

在仓库根目录安装依赖：

```sh
pnpm install --frozen-lockfile
```

正式 HTTP 测试使用 Node.js 24.21.0、autocannon 8.0.0 和 Fastify 5.6.1。依赖版本由根目录 `pnpm-lock.yaml` 锁定，建议本地使用相同 Node.js 版本以便复现

HTTP 测试不需要数据库。Production 需要可用的 Redis 和支持 `node:sqlite` 的 Node.js。运行套件自身测试及归档 ZIP 校验还需要 Python 3

## 运行 HTTP 测试

默认命令执行短 smoke，用于确认服务、驱动和响应校验正常：

```sh
pnpm --filter @nova-http/benchmarks bench
```

HTTP 入口会自动构建被测 Nova，逐个启动独立服务进程，完成测量后关闭服务。smoke 结果只用于功能验证，不作为性能成绩

### 场景

| `--scenario`   | 请求与响应                                         |
| -------------- | -------------------------------------------------- |
| `json-small`   | GET `/`，返回固定 `{ "hello": "world" }`，默认场景 |
| `text`         | GET `/`，返回固定文本                              |
| `params-query` | 读取路径参数和查询参数后返回 JSON                  |
| `json-echo`    | POST JSON，解析请求体后原样回显                    |
| `middleware-5` | 执行五层同步中间件并返回执行计数                   |

`middleware-5` 是扩展场景。各目标执行相同的计数操作，但框架的中间件调度机制不同，应单独阅读该场景结果

### 负载配置

| `--profile`   | 连接数 | 每连接流水线请求数 | 每轮预热 | 每轮测量 | 轮数 | 用途               |
| ------------- | -----: | -----------------: | -------: | -------: | ---: | ------------------ |
| `smoke`       |     10 |                  1 |     1 秒 |     1 秒 |    1 | 功能验证，默认配置 |
| `pr`          |    100 |                 10 |    10 秒 |    10 秒 |    3 | PR 版本对比        |
| `fastify`     |    100 |                 10 |    40 秒 |    40 秒 |    3 | 正式测量           |
| `no-pipeline` |    100 |                  1 |    40 秒 |    40 秒 |    3 | 非流水线负载对照   |

例如，测量参数路由，或执行正式 JSON 场景：

```sh
pnpm --filter @nova-http/benchmarks bench --profile pr --scenario params-query
pnpm --filter @nova-http/benchmarks bench --profile fastify --scenario json-small
```

通过 `--targets` 选择目标，通过 `--baseline-root` 加入一个本地 checkout 作为基线。基线目录需先安装自身依赖，测量时会自动构建

```sh
pnpm --filter @nova-http/benchmarks bench --targets nova-current,node-http
pnpm --filter @nova-http/benchmarks bench --profile pr --baseline-root /absolute/path/to/baseline
```

可选目标为 `nova-current`、`fastify-schema`、`fastify-no-schema`、`node-http`；指定基线目录后还可选择 `nova-baseline`

## 测量方法

每轮都重新启动服务，先检查响应语义和流水线完整性，再进行预热与正式测量，结束后再次校验并清理进程。预热数据不计入成绩，各目标顺序运行，每轮轮换执行顺序，避免目标之间争抢 CPU

各目标使用相同的请求方法、请求体、连接数和测试时长，并保持响应状态码、正文和 content-type 一致。框架自动添加的其他响应头可能不同，会随结果记录。GET 场景不全局安装请求体解析器，JSON POST 场景实际解析输入，参数场景实际读取请求参数

正式测量期间对每个响应使用同一正文验证函数。连接错误、超时、非 2xx 响应、语义错误和进程异常都会使该轮失败；失败原因保留，失败轮次不进入成功统计，缺失指标不会被填为零

## 查看结果

本地输出统一写入仓库的 `.tmp/benchmark/`，该目录已被 Git 忽略：

```text
.tmp/benchmark/
  results/<批次>/
    manifest.json        批次配置与目标列表
    <target-id>.json     环境、来源、原始轮次与统计
    summary.md           本批次的可读汇总
  results/parser-v1/     解析器结果
  results/production-v1/ 生产场景结果
  results/production-stream-v1/ 流式场景结果
  work/                  历史包安装与临时运行目录
```

HTTP 汇总展示有效轮数、QPS 中位数、QPS 变异系数（CV）和轮次 p99 中位数。目标 JSON 还保存均值、标准差、吞吐、延迟分位、错误计数以及 Node.js、依赖、CPU、系统和源码身份

比较结果时，应保持场景、profile、环境和驱动一致，优先使用同一批次内的 baseline 与 target。CV 用于观察轮间波动；三轮数据仅提供描述统计，不能据此宣称显著改善。轮次 p99 的中位数也不等于把全部请求合并后计算的 p99

## 其他套件

以下入口使用已构建的 Nova，运行前先构建框架：

```sh
pnpm --filter nova-http build
pnpm --filter @nova-http/benchmarks bench:parser
pnpm --filter @nova-http/benchmarks bench:parser:native
pnpm --filter @nova-http/benchmarks bench:stream
```

Parser 使用自身的迭代次数和分片配置，不使用 HTTP profiles。`bench:parser:native` 依赖 Node.js 内部解析器绑定；运行环境不提供该绑定时，会记录 `unsupported` 并以非零状态退出

准备好 Redis 后，可启动生产场景服务或执行完整压力测试：

```sh
pnpm --filter @nova-http/benchmarks bench:production
pnpm --filter @nova-http/benchmarks bench:production:stress
```

`bench:production` 仅启动服务，`bench:production:stress` 会编排服务、预热、压测、资源采样与关闭。生产场景包含数据库和缓存成本，其 QPS 不应与 HTTP 基础场景直接比较

## 自动测试与归档

| 触发方式                                    | 执行内容                                      | 预计耗时   |
| ------------------------------------------- | --------------------------------------------- | ---------- |
| 涉及框架、基准工具、锁文件或相关工作流的 PR | 同一 job 比较 baseline、PR 构建版本和三个对照 | 7–10 分钟  |
| master 相关代码更新                         | 当前版本与三个对照的正式测量                  | 18–25 分钟 |
| 每周一北京时间 11:00                        | master 正式测量                               | 18–25 分钟 |
| 手动运行 `Benchmark`                        | 按所选 profile 和场景测量                     | 取决于配置 |

耗时按单个场景估算，不含 runner 排队和人工审批。测量 job 的超时上限为 45 分钟。性能测量独立于 `CI Required`；套件自身的测试和类型检查属于普通 CI，归档数据校验是否强制阻塞合并由仓库必需检查规则决定

PR 测量生成 Actions Summary 和 Artifact。成功的正式测量经来源及内容校验后，由归档工作流创建 PR，将 JSON 追加到 `.benchmark/http-v1/`。归档记录必须与对应 run、attempt 和 Artifact 一致，不允许手工覆盖历史数据

正式 JSON 是展示数据的来源，可在仓库根目录重新生成汇总：

```sh
node packages/benchmarks/report/render.js
```

生成文件为 `.tmp/benchmark/results/archive-summary.md`，不同批次分别展示

### 历史版本初始化

历史初始化测量 `config/historical.json` 中固定的 0.1.1、0.2.0 和 0.2.1。安装前会核实 registry 元数据及 tarball 完整性，安装过程禁用脚本；三个发布包先通过全部 HTTP 场景的语义与流水线预检

本地可先执行历史 smoke：

```sh
pnpm --filter @nova-http/benchmarks bench --historical --profile smoke
```

正式初始化通过 Actions 的 `Benchmark` 手动触发：

1. 在 master 选择 `historical: true`、`profile: fastify`、`scenario: json-small`，首批成功后保留 Artifact
2. 再选择 `profile: no-pipeline`，将首批 run ID 和确切 attempt 填入 `historical_base_run`、`historical_base_attempt`
3. 两批来源和结果均通过校验后，在首批身份对应的固定分支创建一个归档 PR，同时追加两个批次目录

每个 profile 都在自己的 job 中测量三个发布包和三个对照，预计各需 28–35 分钟。两批结果保留各自环境，不能拼接成同机数据。第二批失败时，可继续引用有效的首批 Artifact 恢复，无需重测首批；初始化合并后拒绝重复运行

Artifact 保留 30 天，第二批测量与 PR 核验须在首批 Artifact 过期前完成。来源缺失、过期或不一致时，归档不会放行

## 验证套件

```sh
pnpm --filter @nova-http/benchmarks test
pnpm --filter @nova-http/benchmarks typecheck
```

`test` 自动构建 Nova，验证适配器语义、流水线、进程清理、统计、结果完整性和归档规则，不以固定 QPS 阈值判断通过，也不启动正式长时间压测或 Redis 生产测试
