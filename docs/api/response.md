---
description: NovaResponse 的同步发送、异步写入、响应头和生命周期契约。
---

# NovaResponse

```ts
import type { NovaResponse, StreamChunk, StreamSource } from "nova-http";
```

处理器通过框架提供的实例写入。运行时类位于 `nova-http/core`，构造需 `ResponseSink` 与 `ResponseOptions`。

## 状态

| 属性               | 类型      | 含义                           |
| ------------------ | --------- | ------------------------------ |
| `statusCode`       | `number`  | 当前状态码，默认 200           |
| `headersSent`      | `boolean` | 已提交响应头，不等于客户端收到 |
| `writableEnded`    | `boolean` | 输出端口成功结束               |
| `bodyBytesWritten` | `number`  | 输出端口记录的 body 字节数     |

## 设置响应

| 方法                     | 返回值                            | 约束                          |
| ------------------------ | --------------------------------- | ----------------------------- |
| `status(code: number)`   | `this`                            | 整数 100–999，否则 RangeError |
| `setHeader(name, value)` | `this`                            | value 为 string 或 string[]   |
| `getHeader(name)`        | `string \| string[] \| undefined` | 名称忽略大小写，数组为副本    |
| `removeHeader(name)`     | `this`                            | 提交前移除字段                |

普通字段覆盖；`set-cookie` 追加。字段名称和值受校验，非法字符被拒绝；HTTP/1 输出端口禁止应用设置 Transfer-Encoding。提交后修改状态或字段产生 `ERR_HTTP_HEADERS_SENT`。

## 一次性发送

```ts
res.send(data?: string | Buffer): void;
res.json(data: any): void;
res.html(content: string): void;
res.redirect(url: string, code?: number): void;
```

send 默认空字符串，未设置媒体类型时使用 `text/plain; charset=utf-8`；json 和 html 设置对应媒体类型。redirect 默认 302，设置 Location 与空 body。这些方法设置 Content-Length 并请求结束；完成由框架分发层等待。

当前实现在非 idle 状态调用这些一次性方法会直接返回，不会改写已提交的响应。应用仍应保证只有一个响应出口。JSON 序列化本身可能同步抛错。

## 流式方法

| 方法                           | 返回值          | 完成边界                 |
| ------------------------------ | --------------- | ------------------------ |
| `flushHeaders()`               | `Promise<void>` | 提交头部，不结束响应     |
| `write(chunk: StreamChunk)`    | `Promise<void>` | 按顺序写入，等待输出背压 |
| `end(chunk?: StreamChunk)`     | `Promise<void>` | 写入可选尾块并结束输出   |
| `stream(source: StreamSource)` | `Promise<void>` | 消费数据源并自动 end     |

`StreamChunk = string | Buffer | Uint8Array`；`StreamSource = Readable | AsyncIterable<StreamChunk>`。字符串按 UTF-8 编码。write 隐式提交头部，每次都应等待。end 重复调用不会重复输出终止块；请求结束后再 write/stream 会失败。

空 write 不代表结束，但可能提交响应头。未知长度 HTTP/1.1 自动 chunked，HTTP/1.0 关闭定界。显式 Content-Length 必须与实际字节数相符。HEAD、1xx、204、205、304 不发送 body。

## 失败与取消

输入信号取消触发本地清理和源取消。输出失败或提交后的流源失败通知协调层终止交互。提交前的流源异常仍可由错误链恢复，已提交的响应不能再发送 500。

例子见[流式响应](../guide/streaming-response)，错误码见[错误参考](./errors)。
