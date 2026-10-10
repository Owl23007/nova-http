---
"nova-http": minor
---

收敛公开入口：主入口提供日常应用 API，消息构造器 HeaderBlock、IncomingBody 及 ResponseOptions 从 `nova-http/core` 导入，HTTP/1 协议类型从 `nova-http/protocol/http1` 导入。主入口不再导出内部 Http1ConnectionConfig，应用配置使用 NovaConfig；保留已发布的 ParsedRequest 与 RouteMatch 类型导入兼容现有代码。

NovaConfig 独立定义应用选项，ListenAddress 保持现有监听地址结构，应用生命周期钩子契约归应用门面所有；不再通过这些类型暴露连接协调器与 server 实现。现有配置、默认值、钩子声明合并及同步 checkContinue 行为不变。
