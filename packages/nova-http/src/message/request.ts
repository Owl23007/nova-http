import type { IncomingBody } from "./body";
import type { ConnectionInfo, ConnectionIntent } from "./connection";
import type { HeaderBlock } from "./headers";

export type HttpMethod = string;

/** Transport-neutral request contract delivered to the application kernel. */
export interface IncomingRequestMeta {
  readonly method: string;
  readonly target: string;
  readonly version: string;
  readonly headers: HeaderBlock;
  readonly body: IncomingBody;
  readonly trailers: HeaderBlock;
  readonly connection: ConnectionIntent;
  readonly peer: ConnectionInfo;
}

/** @deprecated Use IncomingRequestMeta. */
export type ParsedRequest = IncomingRequestMeta;
