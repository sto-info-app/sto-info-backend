import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, In } from 'typeorm';

import { FactionEntity } from 'src/sto/character/entities/faction.entity';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetRecruitmentState } from '../../enums/fleet-recruitment-state.enum';
import { ApplicationQuestion } from '../application-form.interface';
import {
  RecruitmentQuestionInputDto,
  RecruitmentSettingsDto,
  UpdateRecruitmentSettingsDto,
} from '../dto/recruitment-settings.dto';
import { FleetRecruitmentSettingsEntity } from '../entities/fleet-recruitment-settings.entity';
import { ApplicationQuestionKind } from '../enums/application-question-kind.enum';

/**
 * How a Fleet recruits at this moment, whether or not it has saved a version.
 *
 * A Fleet that never has is recruiting in the state it was registered with,
 * asking nothing and requiring nothing: `settings` is null and `version` 0.
 */
export interface CurrentRecruitment {
  /** The saved version, or null when there is none. */
  readonly settings: FleetRecruitmentSettingsEntity | null;
  readonly version: number;
  readonly recruitmentState: FleetRecruitmentState;
  readonly requirementsText: string | null;
  readonly minimumLevel: number | null;
  readonly factionIds: readonly string[];
  readonly questions: readonly ApplicationQuestion[];
}

/**
 * A Fleet's recruitment state, requirements and application form (FC-021).
 *
 * Every change is a new write-once version, so an application keeps the form
 * it answered: the story's first criterion. The Fleet's own
 * `recruitmentState` is kept in step, in the same transaction, for the
 * directory. This is the only place that state changes after registration.
 */
@Injectable()
export class RecruitmentSettingsService {
  private readonly _logger = new Logger(RecruitmentSettingsService.name);

  /**
   * Creates an instance of RecruitmentSettingsService.
   *
   * @param _dataSource - The database.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * Reads how a Fleet recruits now.
   *
   * @param fleet - The Fleet.
   * @param manager - The transaction to read in, when there is one.
   * @returns Its latest version, or what it recruits with when it has none.
   */
  async current(
    fleet: StoFleetEntity,
    manager: EntityManager = this._dataSource.manager,
  ): Promise<CurrentRecruitment> {
    const settings = await manager.findOne(FleetRecruitmentSettingsEntity, {
      where: { fleetId: fleet.id },
      order: { version: 'DESC' },
    });

    if (settings === null) {
      return {
        settings: null,
        version: 0,
        recruitmentState: fleet.recruitmentState,
        requirementsText: null,
        minimumLevel: null,
        factionIds: [],
        questions: [],
      };
    }

    return {
      settings,
      version: settings.version,
      recruitmentState: settings.recruitmentState,
      requirementsText: settings.requirementsText,
      minimumLevel: settings.minimumLevel,
      factionIds: settings.factionIds,
      questions: settings.questions,
    };
  }

  /**
   * Describes how a Fleet recruits, with its factions named.
   *
   * @param fleet - The Fleet.
   * @returns What an applicant or an editor is shown.
   */
  async describe(fleet: StoFleetEntity): Promise<RecruitmentSettingsDto> {
    const current = await this.current(fleet);
    const factions =
      current.factionIds.length === 0
        ? []
        : await this._dataSource.manager.find(FactionEntity, {
            where: { id: In([...current.factionIds]) },
            order: { name: 'ASC' },
          });

    return {
      version: current.version,
      recruitmentState: current.recruitmentState,
      requirementsText: current.requirementsText,
      minimumLevel: current.minimumLevel,
      factions: factions.map(faction => ({
        id: faction.id,
        name: faction.name,
      })),
      questions: current.questions.map(question => ({
        ...question,
        options: [...question.options],
      })),
      savedAt: current.settings?.createdAt ?? null,
    };
  }

