---
description: 在临时端口测试业务接口，并可靠关闭客户端与服务器。
---

# 应用测试

将应用创建封装为函数，测试时使用端口 0 让系统分配空闲端口。断言真实 HTTP 响应，测试结束后关闭应用。

下面示例使用 Node.js 内置测试运行器。保存为 `app.test.mjs`，与快速开始的 `app.mjs` 放在同一目录。示例创建独立应用，不依赖开发服务器已经启动。

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "nova-http";

test("GET /hello/:name", async () => {
  const app = createApp();
  app.get("/hello/:name", (req, res) => {
    res.json({ hello: req.params.name });
  });
  await app.listen(0, "127.0.0.1");
  try {
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/hello/Nova`, {
      headers: { connection: "close" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { hello: "Nova" });
  } finally {
    await app.close();
  }
});
```

```sh
node --test app.test.mjs
```

## 选择断言

业务测试覆盖成功响应、非法输入、权限拒绝、404/405 和依赖失败。只断言 HTTP 契约和业务可观察结果，避免绑定框架私有字段。请求体、Cookie、代理信任或流式行为是业务依赖时，再加入对应边界用例。

SSE 测试应逐块读取并主动取消，不能使用 `response.text()` 等待无限流结束。协议字节、流水线与背压回归属于[框架测试](../framework/contributing/testing)。
