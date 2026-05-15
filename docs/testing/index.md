# Nova 软件测试计划与规范

本文档详述了 `Nova` 框架的软件测试策略。我们的目标是通过完备的单元测试、集成测试以及性能测试来保障高并发 HTTP 框架的稳定性与安全性。

## 1. 测试范围

- **单元测试 (Unit Testing)**：测试框架核心组件的纯逻辑，如 `BufferReader`, `HttpParser`, `Router`, 和 `MiddlewareChain` 等，保障每个函数的正确性。
- **集成测试 (Integration Testing)**：测试 HTTP Server 的整体链路，包括完整的请求声明周期、Header 解析、路由匹配、中间件执行流水线及响应。
- **性能/容量测试 (Performance Testing)**：对 `nova` 与 `node-native`、`llhttp` 等进行 Benchmark 基准验证，考察其在高并发情况下的内存和 CPU 表现。
- **安全性与异常测试 (Security & Error Handling)**：处理恶意发包（如超长 Header、半包攻击等 HTTP 走私和解析漏洞），确保框架能够优雅地断开连接或者返回错误码。

## 2. 测试工具栈

- **测试运行器**：[Vitest](https://vitest.dev/) (极速的单元测试和集成测试框架)
- **HTTP 请求断言**：[SuperTest](https://github.com/ladjs/supertest) (用于无端口启动服务器进行端到端路由/中间件测试)
- **基准测试**：项目自带的 `scripts/benchmark/` 脚本

## 3. 测试目录结构设计

通常，我们将测试代码单独放置，防止带入生成环境包中：

```text
nova/
 ├── tests/
 │    ├── core/                # 各个核心类的单元测试
 │    │    ├── BufferReader.spec.ts
 │    │    ├── Router.spec.ts
 │    │    └── HttpParser.spec.ts
 │    ├── integration/         # 服务端到端请求测试
 │    │    ├── app.spec.ts
 │    │    └── middleware.spec.ts
 │    └── utils/               # 测试用到的 mock 数据或辅助工具
 ├── vitest.config.ts          # 测试配置
```

## 4. 重点测试用例设计

### 4.1 Router 路由模块测试

- **正常路径匹配**：注册 `GET /users`，断言可以被正确回调。
- **参数匹配路由**：注册 `GET /users/:id`，请求 `/users/123` 时，能正确捕获 `params.id === '123'`。
- **404 处理**：请求未注册的资源，系统应该打底返回 404 Not Found。

### 4.2 HttpParser 解析器测试

- **正常报文解析**：传入标准的 HTTP 文本，断言 Request 对象包含正确的 URL、Method 和 Headers。
- **异常包/截断包处理**：模拟 TCP 分包带来的半截报文，验证 `BufferReader` 游标及 Parser 的状态机是否正确挂起并等待。

### 4.3 中间件洋葱模型测试

- **执行顺序**：注册多个中间件推入追踪数组，验证执行栈与退出栈是否符合 `[1, 2, 3, 3, 2, 1]`。
- **异常捕获**：在内层路由抛出 `throw new Error()`，测试上层错误处理中间件能否捕获并响应 500。
