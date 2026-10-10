import type { IncomingBody } from "./body";
import type { ConnectionInfo, ConnectionIntent } from "./connection";
import type { HeaderBlock } from "./headers";

export type HttpMethod = string;

/** 交付应用内核的传输无关请求契约 */
export interface IncomingRequestMeta {
  readonly method: string;
  /** 适配层根据代理信任策略确定的客户端 IP */
  readonly clientIp: string;
  /** 原始 request-target，不解码或规范化 */
  readonly rawTarget: string;
  /** 有效目标主机信息，绝对形式和 CONNECT 使用请求目标，其他形式使用 Host */
  readonly authority?: string;
  /** 协议适配层提取的应用路径及查询字符串 */
  readonly path: string;
  readonly version: string;
  readonly headers: HeaderBlock;
  readonly body: IncomingBody;
  readonly trailers: HeaderBlock;
  readonly connection: ConnectionIntent;
  readonly peer: ConnectionInfo;
}

/** @deprecated 请使用 IncomingRequestMeta */
export type ParsedRequest = IncomingRequestMeta;
