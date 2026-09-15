---
description: HeaderBlock、IncomingBody、请求元数据与 ResponseSink 的公开契约。
---

# 消息契约

`message` 是源码层次，包没有 `nova-http/message` 入口。HeaderBlock 与 IncomingBody 从主入口或 core 导入，适配器契约类型从 core 导入。

```ts
import { HeaderBlock, IncomingBody } from "nova-http";
import type { IncomingRequestMeta, ResponseSink, ResponseHeaders } from "nova-http/core";
```

## HeaderBlock

```ts
const headers = new HeaderBlock([
  { name: "x-tag", value: "a" },
  { name: "X-Tag", value: "b" },
]);
headers.get("x-tag"); // "a"
headers.getAll("x-tag"); // ["a", "b"]
```

构造接收 `readonly HeaderField[]`，复制并冻结字段，名称规范化为小写。`HeaderField` 是只读 name/value 字符串对。

| 成员                  | 契约                                       |
| --------------------- | ------------------------------------------ |
| `fields`              | 只读字段数组，保留顺序与重复项             |
| `get(name)`           | 首个值或 undefined                         |
| `getAll(name)`        | 全部匹配值，缺少时为空数组                 |
| `has(name)`           | 是否存在字段                               |
| `forEach(callback)`   | callback(value, name, headers)，逐字段调用 |
| `[Symbol.iterator]()` | 遍历 HeaderField                           |

## IncomingBody

继承 Node Readable，供单次消费。构造签名为 `(hasContent: boolean, highWaterMark: number, resumePump: () => void)`，适配器用回调恢复输入泵。应用通常直接读取 `req.body`。

`bytesReceived` 记录接收量；`messageComplete` 表示协议输入结束；`fullyConsumed` 还要求读取缓冲已消费完。buffer/text/json 方法与[请求读取方法](./request#请求体)一致。`_accept`、`_complete`、`_fail` 是适配器内部输入控制，业务不应调用。

## 请求元数据

`IncomingRequestMeta` 包含 method、clientIp、rawTarget、path、version、headers、body、trailers、connection 与 peer。字符串路径由适配器提取，内核不重新判断 HTTP 消息定界。

`ParsedRequest` 是其已弃用别名。`HttpMethod` 为 string；协议层的 HttpVersion 则限定为 1.0/1.1。

`ConnectionInfo` 提供可选 remoteAddress、remotePort、localAddress、localPort；`ConnectionIntent` 提供 close、connect 与可选 upgrade。连接意图不意味着框架已实现隧道或 WebSocket。

## ResponseSink

```ts
interface ResponseSink {
  readonly reusable: boolean;
  readonly bodyBytesWritten: number;
  assertHeaderAllowed(name: string): void;
  commit(status: number, headers: ResponseHeaders): Promise<void>;
  write(chunk: Buffer): Promise<void>;
  end(): Promise<void>;
}
```

`ResponseHeaderValue = string | readonly string[]`，`ResponseHeaders` 为只读 Map。commit 固定输出计划，write 等待背压，end 结束输出。sink 不持有取消整个交互或关闭传输的公开权限。

`ResponseOptions` 提供共享 signal 和同步 `onFailure(error)`，可从主入口或 core 导入类型。实现适配器时必须保留首次失败并验证当前交互身份，参见[响应与取消](../framework/internals/response-lifecycle)。
