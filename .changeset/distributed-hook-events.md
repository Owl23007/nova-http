---
"nova-http": minor
---

将 core Hook 机制与核心生命周期事件保留在 `core/hooks`，server 和 middleware/plugin 事件由各自所属模块通过声明合并扩展。Context 类型统一使用 `*HookContext` 命名，并移除 `CoreHookEvents` 与 `ServerHookEvents` 汇总类型。
