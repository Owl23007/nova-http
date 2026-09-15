---
description: 使用受控文件 ID 实现下载，验证 HEAD、Range 和缓存响应。
---

# 文件下载

通过受控 ID 选择文件，避免请求参数直接决定磁盘路径。示例支持 GET 下载和 HEAD 元数据查询。

## 准备文件与服务

创建 `public/manual.txt`，写入 `Nova manual`。安装 `nova-http`，保存以下代码为 `app.mjs`，执行 `node app.mjs`：

<<< @/examples/file-download.mjs{js}

## 验证

```sh
curl -i http://127.0.0.1:3000/downloads/manual
curl -I http://127.0.0.1:3000/downloads/manual
curl -i -H "Range: bytes=0-3" http://127.0.0.1:3000/downloads/manual
```

GET 返回文件内容，HEAD 只返回响应头，范围请求返回 206 与 `Content-Range`。未知 ID 返回 404。受控映射只解决路径选择，私有文件仍需在发送前执行应用的权限校验。

更多选项与条件请求边界见[文件适配器](../../api/static)。
