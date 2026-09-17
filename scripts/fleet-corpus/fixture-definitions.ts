/**
 * Synthetic STO roster CSV fixtures for the Fleet Community importer.
 *
 * Every value here is invented. No Character name, account handle, public
 * comment, officer note or Fleet name is copied from the real corpus. The real
 * archive is read only to verify structural facts (see corpus-facts.ts); it is
 * never a source of fixture content, so these files are safe to commit.
 *
 * What IS reproduced from the corpus is structure: the two header shapes, the
 * unquoted officer author, omitted officer tails, embedded quotes and commas,
 * duplicate identities, the paired-export timezone behaviour, contribution
 * resets and rename candidates.
 *
 * Officer fields carry a deliberate canary token. Tests assert that
 * OFFICER_CANARY_PREFIX never appears in any DTO, persisted row, queue payload,
 * log line, exception, trace or export (plan section 11.1).
 */

/** Any occurrence of this outside a fixture file is a privacy failure. */
export const OFFICER_CANARY_PREFIX = 'OFFICER-CANARY';

const NORMAL_HEADER =
  'Character Name,Account Handle,Level,Class,Guild Rank,' +
  'Contribution Total,Join Date,Rank Change Date,Last Active Date,' +
  'Status,Public Comment,Public Comment Last Edit Date';

const OFFICER_HEADER =
  NORMAL_HEADER +
  ',Officer Comment,Officer Comment Author,Officer Comment Last Edit Date';

/** Real game data, not personal data. */
const CLASSES = {
  fedTac: 'Starfleet Tactical Officer',
  fedEng: 'Starfleet Engineering Officer',
  fedSci: 'Starfleet Science Officer',
  kdfEng: 'KDF Engineering Officer',
  rrfTac: 'RRF Tactical Officer',
  /** The two anomalous corpus values are a ship name, not a profession. */
  anomalous: "B'rel Bird-of-Prey",
} as const;

interface RowInput {
  character: string;
  handle: string;
  level: number;
  class: string;
  rank: string;
  contribution: string;
  joinDate: string;
  rankChangeDate: string;
  lastActiveDate: string;
  status: string;
  publicComment: string;
  publicCommentEditedAt: string;
  officer?: { comment: string; author: string; editedAt: string };
}

function row(input: RowInput): string {
  const base = [
    input.character,
    input.handle,
    String(input.level),
    input.class,
    input.rank,
    input.contribution,
    input.joinDate,
    input.rankChangeDate,
    input.lastActiveDate,
    `"${input.status}"`,
    `"${input.publicComment}"`,
    input.publicCommentEditedAt,
  ].join(',');

  if (!input.officer) {
    return base;
  }
  // The officer comment is quoted; the author and its date are NOT. This
  // asymmetry is exactly what the real exports do.
  return [
    base,
    `"${input.officer.comment}"`,
    input.officer.author,
    input.officer.editedAt,
  ].join(',');
}

function officer(index: number, editedAt: string) {
  return {
    comment: `${OFFICER_CANARY_PREFIX}-${String(index).padStart(2, '0')}`,
    author: `${OFFICER_CANARY_PREFIX}-AUTHOR-${String(index).padStart(2, '0')}`,
    editedAt,
  };
}

export interface Fixture {
  /** Exact filename, including the STO timestamp suffix. */
  filename: string;
  /** Why this fixture exists and what a parser must do with it. */
  purpose: string;
  /** `accept` means every row parses; `reject` means the import must fail. */
  expectation: 'accept' | 'reject';
  /** Prepend a UTF-8 BOM. */
  bom?: boolean;
  content: string;
}

function file(header: string, rows: string[]): string {
  return [header, ...rows].join('\r\n') + '\r\n';
}

// --------------------------------------------------------------------------
// Accepted shapes
// --------------------------------------------------------------------------

