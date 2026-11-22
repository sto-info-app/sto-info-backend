/**
 * Rehearses chat's socket (FC-032) across two instances on this machine,
 * sharing the local Redis, and then puts it under load.
 *
 * It makes throwaway accounts in the local database — members of the Fixture
 * Public Fleet, one an Officer, two of them friends — starts two chat
 * instances (`instance.ts`) and checks, over real sockets:
 *
 * - a message is acknowledged only once committed, and reaches a reader on
 *   the other instance; a resend is the same message;
 * - a socket that never says who it is, or shows a bad token, gets nothing;
 *   one whose token runs out is told and closed, unless it sent a fresh one;
 *   one showing somebody else's token is closed; the token is in no URL and
 *   no log line;
 * - a sixth socket of one person pushes the oldest out;
 * - a stranger cannot join; a reader whose channel is narrowed past them, or
 *   whose friendship ends, is sent away and told nothing more;
 * - after a crash, or a graceful shutdown, a reader reconnecting to the other
 *   instance reads everything it missed.
 *
 * For FC-034 it also checks, with the change made through the real
 * services on one instance:
 *
 * - somebody is online once their first socket says who they are, stays
 *   online while any socket of theirs is open, and goes offline with the
 *   last;
 * - typing reaches a reader who shares it, and a mention reaches its person
 *   wherever they are on the site;
 * - a block hides each side's messages and typing from the other at once,
 *   and a member leaving loses their channel on the other instance at once.
 *
 * Then it connects `--load` people (40 unless told), a socket each, split
 * between the instances, has ten of them post for twenty seconds, and
 * reports acknowledgement and delivery times, and anything lost or doubled.
 *
 * Everything it made is removed at the end, whatever happened. It refuses to
 * run unless the database is on this machine. The Render run is FC-052's.
 *
 * Usage: npm run rehearse:chat-socket [-- --load 40]
 */

import { ChildProcess, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { config } from 'dotenv';
import Redis from 'ioredis';
import { io, Socket } from 'socket.io-client';
import { DataSource } from 'typeorm';

import { getTypeOrmConfig } from '../../config/typeorm.config';

config({ path: `config/environments/${process.env.NODE_ENV || ''}.env` });

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const COMMUNITY_ID = '584d8c92-3ce6-4ca8-ba76-320e19bc0225';
const FLEET_ID = 'b9eeb11f-70b7-46c5-b002-5160ea064ecc';
const PORTS = { a: 3101, b: 3102 } as const;
const SCHEMA = process.env.DB_SCHEMA ?? 'sto_info_app';
const RUN = randomUUID().slice(0, 8);

/** A chat message as the socket gives it. */
interface Message {
  id: string;
  body: string | null;
  createdAt: string;
  clientMessageId: string;
  mine: boolean;
}

/** What every client event is answered with. */
type Ack<T> = { ok: true; data: T } | { ok: false; error: { status: number } };

/** A connected socket, and everything it was told. */
interface Client {
  socket: Socket;
  messages: Message[];
  removed: unknown[];
  events: string[];
}

/** One check's outcome. */
interface Outcome {
  name: string;
  ok: boolean;
  detail: string;
}

const outcomes: Outcome[] = [];
const logs: string[] = [];
const instances = new Map<keyof typeof PORTS, ChildProcess>();

/**
 * Records a check.
 *
 * @param name - What was checked.
 * @param ok - Whether it held.
 * @param detail - What was seen.
 */
function check(name: string, ok: boolean, detail = ''): void {
  outcomes.push({ name, ok, detail });
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`,
  );
}

/**
 * A rehearsal token.
 *
 * @param userId - Who.
 * @param lifeMs - How long it lasts.
 * @returns The token.
 */
function tokenFor(userId: string, lifeMs = 600_000): string {
  return `rehearsal.${userId}.${Date.now() + lifeMs}`;
}

/**
 * Starts an instance and waits until it listens.
 *
 * @param name - Which.
 */
async function start(name: keyof typeof PORTS): Promise<void> {
  const child = fork('scripts/chat-socket-rehearsal/instance.ts', [], {
    execArgv: ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register'],
    env: {
      ...process.env,
      PORT: String(PORTS[name]),
      TS_NODE_PROJECT: 'tsconfig.scripts.json',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  }

  instances.set(name, child);
  await new Promise<void>((resolve, reject) => {
    child.once('message', message =>
      message === 'ready' ? resolve() : reject(new Error(String(message))),
    );
    child.once('exit', code => reject(new Error(`${name} exited ${code}`)));
  });
}

/**
 * Stops an instance: gracefully, or as a crash would.
 *
 * @param name - Which.
 * @param how - `shutdown` over IPC, or `kill`.
 */
async function stop(
  name: keyof typeof PORTS,
  how: 'shutdown' | 'kill',
): Promise<void> {
  const child = instances.get(name);

  if (child === undefined || child.exitCode !== null) {
    return;
  }

  const exited = new Promise(resolve => child.once('exit', resolve));

  if (how === 'shutdown') {
    child.send('shutdown');
  } else {
    child.kill('SIGKILL');
  }

  await exited;
  instances.delete(name);
}

/**
 * Opens a socket, and signs it in unless told not to.
 *
 * @param name - Which instance.
 * @param token - The token to show, or null to show none.
 * @returns The client.
 */
async function connect(
  name: keyof typeof PORTS,
  token: string | null,
): Promise<Client> {
  const socket = io(`http://localhost:${PORTS[name]}/chat`, {
    path: '/chat/socket',
    transports: ['websocket'],
    reconnection: false,
  });
  const client: Client = { socket, messages: [], removed: [], events: [] };

  socket.on('message', (message: Message) => client.messages.push(message));
  socket.on('removed', (place: unknown) => client.removed.push(place));
  socket.onAny((event: string) => client.events.push(event));
  socket.on('disconnect', reason => client.events.push(`disconnect:${reason}`));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });

  if (token !== null) {
    const ack = await ask(client, 'auth', { token });

    if (!ack.ok) {
      throw new Error(`auth refused: ${ack.error.status}`);
    }
  }

  return client;
}

