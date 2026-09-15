---
description: 按错误阶段定位响应失败、输入解析失败和业务错误。
---

# 错误参考

先判断错误发生在请求输入、应用处理还是响应输出。应用可以恢复尚未提交的业务错误；无法完成的协议输入或已提交响应需要终止交互。

## 响应与连接

| code                               | 条件                         | 处理建议                     |
| ---------------------------------- | ---------------------------- | ---------------------------- |
| `ERR_HTTP_HEADERS_SENT`            | 提交后修改状态或字段         | 将设置操作移到发送之前       |
| `ERR_STREAM_WRITE_AFTER_END`       | 请求结束后继续写入           | 检查重复出口与异步任务       |
| `ERR_RESPONSE_NOT_ENDED`           | 手动流处理器返回但未请求结束 | 等待写入并调用 end           |
| `ERR_HTTP_CONTENT_LENGTH_MISMATCH` | 定长响应字节不足或超出       | 按实际字节计算或省略长度     |
| `ERR_MANAGED_RESPONSE_HEADER`      | 手工设置 Transfer-Encoding   | 让输出端口管理定界           |
| `ERR_STREAM_PREMATURE_CLOSE`       | 完成前连接断开               | 取消上游并释放资源           |
| `ERR_REQUEST_TIMEOUT`              | 普通处理阶段超过时限         | 检查外部依赖、输入消费和配置 |
| `ERR_SERVER_SHUTDOWN`              | 服务关闭时中止活跃响应       | 完成取消清理，不重写响应     |

非法状态码、响应字段、流数据块或配置也可能抛出 TypeError/RangeError，并不都带 code。不要依赖历史提案中尚未实现的错误码。

## HTTP/1 输入错误 {#http1-input-errors}

协议错误以 `Http1Error` 数据对象返回，包含 `type`、`code`、`status`、`phase`、`fatal: true` 和 message。它不是必须通过 instanceof Error 判断的异常类。

| type          | 含义                       |
| ------------- | -------------------------- |
| `syntax`      | 请求行、字段或分块语法非法 |
| `framing`     | 长度与编码等定界歧义       |
| `limit`       | 大小或数量超过限制         |
| `incomplete`  | 消息未完成就到达 EOF       |
| `unsupported` | 不支持的协议版本或特性     |

phase 为 request-line、headers、body 或 trailers。常见 HTTP 状态包括语法错误 400、body 超限 413、请求目标过长 414、头部过大 431、版本不支持 505。状态输出仍取决于当时是否已提交响应；流中不能插入第二条错误响应。

具体 HPE code 由[协议实现](https://github.com/Owl23007/nova-http/blob/master/packages/nova-http/src/protocol/http1/parser.ts)与测试定义。入口不导出内部错误工厂。

## 应用错误

非法 JSON 由 bodyParser 返回 400；业务字段校验由应用自行决定状态。onError 上下文的 req/res 可缺失，不要无条件访问。使用方式见[错误处理指南](../guide/error-handling)。
