import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import {
  canonicaliseTimezone,
  LocalTimeResolution,
  resolveLocalDateTime,
} from 'src/shared/utilities/timezone.utility';

import { FleetNameAliasEntity } from '../../entities/fleet-name-alias.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { toComparableExactGameName } from '../../utilities/exact-game-name.utility';
import { RosterFilenameRejectionCode } from '../enums/roster-filename-rejection-code.enum';
import { readRosterFilename } from '../utilities/roster-filename.utility';

/** What is being asked about. */
export interface RosterExportIdentityInput {
  /** The Fleet the export was uploaded against. */
  readonly fleet: StoFleetEntity;

  /** The filename exactly as uploaded. */
  readonly filename: string;

  /** The IANA zone the uploader says the export was taken in. */
  readonly timezone: string;
}

/** What an export's name turns out to be evidence of. */
export interface RosterExportIdentity {
  /** Why the name proves nothing, or null when it proves what it says. */
  readonly rejection: RosterFilenameRejectionCode | null;

  /** The Fleet label the name carries, or null when there was not one. */
  readonly fleetLabel: string | null;

  /** The local wall-clock stamp the name carries. */
  readonly localStamp: string | null;

  /**
   * When the export was taken, or null while that is not settled.
   *
   * Null in two different situations, and the caller tells them apart by
   * looking at {@link candidates}: there are none when the name was refused,
   * and two when the clock went back over the stamp and somebody has to say
   * which of them they meant.
   */
  readonly exportedAt: Date | null;

  /** Every instant the stamp could name, earliest first. */
  readonly candidates: readonly Date[];

  /**
   * The former name the label matched, or null when it matched the current
   * one.
   *
   * Worth saying out loud on the way past. Somebody importing a Fleet's back
   * catalogue should be told that this file is named for a name the Fleet no
   * longer uses, because the alternative is that they find out from a report
   * six months later.
   */
  readonly matchedAlias: string | null;
}

/** Whether a Fleet label named this Fleet, and by which of its names. */
interface NameMatch {
  /** True when the label is one of the Fleet's recorded names. */
  readonly matched: boolean;

  /** The former name it matched, or null for the current one. */
  readonly aliasName: string | null;
}

/**
 * Decides whether an export's filename is evidence about this Fleet, and when.
 *
 * The filename is the only place an STO export says which Fleet it is of and
 * when it was taken. Neither fact is inside the file, so both arrive as text
 * somebody could have typed — which is why the Fleet is checked against what
 * is already registered and the stamp is checked against a real calendar,
 * rather than either being taken at its word.
 *
 * ## The name is compared exactly
 *
 * On its NFC form and nothing else: not case-folded, not trimmed, not with
 * punctuation stripped, and never against the slug. ADR-0003 settled that a
 * Fleet's exact game name is stored as given, edge spaces included, precisely
 * so that it can be compared with a filename that carries them — and Steve has
 * seen a leading space used in game so that two Fleets can be named almost the
 * same. A comparison that folded it away would file one Fleet's roster under
 * another's, which is the worst thing this module could do.
 *
 * ## A renamed Fleet may still import its history
 *
 * In-game Fleets get renamed, and an export from before a rename carries the
 * old name. `fleet_name_alias` records the names a Fleet has been known by and
 * the interval each covers, and a label matching one of those counts here —
 * but only an alias somebody deliberately recorded with a reason and an actor,
 * and only one whose interval covers the export itself. Nothing in this
 * feature creates an alias from a file: an importer that recorded names as it
 * found them would be an importer that could be told a Fleet's name by
 * whoever uploaded next.
 *
 * ## An ambiguous stamp is a question, not a refusal
 *
 * On the morning the clocks go back, a stamp of `01:30` names two instants an
 * hour apart. Both are returned and neither is chosen. Which one the export
 * was taken at decides which of two snapshots is the later, so guessing it is
 * guessing the order of somebody's roster history — plan section 3.4 requires
 * the candidates be handed back for an explicit answer.
 */
@Injectable()
export class RosterExportIdentityService {
  /**
   * Creates an instance of RosterExportIdentityService.
   *
   * @param _aliases - Repository of names a Fleet has been known by.
   */
  constructor(
    @InjectRepository(FleetNameAliasEntity)
    private readonly _aliases: Repository<FleetNameAliasEntity>,
  ) {}

