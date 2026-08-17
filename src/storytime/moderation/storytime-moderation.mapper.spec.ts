import { Test, TestingModule } from '@nestjs/testing';
import { ReportStatus } from '../../moderation/enums/report-status.enum';
import { AppealStatus } from '../enums/appeal-status.enum';
import { StorytimeModerationAction } from '../enums/storytime-moderation-action.enum';
import { StorytimeReportReason } from '../enums/storytime-report-reason.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeModerationActionEntity } from './entities/storytime-moderation-action.entity';
import { StorytimeModerationAppealEntity } from './entities/storytime-moderation-appeal.entity';
import { StorytimeReportEntity } from './entities/storytime-report.entity';
import { StorytimeModerationMapper } from './storytime-moderation.mapper';

describe('StorytimeModerationMapper', () => {
  let mapper: StorytimeModerationMapper;

  const report = Object.assign(new StorytimeReportEntity(), {
    id: 'report-1',
    reporterUserId: 'reader-1',
    targetType: StorytimeTargetType.STORY,
    targetId: 'story-1',
    reasonCode: StorytimeReportReason.HARASSMENT,
    description: 'Chapter three names a real person.',
    status: ReportStatus.UNDER_REVIEW,
    assignedToUserId: 'admin-1',
    resolution: 'Removed under the harassment policy.',
    resolvedAt: new Date('2026-06-02T00:00:00.000Z'),
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorytimeModerationMapper],
    }).compile();

    mapper = module.get<StorytimeModerationMapper>(StorytimeModerationMapper);
  });

  it('is defined', () => {
    expect(mapper).toBeDefined();
  });

  it('tells a reporter their report arrived, and where it has got to', () => {
    const receipt = mapper.toReceipt(report);

    expect(receipt.id).toBe('report-1');
    expect(receipt.status).toBe(ReportStatus.UNDER_REVIEW);
    expect(receipt.targetId).toBe('story-1');
  });

  // What was decided about somebody else's work is the queue's business, not
  // the reporter's.
  it.each(['reporterUserId', 'description', 'resolution', 'assignedToUserId'])(
    'keeps %s out of the reporter’s receipt',
    field => {
      expect(
        mapper.toReceipt(report) as unknown as Record<string, unknown>,
      ).not.toHaveProperty(field);
    },
  );

  it('gives the queue everything about a report', () => {
    const mapped = mapper.toReport(report);

    expect(mapped.reporterUserId).toBe('reader-1');
    expect(mapped.reasonCode).toBe(StorytimeReportReason.HARASSMENT);
    expect(mapped.description).toContain('names a real person');
    expect(mapped.resolution).toContain('harassment policy');
    expect(mapped.assignedToUserId).toBe('admin-1');
  });

  it('maps an audit entry', () => {
    const action = Object.assign(new StorytimeModerationActionEntity(), {
      id: 'action-1',
      targetType: StorytimeTargetType.CHAPTER,
      targetId: 'chapter-1',
      action: StorytimeModerationAction.REMOVED,
      actorUserId: 'admin-1',
      reasonCode: 'HARASSMENT',
      message: 'This breaches the harassment policy.',
      createdAt: new Date('2026-06-02T00:00:00.000Z'),
    });

    const mapped = mapper.toAction(action);

    expect(mapped.action).toBe(StorytimeModerationAction.REMOVED);
    expect(mapped.actorUserId).toBe('admin-1');
    expect(mapped.message).toContain('harassment policy');
  });

  it('maps an appeal', () => {
    const appeal = Object.assign(new StorytimeModerationAppealEntity(), {
      id: 'appeal-1',
      targetType: StorytimeTargetType.STORY,
      targetId: 'story-1',
      appellantUserId: 'writer-1',
      body: 'The passage quoted is my own writing.',
      status: AppealStatus.SUBMITTED,
      reviewNotes: null,
      reviewedAt: null,
      createdAt: new Date('2026-06-03T00:00:00.000Z'),
    });

    const mapped = mapper.toAppeal(appeal);

    expect(mapped.body).toContain('my own writing');
    expect(mapped.status).toBe(AppealStatus.SUBMITTED);
    expect(mapped.reviewedAt).toBeNull();
  });

  it('maps lists', () => {
    expect(mapper.toReportList([report])).toHaveLength(1);
    expect(
      mapper.toActionList([new StorytimeModerationActionEntity()]),
    ).toHaveLength(1);
    expect(
      mapper.toAppealList([new StorytimeModerationAppealEntity()]),
    ).toHaveLength(1);
  });
});
