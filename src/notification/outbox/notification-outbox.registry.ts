import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { EntityManager } from 'typeorm';

import { NotificationSeverity } from '../enums/notification-severity.enum';
import { NotificationOutboxKind } from './notification-outbox-kind.enum';
import { NotificationOutboxEntity } from './notification-outbox.entity';

/** A notice, written and ready to send. */
export interface OutboxMessage {
  readonly title: string;
  readonly body: string;
  readonly severity: NotificationSeverity;
  /** Where it leads, or null without one. */
  readonly linkUrl: string | null;
}

/**
 * What a feature does for the kinds of notice it raises (FC-028, FC-029).
 *
 * The outbox asks the person's preference itself. The handler answers
 * everything else: whether the notice is still true and still for this
 * person, and what it says, written from the data as it stands now.
 */
export interface NotificationOutboxHandler {
  /** The kinds it writes. */
  readonly kinds: readonly NotificationOutboxKind[];

  /**
   * Writes a notice, if it is still wanted.
   *
   * @param notice - The notice.
   * @param manager - The delivery's transaction.
   * @param now - The moment of the run.
   * @returns The message, or null to set the notice aside.
   */
  compose(
    notice: NotificationOutboxEntity,
    manager: EntityManager,
    now: Date,
  ): Promise<OutboxMessage | null>;

  /**
   * Queues whatever has come due since the last run, such as reminders.
   * Called at the start of every run.
   *
   * @param now - The moment of the run.
   */
  queueDue?(now: Date): Promise<void>;
}

/**
 * Which handler writes which kind of notice.
 *
 * Each feature registers its handler when its module starts, as picture
 * publishers do, so the outbox knows nothing of events or rosters.
 */
@Injectable()
export class NotificationOutboxRegistry {
  private readonly _handlers = new Map<
    NotificationOutboxKind,
    NotificationOutboxHandler
  >();

  /**
   * Registers a handler for its kinds.
   *
   * @param handler - The handler.
   * @throws InternalServerErrorException when a kind is claimed twice.
   */
  register(handler: NotificationOutboxHandler): void {
    for (const kind of handler.kinds) {
      if (this._handlers.has(kind)) {
        throw new InternalServerErrorException(
          `Two outbox handlers registered for ${kind}`,
        );
      }

      this._handlers.set(kind, handler);
    }
  }

  /**
   * The handler for a kind.
   *
   * @param kind - The kind.
   * @returns Its handler.
   * @throws InternalServerErrorException when none is registered.
   */
  require(kind: NotificationOutboxKind): NotificationOutboxHandler {
    const handler = this._handlers.get(kind);

    if (handler === undefined) {
      throw new InternalServerErrorException(
        `No outbox handler is registered for ${kind}`,
      );
    }

    return handler;
  }

  /**
   * Every registered handler, once each.
   *
   * @returns The handlers.
   */
  handlers(): NotificationOutboxHandler[] {
    return [...new Set(this._handlers.values())];
  }
}
