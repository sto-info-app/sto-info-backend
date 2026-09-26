import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, In } from 'typeorm';

import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { FactionEntity } from 'src/sto/character/entities/faction.entity';

import { FleetRecruitmentState } from '../../enums/fleet-recruitment-state.enum';
import { CharacterFleetMapper } from '../../mappers/character-fleet.mapper';
import { ApplicationQuestion } from '../application-form.interface';
import {
  ApplicationAnswerDto,
  DecideFleetApplicationDto,
  FleetApplicationDetailDto,
  FleetApplicationPageDto,
  FleetApplicationQueryDto,
  FleetApplicationSummaryDto,
  FleetCharacterChoiceDto,
  MyFleetApplicationDto,
  SubmitFleetApplicationDto,
} from '../dto/fleet-application.dto';
import { FleetApplicationActionEntity } from '../entities/fleet-application-action.entity';
import { FleetApplicationEntity } from '../entities/fleet-application.entity';
import { FleetRecruitmentSettingsEntity } from '../entities/fleet-recruitment-settings.entity';
import { FleetApplicationActionKind } from '../enums/fleet-application-action-kind.enum';
import { FleetApplicationRoute } from '../enums/fleet-application-route.enum';
import { FleetApplicationStatus } from '../enums/fleet-application-status.enum';
import { validateAnswers } from '../utilities/application-answers.utility';
import { usernamesFor } from '../utilities/recruitment-names.utility';
import { ApplicationEvidenceService } from './application-evidence.service';
import { RecruitmentEligibilityService } from './recruitment-eligibility.service';
import { RecruitmentMembershipService } from './recruitment-membership.service';
import { RecruitmentSettingsService } from './recruitment-settings.service';

/** The page size an inbox falls back to. */
const DEFAULT_PAGE_SIZE = 25;

/** The most of their own applications a person is shown. */
const MY_APPLICATIONS_LIMIT = 100;

/**
 * Applications to join a Fleet, joins of an OPEN one, and their decisions
 * (FC-021).
 *
 * The story's criteria, as this service keeps them:
 *
 * 1. **Form changes do not rewrite submitted answers.** An application keeps
 *    the settings version it answered, checked against the one the applicant
 *    saw, and the database refuses to change an answer.
 * 2. **Only an owned Character applies, and a duplicate pending application
 *    is controlled.** Ownership is proved over a lock; one pending
 *    application per Character per Fleet is a unique index, and the refusal
 *    says so in words.
 * 3. **A roster match never approves or grants a role.** Nothing here reads
 *    the roster except to show a decider its evidence.
 * 4. **Every step is audited and private.** Each is logged with who and
 *    when; the applicant and the Fleet's holders of `applications.view` are
 *    the only readers. A decision reaches the applicant as a status on their
 *    own page, not a notification.
 */
@Injectable()
export class FleetApplicationService {
  private readonly _logger = new Logger(FleetApplicationService.name);

