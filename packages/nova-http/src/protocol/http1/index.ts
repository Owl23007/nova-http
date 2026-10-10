/** 同步 HTTP/1 协议工具；不导出网络、异步请求体或应用分发实现 */
export { SegmentedInput } from "./input";
export { getReasonPhrase } from "./status";
export {
  encodeChunk,
  encodeFinalChunk,
  resolveResponsePlan,
  serializeResponseHead,
} from "./response";
export {
  buildRequestHead,
  createHeadScanState,
  DEFAULT_PARSER_LIMITS,
  parseHead,
  parseTrailers,
  resolveConnectionIntent,
  resolveFraming,
  scanHead,
  takeScannedBlock,
} from "./parser";
export type { Http1Error, Http1ErrorPhase, Http1ErrorType } from "./errors";
export type { HeadScanResult, HeadScanState, ParserLimits } from "./parser";
export type { Http1ResponseBodyMode, Http1ResponsePlan } from "./response";
export type { BodyPlan, HttpVersion, ParsedHead, RequestHead, RequestTarget } from "./types";