const basic: Fixture = {
  filename: 'Fixture Basic Fleet_20240101-120000.Csv',
  purpose:
    'The 12-column normal header with unremarkable rows. Baseline happy path.',
  expectation: 'accept',
  content: file(NORMAL_HEADER, [
    row({
      character: 'Aria Venn',
      handle: '@fixture001',
      level: 65,
      class: CLASSES.fedTac,
      rank: 'Member',
      contribution: '120500',
      joinDate: '3/4/2023 8:15:00pm',
      rankChangeDate: '6/1/2023 9:00:00am',
      lastActiveDate: '1/1/2024 11:45:00am',
      status: 'Offline',
      publicComment: 'Happy to run TFOs at weekends',
      publicCommentEditedAt: '5/2/2023 7:30:00pm',
    }),
    row({
      character: 'Dax Orlan',
      handle: '@fixture002',
      level: 50,
      class: CLASSES.fedEng,
      rank: 'Recruit',
      contribution: '0',
      joinDate: '12/20/2023 2:05:00am',
      rankChangeDate: '',
      lastActiveDate: '12/31/2023 10:00:00pm',
      status: 'Offline',
      publicComment: '',
      publicCommentEditedAt: '',
    }),
  ]),
};

const officerAllTails: Fixture = {
  filename: 'Fixture Officer Fleet_20240102-120000.Csv',
  purpose:
    'The 15-column officer header where every row carries the officer tail. ' +
    'The officer author and its date are unquoted.',
  expectation: 'accept',
  content: file(OFFICER_HEADER, [
    row({
      character: 'Kell Marr',
      handle: '@fixture003',
      level: 65,
      class: CLASSES.kdfEng,
      rank: 'Officer',
      contribution: '4412077',
      joinDate: '1/9/2022 6:20:00pm',
      rankChangeDate: '4/4/2023 1:00:00pm',
      lastActiveDate: '1/2/2024 8:00:00am',
      status: 'Offline',
      publicComment: 'Engineering main',
      publicCommentEditedAt: '2/2/2023 3:00:00pm',
      officer: officer(1, '3/3/2023 4:00:00pm'),
    }),
    row({
      character: 'Tova Reen',
      handle: '@fixture004',
      level: 65,
      class: CLASSES.fedSci,
      rank: 'Member',
      contribution: '98000',
      joinDate: '7/7/2022 9:00:00am',
      rankChangeDate: '7/7/2022 9:00:00am',
      lastActiveDate: '1/2/2024 9:30:00am',
      status: 'Offline',
      publicComment: '',
      publicCommentEditedAt: '',
      officer: officer(2, ''),
    }),
  ]),
};

const officerOmittedTails: Fixture = {
  filename: 'Fixture Officer Fleet_20240103-120000.Csv',
  purpose:
    'A 15-column officer header where only some rows carry the officer tail. ' +
    'Omitted tails are a legitimate observed variant and must not shift ' +
    'columns or reject the file.',
  expectation: 'accept',
  content: file(OFFICER_HEADER, [
    row({
      character: 'Kell Marr',
      handle: '@fixture003',
      level: 65,
      class: CLASSES.kdfEng,
      rank: 'Officer',
      contribution: '4482777',
      joinDate: '1/9/2022 6:20:00pm',
      rankChangeDate: '4/4/2023 1:00:00pm',
      lastActiveDate: '1/3/2024 8:00:00am',
      status: 'Offline',
      publicComment: 'Engineering main',
      publicCommentEditedAt: '2/2/2023 3:00:00pm',
      officer: officer(3, '3/3/2023 4:00:00pm'),
    }),
    // No officer tail at all under a 15-column header.
    row({
      character: 'Tova Reen',
      handle: '@fixture004',
      level: 65,
      class: CLASSES.fedSci,
      rank: 'Member',
      contribution: '99500',
      joinDate: '7/7/2022 9:00:00am',
      rankChangeDate: '7/7/2022 9:00:00am',
      lastActiveDate: '1/3/2024 9:30:00am',
      status: 'Offline',
      publicComment: '',
      publicCommentEditedAt: '',
    }),
    row({
      character: 'Suri Kade',
      handle: '@fixture005',
      level: 61,
      class: CLASSES.rrfTac,
      rank: 'Cadet',
      contribution: '3100',
      joinDate: '11/2/2023 5:00:00pm',
      rankChangeDate: '',
      lastActiveDate: '1/3/2024 6:15:00pm',
      status: 'Offline',
      publicComment: '',
      publicCommentEditedAt: '',
    }),
  ]),
};

