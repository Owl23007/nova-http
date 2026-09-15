---
description: HTTP/1 有界扫描、输入定界与响应编码的实现职责。
---

# HTTP/1 协议

protocol/http1 负责字节规则与同步计算。它不等待网络、不调用路由，也不持有 Socket；server 驱动输入状态并处理策略。

## 请求头扫描

SegmentedInput 保存到达分段，扫描状态只向前移动。请求头位于单个连续分段时取 subarray，跨段时在限制内复制为连续块。严格 CRLF 扫描与请求行、字段数量和长度限制在进入应用前执行。

## 解析与定界

parseHead 解析请求目标、版本和 HeaderBlock。resolveFraming 独立判定 Content-Length 与 Transfer-Encoding，避免业务层凭单个字段猜测消息边界。buildRequestHead 合并 body 计划与连接意图。

请求目标区分 origin、absolute、authority、asterisk，原始 rawTarget 保留。CONNECT/Upgrade 意图并不意味着服务器支持对应隧道；最终接受策略由协调层决定。

## 请求体与 EOF

连接层按 none、fixed 或 chunked 计划驱动输入。chunked 包括 size、data、CRLF 与 trailers 阶段，输出到 IncomingBody 的只有解码数据。消息未完整就到达 EOF 必须失败，不能把截断视为正常结束。

## 响应编码

resolveResponsePlan 决定 none、fixed、chunked 或关闭定界，再由 sink 调用序列化工具输出。HEAD 与无 body 状态码在计划阶段统一处理；实际定长字节数由 sink 校验。

改动首先验证 `http-parser.spec.ts` 中分段输入、重复字段、framing 冲突、限制与 EOF 行为。公开工具列表见 [HTTP/1 API](../../api/http1)，源码见 [protocol/http1](https://github.com/Owl23007/nova-http/tree/master/packages/nova-http/src/protocol/http1)。
