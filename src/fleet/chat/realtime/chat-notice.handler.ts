import { HttpException, Injectable, OnModuleInit } from '@nestjs/common';

import { EntityManager } from 'typeorm';

import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationOutboxKind } from 'src/notification/outbox/notification-outbox-kind.enum';
import { NotificationOutboxEntity } from 'src/notification/outbox/notification-outbox.entity';
import {
  NotificationOutboxHandler,
  NotificationOutboxRegistry,
  OutboxMessage,
} from 'src/notification/outbox/notification-outbox.registry';

import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import { scopePlaceOf } from '../../utilities/scope-place.utility';
import { ChatMessageEntity } from '../entities/chat-message.entity';
import { ChatDirectService } from '../services/chat-direct.service';
import { ChatMessageService } from '../services/chat-message.service';
import { ChatDeliveryService } from './chat-delivery.service';

/**
 * Writes chat's notices when the outbox delivers them (FC-033).
 *
 * Steve's decisions of 28 and 29 September 2026: a mention and a reply each
 * tell their person once; a direct message tells its reader once per
 * conversation while they have no chat open, and not again until they open
 * it. Each is asked again at delivery — the message still there and within
 * the four-hour window, the reader still able to read its place — and is set
 * aside otherwise. A direct message's reader who has chat open by then is
 * not told, and the conversation is ready to tell them next time.
 *
 * A notice never quotes the message: it outlives the window, and chat's text
 * does not.
 */
@Injectable()
export class ChatNoticeHandler
  implements NotificationOutboxHandler, OnModuleInit
{
  readonly kinds = [
    NotificationOutboxKind.CHAT_MENTION,
    NotificationOutboxKind.CHAT_REPLY,
    NotificationOutboxKind.CHAT_DIRECT_MESSAGE,
  ];

  /**
   * Creates an instance of ChatNoticeHandler.
   *
   * @param _registry - Where outbox handlers are registered.
   * @param _messages - Says who may read a channel, and the window.
   * @param _direct - Says who may use a conversation.
   * @param _delivery - Says who has chat open.
   */
  constructor(
    private readonly _registry: NotificationOutboxRegistry,
    private readonly _messages: ChatMessageService,
    private readonly _direct: ChatDirectService,
    private readonly _delivery: ChatDeliveryService,
  ) {}

  /**
   * Registers with the outbox.
   */
  onModuleInit(): void {
    this._registry.register(this);
  }

  /**
   * Writes a notice, or sets it aside: a message gone, deleted, past the
   * window, or from somebody across a block from the person by now.
   *
   *
   * @param notice - The notice.
   * @param manager - The delivery's transaction.
   * @returns The notice to send, or null to set it aside.
   */
  async compose(
    notice: NotificationOutboxEntity,
    manager: EntityManager,
  ): Promise<OutboxMessage | null> {
    const message = await manager.findOne(ChatMessageEntity, {
      where: { id: notice.subjectId },
    });

    if (
      message === null ||
      message.deletedAt !== null ||
      message.createdAt < this._messages.windowStart() ||
      (await this._direct.blockedFor(notice.userId)).has(
        message.authorUserId as string,
      )
    ) {
      return null;
    }

    const names = await usernamesFor(manager, [message.authorUserId]);
    const author = names.get(message.authorUserId as string) ?? 'Somebody';
    const site = process.env.APP_FRONTEND_URL ?? '';

    try {
      if (message.channelId === null) {
        const conversationId = message.conversationId as string;
        const { conversation } = await this._direct.usable(
          conversationId,
          notice.userId,
        );

        if (await this._delivery.isConnected(notice.userId)) {
          await this._direct.rearmNotice(conversation, notice.userId, manager);

          return null;
        }

        return {
          title: `${author} sent you a message`,
          body: `${author} wrote to you in chat. Open the conversation to read it; chat keeps the last four hours.`,
          severity: NotificationSeverity.INFO,
          linkUrl: site ? `${site}/chat/direct/${conversationId}` : null,
        };
      }

      const { channel } = await this._messages.readableChannel(
        message.channelId,
        notice.userId,
      );
      const place = await scopePlaceOf(manager, channel);
      const where = `${channel.name}${place === null ? '' : ` (${place.name})`}`;
      const mentioned = notice.kind === NotificationOutboxKind.CHAT_MENTION;

      return {
        title: mentioned
          ? `${author} mentioned you in ${where}`
          : `${author} replied to you in ${where}`,
        body: `Open the channel to read it; chat keeps the last four hours.`,
        severity: NotificationSeverity.INFO,
        linkUrl: site ? `${site}/chat/channels/${channel.id}` : null,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        return null;
      }

      throw error;
    }
  }
}