const quoting: Fixture = {
  filename: 'Fixture Quoting Fleet_20240104-120000.Csv',
  purpose:
    'Embedded quotes and commas in Public Comment and Status, matching the ' +
    'corpus shapes that defeat both strict and permissive CSV parsing.',
  expectation: 'accept',
  content: file(OFFICER_HEADER, [
    row({
      character: 'Renn Calo',
      handle: '@fixture006',
      level: 65,
      class: CLASSES.fedTac,
      rank: 'Member',
      contribution: '77000',
      joinDate: '2/14/2023 4:00:00pm',
      rankChangeDate: '',
      lastActiveDate: '1/4/2024 7:00:00am',
      status: 'Offline',
      // Literal quotes, not doubled. This is what the exports emit.
      publicComment: 'Call me "Renn", not Renner',
      publicCommentEditedAt: '3/1/2023 1:00:00pm',
      officer: officer(4, '3/2/2023 2:00:00pm'),
    }),
    row({
      character: 'Mira Solen',
      handle: '@fixture007',
      level: 65,
      class: CLASSES.fedEng,
      rank: 'Officer',
      contribution: '250000',
      joinDate: '5/5/2021 10:00:00am',
      rankChangeDate: '1/1/2023 10:00:00am',
      lastActiveDate: '1/4/2024 8:00:00am',
      // A comma inside Status: only four such rows exist in the corpus.
      status: 'Away, back Monday',
      publicComment: 'Runs Tuesday, Thursday and Sunday events',
      publicCommentEditedAt: '',
      officer: officer(5, ''),
    }),
    row({
      character: 'Jek Toran',
      handle: '@fixture008',
      level: 65,
      class: CLASSES.anomalous,
      rank: 'Member',
      contribution: '15',
      joinDate: '8/8/2023 8:08:08am',
      rankChangeDate: '',
      lastActiveDate: '1/4/2024 9:00:00am',
      // A quote inside Status: ten such rows exist in the corpus.
      status: 'Flying the "old girl"',
      publicComment: 'Class value is a ship name, not a profession',
      publicCommentEditedAt: '',
    }),
  ]),
};

const duplicateIdentity: Fixture = {
  filename: 'Fixture Duplicate Fleet_20240105-120000.Csv',
  purpose:
    'The same Character name and account handle appears twice in one export. ' +
    'The snapshot must not become effective and must not be map-overwritten.',
  expectation: 'reject',
  content: file(NORMAL_HEADER, [
    row({
      character: 'Vex Loran',
      handle: '@fixture009',
      level: 65,
      class: CLASSES.fedTac,
      rank: 'Member',
      contribution: '5000',
      joinDate: '4/1/2023 12:00:00pm',
      rankChangeDate: '',
      lastActiveDate: '1/5/2024 1:00:00pm',
      status: 'Offline',
      publicComment: '',
      publicCommentEditedAt: '',
    }),
    row({
      character: 'Nira Vosk',
      handle: '@fixture010',
      level: 65,
      class: CLASSES.fedSci,
      rank: 'Member',
      contribution: '6000',
      joinDate: '4/2/2023 12:00:00pm',
      rankChangeDate: '',
      lastActiveDate: '1/5/2024 2:00:00pm',
      status: 'Offline',
      publicComment: '',
      publicCommentEditedAt: '',
    }),
    // Exact duplicate identity key, different contribution.
    row({
      character: 'Vex Loran',
      handle: '@fixture009',
      level: 65,
      class: CLASSES.fedTac,
      rank: 'Member',
      contribution: '5200',
      joinDate: '4/1/2023 12:00:00pm',
      rankChangeDate: '',
      lastActiveDate: '1/5/2024 3:00:00pm',
      status: 'Offline',
      publicComment: '',
      publicCommentEditedAt: '',
    }),
  ]),
};

// --------------------------------------------------------------------------
// Paired export: America/New_York and Europe/London, four seconds apart.
// Every populated row date resolves to the SAME instant in both files.
// Raw wall-clock differences are five hours for the winter and summer dates
// and four hours for the two dates that fall in the US/UK DST offset gap.
// --------------------------------------------------------------------------

