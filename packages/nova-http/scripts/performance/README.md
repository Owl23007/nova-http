# Nova 性能测试套件

独立的 ESM 场景服务与压测执行器，测量路由、中间件、JSON、Redis 和 SQLite 共同参与时的请求处理表现。基准方法与历史报告入口见[性能验证](../../../../docs/framework/performance/index.md)。

## 环境

需要支持 `node:sqlite` 的 Node.js，和默认监听 `127.0.0.1:6379` 的 Redis。先从仓库根目录构建框架，并安装套件依赖：

```sh
pnpm -F nova-http build
pnpm --dir packages/nova-http/scripts/performance install
```

SQLite 默认使用 `data/performance.sqlite`，实际环境变量见 `src/app/core/config.js`。压测会写入测试数据，应使用独立环境。

## 运行

```sh
# 仅启动场景服务
pnpm -F nova-http bench:production

# 编排服务与压力测试
pnpm -F nova-http bench:production:stress
```

PowerShell 配置示例：

```powershell
$env:STRESS_DURATION = '60'
$env:STRESS_CONNECTIONS = '200'
$env:PROD_API_REDIS_HOST = '127.0.0.1'
$env:PROD_API_REDIS_PORT = '6379'
pnpm -F nova-http bench:production:stress
```

## 目录

| 路径                  | 用途                             |
| --------------------- | -------------------------------- |
| `src/app/core`        | 场景配置、应用创建、指标         |
| `src/app/router`      | 路由与子应用注册                 |
| `src/app/infra`       | SQLite 与 Redis 适配             |
| `src/app/middlewares` | 上下文、资源与计数               |
| `src/app/modules`     | 用户、搜索、订单场景             |
| `src/runner`          | 服务进程、autocannon、采样与报告 |
| `reports`             | 历史报告和运行输出               |

新增报告需记录提交、Node、硬件、负载、预热和重复次数。保留历史数据，不将旧结果描述为当前版本保证。
