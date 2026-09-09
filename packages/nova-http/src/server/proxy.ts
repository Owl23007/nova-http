import { isIP } from "net";
import type { HeaderBlock } from "../message/headers";
import type { ConnectionInfo } from "../message/connection";

/** false 不信任代理，true 信任全部代理，也可指定可信跳数或逐跳判断函数 */
export type TrustProxy = boolean | number | ((address: string, hop: number) => boolean);

/** 从直连对端向外检查代理链，返回第一个不受信任的地址 */
export function resolveClientIp(
  peer: ConnectionInfo,
  headers: HeaderBlock,
  trust: TrustProxy,
): string {
  let address = peer.remoteAddress ?? "0.0.0.0";
  const forwarded = headers.getAll("x-forwarded-for").join(",");
  if (!peer.remoteAddress || !forwarded || trust === false) return address;
  const chain = forwarded.split(",").map((value) => value.trim());
  for (let index = chain.length - 1, hop = 0; index >= 0; index--, hop++) {
    const trusted =
      typeof trust === "function" ? trust(address, hop) : trust === true || hop < trust;
    if (typeof trusted !== "boolean") {
      throw new TypeError("trustProxy function must return a boolean");
    }
    if (!trusted || !isIP(chain[index])) break;
    address = chain[index];
  }
  return address;
}
