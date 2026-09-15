---
description: 输入数据、单次消费、请求视图与协议中立输出端口。
---

# 消息契约

message 层把协议输入结果转换为应用可以消费的数据。HeaderBlock 保留字段序列，IncomingBody 表达读取与背压，ResponseSink 表达输出能力。

## 输入所有权

SegmentedInput 由连接层持有，IncomingBody 只接收已经解码的 Buffer 视图。body 消费停止时暂停输入泵；Readable 请求更多数据时调用恢复回调。原始分块标记不会交给应用。

`messageComplete` 表示协议数据到齐，`fullyConsumed` 还要求应用读完。二者不能混用；否则 body 留在缓冲时连接可能错误复用。

## 请求视图

挂载层只计算新路径，NovaRequest 创建显式视图。每个视图有自己的 path、pathname、params、query 与 cookies 缓存，共享 body、headers、trailers、context 和 signal。

共享对象只应修改约定字段，不应在视图中整体替换共享引用。不要通过原请求实例作为原型制造挂载视图，避免惰性缓存和可变字段穿透。

## 输出端口

ResponseSink 不包含 Socket、协议版本解析或 abort 方法。NovaResponse 使用 commit/write/end；HTTP/1 sink 将其实现为头部序列化、定界和 socket 写入。取消交互仍属于连接协调器。

契约签名集中在[消息 API](../../api/message)。相关实现为 [message](https://github.com/Owl23007/nova-http/tree/master/packages/nova-http/src/message)，测试入口为 `request.spec.ts`、`exchange-lifecycle.spec.ts` 与 `architecture.spec.ts`。
