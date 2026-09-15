---
description: 一个带 JSON 校验、201 与 404 响应的内存笔记 API。
---

# JSON API

这个示例提供创建与查询笔记两个接口，演示请求体解析、输入校验和状态码。数据只保存在内存中，进程重启后清空。

## 服务代码

安装 `nova-http`，将以下文件保存为 `app.mjs`，执行 `node app.mjs`：

<<< @/examples/rest-api.mjs{js}

## 创建与查询

在终端执行；PowerShell 可使用 `curl.exe` 并按终端规则转义 JSON 引号。

```sh
curl -i http://127.0.0.1:3000/notes -H 'content-type: application/json' --data '{"text":"Read Nova docs"}'
curl http://127.0.0.1:3000/notes/1
```

创建返回 201 和 `Location: /notes/1`，查询返回保存的对象。空文本返回 400，不存在的 ID 返回 404。`bodyParser()` 负责语法解析，处理器负责业务字段校验。

可将存储逻辑提取到 service，再通过[应用测试](../testing)验证成功和失败分支。
