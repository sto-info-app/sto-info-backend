import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { FleetNameAliasEntity } from '../../entities/fleet-name-alias.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { ROSTER_PREVIEW_SAMPLE_ROWS } from '../constants/roster-typed.constants';
import { RosterDateResolution } from '../enums/roster-date-resolution.enum';
import { RosterFilenameRejectionCode } from '../enums/roster-filename-rejection-code.enum';
import { RosterRowRejectionCode } from '../enums/roster-row-rejection-code.enum';
import { RosterSourceHeaderShape } from '../enums/roster-source-header-shape.enum';
import { RosterCsvPrivacyParserService } from './roster-csv-privacy-parser.service';
import { RosterExportIdentityService } from './roster-export-identity.service';
import { RosterImportPreviewService } from './roster-import-preview.service';
import { RosterTypedParserService } from './roster-typed-parser.service';

const LONDON = 'Europe/London';
const FLEET_NAME = 'Fixture Basic Fleet';
const FILENAME = `${FLEET_NAME}_20240101-120000.Csv`;

const HEADER =
  'Character Name,Account Handle,Level,Class,Guild Rank,' +
  'Contribution Total,Join Date,Rank Change Date,Last Active Date,' +
  'Status,Public Comment,Public Comment Last Edit Date';

/** What one member's row says, before anything asks what it means. */
interface RowInput {
  readonly character?: string;
  readonly handle?: string;
  readonly level?: string;
  readonly className?: string;
  readonly contribution?: string;
  readonly joinDate?: string;
}

/**
 * Writes a roster row the way the game writes one.
 *
 * Nine unquoted fields, then a quoted Status and Public Comment and a bare
 * edit date.
 *
 * @param row - What to put in the columns that matter here.
 * @returns The line, without its terminator.
 */
function line(row: RowInput = {}): string {
  const {
    character = 'Vex Loran',
    handle = '@vexloran',
    level = '65',
    className = 'Starfleet Tactical Officer',
    contribution = '5000',
    joinDate = '4/1/2023 12:00:00pm',
  } = row;

  return [
    character,
    handle,
    level,
    className,
    'Member',
    contribution,
    joinDate,
    '',
    '1/5/2024 1:00:00pm',
    '"Offline"',
    '""',
    '',
  ].join(',');
}

/**
 * Assembles an export as the game writes one.
 *
 * @param rows - The data lines.
 * @returns The bytes.
 */
function exportFile(...rows: string[]): Buffer {
  return Buffer.from(`${[HEADER, ...rows].join('\n')}\n`, 'utf8');
}

