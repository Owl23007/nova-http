import type { Socket } from "net";
import type { ResponseHeaders, ResponseSink } from "../message/response-sink";
import {
  encodeChunk,
  encodeFinalChunk,
  resolveResponsePlan,
  serializeResponseHead,
  type Http1ResponsePlan,
} from "../protocol/http1";

const PREMATURE_CLOSE = "ERR_STREAM_PREMATURE_CLOSE";
const CONTENT_LENGTH_MISMATCH = "ERR_HTTP_CONTENT_LENGTH_MISMATCH";

/** Node transport adapter for the application response output port. */
export class Http1ResponseSink implements ResponseSink {
  private _plan: Http1ResponsePlan | null = null;
  private _bodyBytesWritten = 0;

  constructor(
    private readonly _socket: Socket,
    private readonly _method: string,
    private readonly _version: string,
    private readonly _requestClose: boolean,
    private readonly _signal: AbortSignal,
  ) {}

  get reusable(): boolean {
    return this._plan?.reusable ?? !this._requestClose;
  }

  get bodyBytesWritten(): number {
    return this._bodyBytesWritten;
  }

  assertHeaderAllowed(name: string): void {
    if (name === "transfer-encoding") {
      throw codedError("ERR_MANAGED_RESPONSE_HEADER", "Transfer-Encoding is managed by Nova");
    }
  }

  async commit(status: number, headers: ResponseHeaders): Promise<void> {
    if (this._plan !== null) return;
    this._plan = resolveResponsePlan(
      this._method,
      this._version,
      this._requestClose,
      status,
      headers,
    );
    await this._writeBuffers([serializeResponseHead(this._version, status, this._plan.headers)]);
  }

  async write(body: Buffer): Promise<void> {
    const plan = this._requirePlan();
    if (body.length === 0 || plan.mode === "none") return;
    if (plan.mode === "fixed") {
      const next = this._bodyBytesWritten + body.length;
      if (plan.contentLength === null || next > plan.contentLength) {
        throw codedError(CONTENT_LENGTH_MISMATCH, "Response body exceeds Content-Length");
      }
      await this._writeBuffers([body]);
    } else if (plan.mode === "chunked") {
      await this._writeBuffers(encodeChunk(body));
    } else {
      await this._writeBuffers([body]);
    }
    this._bodyBytesWritten += body.length;
  }

  async end(): Promise<void> {
    const plan = this._requirePlan();
    if (plan.mode === "fixed" && this._bodyBytesWritten !== plan.contentLength) {
      throw codedError(
        CONTENT_LENGTH_MISMATCH,
        `Response body length ${this._bodyBytesWritten} does not match Content-Length ${plan.contentLength}`,
      );
    }
    if (plan.mode === "chunked") await this._writeBuffers([encodeFinalChunk()]);
  }

  abort(error: Error, closeTransport: boolean): void {
    if (closeTransport && !this._socket.destroyed) this._socket.destroy(error);
  }

  private _requirePlan(): Http1ResponsePlan {
    if (this._plan === null) throw new Error("Response sink was not committed");
    return this._plan;
  }

  private async _writeBuffers(buffers: readonly Buffer[]): Promise<void> {
    if (this._socket.destroyed || !this._socket.writable) {
      throw codedError(PREMATURE_CLOSE, "Socket is not writable");
    }
    if (this._signal.aborted) throw abortReason(this._signal);
    let needsDrain = false;
    this._socket.cork();
    try {
      for (const buffer of buffers)
        if (buffer.length > 0 && !this._socket.write(buffer)) needsDrain = true;
    } finally {
      this._socket.uncork();
    }
    if (needsDrain && this._socket.writableNeedDrain) await this._waitForDrain();
  }

  private _waitForDrain(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        this._socket.off("drain", onDrain);
        this._socket.off("error", onError);
        this._socket.off("close", onClose);
        this._signal.removeEventListener("abort", onAbort);
      };
      const settle = (error?: Error): void => {
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const onDrain = (): void => settle();
      const onError = (error: Error): void => settle(error);
      const onClose = (): void => settle(codedError(PREMATURE_CLOSE, "Socket closed before drain"));
      const onAbort = (): void => settle(abortReason(this._signal));
      this._socket.once("drain", onDrain);
      this._socket.once("error", onError);
      this._socket.once("close", onClose);
      this._signal.addEventListener("abort", onAbort, { once: true });
      if (!this._socket.writableNeedDrain) settle();
    });
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : codedError(PREMATURE_CLOSE, "Response was aborted");
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
