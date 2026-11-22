import { describe, expect, it, jest } from '@jest/globals';

import { IS_PUBLIC_KEY } from 'src/auth/public.decorator';

import { ImageAddressRenewalService } from './delivery/image-address-renewal.service';
import { ImageAddressRenewalController } from './image-address-renewal.controller';

describe('ImageAddressRenewalController', () => {
  it('answers with each address renewed, in order', () => {
    const renew = jest.fn<(addresses: string[]) => (string | null)[]>(() => [
      'https://renewed.test/a',
      null,
    ]);
    const controller = new ImageAddressRenewalController({
      renew,
    } as unknown as ImageAddressRenewalService);

    expect(
      controller.renew({
        addresses: ['https://old.test/a', 'https://old.test/b'],
      }),
    ).toEqual({ addresses: ['https://renewed.test/a', null] });
    expect(renew).toHaveBeenCalledWith([
      'https://old.test/a',
      'https://old.test/b',
    ]);
  });

  it('is open to a signed-out visitor', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        ImageAddressRenewalController.prototype.renew,
      ),
    ).toBe(true);
  });
});
