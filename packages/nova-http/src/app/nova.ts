import { Application } from "../core/application";
import { NodeHttpServer, type Http1ConnectionConfig, type Http1ConnectionContext } from "../server";

export type { RouteBuilder } from "../core/route-builder";

/** 基于 Node HTTP 服务器的 Nova 应用程序配置项 */
export interface NovaConfig extends Partial<Http1ConnectionConfig> {
  port?: number;
  host?: string;
  maxConnections?: number;
}

/** 实现内核 Application,对外提供 Nova 应用程序 */
export class Nova extends Application {
  /** 完整的 Nova 应用程序配置项 */
  private readonly _fullConfig: Required<NovaConfig>;
  /** Node HTTP 服务器实例 */
  private readonly nodeServer: NodeHttpServer;

  constructor(config: NovaConfig = {}) {
    // 1. 初始化 Application 内核
    super();
    // 2. 验证并初始化 Nova 应用程序配置项
    validateNovaConfig(config);
    this._fullConfig = {
      port: config.port ?? 3000,
      host: config.host ?? "0.0.0.0",
      maxConnections: config.maxConnections ?? 0,
      headersTimeout: config.headersTimeout ?? 60_000,
      keepAliveTimeout: config.keepAliveTimeout ?? 65_000,
      requestTimeout: config.requestTimeout ?? 600_000,
      bodyIdleTimeout: config.bodyIdleTimeout ?? 30_000,
      maxBodySize: config.maxBodySize ?? 1_048_576,
      bodyHighWaterMark: config.bodyHighWaterMark ?? 64 * 1024,
      trustProxy: config.trustProxy ?? false,
      parserLimits: config.parserLimits ?? {},
      checkContinue: config.checkContinue ?? (() => true),
    };
    // 3. 初始化 Node HTTP 服务器实例
    const connectionContext: Http1ConnectionContext = {
      config: {
        headersTimeout: this._fullConfig.headersTimeout,
        keepAliveTimeout: this._fullConfig.keepAliveTimeout,
        requestTimeout: this._fullConfig.requestTimeout,
        bodyIdleTimeout: this._fullConfig.bodyIdleTimeout,
        maxBodySize: this._fullConfig.maxBodySize,
        bodyHighWaterMark: this._fullConfig.bodyHighWaterMark,
        trustProxy: this._fullConfig.trustProxy,
        parserLimits: this._fullConfig.parserLimits,
        checkContinue: this._fullConfig.checkContinue,
      },
      dispatch: (req, res) => this.dispatch(req, res),
      onConnect: (connection) =>
        this.hooks.emitHook("onConnect", { connection, timestamp: Date.now() }),
      onClose: (connection) =>
        this.hooks.emitHook("onDisconnect", { connection, timestamp: Date.now() }),
      onError: (error, connection) => this.hooks.emitHook("onError", { error, connection }),
    };
    this.nodeServer = new NodeHttpServer(connectionContext, this._fullConfig.maxConnections, {
      onError: (error) => this.hooks.emitHook("onError", { error }),
      onListen: (port, host) => this.hooks.emitHook("onListen", { port, host }),
      onClose: () => this.hooks.emitHook("onClose", undefined as void),
    });
  }

  /** 启动 Nova 应用程序，监听指定端口和主机 */
  listen(port?: number, host?: string, callback?: () => void): Promise<void> {
    const listenPort = port ?? this._fullConfig.port;
    const listenHost = host ?? this._fullConfig.host;
    return this.nodeServer.listen(listenPort, listenHost).then(() => {
      callback?.();
    });
  }

  /** 获取 Nova 应用程序的监听地址信息 */
  address(): ReturnType<NodeHttpServer["address"]> {
    return this.nodeServer.address();
  }

  /** 关闭 Nova 应用程序，释放资源 */
  close(): Promise<void> {
    return this.nodeServer.close();
  }
}

export function createApp(config?: NovaConfig): Nova {
  return new Nova(config);
}

/** 验证 Nova 应用程序配置项的合法性 */
function validateNovaConfig(config: NovaConfig): void {
  const nonNegative = [
    ["headersTimeout", config.headersTimeout],
    ["keepAliveTimeout", config.keepAliveTimeout],
    ["bodyIdleTimeout", config.bodyIdleTimeout],
    ["requestTimeout", config.requestTimeout],
    ["maxBodySize", config.maxBodySize],
    ["maxConnections", config.maxConnections],
  ] as const;

  // 1. 验证非负整数配置项
  for (const [name, value] of nonNegative) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError(`${name} must be a non-negative safe integer`);
    }
  }

  // 2. 验证 bodyHighWaterMark 配置项
  // bodyHighWaterMark 是一个正整数，表示请求体的高水位标记，用于控制流量和内存使用
  if (
    config.bodyHighWaterMark !== undefined &&
    (!Number.isSafeInteger(config.bodyHighWaterMark) || config.bodyHighWaterMark <= 0)
  ) {
    throw new RangeError("bodyHighWaterMark must be a positive safe integer");
  }

  // 3. 验证 parserLimits 配置项
  // parserLimits 用于控制 HTTP 解析器的限制，确保请求头和请求体的大小在合理范围内
  if (config.parserLimits !== undefined) {
    for (const [name, value] of Object.entries(config.parserLimits)) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
        throw new RangeError(`parserLimits.${name} must be a positive safe integer`);
      }
    }
  }

  // 4. 验证 checkContinue 配置项
  // checkContinue 是一个函数，用于处理 HTTP 100 Continue 请求，确保其类型正确
  // HTTP 100 Continue 机制，允许客户端在发送请求体之前等待服务器的确认，减少不必要的数据传输
  if (config.checkContinue !== undefined && typeof config.checkContinue !== "function") {
    throw new TypeError("checkContinue must be a function");
  }

  // 5. 验证 trustProxy 配置项
  // trustProxy 用于控制是否信任代理服务器的 X-Forwarded-* 头部信息
  const trustProxy = config.trustProxy;
  if (trustProxy !== undefined) {
    const type = typeof trustProxy;
    if (typeof trustProxy === "number") {
      if (!Number.isSafeInteger(trustProxy) || trustProxy < 0) {
        throw new RangeError("trustProxy must be a non-negative safe integer");
      }
    } else if (type !== "boolean" && type !== "function") {
      throw new TypeError("trustProxy must be a boolean, non-negative integer, or function");
    }
  }
}
