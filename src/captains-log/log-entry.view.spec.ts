import { describe, expect, it } from '@jest/globals';

import { LogEntryType } from './captains-log.constants';
import { LogEntryEntity } from './entities/log-entry.entity';
import {
  adminLogEntryView,
  defaultLogHeadline,
  logEntryView,
  publicLogEntryView,
} from './log-entry.view';

/**
 * Builds an entry.
 *
 * @param overrides - Whatever the case is about.
 * @returns The entry.
 */
const entry = (overrides: Partial<LogEntryEntity> = {}): LogEntryEntity =>
  ({
    id: 'entry-1',
    userId: 'user-1',
    type: LogEntryType.CAPTAIN,
    headline: null,
    body: 'We reached the Azure Nebula.',
    stardate: 104502.57,
    pictureId: null,
    pictureAlt: null,
    createdAt: new Date('2026-11-24T10:30:00Z'),
    updatedAt: new Date('2026-11-24T10:30:00Z'),
    editedAt: null,
    removedAt: null,
    removedByUserId: null,
    removedReason: null,
    ...overrides,
  }) as LogEntryEntity;

describe('log entry views (sc-1450)', () => {
  it('heads an entry with no headline by its type and stardate', () => {
    expect(defaultLogHeadline(LogEntryType.CAPTAIN, 104502.57)).toBe(
      "Captain's Log stardate 104502.6",
    );
    expect(defaultLogHeadline(LogEntryType.PERSONAL, 104000)).toBe(
      'Personal Log stardate 104000.0',
    );
  });

  it('shows a reader the headline, the words and the picture, and nothing of moderation', () => {
    const view = publicLogEntryView(
      entry({
        headline: 'Arrival',
        pictureId: 'picture-1',
        pictureAlt: 'The nebula',
      }),
    );

    expect(view).toEqual({
      id: 'entry-1',
      headline: 'Arrival',
      body: 'We reached the Azure Nebula.',
      stardate: 104502.57,
      pictureUrls: {
        cover640x360: expect.stringContaining('picture-1/cover640x360'),
        cover1920x1080: expect.stringContaining('picture-1/cover1920x1080'),
      },
      pictureAlt: 'The nebula',
      createdAt: new Date('2026-11-24T10:30:00Z'),
      editedAt: null,
    });
  });

  it('shows the author the type, their own headline and any removal', () => {
    const removedAt = new Date('2026-11-25T08:00:00Z');
    const view = logEntryView(
      entry({
        type: LogEntryType.PERSONAL,
        removedAt,
        removedReason: 'Spoilers',
      }),
    );

    expect(view.headline).toBe('Personal Log stardate 104502.6');
    expect(view.customHeadline).toBeNull();
    expect(view.type).toBe(LogEntryType.PERSONAL);
    expect(view.pictureUrls).toBeNull();
    expect(view.removedAt).toBe(removedAt);
    expect(view.removedReason).toBe('Spoilers');
    expect(view).not.toHaveProperty('userId');
  });

  it('shows a site admin who wrote it', () => {
    expect(adminLogEntryView(entry()).userId).toBe('user-1');
  });
});
