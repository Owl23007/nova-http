import { Socket } from "net";
import { describe, expect, it } from "vitest";
import { NovaResponse, type NovaRequest } from "../../src/core";

function createResponse(): NovaResponse {
  return new NovaResponse(new Socket(), { method: "GET" } as NovaRequest);
}

describe("NovaResponse", () => {
  it("rejects invalid header names and values", () => {
    const response = createResponse();

    expect(() => response.setHeader("x-valid\r\ninjected", "value")).toThrow(TypeError);
    expect(() => response.setHeader("x-valid", "value\r\nx-injected: true")).toThrow(TypeError);
    expect(() => response.setHeader("x-valid", ["safe", "unsafe\nvalue"])).toThrow(TypeError);
  });

  it("copies header arrays so later mutations cannot inject values", () => {
    const response = createResponse();
    const values = ["safe"];

    response.setHeader("x-values", values);
    values.push("unsafe\r\nx-injected: true");

    expect(response.getHeader("x-values")).toEqual(["safe"]);
  });

  it("rejects invalid status codes", () => {
    const response = createResponse();

    expect(() => response.status(99)).toThrow(RangeError);
    expect(() => response.status(1000)).toThrow(RangeError);
    expect(() => response.status(200.5)).toThrow(RangeError);
  });

  it("rejects response splitting through redirect locations", () => {
    const response = createResponse();

    expect(() => response.redirect("/safe\r\nx-injected: true")).toThrow(TypeError);
  });
});