  /**
   * Creates an instance of FleetApplicationService.
   *
   * @param _dataSource - The database.
   * @param _settings - How each Fleet recruits.
   * @param _eligibility - Who may come in, and with which Character.
   * @param _membership - Grants the membership an acceptance brings.
   * @param _evidence - What the roster says about a Character.
   * @param _fleetMapper - Names a Fleet enough to link to it.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _settings: RecruitmentSettingsService,
    private readonly _eligibility: RecruitmentEligibilityService,
    private readonly _membership: RecruitmentMembershipService,
    private readonly _evidence: ApplicationEvidenceService,
    private readonly _fleetMapper: CharacterFleetMapper,
  ) {}

  /**
   * Applies to a Fleet whose recruitment state is APPLICATION.
   *
   * @param communityId - The Community holding the Fleet.
   * @param fleetId - The Fleet.
   * @param userId - The applicant.
   * @param dto - Their Character, the form version they saw and answers.
   * @returns The application, as the applicant sees it.
   */
  async submit(
    communityId: string,
    fleetId: string,
    userId: string,
    dto: SubmitFleetApplicationDto,
  ): Promise<MyFleetApplicationDto> {
    const saved = await this._dataSource.transaction(async manager => {
      const fleet = await this._eligibility.loadFleet(
        manager,
        communityId,
        fleetId,
      );
      await this._eligibility.assertVisible(fleet, userId);
      this._eligibility.assertNotOwner(fleet, userId);

      const current = await this._settings.current(fleet, manager);
      assertState(current.recruitmentState, FleetRecruitmentState.APPLICATION);

      if (dto.settingsVersion !== current.version) {
        throw new ConflictException(
          'This Fleet has changed its application form since you opened it. Reload it and answer again.',
        );
      }

      await this._membership.assertMayJoin(manager, fleet.id, userId);
      const character = await this._eligibility.requireCharacter(
        manager,
        fleet,
        dto.characterId,
        userId,
        current,
      );
      const answers = validateAnswers(current.questions, dto.answers);

      await assertNoPendingApplication(manager, fleet.id, character.id);

      const application = await manager.save(
        FleetApplicationEntity,
        manager.create(FleetApplicationEntity, {
          communityId,
          fleetId: fleet.id,
          applicantUserId: userId,
          characterId: character.id,
          route: FleetApplicationRoute.APPLICATION,
          status: FleetApplicationStatus.PENDING,
          settingsId: current.settings?.id ?? null,
          answers,
        }),
      );

      await logAction(
        manager,
        application.id,
        FleetApplicationActionKind.SUBMITTED,
        userId,
      );

      return application;
    });

    this._logger.log(
      `[submit] Application submitted - FleetId: ${fleetId}, ApplicationId: ${saved.id}`,
    );

    return this.mine(userId, saved.id);
  }

  /**
   * Joins a Fleet whose recruitment state is OPEN.
   *
   * Recorded as an application accepted as it is made, so every membership
   * has one record of how it came about.
   *
   * @param communityId - The Community holding the Fleet.
   * @param fleetId - The Fleet.
   * @param userId - Who is joining.
   * @param dto - The Character they join with.
   * @returns The record of the join, as they see it.
   */
  async join(
    communityId: string,
    fleetId: string,
    userId: string,
    dto: FleetCharacterChoiceDto,
  ): Promise<MyFleetApplicationDto> {
    const saved = await this._dataSource.transaction(async manager => {
      const fleet = await this._eligibility.loadFleet(
        manager,
        communityId,
        fleetId,
      );
      await this._eligibility.assertVisible(fleet, userId);
      this._eligibility.assertNotOwner(fleet, userId);

      const current = await this._settings.current(fleet, manager);
      assertState(current.recruitmentState, FleetRecruitmentState.OPEN);

      await this._membership.assertMayJoin(manager, fleet.id, userId);
      const character = await this._eligibility.requireCharacter(
        manager,
        fleet,
        dto.characterId,
        userId,
        current,
      );
      const now = new Date();

      const application = await manager.save(
        FleetApplicationEntity,
        manager.create(FleetApplicationEntity, {
          communityId,
          fleetId: fleet.id,
          applicantUserId: userId,
          characterId: character.id,
          route: FleetApplicationRoute.OPEN_JOIN,
          status: FleetApplicationStatus.ACCEPTED,
          settingsId: current.settings?.id ?? null,
          answers: [],
          submittedAt: now,
          decidedAt: now,
          decidedByUserId: null,
        }),
      );

      await logAction(
        manager,
        application.id,
        FleetApplicationActionKind.SUBMITTED,
        userId,
      );
      await logAction(
        manager,
        application.id,
        FleetApplicationActionKind.ACCEPTED,
        null,
      );

      await this._membership.grantWithin(manager, {
        fleet,
        userId,
        characterId: character.id,
        applicationId: application.id,
        actorUserId: null,
        now,
      });

      return application;
    });

    this._logger.log(
      `[join] Fleet joined - FleetId: ${fleetId}, ApplicationId: ${saved.id}`,
    );

    return this.mine(userId, saved.id);
  }

