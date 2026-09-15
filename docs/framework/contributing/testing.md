---
description: 框架测试分层、依赖环境和按变更范围选择的回归命令。
---

# 测试与回归

先运行受影响模块的行为测试，再执行提交所需的完整检查。协议改动要验证真实字节与交互顺序，不能只断言对象状态。

## 按职责定位

| 变更                  | 测试文件，均位于 scripts/tests                         |
| --------------------- | ------------------------------------------------------ |
| 分层或导出            | architecture.spec.ts                                   |
| 路由与中间件          | router.spec.ts、middleware.spec.ts                     |
| 请求视图与 bodyParser | request.spec.ts、body-parser.spec.ts                   |
| 输出与 Hooks          | response.spec.ts、hooks.spec.ts                        |
| 解析与定界            | http-parser.spec.ts                                    |
| 连接与流水线          | connection-lifecycle.spec.ts、nova.integration.spec.ts |
| 取消所有权            | exchange-lifecycle.spec.ts                             |
| 流式超时与关闭        | stream-timeout-lifecycle.spec.ts                       |
| 生产场景              | performance-suite.spec.ts                              |

```sh
pnpm -F nova-http exec vitest run scripts/tests/response.spec.ts scripts/tests/exchange-lifecycle.spec.ts
```

## 完整检查

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

全量测试使用本地 Redis（默认 127.0.0.1:6379）和 node:sqlite。缺少这些基础设施时，可以先运行无生产套件的测试，但应在提交记录中说明覆盖范围：

```sh
pnpm -F nova-http exec vitest run --exclude scripts/tests/performance-suite.spec.ts
```

## 协议与生命周期用例

HTTP/1 测试通过 net.Socket 构造分段输入、截断 EOF 和同连接多请求。流式测试检查首块提前到达、慢读背压、断连取消、未结束流和下一请求不会提前分发。输出字节必须保留准确 CRLF，不能靠高级客户端的自动聚合掩盖错误。

架构测试是依赖约束，不应因为新增跨层调用而直接放宽。先审视新职责归属，再决定契约是否需要演进。

CLI 与版本同步检查见[发布流程](./release)，业务项目的测试方式见[应用测试](../../guide/testing)。
