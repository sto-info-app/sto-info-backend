import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FileAssetsModule } from 'src/file-assets/file-assets.module';
import { FileScanningModule } from 'src/file-scanning/file-scanning.module';

import { FleetNameAliasEntity } from '../entities/fleet-name-alias.entity';
import { FleetModule } from '../fleet.module';
import { RosterImportConflictEntity } from './entities/roster-import-conflict.entity';
import { RosterImportSourceEntity } from './entities/roster-import-source.entity';
import { RosterObservationEntity } from './entities/roster-observation.entity';
import { RosterImportsController } from './roster-imports.controller';
import { RosterCsvPrivacyParserService } from './services/roster-csv-privacy-parser.service';
import { RosterExportIdentityService } from './services/roster-export-identity.service';
import { RosterImportConflictService } from './services/roster-import-conflict.service';
import { RosterImportIngressService } from './services/roster-import-ingress.service';
import { RosterImportPreviewService } from './services/roster-import-preview.service';
import { RosterImportStatusService } from './services/roster-import-status.service';
import { RosterImportPublisher } from './services/roster-import.publisher';
import { RosterTypedParserService } from './services/roster-typed-parser.service';

/**
 * Roster CSV ingress: the privacy boundary and the route that runs it.
 *
 * Its own module rather than part of {@link FleetModule}, and that is a
 * dependency decision rather than a filing one. {@link FileAssetsModule}
 * already imports `FleetModule` for the audience service (ADR-0015), so a
 * roster importer registered inside `FleetModule` and needing the asset
 * registry would close the loop. This module sits below both of them:
 * imports → file-assets → fleet, in one direction.
 *
 * It is wired into `AppModule` directly for the same reason.
 */
@Module({
  imports: [
    FleetModule,
    FileAssetsModule,
    FileScanningModule,
    TypeOrmModule.forFeature([
      RosterImportSourceEntity,
      RosterImportConflictEntity,
      RosterObservationEntity,
      FleetNameAliasEntity,
    ]),
  ],
  controllers: [RosterImportsController],
  providers: [
    RosterCsvPrivacyParserService,
    RosterTypedParserService,
    RosterExportIdentityService,
    RosterImportConflictService,
    RosterImportIngressService,
    RosterImportPreviewService,
    RosterImportStatusService,
    RosterImportPublisher,
  ],
  exports: [
    RosterCsvPrivacyParserService,
    RosterTypedParserService,
    RosterExportIdentityService,
    RosterImportIngressService,
    RosterImportPreviewService,
  ],
})
export class FleetRosterImportsModule {}
