import type { HeaderBlock } from "../../message/headers";
import type { ConnectionIntent } from "../../message/connection";

export type HttpVersion = "1.0" | "1.1";
export type HttpMethod = string;

export type RequestTarget =
  | { readonly form: "origin"; readonly raw: string }
  | {
      readonly form: "absolute";
      readonly raw: string;
      readonly scheme: string;
      readonly authority: string;
      readonly path: string;
    }
  | { readonly form: "authority"; readonly raw: string }
  | { readonly form: "asterisk"; readonly raw: "*" };

export interface ParsedHead {
  readonly method: string;
  readonly rawTarget: string;
  /** 有效目标主机信息，绝对形式和 CONNECT 使用请求目标，其他形式使用 Host */
  readonly authority?: string;
  readonly target: RequestTarget;
  readonly path: string;
  readonly version: HttpVersion;
  readonly headers: HeaderBlock;
}

export type BodyPlan =
  | { readonly type: "none" }
  | { readonly type: "fixed"; readonly length: number }
  | { readonly type: "chunked" };

export interface RequestHead extends ParsedHead {
  readonly bodyPlan: BodyPlan;
  readonly connection: ConnectionIntent;
}
