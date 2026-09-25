import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** The longest reason an edit to a rank order may give. */
export const ROSTER_RANK_ORDER_REASON_MAX_LENGTH = 500;

/** The most labels one Fleet's order may place. */
export const ROSTER_RANK_ORDER_MAX_LABELS = 255;

/** The longest a rank label is, as the observation column holds it. */
const LABEL_MAX_LENGTH = 255;

/**
 * An order: a list of tiers, each a non-empty list of labels, with no label
 * in two places.
 *
 * One check rather than several, so each way an order can be wrong is told
 * one thing.
 */
@ValidatorConstraint({ name: 'isRosterRankTiers' })
export class IsRosterRankTiers implements ValidatorConstraintInterface {
  /**
   * Whether a value is an order.
   *
   * @param value - The value.
   * @returns True if it is.
   */
  validate(value: unknown): boolean {
    return problemWith(value) === null;
  }

  /**
   * What is wrong with a value that is not an order.
   *
   * @param args - The value that failed.
   * @returns The message.
   */
  defaultMessage(args: ValidationArguments): string {
    return `${args.property}: ${problemWith(args.value) as string}`;
  }
}

/**
 * Finds what is wrong with an order, if anything.
 *
 * @param value - The value.
 * @returns The problem, or null when there is none.
 */
function problemWith(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return 'an order is a list of tiers.';
  }

  const seen = new Set<string>();

  for (const tier of value as unknown[]) {
    if (!Array.isArray(tier) || tier.length === 0) {
      return 'each tier is a list of one or more rank labels.';
    }

    for (const label of tier as unknown[]) {
      if (
        typeof label !== 'string' ||
        label.length === 0 ||
        label.length > LABEL_MAX_LENGTH
      ) {
        return `each rank label is text of 1 to ${LABEL_MAX_LENGTH} characters.`;
      }

      if (seen.has(label)) {
        return `"${label}" is placed more than once.`;
      }

      seen.add(label);
    }
  }

  return seen.size > ROSTER_RANK_ORDER_MAX_LABELS
    ? `an order places at most ${ROSTER_RANK_ORDER_MAX_LABELS} labels.`
    : null;
}

/**
 * A reason: text, not blank once trimmed, and not too long.
 */
@ValidatorConstraint({ name: 'isRosterRankOrderReason' })
export class IsRosterRankOrderReason implements ValidatorConstraintInterface {
  /**
   * Whether a value is a reason.
   *
   * @param value - The value, already trimmed.
   * @returns True if it is.
   */
  validate(value: unknown): boolean {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= ROSTER_RANK_ORDER_REASON_MAX_LENGTH
    );
  }

  /**
   * What is wrong with a value that is not a reason.
   *
   * @param args - The value that failed.
   * @returns The message.
   */
  defaultMessage(args: ValidationArguments): string {
    if (args.value === undefined || args.value === null) {
      return 'Say why the rank order is being changed.';
    }

    return typeof args.value === 'string'
      ? `A reason can be at most ${ROSTER_RANK_ORDER_REASON_MAX_LENGTH} characters.`
      : 'A reason has to be text.';
  }
}

/**
 * An investigator's new rank order for a Fleet (FC-020).
 *
 * Replaces the whole order. `expected` is the order as it was loaded, so an
 * edit made meanwhile by somebody else is refused rather than overwritten
 * (Steve's decision of 25 September 2026).
 */
export class UpdateRosterRankOrderDto {
  @ApiProperty({
    description:
      'The order: tiers highest first, each a list of rank labels exactly ' +
      'as exports list them. An empty list clears the order.',
    type: 'array',
    items: { type: 'array', items: { type: 'string' } },
  })
  @Validate(IsRosterRankTiers)
  readonly tiers: string[][];

  @ApiProperty({
    description: 'The order as it was loaded.',
    type: 'array',
    items: { type: 'array', items: { type: 'string' } },
  })
  @Validate(IsRosterRankTiers)
  readonly expected: string[][];

  @ApiProperty({
    description: 'Why, in the investigator’s own words.',
    maxLength: ROSTER_RANK_ORDER_REASON_MAX_LENGTH,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @Validate(IsRosterRankOrderReason)
  readonly reason: string;
}

/** A rank label the Fleet's imports have listed, and where it is placed. */
export class RosterRankLabelDto {
  @ApiProperty({ description: 'The label, exactly as exports list it.' })
  label: string;

  @ApiProperty({ nullable: true, description: 'Its tier, 1 the highest.' })
  tier: number | null;
}

/** One edit to the rank order. */
export class RosterRankOrderActionDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    nullable: true,
    description: 'The investigator’s STO Info username, or null once gone.',
  })
  actorName: string | null;

  @ApiProperty()
  reason: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'string' } },
  })
  tiersBefore: string[][];

  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'string' } },
  })
  tiersAfter: string[][];

  @ApiProperty()
  actedAt: Date;
}

/** A Fleet's rank order (FC-020). */
export class RosterRankOrderDto {
  @ApiProperty({
    description:
      'Tiers highest first, each a list of labels. Empty when the Fleet has ' +
      'no order.',
    type: 'array',
    items: { type: 'array', items: { type: 'string' } },
  })
  tiers: string[][];

  @ApiProperty({
    type: [RosterRankLabelDto],
    nullable: true,
    description:
      'Every label the Fleet’s imports have listed. Investigators only.',
  })
  labels: RosterRankLabelDto[] | null;

  @ApiProperty({
    type: [RosterRankOrderActionDto],
    nullable: true,
    description: 'Every edit, newest first. Investigators only.',
  })
  actions: RosterRankOrderActionDto[] | null;
}
