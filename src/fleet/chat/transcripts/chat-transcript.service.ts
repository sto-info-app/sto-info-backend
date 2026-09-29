import { Readable } from 'stream';

import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import {
  And,
  DataSource,
  In,
  LessThan,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
} from 'typeorm';

import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';

import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetPolicyService } from '../../fleet-policy.service';
import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import { RetentionOutcome } from '../../retention/retention-run.service';
import { RETENTION_BATCH_SIZE } from '../../retention/retention.constants';
import { ScopePlace, scopePlaceOf } from '../../utilities/scope-place.utility';
import {
  ChatTranscriptDto,
  ChatTranscriptRequestDto,
} from '../dto/chat-transcript.dto';
import { ChatActionEntity } from '../entities/chat-action.entity';
import { ChatChannelEntity } from '../entities/chat-channel.entity';
import { ChatMessageEntity } from '../entities/chat-message.entity';
import { ChatTranscriptEntity } from '../entities/chat-transcript.entity';
import { ChatActionKind, ChatTranscriptStatus } from '../enums/chat.enums';
import { ChatDirectService } from '../services/chat-direct.service';
import { ChatMessageService } from '../services/chat-message.service';
import { ChatExportStorageService } from './chat-export-storage.service';
import {
  CHAT_TRANSCRIPT_ATTEMPTS,
  CHAT_TRANSCRIPT_BACKOFF_MS,
  CHAT_TRANSCRIPT_BATCH,
  CHAT_TRANSCRIPT_JOB,
  CHAT_TRANSCRIPT_LIFETIME_MS,
  CHAT_TRANSCRIPT_QUEUE,
  CHAT_TRANSCRIPT_STALE_MS,
} from './chat-transcript.constants';

/** One day, in milliseconds. */
const DAY = 86_400_000;

/** What a scope is called in a transcript's header. */
const SCOPE_LABEL: Readonly<Record<FleetScopeKind, string>> = {
  [FleetScopeKind.COMMUNITY]: 'Community',
  [FleetScopeKind.FLEET]: 'Fleet',
  [FleetScopeKind.ARMADA]: 'Armada',
};

/** A written transcript, ready to send. */
export interface ChatTranscriptDownload {
  readonly stream: Readable;
  readonly filename: string;
  readonly byteCount: number | null;
}

/**
 * Scope admins' transcripts of their channels (FC-035).
 *
 * R23 and Steve's decisions of 28 and 29 September 2026:
 *
 * - `chat.transcript.export` holders at a channel's own scope export it, and
 *   nobody else: never a conversation between friends, never a sibling
 *   Fleet's channel, never a Community's through one of its Fleets.
 * - A range within the last seven days, checked here against the server's
 *   clock, and a purpose. Both are the database's to keep as well.
 * - A job writes plain text to the private exports bucket: a header, then
 *   `YYYY-MM-DD HH:mm Name: text` in UTC, a deleted message as `[deleted]`,
 *   and anybody across a block from the requester hidden.
 * - Its link lasts 24 hours. Permission is asked again when it is written and
 *   when it is downloaded, and every request and download is logged.
 * - An hourly sweep deletes expired ones, and gives up on any never written.
 */
/** What the chat log calls a transcript reaching each state (FC-039). */
const SETTLED_ACTIONS = {
  [ChatTranscriptStatus.READY]: ChatActionKind.TRANSCRIPT_READY,
  [ChatTranscriptStatus.FAILED]: ChatActionKind.TRANSCRIPT_FAILED,
  [ChatTranscriptStatus.EXPIRED]: ChatActionKind.TRANSCRIPT_EXPIRED,
} as const;

@Injectable()
export class ChatTranscriptService {
  private readonly _logger = new Logger(ChatTranscriptService.name);

