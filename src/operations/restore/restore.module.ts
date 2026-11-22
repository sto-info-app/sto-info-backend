import { Module } from '@nestjs/common';

import { FileAssetsModule } from 'src/file-assets/file-assets.module';
import { ChatModule } from 'src/fleet/chat/chat.module';
import { FleetErasureModule } from 'src/fleet/erasure/fleet-erasure.module';
import { FleetRetentionModule } from 'src/fleet/retention/fleet-retention.module';
import { UserModule } from 'src/user/user.module';

import { RestoreCheckService } from './restore-check.service';

/**
 * The restore check (FC-042): the ledgers kept outside the database compared
 * with it at boot, then every retention job caught up (FC-043), before the
 * API serves anything. `main.ts` runs it.
 */
@Module({
  imports: [
    FileAssetsModule,
    ChatModule,
    FleetErasureModule,
    FleetRetentionModule,
    UserModule,
  ],
  providers: [RestoreCheckService],
  exports: [RestoreCheckService],
})
export class RestoreModule {}
