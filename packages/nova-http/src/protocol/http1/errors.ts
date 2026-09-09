export type Http1ErrorType = "syntax" | "framing" | "limit" | "incomplete" | "unsupported";
export type Http1ErrorPhase = "request-line" | "headers" | "body" | "trailers";

export interface Http1Error {
  type: Http1ErrorType;
  code: string;
  status: number;
  phase: Http1ErrorPhase;
  fatal: true;
  message: string;
}

export function http1Error(
  type: Http1ErrorType,
  code: string,
  status: number,
  phase: Http1ErrorPhase,
  message: string,
): Http1Error {
  return { type, code, status, phase, fatal: true, message };
}
