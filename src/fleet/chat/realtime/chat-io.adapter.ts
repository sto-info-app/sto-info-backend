import { IncomingMessage } from 'node:http';

import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';

import type { Redis } from 'ioredis';
import { Server, ServerOptions } from 'socket.io';

/** Makes the socket.io adapter from a publishing and a subscribing client. */
export type ChatAdapterFactory = (
  publisher: Redis,
  subscriber: Redis,
) => ServerOptions['adapter'];

/**
 * The socket.io server chat runs on (FC-032): rooms and fan-out shared
 * between instances through Redis, and only the site's own pages let in.
 *
 * It takes two Redis connections an instance — one to publish, one to
 * subscribe — well within the Key Value plan's 250. It closes them when the
 * application does, so a deployment's old instance lets go cleanly and its
 * sockets reconnect to the new one.
 */
export class ChatIoAdapter extends IoAdapter {
  /**
   * Creates an instance of ChatIoAdapter.
   *
   * @param app - The application.
   * @param _allowedOrigins - The site's origins, as CORS allows them.
   * @param _publisher - Redis, to publish.
   * @param _adapterFactory - Makes the Redis adapter.
   */
  constructor(
    app: INestApplicationContext,
    private readonly _allowedOrigins: readonly string[],
    private readonly _publisher: Redis,
    private readonly _adapterFactory: ChatAdapterFactory,
  ) {
    super(app);
  }

  /** The subscribing connection, made from the publishing one. */
  private _subscriber: Redis | null = null;

  /**
   * Makes the server with the Redis adapter and the origin check.
   *
   * @param port - The port.
   * @param options - The gateway's options.
   * @returns The server.
   */
  createIOServer(port: number, options?: ServerOptions): Server {
    this._subscriber ??= this._publisher.duplicate();

    return super.createIOServer(port, {
      ...options,
      adapter: this._adapterFactory(this._publisher, this._subscriber),
      allowRequest: (request, callback) => {
        callback(null, this.allows(request));
      },
    } as ServerOptions);
  }

  /**
   * Whether a connection may open: from one of the site's pages, or from no
   * page at all (a script, as the load test is). The token still decides
   * who it is.
   *
   * @param request - The upgrade request.
   * @returns True when it may.
   */
  allows(request: IncomingMessage): boolean {
    const origin = request.headers.origin;

    return origin === undefined || this._allowedOrigins.includes(origin);
  }

  /**
   * Closes the server, then whichever Redis connections are still open.
   *
   * @param server - The server.
   */
  async close(server: Server): Promise<void> {
    await super.close(server);

    const clients = [this._publisher, this._subscriber].filter(
      (client): client is Redis => client?.status === 'ready',
    );

    await Promise.all(clients.map(client => client.quit()));
  }
}
