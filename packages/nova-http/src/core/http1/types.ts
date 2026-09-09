import type { IncomingBody } from "./body";
import type { HeaderBlock } from "./headers";

export type HttpVersion = "1.0" | "1.1";
export type HttpMethod = string;

export type RequestTarget =
  | { readonly form: "origin"; readonly raw: string }
  | { readonly form: "absolute"; readonly raw: string }
  | { readonly form: "authority"; readonly raw: string }
  | { readonly form: "asterisk"; readonly raw: "*" };

export interface ParsedHead {
  readonly method: string;
  readonly rawTarget: string;
  readonly target: RequestTarget;
  readonly version: HttpVersion;
  readonly headers: HeaderBlock;
}

export type BodyPlan =
  | { readonly type: "none" }
  | { readonly type: "fixed"; readonly length: number }
  | { readonly type: "chunked" };

export interface ConnectionIntent {
  readonly close: boolean;
  readonly connect: boolean;
  readonly upgrade?: string;
}

export interface RequestHead extends ParsedHead {
  readonly bodyPlan: BodyPlan;
  readonly connection: ConnectionIntent;
}

export interface ParsedRequest extends RequestHead {
  readonly body: IncomingBody;
  readonly trailers: HeaderBlock;
}
