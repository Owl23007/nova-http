# Nova benchmark 实施规划

日期：2026-10-02。状态：本地实现与验证已完成，CI 对比和正式归档工作流已实现但尚未在远端验收，未生成正式性能数据。

当前包名为 `@nova-http/benchmarks`。本地验证覆盖 HTTP 当前目标、真实 npm 历史三版的语义与流水线 smoke、归档来源和恶意 Artifact 拒绝、进程生命周期、parser 与流式入口。Redis 生产联调、master 分支保护、正式 Action 试跑和历史正式初始化仍待完成。

历史初始化按原规划只创建一个归档 PR：fastify 与 no-pipeline 保持两个独立测量批次，每批在同一 job 测全部历史目标与对照。首批成功仅保留 Artifact，第二批通过 run ID 和确切 attempt 引用首批，两个批次来源与内容均验证通过后，在同一个 PR 追加两个批次目录，以第二批新增 manifest 标记 complete，不覆盖首批数据。第二批失败可复用有效首批 Artifact 恢复。使用说明见 `packages/benchmarks/README.md`。

## 目标与范围

将现有 `packages/nova-http/scripts/benchmark/` 提升为 `packages/benchmarks/`，建立独立的 private workspace package，由本地命令和 GitHub Actions 共用。`.benchmark` 仅保存归档数据，正式记录通过归档 PR 合并到 master；本地输出放在被 Git 忽略的 `.tmp/benchmark/`。历史初始化一次性覆盖实际发布的 nova-http 0.1.1、0.2.0、0.2.1，后续正常运行不再重复历史回测。

核心原则：**`.benchmark/` 是位于 master 中、由 GitHub Actions 管理的 append-only 生成数据目录；普通 PR 不允许修改，正式归档 PR 必须验证数据来源和完整性。**

实施依次为本地测量、CI 对比、正式归档。第一阶段先交付 benchmark engine 和 HTTP 本地测量，不要求 Redis 或 SQLite。HTTP、parser、production 各自保持独立 suite；现有解析器及生产场景迁入对应 suite 时保留场景语义和原有报告来源，不能和 HTTP 框架横向测试合成一个排行榜。套件自身测试位于 benchmarks package，不进入 nova-http 测试目录。

本规划位于 `docs/framework/performance/benchmark-plan.md`。下述内容保留原设计目标，实际完成范围及待验收事项以上述状态和套件 README 为准。

## 已核实的参考实现

