import { Readable } from "stream";

export interface BodyReadOptions {
  maxSize?: number;
}

/** 使用 Node Readable 背压语义的流式请求体 */
export class IncomingBody extends Readable {
  private _receivedBytes = 0;
  private _messageComplete = false;
  private _hasContent: boolean;

  constructor(
    hasContent: boolean,
    highWaterMark: number,
    private readonly _resumePump: () => void,
  ) {
    super({ highWaterMark });
    this._hasContent = hasContent;
  }

  get bytesReceived(): number {
    return this._receivedBytes;
  }

  get messageComplete(): boolean {
    return this._messageComplete;
  }

  get fullyConsumed(): boolean {
    return (
      this._messageComplete &&
      (!this._hasContent || (this.readableEnded && this.readableLength === 0))
    );
  }

  /** 仅供 HTTP 内核推送已解码的请求体视图 */
  _accept(chunk: Buffer): boolean {
    this._receivedBytes += chunk.length;
    return this.push(chunk);
  }

  /** 仅供 HTTP 内核标记消息完成 */
  _complete(): void {
    if (this._messageComplete) return;
    this._messageComplete = true;
    this.push(null);
  }

  /** 仅供 HTTP 内核传播输入错误 */
  _fail(error: Error): void {
    if (this.listenerCount("error") === 0) this.once("error", () => undefined);
    if (!this.destroyed) this.destroy(error);
  }

  async buffer(options: BodyReadOptions = {}): Promise<Buffer> {
    const maxSize = options.maxSize ?? Number.MAX_SAFE_INTEGER;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of this) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxSize) {
        this.destroy(new RangeError("Request body exceeds the configured limit"));
        throw new RangeError("Request body exceeds the configured limit");
      }
      chunks.push(buffer);
    }
    if (chunks.length === 0) return Buffer.alloc(0);
    if (chunks.length === 1) return chunks[0];
    return Buffer.concat(chunks, size);
  }

  async text(encoding: BufferEncoding = "utf8", options: BodyReadOptions = {}): Promise<string> {
    return (await this.buffer(options)).toString(encoding);
  }

  async json<T = unknown>(options: BodyReadOptions = {}): Promise<T> {
    return JSON.parse(await this.text("utf8", options)) as T;
  }

  override _read(): void {
    this._resumePump();
  }
}
