import type { ParserLimits } from "../protocol/http1/parser";
import type { RequestHead } from "../protocol/http1/types";
import type { ContinueDecision, TrustProxy } from "../message/connection";

export type { ContinueDecision, TrustProxy } from "../message/connection";

/** 应用监听地址，与 Node TCP 地址结构兼容 */
export interface ListenAddress {
  address: string;
  family: string;
  port: number;
}

/** 应用配置契约，不继承连接协调器的内部配置 */
export interface NovaConfig {
  port?: number;
  host?: string;
  maxConnections?: number;
  headersTimeout?: number;
  keepAliveTimeout?: number;
  requestTimeout?: number;
  bodyIdleTimeout?: number;
  maxBodySize?: number;
  bodyHighWaterMark?: number;
  trustProxy?: TrustProxy;
  parserLimits?: Partial<ParserLimits>;
  checkContinue?: (head: RequestHead) => ContinueDecision;
}
