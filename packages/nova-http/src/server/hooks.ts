import type { ConnectionInfo } from "../message/connection";

export interface ConnectHookContext {
  connection: ConnectionInfo;
  timestamp: number;
}

export interface DisconnectHookContext {
  connection: ConnectionInfo;
  timestamp: number;
}

export interface ListenHookContext {
  port: number;
  host: string;
}

declare module "../core/hooks" {
  interface ErrorHookContext {
    connection?: ConnectionInfo;
  }

  interface HookEvents {
    onConnect: ConnectHookContext;
    onDisconnect: DisconnectHookContext;
    onListen: ListenHookContext;
    onClose: void;
  }
}
