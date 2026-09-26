import { EntityManager } from 'typeorm';

import { usernamesFor } from './recruitment-names.utility';

describe('usernamesFor', () => {
  it('reads each user’s username once, skipping nulls', async () => {
    const find = jest.fn(() =>
      Promise.resolve([
        { userId: 'user-1', username: 'Kell' },
        { userId: 'user-2', username: 'Tovan' },
      ]),
    );

    const names = await usernamesFor({ find } as unknown as EntityManager, [
      'user-1',
      null,
      'user-2',
      'user-1',
    ]);

    expect(names).toEqual(
      new Map([
        ['user-1', 'Kell'],
        ['user-2', 'Tovan'],
      ]),
    );
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        select: { userId: true, username: true },
      }),
    );
  });

  it('asks nothing when there is nobody to name', async () => {
    const find = jest.fn();

    await expect(
      usernamesFor({ find } as unknown as EntityManager, [null]),
    ).resolves.toEqual(new Map());
    expect(find).not.toHaveBeenCalled();
  });
});
