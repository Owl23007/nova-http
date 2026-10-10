import {
  createApp,
  type ContinueDecision,
  type HookEvents,
  type ListenAddress,
  type NovaConfig,
  type ParsedRequest,
  type RouteMatch,
  type TrustProxy,
} from "nova-http";
import {
  HeaderBlock,
  IncomingBody,
  type IncomingRequestMeta,
  type ResponseOptions,
} from "../../src/core";
import type { BodyPlan, RequestHead } from "../../src/protocol/http1";
import type { Http1ConnectionConfig } from "../../src/server/http1-connection";
import type { AddressInfo } from "net";

const trust: TrustProxy = (address, hop) => address === "127.0.0.1" && hop === 0;
const checkContinue = (head: RequestHead): ContinueDecision =>
  head.method === "POST" ? true : { status: 405, message: "Method not allowed" };
const config: NovaConfig = {
  port: 0,
  host: "127.0.0.1",
  maxConnections: 10,
  headersTimeout: 0,
  keepAliveTimeout: 0,
  requestTimeout: 0,
  bodyIdleTimeout: 0,
  maxBodySize: 1024,
  bodyHighWaterMark: 512,
  trustProxy: trust,
  parserLimits: { maxHeadBytes: 1024 },
  checkContinue,
};
const app = createApp(config);
app.addHook("onConnect", ({ connection, timestamp }) => {
  connection.remoteAddress satisfies string | undefined;
  timestamp satisfies number;
});
app.addHook("onDisconnect", (context: HookEvents["onDisconnect"]) => {
  context.connection.localPort satisfies number | undefined;
});
app.addHook("onListen", ({ port, host }) => {
  port satisfies number;
  host satisfies string;
});

// 保留配置与 Node 地址的结构兼容，但公开签名不引用服务器实现。
function checkConfiguration(old: Partial<Http1ConnectionConfig>, current: NovaConfig): void {
  old satisfies NovaConfig;
  current satisfies Partial<Http1ConnectionConfig>;
}
function checkAddress(address: ListenAddress, nodeAddress: AddressInfo): void {
  address satisfies AddressInfo;
  nodeAddress satisfies ListenAddress;
}
function checkLegacyTypes(
  request: ParsedRequest,
  meta: IncomingRequestMeta,
  match: RouteMatch,
): void {
  request satisfies IncomingRequestMeta;
  meta satisfies ParsedRequest;
  match.params satisfies Record<string, string>;
}
new HeaderBlock();
new IncomingBody(false, 1024, () => {});
function checkExtension(options: ResponseOptions, plan: BodyPlan): void {
  options.signal satisfies AbortSignal;
  plan.type satisfies "none" | "fixed" | "chunked";
}
// @ts-expect-error checkContinue 仍然只接受同步策略。
createApp({ checkContinue: async () => true });
// @ts-expect-error 消息构造器只从 core 导入。
import { HeaderBlock as RootHeaderBlock } from "nova-http";
// @ts-expect-error 响应构造选项只属于框架扩展入口。
import type { ResponseOptions as RootResponseOptions } from "nova-http";
// @ts-expect-error 连接协调配置是 server 实现细节。
import type { Http1ConnectionConfig as RootConnectionConfig } from "nova-http";
// @ts-expect-error 定界方案只属于同步协议入口。
import type { BodyPlan as RootBodyPlan } from "nova-http";
// @ts-expect-error core 不公开服务器协调器。
import { Http1ConnectionCoordinator } from "../../src/core";
// @ts-expect-error 协议入口不公开异步请求体。
import { IncomingBody as ProtocolIncomingBody } from "../../src/protocol/http1";
