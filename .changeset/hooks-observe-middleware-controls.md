---
"nova-http": minor
---

明确 middleware 参与控制流、hook 仅观察生命周期的边界。
移除 `callHookAsync` 和冗余的 `createRequestTimer()`，请直接使用 `onResponse.durationMs` 记录或上报请求耗时；同时使 `onNotFound` 在默认 404 响应确定后触发。
