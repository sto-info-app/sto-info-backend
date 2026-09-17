import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { NotificationCategory } from '../enums/notification-category.enum';
import { PresenceVisibility } from '../enums/presence-visibility.enum';
import { UserEntity } from './user.entity';

/**
 * How one user has asked the application to behave for them.
 *
 * Separate from `user_profile` on purpose. A profile is what other people see;
 * a preference is nobody else's business, and `user_profile` is the entity
 * handed to public member and registry views. Keeping the two apart means a
 * query that widens its selection cannot accidentally publish somebody's
 * presence or notification choices.
 *
 * A row is created the first time a user's preferences are read or written, so
 * an account that has never opened the settings page has no row and gets the
 * defaults declared here.
 */
@Entity({ name: 'user_preference' })
export class UserPreferenceEntity {
  @ApiProperty({ description: 'The user these preferences belong to.' })
  @PrimaryColumn('uuid')
  userId: string;

  @ApiProperty({
    description: 'Whether private details are visually obscured in the app.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  privacyMode: boolean;

  @ApiProperty({
    description:
      'Sliding inactivity timeout for login sessions, in minutes. Null uses the deployment default.',
    nullable: true,
  })
  @Column({ type: 'integer', nullable: true, default: null })
  sessionTimeoutMinutes: number | null;

  /**
   * The timezone dates are rendered in, or null to follow the viewer's device.
   *
   * Null is the default and is a real answer rather than an absent one: most
   * people want times in the zone they are sitting in, and a stored value only
   * becomes worth having when somebody travels and wants their dates to stay
   * put.
   */
  @ApiProperty({
    description:
      "IANA timezone dates are displayed in. Null follows the viewer's device.",
    nullable: true,
    example: 'Europe/London',
  })
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  displayTimezone: string | null;

  /**
   * The timezone STO roster exports are read as, or null when never chosen.
   *
   * Deliberately not defaulted from {@link displayTimezone} or from the
   * browser. The game client's zone is a fact about the machine the export came
   * from, and guessing it wrong silently shifts every date in the file by
   * hours, so the first import asks and this records the answer for the next
   * one (R09).
   */
  @ApiProperty({
    description:
      'IANA timezone STO CSV exports are read as. Null until the user chooses one.',
    nullable: true,
    example: 'America/New_York',
  })
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  stoExportTimezone: string | null;

  @ApiProperty({
    enum: PresenceVisibility,
    description: 'Who may see that this user is online.',
  })
  @Column({
    type: 'enum',
    enum: PresenceVisibility,
    enumName: 'presence_visibility_enum',
    nullable: false,
    default: PresenceVisibility.FRIENDS,
  })
  presenceVisibility: PresenceVisibility;

  /**
   * Whether to suppress presence entirely, whatever the audience says.
   *
   * A switch rather than a fourth {@link PresenceVisibility} value so that
   * hiding for an afternoon does not overwrite the audience the user chose.
   */
  @ApiProperty({
    description: 'Suppresses presence for everyone while set.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  appearOffline: boolean;

  @ApiProperty({
    description: 'Whether to broadcast a typing indicator while composing.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  typingIndicatorsEnabled: boolean;

  @ApiProperty({ description: 'Notify when someone mentions this user.' })
  @Column({ type: 'boolean', nullable: false, default: true })
  notifyMention: boolean;

  @ApiProperty({ description: 'Notify when someone replies to this user.' })
  @Column({ type: 'boolean', nullable: false, default: true })
  notifyReply: boolean;

  @ApiProperty({ description: 'Notify on a direct message.' })
  @Column({ type: 'boolean', nullable: false, default: true })
  notifyDirectMessage: boolean;

  @ApiProperty({
    description: 'Notify when a roster row is proposed as this user.',
  })
  @Column({ type: 'boolean', nullable: false, default: true })
  notifyRosterAssociation: boolean;

  @ApiProperty({ description: 'Notify for subscribed event reminders.' })
  @Column({ type: 'boolean', nullable: false, default: true })
  notifyEventReminder: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToOne(() => UserEntity, user => user.preference, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;
}

/**
 * Which column each notification category is stored in.
 *
 * Exists so the delivery path can ask about a category without a switch
 * statement in every caller, and so adding a category is a compile error here
 * rather than a notification that is silently always sent.
 */
export const NOTIFICATION_CATEGORY_COLUMNS: Readonly<
  Record<NotificationCategory, keyof UserPreferenceEntity>
> = {
  [NotificationCategory.MENTION]: 'notifyMention',
  [NotificationCategory.REPLY]: 'notifyReply',
  [NotificationCategory.DIRECT_MESSAGE]: 'notifyDirectMessage',
  [NotificationCategory.ROSTER_ASSOCIATION]: 'notifyRosterAssociation',
  [NotificationCategory.EVENT_REMINDER]: 'notifyEventReminder',
};
