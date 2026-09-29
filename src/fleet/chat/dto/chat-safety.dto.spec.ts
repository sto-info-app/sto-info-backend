import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ReportReason } from 'src/moderation/enums/report-reason.enum';
import { ReportStatus } from 'src/moderation/enums/report-status.enum';

import {
  CHAT_REPORT_TEXT_MAX_LENGTH,
  ChatReportDecisionDto,
  ChatReportDto,
  ChatReportRemovalDto,
  ChatReportsQueryDto,
} from './chat-report.dto';
import { ChatTranscriptRequestDto } from './chat-transcript.dto';

/**
 * Lists the properties a body fails on.
 *
 * @param type - The DTO.
 * @param body - What was sent.
 * @returns The failing properties.
 */
async function failures(
  type: new () => object,
  body: object,
): Promise<string[]> {
  return (await validate(plainToInstance(type, body))).map(
    error => error.property,
  );
}

describe('chat transcript and report DTOs (FC-035)', () => {
  describe('ChatTranscriptRequestDto', () => {
    it('reads instants and trims the purpose', async () => {
      const dto = plainToInstance(ChatTranscriptRequestDto, {
        fromAt: '2026-09-28T10:00:00Z',
        toAt: '2026-09-28T12:00:00Z',
        purpose: '  Looking into a complaint  ',
      });

      expect(dto.fromAt).toEqual(new Date('2026-09-28T10:00:00Z'));
      expect(dto.purpose).toBe('Looking into a complaint');
      await expect(validate(dto)).resolves.toEqual([]);
    });

    it.each([
      ['no range', { purpose: 'Looking into it' }, ['fromAt', 'toAt']],
      [
        'a range that is not instants',
        { fromAt: 'soon', toAt: 'later', purpose: 'Looking into it' },
        ['fromAt', 'toAt'],
      ],
      [
        'a purpose under ten characters once trimmed',
        {
          fromAt: '2026-09-28T10:00:00Z',
          toAt: '2026-09-28T12:00:00Z',
          purpose: '   Because   ',
        },
        ['purpose'],
      ],
      [
        'a purpose over 500 characters',
        {
          fromAt: '2026-09-28T10:00:00Z',
          toAt: '2026-09-28T12:00:00Z',
          purpose: 'x'.repeat(501),
        },
        ['purpose'],
      ],
      [
        'a purpose that is not text',
        {
          fromAt: '2026-09-28T10:00:00Z',
          toAt: '2026-09-28T12:00:00Z',
          purpose: 12345678901,
        },
        ['purpose'],
      ],
    ])('refuses %s', async (_case, body, properties) => {
      await expect(failures(ChatTranscriptRequestDto, body)).resolves.toEqual(
        properties,
      );
    });
  });

  describe('ChatReportDto', () => {
    it('takes a reason, and details as optional', async () => {
      await expect(
        failures(ChatReportDto, { reason: ReportReason.SPAM }),
      ).resolves.toEqual([]);

      const dto = plainToInstance(ChatReportDto, {
        reason: ReportReason.OTHER,
        details: '  Said it twice  ',
      });

      expect(dto.details).toBe('Said it twice');
    });

    it.each([
      ['no reason', {}, ['reason']],
      ['an unknown reason', { reason: 'RUDE' }, ['reason']],
      [
        'long details',
        {
          reason: ReportReason.SPAM,
          details: 'x'.repeat(CHAT_REPORT_TEXT_MAX_LENGTH + 1),
        },
        ['details'],
      ],
    ])('refuses %s', async (_case, body, properties) => {
      await expect(failures(ChatReportDto, body)).resolves.toEqual(properties);
    });
  });

  describe('ChatReportDecisionDto', () => {
    it.each([ReportStatus.ACTIONED, ReportStatus.DISMISSED])(
      'closes a report as %s',
      async status => {
        await expect(
          failures(ChatReportDecisionDto, { status, note: 'Seen' }),
        ).resolves.toEqual([]);
      },
    );

    it.each([ReportStatus.OPEN, ReportStatus.UNDER_REVIEW])(
      'refuses %s, which closes nothing',
      async status => {
        await expect(
          failures(ChatReportDecisionDto, { status, note: 'Seen' }),
        ).resolves.toEqual(['status']);
      },
    );

    // FC-039: the note is the decision's reason in the site admin log.
    it.each([
      ['no note', {}],
      ['a blank note', { note: '   ' }],
    ])('refuses %s', async (_case, body) => {
      await expect(
        failures(ChatReportDecisionDto, {
          status: ReportStatus.DISMISSED,
          ...body,
        }),
      ).resolves.toEqual(['note']);
    });

    it('refuses a long note', async () => {
      await expect(
        failures(ChatReportDecisionDto, {
          status: ReportStatus.DISMISSED,
          note: 'x'.repeat(CHAT_REPORT_TEXT_MAX_LENGTH + 1),
        }),
      ).resolves.toEqual(['note']);
    });
  });

  describe('ChatReportRemovalDto', () => {
    it('needs a reason', async () => {
      await expect(
        failures(ChatReportRemovalDto, { reason: 'Harassment' }),
      ).resolves.toEqual([]);
      await expect(
        failures(ChatReportRemovalDto, { reason: '   ' }),
      ).resolves.toEqual(['reason']);
    });
  });

  describe('ChatReportsQueryDto', () => {
    it('filters by status and reason, and pages', async () => {
      await expect(
        failures(ChatReportsQueryDto, {
          status: ReportStatus.OPEN,
          reason: ReportReason.SPAM,
          page: '2',
        }),
      ).resolves.toEqual([]);
      await expect(
        failures(ChatReportsQueryDto, { status: 'LOST' }),
      ).resolves.toEqual(['status']);
    });
  });
});
