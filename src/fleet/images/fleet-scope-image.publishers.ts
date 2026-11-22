import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AssetPublisherRegistry } from 'src/file-assets/services/asset-publisher.registry';

import { FleetCommunityEntity } from '../entities/fleet-community.entity';
import { StoArmadaEntity } from '../entities/sto-armada.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetScopeImagePublisher } from './fleet-scope-image.publisher';

/*
 * The three publishers a Fleet scope needs, in one file.
 *
 * Three classes because the registry keys on the subject and a publisher
 * writes one table; one file because that is all any of them says. Reading
 * them together is also the only way to see at a glance that all three
 * subjects have one, which is the mistake the registry refuses at ingress
 * rather than at publication: an unregistered subject is an upload that
 * reaches CLEAN and then stops.
 */

/** Puts cleared artwork on a Community. */
@Injectable()
export class FleetCommunityImagePublisher extends FleetScopeImagePublisher<FleetCommunityEntity> {
  /** The kind of record this publishes for. */
  readonly subject = FileAssetSubject.FLEET_COMMUNITY;

  /**
   * Creates an instance of FleetCommunityImagePublisher.
   *
   * @param communities - Repository of Communities.
   * @param registry - Which publisher writes which table.
   */
  constructor(
    @InjectRepository(FleetCommunityEntity)
    communities: Repository<FleetCommunityEntity>,
    registry: AssetPublisherRegistry,
  ) {
    super(communities, registry);
  }
}

/** Puts cleared artwork on a Fleet, registered or not. */
@Injectable()
export class StoFleetImagePublisher extends FleetScopeImagePublisher<StoFleetEntity> {
  /** The kind of record this publishes for. */
  readonly subject = FileAssetSubject.FLEET;

  /**
   * Creates an instance of StoFleetImagePublisher.
   *
   * @param fleets - Repository of Fleets.
   * @param registry - Which publisher writes which table.
   */
  constructor(
    @InjectRepository(StoFleetEntity)
    fleets: Repository<StoFleetEntity>,
    registry: AssetPublisherRegistry,
  ) {
    super(fleets, registry);
  }
}

/** Puts cleared artwork on an Armada. */
@Injectable()
export class StoArmadaImagePublisher extends FleetScopeImagePublisher<StoArmadaEntity> {
  /** The kind of record this publishes for. */
  readonly subject = FileAssetSubject.ARMADA;

  /**
   * Creates an instance of StoArmadaImagePublisher.
   *
   * @param armadas - Repository of Armadas.
   * @param registry - Which publisher writes which table.
   */
  constructor(
    @InjectRepository(StoArmadaEntity)
    armadas: Repository<StoArmadaEntity>,
    registry: AssetPublisherRegistry,
  ) {
    super(armadas, registry);
  }
}