  /**
   * Takes back one of the applicant's own pending applications.
   *
   * @param applicationId - The application.
   * @param userId - The applicant.
   * @returns The application, as they now see it.
   * @throws NotFoundException when it is not theirs or does not exist.
   * @throws ConflictException when it has already been decided.
   */
  async withdraw(
    applicationId: string,
    userId: string,
  ): Promise<MyFleetApplicationDto> {
    await this._dataSource.transaction(async manager => {
      const application = await manager.findOne(FleetApplicationEntity, {
        where: { id: applicationId, applicantUserId: userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (application === null) {
        throw new NotFoundException('Not found');
      }

      if (application.status !== FleetApplicationStatus.PENDING) {
        throw new ConflictException(
          'This application has already been decided or withdrawn.',
        );
      }

      application.status = FleetApplicationStatus.WITHDRAWN;
      application.withdrawnAt = new Date();
      application.revision += 1;
      await manager.save(FleetApplicationEntity, application);
      await logAction(
        manager,
        application.id,
        FleetApplicationActionKind.WITHDRAWN,
        userId,
      );
    });

    return this.mine(userId, applicationId);
  }

  /**
   * Accepts or rejects an application.
   *
   * The application is locked, and a decision against a revision older than
   * the current one is refused, so two deciders at once cannot both succeed.
   * Nobody decides their own application.
   *
   * @param communityId - The Community holding the Fleet.
   * @param fleetId - The Fleet.
   * @param applicationId - The application.
   * @param deciderUserId - Who is deciding.
   * @param dto - The decision, its reason or note, and the revision seen.
   * @returns The application in full.
   */
  async decide(
    communityId: string,
    fleetId: string,
    applicationId: string,
    deciderUserId: string,
    dto: DecideFleetApplicationDto,
  ): Promise<FleetApplicationDetailDto> {
    const note = dto.note?.trim() || null;

    if (dto.decision === 'REJECT' && note === null) {
      throw new BadRequestException(
        'Please give a reason. The applicant is shown it.',
      );
    }

    await this._dataSource.transaction(async manager => {
      const application = await manager.findOne(FleetApplicationEntity, {
        where: { id: applicationId, fleetId, communityId },
        lock: { mode: 'pessimistic_write' },
      });

      if (application === null) {
        throw new NotFoundException('Not found');
      }

      if (application.applicantUserId === deciderUserId) {
        throw new ForbiddenException(
          'Somebody else must decide your own application.',
        );
      }

      if (application.status !== FleetApplicationStatus.PENDING) {
        throw new ConflictException(
          'This application has already been decided or withdrawn.',
        );
      }

      if (application.revision !== dto.revision) {
        throw new ConflictException(
          'This application changed since you opened it. Reload it and decide again.',
        );
      }

      const now = new Date();

      if (dto.decision === 'ACCEPT') {
        const fleet = await this._eligibility.loadFleet(
          manager,
          communityId,
          fleetId,
        );

        await this._membership.grantWithin(manager, {
          fleet,
          userId: application.applicantUserId,
          characterId: application.characterId,
          applicationId: application.id,
          actorUserId: deciderUserId,
          now,
        });
      }

      application.status =
        dto.decision === 'ACCEPT'
          ? FleetApplicationStatus.ACCEPTED
          : FleetApplicationStatus.REJECTED;
      application.decidedAt = now;
      application.decidedByUserId = deciderUserId;
      application.decisionNote = note;
      application.revision += 1;
      await manager.save(FleetApplicationEntity, application);

      await logAction(
        manager,
        application.id,
        dto.decision === 'ACCEPT'
          ? FleetApplicationActionKind.ACCEPTED
          : FleetApplicationActionKind.REJECTED,
        deciderUserId,
        note,
      );
    });

    this._logger.log(
      `[decide] Application decided - ApplicationId: ${applicationId}, Decision: ${dto.decision}`,
    );

    return this.detail(fleetId, applicationId);
  }

  /**
   * Lists a Fleet's applications, oldest first so the longest-waiting is
   * answered first.
   *
   * @param fleetId - The Fleet.
   * @param query - The status and page asked for; PENDING by default.
   * @returns The page.
   */
  async page(
    fleetId: string,
    query: FleetApplicationQueryDto,
  ): Promise<FleetApplicationPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const [applications, total] = await this._dataSource.manager.findAndCount(
      FleetApplicationEntity,
      {
        where: {
          fleetId,
          status: query.status ?? FleetApplicationStatus.PENDING,
        },
        order: { submittedAt: 'ASC', id: 'ASC' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      },
    );

    return {
      items: await this.summaries(applications),
      page,
      pageSize,
      total,
    };
  }

  /**
   * Reads one application in full, for a decider.
   *
   * @param fleetId - The Fleet.
   * @param applicationId - The application.
   * @returns The application, its answers beside their questions, the
   *   roster's evidence and its history.
   * @throws NotFoundException when the Fleet has no such application.
   */
  async detail(
    fleetId: string,
    applicationId: string,
  ): Promise<FleetApplicationDetailDto> {
    const manager = this._dataSource.manager;
    const application = await manager.findOne(FleetApplicationEntity, {
      where: { id: applicationId, fleetId },
    });

    if (application === null) {
      throw new NotFoundException('Not found');
    }

    const [summary] = await this.summaries([application]);
    const [settings, actions, character] = await Promise.all([
      application.settingsId === null
        ? Promise.resolve(null)
        : manager.findOne(FleetRecruitmentSettingsEntity, {
            where: { id: application.settingsId },
          }),
      manager.find(FleetApplicationActionEntity, {
        where: { applicationId },
        order: { createdAt: 'ASC' },
      }),
      manager.findOne(CharacterEntity, {
        where: { id: application.characterId },
        withDeleted: true,
      }),
    ]);
    const names = await usernamesFor(manager, [
      application.decidedByUserId,
      ...actions.map(action => action.actorUserId),
    ]);

    return {
      ...summary,
      answers: pairAnswers(settings?.questions ?? [], application),
      settingsVersion: settings?.version ?? 0,
      decisionNote: application.decisionNote,
      decidedByUsername:
        application.decidedByUserId === null
          ? null
          : (names.get(application.decidedByUserId) ?? null),
      revision: application.revision,
      evidence:
        character === null
          ? {
              listed: false,
              latestExportAt: null,
              listedSince: null,
              rank: null,
              everListed: false,
            }
          : await this._evidence.forCharacter(fleetId, character),
      history: actions.map(action => ({
        action: action.action,
        actorUsername:
          action.actorUserId === null
            ? null
            : (names.get(action.actorUserId) ?? null),
        note: action.note,
        at: action.createdAt,
      })),
    };
  }

  /**
   * Lists somebody's own applications and joins, newest first.
   *
   * @param userId - Whose.
   * @returns Each, with the Fleet named and linked.
   */
  async listMine(userId: string): Promise<MyFleetApplicationDto[]> {
    const applications = await this._dataSource.manager.find(
      FleetApplicationEntity,
      {
        where: { applicantUserId: userId },
        order: { submittedAt: 'DESC', id: 'DESC' },
        take: MY_APPLICATIONS_LIMIT,
        relations: {
          fleet: { platform: true, community: true },
          character: true,
        },
      },
    );

    return applications.map(application => this.toMine(application));
  }

  /**
   * Reads one of somebody's own applications.
   *
   * @param userId - Whose.
   * @param applicationId - Which.
   * @returns It, as they see it.
   */
  private async mine(
    userId: string,
    applicationId: string,
  ): Promise<MyFleetApplicationDto> {
    const application = await this._dataSource.manager.findOneOrFail(
      FleetApplicationEntity,
      {
        where: { id: applicationId, applicantUserId: userId },
        relations: {
          fleet: { platform: true, community: true },
          character: true,
        },
      },
    );

    return this.toMine(application);
  }

  /**
   * Maps an application for its applicant.
   *
   * @param application - The application, with its Fleet and Character.
   * @returns It, as they see it.
   */
  private toMine(application: FleetApplicationEntity): MyFleetApplicationDto {
    return {
      id: application.id,
      fleet: this._fleetMapper.toSummaryDto(application.fleet),
      status: application.status,
      route: application.route,
      characterName: application.character.fullHandle,
      submittedAt: application.submittedAt,
      decidedAt: application.decidedAt,
      decisionNote: application.decisionNote,
    };
  }

  /**
   * Maps applications to inbox rows, reading names in bulk.
   *
   * @param applications - The applications.
   * @returns One row each, in the same order.
   */
  private async summaries(
    applications: readonly FleetApplicationEntity[],
  ): Promise<FleetApplicationSummaryDto[]> {
    if (applications.length === 0) {
      return [];
    }

    const manager = this._dataSource.manager;
    const characters = await manager.find(CharacterEntity, {
      where: { id: In(applications.map(a => a.characterId)) },
      withDeleted: true,
    });
    const factions = await manager.find(FactionEntity, {
      where: { id: In([...new Set(characters.map(c => c.factionId))]) },
    });
    const names = await usernamesFor(
      manager,
      applications.map(a => a.applicantUserId),
    );
    const characterById = new Map(characters.map(c => [c.id, c]));
    const factionById = new Map(factions.map(f => [f.id, f.name]));

    return applications.map(application => {
      const character = characterById.get(application.characterId);

      return {
        id: application.id,
        status: application.status,
        route: application.route,
        applicantUsername: names.get(application.applicantUserId) ?? null,
        characterName: character?.fullHandle ?? 'A deleted Character',
        characterLevel: character?.level ?? null,
        factionName:
          character === undefined
            ? null
            : (factionById.get(character.factionId) ?? null),
        submittedAt: application.submittedAt,
        decidedAt: application.decidedAt,
      };
    });
  }
}

/**
 * Refuses a way in the Fleet's recruitment state does not offer.
 *
 * @param state - The Fleet's state.
 * @param wanted - The state the way in needs.
 * @throws ConflictException saying what the Fleet does instead.
 */
function assertState(
  state: FleetRecruitmentState,
  wanted: FleetRecruitmentState,
): void {
  if (state === wanted) {
    return;
  }

  const instead: Record<FleetRecruitmentState, string> = {
    [FleetRecruitmentState.OPEN]:
      'This Fleet is open: join it instead of applying.',
    [FleetRecruitmentState.APPLICATION]:
      'This Fleet takes new members by application.',
    [FleetRecruitmentState.INVITE_ONLY]:
      'This Fleet takes new members by invitation only.',
    [FleetRecruitmentState.CLOSED]: 'This Fleet is not recruiting.',
  };

  throw new ConflictException(instead[state]);
}

/**
 * Refuses a second pending application for the same Character and Fleet, in
 * words, before the unique index does it with an error code.
 *
 * @param manager - The transaction.
 * @param fleetId - The Fleet.
 * @param characterId - The Character.
 * @throws ConflictException when one is already pending.
 */
async function assertNoPendingApplication(
  manager: EntityManager,
  fleetId: string,
  characterId: string,
): Promise<void> {
  const pending = await manager.exists(FleetApplicationEntity, {
    where: { fleetId, characterId, status: FleetApplicationStatus.PENDING },
  });

  if (pending) {
    throw new ConflictException(
      'That Character already has an application waiting with this Fleet.',
    );
  }
}

/**
 * Logs one step of an application.
 *
 * @param manager - The transaction.
 * @param applicationId - The application.
 * @param action - What happened.
 * @param actorUserId - Who did it, or null for a join's acceptance.
 * @param note - A reason or note, if any.
 */
async function logAction(
  manager: EntityManager,
  applicationId: string,
  action: FleetApplicationActionKind,
  actorUserId: string | null,
  note: string | null = null,
): Promise<void> {
  await manager.save(
    FleetApplicationActionEntity,
    manager.create(FleetApplicationActionEntity, {
      applicationId,
      action,
      actorUserId,
      note,
    }),
  );
}

/**
 * Puts each question of the form an application answered beside its answer.
 *
 * @param questions - The questions of the version answered.
 * @param application - The application.
 * @returns One entry per question, in the form's order.
 */
function pairAnswers(
  questions: readonly ApplicationQuestion[],
  application: FleetApplicationEntity,
): ApplicationAnswerDto[] {
  const answers = new Map(
    application.answers.map(answer => [answer.questionId, answer.value]),
  );

  return questions.map(question => ({
    questionId: question.id,
    prompt: question.prompt,
    kind: question.kind,
    value: answers.get(question.id) ?? null,
  }));
}
