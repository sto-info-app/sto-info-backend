import { RosterProjectionInputOutcome } from '../enums/roster-projection-input-outcome.enum';
import {
  classifyRosterInputs,
  RosterInputCandidate,
} from './roster-input-classifier';

const {
  EFFECTIVE,
  EXCLUDED,
  NOT_SELECTED,
  AWAITING_SELECTION,
  SAME_AS_EFFECTIVE,
} = RosterProjectionInputOutcome;

const candidate = (
  id: string,
  overrides: Partial<RosterInputCandidate> = {},
): RosterInputCandidate => ({
  id,
  exportedAt: new Date('2024-11-01T12:00:00Z'),
  uploadedAt: new Date(`2024-11-02T0${id.slice(-1)}:00:00Z`),
  sanitisedSha256: 'a'.repeat(64),
  inForce: true,
  excluded: false,
  partial: false,
  excludedRows: 0,
  conflictGroupId: null,
  ...overrides,
});

const outcomes = (
  candidates: RosterInputCandidate[],
  selections: Record<string, string | null> = {},
): Array<[string, RosterProjectionInputOutcome]> =>
  classifyRosterInputs(candidates, new Map(Object.entries(selections))).map(
    each => [each.id, each.outcome],
  );

describe('classifyRosterInputs', () => {
  it('reads each moment once, in export order', () => {
    const later = candidate('i1', {
      exportedAt: new Date('2024-11-15T12:00:00Z'),
    });
    const earlier = candidate('i2');

    expect(outcomes([later, earlier])).toEqual([
      ['i2', EFFECTIVE],
      ['i1', EFFECTIVE],
    ]);
  });

  // Two uploads of one file cannot share an instant, but nothing stops two
  // different files arriving in the same millisecond, and the order has to
  // be the same every time the Fleet is replayed.
  it('orders imports uploaded at the same moment by identifier', () => {
    const uploadedAt = new Date('2024-11-02T09:00:00Z');

    expect(
      outcomes([
        candidate('i9', { uploadedAt }),
        candidate('i3', { uploadedAt }),
        candidate('i5', { uploadedAt }),
      ]),
    ).toEqual([
      ['i3', EFFECTIVE],
      ['i5', SAME_AS_EFFECTIVE],
      ['i9', SAME_AS_EFFECTIVE],
    ]);
  });

  it('keeps what the classifier was given beside the outcome', () => {
    const [classified] = classifyRosterInputs(
      [candidate('i1', { partial: true, excludedRows: 3 })],
      new Map(),
    );

    expect(classified).toEqual(
      expect.objectContaining({ id: 'i1', partial: true, excludedRows: 3 }),
    );
  });

  describe('with no selection', () => {
    it('reads the first upload of a moment, and calls a later copy the same', () => {
      expect(outcomes([candidate('i2'), candidate('i1')])).toEqual([
        ['i1', EFFECTIVE],
        ['i2', SAME_AS_EFFECTIVE],
      ]);
    });

    it('reads the next copy in force when the first is excluded', () => {
      expect(
        outcomes([candidate('i1', { excluded: true }), candidate('i2')]),
      ).toEqual([
        ['i1', EXCLUDED],
        ['i2', EFFECTIVE],
      ]);
    });

    it('leaves a held rival waiting while the first version stands', () => {
      expect(
        outcomes([
          candidate('i1', { conflictGroupId: 'g' }),
          candidate('i2', {
            conflictGroupId: 'g',
            inForce: false,
            sanitisedSha256: 'b'.repeat(64),
          }),
        ]),
      ).toEqual([
        ['i1', EFFECTIVE],
        ['i2', AWAITING_SELECTION],
      ]);
    });

    it('reads nothing of a moment whose only import in force is excluded', () => {
      expect(
        outcomes([
          candidate('i1', { conflictGroupId: 'g', excluded: true }),
          candidate('i2', {
            conflictGroupId: 'g',
            inForce: false,
            sanitisedSha256: 'b'.repeat(64),
          }),
        ]),
      ).toEqual([
        ['i1', EXCLUDED],
        ['i2', AWAITING_SELECTION],
      ]);
    });

    it('reports a rival somehow in force as waiting rather than dropping it', () => {
      expect(
        outcomes([
          candidate('i1'),
          candidate('i2', { sanitisedSha256: 'b'.repeat(64) }),
        ]),
      ).toEqual([
        ['i1', EFFECTIVE],
        ['i2', AWAITING_SELECTION],
      ]);
    });
  });

  describe('with a selection', () => {
    const rivals = (): RosterInputCandidate[] => [
      candidate('i1', { conflictGroupId: 'g' }),
      candidate('i2', {
        conflictGroupId: 'g',
        sanitisedSha256: 'b'.repeat(64),
      }),
      candidate('i3', { conflictGroupId: 'g' }),
    ];

    it('reads the selected export, and calls its copies the same', () => {
      expect(outcomes(rivals(), { g: 'i1' })).toEqual([
        ['i1', EFFECTIVE],
        ['i2', NOT_SELECTED],
        ['i3', SAME_AS_EFFECTIVE],
      ]);
    });

    it('reads a later upload when that is the one selected', () => {
      expect(outcomes(rivals(), { g: 'i2' })).toEqual([
        ['i1', NOT_SELECTED],
        ['i2', EFFECTIVE],
        ['i3', NOT_SELECTED],
      ]);
    });

    it('reads nothing of the moment once the selected export is excluded', () => {
      const [first, second, third] = rivals();

      expect(
        outcomes([first, { ...second, excluded: true }, third], { g: 'i2' }),
      ).toEqual([
        ['i1', NOT_SELECTED],
        ['i2', EXCLUDED],
        ['i3', NOT_SELECTED],
      ]);
    });

    it('leaves a selected export that is not yet in force waiting', () => {
      const [first, second] = rivals();

      expect(
        outcomes([first, { ...second, inForce: false }], { g: 'i2' }),
      ).toEqual([
        ['i1', NOT_SELECTED],
        ['i2', AWAITING_SELECTION],
      ]);
    });

    it('treats a group nobody has selected in as having no selection', () => {
      expect(outcomes(rivals(), { g: null })).toEqual([
        ['i1', EFFECTIVE],
        ['i2', AWAITING_SELECTION],
        ['i3', SAME_AS_EFFECTIVE],
      ]);
    });
  });
});
