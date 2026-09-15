---
description: 为扩展作者和源码贡献者提供不同深度的开发路线。
---

# 框架开发

扩展作者通过公开接口组合能力；源码贡献者需要理解内核边界、协议行为与连接生命周期。两条路线共享 API 契约，但需要关注的实现深度不同。

<DocLinks :items="[
  { title: '编写应用扩展', description: '中间件、请求上下文、Hooks 与子应用组合。', href: '/framework/extensions' },
  { title: '理解内核架构', description: '模块职责、依赖方向与公开入口。', href: '/framework/architecture' },
  { title: '开始贡献代码', description: '本地构建、测试环境与变更验证。', href: '/framework/contributing/setup' },
]" />

## 按问题定位

| 问题                             | 起点                                         |
| -------------------------------- | -------------------------------------------- |
| 中间件顺序、路由匹配、子应用回退 | [应用分发](./internals/core)                 |
| Header、body 消费和共享视图      | [消息契约](./internals/message)              |
| TCP 分段、请求头或消息定界       | [HTTP/1 协议](./internals/http1)             |
| 超时、流水线、复用和关闭         | [连接与服务器](./internals/server)           |
| 背压、完成信号、取消与失败       | [响应与取消](./internals/response-lifecycle) |

先阅读一次[请求生命周期](./request-lifecycle)，再进入对应模块。历史动机保留在[设计记录](../proposals/)，当前行为以参考页、源码和测试为准。