/**
 * Sends an event and waits for its answer.
 *
 * @param client - The socket.
 * @param event - The event.
 * @param body - Its payload.
 * @returns The answer.
 */
function ask<T = unknown>(
  client: Client,
  event: string,
  body: unknown,
): Promise<Ack<T>> {
  return client.socket.timeout(10_000).emitWithAck(event, body) as Promise<
    Ack<T>
  >;
}

/**
 * Waits until something holds, or gives up.
 *
 * @param holds - The condition.
 * @param withinMs - How long to wait.
 * @returns Whether it held.
 */
async function until(
  holds: () => boolean | Promise<boolean>,
  withinMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + withinMs;

  while (Date.now() < deadline) {
    if (await holds()) {
      return true;
    }

    await sleep(50);
  }

  return holds();
}

/**
 * The last of some messages.
 *
 * @param messages - The messages.
 * @returns The last, or nothing.
 */
function lastOf(messages: Message[]): Message | undefined {
  return messages[messages.length - 1];
}

/**
 * The cursor naming a message.
 *
 * @param message - The message.
 * @returns `<ISO instant>_<ID>`.
 */
function cursorOf(message: Message): string {
  return `${new Date(message.createdAt).toISOString()}_${message.id}`;
}

/**
 * Posts and times the acknowledgement.
 *
 * @param client - The socket.
 * @param place - Where.
 * @param body - What it says.
 * @param clientMessageId - The client's ID for it.
 * @returns The answer and how long it took.
 */
async function send(
  client: Client,
  place: object,
  body: string,
  clientMessageId = randomUUID(),
): Promise<{ ack: Ack<Message>; ms: number }> {
  const started = performance.now();
  const ack = await ask<Message>(client, 'send', {
    ...place,
    body,
    clientMessageId,
  });

  return { ack, ms: performance.now() - started };
}

/**
 * The value at a fraction of sorted numbers.
 *
 * @param values - The numbers.
 * @param fraction - Where.
 * @returns The value.
 */
function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);

  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    0
  );
}

/**
 * Runs the rehearsal.
 */
