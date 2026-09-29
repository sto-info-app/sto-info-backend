import { Module } from '@nestjs/common';

import { SecurityLogController } from './security-log.controller';
import { SecurityLogService } from './security-log.service';

/** The site admins' Security Log (FC-039). */
@Module({
  controllers: [SecurityLogController],
  providers: [SecurityLogService],
})
export class SecurityLogModule {}
