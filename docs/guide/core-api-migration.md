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
- RequestCancellation 只负责共享取消状态，不负责响应完成或应用分发
- mount 计算挂载路径并委托 Request 创建视图

新增 API 代码应依赖公共入口，不应依赖包内未导出的执行器和构建工具