const TZ_ROWS = [
  {
    character: 'Orin Base',
    handle: '@fixture011',
    // 2021-12-15T20:00:00Z -- both zones on standard time: five hours apart.
    eastern: '12/15/2021 3:00:00pm',
    uk: '12/15/2021 8:00:00pm',
  },
  {
    character: 'Sela Quorin',
    handle: '@fixture012',
    // 2022-07-15T20:00:00Z -- both zones on summer time: five hours apart.
    eastern: '7/15/2022 4:00:00pm',
    uk: '7/15/2022 9:00:00pm',
  },
  {
    character: 'Brekk Tal',
    handle: '@fixture013',
    // 2022-03-20T20:00:00Z -- US on EDT, UK still on GMT: FOUR hours apart.
    eastern: '3/20/2022 4:00:00pm',
    uk: '3/20/2022 8:00:00pm',
  },
  {
    character: 'Lera Vann',
    handle: '@fixture014',
    // 2021-10-31T20:00:00Z -- UK back on GMT, US still on EDT: FOUR hours.
    eastern: '10/31/2021 4:00:00pm',
    uk: '10/31/2021 8:00:00pm',
  },
];

function timezoneFixture(which: 'eastern' | 'uk'): Fixture {
  const rows = TZ_ROWS.map((entry, index) =>
    row({
      character: entry.character,
      handle: entry.handle,
      level: 65,
      class: CLASSES.fedTac,
      rank: 'Member',
      contribution: String(1000 * (index + 1)),
      joinDate: entry[which],
      rankChangeDate: entry[which],
      lastActiveDate: entry[which],
      status: 'Offline',
      publicComment: '',
      publicCommentEditedAt: '',
    }),
  );

  const isEastern = which === 'eastern';
  return {
    // The filename stamp is the exporter's own local clock. Both name the same
    // instant: 2026-08-24T05:13:38Z and 2026-08-24T05:13:42Z.
    filename: isEastern
      ? 'Fixture Timezone Fleet_20260824-011338.Csv'
      : 'Fixture Timezone Fleet_20260824-061342.Csv',
    purpose: isEastern
      ? 'Paired export taken in America/New_York. Filename stamp 01:13:38 ' +
        'local resolves to 2026-08-24T05:13:38Z.'
      : 'Paired export taken in Europe/London four seconds later. Filename ' +
        'stamp 06:13:42 local resolves to 2026-08-24T05:13:42Z. Every row ' +
        'date must normalise to the same instant as its Eastern counterpart.',
    expectation: 'accept',
    content: file(NORMAL_HEADER, rows),
  };
}

// --------------------------------------------------------------------------
// Longitudinal anomalies
// --------------------------------------------------------------------------

const resetBefore: Fixture = {
  filename: 'Fixture Reset Fleet_20220328-035909.Csv',
  purpose:
    'Earlier snapshot of a contribution reset pair. Cumulative total is high.',
  expectation: 'accept',
  content: file(NORMAL_HEADER, [
    row({
      character: 'Halen Дрозд',
      handle: '@fixture015',
      level: 65,
      class: CLASSES.fedEng,
      rank: 'Officer',
      contribution: '1061699',
      joinDate: '11/3/2021 1:00:00am',
      rankChangeDate: '1/5/2022 4:00:00pm',
      lastActiveDate: '3/27/2022 9:00:00pm',
      status: 'Offline',
      publicComment: 'Non-ASCII name is intentional',
      publicCommentEditedAt: '',
    }),
  ]),
};

const resetAfter: Fixture = {
  filename: 'Fixture Reset Fleet_20220426-230735.Csv',
  purpose:
    'Later snapshot where the cumulative total drops to zero AND the join ' +
    'date changes. This is a rejoin discontinuity, never a negative donation.',
  expectation: 'accept',
  content: file(NORMAL_HEADER, [
    row({
      character: 'Halen Дрозд',
      handle: '@fixture015',
      level: 65,
      class: CLASSES.fedEng,
      rank: 'Recruit',
      contribution: '0',
      // Changed join date: a new membership episode.
      joinDate: '4/20/2022 6:00:00pm',
      rankChangeDate: '4/20/2022 6:00:00pm',
      lastActiveDate: '4/26/2022 10:00:00pm',
      status: 'Offline',
      publicComment: 'Non-ASCII name is intentional',
      publicCommentEditedAt: '',
    }),
  ]),
};

