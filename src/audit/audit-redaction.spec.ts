import {
  AUDIT_REDACTED,
  redactForAudit,
  RedactFromAudit,
} from './audit-redaction';

class PlainEntity {
  id: string;
  name: string;
}

class NotedEntity {
  id: string;

  @RedactFromAudit()
  note: string;
}

class ManyNotesEntity {
  id: string;

  @RedactFromAudit()
  note: string;

  @RedactFromAudit()
  altText: string;
}

describe('redactForAudit', () => {
  it('passes through an entity that marks nothing', () => {
    const snapshot = { id: 'a', name: 'Ares' };

    expect(redactForAudit(PlainEntity, snapshot)).toBe(snapshot);
  });

  it('returns null when there is no snapshot', () => {
    expect(redactForAudit(NotedEntity, null)).toBeNull();
  });

  it('withholds a marked property', () => {
    expect(redactForAudit(NotedEntity, { id: 'a', note: 'private' })).toEqual({
      id: 'a',
      note: AUDIT_REDACTED,
    });
  });

  it('withholds every marked property', () => {
    expect(
      redactForAudit(ManyNotesEntity, {
        id: 'a',
        note: 'private',
        altText: 'also private',
      }),
    ).toEqual({
      id: 'a',
      note: AUDIT_REDACTED,
      altText: AUDIT_REDACTED,
    });
  });

  // A property the snapshot never carried is left absent rather than being
  // introduced as a redaction, so the trail does not imply a value existed.
  it('does not add a marked property the snapshot lacks', () => {
    expect(redactForAudit(NotedEntity, { id: 'a' })).toEqual({ id: 'a' });
  });

  // The snapshot belongs to the transaction in progress. Blanking it in place
  // would blank it for whatever is about to be saved.
  it('leaves the snapshot it was given untouched', () => {
    const snapshot = { id: 'a', note: 'private' };

    redactForAudit(NotedEntity, snapshot);

    expect(snapshot.note).toBe('private');
  });

  it('keeps each entity’s markings to itself', () => {
    expect(redactForAudit(PlainEntity, { id: 'a', note: 'private' })).toEqual({
      id: 'a',
      note: 'private',
    });
  });
});