  /**
   * Saves a new version, unless nothing has changed.
   *
   * The Fleet is locked for the read and the write together, so two editors
   * cannot both save version N + 1; the one who saw an older version than is
   * now current is refused rather than silently overwriting.
   *
   * @param communityId - The Community holding the Fleet.
   * @param fleetId - The Fleet.
   * @param dto - The new state, requirements and questions.
   * @param actorUserId - Who is saving.
   * @returns How the Fleet now recruits.
   * @throws ConflictException when a newer version was saved meanwhile.
   * @throws BadRequestException when a faction or a question is not valid.
   */
  async save(
    communityId: string,
    fleetId: string,
    dto: UpdateRecruitmentSettingsDto,
    actorUserId: string,
  ): Promise<FleetRecruitmentSettingsEntity | null> {
    return this._dataSource.transaction(async manager => {
      const fleet = await manager.findOne(StoFleetEntity, {
        where: { id: fleetId, communityId },
        lock: { mode: 'pessimistic_write' },
      });

      if (fleet === null) {
        throw new NotFoundException('Not found');
      }

      const current = await this.current(fleet, manager);

      if (dto.expectedVersion !== current.version) {
        throw new ConflictException(
          'These settings were changed by somebody else. Reload them and try again.',
        );
      }

      const factionIds = [...new Set(dto.factionIds)];
      await this.assertFactionsExist(manager, factionIds);

      const next = {
        recruitmentState: dto.recruitmentState,
        requirementsText: blankToNull(dto.requirementsText),
        minimumLevel: dto.minimumLevel ?? null,
        factionIds,
        questions: normaliseQuestions(dto.questions, current.questions),
      };

      if (current.settings !== null && sameSettings(current, next)) {
        return current.settings;
      }

      const saved = await manager.save(
        FleetRecruitmentSettingsEntity,
        manager.create(FleetRecruitmentSettingsEntity, {
          communityId,
          fleetId,
          version: current.version + 1,
          ...next,
          createdByUserId: actorUserId,
        }),
      );

      if (fleet.recruitmentState !== next.recruitmentState) {
        await manager.update(
          StoFleetEntity,
          { id: fleetId },
          { recruitmentState: next.recruitmentState },
        );
        await manager.increment(StoFleetEntity, { id: fleetId }, 'revision', 1);
      }

      this._logger.log(
        `[save] Recruitment settings saved - FleetId: ${fleetId}, ` +
          `Version: ${saved.version}, State: ${saved.recruitmentState}`,
      );

      return saved;
    });
  }

  /**
   * Refuses a faction that does not exist.
   *
   * @param manager - The transaction.
   * @param factionIds - The factions named.
   * @throws BadRequestException when one is unknown.
   */
  private async assertFactionsExist(
    manager: EntityManager,
    factionIds: readonly string[],
  ): Promise<void> {
    if (factionIds.length === 0) {
      return;
    }

    const found = await manager.count(FactionEntity, {
      where: { id: In([...factionIds]) },
    });

    if (found !== factionIds.length) {
      throw new BadRequestException('One of those factions does not exist.');
    }
  }
}

/**
 * Trims text, and treats blank text as none.
 *
 * @param value - The text, if any.
 * @returns The trimmed text, or null.
 */
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';

  return trimmed === '' ? null : trimmed;
}

/**
 * Turns an editor's questions into what a version keeps.
 *
 * A question keeps its identifier when the current version already has it,
 * so an answer to it still names it; a new one, or one naming an identifier
 * the Fleet never had, is given a fresh one. Prompts and options are trimmed,
 * and options are refused where they do not belong or are repeated.
 *
 * @param questions - The questions sent.
 * @param existing - The current version's questions.
 * @returns The questions, in the order sent.
 * @throws BadRequestException when a question's options are not valid.
 */
function normaliseQuestions(
  questions: readonly RecruitmentQuestionInputDto[],
  existing: readonly ApplicationQuestion[],
): ApplicationQuestion[] {
  const known = new Set(existing.map(question => question.id));
  const seen = new Set<string>();

  return questions.map(question => {
    const prompt = question.prompt.trim();

    if (prompt === '') {
      throw new BadRequestException('Every question needs a prompt.');
    }

    const options = question.options.map(option => option.trim());

    if (question.kind === ApplicationQuestionKind.SINGLE_CHOICE) {
      if (options.length < 2 || options.some(option => option === '')) {
        throw new BadRequestException(
          'A single-choice question needs at least two options, none of them blank.',
        );
      }

      if (
        new Set(options.map(option => option.toLowerCase())).size !==
        options.length
      ) {
        throw new BadRequestException(
          'A single-choice question cannot offer the same option twice.',
        );
      }
    } else if (options.length > 0) {
      throw new BadRequestException(
        'Only a single-choice question has options.',
      );
    }

    const id =
      question.id !== undefined &&
      known.has(question.id) &&
      !seen.has(question.id)
        ? question.id
        : randomUUID();
    seen.add(id);

    return {
      id,
      kind: question.kind,
      prompt,
      required: question.required,
      options,
    };
  });
}

/**
 * Says whether a save would change nothing.
 *
 * @param current - How the Fleet recruits now.
 * @param next - What the save would make it.
 * @returns True when the two are the same.
 */
function sameSettings(
  current: CurrentRecruitment,
  next: Omit<CurrentRecruitment, 'settings' | 'version'>,
): boolean {
  return (
    current.recruitmentState === next.recruitmentState &&
    current.requirementsText === next.requirementsText &&
    current.minimumLevel === next.minimumLevel &&
    JSON.stringify([...current.factionIds].sort()) ===
      JSON.stringify([...next.factionIds].sort()) &&
    JSON.stringify(current.questions) === JSON.stringify(next.questions)
  );
}
