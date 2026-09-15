---
description: 将静态目录挂载为子应用，使用文件适配器发送单个文件。
---

# 静态文件

`staticFiles()` 将请求路径映射到目录，处理 GET 和 HEAD；`sendFile()` 发送应用已经选定的文件。两者支持缓存验证、单段 Range 和流式输出。

## 挂载目录

```ts
import { createApp, staticFiles } from "nova-http";

const app = createApp();
const assets = createApp();
assets.use(staticFiles("./public", { maxAge: 3600 }));
app.use("/assets", assets);
```

`/assets/logo.svg` 在子应用中变为 `/logo.svg`，对应 `public/logo.svg`。直接使用 `app.use('/assets', staticFiles('./public'))` 时，普通中间件仍看到 `/assets/logo.svg`，会查找 `public/assets/logo.svg`。

目录路径相对进程工作目录解析。缺少文件时静态中间件继续后续流程；默认跳过以点开头的路径，目录索引默认是 `index.html`。可用选项见[内置中间件](../api/middleware#staticfiles)。

## 发送单个文件

```ts
import { resolve } from "node:path";
import { sendFile } from "nova-http/static";

app.get("/manual", async (req, res) => {
  await sendFile(req, res, resolve("./public/manual.pdf"));
});
```

`sendFile()` 接受文件路径，调用者负责授权和路径选择。由 URL 参数决定文件时，使用受控 ID 映射，避免把任意输入直接拼接到磁盘路径。参见[完整下载示例](./recipes/file-download)。

## 缓存与范围请求

默认生成 ETag 和 Last-Modified。`maxAge` 单位为秒，设为 0 时发送 `Cache-Control: no-cache`。当前文件适配器使用字符串相等判断条件请求；Range 支持单一字节范围，不支持多范围响应。精确行为见[文件适配器参考](../api/static)。
