---
description: sendFile、缓存验证、Range 行为与 MIME 查询。
---

# 文件适配器

```ts
import { sendFile, getMimeType, parseRange, type SendFileOptions } from "nova-http/static";
```

## sendFile

```ts
sendFile(req: NovaRequest, res: NovaResponse, filePath: string,
  options?: SendFileOptions): Promise<void>;
```

filePath 是应用选择的磁盘文件路径，建议传绝对路径。`etag` 与 `lastModified` 均默认 true。函数管理文件元数据和输出，不接收安全根目录参数；调用者负责授权与路径约束。

| 条件                         | 行为                                                  |
| ---------------------------- | ----------------------------------------------------- |
| 文件存在                     | MIME、长度、Accept-Ranges，默认 ETag 与 Last-Modified |
| HEAD                         | 相同元数据，不读取并输出文件体                        |
| 条件字段与生成值相等         | 304                                                   |
| 有效单段 Range               | 206 与 Content-Range                                  |
| 无效或不支持的 Range         | 416 与 `bytes */size`                                 |
| 文件不存在或路径不是普通文件 | 404                                                   |
| stat 其他失败                | 500                                                   |

当前条件请求实现按字符串相等比较 If-None-Match 或 If-Modified-Since，没有完整的 ETag 列表、弱比较与日期条件优先级处理。Range 不提供多部分响应。需要更完整的静态资源缓存语义时，由入口资源服务承担。

正常发送使用文件 Readable 与响应 stream，Promise 等待输出完成。文件流读取期间的异常受[响应错误边界](./response#失败与取消)约束。

## getMimeType

```ts
getMimeType(filePath: string): string;
```

按文件扩展名返回媒体类型，未知类型返回 `application/octet-stream`。它不读取文件内容，不用于确认上传文件的实际格式。

## parseRange

```ts
parseRange(rangeHeader: string, fileSize: number): RangeResult | null;
```

`RangeResult` 包含 `start`、`end`，两端均包含在范围内。支持 `bytes=0-3`、`bytes=4-` 和 `bytes=-4`。无效、超出文件范围或多个范围返回 null；显式 end 超过文件末尾不会自动截断。

目录服务由 [staticFiles](./middleware#staticfiles) 包装；实际代码见[文件下载](../guide/recipes/file-download)。
