export type ResponseHeaderValue = string | readonly string[];
export type ResponseHeaders = ReadonlyMap<string, ResponseHeaderValue>;

/** 应用响应的输出端口，不暴露编码细节或传输关闭权限 */
export interface ResponseSink {
  readonly reusable: boolean;
  readonly bodyBytesWritten: number;
  assertHeaderAllowed(name: string): void;
  /** 内部定长响应一次提交能力，无背压时同步完成 */
  sendFixed?(status: number, headers: ResponseHeaders, body: Buffer): void | Promise<void>;
  commit(status: number, headers: ResponseHeaders): Promise<void>;
  write(chunk: Buffer): Promise<void>;
  end(): Promise<void>;
}