describe('RosterImportPreviewService', () => {
  let service: RosterImportPreviewService;
  let parser: RosterCsvPrivacyParserService;

  /**
   * A Fleet registered under one exact name.
   *
   * @param exactGameName - The name as it appears in game.
   * @returns Enough of a Fleet for the preview.
   */
  function fleet(exactGameName = FLEET_NAME): StoFleetEntity {
    return {
      id: 'a1b2c3d4-0000-4000-8000-000000000001',
      exactGameName,
    } as StoFleetEntity;
  }

  /**
   * Runs a preview with the ordinary Fleet, filename and timezone.
   *
   * @param source - The bytes.
   * @param overrides - Anything to change about the request.
   * @returns The preview.
   */
  function preview(
    source: Buffer,
    overrides: {
      originalFilename?: string;
      timezone?: string;
      fleetName?: string;
    } = {},
  ) {
    return service.preview({
      fleet: fleet(overrides.fleetName),
      originalFilename: overrides.originalFilename ?? FILENAME,
      timezone: overrides.timezone ?? LONDON,
      source,
    });
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RosterImportPreviewService,
        RosterCsvPrivacyParserService,
        RosterTypedParserService,
        RosterExportIdentityService,
        {
          provide: getRepositoryToken(FleetNameAliasEntity),
          useValue: { find: jest.fn(() => Promise.resolve([])) },
        },
      ],
    }).compile();

    service = module.get(RosterImportPreviewService);
    parser = module.get(RosterCsvPrivacyParserService);
  });

  describe('an export that could be imported', () => {
    it('reports the file, the name and the rows as it read them', async () => {
      const answer = await preview(exportFile(line()));

      expect(answer).toMatchObject({
        canImport: true,
        timezone: LONDON,
        filename: {
          rejection: null,
          fleetLabel: FLEET_NAME,
          localStamp: '2024-01-01T12:00:00',
          exportedAt: '2024-01-01T12:00:00.000Z',
          exportedAtCandidates: ['2024-01-01T12:00:00.000Z'],
          matchedAlias: null,
        },
        source: {
          headerShape: RosterSourceHeaderShape.NORMAL,
          rowCount: 1,
          officerTailRowCount: 0,
          parserVersion: 1,
          sourceByteSize: expect.any(Number),
        },
        readableRowCount: 1,
        unknownClassCount: 0,
        ambiguousDateCount: 0,
        problems: [],
      });
    });

    // The whole reason the screen exists: the local time the file wrote, and
    // the instant it was read as, side by side.
    it('draws each sampled date both ways', async () => {
      const answer = await preview(exportFile(line()));

      expect(answer.sample[0]).toMatchObject({
        line: 2,
        characterName: 'Vex Loran',
        accountHandle: '@vexloran',
        level: 65,
        className: 'Starfleet Tactical Officer',
        contributionTotal: 5000,
        joinedAt: {
          resolution: RosterDateResolution.EXACT,
          local: '2023-04-01T12:00:00',
          candidates: ['2023-04-01T11:00:00.000Z'],
        },
        rankChangedAt: {
          resolution: RosterDateResolution.ABSENT,
          local: null,
          candidates: [],
        },
      });
    });

    it('hashes the bytes it was sent', async () => {
      const answer = await preview(exportFile(line()));

      expect(answer.source.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    });

    // Enough to see that a timezone is right, few enough that nobody reads
    // the screen as a roster.
    it('bounds the sample however long the export is', async () => {
      const rows = Array.from({ length: 30 }, (_value, index) =>
        line({ character: `Member ${index}`, handle: `@member${index}` }),
      );

      const answer = await preview(exportFile(...rows));

      expect(answer.readableRowCount).toBe(30);
      expect(answer.sample).toHaveLength(ROSTER_PREVIEW_SAMPLE_ROWS);
    });

    it('reports a Class it could read no profession from', async () => {
      const answer = await preview(
        exportFile(line({ className: "B'rel Bird-of-Prey" })),
      );

      expect(answer).toMatchObject({ canImport: true, unknownClassCount: 1 });
      expect(answer.sample[0]).toMatchObject({
        className: "B'rel Bird-of-Prey",
        profession: null,
      });
    });

    it('keeps none of the bytes it was handed', async () => {
      const source = exportFile(line());

      await preview(source);

      expect(source.every(byte => byte === 0)).toBe(true);
    });
  });

  describe('an export that could not', () => {
    it('reports a filename belonging to another Fleet', async () => {
      const answer = await preview(exportFile(line()), {
        fleetName: 'Some Other Fleet',
      });

      expect(answer).toMatchObject({
        canImport: false,
        filename: {
          rejection: RosterFilenameRejectionCode.FLEET_NAME_MISMATCH,
        },
      });
    });

    // Nobody's mistake. The file is fine and the question is still open, so
    // both readings come back and neither is chosen.
    it('reports both readings of a stamp the clock went back over', async () => {
      const answer = await preview(exportFile(line()), {
        originalFilename: `${FLEET_NAME}_20261025-013000.Csv`,
      });

      expect(answer).toMatchObject({
        canImport: false,
        filename: {
          rejection: null,
          exportedAt: null,
          exportedAtCandidates: [
            '2026-10-25T00:30:00.000Z',
            '2026-10-25T01:30:00.000Z',
          ],
        },
      });
    });

    it('lists every row problem rather than the first', async () => {
      const answer = await preview(
        exportFile(
          line({ joinDate: 'whenever' }),
          line({ character: 'Other', handle: '@other', level: 'sixty' }),
        ),
      );

      expect(answer.canImport).toBe(false);
      expect(answer.problems).toEqual([
        {
          code: RosterRowRejectionCode.DATE_MALFORMED,
          line: 2,
          column: 'Join Date',
        },
        {
          code: RosterRowRejectionCode.LEVEL_MALFORMED,
          line: 3,
          column: 'Level',
        },
      ]);
      expect(answer.sample).toEqual([]);
    });

    it('counts the rows whose dates stay ambiguous', async () => {
      const answer = await preview(
        exportFile(line({ joinDate: '10/25/2026 1:30:00am' })),
      );

      expect(answer).toMatchObject({
        canImport: true,
        ambiguousDateCount: 1,
      });
    });
  });

  describe('bytes that are not a roster export at all', () => {
    it('refuses a header the game does not write', async () => {
      const source = Buffer.from('Name,Handle\nVex,@vex\n', 'utf8');

      await expect(preview(source)).rejects.toMatchObject({
        response: { code: 'HEADER_UNRECOGNISED', line: 1 },
      });
    });

    it('refuses a filename that cannot be recorded as it stands', async () => {
      await expect(
        preview(exportFile(line()), {
          originalFilename: 'Fleet_20240101-120000\n.Csv',
        }),
      ).rejects.toMatchObject({
        response: { code: 'FILENAME_UNUSABLE' },
      });
    });

    it('answers a refusal with no part of the file', async () => {
      const source = Buffer.from('Name,Handle\nVex,@vex\n', 'utf8');

      await expect(preview(source)).rejects.toBeInstanceOf(BadRequestException);
      expect(source.every(byte => byte === 0)).toBe(true);
    });

    // A fault in this application is not a complaint about somebody's file
    // and must not be reported to them as one.
    it('lets a fault of its own through untouched', async () => {
      jest.spyOn(parser, 'sanitise').mockImplementation(() => {
        throw new TypeError('something of ours broke');
      });

      await expect(preview(exportFile(line()))).rejects.toBeInstanceOf(
        TypeError,
      );
    });
  });
});
