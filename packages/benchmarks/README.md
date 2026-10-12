# Nova 基准测试套件

`@nova-http/benchmarks` 是 Nova 的性能测试工具集，用于测量 HTTP 服务性能、追踪性能变化，并定位框架内部的性能瓶颈。

从这里开始：

- [快速开始](#快速开始)
- [HTTP 测试](#http-测试)：比较框架或版本性能
- [结果与指标](#结果与指标)：查看和理解结果
- [诊断与专项测试](#诊断与专项测试)：定位性能瓶颈
- [开发与发布流程](#开发与发布流程)、[数据归档](#数据归档)
- [验证测试工具](#验证测试工具)：修改测试工具后自检

## 快速开始

### 1. 安装依赖

在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
```

### 2. 运行快速验证

在仓库根目录执行默认 Smoke 测试：

```sh
pnpm --filter @nova-http/benchmarks bench
```

Smoke 仅测量 `nova-current`，通过短时间预热、请求验证和测量，检查服务启动、响应处理及测试流程是否正常，不作为正式性能成绩。

### 3. 查看结果

打开 `.tmp/benchmark/results/<batch-id>/summary.md` 查看本次报告。指标含义见[结果与指标](#结果与指标)；需要比较性能时，继续阅读下面的 HTTP 测试。

## 选择测试套件

| 套件           | 测量范围                           | 用途             |
| -------------- | ---------------------------------- | ---------------- |
| **HTTP**       | 请求处理、路由、JSON 解析及响应    | 框架间性能比较   |
| **Parser**     | HTTP 连续输入与分片解析            | 解析器性能分析   |
| **Breakdown**  | 组件微基准、并发矩阵及 CPU Profile | 框架内部性能诊断 |
| **Streaming**  | 流式吞吐、首字节时间、内存及背压   | 流处理性能分析   |
| **Production** | 业务路由、Redis 缓存及 SQLite 读写 | 完整业务链路评估 |

HTTP Suite 主要比较 Nova、Node.js 原生 HTTP 与 Fastify 的请求处理性能。其他 Suite 使用各自的负载配置和测量指标，不直接参与 HTTP QPS 排名。

## HTTP 测试

HTTP 套件测量完整请求链路，包括路由匹配、请求体处理、中间件执行和响应输出，用于跨框架或 Nova 版本间的性能比较。

通过四类参数配置测试，彼此独立，可按需组合：

| 参数         | 决定什么                     | 示例                     |
| ------------ | ---------------------------- | ------------------------ |
| `--scenario` | 测什么请求场景               | `json-small`             |
| `--profile`  | 预热多久、测量多久、重复几轮 | `pr`                     |
| `--load`     | 连接数与每连接流水线深度     | `pipeline-10`            |
| `--targets`  | 比较哪些实现                 | `nova-current,node-http` |

### 测试场景

| 场景（Scenario） | 请求                 | 测量重点              |
| ---------------- | -------------------- | --------------------- |
| `json-small`     | `GET /`              | 固定 JSON 响应        |
| `text`           | `GET /`              | 固定文本响应          |
| `params-query`   | `GET /:id?key=value` | 路径与查询参数        |
| `json-echo`      | `POST /`             | JSON 请求体解析与回显 |
| `middleware-5`   | `GET /`              | 五层同步中间件        |

### 测量配置

#### 测量时长与轮数（Profile）

| Profile | 每轮预热 | 每轮测量 | 轮数 |
| ------- | -------: | -------: | ---: |
| `smoke` |       1s |       1s |    1 |
| `pr`    |      10s |      10s |    3 |
| `full`  |      40s |      40s |    3 |

#### 连接数与流水线深度（Load）

| Load          | 连接数 | 每连接流水线深度 |
| ------------- | -----: | ---------------: |
| `pipeline-1`  |    100 |                1 |
| `pipeline-10` |    100 |               10 |

未指定 `--load` 时，`smoke` 使用 `pipeline-1`，`pr` 和 `full` 使用 `pipeline-10`。

### 运行示例

- **日常比较：参数路由场景**

  ```sh
  pnpm --filter @nova-http/benchmarks bench \
    --profile pr \
    --load pipeline-10 \
    --scenario params-query
  ```

- **正式测量：JSON 响应场景**

  ```sh
  pnpm --filter @nova-http/benchmarks bench \
    --profile full \
    --load pipeline-10 \
    --scenario json-small
  ```

### 选择测量目标

通过 `--targets` 指定参与测量的实现。

| 目标                | 说明                     |
| ------------------- | ------------------------ |
| `nova-current`      | 当前工作区构建的 Nova    |
| `nova-baseline`     | 指定基线目录构建的 Nova  |
| `node-http`         | Node.js 原生 HTTP 服务   |
| `fastify-schema`    | 启用 Schema 的 Fastify   |
| `fastify-no-schema` | 未启用 Schema 的 Fastify |

比较 Nova 与 `node:http`：

```sh
pnpm --filter @nova-http/benchmarks bench \
  --targets nova-current,node-http
```

比较 Nova 不同源码状态时，使用 `--baseline-root` 指定另一个已安装依赖的 checkout：

```sh
pnpm --filter @nova-http/benchmarks bench \
  --profile pr \
  --baseline-root /absolute/path/to/baseline \
  --targets nova-baseline,nova-current
```

所有 Target 使用相同的场景与负载，在同一 Runner 中分别启动并测量，按轮次轮换执行顺序，避免同时压测造成资源竞争。

优先比较同一批次内的结果。跨批次时，通过相对于 `node:http` 的变化间接分析性能差异。

## 结果与指标

### 结果文件

临时数据统一写入被 Git 忽略的 `.tmp/benchmark/`：

```text
.tmp/benchmark/
├── results/
│   └── <batch-id>/
│       ├── manifest.json
│       ├── <target-id>.json
│       └── summary.md
└── work/
```

| 文件               | 内容                              |
| ------------------ | --------------------------------- |
| `manifest.json`    | 批次身份、Suite、场景、负载与目标 |
| `<target-id>.json` | 环境、源码、原始轮次及统计结果    |
| `summary.md`       | 当前批次的可读报告                |
| `work/`            | Baseline checkout 及临时工作文件  |

PR 和 RC 的结果通过 GitHub Actions Artifact 保存，不直接提交至 Git。

### 核心指标

| 指标       | 含义                    |
| ---------- | ----------------------- |
| QPS        | 每秒完成的请求数        |
| p99        | 请求延迟第 99 百分位    |
| CV         | 多轮 QPS 的相对波动程度 |
| Throughput | 单位时间内的数据传输量  |
| Error Rate | 请求失败比例            |
| CPU / RSS  | 处理器与内存资源开销    |

### 如何解读结果

- **先看有效轮数与 CV**：结果波动明显时，优先检查环境与负载稳定性。
- **保持环境一致**：不同环境下的 QPS 不应直接用于计算正式性能提升。
- **谨慎判断提升**：少量轮次主要提供描述统计，不足以单独证明统计显著性。

## 诊断与专项测试

### Parser：解析器效率

评估 HTTP Parser 在不同报文结构、Header 规模及输入分片条件下的解析效率。

```sh
pnpm --filter nova-http build

pnpm --filter @nova-http/benchmarks bench:parser
pnpm --filter @nova-http/benchmarks bench:parser:native
```

### Breakdown：内部开销与热点

Breakdown 用于解释 HTTP 整体性能变化，定位内部组件开销，以及分析不同运行环境之间的性能差异。

| 分析维度     | 测量内容                 |
| ------------ | ------------------------ |
| 组件微基准   | 组件独立执行成本         |
| 负载矩阵     | 并发连接数与流水线深度   |
| 资源采样     | 客户端与服务端 CPU、内存 |
| CPU 性能剖析 | 热点函数与调用开销       |

```sh
pnpm --filter @nova-http/benchmarks bench:breakdown --preset smoke
```

### Streaming：流式响应与背压

分析流式响应的吞吐、首字节时间、内存占用及背压行为。

```sh
pnpm --filter nova-http build
pnpm --filter @nova-http/benchmarks bench:stream
```

### Production：完整业务链路

模拟包含业务路由、Redis 和 SQLite 的完整应用链路。

```sh
# 启动场景服务
pnpm --filter @nova-http/benchmarks bench:production

# 执行压力测试
pnpm --filter @nova-http/benchmarks bench:production:stress
```

- `bench:production` 仅启动服务
- `bench:production:stress` 负责服务编排、预热、压测、资源采样和清理

## 开发与发布流程

Benchmark 按开发生命周期组织测试，区分快速验证、增量比较与正式测量。

工作流按职责拆分，日常检查不会触发正式归档：

| 工作流                    | 触发方式        | 职责                                                             |
| ------------------------- | --------------- | ---------------------------------------------------------------- |
| `benchmark.yml`           | PR、Master Push | PR Base/Head 对比；Master Smoke                                  |
| `benchmark-rc.yml`        | 手动            | 指定 Previous Release、Scenario 和 Load，生成 Full 候选 Artifact |
| `benchmark-archive.yml`   | 手动、归档 PR   | 验证候选来源并创建只追加归档 PR；校验归档 PR                     |
| `benchmark-breakdown.yml` | 手动            | 内部诊断矩阵与 CPU Profile，不进入 HTTP 正式排名                 |

| 阶段        | 目标               | 测试内容                     | 结果                |
| ----------- | ------------------ | ---------------------------- | ------------------- |
| **Local**   | 快速验证与瓶颈定位 | 快速验证、定向比较、内部诊断 | 本地临时数据        |
| **PR**      | 检测性能回归       | Base ↔ Head，相关场景        | 汇总报告 + Artifact |
| **Master**  | 验证集成稳定性     | CI + Smoke                   | CI                  |
| **RC**      | 建立正式性能基线   | 完整性能比较                 | 候选 Artifact       |
| **Release** | 固定性能记录       | 验证、报告与归档             | Git 长期归档        |

### Local · 开发与诊断

本地按需运行测试，建议按以下顺序进行：

1. **快速验证（Smoke）**：确认测量链路正常
2. **定向比较（Focused Compare）**：选择相关场景和目标，分析性能变化
3. **专项诊断（Diagnostics）**：通过 Parser、Breakdown 等测试定位瓶颈

本地结果保存在 `.tmp/benchmark/`，不进入长期归档

### PR · 增量比较

**比较对象：`PR Head` ↔ `PR Base SHA`**

PR 分别执行正确性检查和相关性能测试。

- 根据修改范围选择对应 Scenario 与 Suite。
- Base 与 Head 使用相同的 Runner、Driver 和 Load。
- 汇总 QPS、p99、CV 及相对变化。
- 将结果写入 Actions Summary，并可更新 PR 评论。
- 原始测量记录通过 Artifact 保存，不进入长期归档。

当前自动比较使用稳定的 `json-small` + `pipeline-10` 组合；其他场景按修改范围通过本地或 RC 工作流定向执行。

### Master · 集成验证

Master 主要执行完整 CI 和 Benchmark Smoke，验证合并后的构建及测量链路。

不因每次合并自动执行完整框架性能比较。需要进一步分析时，可手动触发专项测试。

### RC · 完整比较

**比较对象：`Release Candidate` ↔ `Previous Release`**

完整性能比较（Full Compare）使用固定环境与测试方法，建立正式性能基线。

| 套件       | 测试范围                                         |
| ---------- | ------------------------------------------------ |
| HTTP       | 全部稳定 Scenario × `pipeline-1` / `pipeline-10` |
| Parser     | 固定报文及分片输入矩阵                           |
| Breakdown  | 组件微基准与负载矩阵                             |
| Streaming  | 吞吐、TTFB、背压及资源指标                       |
| Production | 独立执行，按需纳入报告                           |

HTTP 测量同时包括 Nova Current、Previous Release、`node:http` 和 Fastify 对照。

各 Suite 可以独立执行，每个完整 Batch 经验证后保存为候选 Artifact。

在 Actions 中运行 `Benchmark RC candidate`，填写不可变的 Previous Release tag 或 commit、Scenario 和 Load。一个工作流运行生成一个可独立校验的 HTTP Batch；完整发布矩阵由各 Batch 共同组成。

### Release · 正式归档

Release 对已完成的正式测量进行验证和归档，不默认重复执行相同测试。

在 Actions 中运行 `Benchmark archive`，填写候选运行的 Run ID 与 Run Attempt。填写 Release Tag 时写入 `releases/<tag>/`；留空时写入 `historical/`。工作流只创建归档 PR，不直接写入受保护分支。

归档要求：

- 发布源码与被测源码一致。
- 测量成功，原始轮次完整。
- 测量环境、负载及方法身份明确。
- Artifact 来源及内容验证通过。
- 数据只追加，不修改已有成绩。

## 数据归档

Benchmark 区分临时结果与长期归档，以一次完整测量 **Batch** 为最小数据单位。

### 长期归档

`.benchmark/` 用于保存可追溯的正式性能记录，按数据来源划分为 Historical 与 Releases：

```text
.benchmark/
├── README.md
├── historical/
│   └── http-v1/
│       └── <batch-id>/
│           ├── manifest.json
│           └── <target-id>.json
│
└── releases/
    └── <release-tag>/
        ├── manifest.json
        ├── http-v1/
        │   └── <batch-id>/
        ├── parser-v1/
        │   └── <batch-id>/
        ├── breakdown-v1/
        │   └── <batch-id>/
        └── streaming-v1/
            └── <batch-id>/
```

| 目录          | 保存内容                           | 组织方式                                            |
| ------------- | ---------------------------------- | --------------------------------------------------- |
| `historical/` | 过去源码版本的基准初始化或补测结果 | 按测量批次保留原始记录，不按当前发布版本重新分类    |
| `releases/`   | 正式发布周期的性能测量结果         | 按发布版本组织，顶层 `manifest.json` 索引套件与批次 |

同一批次内可包含当前发布版本、Previous Release 及外部框架对照；这些记录共同构成一次可比较的实验。

### 归档规则

- **整批保存**：同一批次（Batch）的目标、配置及原始轮次共同归档。
- **只追加**：正式数据不覆盖、不修改。
- **可追溯**：记录提交、压测驱动、套件、数据结构版本、环境和 Artifact 来源。
- **可比较**：仅直接比较方法与负载相同的结果。
- **原始数据优先**：原始 JSON 为事实来源，报告由数据生成。

`.benchmark/http-v1/` 是历史遗留目录，仅用于兼容读取，新归档使用 `.benchmark/historical/http-v1/` 或 `.benchmark/releases/<tag>/http-v1/`。

### 报告生成

```sh
node packages/benchmarks/report/render.js
```

报告从正式归档数据生成，输出至：

```text
.tmp/benchmark/results/archive-summary.md
```

正式报告包含测量目标、环境、负载、原始轮次、统计结果、相对变化及已知限制。

## 验证测试工具

```sh
pnpm --filter @nova-http/benchmarks test
pnpm --filter @nova-http/benchmarks typecheck
```

工具测试覆盖适配器语义、流水线处理、进程清理、统计计算、结果完整性及归档规则。