  /**
   * Creates an instance of ChatTranscriptService.
   *
   * @param _dataSource - The database.
   * @param _messages - Finds a channel somebody may read.
   * @param _direct - Says who somebody has blocked.
   * @param _policy - How far back a transcript reaches.
   * @param _storage - The private exports bucket.
   * @param _notifications - Tells the requester it is ready.
   * @param _queue - The transcript queue.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _messages: ChatMessageService,
    private readonly _direct: ChatDirectService,
    private readonly _policy: FleetPolicyService,
    private readonly _storage: ChatExportStorageService,
    private readonly _notifications: NotificationService,
    @InjectQueue(CHAT_TRANSCRIPT_QUEUE) private readonly _queue: Queue,
  ) {}

  /**
   * Asks for a transcript.
   *
   * @param channelId - The channel.
   * @param userId - The requester.
   * @param dto - The range and the purpose.
   * @returns The transcript, waiting to be written.
   * @throws NotFoundException when they may not read the channel.
   * @throws ForbiddenException when they may read but not export it.
   * @throws BadRequestException when the range reaches back too far, or ends
   *   before it starts.
   */
  async request(
    channelId: string,
    userId: string,
    dto: ChatTranscriptRequestDto,
  ): Promise<ChatTranscriptDto> {
    const { standing } = await this._messages.readableChannel(
      channelId,
      userId,
    );

    if (!standing.mayExport) {
      throw new ForbiddenException(
        'Only its transcript exporters may do that.',
      );
    }

    const now = new Date();
    const days = this._policy.chatTranscriptHistoryDays;
    const toAt = dto.toAt > now ? now : dto.toAt;

    if (dto.fromAt.getTime() < now.getTime() - days * DAY) {
      throw new BadRequestException(
        `A transcript reaches back ${days} days at most.`,
      );
    }

    if (dto.fromAt >= toAt) {
      throw new BadRequestException('The range must end after it starts.');
    }

    const transcript = await this._dataSource.transaction(async manager => {
      const saved = await manager.save(ChatTranscriptEntity, {
        channelId,
        requestedByUserId: userId,
        purpose: dto.purpose,
        fromAt: dto.fromAt,
        toAt,
        status: ChatTranscriptStatus.PENDING,
        // The range is checked against this instant, so the row records it
        // rather than the database's slightly later one.
        createdAt: now,
      });

      await manager.save(ChatActionEntity, {
        channelId,
        action: ChatActionKind.TRANSCRIPT_REQUESTED,
        actorUserId: userId,
        reason: dto.purpose,
        detail: {
          transcriptId: saved.id,
          fromAt: saved.fromAt.toISOString(),
          toAt: saved.toAt.toISOString(),
        },
      });

      return saved;
    });

    try {
      await this._queue.add(
        CHAT_TRANSCRIPT_JOB,
        { transcriptId: transcript.id },
        {
          attempts: CHAT_TRANSCRIPT_ATTEMPTS,
          backoff: { type: 'exponential', delay: CHAT_TRANSCRIPT_BACKOFF_MS },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    } catch (error) {
      this._logger.error(
        `[request] Transcript not queued - TranscriptId: ${transcript.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.settle(
        transcript,
        ChatTranscriptStatus.PENDING,
        ChatTranscriptStatus.FAILED,
      );
      transcript.status = ChatTranscriptStatus.FAILED;
    }

    return (await this.toDtos([transcript]))[0];
  }

  /**
   * Writes a transcript: the job's work.
   *
   * @param transcriptId - The transcript.
   */
  async process(transcriptId: string): Promise<void> {
    const manager = this._dataSource.manager;
    const transcript = await manager.findOne(ChatTranscriptEntity, {
      where: { id: transcriptId, status: ChatTranscriptStatus.PENDING },
    });

    if (transcript === null) {
      return;
    }

    const place = await this.exportable(
      transcript.channelId,
      transcript.requestedByUserId,
    );

    if (place === null) {
      this._logger.warn(
        `[process] Transcript refused, no longer permitted - ` +
          `TranscriptId: ${transcriptId}`,
      );
      await this.settle(
        transcript,
        ChatTranscriptStatus.PENDING,
        ChatTranscriptStatus.FAILED,
      );

      return;
    }

    const { text, messageCount } = await this.write(transcript, place);
    const objectKey = this._storage.buildObjectKey(transcript.id);
    const byteCount = await this._storage.put(objectKey, text);
    const readyAt = new Date();

    await this.settle(
      transcript,
      ChatTranscriptStatus.PENDING,
      ChatTranscriptStatus.READY,
      {
        objectKey,
        messageCount,
        byteCount,
        readyAt,
        expiresAt: new Date(readyAt.getTime() + CHAT_TRANSCRIPT_LIFETIME_MS),
      },
    );

    try {
      await this._notifications.createNotification({
        target: NotificationTarget.USER,
        userId: transcript.requestedByUserId as string,
        severity: NotificationSeverity.SUCCESS,
        title: 'Transcript ready',
        body:
          `Your transcript of ${place.channel.name} is ready. ` +
          'It can be downloaded from Chat for 24 hours.',
        linkUrl: '/chat',
      });
    } catch (error) {
      this._logger.warn(
        `[process] Transcript notice not sent - TranscriptId: ` +
          `${transcriptId}, Reason: ${(error as Error).name}`,
      );
    }
  }

  /**
   * Opens a transcript for its requester.
   *
   * @param transcriptId - The transcript.
   * @param userId - Who is downloading it.
   * @returns Its bytes and a name to save them under.
   * @throws NotFoundException when it is not theirs.
   * @throws ConflictException when it is not written.
   * @throws GoneException when its link has expired.
   * @throws ForbiddenException when they may no longer export the channel.
   */
  async download(
    transcriptId: string,
    userId: string,
  ): Promise<ChatTranscriptDownload> {
    const manager = this._dataSource.manager;
    const transcript = await manager.findOne(ChatTranscriptEntity, {
      where: { id: transcriptId, requestedByUserId: userId },
    });

    if (transcript === null) {
      throw new NotFoundException('Not found');
    }

    if (
      transcript.status === ChatTranscriptStatus.EXPIRED ||
      (transcript.status === ChatTranscriptStatus.READY &&
        (transcript.expiresAt as Date) <= new Date())
    ) {
      throw new GoneException('This transcript has expired.');
    }

    if (transcript.status !== ChatTranscriptStatus.READY) {
      throw new ConflictException('This transcript is not ready.');
    }

    const place = await this.exportable(transcript.channelId, userId);

    if (place === null) {
      throw new ForbiddenException(
        'You may no longer export this channel’s transcripts.',
      );
    }

    await manager.save(ChatActionEntity, {
      channelId: transcript.channelId,
      action: ChatActionKind.TRANSCRIPT_DOWNLOADED,
      actorUserId: userId,
      detail: { transcriptId },
    });

    return {
      stream: await this._storage.getStream(transcript.objectKey as string),
      filename: filenameOf(place.channel, transcript),
      byteCount: transcript.byteCount,
    };
  }

  /**
   * The transcripts somebody asked for in the last day.
   *
   * @param userId - The requester.
   * @returns Each, newest first.
   */
  async mine(userId: string): Promise<ChatTranscriptDto[]> {
    const transcripts = await this._dataSource.manager.find(
      ChatTranscriptEntity,
      {
        where: {
          requestedByUserId: userId,
          createdAt: MoreThanOrEqual(new Date(Date.now() - DAY)),
        },
        order: { createdAt: 'DESC' },
      },
    );

    return this.toDtos(transcripts);
  }

  /**
   * Deletes expired transcripts, and gives up on any never written. Hourly,
   * by the Fleet's retention schedule, which records each run (FC-037).
   *
   * A file that cannot be deleted is left expiring, so the next sweep tries
   * it again; a run takes at most {@link RETENTION_BATCH_SIZE}.
   *
   * @returns How many were expired, not deleted and given up on, and whether
   *   that was all that is due.
   */
  async sweep(): Promise<RetentionOutcome> {
    const manager = this._dataSource.manager;
    const now = new Date();
    const due = await manager.find(ChatTranscriptEntity, {
      where: {
        status: ChatTranscriptStatus.READY,
        expiresAt: LessThanOrEqual(now),
      },
      order: { expiresAt: 'ASC' },
      take: RETENTION_BATCH_SIZE,
    });
    let expired = 0;

    for (const transcript of due) {
      try {
        await this._storage.remove(transcript.objectKey as string);
        await this.settle(
          transcript,
          ChatTranscriptStatus.READY,
          ChatTranscriptStatus.EXPIRED,
          { objectKey: null },
        );
        expired++;
      } catch (error) {
        this._logger.error(
          `[sweep] Transcript not deleted - TranscriptId: ${transcript.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    const stale = await manager.find(ChatTranscriptEntity, {
      where: {
        status: ChatTranscriptStatus.PENDING,
        createdAt: LessThan(new Date(now.getTime() - CHAT_TRANSCRIPT_STALE_MS)),
      },
      order: { createdAt: 'ASC' },
      take: RETENTION_BATCH_SIZE,
    });
    let failed = 0;

    for (const transcript of stale) {
      failed += (await this.settle(
        transcript,
        ChatTranscriptStatus.PENDING,
        ChatTranscriptStatus.FAILED,
      ))
        ? 1
        : 0;
    }

    return {
      counts: { expired, notDeleted: due.length - expired, failed },
      complete:
        due.length < RETENTION_BATCH_SIZE &&
        expired === due.length &&
        stale.length < RETENTION_BATCH_SIZE,
    };
  }

  /**
   * Whether somebody may export a channel now, and where it is.
   *
   * @param channelId - The channel.
   * @param userId - The requester, or null when their account has gone.
   * @returns The channel and its scope, or null when they may not.
   */
  private async exportable(
    channelId: string,
    userId: string | null,
  ): Promise<{ channel: ChatChannelEntity; scope: ScopePlace } | null> {
    if (userId === null) {
      return null;
    }

    try {
      const { channel, standing } = await this._messages.readableChannel(
        channelId,
        userId,
      );
      const scope = await scopePlaceOf(this._dataSource.manager, channel);

      return standing.mayExport && scope !== null ? { channel, scope } : null;
    } catch {
      return null;
    }
  }

  /**
   * Writes a transcript's text.
   *
   * @param transcript - The transcript.
   * @param place - Its channel and scope.
   * @returns The text, and how many messages it holds.
   */
  private async write(
    transcript: ChatTranscriptEntity,
    place: { channel: ChatChannelEntity; scope: ScopePlace },
  ): Promise<{ text: string; messageCount: number }> {
    const manager = this._dataSource.manager;
    const requesterId = transcript.requestedByUserId as string;
    const blocked = await this._direct.blockedFor(requesterId);
    const lines: string[] = [];
    let after: ChatMessageEntity | null = null;

    for (;;) {
      const batch: ChatMessageEntity[] = await manager.find(ChatMessageEntity, {
        where: rangeAfter(transcript, after),
        order: { createdAt: 'ASC', id: 'ASC' },
        take: CHAT_TRANSCRIPT_BATCH,
      });
      const names = await usernamesFor(
        manager,
        batch.map(message => message.authorUserId),
      );

      for (const message of batch) {
        lines.push(lineOf(message, names, blocked));
      }

      if (batch.length < CHAT_TRANSCRIPT_BATCH) {
        break;
      }

      after = batch[batch.length - 1];
    }

    const requester = (await usernamesFor(manager, [requesterId])).get(
      requesterId,
    );
    const header = [
      'STO Info chat transcript',
      `${SCOPE_LABEL[place.scope.kind]}: ${place.scope.name}`,
      `Channel: ${place.channel.name}`,
      `From: ${stamp(transcript.fromAt)} UTC`,
      `To: ${stamp(transcript.toAt)} UTC`,
      `Purpose: ${transcript.purpose}`,
      `Exported by: ${requester ?? '[unknown]'}`,
      `Generated: ${stamp(new Date())} UTC`,
      `Messages: ${lines.length}`,
    ];

    return {
      text: `${[...header, '', ...lines].join('\n')}\n`,
      messageCount: lines.length,
    };
  }

  /**
   * Moves a transcript on, and logs it once (FC-039): a retried job or a
   * second sweep finds it moved already and writes nothing.
   *
   * @param transcript - The transcript.
   * @param from - Where it must be.
   * @param to - Where it goes.
   * @param values - What else changes.
   * @returns Whether it moved.
   */
  private async settle(
    transcript: Pick<ChatTranscriptEntity, 'id' | 'channelId'>,
    from: ChatTranscriptStatus,
    to: keyof typeof SETTLED_ACTIONS,
    values: Partial<ChatTranscriptEntity> = {},
  ): Promise<boolean> {
    return this._dataSource.transaction(async manager => {
      const moved = await manager.update(
        ChatTranscriptEntity,
        { id: transcript.id, status: from },
        { status: to, ...values },
      );

      if (!moved.affected) {
        return false;
      }

      await manager
        .createQueryBuilder()
        .insert()
        .into(ChatActionEntity)
        .values({
          channelId: transcript.channelId,
          action: SETTLED_ACTIONS[to],
          actorUserId: null,
          detail: { transcriptId: transcript.id },
          idempotencyKey: `${SETTLED_ACTIONS[to]}:${transcript.id}`,
        })
        .orIgnore()
        .execute();

      return true;
    });
  }

  /**
   * Shows transcripts to their requester, with where each is.
   *
   * @param transcripts - The transcripts.
   * @returns Each.
   */
  private async toDtos(
    transcripts: readonly ChatTranscriptEntity[],
  ): Promise<ChatTranscriptDto[]> {
    const manager = this._dataSource.manager;
    const channelIds = [...new Set(transcripts.map(each => each.channelId))];
    const channels =
      channelIds.length === 0
        ? []
        : await manager.find(ChatChannelEntity, {
            where: { id: In(channelIds) },
          });
    const places = new Map<
      string,
      { channel: ChatChannelEntity; scope: ScopePlace | null }
    >();

    for (const channel of channels) {
      places.set(channel.id, {
        channel,
        scope: await scopePlaceOf(manager, channel),
      });
    }

    return transcripts.map(transcript => {
      const place = places.get(transcript.channelId) as {
        channel: ChatChannelEntity;
        scope: ScopePlace | null;
      };

      return {
        id: transcript.id,
        channelId: transcript.channelId,
        channelName: place.channel.name,
        scopeKind: place.channel.fleetId
          ? FleetScopeKind.FLEET
          : place.channel.armadaId
            ? FleetScopeKind.ARMADA
            : FleetScopeKind.COMMUNITY,
        scopeName: place.scope?.name ?? null,
        purpose: transcript.purpose,
        fromAt: transcript.fromAt,
        toAt: transcript.toAt,
        status: transcript.status,
        messageCount: transcript.messageCount,
        createdAt: transcript.createdAt,
        readyAt: transcript.readyAt,
        expiresAt: transcript.expiresAt,
      };
    });
  }
}

/**
 * The messages of a transcript's channel and range, after the last one read.
 *
 * @param transcript - The transcript.
 * @param after - The last message read, if any.
 * @returns The conditions, any of which a message may meet.
 */
function rangeAfter(
  transcript: ChatTranscriptEntity,
  after: ChatMessageEntity | null,
) {
  const base = { channelId: transcript.channelId };
  const upTo = LessThanOrEqual(transcript.toAt);

  if (after === null) {
    return [
      { ...base, createdAt: And(MoreThanOrEqual(transcript.fromAt), upTo) },
    ];
  }

  return [
    { ...base, createdAt: And(MoreThan(after.createdAt), upTo) },
    { ...base, createdAt: after.createdAt, id: MoreThan(after.id) },
  ];
}

/**
 * One message's line.
 *
 * @param message - The message.
 * @param names - Authors' usernames.
 * @param blocked - Whom the requester cannot see.
 * @returns `YYYY-MM-DD HH:mm Name: text`, later lines indented.
 */
function lineOf(
  message: ChatMessageEntity,
  names: ReadonlyMap<string, string>,
  blocked: ReadonlySet<string>,
): string {
  const at = stamp(message.createdAt);

  if (message.authorUserId !== null && blocked.has(message.authorUserId)) {
    return `${at} [hidden]: Message from a member you can’t see`;
  }

  const name =
    message.authorUserId === null
      ? '[former member]'
      : (names.get(message.authorUserId) ?? '[unknown]');
  const text =
    message.deletedAt === null
      ? message.body.replace(/\r?\n/g, '\n    ')
      : '[deleted]';

  return `${at} ${name}: ${text}`;
}

/**
 * An instant as a transcript prints it.
 *
 * @param at - The instant.
 * @returns `YYYY-MM-DD HH:mm`, in UTC.
 */
function stamp(at: Date): string {
  return at.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * The name a transcript is saved under: letters, digits and hyphens only, so
 * nothing in a channel's name reaches the header.
 *
 * @param channel - Its channel.
 * @param transcript - The transcript.
 * @returns The file name.
 */
function filenameOf(
  channel: ChatChannelEntity,
  transcript: ChatTranscriptEntity,
): string {
  const slug =
    channel.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'channel';

  return `chat-${slug}-${stamp(transcript.toAt).slice(0, 10)}.txt`;
}
