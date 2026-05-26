/**
 * BufferReader — 滚动 Buffer 读取器
 *
 * 职责：在 TCP 流分包场景下，安全地从 Buffer 中按行或按字节读取数据
 *
 * 设计原则：
 *   - 仅在必要时（offset > length/2）触发 compact
 *   - 所有读取操作均通过 offset 推进，不修改底层 buf
 *   - readLine 扫描 CRLF`\r\n`，返回不含 CRLF 的行字符串
 */
export class BufferReader {
  /** 当前内部缓冲区 */
  private _buf: Buffer = Buffer.allocUnsafe(0);
  /** 当前读取偏移量 */
  private _offset: number = 0;

  /**
   * 追加新到达的 TCP 数据块到缓冲区
   *
   * 若 offset 超过缓冲区一半则先 compact，减少内存碎片
   */
  feed(chunk: Buffer): void {
    if (this._offset > 0 && this._offset >= this._buf.length / 2) {
      this.compact();
    }
    if (this._buf.length === this._offset) {
      // 缓冲区已完全消费，直接替换
      this._buf = chunk;
      this._offset = 0;
    } else {
      this._buf = Buffer.concat([this._buf.subarray(this._offset), chunk]);
      this._offset = 0;
    }
  }

  /**
   * 读取一行，判断条件为 `\r\n`
   * @returns 行内容 或 null
   */
  readLine(): string | null {
    const buf = this._buf; // 当前缓冲区
    const start = this._offset;
    const end = buf.length;

    for (let i = start; i < end - 1; i++) {
      if (buf[i] === 0x0d && buf[i + 1] === 0x0a) {
        // 找到 \r\n
        const line = buf.toString("latin1", start, i);
        this._offset = i + 2; // 跳过 \r\n
        return line;
      }
    }
    return null; // 数据不足
  }

  /**
   * 读取确定数量的字节
   * @returns Buffer 切片，或 null
   */
  readBytes(n: number): Buffer | null {
    if (this._offset + n > this._buf.length) {
      return null;
    }
    const slice = this._buf.subarray(this._offset, this._offset + n);
    this._offset += n;
    return slice;
  }

  /**
   * 跳过 n 个字节
   * @returns 是否成功跳过
   */
  skipBytes(n: number): boolean {
    if (this._offset + n > this._buf.length) {
      return false;
    }
    this._offset += n;
    return true;
  }

  /**
   * 查看接下来 n 字节，不推进 offset
   *
   * @param n 查看的字节数
   *
   * @returns null
   */
  peekBytes(n: number): Buffer | null {
    if (this._offset + n > this._buf.length) {
      return null;
    }
    return this._buf.subarray(this._offset, this._offset + n);
  }

  /** 当前未读取的字节数 */
  get remaining(): number {
    return this._buf.length - this._offset;
  }

  /** 是否已无可读数据 */
  get isEmpty(): boolean {
    return this._offset >= this._buf.length;
  }

  /**
   * 紧缩缓冲区：将 offset 之后的内容移到开头，释放已消费的空间
   */
  compact(): void {
    if (this._offset === 0) return;
    if (this._offset >= this._buf.length) {
      this._buf = Buffer.allocUnsafe(0);
    } else {
      this._buf = this._buf.subarray(this._offset);
    }
    this._offset = 0;
  }

  /**
   * 重置读取器状态
   *
   * @returns null
   */
  reset(): void {
    this._buf = Buffer.allocUnsafe(0);
    this._offset = 0;
  }
}
