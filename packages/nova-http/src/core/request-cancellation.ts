/** 请求及其挂载视图共享的取消状态 */
export class RequestCancellation {
  private _controller: AbortController | undefined;
  private _aborted = false;
  private _reason: unknown;

  get signal(): AbortSignal {
    if (this._controller === undefined) {
      this._controller = new AbortController();
      if (this._aborted) this._controller.abort(this._reason);
    }
    return this._controller.signal;
  }

  abort(reason: unknown): void {
    if (this._aborted) return;
    this._aborted = true;
    this._reason = reason;
    this._controller?.abort(reason);
  }
}