const renameBefore: Fixture = {
  filename: 'Fixture Rename Fleet_20211221-034426.Csv',
  purpose:
    'Earlier snapshot of a Character rename candidate: same account handle, ' +
    'join date and Class; contribution differs, which does not disqualify it.',
  expectation: 'accept',
  content: file(NORMAL_HEADER, [
    row({
      character: 'Gorn Telak',
      handle: '@fixture016',
      level: 65,
      class: CLASSES.kdfEng,
      rank: 'Member',
      contribution: '44000',
      joinDate: '9/9/2021 7:00:00pm',
      rankChangeDate: '',
      lastActiveDate: '12/20/2021 11:00:00pm',
      status: 'Offline',
      publicComment: '',
      publicCommentEditedAt: '',
    }),
  ]),
};

const renameAfter: Fixture = {
  filename: 'Fixture Rename Fleet_20220112-014309.Csv',
  purpose:
    'Later snapshot where the Character name changed but handle, join date ' +
    'and Class did not. A unique two-way match, so a rename PROPOSAL only.',
  expectation: 'accept',
  content: file(NORMAL_HEADER, [
    row({
      character: 'Telak of Qamar',
      handle: '@fixture016',
      level: 65,
      class: CLASSES.kdfEng,
      rank: 'Member',
      contribution: '51500',
      joinDate: '9/9/2021 7:00:00pm',
      rankChangeDate: '',
      lastActiveDate: '1/11/2022 10:00:00pm',
      status: 'Offline',
      publicComment: '',
      publicCommentEditedAt: '',
    }),
  ]),
};

const accountRenameBefore: Fixture = {
  filename: 'Fixture Account Rename Fleet_20230604-021823.Csv',
  purpose:
    'Earlier snapshot of the account-rename shape: Character name, join date ' +
    'and Class are stable while the handle is about to change.',
  expectation: 'accept',
  content: file(NORMAL_HEADER, [
    row({
      character: 'Ilan Rho',
      handle: '@fixture017old',
      level: 65,
      class: CLASSES.fedSci,
      rank: 'Member',
      contribution: '9000',
      joinDate: '1/15/2023 3:00:00pm',
      rankChangeDate: '',
      lastActiveDate: '6/3/2023 8:00:00pm',
      status: 'Offline',
      publicComment: '',
      publicCommentEditedAt: '',
    }),
  ]),
};

const accountRenameAfter: Fixture = {
  filename: 'Fixture Account Rename Fleet_20230715-001404.Csv',
  purpose:
    'Later snapshot with a changed handle. A single corroborating alt is not ' +
    'enough to confirm; this must stay a proposal and must never rewrite an ' +
    'STO Info account handle.',
  expectation: 'accept',
  content: file(NORMAL_HEADER, [
    row({
      character: 'Ilan Rho',
      handle: '@fixture017new',
      level: 65,
      class: CLASSES.fedSci,
      rank: 'Member',
      contribution: '11200',
      joinDate: '1/15/2023 3:00:00pm',
      rankChangeDate: '',
      lastActiveDate: '7/14/2023 8:00:00pm',
      status: 'Offline',
      publicComment: '',
      publicCommentEditedAt: '',
    }),
  ]),
};

const withBom: Fixture = {
  filename: 'Fixture Bom Fleet_20240107-120000.Csv',
  purpose: 'A UTF-8 BOM prefix, which is explicitly allowed.',
  expectation: 'accept',
  bom: true,
  content: file(NORMAL_HEADER, [
    row({
      character: 'Poll Asher',
      handle: '@fixture018',
      level: 65,
      class: CLASSES.fedTac,
      rank: 'Member',
      contribution: '1',
      joinDate: '1/1/2024 1:00:00am',
      rankChangeDate: '',
      lastActiveDate: '1/7/2024 1:00:00am',
      status: 'Offline',
      publicComment: '',
      publicCommentEditedAt: '',
    }),
  ]),
};

// --------------------------------------------------------------------------
// Fleet name punctuation. Shapes copied from the corpus, names invented.
// --------------------------------------------------------------------------

