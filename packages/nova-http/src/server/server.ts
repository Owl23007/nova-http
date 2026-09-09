import { createServer, type Server, type Socket } from "net";
import { Http1ConnectionCoordinator, type Http1ConnectionContext } from "./http1-connection";

export interface NodeHttpServerEvents {
  onError(error: Error): void;
  onListen(port: number, host: string): void;
  onClose(): void;
}

/** Owns Node's TCP server and connection lifecycle; application code only composes it. */
export class NodeHttpServer {
  private _server: Server | null = null;
  private readonly _connections = new Set<Http1ConnectionCoordinator>();

  constructor(
    private readonly _connectionContext: Http1ConnectionContext,
    private readonly _maxConnections: number,
    private readonly _events: NodeHttpServerEvents,
  ) {}

  address(): ReturnType<Server["address"]> {
    return this._server?.address() ?? null;
  }

  listen(port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer({ allowHalfOpen: true }, (socket: Socket) => {
        const connection = new Http1ConnectionCoordinator(socket, this._connectionContext);
        this._connections.add(connection);
        socket.once("close", () => this._connections.delete(connection));
      });
      this._server = server;
      if (this._maxConnections > 0) server.maxConnections = this._maxConnections;
      server.on("error", (error: Error) => {
        reject(error);
        this._events.onError(error);
      });
      server.listen(port, host, () => {
        this._events.onListen(port, host);
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this._server === null) {
        resolve();
        return;
      }
      for (const connection of this._connections) connection.gracefulClose();
      this._server.close(() => {
        this._events.onClose();
        resolve();
      });
    });
  }
}
