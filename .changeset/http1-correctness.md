---
"nova-http": minor
---

收口 HTTP/1 correctness：HTTP/1.0 忽略 Upgrade 和 Expect，未接受的 Upgrade 不再阻止普通连接复用，server 在应用分发前明确拒绝 CONNECT tunnel，响应工具避免 CONNECT 2xx 的错误定界。

校验 chunk-extension 与 Transfer-Encoding grammar，区分格式错误 400 和不支持的编码 501；新增 parserLimits.maxChunkMetadataBytes（默认每请求 64 KiB，累计 size 行、CRLF 与 trailers，不含 payload）。补齐 URI 边界校验，并通过 req.authority 和 ParsedHead.authority 明确 effective authority。已验证的 HTTP 语义作为 0.3 冻结基线。
