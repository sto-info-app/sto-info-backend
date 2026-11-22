import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SecretsService } from 'src/shared/secrets/secrets.service';
import { SharedModule } from 'src/shared/shared.module';

import { ROSTER_ERASURE_SECRET_KEY } from './roster-erasure.constants';
import { RosterErasureEntity } from './roster-erasure.entity';
import {
  ROSTER_ERASURE_KEY,
  RosterErasureKey,
  RosterSuppressionService,
} from './roster-suppression.service';

/**
 * The suppression list and its key (FC-038), for the importer to scrub
 * against and the erasure service to add to. Depends on nothing of the
 * Fleet's, so both can import it.
 */
@Module({
  imports: [SharedModule, TypeOrmModule.forFeature([RosterErasureEntity])],
  providers: [
    RosterSuppressionService,
    {
      provide: ROSTER_ERASURE_KEY,
      useFactory: async (
        configService: ConfigService,
        secretsService: SecretsService,
      ): Promise<RosterErasureKey> => {
        const secret = await secretsService.getSecret(
          configService.get<string>('AWS_SECRET_NAME')!,
        );
        const value: unknown = secret?.[ROSTER_ERASURE_SECRET_KEY];

        return {
          value: typeof value === 'string' && value.length > 0 ? value : null,
        };
      },
      inject: [ConfigService, SecretsService],
    },
  ],
  exports: [RosterSuppressionService],
})
export class FleetErasureCoreModule {}
