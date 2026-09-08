import net from "node:net";

export async function createRedisClient(config) {
  // 只连接真实 Redis；压测和测试都覆盖实际网络与 Redis 命令开销
  const client = new RedisTcpClient(config);
  await client.connect();
  return client;
}

class RedisTcpClient {
  constructor(config) {
    this.kind = "tcp-redis";
    this.host = config.redisHost;
    this.port = config.redisPort;
    this.database = config.redisDatabase;
    this.keyPrefix = config.redisKeyPrefix;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = [];
  }

  async connect() {
    // 使用最小 RESP 客户端直连 redis:alpine，避免为了压测脚本额外引入运行时依赖
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port }, resolve);
      socket.once("error", reject);
      this.socket = socket;
    });

    this.socket.on("data", (chunk) => this.onData(chunk));
    this.socket.on("error", (error) => this.rejectPending(error));
    this.socket.on("close", () => this.rejectPending(new Error("redis connection closed")));

    const pong = await this.command(["PING"]);
    if (pong !== "PONG") {
      throw new Error(`unexpected Redis PING response: ${pong}`);
    }

    if (this.database > 0) {
      await this.command(["SELECT", String(this.database)]);
    }
  }

  async get(key) {
    return this.command(["GET", this.withPrefix(key)]);
  }

  async set(key, value, options = {}) {
    const command = ["SET", this.withPrefix(key), value];
    if (options.ttlMs) {
      command.push("PX", String(options.ttlMs));
    }
    await this.command(command);
  }

  async incr(key) {
    return this.command(["INCR", this.withPrefix(key)]);
  }

  async del(key) {
    await this.command(["DEL", this.withPrefix(key)]);
  }

  async close() {
    if (!this.socket || this.socket.destroyed) return;

    try {
      await this.command(["QUIT"]);
    } catch {
      // Redis 可能先关闭连接，退出阶段只做 best effort 清理
    } finally {
      this.socket.destroy();
    }
  }

  command(parts) {
    if (!this.socket || this.socket.destroyed) {
      return Promise.reject(new Error("redis connection is not open"));
    }

    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket.write(encodeCommand(parts));
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.pending.length > 0) {
      const parsed = parseResponse(this.buffer);
      if (!parsed) return;

      this.buffer = this.buffer.subarray(parsed.bytes);
      const pending = this.pending.shift();
      if (parsed.error) {
        pending.reject(parsed.error);
      } else {
        pending.resolve(parsed.value);
      }
    }
  }

  rejectPending(error) {
    while (this.pending.length > 0) {
      this.pending.shift().reject(error);
    }
  }

  withPrefix(key) {
    return `${this.keyPrefix}:${key}`;
  }
}

function encodeCommand(parts) {
  // RESP 数组编码：*参数数量 + 多个 bulk string
  const chunks = [`*${parts.length}\r\n`];
  for (const part of parts) {
    const value = String(part);
    chunks.push(`$${Buffer.byteLength(value)}\r\n${value}\r\n`);
  }
  return chunks.join("");
}

function parseResponse(buffer) {
  if (buffer.length === 0) return null;

  const type = String.fromCharCode(buffer[0]);
  if (type === "+" || type === "-" || type === ":") {
    const end = buffer.indexOf("\r\n");
    if (end === -1) return null;

    const line = buffer.subarray(1, end).toString("utf8");
    if (type === "-") {
      return { bytes: end + 2, error: new Error(`Redis error: ${line}`) };
    }
    return {
      bytes: end + 2,
      value: type === ":" ? Number(line) : line,
    };
  }

  if (type === "$") {
    const end = buffer.indexOf("\r\n");
    if (end === -1) return null;

    const length = Number(buffer.subarray(1, end).toString("utf8"));
    if (length === -1) {
      return { bytes: end + 2, value: null };
    }

    const bodyStart = end + 2;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd + 2) return null;

    return {
      bytes: bodyEnd + 2,
      value: buffer.subarray(bodyStart, bodyEnd).toString("utf8"),
    };
  }

  return {
    bytes: buffer.length,
    error: new Error(`unsupported Redis response type: ${type}`),
  };
}