async function main(): Promise<void> {
  if (!LOCAL_HOSTS.has(process.env.DB_HOST ?? '')) {
    throw new Error('The chat rehearsal only runs against a local database.');
  }

  const loadIndex = process.argv.indexOf('--load');
  const loadPeople =
    loadIndex === -1 ? 40 : Number(process.argv[loadIndex + 1] ?? 40);
  const db = new DataSource({
    ...(await getTypeOrmConfig()),
    logging: false,
  } as never);
  const users = {
    alpha: randomUUID(),
    bravo: randomUUID(),
    charlie: randomUUID(),
    echo: randomUUID(),
    foxtrot: randomUUID(),
    golf: randomUUID(),
    load: Array.from({ length: loadPeople }, () => randomUUID()),
  };
  const everyone = [
    users.alpha,
    users.bravo,
    users.charlie,
    users.echo,
    users.foxtrot,
    users.golf,
    ...users.load,
  ];
  const nameOf = (id: string): string =>
    `reh${RUN}${(everyone as string[]).indexOf(id)}`;
  const customId = randomUUID();
  const conversationId = randomUUID();
  const clients: Client[] = [];
  const track = (client: Client): Client => {
    clients.push(client);

    return client;
  };

  await db.initialize();

  try {
    // The throwaway accounts: members, one an Officer, two friends.
    for (const [index, id] of everyone.entries()) {
      await db.query(
        `INSERT INTO "${SCHEMA}"."user" ("id", "email", "password") VALUES ($1, $2, '!')`,
        [id, `chat-rehearsal-${RUN}-${index}@rehearsal.test`],
      );

      if (id !== users.charlie) {
        await db.query(
          `INSERT INTO "${SCHEMA}"."scope_membership" ("communityId", "fleetId", "userId", "status") VALUES ($1, $2, $3, 'APPROVED')`,
          [COMMUNITY_ID, FLEET_ID, id],
        );
      }
    }

    // Names and typing for FC-034's checks.
    for (const id of [users.echo, users.foxtrot, users.golf]) {
      await db.query(
        `INSERT INTO "${SCHEMA}"."user_profile" ("userId", "username") VALUES ($1, $2)`,
        [id, nameOf(id)],
      );
      await db.query(
        `INSERT INTO "${SCHEMA}"."user_preference" ("userId", "typingIndicatorsEnabled") VALUES ($1, true)`,
        [id],
      );
    }

    await db.query(
      `INSERT INTO "${SCHEMA}"."scope_role_assignment" ("communityId", "fleetId", "userId", "role") VALUES ($1, $2, $3, 'OFFICER')`,
      [COMMUNITY_ID, FLEET_ID, users.alpha],
    );
    await db.query(
      `INSERT INTO "${SCHEMA}"."friendship" ("requesterId", "addresseeId", "status") VALUES ($1, $2, 'ACCEPTED')`,
      [users.alpha, users.bravo],
    );

    const [low, high] = [users.alpha, users.bravo].sort();

    await db.query(
      `INSERT INTO "${SCHEMA}"."chat_direct_conversation" ("id", "userLowId", "userHighId") VALUES ($1, $2, $3)`,
      [conversationId, low, high],
    );
    await db.query(
      `INSERT INTO "${SCHEMA}"."chat_channel" ("communityId", "fleetId", "kind", "name") SELECT $1, $2, 'STANDARD', 'General' WHERE NOT EXISTS (SELECT 1 FROM "${SCHEMA}"."chat_channel" WHERE "fleetId" = $2 AND "kind" = 'STANDARD')`,
      [COMMUNITY_ID, FLEET_ID],
    );
    await db.query(
      `INSERT INTO "${SCHEMA}"."chat_channel" ("id", "communityId", "fleetId", "kind", "name") VALUES ($1, $2, $3, 'CUSTOM', $4)`,
      [customId, COMMUNITY_ID, FLEET_ID, `Rehearsal ${RUN}`],
    );

    const [{ id: generalId }] = (await db.query(
      `SELECT "id" FROM "${SCHEMA}"."chat_channel" WHERE "fleetId" = $1 AND "kind" = 'STANDARD'`,
      [FLEET_ID],
    )) as { id: string }[];
    const general = { channelId: generalId };
    const custom = { channelId: customId };
    const conversation = { conversationId };

    console.log(`Rehearsal ${RUN}: starting two instances…`);
    await Promise.all([start('a'), start('b')]);

    // Acknowledged once committed, and delivered across instances.
    const alpha = track(await connect('a', tokenFor(users.alpha)));
    const bravo = track(await connect('b', tokenFor(users.bravo)));

    await ask(alpha, 'join', general);
    await ask(bravo, 'join', general);

    const clientMessageId = randomUUID();
    const first = await send(alpha, general, `Hail ${RUN}`, clientMessageId);
    const committed = first.ack.ok
      ? (
          (await db.query(
            `SELECT count(*)::int AS "count" FROM "${SCHEMA}"."chat_message" WHERE "id" = $1`,
            [first.ack.data.id],
          )) as { count: number }[]
        )[0].count
      : 0;

    check(
      'acknowledged only once committed',
      first.ack.ok && committed === 1,
      `${first.ms.toFixed(0)} ms`,
    );
    check(
      'delivered to a reader on the other instance',
      await until(() =>
        bravo.messages.some(each => each.clientMessageId === clientMessageId),
      ),
    );
    check(
      'the author’s own socket marks it theirs',
      await until(() => alpha.messages.some(each => each.mine)),
    );

    const again = await send(bravo, general, `Hail ${RUN}`, clientMessageId);
    const resent = await send(alpha, general, `Hail ${RUN}`, clientMessageId);
    const [{ count: copies }] = (await db.query(
      `SELECT count(*)::int AS "count" FROM "${SCHEMA}"."chat_message" WHERE "clientMessageId" = $1`,
      [clientMessageId],
    )) as { count: number }[];

    check(
      'a resend is the same message',
      resent.ack.ok &&
        first.ack.ok &&
        resent.ack.data.id === first.ack.data.id &&
        copies === 2,
      `another author's use of the ID is their own message: ${again.ack.ok}`,
    );

    // Who the socket is.
    const silent = track(await connect('a', null));
    const unsigned = await ask(silent, 'join', general);

    check(
      'an unsigned socket is refused',
      !unsigned.ok && unsigned.error.status === 401,
    );
    check(
      'an unsigned socket is closed after five seconds',
      await until(() => !silent.socket.connected, 7_000),
    );

    const forged = track(await connect('a', null));
    const refused = await ask(forged, 'auth', { token: 'not-a-token' });

    check(
      'a bad token is refused',
      !refused.ok && refused.error.status === 401,
    );

    const expiring = track(await connect('b', tokenFor(users.alpha, 2_000)));

    check(
      'a socket is told and closed when its token runs out',
      await until(
        () => expiring.events.includes('expired') && !expiring.socket.connected,
        5_000,
      ),
    );

    const renewed = track(await connect('a', tokenFor(users.alpha, 2_000)));

    await sleep(1_000);
    await ask(renewed, 'auth', { token: tokenFor(users.alpha) });
    await sleep(2_500);
    check('a fresh token keeps the socket open', renewed.socket.connected);

    const swapped = track(await connect('a', tokenFor(users.alpha)));
    const theirs = await ask(swapped, 'auth', { token: tokenFor(users.bravo) });

    check(
      'somebody else’s token closes the socket',
      !theirs.ok && (await until(() => !swapped.socket.connected)),
    );
    check(
      'the token is in no URL',
      !JSON.stringify([
        alpha.socket.io.opts,
        (alpha.socket.io as unknown as { uri: string }).uri,
      ]).includes('rehearsal.'),
    );

    // Five sockets a person.
    const crowd: Client[] = [];

    for (let index = 0; index < 6; index += 1) {
      crowd.push(
        track(await connect(index % 2 ? 'b' : 'a', tokenFor(users.charlie))),
      );
      await sleep(20);
    }

    check(
      'a sixth socket pushes the oldest out',
      await until(
        () =>
          crowd[0].events.includes('replaced') && !crowd[0].socket.connected,
      ),
      `${crowd.filter(each => each.socket.connected).length} still open`,
    );

    const stranger = await ask(crowd[5], 'join', general);

    check(
      'a stranger cannot join',
      !stranger.ok && stranger.error.status === 404,
    );

    // Rights asked again at delivery.
    await ask(alpha, 'join', custom);
    await ask(bravo, 'join', custom);
    await db.query(
      `UPDATE "${SCHEMA}"."chat_channel" SET "readRole" = 'OFFICER', "postRole" = 'OFFICER' WHERE "id" = $1`,
      [customId],
    );
    await sleep(5_500);

    const narrowed = await send(alpha, custom, `Officers only ${RUN}`);

    check('an Officer still posts once narrowed', narrowed.ack.ok);
    check(
      'a member is sent away, and not told the message',
      (await until(() => bravo.removed.length > 0)) &&
        !bravo.messages.some(each => each.body === `Officers only ${RUN}`),
    );

    await ask(alpha, 'join', conversation);
    await ask(bravo, 'join', conversation);

    const hello = await send(alpha, conversation, `Hello friend ${RUN}`);

    check(
      'a friend hears a direct message on the other instance',
      hello.ack.ok &&
        (await until(() =>
          bravo.messages.some(each => each.body === `Hello friend ${RUN}`),
        )),
    );
    await db.query(
      `UPDATE "${SCHEMA}"."friendship" SET "deletedAt" = now() WHERE "requesterId" = $1 AND "addresseeId" = $2`,
      [users.alpha, users.bravo],
    );
    await sleep(5_500);

    const afterUnfriend = await send(
      alpha,
      conversation,
      `Still there? ${RUN}`,
    );

    check(
      'a conversation closes once they stop being friends',
      !afterUnfriend.ack.ok && afterUnfriend.ack.error.status === 404,
    );

    // A crash, then a graceful restart; each reader reconnects to the other.
    const survivor = track(await connect('a', tokenFor(users.bravo)));
    const joined = await ask<{ messages: Message[] }>(
      survivor,
      'join',
      general,
    );
    const held = joined.ok ? lastOf(joined.data.messages) : undefined;

    await stop('a', 'kill');

    const missed = [
      await send(bravo, general, `While A was down 1 ${RUN}`),
      await send(bravo, general, `While A was down 2 ${RUN}`),
    ];
    const moved = track(await connect('b', tokenFor(users.bravo)));
    const caught = await ask<{ messages: Message[] }>(moved, 'join', {
      ...general,
      after: held === undefined ? undefined : cursorOf(held),
    });
    const missedIds = missed.map(each => (each.ack.ok ? each.ack.data.id : ''));

    check(
      'after a crash, a reconnect elsewhere reads what it missed',
      caught.ok &&
        missedIds.every(id =>
          caught.data.messages.some(each => each.id === id),
        ),
      `${caught.ok ? caught.data.messages.length : 0} caught up`,
    );

    await start('a');

    const leaving = track(await connect('a', tokenFor(users.bravo)));
    const lastSeen = await ask<{ messages: Message[] }>(
      leaving,
      'join',
      general,
    );
    const mark = lastSeen.ok ? lastOf(lastSeen.data.messages) : undefined;

    await stop('a', 'shutdown');
    check(
      'a graceful shutdown closes its sockets',
      await until(() => !leaving.socket.connected),
      leaving.events.filter(each => each.startsWith('disconnect')).join(', '),
    );

    const during = await send(bravo, general, `During the restart ${RUN}`);
    const back = track(await connect('b', tokenFor(users.bravo)));
    const resumed = await ask<{ messages: Message[] }>(back, 'join', {
      ...general,
      after: mark === undefined ? undefined : cursorOf(mark),
    });

    check(
      'after a graceful shutdown, a reconnect elsewhere reads what it missed',
      during.ack.ok &&
        resumed.ok &&
        resumed.data.messages.some(
          each => during.ack.ok && each.id === during.ack.data.id,
        ),
    );

    await start('a');

    for (const client of clients) {
      client.socket.disconnect();
    }

    // FC-034: presence, typing, mentions elsewhere, blocks and leaving.
    const presence = new Redis(process.env.REDIS_URL as string);
    const onlineKey = (id: string): string => `chat:presence:${id}`;
    const echoA = track(await connect('a', tokenFor(users.echo)));

    check(
      'somebody is online once their socket says who they are',
      (await presence.exists(onlineKey(users.echo))) === 1 &&
        (await presence.ttl(onlineKey(users.echo))) <= 60,
    );

    const echoB = track(await connect('b', tokenFor(users.echo)));

    echoA.socket.disconnect();
    await sleep(500);
    check(
      'they stay online while another of their sockets is open',
      (await presence.exists(onlineKey(users.echo))) === 1,
    );

    const foxtrot = track(await connect('a', tokenFor(users.foxtrot)));
    const golf = track(await connect('b', tokenFor(users.golf)));

    await ask(echoB, 'join', general);
    await ask(foxtrot, 'join', general);
    await ask(golf, 'join', general);

    const typed: unknown[] = [];

    echoB.socket.on('typing', (event: unknown) => typed.push(event));
    await ask(foxtrot, 'typing', general);
    check(
      'typing reaches a reader who shares it',
      await until(() => typed.length > 0),
      JSON.stringify(typed[0] ?? null),
    );

    const noticed: unknown[] = [];
    const echoElsewhere = track(await connect('a', tokenFor(users.echo)));

    echoElsewhere.socket.on('notice', (event: unknown) => noticed.push(event));
    await ask<Message>(foxtrot, 'send', {
      ...general,
      body: `@${nameOf(users.echo)} over here`,
      clientMessageId: randomUUID(),
      mentions: [users.echo],
    });
    check(
      'a mention reaches its person anywhere on the site',
      await until(() => noticed.length > 0),
      JSON.stringify(noticed[0] ?? null),
    );

    // A block, made through the real service on instance A.
    const acted = (
      name: keyof typeof PORTS,
      action: Record<string, unknown>,
    ): Promise<{ error?: string }> => {
      const id = randomUUID();
      const child = instances.get(name) as ChildProcess;

      return new Promise(resolve => {
        const listen = (message: unknown): void => {
          if ((message as { acted?: string }).acted === id) {
            child.off('message', listen);
            resolve(message as { error?: string });
          }
        };

        child.on('message', listen);
        child.send({ kind: 'act', id, ...action });
      });
    };
    const blocking = await acted('a', {
      action: 'block',
      userId: users.echo,
      username: nameOf(users.foxtrot),
    });

    check('the block was made', blocking.error === undefined, blocking.error);

    const seenByEcho: Message[] = [];
    const seenByFoxtrot: Message[] = [];

    echoB.socket.on('message', (message: Message) => seenByEcho.push(message));
    foxtrot.socket.on('message', (message: Message) =>
      seenByFoxtrot.push(message),
    );
    typed.length = 0;
    await sleep(300);

    const fromFoxtrot = await send(foxtrot, general, `After the block ${RUN}`);
    const fromEcho = await send(echoB, general, `Echo after the block ${RUN}`);

    await ask(foxtrot, 'typing', general);
    await sleep(1_000);

    const echoSaw = seenByEcho.find(
      each => fromFoxtrot.ack.ok && each.id === fromFoxtrot.ack.data.id,
    ) as (Message & { hidden?: boolean; author?: unknown }) | undefined;
    const foxtrotSaw = seenByFoxtrot.find(
      each => fromEcho.ack.ok && each.id === fromEcho.ack.data.id,
    ) as (Message & { hidden?: boolean; author?: unknown }) | undefined;

    check(
      'a block hides each side’s messages from the other at once',
      echoSaw?.hidden === true &&
        echoSaw.body === null &&
        echoSaw.author === null &&
        foxtrotSaw?.hidden === true,
    );
    check('a block stops typing between them', typed.length === 0);
    check(
      'a reader outside the block still sees both',
      golf.messages.some(
        each =>
          fromFoxtrot.ack.ok &&
          each.id === fromFoxtrot.ack.data.id &&
          each.body !== null,
      ),
    );

    // A member leaving, through the real service on instance A; golf's
    // socket is on instance B.
    const departure = await acted('a', {
      action: 'leave',
      userId: users.golf,
      communityId: COMMUNITY_ID,
      fleetId: FLEET_ID,
    });

    check('the member left', departure.error === undefined, departure.error);
    check(
      'a member leaving loses the channel on the other instance at once',
      await until(() => golf.removed.length > 0, 2_000),
    );

    for (const client of clients) {
      client.socket.disconnect();
    }

    check(
      'they go offline with their last socket',
      await until(
        async () => (await presence.exists(onlineKey(users.echo))) === 0,
        3_000,
      ),
    );
    await presence.quit();

    // Load.
    console.log(`Load: ${loadPeople} people, a socket each, ten posting…`);

    const redis = new Redis(process.env.REDIS_URL as string);
    const crowdOf = await Promise.all(
      users.load.map((id, index) =>
        connect(index % 2 ? 'b' : 'a', tokenFor(id)).then(track),
      ),
    );

    await Promise.all(crowdOf.map(client => ask(client, 'join', general)));

    const acks: number[] = [];
    const sentAt = new Map<string, number>();
    const deliveries: number[] = [];
    let duplicates = 0;
    const seen = crowdOf.map(() => new Set<string>());

    crowdOf.forEach((client, index) => {
      client.socket.on('message', (message: Message) => {
        const marked = sentAt.get(message.clientMessageId);

        if (seen[index].has(message.id)) {
          duplicates += 1;
        }

        seen[index].add(message.id);

        if (marked !== undefined) {
          deliveries.push(performance.now() - marked);
        }
      });
    });

    const posters = crowdOf.slice(0, 10);
    const stopAt = Date.now() + 20_000;
    let refusedPosts = 0;
    let peakRedis = 0;

    await Promise.all(
      posters.map(async client => {
        while (Date.now() < stopAt) {
          const id = randomUUID();

          sentAt.set(id, performance.now());

          const { ack, ms } = await send(client, general, `Load ${RUN}`, id);

          if (ack.ok) {
            acks.push(ms);
          } else {
            refusedPosts += 1;
          }

          const clientsNow = (await redis.client('LIST')) as string;

          peakRedis = Math.max(peakRedis, clientsNow.trim().split('\n').length);
          // Just inside the rate: ten in any ten seconds.
          await sleep(1_300);
        }
      }),
    );
    await sleep(3_000);

    const expected = acks.length * crowdOf.length;

    check(
      'every committed message reached every reader, once',
      deliveries.length === expected && duplicates === 0,
      `${deliveries.length}/${expected} delivered, ${duplicates} doubled, ${refusedPosts} refused`,
    );
    console.log(
      `Load: ${acks.length} messages; ack p50 ${percentile(acks, 0.5).toFixed(0)} ms, p95 ${percentile(acks, 0.95).toFixed(0)} ms, max ${Math.max(...acks).toFixed(0)} ms; delivery p50 ${percentile(deliveries, 0.5).toFixed(0)} ms, p95 ${percentile(deliveries, 0.95).toFixed(0)} ms, max ${Math.max(...deliveries).toFixed(0)} ms; Redis clients at peak ${peakRedis}`,
    );
    await redis.quit();

    check(
      'no token reached a log line',
      !logs.join('').includes('rehearsal.'),
      `${logs.join('').split('\n').filter(Boolean).length} log lines`,
    );
  } finally {
    for (const client of clients) {
      client.socket.disconnect();
    }

    await Promise.all([stop('a', 'shutdown'), stop('b', 'shutdown')]);
    await db.query(
      `DELETE FROM "${SCHEMA}"."chat_message" WHERE "authorUserId" = ANY($1) OR "channelId" = $2 OR "conversationId" = $3`,
      [everyone, customId, conversationId],
    );
    await db.query(
      `DELETE FROM "${SCHEMA}"."chat_action" WHERE "channelId" = $1`,
      [customId],
    );
    await db.query(`DELETE FROM "${SCHEMA}"."chat_channel" WHERE "id" = $1`, [
      customId,
    ]);
    await db.query(
      `DELETE FROM "${SCHEMA}"."chat_direct_conversation" WHERE "id" = $1`,
      [conversationId],
    );
    await db.query(
      `DELETE FROM "${SCHEMA}"."friendship" WHERE "requesterId" = ANY($1) OR "addresseeId" = ANY($1)`,
      [everyone],
    );
    await db.query(
      `DELETE FROM "${SCHEMA}"."scope_role_assignment" WHERE "userId" = ANY($1)`,
      [everyone],
    );
    await db.query(
      `DELETE FROM "${SCHEMA}"."scope_membership" WHERE "userId" = ANY($1)`,
      [everyone],
    );
    for (const table of ['user_block']) {
      await db.query(
        `DELETE FROM "${SCHEMA}"."${table}" WHERE "blockerId" = ANY($1) OR "blockedId" = ANY($1)`,
        [everyone],
      );
    }

    for (const table of [
      'user_profile',
      'user_preference',
      'notification_outbox',
    ]) {
      await db.query(
        `DELETE FROM "${SCHEMA}"."${table}" WHERE "userId" = ANY($1)`,
        [everyone],
      );
    }

    await db.query(`DELETE FROM "${SCHEMA}"."user" WHERE "id" = ANY($1)`, [
      everyone,
    ]);

    const [{ count: left }] = (await db.query(
      `SELECT count(*)::int AS "count" FROM "${SCHEMA}"."user" WHERE "email" LIKE 'chat-rehearsal-%@rehearsal.test'`,
    )) as { count: number }[];

    console.log(
      `Removed everything the rehearsal made (${left} accounts left).`,
    );
    await db.destroy();
  }

  const failed = outcomes.filter(outcome => !outcome.ok);

  console.log(
    `${outcomes.length - failed.length}/${outcomes.length} checks held.`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error((error as Error).stack);
  process.exit(1);
});
