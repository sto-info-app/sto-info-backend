import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { ObjectLiteral, Repository } from 'typeorm';

import { FileAssetAudience } from 'src/file-assets/enums/file-asset-audience.enum';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AcceptedAsset } from 'src/file-assets/services/asset-ingress.service';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';
import { FileAssetService } from 'src/file-assets/services/file-asset.service';
import { ImageIngressService } from 'src/file-assets/services/image-ingress.service';
import { DEFAULT_MULTER_LIMITS } from 'src/shared/constants/file-upload.constants';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { StoArmadaEntity } from '../entities/sto-armada.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import {
  FLEET_ARTWORK_COLUMNS,
  FLEET_ARTWORK_SPECS,
} from './fleet-artwork-slot.utility';
import { FleetScopeArtwork } from './fleet-scope-image.publisher';

/** Which scope's artwork is being changed. */
export interface FleetArtworkTarget {
  /** Whether it is a Community, a Fleet or an Armada. */
  readonly kind: FleetScopeKind;
  /** Which record of that kind. */
  readonly id: string;
}

/** What one artwork upload needs to know about itself. */
export interface FleetArtworkUpload {
  /** The person uploading. */
  readonly userId: string;
  /** What the picture shows. */
  readonly altText: string;
  /** The cropped file. */
  readonly file: Express.Multer.File;
}

/** Who is asking, for the rule an unclaimed Fleet is held to. */
export interface FleetArtworkCaller {
  /** The person asking. */
  readonly userId: string;
  /** Their site-wide role, where they have one. */
  readonly role: UserRole | null;
}

/** A scope loaded and ready to have its artwork written. */
interface ResolvedScope {
  /** The record itself. */
  readonly record: FleetScopeArtwork;
  /** The repository that saves it. */
  readonly repository: Repository<ObjectLiteral>;
  /** Which registry subject it is. */
  readonly subject: FileAssetSubject;
  /** The owning Community, where there is one. */
  readonly communityId: string | null;
  /** The Fleet itself, when the scope is one. */
  readonly fleetId: string | null;
  /** The Armada itself, when the scope is one. */
  readonly armadaId: string | null;
  /** Whose eyes the scope admits, and so whose the picture does. */
  readonly audience: FleetAudience;
  /** Whether it is a Fleet nobody has registered. */
  readonly unclaimed: boolean;
}

/**
 * The banner and the emblem a Community, Fleet or Armada shows.
 *
 * Nothing is written when a picture is uploaded. The scope goes on showing
 * whatever it has until a scanner has cleared the new file, at which point
 * the publisher writes the reference and its description together — FC-012.
 * That is why an upload answers with something to ask about rather than with
 * the record: at the moment the request finishes, nothing has changed.
 *
 * Every picture carries {@link FileAssetAudience.SCOPE} rather than a fixed
 * audience, so a Community that turns private takes its banner with it
 * without anything here having to notice. The delivery route asks the same
 * Fleet audience service every other visibility question is asked of.
 */
@Injectable()
export class FleetImageService {
  /**
   * Creates an instance of FleetImageService.
   *
   * @param _communities - Repository of Communities.
   * @param _fleets - Repository of Fleets.
   * @param _armadas - Repository of Armadas.
   * @param _ingress - Checks a picture over and sends it to be scanned.
   * @param _withdrawal - Takes a published picture down.
   * @param _assets - Says who uploaded the picture a slot is showing.
   */
  constructor(
    @InjectRepository(FleetCommunityEntity)
    private readonly _communities: Repository<FleetCommunityEntity>,
    @InjectRepository(StoFleetEntity)
    private readonly _fleets: Repository<StoFleetEntity>,
    @InjectRepository(StoArmadaEntity)
    private readonly _armadas: Repository<StoArmadaEntity>,
    private readonly _ingress: ImageIngressService,
    private readonly _withdrawal: AssetWithdrawalService,
    private readonly _assets: FileAssetService,
  ) {}

