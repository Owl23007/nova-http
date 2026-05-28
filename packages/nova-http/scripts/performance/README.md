# nova-http 性能测试

本套件作为一个完全独立的 ESM 项目，致力于构建贴近真实生产场景的 API 服务标杆，并提供自动化、全链路的压力测试体系与精细化并发性能指标采集能力。

## 架构与目录结构

- 📄 `package.json`：独立运行脚本入口，采用原生 ESM 标准构建。
- 📁 `src/app/`：被压测工程的核心 API 服务实现。
  - 📂 `core/`：核心引擎层，包含运行配置读取、应用框架初始化及监控指标采集。
  - 📂 `router/`：路由调度层，集中管理各业务子应用（SubApp）的挂载，包含 `routes.js` 和 `subapps.js`。
  - 📂 `infra/`：基础设施适配层，负责 SQLite 本地核心仓储与 Redis 客户端连接管理。
  - 📂 `middlewares/`：全局增强层，承载请求生命周期上下文、依赖注入及高频 API 计数等中间件。
  - 📂 `modules/`：业务领域模块，按细粒度领域拆分自治的独立服务实现与路由。
- 📁 `src/runner/`：自动化压力执行执行器，负责编排服务应用生命周期、调用 `autocannon` 压测并实时采样多维度硬件指标报告。
- 📁 `reports/`：压测评估输出目录，于运行时自动生成（被标记脱敏且默认跳过仓库提交）。

## 基础设施依赖

- 🗄️ **SQLite**：底层默认挂载绑定 `data/performance.sqlite` 物理结构文件，要求当前 Node 支持内置 `node:sqlite` 模块特性。
- 🚀 **Redis**：默认静默直连本地 `127.0.0.1:6379`。在整个基准及压力测试生命周期内均使用稳定真实服务，提供高频限流计数和缓存吞吐，确保测试结果最贴近生产。

## 快速上手与命令指引

套件预备了开箱即用的 NPM Script 等效指令，使得随时模拟并复现生产流量变得轻而易举：

```powershell
# 执行基准级生产流量负载模拟压测
pnpm -F nova-http run bench:production

# 挑战系统水位边界、发起高并发极限施压
pnpm -F nova-http run bench:production:stress
```

在测试前也可以用环境变量深度覆盖其默认调度策略配置：

```powershell
$env:STRESS_DURATION='60'            # 自由定制压测周期 (默认单位: 秒)
$env:STRESS_CONNECTIONS='500'        # 提升并设定并发链接压测的池体积
$env:PROD_API_REDIS_HOST='127.0.0.1' # 定制 Redis 远端实例 IP
$env:PROD_API_REDIS_PORT='6379'      # 定制 Redis 远端连接端口适配

pnpm -F nova-http run bench:stress
```
