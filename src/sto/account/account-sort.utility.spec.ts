import {
  AccountSortBy,
  AccountSortOrder,
  SortableAccount,
  sortAccounts,
} from './account-sort.utility';

describe('sortAccounts', () => {
  const account = (
    handle: string,
    overrides: Partial<SortableAccount> = {},
  ): SortableAccount => ({
    handle,
    characterCount: 0,
    endeavourTotalNodes: 0,
    accountCreatedDate: null,
    pinnedAt: null,
    ...overrides,
  });

  const handles = (accounts: SortableAccount[]): string[] =>
    accounts.map(entry => entry.handle);

  it('orders by handle ascending by default', () => {
    const result = sortAccounts([
      account('Sisko'),
      account('Archer'),
      account('Picard'),
    ]);

    expect(handles(result)).toEqual(['Archer', 'Picard', 'Sisko']);
  });

  it('orders by handle descending', () => {
    const result = sortAccounts(
      [account('Archer'), account('Sisko'), account('Picard')],
      AccountSortBy.Handle,
      AccountSortOrder.Desc,
    );

    expect(handles(result)).toEqual(['Sisko', 'Picard', 'Archer']);
  });

  // Handles are user-chosen and mixed case, so ordering must not put every
  // lower-case handle after every upper-case one.
  it('compares handles case-insensitively', () => {
    const result = sortAccounts([
      account('picard'),
      account('Archer'),
      account('SISKO'),
    ]);

    expect(handles(result)).toEqual(['Archer', 'picard', 'SISKO']);
  });

  it('does not modify the array it was given', () => {
    const input = [account('Sisko'), account('Archer')];

    sortAccounts(input);

    expect(handles(input)).toEqual(['Sisko', 'Archer']);
  });

  describe('by captain count', () => {
    it('orders ascending', () => {
      const result = sortAccounts(
        [
          account('Archer', { characterCount: 9 }),
          account('Picard', { characterCount: 2 }),
          account('Sisko', { characterCount: 5 }),
        ],
        AccountSortBy.CharacterCount,
      );

      expect(handles(result)).toEqual(['Picard', 'Sisko', 'Archer']);
    });

    it('orders descending', () => {
      const result = sortAccounts(
        [
          account('Picard', { characterCount: 2 }),
          account('Archer', { characterCount: 9 }),
          account('Sisko', { characterCount: 5 }),
        ],
        AccountSortBy.CharacterCount,
        AccountSortOrder.Desc,
      );

      expect(handles(result)).toEqual(['Archer', 'Sisko', 'Picard']);
    });
  });

  describe('by endeavour nodes', () => {
    it('orders ascending', () => {
      const result = sortAccounts(
        [
          account('Archer', { endeavourTotalNodes: 900 }),
          account('Picard', { endeavourTotalNodes: 120 }),
        ],
        AccountSortBy.EndeavourTotalNodes,
      );

      expect(handles(result)).toEqual(['Picard', 'Archer']);
    });

    it('orders descending', () => {
      const result = sortAccounts(
        [
          account('Picard', { endeavourTotalNodes: 120 }),
          account('Archer', { endeavourTotalNodes: 900 }),
        ],
        AccountSortBy.EndeavourTotalNodes,
        AccountSortOrder.Desc,
      );

      expect(handles(result)).toEqual(['Archer', 'Picard']);
    });
  });

  describe('by account created date', () => {
    const dated = (handle: string, iso: string): SortableAccount =>
      account(handle, { accountCreatedDate: new Date(iso) });

    it('orders oldest first ascending', () => {
      const result = sortAccounts(
        [
          dated('Sisko', '2015-06-01'),
          dated('Archer', '2010-01-01'),
          dated('Picard', '2012-03-01'),
        ],
        AccountSortBy.AccountCreatedDate,
      );

      expect(handles(result)).toEqual(['Archer', 'Picard', 'Sisko']);
    });

    it('orders newest first descending', () => {
      const result = sortAccounts(
        [
          dated('Archer', '2010-01-01'),
          dated('Sisko', '2015-06-01'),
          dated('Picard', '2012-03-01'),
        ],
        AccountSortBy.AccountCreatedDate,
        AccountSortOrder.Desc,
      );

      expect(handles(result)).toEqual(['Sisko', 'Picard', 'Archer']);
    });

    // The date is optional, so reversing the order must not promote the
    // accounts that simply have nothing recorded to the top of the list.
    it('puts accounts with no recorded date last when ascending', () => {
      const result = sortAccounts(
        [
          account('Archer'),
          dated('Sisko', '2015-06-01'),
          dated('Picard', '2012-03-01'),
        ],
        AccountSortBy.AccountCreatedDate,
      );

      expect(handles(result)).toEqual(['Picard', 'Sisko', 'Archer']);
    });

    it('puts accounts with no recorded date last when descending', () => {
      const result = sortAccounts(
        [
          account('Archer'),
          dated('Picard', '2012-03-01'),
          dated('Sisko', '2015-06-01'),
        ],
        AccountSortBy.AccountCreatedDate,
        AccountSortOrder.Desc,
      );

      expect(handles(result)).toEqual(['Sisko', 'Picard', 'Archer']);
    });

    // The same pair in the opposite input order must reach the same answer, so
    // both sides of the unset-date comparison are exercised.
    it('puts an account with no recorded date last whichever side it arrives on', () => {
      const result = sortAccounts(
        [dated('Picard', '2012-03-01'), account('Archer')],
        AccountSortBy.AccountCreatedDate,
      );

      expect(handles(result)).toEqual(['Picard', 'Archer']);
    });

    it('falls back to handle order between two accounts with no date', () => {
      const result = sortAccounts(
        [account('Sisko'), account('Archer')],
        AccountSortBy.AccountCreatedDate,
      );

      expect(handles(result)).toEqual(['Archer', 'Sisko']);
    });

    it('falls back to handle order between two identical dates', () => {
      const result = sortAccounts(
        [dated('Sisko', '2012-03-01'), dated('Archer', '2012-03-01')],
        AccountSortBy.AccountCreatedDate,
      );

      expect(handles(result)).toEqual(['Archer', 'Sisko']);
    });
  });

  describe('pinning', () => {
    const pinned = (
      handle: string,
      overrides: Partial<SortableAccount> = {},
    ): SortableAccount =>
      account(handle, { pinnedAt: new Date('2026-01-01'), ...overrides });

    it('puts pinned accounts before unpinned ones', () => {
      const result = sortAccounts([
        account('Archer'),
        pinned('Sisko'),
        account('Picard'),
      ]);

      expect(handles(result)).toEqual(['Sisko', 'Archer', 'Picard']);
    });

    it('keeps pinned accounts first when ordering descending', () => {
      const result = sortAccounts(
        [account('Archer'), pinned('Sisko'), account('Picard')],
        AccountSortBy.Handle,
        AccountSortOrder.Desc,
      );

      expect(handles(result)).toEqual(['Sisko', 'Picard', 'Archer']);
    });

    // Pinning groups rather than orders: within the pinned block the chosen
    // sort still decides, so a pin does not freeze an account's position.
    it('applies the chosen sort within the pinned group', () => {
      const result = sortAccounts(
        [
          pinned('Archer', { characterCount: 1 }),
          pinned('Sisko', { characterCount: 7 }),
          account('Picard', { characterCount: 4 }),
        ],
        AccountSortBy.CharacterCount,
        AccountSortOrder.Desc,
      );

      expect(handles(result)).toEqual(['Sisko', 'Archer', 'Picard']);
    });

    it('applies the chosen sort within the unpinned group', () => {
      const result = sortAccounts(
        [
          account('Archer', { characterCount: 1 }),
          account('Sisko', { characterCount: 7 }),
          pinned('Picard', { characterCount: 4 }),
        ],
        AccountSortBy.CharacterCount,
        AccountSortOrder.Desc,
      );

      expect(handles(result)).toEqual(['Picard', 'Sisko', 'Archer']);
    });

    it('leaves the order unchanged when every account is pinned', () => {
      const result = sortAccounts([pinned('Sisko'), pinned('Archer')]);

      expect(handles(result)).toEqual(['Archer', 'Sisko']);
    });
  });
});
