export interface HeaderField {
  readonly name: string;
  readonly value: string;
}

/** 保留字段顺序和重复项的 HTTP 字段集合 */
export class HeaderBlock implements Iterable<HeaderField> {
  private _fields: readonly HeaderField[];
  private _index: Map<string, number[]> | undefined;

  constructor(fields: readonly HeaderField[] = []) {
    this._fields = snapshotFields(fields);
  }

  get fields(): readonly HeaderField[] {
    return this._fields;
  }

  get(name: string): string | undefined {
    const positions = this._getIndex().get(name.toLowerCase());
    return positions === undefined ? undefined : this._fields[positions[0]].value;
  }

  getAll(name: string): readonly string[] {
    const positions = this._getIndex().get(name.toLowerCase());
    return positions === undefined ? [] : positions.map((position) => this._fields[position].value);
  }

  has(name: string): boolean {
    return this._getIndex().has(name.toLowerCase());
  }

  forEach(callback: (value: string, name: string, headers: HeaderBlock) => void): void {
    for (const field of this._fields) callback(field.value, field.name, this);
  }

  [Symbol.iterator](): Iterator<HeaderField> {
    return this._fields[Symbol.iterator]();
  }

  /** 仅供 HTTP 内核写入延迟到达的 Trailer */
  _replace(fields: readonly HeaderField[]): void {
    this._fields = snapshotFields(fields);
    this._index = undefined;
  }

  private _getIndex(): Map<string, number[]> {
    if (this._index !== undefined) return this._index;
    const index = new Map<string, number[]>();
    for (let position = 0; position < this._fields.length; position++) {
      const field = this._fields[position];
      const positions = index.get(field.name);
      if (positions === undefined) index.set(field.name, [position]);
      else positions.push(position);
    }
    this._index = index;
    return index;
  }
}

/** 复制并冻结字段，避免外部修改导致字段集合与索引不一致 */
function snapshotFields(fields: readonly HeaderField[]): readonly HeaderField[] {
  return Object.freeze(
    fields.map(({ name, value }) => Object.freeze({ name: name.toLowerCase(), value })),
  );
}
