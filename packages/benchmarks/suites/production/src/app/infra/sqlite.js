import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export async function createSqliteDatabase(config) {
  // 只使用真实 SQLite 文件；如果当前 Node 不支持 node:sqlite，启动阶段直接失败
  const { DatabaseSync } = await import("node:sqlite");
  mkdirSync(dirname(config.sqlitePath), { recursive: true });

  const database = new DatabaseSync(config.sqlitePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL,
      plan TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      item_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  seedUsers(database);

  return {
    kind: "sqlite",
    getUser(id) {
      return database
        .prepare("SELECT id, name, role, active, plan FROM users WHERE id = ?")
        .get(id);
    },
    createOrder({ customerId, itemCount }) {
      const order = {
        id: `ord-${randomUUID()}`,
        customerId,
        itemCount,
        status: "accepted",
        createdAt: new Date().toISOString(),
      };
      database
        .prepare(
          "INSERT INTO orders (id, customer_id, item_count, status, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(order.id, order.customerId, order.itemCount, order.status, order.createdAt);
      return order;
    },
    countOrders() {
      return database.prepare("SELECT COUNT(*) AS count FROM orders").get().count;
    },
    close() {
      database.close();
    },
  };
}

function seedUsers(database) {
  // 固定种子数据让压测请求稳定命中同一批用户，减少数据生成对结果的干扰
  const insert = database.prepare(
    "INSERT OR IGNORE INTO users (id, name, role, active, plan) VALUES (?, ?, ?, ?, ?)",
  );

  for (const user of [
    ["42", "user-42", "member", 1, "pro"],
    ["1001", "user-1001", "admin", 1, "enterprise"],
  ]) {
    insert.run(...user);
  }
}