  /**
   * Checks a picture over and sends it to be scanned, for a scope the
   * caller has already been authorised at.
   *
   * @param target - Which scope.
   * @param slot - The banner or the emblem.
   * @param upload - The uploader, the description and the file.
   * @returns The asset to ask about, and how far along it is.
   * @throws NotFoundException when the scope is not there.
   * @throws BadRequestException when the file is unacceptable for the slot.
   */
  async setArtwork(
    target: FleetArtworkTarget,
    slot: FileAssetSlot,
    upload: FleetArtworkUpload,
  ): Promise<AcceptedAsset> {
    return this.accept(await this.resolve(target), slot, upload);
  }

  /**
   * Takes a scope's picture down, for a scope the caller has already been
   * authorised at.
   *
   * @param target - Which scope.
   * @param slot - The banner or the emblem.
   * @throws NotFoundException when the scope is not there, or the slot is
   *   already empty.
   */
  async clearArtwork(
    target: FleetArtworkTarget,
    slot: FileAssetSlot,
  ): Promise<void> {
    await this.withdraw(await this.resolve(target), slot);
  }

  /**
   * Checks a picture over for a Fleet nobody has registered.
   *
   * An unregistered record has no Community, so there is no scope at which
   * to hold a capability and the route that reaches it carries no guard.
   * The rule instead is the one Steve chose: an empty slot may be filled by
   * anybody signed in, and a slot already showing something may only be
   * changed by whoever uploaded it, or by a site administrator.
   *
   * @param fleetId - The unregistered Fleet.
   * @param slot - The banner or the emblem.
   * @param upload - The uploader, the description and the file.
   * @returns The asset to ask about, and how far along it is.
   * @throws NotFoundException when no unregistered Fleet has that identifier.
   * @throws ForbiddenException when somebody else's picture is there.
   */
  async setUnclaimedFleetArtwork(
    fleetId: string,
    slot: FileAssetSlot,
    upload: FleetArtworkUpload,
  ): Promise<AcceptedAsset> {
    const scope = await this.resolveUnclaimedFleet(fleetId);

    await this.assertMayDisplace(scope, slot, {
      userId: upload.userId,
      role: null,
    });

    return this.accept(scope, slot, upload);
  }

  /**
   * Takes a picture down from a Fleet nobody has registered.
   *
   * @param fleetId - The unregistered Fleet.
   * @param slot - The banner or the emblem.
   * @param caller - Who is asking, and what they are on the site.
   * @throws NotFoundException when no unregistered Fleet has that identifier,
   *   or the slot is already empty.
   * @throws ForbiddenException when somebody else's picture is there.
   */
  async clearUnclaimedFleetArtwork(
    fleetId: string,
    slot: FileAssetSlot,
    caller: FleetArtworkCaller,
  ): Promise<void> {
    const scope = await this.resolveUnclaimedFleet(fleetId);

    await this.assertMayDisplace(scope, slot, caller);
    await this.withdraw(scope, slot);
  }

  /**
   * Sends a picture to the shared ingress on a resolved scope's behalf.
   *
   * @param scope - The scope the picture is for.
   * @param slot - The banner or the emblem.
   * @param upload - The uploader, the description and the file.
   * @returns The asset to ask about, and how far along it is.
   */
  private async accept(
    scope: ResolvedScope,
    slot: FileAssetSlot,
    upload: FleetArtworkUpload,
  ): Promise<AcceptedAsset> {
    const spec = FLEET_ARTWORK_SPECS[slot] ?? null;

    return this._ingress.accept({
      spec,
      userId: upload.userId,
      kind: FileAssetKind.FLEET_IMAGE,
      // Never a fixed audience. A Community that turns private takes its
      // banner with it, and a Fleet whose Community admits only members
      // stops handing its emblem to strangers, without a second rule here
      // having to be kept in step with the first.
      audience: FileAssetAudience.SCOPE,
      subject: scope.subject,
      subjectId: scope.record.id,
      slot,
      scope: {
        communityId: scope.communityId,
        fleetId: scope.fleetId,
        armadaId: scope.armadaId,
        audience: scope.audience,
      },
      entityTag: spec?.entityTag ?? 'fleet-image',
      entityId: scope.record.id,
      maximumBytes: DEFAULT_MULTER_LIMITS.fileSize,
      sizeLimitLabel: 'Fleet images',
      file: upload.file,
      // The description waits here rather than being written now, so the
      // scope never shows one picture described as another while a scan is
      // still running.
      feature: { altText: upload.altText },
    });
  }

