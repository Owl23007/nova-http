---
"nova-http": patch
---

通过可选的 ResponseSink.sendFixed 增加内部定长响应一次提交能力，send、json、html 由 HTTP/1 适配器一次批量输出，无背压时同步完成，有背压时等待 drain。

保留旧 sink 的 commit/write/end 兼容及完整 streaming 异步 pipeline，维持统一输出架构、HTTP 定界、字节计数、取消、连接复用和首次失败语义。
