---
description: NovaRequest 的属性、请求体方法与路径视图行为。
---

# NovaRequest

```ts
import type { NovaRequest, RequestContext, BodyReadOptions } from "nova-http";
```

处理器由框架传入请求对象。手动构造需从 `nova-http/core` 导入运行时类，参见[消息契约](./message)。

## 路径与元数据

| 属性          | 类型                     | 行为                                   |
| ------------- | ------------------------ | -------------------------------------- |
| `method`      | `string`                 | HTTP 方法                              |
| `rawTarget`   | `string`                 | 原始请求目标，挂载视图仍保留           |
| `path`        | `string`                 | 当前视图路径，包含 query               |
| `pathname`    | `string`                 | 当前视图路径，不含 query               |
| `httpVersion` | `string`                 | 协议版本；HTTP/1 适配器使用 1.0 或 1.1 |
| `params`      | `Record<string, string>` | 匹配路由时注入                         |
| `query`       | `URLSearchParams`        | 惰性解析，支持 getAll                  |
| `cookies`     | `Record<string, string>` | 无原型对象，值不做 URI 解码            |
| `ip`          | `string`                 | 适配器按代理信任策略计算               |
| `peer`        | `ConnectionInfo`         | 与传输对象分离的地址信息               |
| `connection`  | `ConnectionIntent`       | close、upgrade、CONNECT 意图           |
| `context`     | `RequestContext`         | 可声明合并的请求共享状态               |
| `signal`      | `AbortSignal`            | 由协调层持有取消权限                   |

`path` 不做 URI 解码或点路径段消除。挂载子应用的路径、参数及惰性缓存独立；body、headers、trailers、context 与 signal 共享。

## 字段与媒体类型

| 成员              | 类型 / 返回值         | 行为                                   |
| ----------------- | --------------------- | -------------------------------------- |
| `headers`         | `HeaderBlock`         | 保留字段顺序与重复项                   |
| `trailers`        | `HeaderBlock`         | body 完成后的 trailer，独立于 headers  |
| `getHeader(name)` | `string \| undefined` | 忽略大小写，首个字段值                 |
| `isJson`          | `boolean`             | application/json 或 application/*+json |
| `isForm`          | `boolean`             | application/x-www-form-urlencoded      |

媒体类型比较忽略大小写与参数，不说明内容已经校验。HeaderBlock 的 `getAll()` 等接口见[消息契约](./message#headerblock)。

## 请求体

```ts
req.buffer(options?: BodyReadOptions): Promise<Buffer>;
req.text(encoding?: BufferEncoding, options?: BodyReadOptions): Promise<string>;
req.json<T = unknown>(options?: BodyReadOptions): Promise<T>;
```

`body: IncomingBody` 是单次消费的 Readable；这三个便捷方法会消费并聚合它，默认不缓存结果。encoding 默认为 utf8，`BodyReadOptions.maxSize` 默认为 `Number.MAX_SAFE_INTEGER`，连接层 maxBodySize 仍独立生效。

超过读取上限会销毁 body 并抛 RangeError；JSON 无法解析时抛语法异常。泛型不执行运行时校验。`bodyBytesReceived` 反映当前已接收字节，不是预先确定的完整大小。

使用建议见[请求体指南](../guide/request-body)。
