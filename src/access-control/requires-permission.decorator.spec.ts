import { PERMISSION_CODES } from './constants/permission-codes.constants';
import {
  REQUIRES_PERMISSION_KEY,
  RequiresPermission,
} from './requires-permission.decorator';

describe('RequiresPermission decorator', () => {
  it('sets the permission metadata on the target', () => {
    class TestController {
      @RequiresPermission(PERMISSION_CODES.STORYTIME_MODERATE)
      handler() {}
    }

    const metadata = Reflect.getMetadata(
      REQUIRES_PERMISSION_KEY,
      TestController.prototype.handler,
    );

    expect(metadata).toEqual([PERMISSION_CODES.STORYTIME_MODERATE]);
  });

  it('records every permission when several are required', () => {
    class TestController {
      @RequiresPermission(
        PERMISSION_CODES.STORYTIME_MODERATE,
        PERMISSION_CODES.STORYTIME_CONFIGURE,
      )
      handler() {}
    }

    const metadata = Reflect.getMetadata(
      REQUIRES_PERMISSION_KEY,
      TestController.prototype.handler,
    );

    expect(metadata).toEqual([
      PERMISSION_CODES.STORYTIME_MODERATE,
      PERMISSION_CODES.STORYTIME_CONFIGURE,
    ]);
  });
});
