import { describe, expect, it } from "vitest";
import * as application from "../../src";
import * as core from "../../src/core";
import * as http1 from "../../src/protocol/http1";

// 这些入口是供消费者使用的契约；新增导出必须明确所属层。
describe("public API boundaries", () => {
  it("exposes everyday application values at the root", () => {
    expect(Object.keys(application).sort()).toEqual([
      "Nova",
      "bodyParser",
      "createApp",
      "getMimeType",
      "sendFile",
      "staticFiles",
    ]);
  });

  it("exposes framework extension values only from core", () => {
    expect(Object.keys(core).sort()).toEqual([
      "Application",
      "HeaderBlock",
      "Hooks",
      "IncomingBody",
      "NovaRequest",
      "NovaResponse",
      "Router",
    ]);
  });

  it("exposes only synchronous HTTP/1 tools", () => {
    expect(Object.keys(http1).sort()).toEqual([
      "DEFAULT_PARSER_LIMITS",
      "SegmentedInput",
      "buildRequestHead",
      "createHeadScanState",
      "encodeChunk",
      "encodeFinalChunk",
      "getReasonPhrase",
      "parseHead",
      "parseTrailers",
      "resolveConnectionIntent",
      "resolveFraming",
      "resolveResponsePlan",
      "scanHead",
      "serializeResponseHead",
      "takeScannedBlock",
    ]);
    const parsed = http1.parseHead(
      Buffer.from("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n"),
      http1.DEFAULT_PARSER_LIMITS,
    );
    expect(parsed).not.toBeInstanceOf(Promise);
    if ("fatal" in parsed) throw new Error(parsed.message);
    const head = http1.buildRequestHead(parsed);
    expect(head).not.toBeInstanceOf(Promise);
    if ("fatal" in head) throw new Error(head.message);
    expect(head.bodyPlan).toEqual({ type: "none" });
    const plan = http1.resolveResponsePlan("GET", "1.1", false, 200, new Map());
    expect(plan).not.toBeInstanceOf(Promise);
    expect(Buffer.isBuffer(http1.serializeResponseHead("1.1", 200, plan.headers))).toBe(true);
  });
});
