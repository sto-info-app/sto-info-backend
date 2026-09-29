import {
  BadRequestException,
  HttpException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Namespace, Socket } from 'socket.io';

import { FLEET_FEATURE_FLAGS } from '../../constants/fleet-feature.constants';
import { FleetFeatureService } from '../../fleet-feature.service';
import {
  ChatJoinDto,
  ChatMessageDto,
  ChatMessagePageDto,
  ChatPlaceDto,
  ChatSendDto,
} from '../dto/chat.dto';
import {
  ChatMessageService,
  ChatPlace,
} from '../services/chat-message.service';
import { ChatDeliveryService, roomOf } from './chat-delivery.service';
import { ChatPresenceService } from './chat-presence.service';
import { ChatSocketAuthService } from './chat-socket-auth.service';
import {
  CHAT_AUTH_TIMEOUT_MS,
  CHAT_CLIENT_EVENTS,
  CHAT_MAX_FRAME_BYTES,
  CHAT_SERVER_EVENTS,
  CHAT_SOCKET_NAMESPACE,
  CHAT_SOCKET_PATH,
  CHAT_SOCKETS_PER_PERSON,
  userRoom,
} from './chat-socket.constants';

/** What every client event is answered with. */
export type ChatAck<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly error: { readonly status: number; readonly message: string };
    };

/** What a socket carries once it has said who it is. */
interface ChatSocketData {
  connectedAt?: number;
  userId?: string;
  /** Their username, to name them when they type (FC-034). */
  username?: string | null;
  expiresAt?: number;
}

/**
 * Chat's socket (FC-032).
 *
 * Steve's decisions of 28 September 2026:
 *
 * - WebSocket only, so any instance can take a reconnect; the Redis adapter
 *   carries rooms and fan-out between instances.
 * - The token comes in the first message, within five seconds, and again
 *   before it runs out; a socket whose token runs out is told and closed.
 * - Five sockets a person; a sixth pushes the oldest out.
 * - A message is acknowledged only once it is committed. A resend with the
 *   same client ID is the same message.
 * - Joining a place reads what was missed since the last message the client
 *   holds, within the four-hour window, so a reconnect, a restart or a crash
 *   between commit and fan-out loses nothing.
 *
 * Everything else — who may read and post, the rate, the size, the window —
 * is the HTTP services', asked afresh each time. Nothing here logs a payload.
 */
