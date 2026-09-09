/** TCP 分段字节输入，只负责存储和单调消费 */
export class SegmentedInput {
  private _chunks: Buffer[] = [];
  private _headIndex = 0;
  private _headOffset = 0;
  private _available = 0;
  private _ended = false;

  append(chunk: Buffer): void {
    if (this._ended) throw new Error("Cannot append after input has ended");
    if (chunk.length === 0) return;
    this._chunks.push(chunk);
    this._available += chunk.length;
  }

  end(): void {
    this._ended = true;
  }

  get ended(): boolean {
    return this._ended;
  }

  get available(): number {
    return this._available;
  }

  front(): Buffer | null {
    if (this._available === 0) return null;
    return this._chunks[this._headIndex].subarray(this._headOffset);
  }

  consume(bytes: number): void {
    if (!Number.isInteger(bytes) || bytes < 0 || bytes > this._available) {
      throw new RangeError("Cannot consume beyond available input");
    }

    this._available -= bytes;
    while (bytes > 0) {
      const head = this._chunks[this._headIndex];
      const remaining = head.length - this._headOffset;
      if (bytes < remaining) {
        this._headOffset += bytes;
        bytes = 0;
      } else {
        bytes -= remaining;
        this._headIndex++;
        this._headOffset = 0;
      }
    }
    this._compactReferences();
  }

  /** 复制并消费输入前缀，连续前缀应优先使用 front 和 consume */
  copyPrefix(length: number): Buffer {
    if (!Number.isInteger(length) || length < 0 || length > this._available) {
      throw new RangeError("Cannot copy beyond available input");
    }
    const result = Buffer.allocUnsafe(length);
    let written = 0;
    this.visitSegments(0, length, (segment) => {
      segment.copy(result, written);
      written += segment.length;
    });
    this.consume(length);
    return result;
  }

  /** 遍历指定范围内的共享视图，回调不得保留或修改输入结构 */
  visitSegments(
    offset: number,
    length: number,
    visitor: (segment: Buffer, absoluteOffset: number) => boolean | void,
  ): void {
    if (offset < 0 || length < 0 || offset + length > this._available) {
      throw new RangeError("Cannot visit beyond available input");
    }

    let index = this._headIndex;
    let localOffset = this._headOffset + offset;
    let absoluteOffset = offset;
    let remaining = length;
    while (remaining > 0) {
      const chunk = this._chunks[index];
      if (localOffset >= chunk.length) {
        localOffset -= chunk.length;
        index++;
        continue;
      }
      const count = Math.min(remaining, chunk.length - localOffset);
      const segment = chunk.subarray(localOffset, localOffset + count);
      if (visitor(segment, absoluteOffset) === false) return;
      remaining -= count;
      absoluteOffset += count;
      localOffset = 0;
      index++;
    }
  }

  private _compactReferences(): void {
    if (this._headIndex === this._chunks.length) {
      this._chunks = [];
      this._headIndex = 0;
      return;
    }
    if (this._headIndex > 64 && this._headIndex > this._chunks.length / 2) {
      this._chunks = this._chunks.slice(this._headIndex);
      this._headIndex = 0;
    }
  }
}
