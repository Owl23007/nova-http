/** Transport-neutral peer information exposed to the application layer. */
export interface ConnectionInfo {
  readonly remoteAddress?: string;
  readonly remotePort?: number;
  readonly localAddress?: string;
  readonly localPort?: number;
}

/** Protocol decision about connection persistence and tunnelling. */
export interface ConnectionIntent {
  readonly close: boolean;
  readonly connect: boolean;
  readonly upgrade?: string;
}

/** 代理信任策略，不持有连接或 Socket */
export type TrustProxy = boolean | number | ((address: string, hop: number) => boolean);

/** 应用在接收请求体前允许继续或拒绝的同步决策 */
export type ContinueDecision = true | { readonly status: number; readonly message: string };
