import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { EntityManager, ObjectLiteral, Repository } from 'typeorm';

import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { StoArmadaEntity } from '../entities/sto-armada.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetAuthorisationService } from './fleet-authorisation.service';

/**
 * Moves a scope's authorisation revision on when who-may-do-what changes.
 *
 * Plan section 4.2: "Permission mutations bump scope authorisation revision;
 * publish revocation to sockets and invalidate relevant caches. Service checks
 * remain authoritative even if invalidation is delayed."
 *
 * That last sentence is the design. The revision is a **notification that an
 * answer has changed, never the answer itself**. A client — or, later, an open
 * socket — compares the revision it was given with the one on the next payload
 * and knows to discard what it cached. Nothing in this feature decides access
 * by comparing revisions, so a bump that arrives late, arrives twice or never
 * arrives at all costs a client a stale view and never costs anybody access
 * they should not have. Building it the other way round, where a socket holds a
 * capability set until it is told otherwise, is how a revoked Officer keeps
 * reading a channel until they reconnect.
 *
 * Every mutation that changes a role, a membership status or a delegated
 * capability calls {@link bump} in the same transaction as the change itself,
 * so a committed change always has a revision to advertise and a rolled-back
 * one leaves no trace.
 *
 * Publishing the bump to connected sockets attaches in W07, when there is a
 * gateway to publish to. It is deliberately not stubbed here: an empty
 * publisher that nothing subscribes to reads like a working notification path
 * and is the easiest kind of gap to miss.
 */
@Injectable()
export class FleetAuthorisationRevisionService {
  private readonly _logger = new Logger(FleetAuthorisationRevisionService.name);

  /**
   * Creates an instance of FleetAuthorisationRevisionService.
   *
   * @param _communityRepository - Repository of Fleet Communities.
   * @param _fleetRepository - Repository of Fleets.
   * @param _armadaRepository - Repository of Armadas.
   * @param _authorisationService - Holds the per-request memoisation to clear.
   */
  constructor(
    @InjectRepository(FleetCommunityEntity)
    private readonly _communityRepository: Repository<FleetCommunityEntity>,
    @InjectRepository(StoFleetEntity)
    private readonly _fleetRepository: Repository<StoFleetEntity>,
    @InjectRepository(StoArmadaEntity)
    private readonly _armadaRepository: Repository<StoArmadaEntity>,
    private readonly _authorisationService: FleetAuthorisationService,
  ) {}

  /**
   * Advances a scope's authorisation revision by one.
   *
   * The increment is done by the database rather than by reading, adding one
   * and writing back, so two permission changes committing at once cannot end
   * up advertising the same revision — which would leave one of the two changes
   * invisible to every client that had already seen that number.
   *
   * @param kind - The kind of scope whose authorisation changed.
   * @param id - The scope's identifier.
   * @param manager - The transaction the change is being made in, when there is
   *   one. Passing it is what ties the bump to the change: a rolled-back grant
   *   must not leave a revision behind suggesting something happened.
   * @returns The scope's new revision, or null when the scope no longer exists.
   */
  async bump(
    kind: FleetScopeKind,
    id: string,
    manager?: EntityManager,
  ): Promise<number | null> {
    const repository = this.repositoryFor(kind, manager);

    await repository.increment({ id }, 'revision', 1);

    const updated = await repository.findOne({
      where: { id },
      select: { id: true, revision: true },
    });

    // Clearing the request memoisation matters even though the bump itself is
    // only a hint: the handler making this change may well ask the policy a
    // question afterwards, and must not be answered from before the change.
    this._authorisationService.invalidate(kind, id);

    if (!updated) {
      this._logger.warn(
        `Authorisation revision bumped for ${kind} ${id}, which no longer exists`,
      );

      return null;
    }

    return updated.revision;
  }

  /**
   * Picks the repository for a scope kind, honouring an open transaction.
   *
   * @param kind - The kind of scope.
   * @param manager - The transaction, when there is one.
   * @returns A repository of the matching entity.
   */
  private repositoryFor(
    kind: FleetScopeKind,
    manager?: EntityManager,
  ): Repository<ObjectLiteral & { id: string; revision: number }> {
    switch (kind) {
      case FleetScopeKind.COMMUNITY:
        return manager
          ? manager.getRepository(FleetCommunityEntity)
          : this._communityRepository;
      case FleetScopeKind.FLEET:
        return manager
          ? manager.getRepository(StoFleetEntity)
          : this._fleetRepository;
      // Named rather than defaulted, so a fourth scope kind is a compile error
      // instead of a silently unversioned one.
      case FleetScopeKind.ARMADA:
        return manager
          ? manager.getRepository(StoArmadaEntity)
          : this._armadaRepository;
    }
  }
}