@WebSocketGateway({
  namespace: CHAT_SOCKET_NAMESPACE,
  path: CHAT_SOCKET_PATH,
  transports: ['websocket'],
  maxHttpBufferSize: CHAT_MAX_FRAME_BYTES,
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Namespace;

  private readonly _logger = new Logger(ChatGateway.name);

  /** Each socket's timer: to say who it is, or for its token to run out. */
  private readonly _timers = new Map<string, NodeJS.Timeout>();

  /**
   * Creates an instance of ChatGateway.
   *
   * @param _featureService - Reports whether chat is switched on.
   * @param _auth - Says who a socket belongs to.
   * @param _messages - Reads and posts messages.
   * @param _delivery - Carries messages to readers.
   * @param _presence - Keeps who is online (FC-034).
   */
  constructor(
    private readonly _featureService: FleetFeatureService,
    private readonly _auth: ChatSocketAuthService,
    private readonly _messages: ChatMessageService,
    private readonly _delivery: ChatDeliveryService,
    private readonly _presence: ChatPresenceService,
  ) {}

  /**
   * Starts delivery through the namespace.
   *
   * @param server - The chat namespace.
   */
  afterInit(server: Namespace): void {
    this._delivery.attach(server);
  }

  /**
   * Gives a new socket five seconds to say who it is.
   *
   * @param socket - The socket.
   */
  handleConnection(socket: Socket): void {
    (socket.data as ChatSocketData).connectedAt = Date.now();
    this.schedule(socket, CHAT_AUTH_TIMEOUT_MS, () => {
      socket.disconnect(true);
    });
  }

  /**
   * Forgets a socket's timer, and takes its person offline when it was their
   * last.
   *
   * @param socket - The socket.
   */
  async handleDisconnect(socket: Socket): Promise<void> {
    clearTimeout(this._timers.get(socket.id));
    this._timers.delete(socket.id);

    const userId = (socket.data as ChatSocketData).userId;

    if (
      userId !== undefined &&
      (await this.server.in(userRoom(userId)).fetchSockets()).length === 0
    ) {
      await this._presence.leave(userId);
    }
  }

  /**
   * Says who a socket belongs to, first or again with a fresh token.
   *
   * @param socket - The socket.
   * @param body - `{ token }`.
   * @returns Who, and until when.
   */
  @SubscribeMessage(CHAT_CLIENT_EVENTS.AUTH)
  async auth(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<ChatAck<{ userId: string; expiresAt: number }>> {
    return this.answer(async () => {
      await this.assertEnabled();

      const data = socket.data as ChatSocketData;
      const identity = await this._auth.identify(
        (body as { token?: unknown } | null)?.token,
      );

      if (data.userId !== undefined && data.userId !== identity.userId) {
        // Answer first, then close.
        this.schedule(socket, 0, () => socket.disconnect(true));
        throw new UnauthorizedException('That token is somebody else’s.');
      }

      const first = data.userId === undefined;

      data.userId = identity.userId;
      data.username = identity.username;
      data.expiresAt = identity.expiresAt;
      this.schedule(socket, identity.expiresAt - Date.now(), () => {
        socket.emit(CHAT_SERVER_EVENTS.EXPIRED);
        socket.disconnect(true);
      });

      if (first) {
        await socket.join(userRoom(identity.userId));
        await this.limit(identity.userId);
        await this._presence.touch(identity.userId);
      }

      return { userId: identity.userId, expiresAt: identity.expiresAt };
    });
  }

  /**
   * Starts receiving a place, and reads what was missed: everything after
   * the cursor given, or the latest page.
   *
   * @param socket - The socket.
   * @param body - The place, and the last message the client holds.
   * @returns The page.
   */
  @SubscribeMessage(CHAT_CLIENT_EVENTS.JOIN)
  async join(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<ChatAck<ChatMessagePageDto>> {
    return this.answer(async () => {
      const userId = await this.signedIn(socket);
      const dto = await validated(ChatJoinDto, body);
      const place = placeOf(dto);
      const query = dto.after === undefined ? {} : { after: dto.after };

      // Join first, so nothing posted while the page is read is missed; the
      // client keeps one copy of each message.
      await socket.join(roomOf(place));

      try {
        return place.channelId === undefined
          ? await this._messages.readConversation(
              place.conversationId,
              userId,
              query,
            )
          : await this._messages.readChannel(place.channelId, userId, query);
      } catch (error) {
        await socket.leave(roomOf(place));
        throw error;
      }
    });
  }

  /**
   * Stops receiving a place.
   *
   * @param socket - The socket.
   * @param body - The place.
   * @returns Nothing.
   */
  @SubscribeMessage(CHAT_CLIENT_EVENTS.LEAVE)
  async leave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<ChatAck<null>> {
    return this.answer(async () => {
      await this.signedIn(socket);
      await socket.leave(roomOf(placeOf(await validated(ChatPlaceDto, body))));

      return null;
    });
  }

  /**
   * Posts, acknowledging once the message is committed, then tells the
   * place's readers.
   *
   * @param socket - The socket.
   * @param body - The place, what it says, and the client's ID for it.
   * @returns The message.
   */
  @SubscribeMessage(CHAT_CLIENT_EVENTS.SEND)
  async send(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<ChatAck<ChatMessageDto>> {
    return this.answer(async () => {
      const userId = await this.signedIn(socket);
      const dto = await validated(ChatSendDto, body);
      const place = placeOf(dto);
      const post = {
        body: dto.body,
        clientMessageId: dto.clientMessageId,
        mentions: dto.mentions,
        replyToMessageId: dto.replyToMessageId,
      };
      const message =
        place.channelId === undefined
          ? await this._messages.postToConversation(
              place.conversationId,
              userId,
              post,
            )
          : await this._messages.postToChannel(place.channelId, userId, post);

      void this._delivery.publish({ kind: 'message', place, message });

      return message;
    });
  }

  /**
   * Keeps the socket's person online for another minute (FC-034).
   *
   * @param socket - The socket.
   * @returns Nothing.
   */
  @SubscribeMessage(CHAT_CLIENT_EVENTS.HEARTBEAT)
  async heartbeat(@ConnectedSocket() socket: Socket): Promise<ChatAck<null>> {
    return this.answer(async () => {
      await this._presence.touch(await this.signedIn(socket));

      return null;
    });
  }

  /**
   * Tells a place's readers the socket's person is writing, if they share
   * their typing and the socket has joined the place (FC-034).
   *
   * @param socket - The socket.
   * @param body - The place.
   * @returns Nothing.
   */
  @SubscribeMessage(CHAT_CLIENT_EVENTS.TYPING)
  async typing(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<ChatAck<null>> {
    return this.answer(async () => {
      const userId = await this.signedIn(socket);
      const place = placeOf(await validated(ChatPlaceDto, body));

      if (
        socket.rooms.has(roomOf(place)) &&
        (await this._presence.typingEnabled(userId))
      ) {
        void this._delivery.publish({
          kind: 'typing',
          place,
          user: {
            userId,
            username: (socket.data as ChatSocketData).username ?? null,
          },
        });
      }

      return null;
    });
  }

  /**
   * Keeps a person to five sockets, pushing the oldest out.
   *
   * @param userId - The person.
   */
  async limit(userId: string): Promise<void> {
    const sockets = await this.server.in(userRoom(userId)).fetchSockets();
    const oldestFirst = [...sockets].sort(
      (a, b) =>
        ((a.data as ChatSocketData).connectedAt as number) -
        ((b.data as ChatSocketData).connectedAt as number),
    );

    for (const socket of oldestFirst.slice(
      0,
      Math.max(0, oldestFirst.length - CHAT_SOCKETS_PER_PERSON),
    )) {
      socket.emit(CHAT_SERVER_EVENTS.REPLACED);
      socket.disconnect(true);
    }
  }

  /**
   * Requires a socket that has said who it is, with a live token, for an
   * account still in use, while chat is on.
   *
   * @param socket - The socket.
   * @returns Who it belongs to.
   * @throws UnauthorizedException when it has not, or the token has run out.
   */
  async signedIn(socket: Socket): Promise<string> {
    const data = socket.data as ChatSocketData;

    if (
      data.userId === undefined ||
      (data.expiresAt as number) <= Date.now() ||
      !(await this._delivery.isActive(data.userId))
    ) {
      throw new UnauthorizedException('Sign in to use chat.');
    }

    await this.assertEnabled();

    return data.userId;
  }

  /**
   * Runs a handler, answering its result or its refusal. An unexpected
   * failure is logged without the payload and answered as a server error.
   *
   * @param work - The handler.
   * @returns The answer.
   */
  async answer<T>(work: () => Promise<T>): Promise<ChatAck<T>> {
    try {
      return { ok: true, data: await work() };
    } catch (error) {
      if (error instanceof HttpException) {
        return {
          ok: false,
          error: { status: error.getStatus(), message: error.message },
        };
      }

      this._logger.error('[chat] Socket event failed', (error as Error).stack);

      return {
        ok: false,
        error: { status: 500, message: 'Something went wrong.' },
      };
    }
  }

  /**
   * Sets a socket's one timer, replacing any before.
   *
   * @param socket - The socket.
   * @param after - How long, in milliseconds.
   * @param then - What to do.
   */
  schedule(socket: Socket, after: number, then: () => void): void {
    clearTimeout(this._timers.get(socket.id));
    this._timers.set(socket.id, setTimeout(then, Math.max(0, after)));
  }

  /**
   * Refuses while chat is switched off.
   *
   * @throws NotFoundException when it is.
   */
  async assertEnabled(): Promise<void> {
    await this._featureService.assertFlagEnabled(
      FLEET_FEATURE_FLAGS.CHAT_ENABLED,
    );
  }
}

/**
 * Reads and checks a client's payload.
 *
 * @param type - What it should be.
 * @param body - What was sent.
 * @returns It, checked.
 * @throws BadRequestException naming what is wrong.
 */
async function validated<T extends object>(
  type: new () => T,
  body: unknown,
): Promise<T> {
  const dto = plainToInstance(type, body ?? {});
  const errors = await validate(dto, { whitelist: true });

  if (errors.length > 0) {
    throw new BadRequestException(
      errors
        .flatMap(error =>
          Object.values(error.constraints as Record<string, string>),
        )
        .join('; '),
    );
  }

  return dto;
}

/**
 * The one place a payload names.
 *
 * @param dto - The payload.
 * @returns The channel or the conversation.
 * @throws BadRequestException when it names neither, or both.
 */
function placeOf(dto: ChatPlaceDto): ChatPlace {
  if ((dto.channelId === undefined) === (dto.conversationId === undefined)) {
    throw new BadRequestException('Name one channel or one conversation.');
  }

  return dto.channelId === undefined
    ? { conversationId: dto.conversationId as string }
    : { channelId: dto.channelId };
}
