import { createOrdersSubApp } from "../modules/orders.js";
import { createSearchSubApp } from "../modules/search.js";
import { createUsersSubApp } from "../modules/users.js";

export function registerSubApps(app, createApp) {
  // 每个业务域都是独立 Nova subapp，父应用只负责统一前缀挂载和全局中间件
  app.use("/api/users", createUsersSubApp(createApp));
  app.use("/api/search", createSearchSubApp(createApp));
  app.use("/api/orders", createOrdersSubApp(createApp));
}
