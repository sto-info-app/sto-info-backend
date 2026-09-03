import 'reflect-metadata';

import { IS_PUBLIC_KEY, Public } from './public.decorator';

describe('PublicDecorator', () => {
  it('should set the isPublic metadata to true', () => {
    class Test {
      @Public()
      method() {}
    }

    const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, Test.prototype.method);
    expect(isPublic).toBe(true);
  });
});