  /**
   * Withdraws the picture a slot is showing and empties the columns.
   *
   * The columns are emptied before the asset is withdrawn. Withdrawing
   * first would leave the scope pointing for a moment at bytes the delivery
   * route had already stopped serving, which reads to a visitor as a broken
   * image rather than as no image.
   *
   * @param scope - The scope.
   * @param slot - The banner or the emblem.
   * @throws NotFoundException when the slot is already empty.
   */
  private async withdraw(
    scope: ResolvedScope,
    slot: FileAssetSlot,
  ): Promise<void> {
    const columns = FLEET_ARTWORK_COLUMNS[slot];
    const existing = this.currentReference(scope, slot);

    if (columns === undefined || existing === null) {
      throw new NotFoundException('There is no picture there to remove.');
    }

    scope.record[columns.id] = null;
    scope.record[columns.alt] = null;
    await scope.repository.save(scope.record as ObjectLiteral);

    // Withdrawn through the registry rather than deleted here, so the row
    // saying whether these bytes may be served stops saying yes at the
    // moment the scope stops pointing at them, and an outstanding purge is
    // recorded where W10 can find it — ADR-0016.
    await this._withdrawal.withdrawSlot(
      scope.subject,
      scope.record.id,
      slot,
      existing,
      'Removed by the scope',
    );
  }

  /**
   * Requires that the caller may replace what a slot is already showing.
   *
   * An empty slot is open to anybody signed in, which is what makes an
   * unregistered Fleet worth having artwork at all. Once something is
   * there, it is somebody's work: only they may paint over it, and only a
   * site administrator may do so on their behalf.
   *
   * A picture whose asset cannot be found is treated as somebody else's.
   * Nobody can be shown to own it, and the safe reading of that is not
   * "therefore anybody may".
   *
   * @param scope - The scope.
   * @param slot - The banner or the emblem.
   * @param caller - Who is asking, and what they are on the site.
   * @throws ForbiddenException when the picture is not theirs to displace.
   */
  private async assertMayDisplace(
    scope: ResolvedScope,
    slot: FileAssetSlot,
    caller: FleetArtworkCaller,
  ): Promise<void> {
    const existing = this.currentReference(scope, slot);

    if (existing === null || caller.role === UserRole.ADMIN) {
      return;
    }

    const asset = await this._assets.findByDeliveryReference(existing);

    if (asset?.ownerUserId !== caller.userId) {
      throw new ForbiddenException(
        'Somebody else put that picture there. Register the Fleet to a ' +
          'Community if you want to look after its artwork.',
      );
    }
  }

  /**
   * Reads the picture a slot is currently showing.
   *
   * A slot no scope has shows nothing, which is what keeps both callers
   * from reading a column named `undefined`: the withdrawal reports there
   * is nothing to remove, and the displacement check finds nothing in the
   * way.
   *
   * @param scope - The scope.
   * @param slot - The banner or the emblem.
   * @returns The delivery reference, or null when the slot is empty.
   */
  private currentReference(
    scope: ResolvedScope,
    slot: FileAssetSlot,
  ): string | null {
    const columns = FLEET_ARTWORK_COLUMNS[slot];

    return columns === undefined ? null : (scope.record[columns.id] ?? null);
  }

