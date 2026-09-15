---
description: Nova 的模块职责、依赖约束、公共导出与适配器边界。
---

# 架构与边界

Nova 将请求分发、HTTP/1 规则和 TCP 协调分开。core 与 protocol/http1 通过 message 契约交换数据，server 管理连接生命周期，app 对外提供 createApp。

<LayerDiagram
  label="Nova 模块依赖：app 组装 server，server 组合 core 与 HTTP/1，二者依赖 message"
  app="公共门面 · 创建与监听"
  server="TCP · 连接协调 · 超时 · 取消"
  core="路由 · 中间件 · 请求与响应"
  protocol="解析 · 消息定界 · 序列化"
  message="输入数据与输出端口契约"
  caption="依赖自上向下。core 与 HTTP/1 协议层互不依赖；static 通过请求与响应 API 发送文件。"
/>

## 模块职责

| 目录             | 拥有的职责                                          | 不应承担的职责                 |
| ---------------- | --------------------------------------------------- | ------------------------------ |
| `app`            | Nova 配置与组合、监听门面                           | 协议解析细节                   |
| `core`           | 路由、中间件、请求视图、响应状态和完成观察          | Socket、文件系统和 HTTP/1 定界 |
| `message`        | HeaderBlock、IncomingBody、请求元数据、ResponseSink | 业务路由与连接策略             |
| `protocol/http1` | 扫描解析、定界计划、响应序列化                      | 应用分发和网络 I/O             |
| `server`         | TCP、输入泵、超时、取消、连接复用、HTTP/1 sink      | 业务逻辑                       |
| `static`         | 文件元数据、MIME、Range 与文件输出                  | 应用响应状态机                 |
| `middlewares`    | 可选 body 解析和静态目录行为                        | 修改核心协议契约               |

message 使用 Node Readable 表达输入背压；这里的传输无关指不暴露 Socket，不代表所有代码可直接移植到浏览器运行。

## 依赖约束

core 依赖 message；protocol/http1 依赖 message；server 组合二者。框架贡献不应通过一个跨层工具模块绕过这些方向。`architecture.spec.ts` 校验实际导入与公共边界，新增跨层依赖需要同步审视设计。

static 通过 NovaRequest/NovaResponse 读取条件字段并发送流。文件系统能力保持为可选适配器，响应对象本身不提供 sendFile 方法。

## 公共与内部

源码目录不自动形成包入口。公开接口以 package exports 为准，`server`、`message` 没有直接导入子路径；部分消息契约从 core 重导出。运行时类、类型导出及协议工具的入口见 [API 参考](../api/)。

继续阅读[请求生命周期](./request-lifecycle)。源码从 [src/app/nova.ts](https://github.com/Owl23007/nova-http/blob/master/packages/nova-http/src/app/nova.ts) 进入，验证从[架构测试](https://github.com/Owl23007/nova-http/blob/master/packages/nova-http/scripts/tests/architecture.spec.ts)进入。
