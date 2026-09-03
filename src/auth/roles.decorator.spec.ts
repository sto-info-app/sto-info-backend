import { UserRole } from 'src/user/enums/user-role.enum';

import { Roles, ROLES_KEY } from './roles.decorator';

describe('Roles decorator', () => {
  it('sets the roles metadata on the target', () => {
    class TestController {
      @Roles(UserRole.ADMIN)
      handler() {}
    }

    const metadata = Reflect.getMetadata(
      ROLES_KEY,
      TestController.prototype.handler,
    );

    expect(metadata).toEqual([UserRole.ADMIN]);
  });
});
