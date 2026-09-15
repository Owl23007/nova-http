---
description: Application 的分发步骤、中间件执行、挂载回退与完成观察。
---

# 应用分发

Application 负责执行中间件、匹配路由和处理错误；Router 只匹配路径；NovaResponse 只管理响应输出。成功完成观察者由分发层持有。

## 分发顺序

```text
onRequest
  → 当前应用普通中间件
  → 路由匹配 → onRoute → 路由中间件 → 终端处理器
  → 等待响应完成 → 子应用观察者 → 当前应用 onResponse
```

普通中间件已经提交响应时跳过路由。没有匹配路径生成 404，路径存在但方法不支持生成 405。处理过程抛错先经过当前应用错误链，未恢复错误再进入分发层的最终失败处理。

## 中间件执行边界

执行器将四参数函数分类为错误处理器，每次调用维护 nextCalled 防止重复前进。next 返回 void，异步中间件在调用 next 前完成自己负责的工作。路由的多处理器组合在注册阶段完成，最后一项作为终端处理器。

## 挂载与回退

挂载中间件判断字面路径边界，再创建相对路径请求视图。子应用未找到路由时允许父应用继续；返回 405 或已经产生响应时视为已处理。普通前缀中间件不创建路径视图。

## 完成观察与清理

分发层用按响应关联的 WeakMap 保存参与应用的完成观察者，避免把应用引用放进 NovaResponse。响应成功后通知，失败和退出时清理。已提交但未请求结束的手动流会触发 ERR_RESPONSE_NOT_ENDED。

修改时运行 `middleware.spec.ts`、`router.spec.ts`、`hooks.spec.ts` 和 `nova.integration.spec.ts`。源码入口为 [application.ts](https://github.com/Owl23007/nova-http/blob/master/packages/nova-http/src/core/application.ts)。
