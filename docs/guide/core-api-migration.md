# Core 依赖与 API 重构

本次重构保留 core 的平铺结构，明确分发、匹配、执行、请求视图和输出的职责边界

## 公共 API 变化

- `nova-http/core` 不再导出 `MiddlewareChain`、`composeRoute`、`createRouteBuilder` 和 `BUILTIN_HTTP_METHODS`
- 使用 `app.use()` 注册中间件，使用 `app.route()` 或 `app.method()` 注册路由，使用 `app.all()` 注册全部内置方法
- `Hooks` 不再继承 `EventEmitter`，注册、移除、发布事件分别使用 `addHook()`、`removeHook()`、`emitHook()`
- 不再支持通过 Hooks 调用 `on()`、`off()`、`once()`、`emit()` 等 EventEmitter 方法
- `Handler`、`Middleware`、`ErrorMiddleware`、`MiddlewareContext` 和 `NextFunction` 的公共导入路径保持不变，内部定义集中在 `handler.ts`
- 保留 `Application`、`Router`、`NovaRequest`、`NovaResponse`、`Hooks` 及消息契约作为内核扩展入口

## 内部职责

- Application 管理参与分发的子应用及完成观察者，响应成功结束后统一通知，中止时清理
- NovaResponse 管理输出与响应状态，不再持有应用观察者
- NovaRequest 创建显式请求视图，不再通过原请求实例作为原型实现挂载
- 请求视图的路径、params、query 和 cookies 缓存独立，body、headers、trailers、context 对象和取消状态共享
- 每个交互由协调层创建独立 AbortController，Request 和 Response 只观察 signal，挂载视图复用当前交互的 signal
- Response 保留自己的状态机与完成 Promise，成功终态不受迟到取消影响
- 协调层独立执行取消、请求体失败和传输关闭，传输关闭不依赖响应是否已经中止
- mount 计算挂载路径并委托 Request 创建视图

新增 API 代码应依赖公共入口，不应依赖包内未导出的执行器和构建工具

## 取消所有权与构造接口

`RequestCancellation`、`req._abort()`、带传输控制参数的 `res._abort()` 和 `ResponseSink.abort()` 已移除

新的构造接口为 `NovaRequest(meta, signal)` 和 `NovaResponse(sink, { signal, onFailure })`，`ResponseOptions` 从主入口和 core 入口导出

`onFailure` 是必填的同步通知回调，由协调层提供，用于终止对应的交互并释放传输资源，不应抛出异常

- 输出端口失败，以及响应提交后的流源或处理器失败，通知协调层终止交互
- 取消信号只触发响应本地清理，不反向调用 onFailure，避免循环通知
- 提交前的处理器或流源异常仍允许 Application 和错误中间件恢复
- 取消未提交的响应不会将 headersSent 变为 true，协调层可根据提交状态选择发送错误响应或直接关闭传输
- keep-alive 的每个请求创建独立 controller，旧请求的迟到通知不能终止新请求

组装示意：

```ts
const controller = new AbortController();
const req = new NovaRequest(meta, controller.signal);
const res = new NovaResponse(sink, {
  signal: controller.signal,
  onFailure(error) {
    // 协调层取消交互，并根据适配器规则关闭对应连接或流
    controller.abort(error);
    meta.body._fail(error);
    closeTransport();
  },
});
```

实际协调器还需要清理超时任务、保留首次失败原因，并验证失败通知属于当前交互
