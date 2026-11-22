/**
 * One chat instance for the socket rehearsal (FC-032): the real chat module
 * on its own port, sharing the local Redis with the others, so rooms and
 * fan-out cross instances as they would on Render.
 *
 * The one thing replaced is how a socket proves who it is. A rehearsal token
 * is `rehearsal.<user ID>.<expiry in milliseconds>`, so the rehearsal can
 * speak for its own throwaway accounts, and set a token to run out, without
 * signing anybody in. Everything after that — membership, roles, friendship,
 * the window, the rate, the fan-out and its checks — is the real code.
 *
 * It refuses to start unless the database is on this machine.
 *
 * Started by `rehearse.ts` with `PORT`; it answers `ready` over IPC once
 * listening, and closes gracefully when sent `shutdown`. To rehearse what
 * happens when access changes mid-session (FC-034), it also carries out two
 * actions through the real services when asked over IPC — a block and a
 * member leaving — so the change reaches chat as it would in use.
 */

import { Logger, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { createAdapter } from '@socket.io/redis-adapter';
import { config } from 'dotenv';
import Redis from 'ioredis';

import { AppModule } from '../../src/app.module';
import { BlockService } from '../../src/community/block.service';
import { ChatIoAdapter } from '../../src/fleet/chat/realtime/chat-io.adapter';
import {
  ChatSocketAuthService,
  ChatSocketIdentity,
} from '../../src/fleet/chat/realtime/chat-socket-auth.service';
import { RecruitmentMembershipService } from '../../src/fleet/recruitment/services/recruitment-membership.service';

config({ path: `config/environments/${process.env.NODE_ENV || ''}.env` });

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** An action the rehearsal asks for, through the real services. */
interface RehearsalAction {
  readonly kind: 'act';
  readonly id: string;
  readonly action: 'block' | 'leave';
  readonly userId: string;
  /** Whom to block. */
  readonly username?: string;
  /** Where to leave. */
  readonly communityId?: string;
  readonly fleetId?: string;
}

/** Reads a rehearsal token, and nothing else. */
const rehearsalAuth = {
  identify: (token: unknown): Promise<ChatSocketIdentity> => {
    const [kind, userId, expiresAt] = String(token).split('.');

    if (kind !== 'rehearsal' || !userId || !Number(expiresAt)) {
      return Promise.reject(new UnauthorizedException('Sign in to use chat.'));
    }

    return Promise.resolve({
      userId,
      username: null,
      expiresAt: Number(expiresAt),
    });
  },
};

/**
 * Starts the instance.
 */
async function main(): Promise<void> {
  if (!LOCAL_HOSTS.has(process.env.DB_HOST ?? '')) {
    throw new Error('The chat rehearsal only runs against a local database.');
  }

  const port = Number(process.env.PORT);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ChatSocketAuthService)
    .useValue(rehearsalAuth)
    .compile();
  const app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });

  app.useWebSocketAdapter(
    new ChatIoAdapter(
      app,
      [],
      new Redis(process.env.REDIS_URL as string),
      createAdapter,
    ),
  );
  await app.listen(port);
  process.send?.('ready');
  process.on('message', (message: unknown) => {
    if (message === 'shutdown') {
      void app.close().then(() => process.exit(0));

      return;
    }

    const act = message as RehearsalAction;
    const done =
      act.action === 'block'
        ? app
            .get(BlockService, { strict: false })
            .blockMember(act.userId, { username: act.username as string })
        : app
            .get(RecruitmentMembershipService, { strict: false })
            .leave(
              act.communityId as string,
              act.fleetId as string,
              act.userId,
            );

    void done.then(
      () => process.send?.({ acted: act.id }),
      (error: Error) => process.send?.({ acted: act.id, error: error.message }),
    );
  });
}

main().catch((error: unknown) => {
  new Logger('ChatRehearsal').error((error as Error).stack);
  process.exit(1);
});
