# create-nova-http

## 0.3.0

### Minor Changes

- d0b3809: 将最低运行版本提升至 Node.js 20，并同步更新生成项目的运行声明及 TypeScript 模板使用的 Node.js 20 类型定义。

## 0.2.1

### Patch Changes

- 与 `nova-http@0.2.1` 同步版本，生成项目默认依赖 `nova-http@^0.2.1`。

## 0.2.0

### Minor Changes

- 与 `nova-http@0.2.0` 同步版本，生成项目默认依赖 `nova-http@^0.2.0`。
- 更新 API 模板以使用公开的 `onRequest`、`onResponse` hooks 记录请求日志，不再访问响应对象私有字段。
- 补充 TypeScript 模板检查、双包打包检查和版本同步校验。
