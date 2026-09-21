import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FleetAuthorisationService } from '../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { ScopeRef } from '../authorisation/scope-authorisation.interface';
import { FleetScopeViewerDto } from '../dto/fleet-scope-viewer.dto';

/** Who is looking, as far as artwork ownership is concerned. */
export interface FleetScopeViewer {
  /** The viewer, or null when signed out. */
  readonly userId: string | null;
  /** Their site-wide role, where they have one. */
  readonly role: UserRole | null;
}

/** The artwork an unregistered Fleet is currently showing. */
export interface FleetScopeArtworkState {
  /** Delivery reference of the banner, or null when the slot is empty. */
  readonly bannerImageId: string | null;
  /** Delivery reference of the emblem, or null when the slot is empty. */
  readonly emblemImageId: string | null;
}

/** Nothing offered, which is the answer for everybody signed out. */
const NOTHING: FleetScopeViewerDto = {
  capabilities: [],
  mayManageBanner: false,
  mayManageEmblem: false,
};

/**
 * What to offer the person looking at a Community, Fleet or Armada page.
 *
 * One service rather than a branch at each read, because the two rules it
 * covers look nothing alike and the difference is easy to get the wrong way
 * round. A registered scope answers from the capability policy; an
 * unregistered Fleet has no Community and so no scope to hold a capability
 * at, and answers from who owns the picture already there.
 *
 * It reads `file_asset` through a repository rather than through
 * `FileAssetService`, because `FileAssetsModule` imports `FleetModule` for
 * the audience service (ADR-0015) and importing it back would close the
 * loop. A `forFeature` registration is not a module dependency, so the one
 * column this needs is read in the direction the module graph already runs.
 */
@Injectable()
export class FleetScopeViewerService {
  /**
   * Creates an instance of FleetScopeViewerService.
   *
   * @param _authorisation - The single answer to what a user may do here.
   * @param _assets - Repository used to find who owns a published picture.
   */
  constructor(
    private readonly _authorisation: FleetAuthorisationService,
    @InjectRepository(FileAssetEntity)
    private readonly _assets: Repository<FileAssetEntity>,
  ) {}

  /**
   * Works out what a caller may do at a registered scope.
   *
   * A signed-out caller is answered without resolving anything. Every
   * capability requires a user, so the query would only ever confirm what
   * the absent token already said — and a scope page is served far more
   * often to readers than to owners.
   *
   * @param viewer - Who is looking.
   * @param ref - The scope they are looking at.
   * @returns What to offer them.
   */
  async forScope(
    viewer: FleetScopeViewer,
    ref: ScopeRef,
  ): Promise<FleetScopeViewerDto> {
    if (viewer.userId === null) {
      return NOTHING;
    }

    const authorisation = await this._authorisation.authorise(
      viewer.userId,
      ref,
    );

    if (authorisation === null) {
      return NOTHING;
    }

    const capabilities = [...authorisation.capabilities];
    const mayManageArtwork = authorisation.capabilities.has(
      FLEET_CAPABILITIES.SCOPE_IMAGES_MANAGE,
    );

    return {
      capabilities,
      mayManageBanner: mayManageArtwork,
      mayManageEmblem: mayManageArtwork,
    };
  }

  /**
   * Works out what a caller may do to a Fleet nobody has registered.
   *
   * The same rule the upload route enforces, asked one slot at a time: an
   * empty slot is open to anybody signed in, a filled one belongs to whoever
   * filled it, and a site administrator may displace either. Asked here so
   * that the page offers what will be accepted, rather than inviting an
   * upload that was never going to be kept.
   *
   * A picture whose asset cannot be found is treated as somebody else's, for
   * the reason the route treats it that way: nobody can be shown to own it,
   * and the safe reading of that is not "therefore anybody may".
   *
   * @param viewer - Who is looking.
   * @param artwork - What the Fleet is currently showing.
   * @returns What to offer them.
   */
  async forStandaloneFleet(
    viewer: FleetScopeViewer,
    artwork: FleetScopeArtworkState,
  ): Promise<FleetScopeViewerDto> {
    if (viewer.userId === null) {
      return NOTHING;
    }

    const [mayManageBanner, mayManageEmblem] = await Promise.all([
      this.mayDisplace(viewer, artwork.bannerImageId),
      this.mayDisplace(viewer, artwork.emblemImageId),
    ]);

    return {
      // Nothing to hold. An unregistered Fleet is not a scope: no Community
      // owns it, so no role reaches it and no grant can name it.
      capabilities: [],
      mayManageBanner,
      mayManageEmblem,
    };
  }

  /**
   * Reports whether a signed-in viewer may paint over one slot.
   *
   * @param viewer - Who is looking.
   * @param existing - The delivery reference in the slot, or null.
   * @returns True when the slot is empty, theirs, or they administer the site.
   */
  private async mayDisplace(
    viewer: FleetScopeViewer,
    existing: string | null,
  ): Promise<boolean> {
    if (existing === null || viewer.role === UserRole.ADMIN) {
      return true;
    }

    const asset = await this._assets.findOne({
      where: { deliveryReference: existing },
    });

    return asset?.ownerUserId === viewer.userId;
  }
}
