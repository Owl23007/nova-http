---
description: 中间件函数类型、bodyParser 与 staticFiles 的配置和结果。
---

# 内置中间件

```ts
import { bodyParser, staticFiles } from "nova-http/middlewares";
import type { Middleware, ErrorMiddleware, Handler } from "nova-http";
```

两个工厂也从主入口导出。返回的异步中间件可注册到 `app.use()` 或路由。

## 函数契约

```ts
type NextFunction = (error?: unknown) => void;
type Handler = (req: NovaRequest, res: NovaResponse) => void | Promise<void>;
type Middleware = (
  this: MiddlewareContext | void,
  req: NovaRequest,
  res: NovaResponse,
  next: NextFunction,
) => void | Promise<void>;
type ErrorMiddleware = (
  this: MiddlewareContext | void,
  error: unknown,
  req: NovaRequest,
  res: NovaResponse,
  next: NextFunction,
) => void | Promise<void>;
```

`MiddlewareContext` 包含所属应用的 `hooks: Hooks`。next 不是下游 Promise，错误处理器按四参数函数识别。控制流约束见[中间件指南](../guide/middleware)。

## bodyParser

`bodyParser(options?: BodyParserOptions)` 显式读取 body，并把结果放到 `req.context.bodyParserData`。

| 参数        | 默认值                   | 说明                                      |
| ----------- | ------------------------ | ----------------------------------------- |
| `maxSize`   | `1048576`                | 最大物化字节数，仍受连接 maxBodySize 限制 |
| `types`     | `['json', 'urlencoded']` | 允许的解析类型                            |
| `maxParams` | `100`                    | URL 编码表单字段数量上限                  |
| `strict`    | `true`                   | JSON 根值必须为非 null 对象或数组         |

`BodyParserData` 包含 `body: unknown`、`contentType: string`；`BodyParsedContext` 额外包含 req、res。解析成功发出 `bodyParser:parsed`，空输入、不支持媒体类型和失败不触发。已有 bodyParserData 时跳过重复解析。

表单同名键合并为数组，不解析嵌套对象；JSON 支持 application/json 和 application/*+json。错误语法返回 400，读取超限返回 413。此中间件不会校验业务 schema。

## staticFiles

`staticFiles(root: string, options?: StaticFilesOptions)` 处理 GET/HEAD，将路径映射到目录。其他方法或缺少文件时调用 next。

| 参数           | 默认值         | 说明                                   |
| -------------- | -------------- | -------------------------------------- |
| `maxAge`       | `3600`         | 秒；0 时使用 no-cache                  |
| `index`        | `"index.html"` | 目录索引；false 禁用                   |
| `dotFiles`     | `"ignore"`     | ignore 跳过、deny 返回 403、allow 允许 |
| `etag`         | `true`         | 启用 ETag                              |
| `lastModified` | `true`         | 启用 Last-Modified                     |

root 相对进程工作目录解析。处理器会解码 URL 路径并检查解析后的路径仍在 root 下；这不替代私有文件授权或对磁盘符号链接的部署管理。前缀挂载示例见[静态文件](../guide/static-files)，缓存与 Range 由[文件适配器](./static)处理。