  /**
   * Reads an export's filename against the Fleet it was uploaded to.
   *
   * @param input - The Fleet, the filename and the export's timezone.
   * @returns What the name is evidence of, or why it is evidence of nothing.
   * @throws Error when the timezone is not one the runtime knows.
   */
  async identify(
    input: RosterExportIdentityInput,
  ): Promise<RosterExportIdentity> {
    const canonical = canonicaliseTimezone(input.timezone);

    if (canonical === null) {
      throw new Error(`Unknown timezone: ${input.timezone}`);
    }

    const reading = readRosterFilename(input.filename);

    if (reading === null) {
      return this.refuse(RosterFilenameRejectionCode.SHAPE_UNRECOGNISED);
    }

    const { fleetLabel, localStamp } = reading;
    const resolved = resolveLocalDateTime(localStamp, canonical);

    if (resolved === null) {
      return this.refuse(
        RosterFilenameRejectionCode.STAMP_NOT_A_TIME,
        fleetLabel,
      );
    }

    if (resolved.resolution === LocalTimeResolution.NONEXISTENT) {
      return this.refuse(
        RosterFilenameRejectionCode.STAMP_NONEXISTENT,
        fleetLabel,
        localStamp,
      );
    }

    const { candidates } = resolved;
    const exportedAt =
      resolved.resolution === LocalTimeResolution.EXACT ? candidates[0] : null;

    const match = await this.matchName(input.fleet, fleetLabel, candidates);

    return {
      rejection: match.matched
        ? null
        : RosterFilenameRejectionCode.FLEET_NAME_MISMATCH,
      fleetLabel,
      localStamp,
      exportedAt,
      candidates,
      matchedAlias: match.aliasName,
    };
  }

  /**
   * Decides whether a label names this Fleet, by its current name or a
   * recorded former one.
   *
   * An alias has to cover *every* candidate instant, not merely one of them.
   * Alias intervals are measured in months and an ambiguous stamp's candidates
   * are an hour apart, so this changes no realistic answer — but it means the
   * answer does not depend on a choice nobody has made yet, which is worth
   * more than the hour it costs.
   *
   * @param fleet - The Fleet the export was uploaded against.
   * @param label - The Fleet label the filename carries.
   * @param candidates - Every instant the export could have been taken at.
   * @returns Whether it matched, and which former name it matched.
   */
  private async matchName(
    fleet: StoFleetEntity,
    label: string,
    candidates: readonly Date[],
  ): Promise<NameMatch> {
    const comparable = toComparableExactGameName(label);

    if (toComparableExactGameName(fleet.exactGameName) === comparable) {
      return { matched: true, aliasName: null };
    }

    const aliases = await this._aliases.find({
      where: { fleetId: fleet.id },
    });

    const alias = aliases.find(
      candidate =>
        toComparableExactGameName(candidate.exactName) === comparable &&
        candidates.every(instant => this.covers(candidate, instant)),
    );

    return alias === undefined
      ? { matched: false, aliasName: null }
      : { matched: true, aliasName: alias.exactName };
  }

  /**
   * Reports whether an alias was in use at an instant.
   *
   * @param alias - The recorded former name.
   * @param instant - When the export was taken.
   * @returns True when the alias covers that moment.
   */
  private covers(alias: FleetNameAliasEntity, instant: Date): boolean {
    if (instant.getTime() < alias.validFrom.getTime()) {
      return false;
    }

    return (
      alias.validTo === null || instant.getTime() < alias.validTo.getTime()
    );
  }

  /**
   * The answer for a name that is evidence of nothing.
   *
   * @param rejection - Why.
   * @param fleetLabel - The label, where one could be read at all.
   * @param localStamp - The stamp, where it could be read at all.
   * @returns The refusal.
   */
  private refuse(
    rejection: RosterFilenameRejectionCode,
    fleetLabel: string | null = null,
    localStamp: string | null = null,
  ): RosterExportIdentity {
    return {
      rejection,
      fleetLabel,
      localStamp,
      exportedAt: null,
      candidates: [],
      matchedAlias: null,
    };
  }
}
