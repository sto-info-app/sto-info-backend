import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { AccessControlAdminController } from './access-control-admin.controller';
import { AccessControlAdminService } from './access-control-admin.service';
import { AccessControlController } from './access-control.controller';
import { AccessControlService } from './access-control.service';
import { PermissionEntity } from './entities/permission.entity';
import { UserLimitOverrideEntity } from './entities/user-limit-override.entity';
import { UserPermissionOverrideEntity } from './entities/user-permission-override.entity';
import { LimitService } from './limit.service';
import { PermissionsGuard } from './permissions.guard';

/**
 * Application-wide permission and limit resolution.
 *
 * Marked global because authorisation is cross-cutting: any feature module may
 * need to ask what a user is allowed to do, and threading an import through
 * every one of them would add noise without adding safety.
 *
 * This module is purely additive. The existing roles guard and every
 * `@Roles(UserRole.ADMIN)` check keep working untouched, so adopting the
 * permission framework cannot regress the administration screens that predate
 * it. Migrating those checks is deliberately separate work.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PermissionEntity,
      UserPermissionOverrideEntity,
      UserLimitOverrideEntity,
      UserEntity,
    ]),
  ],
  controllers: [AccessControlController, AccessControlAdminController],
  providers: [
    AccessControlService,
    LimitService,
    PermissionsGuard,
    AccessControlAdminService,
  ],
  exports: [AccessControlService, LimitService, PermissionsGuard],
})
export class AccessControlModule {}
