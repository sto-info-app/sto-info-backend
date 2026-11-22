import { ContactRequestEntity } from 'src/contact/entities/contact-request.entity';
import { AUDITED_BY_IDENTIFIERS_ONLY } from 'src/database/migrations/1796500000000-AddPrivacyErasure';
import { ChatMessageReportEntity } from 'src/fleet/chat/entities/chat-message-report.entity';
import { ChatMessageEntity } from 'src/fleet/chat/entities/chat-message.entity';
import { ChatReportEvidenceEntity } from 'src/fleet/chat/entities/chat-report-evidence.entity';
import { ChatTranscriptEntity } from 'src/fleet/chat/entities/chat-transcript.entity';
import { RosterErasureEntity } from 'src/fleet/erasure/roster-erasure.entity';
import { RosterIdentityAliasEntity } from 'src/fleet/identity/entities/roster-identity-alias.entity';
import { RosterObservationEntity } from 'src/fleet/imports/entities/roster-observation.entity';
import { FleetApplicationEntity } from 'src/fleet/recruitment/entities/fleet-application.entity';
import { UserReportEntity } from 'src/moderation/entities/user-report.entity';
import { NewsPostEntity } from 'src/news/entities/news-post.entity';

import {
  AUDIT_REDACTED,
  auditedByIdentifiersOnly,
  AuditIdentifiersOnly,
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

  // FC-038: chat, roster, news and form content keeps its identifiers alone.
  describe('identifiers only', () => {
    @AuditIdentifiersOnly()
    class WrittenEntity {
      id: string;
      authorUserId: string;
      body: string;
    }

    it('keeps the ID and every …Id, and nothing a person wrote', () => {
      const canary = 'TELEMETRY-CANARY';

      expect(
        redactForAudit(WrittenEntity, {
          id: 'm1',
          authorUserId: 'u1',
          body: canary,
          characterName: canary,
        }),
      ).toEqual({ id: 'm1', authorUserId: 'u1' });
    });

    it('marks exactly the entities whose earlier trail the migration scrubs', () => {
      // Each import registers its entity's marking.
      expect([
        ChatMessageEntity,
        ChatMessageReportEntity,
        ChatReportEvidenceEntity,
        ChatTranscriptEntity,
        ContactRequestEntity,
        FleetApplicationEntity,
        NewsPostEntity,
        RosterErasureEntity,
        RosterIdentityAliasEntity,
        RosterObservationEntity,
        UserReportEntity,
      ]).toHaveLength(AUDITED_BY_IDENTIFIERS_ONLY.length);
      expect(
        auditedByIdentifiersOnly()
          .filter(name => name !== 'WrittenEntity')
          .sort(),
      ).toEqual([...AUDITED_BY_IDENTIFIERS_ONLY].sort());
    });
  });
});
