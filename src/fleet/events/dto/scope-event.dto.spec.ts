import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { EventRecurrence } from '../enums/event-recurrence.enum';
import { RsvpResponse, ScopeEventAudience } from '../enums/scope-event.enums';
import {
  AnswerOccurrenceDto,
  MoveOccurrenceDto,
  RecordAttendanceDto,
  ScopeEventCalendarQueryDto,
  ScopeEventDefinitionDto,
  SubscribeRemindersDto,
} from './scope-event.dto';

/**
 * Lists the properties a payload fails on.
 *
 * @param type - The DTO.
 * @param payload - What was sent.
 * @returns The failing properties.
 */
async function failures<T extends object>(
  type: new () => T,
  payload: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(type, payload));

  return errors.map(error => error.property).sort();
}

const DEFINITION = {
  title: 'Refit night',
  audience: ScopeEventAudience.PUBLIC,
  recurrence: EventRecurrence.WEEKLY,
  startDate: '2030-01-04',
  startTime: '20:00',
  weekdays: [5],
  durationMinutes: 60,
};

describe('Scope event DTOs', () => {
  it('trims the title and the link', () => {
    const dto = plainToInstance(ScopeEventDefinitionDto, {
      ...DEFINITION,
      title: '  Refit night ',
      externalUrl: ' https://discord.test/e ',
    });

    expect(dto.title).toBe('Refit night');
    expect(dto.externalUrl).toBe('https://discord.test/e');
  });

  it('leaves a title that is not text to be refused as such', async () => {
    await expect(
      failures(ScopeEventDefinitionDto, { ...DEFINITION, title: 42 }),
    ).resolves.toEqual(['title']);
  });

  it('accepts a whole event', async () => {
    await expect(
      failures(ScopeEventDefinitionDto, {
        ...DEFINITION,
        audience: ScopeEventAudience.SELECTED,
        audienceRoles: [FleetScopeRole.OFFICER],
        audienceFleetIds: ['28000000-0000-4000-8000-000000000001'],
        interval: 2,
        endsOn: '2030-06-01',
        capacity: 20,
        timezone: 'Europe/London',
      }),
    ).resolves.toEqual([]);
  });

  it('refuses a blank title, a bad day or time, and an http link', async () => {
    await expect(
      failures(ScopeEventDefinitionDto, {
        ...DEFINITION,
        title: ' ',
        startDate: '2030-02-30',
        startTime: '24:00',
        externalUrl: 'http://x.test',
      }),
    ).resolves.toEqual(['externalUrl', 'startDate', 'startTime', 'title']);
  });

  it('refuses a rule beyond its limits', async () => {
    await expect(
      failures(ScopeEventDefinitionDto, {
        ...DEFINITION,
        interval: 13,
        weekdays: [8],
        monthWeek: 5,
        occurrenceLimit: 501,
        durationMinutes: 4,
        capacity: 1001,
      }),
    ).resolves.toEqual([
      'capacity',
      'durationMinutes',
      'interval',
      'monthWeek',
      'occurrenceLimit',
      'weekdays',
    ]);
  });

  it('checks a move, an answer, attendance, reminders and a calendar', async () => {
    await expect(
      failures(MoveOccurrenceDto, { date: '2030-1-5', time: '7pm' }),
    ).resolves.toEqual(['date', 'time']);
    await expect(
      failures(AnswerOccurrenceDto, { response: 'YES', characterId: 'x' }),
    ).resolves.toEqual(['characterId', 'response']);
    await expect(
      failures(AnswerOccurrenceDto, { response: RsvpResponse.MAYBE }),
    ).resolves.toEqual([]);
    await expect(
      failures(RecordAttendanceDto, { userId: 'x', attended: 'yes' }),
    ).resolves.toEqual(['attended', 'userId']);
    await expect(
      failures(SubscribeRemindersDto, { leadMinutes: [30] }),
    ).resolves.toEqual(['leadMinutes']);
    await expect(
      failures(SubscribeRemindersDto, { leadMinutes: [] }),
    ).resolves.toEqual(['leadMinutes']);
    await expect(
      failures(ScopeEventCalendarQueryDto, { from: 'yesterday' }),
    ).resolves.toEqual(['from']);
  });
});
