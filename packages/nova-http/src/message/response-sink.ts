export type ResponseHeaderValue = string | readonly string[];
export type ResponseHeaders = ReadonlyMap<string, ResponseHeaderValue>;

/** Output port used by the application response without knowing wire or transport details. */
export interface ResponseSink {
  readonly reusable: boolean;
  readonly bodyBytesWritten: number;
  assertHeaderAllowed(name: string): void;
  commit(status: number, headers: ResponseHeaders): Promise<void>;
  write(chunk: Buffer): Promise<void>;
  end(): Promise<void>;
  abort(error: Error, closeTransport: boolean): void;
}
