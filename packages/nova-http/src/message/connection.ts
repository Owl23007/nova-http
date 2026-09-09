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