function punctuationFixture(label: string, stamp: string): Fixture {
  return {
    filename: `${label}_${stamp}.Csv`,
    purpose:
      `Fleet label "${label}" exercises punctuation that must survive exactly ` +
      'and must not be stripped, case-folded or slug-matched.',
    expectation: 'accept',
    content: file(NORMAL_HEADER, [
      row({
        character: 'Edge Case',
        handle: '@fixture019',
        level: 65,
        class: CLASSES.fedTac,
        rank: 'Member',
        contribution: '100',
        joinDate: '1/1/2024 1:00:00am',
        rankChangeDate: '',
        lastActiveDate: '1/1/2024 2:00:00am',
        status: 'Offline',
        publicComment: '',
        publicCommentEditedAt: '',
      }),
    ]),
  };
}

// --------------------------------------------------------------------------
// Must be rejected
// --------------------------------------------------------------------------

const ambiguousTail: Fixture = {
  filename: 'Fixture Ambiguous Fleet_20240108-120000.Csv',
  purpose:
    'An ambiguous tail. Under the 15-column header this row matches BOTH the ' +
    'officer-tail shape and the 12-column shape, so the tail boundary is not ' +
    'unique. It must be rejected with a row number and a safe code, never ' +
    'resolved by guessing.',
  expectation: 'reject',
  content: file(OFFICER_HEADER, [
    // Reads either as (Status=A, Public="x", edited=, officer="y", author="", )
    // or as (Status=A, Public=`x",,"y","`, edited=). Both are anchored matches.
    'Ghost Row,@fixture020,65,Starfleet Tactical Officer,Member,0,' +
      '1/1/2024 1:00:00am,,1/1/2024 2:00:00am,"A","x",,"y","",',
  ]),
};

const unknownHeader: Fixture = {
  filename: 'Fixture Bad Header Fleet_20240110-120000.Csv',
  purpose:
    'Header is neither the normal nor the officer shape. Reject the file; do ' +
    'not fall back to permissive parsing.',
  expectation: 'reject',
  content: file('Name,Handle,Level,Notes', [
    'Who Knows,@fixture021,65,nothing',
  ]),
};

const suffixedFilename: Fixture = {
  filename: 'Fixture Suffixed Fleet_20240109-120000 - Steve Export.Csv',
  purpose:
    'A manually renamed export. The filename contract is anchored at both ' +
    'ends, so this is rejected. No suffix stripping is permitted.',
  expectation: 'reject',
  content: file(NORMAL_HEADER, [
    row({
      character: 'Renamed File',
      handle: '@fixture022',
      level: 65,
      class: CLASSES.fedTac,
      rank: 'Member',
      contribution: '0',
      joinDate: '1/1/2024 1:00:00am',
      rankChangeDate: '',
      lastActiveDate: '1/9/2024 1:00:00am',
      status: 'Offline',
      publicComment: '',
      publicCommentEditedAt: '',
    }),
  ]),
};

const nonexistentLocalTime: Fixture = {
  filename: 'Fixture Dst Gap Fleet_20240310-030000.Csv',
  purpose:
    'A row date that does not exist in America/New_York because the clock ' +
    'jumps 2am to 3am on 10 March 2024. Must be rejected explicitly, not ' +
    'silently shifted.',
  expectation: 'reject',
  content: file(NORMAL_HEADER, [
    row({
      character: 'Gap Walker',
      handle: '@fixture023',
      level: 65,
      class: CLASSES.fedTac,
      rank: 'Member',
      contribution: '0',
      joinDate: '3/10/2024 2:30:00am',
      rankChangeDate: '',
      lastActiveDate: '3/10/2024 4:00:00am',
      status: 'Offline',
      publicComment: '',
      publicCommentEditedAt: '',
    }),
  ]),
};

export const FIXTURES: Fixture[] = [
  basic,
  officerAllTails,
  officerOmittedTails,
  quoting,
  duplicateIdentity,
  timezoneFixture('eastern'),
  timezoneFixture('uk'),
  resetBefore,
  resetAfter,
  renameBefore,
  renameAfter,
  accountRenameBefore,
  accountRenameAfter,
  withBom,
  punctuationFixture('.Fixture Dotted Fleet.', '20240111-120000'),
  punctuationFixture('« Fixture Guillemet Fleet »', '20240112-120000'),
  punctuationFixture('- Fixture Hyphen Fleet -', '20240113-120000'),
  punctuationFixture("Fixture qa'Hom Fleet", '20240114-120000'),
  ambiguousTail,
  unknownHeader,
  suffixedFilename,
  nonexistentLocalTime,
];
