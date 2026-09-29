/**
 * The chat socket's protocol (FC-032), shared by the gateway, delivery and
 * their specs. The browser's side mirrors these names.
 */

/** Where the socket is served, beside the API. */
export const CHAT_SOCKET_PATH = '/chat/socket';

/** The socket.io namespace chat uses. */
export const CHAT_SOCKET_NAMESPACE = '/chat';

/** How long a new socket has to say who it is, in milliseconds. */
export const CHAT_AUTH_TIMEOUT_MS = 5_000;

/** How many sockets one person may hold at once (Steve's decision). */
export const CHAT_SOCKETS_PER_PERSON = 5;

/** How long a reader's right to receive is trusted, in milliseconds. */
export const CHAT_DELIVERY_CHECK_TTL_MS = 5_000;

/** The largest frame a client may send, in bytes: a message and its envelope. */
export const CHAT_MAX_FRAME_BYTES = 16_384;

/** What the client sends. */
export const CHAT_CLIENT_EVENTS = {
  /** `{ token }`: who they are, first and again before the token expires. */
  AUTH: 'auth',
  /** `{ channelId | conversationId, after? }`: start receiving a place. */
  JOIN: 'join',
  /** `{ channelId | conversationId }`: stop receiving a place. */
  LEAVE: 'leave',
  /** `{ channelId | conversationId, body, clientMessageId }`: post. */
  SEND: 'send',
  /** Nothing: still here, every thirty seconds (FC-034). */
  HEARTBEAT: 'heartbeat',
  /** `{ channelId | conversationId }`: writing, at most every few seconds. */
  TYPING: 'typing',
} as const;

/** How often the browser says it is still here, in milliseconds. */
export const CHAT_HEARTBEAT_MS = 30_000;

/** What the server sends. */
export const CHAT_SERVER_EVENTS = {
  /** A message posted in a place the socket has joined. */
  MESSAGE: 'message',
  /** A message deleted in a place the socket has joined. */
  DELETED: 'deleted',
  /** A place the socket may no longer read, and has left. */
  REMOVED: 'removed',
  /** The token ran out before a fresh one came; the socket closes. */
  EXPIRED: 'expired',
  /** Another socket of the same person pushed this one out. */
  REPLACED: 'replaced',
  /** Somebody is writing in a place the socket has joined (FC-034). */
  TYPING: 'typing',
  /** A message for the reader elsewhere on the site: a DM or a mention. */
  NOTICE: 'notice',
} as const;

/** The event instances pass each other, through the Redis adapter. */
export const CHAT_FANOUT_EVENT = 'chat:fanout';

/** The event asking every instance to check some sockets again (FC-034). */
export const CHAT_REVOKE_EVENT = 'chat:revoke';

/** The room every socket of one person is in. */
export const userRoom = (userId: string): string => `user:${userId}`;

/** The room a channel's readers are in. */
export const channelRoom = (channelId: string): string =>
  `channel:${channelId}`;

/** The room a conversation's two are in. */
export const conversationRoom = (conversationId: string): string =>
  `conversation:${conversationId}`;
