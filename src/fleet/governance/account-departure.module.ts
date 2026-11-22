import { Global, Module } from '@nestjs/common';

import { ACCOUNT_DEPARTURE } from 'src/user/account-departure';

import { FleetGovernanceModule } from './fleet-governance.module';
import { CommunityOwnerDepartureService } from './services/community-owner-departure.service';

/**
 * Offers the Fleet's part in closing and erasing an account (FC-038) to the
 * user module and the nightly cleanup, which cannot import the Fleet
 * without a cycle.
 */
@Global()
@Module({
  imports: [FleetGovernanceModule],
  providers: [
    { provide: ACCOUNT_DEPARTURE, useExisting: CommunityOwnerDepartureService },
  ],
  exports: [ACCOUNT_DEPARTURE],
})
export class AccountDepartureModule {}
