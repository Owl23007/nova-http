---
description: NovaConfig 的全部选项、默认值、单位、代理与 Expect 策略。
---

# 配置

通过 `createApp(config)` 传入。Nova 不读取环境变量或配置文件；调用者负责读取、转换和校验外部输入。所有超时单位为毫秒，大小单位为字节。

```ts
import { createApp, type NovaConfig } from "nova-http";

const config: NovaConfig = {
  host: "127.0.0.1",
  port: 3000,
  maxBodySize: 1_048_576,
  requestTimeout: 120_000,
};
const app = createApp(config);
```

## 监听与容量

| 选项                | 类型     | 默认值      | 含义                                |
| ------------------- | -------- | ----------- | ----------------------------------- |
| `port`              | `number` | `3000`      | listen 未传端口时使用               |
| `host`              | `string` | `"0.0.0.0"` | listen 未传地址时使用               |
| `maxConnections`    | `number` | `0`         | 最大连接数，0 表示不限制            |
| `maxBodySize`       | `number` | `1048576`   | 连接层请求体上限；0 仅允许空 body   |
| `bodyHighWaterMark` | `number` | `65536`     | IncomingBody 缓冲水位，必须为正整数 |

## 超时

| 选项               | 默认值   | 开始与结束边界                                         |
| ------------------ | -------- | ------------------------------------------------------ |
| `headersTimeout`   | `60000`  | 接收完整请求头的期限                                   |
| `keepAliveTimeout` | `65000`  | 等待复用连接的下一次请求                               |
| `bodyIdleTimeout`  | `30000`  | body 输入连续无数据的时间                              |
| `requestTimeout`   | `600000` | 请求头就绪、进入分发后开始；响应进入输出生命周期时停止 |

超时值为 0 表示禁用对应计时器。输入计时器与应用计时器独立，开始响应不会取消请求体输入的限制。流式响应需自行管理总期限。

## 解析限制

`parserLimits` 接受 `Partial<ParserLimits>`，未指定字段使用以下默认值。它约束协议输入结构，与 body 总大小限制分开。

| 字段                    | 默认值  | 含义                          |
| ----------------------- | ------- | ----------------------------- |
| `maxRequestLineBytes`   | `16384` | 请求行大小                    |
| `maxTargetBytes`        | `8192`  | 请求目标大小                  |
| `maxHeaderLineBytes`    | `8192`  | 单个字段行大小                |
| `maxHeadBytes`          | `65536` | 完整头部区大小                |
| `maxHeaderCount`        | `200`   | 字段数量                      |
| `maxChunkLineBytes`     | `1024`  | chunk-size 行大小，不含 CRLF  |
| `maxChunkMetadataBytes` | `65536` | 每请求 chunk 元数据累计字节数 |

```ts
const app = createApp({
  parserLimits: { maxHeadBytes: 32 * 1024, maxHeaderCount: 100 },
});
```

chunk 元数据包含所有 size 行及其 CRLF、data 后的 CRLF、终止块和整个 trailer 区（含最终 CRLF），不含解码后的 payload。累计量超过上限返回 413；下一次请求重新计数。单行、trailer 头部和 body 限额同时生效。

## 代理信任

`trustProxy` 默认为 `false`，影响 `req.ip`。类型 `TrustProxy` 可从主入口导入。

| 值                          | 处理                                             |
| --------------------------- | ------------------------------------------------ |
| `false`                     | 使用 socket 对端地址                             |
| `true`                      | 信任全部代理                                     |
| 非负整数                    | 从 socket 对端起信任指定跳数，0 等效于不信任代理 |
| `(address, hop) => boolean` | 逐跳判断；socket 对端 hop 为 0                   |

沿 X-Forwarded-For 从右向左取首个不受信任地址，遇到非法 IP 停止；没有 X-Real-IP 回退。固定跳数要求所有入口的链长度一致；信任全部代理要求入口清理客户端传入的转发字段。

## Expect: 100-continue

```ts
import type { ContinueDecision } from "nova-http";
import type { RequestHead } from "nova-http/protocol/http1";

const app = createApp({
  checkContinue(head: RequestHead): ContinueDecision {
    if (head.headers.get("x-upload-token") !== "example-token") {
      return { status: 403, message: "Upload denied" };
    }
    return true;
  },
});
```

HTTP/1.0 忽略 Expect，不调用该策略，也不发送 100 Continue。HTTP/1.1 仅在有请求体且收到合法 100-continue 时调用策略；CONNECT 在此之前被拒绝。

`checkContinue` 是同步策略函数，返回 `true` 允许继续，或返回 4xx/5xx 状态与 message 拒绝。默认允许；不支持异步返回。示例 token 仅说明接口，真实授权由应用实现。

## 参数校验

容量和超时必须为非负安全整数；`bodyHighWaterMark` 及 `parserLimits` 的字段必须为正安全整数。非法数值在构造时抛出 RangeError，非法策略函数类型抛出 TypeError。`NovaConfig` 独立定义应用选项，不继承内部连接配置；已有选项、默认值和同步策略保持不变。`app.address()` 返回 `ListenAddress | string | null`，地址对象保持 address、family、port 三个字段。