  /**
   * Loads a Fleet that nobody has registered.
   *
   * A registered Fleet reached through this route is reported as missing
   * rather than as forbidden. The route is for unregistered records, and a
   * Fleet that has a Community is reachable — by the people entitled to
   * change it — through that Community's own route.
   *
   * @param fleetId - The Fleet.
   * @returns The resolved scope.
   * @throws NotFoundException when there is no such unregistered Fleet.
   */
  private async resolveUnclaimedFleet(fleetId: string): Promise<ResolvedScope> {
    const scope = await this.resolve({
      kind: FleetScopeKind.FLEET,
      id: fleetId,
    });

    if (!scope.unclaimed) {
      throw new NotFoundException('That Fleet is not an unregistered record.');
    }

    return scope;
  }

  /**
   * Loads a scope and everything writing its artwork needs to know.
   *
   * @param target - Which scope.
   * @returns The resolved scope.
   * @throws NotFoundException when the scope is not there.
   */
  private async resolve(target: FleetArtworkTarget): Promise<ResolvedScope> {
    switch (target.kind) {
      case FleetScopeKind.COMMUNITY:
        return this.resolveCommunity(target.id);
      case FleetScopeKind.FLEET:
        return this.resolveFleet(target.id);
      // Named rather than defaulted, so a fourth kind of scope is a compile
      // error here instead of a Community's artwork quietly being written.
      case FleetScopeKind.ARMADA:
        return this.resolveArmada(target.id);
    }
  }

  /**
   * Loads a Community.
   *
   * @param communityId - The Community.
   * @returns The resolved scope.
   * @throws NotFoundException when the Community is not there.
   */
  private async resolveCommunity(communityId: string): Promise<ResolvedScope> {
    const community = await this._communities.findOne({
      where: { id: communityId },
    });

    if (community === null) {
      throw new NotFoundException('That Community does not exist.');
    }

    return {
      record: community,
      repository: this._communities as Repository<ObjectLiteral>,
      subject: FileAssetSubject.FLEET_COMMUNITY,
      communityId: community.id,
      fleetId: null,
      armadaId: null,
      audience: community.visibility,
      unclaimed: false,
    };
  }

  /**
   * Loads a Fleet, registered or not.
   *
   * @param fleetId - The Fleet.
   * @returns The resolved scope.
   * @throws NotFoundException when the Fleet is not there.
   */
  private async resolveFleet(fleetId: string): Promise<ResolvedScope> {
    const fleet = await this._fleets.findOne({ where: { id: fleetId } });

    if (fleet === null) {
      throw new NotFoundException('That Fleet does not exist.');
    }

    return {
      record: fleet,
      repository: this._fleets as Repository<ObjectLiteral>,
      subject: FileAssetSubject.FLEET,
      communityId: fleet.communityId,
      fleetId: fleet.id,
      armadaId: null,
      audience: fleet.visibility,
      unclaimed: fleet.communityId === null,
    };
  }

  /**
   * Loads an Armada, and the Community whose audience it keeps.
   *
   * An Armada has no visibility column of its own — it is a grouping inside
   * a Community and is seen by whoever sees the Community — so the audience
   * its artwork carries is the Community's, read here rather than guessed
   * at delivery time.
   *
   * @param armadaId - The Armada.
   * @returns The resolved scope.
   * @throws NotFoundException when the Armada is not there.
   */
  private async resolveArmada(armadaId: string): Promise<ResolvedScope> {
    const armada = await this._armadas.findOne({
      where: { id: armadaId },
      relations: { community: true },
    });

    if (armada === null) {
      throw new NotFoundException('That Armada does not exist.');
    }

    return {
      record: armada,
      repository: this._armadas as Repository<ObjectLiteral>,
      subject: FileAssetSubject.ARMADA,
      communityId: armada.communityId,
      fleetId: null,
      armadaId: armada.id,
      audience: armada.community?.visibility ?? FleetAudience.PRIVATE,
      unclaimed: false,
    };
  }
}