- [Fastify benchmark](https://github.com/fastify/benchmarks)：autocannon，100 连接、pipelining 10、40 秒预热、40 秒测量。每个框架通过独立子进程运行，保存 JSON，生成比较表。
- [Fastify 场景](https://github.com/fastify/benchmarks/blob/main/benchmarks/fastify.cjs)：GET `/` 返回 `{ "hello": "world" }`，配置响应 JSON schema。Nova 比较时保留这个优化配置，同时增加明确命名的 Fastify 无 schema 对照。
- [Fastify 自动化](https://github.com/fastify/benchmarks/blob/main/.github/workflows/benchmarks.yml)：主分支更新、定时和手动触发，将汇总写回主分支。Nova 使用同仓库归档 PR，再合并到 master。
- [Hono HTTP benchmark](https://github.com/honojs/hono/tree/main/benchmarks/http-server)：比较主分支和当前版本。Nova 借鉴其版本对比用途，但统一采用 autocannon。
- [Node.js benchmark](https://github.com/nodejs/node/blob/main/doc/contributing/writing-and-running-benchmarks.md)：多次测量和统计比较。Nova 保存每轮结果，初期展示中位数、均值和波动，不用单次百分比作为强制性能门禁。

Fastify 的仓库测试是基准方法，不是认证标准。其收录规则要求使用 Node HTTP 模块；Nova 基于 TCP，因此本方案对齐测试方法，不承诺满足该榜单的收录条件。GitHub 托管 runner 有环境噪声，不能直接拿不同机器的官网 QPS 进行排名。

## 目录与本地隔离

拟定目录：

```text
packages/benchmarks/
  package.json               # private: true，独立命令和 benchmark 专用依赖
  README.md                  # 套件使用方式和职责说明
  vitest.config.ts           # benchmark 自身测试配置
  runner/                    # CLI、目标生命周期、轮次、超时、清理、suite 调度
  adapters/                  # Nova 当前/历史版本、Fastify、node:http 目标适配
  config/                    # profiles、目标配置、历史初始化 manifest
  report/                    # metadata、schema、统计、比较、Summary、promote
  suites/
    http/                    # HTTP 场景、autocannon 驱动、响应校验
    parser/                  # 解析器场景、输入分片、微基准驱动
    production/              # 业务场景、测试应用及 Redis/SQLite 接入
  tests/                     # engine、adapter、suite、report 和归档测试
docs/framework/performance/
  index.md                   # 使用方法与归档数据入口
  benchmark-plan.md          # 实施规划
.github/workflows/
  benchmark.yml
  # 1. PR 对比与正式测量，输出 Summary/Artifact
  # 2. 正式测量成功完成后 promote、创建临时归档 PR
  # 3.PR 数据权限、provenance、schema、只追加检查
.benchmark/
  http-v1/
    <run-id>-<attempt>/
      manifest.json          # 一次完整测量批次的来源和目标
      <target-id>.json        # metadata、各轮原始指标和统计结果
.tmp/
  benchmark/
    results/                 # 本地及 CI 未归档结果、日志，忽略
    work/                    # 历史包、安装、构建与临时运行目录，忽略
```

新包拟命名为 `@nova/benchmarks`，设置 `private: true`。现有 workspace 的 `packages/*` 已覆盖该目录，无需为它增加通配规则。autocannon、Fastify、解析器对照工具和套件测试依赖均由该包管理，使用精确版本并复用根目录 `pnpm-lock.yaml`；不进入 nova-http 的 devDependencies，也不维护第二份锁文件。停止通过 `npm exec --yes autocannon` 临时获取压测工具。

当前 Nova 目标由 benchmarks 包声明 `nova-http: workspace:*`，调用前构建被测包；历史 npm 包隔离安装在 `.tmp/benchmark/work/`只用于初始化历史版本的测试。明确区分 workspace 当前构建和历史包入口。旧 bench 命令在迁移期仅委托到新包，不建立 nova-http 对 benchmarks 的包依赖。

拟使用 `pnpm --filter @nova/benchmarks bench`、`pnpm --filter @nova/benchmarks test` 和包内独立 typecheck 命令。根目录 bench 命令仅作为可选别名。普通 test/typecheck 不启动正式长时间压测或历史回测，production 外部服务测试明确单独触发。

职责约定：runner 只管理执行流程，不知道 Fastify 或旧 Nova 的业务细节；adapters 提供目标身份、能力和启动/停止接口；suites 定义输入、测量方式及正确性校验；report 消费结构化结果，负责数据输出与归档。HTTP 使用 autocannon，parser 使用微基准计时，production 使用业务压力场景，不强制三个 suite 共用同一压测工具或排行榜。

现有 `.gitignore` 已包含：

```gitignore
**/.tmp/**
.tmp/*
```

直接复用这套忽略规则，不为 `.benchmark` 增加本地目录。CLI 根据仓库根目录定位输出，不受调用工作目录影响。所有常规 bench 命令默认写入 `.tmp/benchmark/results/`；历史安装和构建写入 `.tmp/benchmark/work/`。

CLI 不提供把默认输出重定向到正式归档目录的便捷选项。正式 Actions 流程通过 promote 校验后复制 JSON 到 `.benchmark/<suite-version>/<run-id>-<attempt>/`，临时归档 PR 必须通过 provenance、schema 和只追加检查后才能进入 master。普通提交和普通 PR 禁止新增、修改或删除 `.benchmark/**`；不以人工审核批准替代正式来源校验。仅检测 `CI=true` 不构成可信来源验证。

不忽略整个 `.benchmark` 或全部 JSON，也不把已经跟踪的数据当作本地输出。现有旧脚本逐步迁移或委托到新包的统一 CLI，使每一个本地 benchmark 入口都遵循忽略规则。原生产 suite 的历史报告保留来源标识，后续新输出统一进入 `.tmp/benchmark/`。

## 如何实现测量

### HTTP 场景

| 场景           | 配置和目的                                                      |
| -------------- | --------------------------------------------------------------- |
| `json-small`   | GET `/`，返回固定 `{ "hello": "world" }`，直接对齐 Fastify 基准 |
| `text`         | 固定文本响应，测量基础响应开销                                  |
| `params-query` | 参数路由和查询读取，验证真实读取参数而非返回常量                |
| `json-echo`    | 固定 JSON POST，解析请求后原样回显，统一请求体大小              |
| `middleware-5` | 同语义的五层同步中间件；作为扩展测试单独报告                    |

`json-small` 不全局挂载请求体解析中间件；JSON POST 单独安装必要的解析能力。保持各框架应用响应的 body、状态码、content-type 一致，记录框架自行生成的额外响应头。不能声称整个 HTTP 响应逐字节相同。

初始对照包含 Fastify schema、Fastify 无 schema、node:http；同一批次运行 Nova 被测版本。使用同一精确 Node 24 版本、runner 镜像标签和锁定依赖，关闭日志，逐个目标顺序压测，不并行抢占 CPU。

### Profiles

| Profile       | 连接 | Pipelining | 每轮预热 | 每轮测量 | 正式轮数 | 用途                             |
| ------------- | ---: | ---------: | -------: | -------: | -------: | -------------------------------- |
| `smoke`       |   10 |          1 |     1 秒 |     1 秒 |        1 | 验证驱动和接口，不能当作性能成绩 |
| `pr`          |  100 |         10 |    10 秒 |    10 秒 |        3 | PR 快速对比，独立标注 profile    |
| `fastify`     |  100 |         10 |    40 秒 |    40 秒 |        3 | 正式归档与历史初始化             |
| `no-pipeline` |  100 |          1 |    40 秒 |    40 秒 |        3 | 扩展验证正常非流水线负载         |

Fastify 参考实现使用一次预热和一次测量；这里正式重复三轮是 Nova 的稳定性增强，不能描述为 Fastify 的原始要求。

每一轮重新启动服务进程，等待就绪，检查响应语义，完整预热，再启动正式 autocannon 测量，最终停止进程。每轮轮换目标执行顺序并记录顺序；baseline、target 和对照在同一 job 中配对测量。

服务就绪超时、异常退出、压测异常均有有限超时和 finally 清理。结果不得因字段缺失而自动填充为零。连接错误、超时和 non-2xx 分别保存；失败轮次保留原因，不进入成功成绩统计。

正式开始和结束时均做接口校验；并使用驱动提供的响应校验能力抽样检查测量期间的 body，保存抽样频率和失败计数。对流水线请求补充顺序与响应完整性验证。三轮只提供初步波动信息，统计不显著时不能宣布性能改善。

## Metadata 与结果格式

每条目标记录保存以下信息，schemaVersion 从 1 开始：

| 类别     | 必须保存的字段                                                                              |
| -------- | ------------------------------------------------------------------------------------------- |
| 套件身份 | suite ID/version、驱动提交、adapter 版本、配置摘要                                          |
| 被测目标 | package/version、来源类型 npm 或 checkout、实际测试 SHA 或 tarball integrity、baseline 身份 |
| 执行来源 | run ID、run attempt、run URL、event、PR 号、workflow ref；本地运行明确标为 local            |
| 环境     | 精确 Node、autocannon、Fastify 版本，OS/架构、CPU 型号/可用核数、内存、runner 镜像版本      |
| 负载     | profile、场景、连接数、pipelining、请求方法/body 大小、预热/测量时长、轮数和执行顺序        |
| 测量结果 | 每轮 requests/s、吞吐、p50/p90/p99、均值延迟、错误、超时、non-2xx、语义校验失败             |
| 统计     | 有效轮数、QPS 中位数/均值/标准差/CV、每轮 p99 与其统计摘要                                  |
| 完整性   | 原始 JSON 摘要、采集时间、失败原因和重测关联                                                |

每轮 p99 的平均数或中位数仅是轮次统计，不等于全部请求合并后的 p99。CPU/RSS 采样使用服务器进程数据，作为扩展诊断；首版正式主成绩采用轻量采集，保持所有目标的采样开销一致。

不存整个环境变量或 secrets。无法核实的 Git SHA、runner 字段明确写 null 和原因，不制造来源。PR head SHA 与实际构建的 merge SHA 分开记录。驱动 SHA 与被测源码 SHA 分开记录，即便双方 package.json 的版本相同。

`.benchmark/**/*.json` 是唯一事实来源，归档目录仅接受规定的 JSON 文件。summary.md、文档页、表格和趋势图从这些 JSON 生成或读取；生成的 Markdown 留在 `.tmp/benchmark/`、Action Summary、Artifact 或文档构建输出中。调整展示方式不修改历史 JSON。配置或场景语义变更时升级 suite version；不同 profile、suite 或显著不同环境分开呈现。

正式批次的 manifest.json 必须包含 repository、runId、runAttempt、workflowId、workflowPath、commitSha、suite/version、profile，以及包含 runId/runAttempt 的唯一 artifactName 和目标 JSON 文件列表。commitSha 指正式测量 workflow 的 head SHA，必须可由 GitHub API 核实；它不是归档 PR 的 head SHA，也不代替历史 npm 包的 tarball integrity 或被测目标身份。多目标与多 suite 的记录按 manifest 声明完整对应。

Artifact ID 在上传后由 GitHub 返回，记录于 Action 输出和归档 PR 描述；不要求上传前把尚不存在的 ID 写入被上传的 manifest。PR 校验器从 run API 与唯一 artifactName 查询真实 Artifact ID，并下载核对文件集合及内容，不能信任 PR 描述中的 ID 自述。

## 如何测试套件

不使用“QPS 必须大于固定值”的单元测试。测试应验证执行、数据和归档是否正确。

1. 目标与场景：验证已接入 adapter 的响应内容、状态码、content-type、参数读取、JSON 解析和流水线顺序；旧版适配逻辑可使用 fixtures 验证，历史初始化时才对实际旧包执行完整 smoke。
2. 进程生命周期：模拟启动超时、服务中途退出、压测失败、取消运行，验证报错与清理，不遗留监听进程。
3. 驱动编排：预热结果不计分、轮次独立、失败不产生成功成绩、配置传递一致、原始数据能重算统计结果。
4. Metadata/schema：拒绝缺字段、非法数值、混淆 SHA、结果与目标不匹配；摘要变化可检出，但摘要不证明测量真实。
5. 归档：普通 PR 新增、修改、删除任意归档文件都失败；正式归档 PR 只允许新增批次。重复批次、目录逃逸、符号链接、修改或删除历史 JSON、混入脚本、Markdown 或临时文件均失败；展示文件可从 JSON 重生成。
6. 本地隔离：运行短 smoke 后，`git status` 不出现本地结果，`git check-ignore` 命中 `.tmp/benchmark/`，而正式 `.benchmark` 数据能被跟踪；归档目录中不允许套件源码或依赖文件。
7. 工作流：PR 测量没有写权限；正式归档 PR 仅修改 `.benchmark` 数据；结果专用 PR 不再次压测；新 PR 提交使旧成绩失效。
8. 包边界：benchmark 专用依赖仅在 benchmarks 包中声明；包自身测试从 tests/ 运行；HTTP、parser、production 输出各自 suite ID 和指标，不误用 HTTP profiles 测 parser，不把缺失目标能力当作成功。
9. Provenance：允许的成功正式 workflow、正确 attempt、SHA、Artifact 与 schema 全部匹配时通过；伪造分支/label、普通用户冒充归档 PR、不存在的 run、错误仓库/事件/workflow、失败或未完成 run、错 attempt/SHA、缺失 Artifact、JSON 与 Artifact 内容不一致时失败。API 不可用或证据不足时不降级放行。

验证随实施阶段推进：第一阶段运行包自身测试与当前目标本地 smoke；第二阶段验证 CI baseline 配对、Summary 与 Artifact；第三阶段验证 promote、归档 PR 和一次正式 profile 试跑。正式归档链路稳定后，才执行一次历史初始化 smoke 与回测。首次正式试跑用于检验机器噪声与运行预算，不提前设定百分比回退门槛。

## GitHub Actions 与 PR 归档：五条规则

1. **取消长期 benchmark 分支。** 数据直接保存在 master 的 `.benchmark/`，它是后续文档、Markdown 和趋势图的统一数据源。归档 PR 只用临时分支，合并后删除，不维护长期数据分支。
2. **Action 管理生成目录。** 普通提交和普通 PR 禁止新增、修改、删除 `.benchmark/**`。只有允许的正式 GitHub Actions 流程生成的数据能够通过归档 PR 进入 master，维护者审核不能豁免来源要求。
3. **PR 强制数据校验。** 普通 PR 触碰归档目录即失败；正式归档 PR 只允许追加全新批次。对最新 master 检查新增路径和文件状态，禁止修改、覆盖、重命名或删除已有历史数据；新批次必须通过 schema、目录结构和 metadata 校验。
4. **验证 Action 来源及完整性。** 根据 manifest 查询本仓库对应 run 和确切 runAttempt，要求真实存在、completed/success、head SHA 一致，并匹配正式 workflow 的 ID/path、允许的事件及 master 来源。PR 本身也必须由允许的 Action 机器人创建于本仓库的临时分支。branch 名和 label 仅用于识别流程，不是可信来源。进一步下载对应 Artifact，确认待归档 JSON 文件集合与内容一致，防止引用真实 runId 后手工伪造结果。
5. **JSON 是唯一事实来源。** `.benchmark/**/*.json` 保存所有 metadata、原始各轮指标和统计结果。summary.md、文档页、表格和趋势图均由这些 JSON 生成或读取；后续展示方式调整不改历史数据。

最终流程：

```text
Benchmark Action
      ↓
.tmp/benchmark/        # 临时结果
      ↓
校验 / promote
      ↓
临时归档 PR
      ↓
PR provenance + schema + append-only 检查
      ↓
master/.benchmark/     # Action 管理、只追加 JSON
      ↓
docs / Markdown / charts
```

第二阶段增加 benchmark workflow，与现有 CI Required 分开，PR baseline 对比只生成 Summary/Artifact。第三阶段再加入正式归档、promote 和归档 PR；此前没有写入 `.benchmark` 的自动化。第三阶段将 benchmark 数据校验设置为 master 的必需检查，耗时的性能测量初期作为参考。

| 触发                 | 执行                                                                | 写入 master             |
| -------------------- | ------------------------------------------------------------------- | ----------------------- |
| 代码 PR              | 同 job 测量目标分支 baseline 和 PR 实际构建版本；summary + Artifact | 不直接写入              |
| master 相关代码变更  | 正式 profile，运行被测提交和对照                                    | 生成归档 PR，审核后合并 |
| 一次性历史初始化     | 正式归档链路就绪后，固定三版 manifest 顺序回测                      | 一个初始化归档 PR       |
| 定时                 | 正式 profile 检查当前 master                                        | 生成新批次归档 PR       |
| 正式归档 PR          | provenance、schema、目录结构、metadata 与只追加校验；跳过重测       | 全部通过后审核合并      |
| 普通 PR 修改归档数据 | 直接失败，不接受手工新增或更改                                      | 禁止进入 master         |
| 仅文档展示更新       | 从 JSON 生成或读取展示，跳过性能测量                                | 正常 PR，历史 JSON 不变 |

按改动路径过滤框架源码、依赖、`packages/benchmarks/` 与 workflow。必需检查不能因 paths filter 完全不运行而永久 pending：采用始终触发的轻量校验 job，条件跳过重测 job。PR 对比使用同一套驱动配置测 baseline 与 target。如果 PR 修改方法学，单独展示套件变化，不与旧套件成绩直接比较。三版历史目标不出现在常规 PR、master、定时或普通手动测量的目标列表中。

测量 job 保持 contents: read，checkout 不持久保存凭据。正式测量 workflow 成功结束后，benchmark-archive workflow 通过 workflow_run 的 completed 事件启动；重新核实成功状态和正式来源，避免在同一个尚未完成的测量 run 内创建 PR 时，provenance 检查无从确认 run 已成功。归档 workflow 的自身身份单独记录，不冒充测量 runId。

归档 job 在新 runner 中处理白名单 JSON，使用 actions: read、contents: write 和 pull-requests: write；只使用受保护的 master 归档代码，不执行被测 PR 或 Artifact 内脚本。数据检查 job 使用受保护的基准分支校验逻辑和只读权限，从 API 或 Git diff 读取 PR 数据，不能执行 PR 提供的校验器。不采用 pull_request_target 执行被测 PR。

归档 PR 分支采用 `codex/benchmark-<run-id>-<attempt>`，只新增 `.benchmark/<suite-version>/<run-id>-<attempt>/` 的该批次 JSON；合并后删除临时分支，已有批次不可覆盖。因噪声或失败重跑时追加记录，manifest 写明 replaces/supersedes 关系。Artifact 用于合并前来源校验，必须在过期前完成核验；过期或被删除时不能凭 manifest 自述放行。master 中 JSON 保留完整的各轮指标，合并后的长期阅读不依赖 Artifact 是否过期。

测量中转目录 `.tmp/benchmark/results/` 和正式 `.benchmark` 都位于隐藏目录。上传 Artifact 仅指定需要的结果目录并显式启用 include-hidden-files，不能上传整个工作区；采用 if-no-files-found: error，防止空归档。

使用 GITHUB_TOKEN 创建归档 PR 前需启用仓库允许 Actions 创建 PR 的设置。按照当前 GitHub 文档，这类 PR 的 opened/synchronize/reopened CI 会进入等待批准状态；维护者批准运行后再通过正常合并检查。首版接受这一人工步骤，保持方案简单，不额外部署 GitHub App。

通过 CODEOWNERS 保护 `.benchmark`、`packages/benchmarks/`、benchmark workflows 和 CODEOWNERS 本身；master 要求 owner 审核及最新变更重新审核，并禁止绕过必需检查直接提交数据。benchmark 数据检查使用受保护的逻辑，API 白名单和 schema 不取自 PR 可修改的文件。普通 PR 即便有 owner 审批，仍不能修改归档数据；正式归档 PR 必须同时通过 provenance、schema 和只追加检查。本方案不承诺管理员无法更改仓库规则。

## 0.1.1 至 0.2.1 历史初始化

历史回测仅用于首次建立基线，在第三阶段完成后显式触发一次。历史 manifest 位于 benchmarks 包的 config/，其来源和实测结果写入初始化归档。常规运行只测当前提交、所需 baseline 和对照，不重复安装或回测这三个历史版本。

本地标签与 npm registry 已核实：

| 发布版本 | 本地标签          | 来源注意事项                                                                                                         |
| -------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| 0.1.1    | `0.1.1`           | 标签提交 292141a0e28cd19c4ea00d777a21220592952b51；npm gitHead 为 e598dda524228e8a55c9c9830378a2d58ab9fd55，二者不同 |
| 0.2.0    | `nova-http@0.2.0` | 标签提交 2cd6c8a8c22bb9ce03c656c802a951217eee033a；npm 无 gitHead                                                    |
| 0.2.1    | `nova-http@0.2.1` | 标签提交 2c28f8efa311e21fc156ff25ee4ffb0a30767364；npm 无 gitHead                                                    |

范围内实际发布的稳定版本只有这三个，不为不存在的 0.1.x 版本编造条目。执行前再次核对 registry，并把本次选定版本列表固化在 historical manifest。

历史初始化以 npm 精确版本包为测量对象，记录 registry 发布时间、tarball URL 和 sha512 integrity，安装前验证完整性。采用忽略 install scripts 的隔离安装，使用同一份新驱动测三个版本，不使用旧版本自带的压测脚本。不将同版本标签默认视为发布包源码的证明。

旧 adapter 只适配导出和公共 API：例如 0.1.1 标签中请求体解析结果位于 req.bodyParsed，当前工作区脚本使用 context 路径。必须检查实际 npm 包后确定适配；不修改旧包实现，不在 adapter 中实现额外缓存或优化。

初始化步骤：

1. 固定 Node 和对照依赖，固化三个版本的包完整性和 suite version。
2. 三个发布包的所有首阶段场景先通过语义和流水线 smoke。
3. 在同一个 GitHub Actions runner/job 内，按 `fastify` profile 测三个版本、Fastify schema、Fastify 无 schema、node:http；每个目标三轮。
4. 首批正式必测 `json-small`。其六个目标耗时约 24 分钟纯压测，另加安装、校验和清理；job 预留 45 分钟。
5. 扩展场景分为后续 job，每个 job 重测其所需的完整目标组；不能把不同 job 的绝对 QPS 当作同机结果拼接。首批另用 `no-pipeline` 验证历史实现的适用负载。
6. 保存真实测量结果及失败记录，生成版本趋势表和对照比值；无效结果显示 failed 或 unsupported，绝不填零伪装成成功。
7. 创建初始化归档 PR，合并后数据留在 master 的 `.benchmark/http-v1/`。这是在当前环境回测历史发布包，measuredAt 使用实际运行时间，不冒充当年的测量。

初始化 manifest 标记 kind: historical-initialization，并记录已完成的版本、suite、profile 组合。相同初始化已完整归档时拒绝重复运行；中断或失败后只恢复未完成组合，不自动重跑已完成项。若恢复发生在新 runner，保存为新的测量批次，并重测该批次需要的对照；跨批次结果不能假定环境一致。

如正式测量存在任何失败，失败原因与已完成结果暂留 `.tmp/benchmark/`、Summary/Artifact，不能从失败的 Actions run promote 到正式归档；历史初始化状态保持 incomplete。恢复运行成功后才能提交对应正式批次，并在覆盖全部组合后以新增 JSON 标记 complete，不能改写已有初始化记录。历史 registry 信息可以先生成 config manifest，QPS 等 data 必须实测后生成。后续套件升级不自动触发历史回测。

## 实施顺序与完成条件

| 阶段         | 实施内容                                                                                                                                                       | 验收结果                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 一：本地测量 | 新建 private workspace package，迁移 engine 和 HTTP adapters，按 runner/adapters/config/report/suites/tests 重组；预留独立 parser、production suite 并逐步迁移 | 包自身测试和当前目标 smoke 通过，本地结果全部写入被 Git 忽略的 `.tmp/benchmark/`；不写正式归档                        |
| 二：CI 对比  | 构建 baseline 和 PR 目标，使用同一套件配对测量，生成 Summary/Artifact                                                                                          | 无写权限和归档 PR；结果含完整来源、环境、负载与有效轮次；常规 CI 不触发历史回测                                       |
| 三：正式归档 | 增加正式测量、promote、临时归档 PR、provenance/schema/metadata/只追加校验、CODEOWNERS                                                                          | 普通 PR 触碰归档目录即失败，正式批次来源与 Artifact 可核实；只追加 JSON 到 master 的 `.benchmark`，合并后删除临时分支 |
| 一次性初始化 | 三阶段完成后回测 0.1.1、0.2.0、0.2.1，生成一个初始化归档 PR                                                                                                    | 三版真实 data 完整，初始化标为 complete；后续常规运行不重复回测                                                       |

最终完成条件：benchmark 独立包拥有全部专用依赖与自身测试；三个 suite 保持独立身份和测量方式；统一入口能本地和 CI 执行；正式 profile 可复现；规定目标通过语义验证；历史三版仅初始化一次且真实 data 完整；每条数据含来源、环境、负载和各轮原始指标；本地结果全部被 Git 忽略；普通 PR 对归档数据的新增/修改/删除全部被拦截；正式归档 PR 验证成功 run、workflow、attempt、SHA、Artifact 内容、schema 和只追加规则；数据只留在 master，没有长期 benchmark 分支；Markdown 和图表只读取 JSON。

本阶段不把本地试跑结果自动标成正式数据，不合并 PR，不创建虚构性能成绩。

## 实施参考链接

- [Fastify 进程编排](https://github.com/fastify/benchmarks/blob/main/lib/bench.js)
- [Fastify 本地结果与比较](https://github.com/fastify/benchmarks/blob/main/lib/autocannon.js)
- [Fastify 忽略规则](https://github.com/fastify/benchmarks/blob/main/.gitignore)
- [GitHub 分支保护](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub workflow 触发与 GITHUB_TOKEN](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [Artifact 隐藏目录与上传选项](https://github.com/actions/upload-artifact)
- [GitHub Actions 安全边界](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub Actions run 与 attempt API](https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run-attempt)
- [GitHub Actions Artifact API](https://docs.github.com/en/rest/actions/artifacts#list-workflow-run-artifacts)
- [npm nova-http](https://www.npmjs.com/package/nova-http)
