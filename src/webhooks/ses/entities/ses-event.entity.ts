import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type SesEventType = 'Bounce' | 'Complaint' | 'Delivery';
export type SesBounceType = 'Permanent' | 'Transient' | 'Undetermined';
export type SesBounceSubType =
  | 'General'
  | 'NoEmail'
  | 'Suppressed'
  | 'MailboxFull'
  | 'MessageTooLarge'
  | 'ContentRejected'
  | 'AttachmentRejected'
  | 'OnAccountSuppressionList'
  | 'Rejected'
  | 'Undetermined';

/**
 * Stores SES bounce, complaint, and delivery notifications received via SNS webhooks.
 *
 * @remarks
 * Email addresses are stored as HMAC-SHA256 hashes to protect PII.
 * The `SES_EMAIL_HMAC_SECRET` environment variable is used as the HMAC key,
 * making it computationally infeasible to reverse-lookup an address without knowing
 * the key, even if the database is compromised.
 *
 * Suppression checks are performed by hashing the candidate address and comparing
 * it against stored hashes — no plaintext email is ever persisted.
 *
 * Table name is prefixed with `_audit_` to group it with other audit/event tables
 * (`_audit`, `_audit_login_attempt`).
 */
@Entity({ name: '_audit_ses_event' })
export class SesEventEntity {
  /** Auto-generated UUID primary key. */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The SES notification type: Bounce, Complaint, or Delivery. */
  @Column({ type: 'varchar', length: 20, nullable: false })
  eventType: SesEventType;

  /**
   * HMAC-SHA256 hash of the lowercased recipient email address.
   * Used for suppression lookups without exposing PII in the database.
   */
  @Column({ type: 'varchar', length: 64, nullable: false })
  emailHashed: string;

  /**
   * For Bounce events: `'Permanent' | 'Transient' | 'Undetermined'`.
   * `null` for Complaint and Delivery events.
   */
  @Column({ type: 'varchar', length: 20, nullable: true, default: null })
  bounceType: SesBounceType | null;

  /**
   * For Bounce events: the bounce sub-classification (e.g. `'General'`, `'MailboxFull'`).
   * `null` for Complaint and Delivery events.
   */
  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  bounceSubType: SesBounceSubType | null;

  /**
   * For Complaint events: the ISP feedback type (e.g. `'abuse'`, `'fraud'`).
   * `null` for Bounce and Delivery events.
   */
  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  complaintFeedbackType: string | null;

  /** The SES message ID from the originating send (used for correlation). */
  @Column({ type: 'varchar', length: 200, nullable: true, default: null })
  sesMessageId: string | null;

  /**
   * The raw SNS message ID.
   * Used as a unique constraint to prevent duplicate processing of the same
   * SNS delivery (SNS guarantees at-least-once delivery).
   */
  @Column({ type: 'varchar', length: 200, nullable: false, unique: true })
  snsMessageId: string;

  /**
   * Whether future emails to this address should be suppressed.
   * `true` for Permanent bounces and all Complaints.
   * `false` for Transient/Undetermined bounces and Delivery events.
   */
  @Column({ type: 'boolean', nullable: false, default: false })
  suppress: boolean;

  /**
   * For Reject events: the reason provided by SES (e.g. 'Bad address', 'Suppressed').
   * `null` for most other events.
   */
  @Column({ type: 'text', nullable: true, default: null })
  reason: string | null;

  /** Timestamp when this event was recorded in the database. */
  @CreateDateColumn()
  createdAt: Date;
}
