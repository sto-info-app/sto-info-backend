import { Readable } from 'stream';

import { StreamableFile } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Response } from 'express';

import { ReportReason } from 'src/moderation/enums/report-reason.enum';
import { ReportStatus } from 'src/moderation/enums/report-status.enum';

import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetFeatureService } from '../fleet-feature.service';
import {
  ChatReportAdminController,
  ChatSafetyController,
} from './chat-safety.controllers';
import { ChatReportService } from './reporting/chat-report.service';
import { ChatTranscriptService } from './transcripts/chat-transcript.service';

const CHANNEL_ID = '31000000-0000-4000-8000-0000000000c1';
const MESSAGE_ID = '31000000-0000-4000-8000-0000000000d1';
const ITEM_ID = '31000000-0000-4000-8000-0000000000f1';
const USER_ID = '31000000-0000-4000-8000-000000000010';
const ANSWER = { answered: true };

/** A mocked call that answers {@link ANSWER}. */
type Answering = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

/**
 * A mocked call that answers.
 *
 * @returns The mock.
 */
const answering = (): Answering => jest.fn(async () => ANSWER);

describe('chat safety controllers', () => {
  let featureService: { assertFlagEnabled: Answering };
  let transcripts: Record<'request' | 'mine' | 'download', Answering>;
  let reports: Record<
    'report' | 'list' | 'detail' | 'decide' | 'removeMessage',
    Answering
  >;

  beforeEach(() => {
    featureService = { assertFlagEnabled: answering() };
    transcripts = {
      request: answering(),
      mine: answering(),
      download: answering(),
    };
    reports = {
      report: answering(),
      list: answering(),
      detail: answering(),
      decide: answering(),
      removeMessage: answering(),
    };
  });

  describe('ChatSafetyController', () => {
    const controller = () =>
      new ChatSafetyController(
        featureService as unknown as FleetFeatureService,
        transcripts as unknown as ChatTranscriptService,
        reports as unknown as ChatReportService,
      );

    it('lives under chat', () => {
      expect(Reflect.getMetadata(PATH_METADATA, ChatSafetyController)).toBe(
        'chat',
      );
    });

    it('asks for and lists transcripts while chat is on', async () => {
      const dto = {
        fromAt: new Date(),
        toAt: new Date(),
        purpose: 'Looking into it',
      };

      await expect(
        controller().requestTranscript(CHANNEL_ID, USER_ID, dto),
      ).resolves.toBe(ANSWER);
      expect(transcripts.request).toHaveBeenCalledWith(
        CHANNEL_ID,
        USER_ID,
        dto,
      );
      await expect(controller().transcripts(USER_ID)).resolves.toBe(ANSWER);
      expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
        FLEET_FEATURE_FLAGS.CHAT_ENABLED,
      );
    });

    it('sends a transcript as an uncached attachment', async () => {
      const headers = new Map<string, string>();
      const response = {
        setHeader: (name: string, value: string) => headers.set(name, value),
      } as unknown as Response;

      transcripts.download.mockResolvedValue({
        stream: Readable.from(['text']),
        filename: 'chat-general-2026-09-28.txt',
        byteCount: 4,
      });

      await expect(
        controller().download(ITEM_ID, USER_ID, response),
      ).resolves.toBeInstanceOf(StreamableFile);
      expect(Object.fromEntries(headers)).toEqual({
        'Cache-Control': 'no-store, private',
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition':
          'attachment; filename="chat-general-2026-09-28.txt"',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': '4',
      });

      headers.clear();
      transcripts.download.mockResolvedValue({
        stream: Readable.from(['text']),
        filename: 'chat.txt',
        byteCount: null,
      });

      await controller().download(ITEM_ID, USER_ID, response);

      expect(headers.has('Content-Length')).toBe(false);
    });

    it('reports a message', async () => {
      const dto = { reason: ReportReason.SPAM };

      await expect(
        controller().report(MESSAGE_ID, USER_ID, dto),
      ).resolves.toBeUndefined();
      expect(reports.report).toHaveBeenCalledWith(MESSAGE_ID, USER_ID, dto);
    });

    it('refuses everything while chat is off', async () => {
      featureService.assertFlagEnabled.mockRejectedValue(new Error('off'));

      await expect(controller().transcripts(USER_ID)).rejects.toThrow('off');
      expect(transcripts.mine).not.toHaveBeenCalled();
    });
  });

  describe('ChatReportAdminController', () => {
    const controller = () =>
      new ChatReportAdminController(reports as unknown as ChatReportService);

    it('lives under admin/chat-reports', () => {
      expect(
        Reflect.getMetadata(PATH_METADATA, ChatReportAdminController),
      ).toBe('admin/chat-reports');
    });

    it('passes each route to the service', async () => {
      const decision = {
        status: ReportStatus.DISMISSED,
        note: 'Seen',
      } as const;
      const removal = { reason: 'Spam' };

      await expect(controller().list({ page: 2 })).resolves.toBe(ANSWER);
      expect(reports.list).toHaveBeenCalledWith({ page: 2 });
      await expect(controller().detail(ITEM_ID)).resolves.toBe(ANSWER);
      await expect(
        controller().decide(ITEM_ID, USER_ID, decision),
      ).resolves.toBe(ANSWER);
      expect(reports.decide).toHaveBeenCalledWith(ITEM_ID, USER_ID, decision);
      await expect(
        controller().removeMessage(ITEM_ID, USER_ID, removal),
      ).resolves.toBe(ANSWER);
      expect(reports.removeMessage).toHaveBeenCalledWith(
        ITEM_ID,
        USER_ID,
        removal,
      );
    });
  });
});
