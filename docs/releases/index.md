---
description: 仓库已记录版本与尚未发布变更，升级时应核对的接口差异。
---

# 版本说明

本站描述当前工作区。两个包的 package.json 版本均为 0.2.1，但仓库还有待发布 Changesets；不能把所有当前接口视为 0.2.1 的已发布能力。

## 已记录版本

| 版本  | 变更                                                                      |
| ----- | ------------------------------------------------------------------------- |
| 0.2.1 | 普通处理阶段保留 requestTimeout，进入响应流后停止；关闭服务器时终止长期流 |
| 0.2.0 | 通用响应流 API、请求取消信号，以及流式生命周期修正                        |

0.2.0 日志中将超时描述为覆盖完整流，0.2.1 已调整这一行为。查看 [nova-http CHANGELOG](https://github.com/Owl23007/nova-http/blob/master/packages/nova-http/CHANGELOG.md) 和 [initializer CHANGELOG](https://github.com/Owl23007/nova-http/blob/master/packages/create-nova-http/CHANGELOG.md) 获取原始记录。此页不查询或推断 npm latest 标签。

## 待发布变更

当前 Changesets 包括模块分层与子路径导出、流式请求体、严格请求语义、分布式 HookEvents、观测与控制流边界、中间件错误传播，以及 Node.js 运行基线调整。它们尚未合并为具体发行版号。

| 影响范围 | 升级关注点                                             |
| -------- | ------------------------------------------------------ |
| 请求体   | Buffer body 改为 IncomingBody，显式 buffer/text/json   |
| 公共入口 | core 收敛内部导出，新增协议与文件适配器子路径          |
| Hooks    | 使用 addHook/removeHook/emitHook，观测不参与请求控制流 |
| 请求语义 | rawTarget、path、bodyBytesReceived 与 RequestContext   |
| 配置     | trustProxy 扩展、parserLimits、checkContinue           |
| 运行环境 | 最低 Node.js 版本由 18 提升至 20                       |

完整步骤见 [Core API 迁移](./migrations/core-api)。当前变更清单来自仓库 [.changeset](https://github.com/Owl23007/nova-http/tree/master/.changeset)，发布后应将迁移页关联最终版本。
