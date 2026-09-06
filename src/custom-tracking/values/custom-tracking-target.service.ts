import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Repository } from 'typeorm';

import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';

/**
 * One of a user's STO records, as a value is recorded against it.
 *
 * The two scopes are unified here so everything above can work in terms of
 * "the record being edited" rather than branching on Account or Character at
 * every step.
 */
export interface CustomTrackingTarget {
  /** Which kind of record this is. */
  scope: CustomTrackingTargetScope;
  /** The record's identifier. */
  id: string;
  /** What to call it in the interface. */
  label: string;
  /** Whether the record itself is publicly visible. */
  publiclyVisible: boolean;
}

/**
 * Finding the Account or Character a value belongs to, as its owner.
 *
 * Every value is recorded against a record the user owns, so this check runs
 * before anything is read or written. A missing record and somebody else's are
 * the same answer: telling them apart would let anybody discover which
 * identifiers exist by watching which ones are refused differently.
 *
 * Deleted records are excluded rather than merely unowned. A soft-deleted
 * Account is on its way out under the retention policy, and letting values be
 * recorded against it would keep creating rows for something nobody can see.
 */
@Injectable()
export class CustomTrackingTargetService {
  /**
   * Creates an instance of CustomTrackingTargetService.
   *
   * @param _accountRepository - Repository of STO Accounts.
   * @param _characterRepository - Repository of STO Characters.
   */
  constructor(
    @InjectRepository(AccountEntity)
    private readonly _accountRepository: Repository<AccountEntity>,
    @InjectRepository(CharacterEntity)
    private readonly _characterRepository: Repository<CharacterEntity>,
  ) {}

  /**
   * Finds one of a user's records.
   *
   * @param userId - The user asking.
   * @param scope - Whether an Account or a Character is wanted.
   * @param targetId - The record wanted.
   * @returns The record.
   * @throws NotFoundException when it is not theirs, or not there.
   */
  findOwned(
    userId: string,
    scope: CustomTrackingTargetScope,
    targetId: string,
  ): Promise<CustomTrackingTarget> {
    return scope === CustomTrackingTargetScope.ACCOUNT
      ? this.findOwnedAccount(userId, targetId)
      : this.findOwnedCharacter(userId, targetId);
  }

  /**
   * Lists every record of a user's in one scope.
   *
   * Used by the value editor to offer somewhere to record against, and by the
   * whole-record save to know what it is saving.
   *
   * @param userId - The user asking.
   * @param scope - Which kind of record to list.
   * @returns Their records, in a stable order.
   */
  listOwned(
    userId: string,
    scope: CustomTrackingTargetScope,
  ): Promise<CustomTrackingTarget[]> {
    return scope === CustomTrackingTargetScope.ACCOUNT
      ? this.listOwnedAccounts(userId)
      : this.listOwnedCharacters(userId);
  }

  /**
   * Builds the condition selecting one record's values.
   *
   * Here rather than in each service that needs it, because getting it wrong
   * means reading or writing another record's answers — and two copies of a
   * condition like that is one copy too many.
   *
   * @param target - The record.
   * @returns The condition.
   */
  whereFor(target: CustomTrackingTarget): {
    accountId?: string;
    characterId?: string;
    deletedAt: ReturnType<typeof IsNull>;
  } {
    return target.scope === CustomTrackingTargetScope.ACCOUNT
      ? { accountId: target.id, deletedAt: IsNull() }
      : { characterId: target.id, deletedAt: IsNull() };
  }

  /**
   * Finds one of a user's STO Accounts.
   *
   * @param userId - The user asking.
   * @param accountId - The Account wanted.
   * @returns The Account, as a target.
   * @throws NotFoundException when it is not theirs, or not there.
   */
  private async findOwnedAccount(
    userId: string,
    accountId: string,
  ): Promise<CustomTrackingTarget> {
    const account = await this._accountRepository.findOne({
      where: { id: accountId, userId, deletedAt: IsNull() },
    });

    if (!account) {
      throw new NotFoundException('That account could not be found.');
    }

    return this.toAccountTarget(account);
  }

  /**
   * Finds one of a user's STO Characters.
   *
   * Ownership runs through the Account, because a Character has no owner of
   * its own.
   *
   * @param userId - The user asking.
   * @param characterId - The Character wanted.
   * @returns The Character, as a target.
   * @throws NotFoundException when it is not theirs, or not there.
   */
  private async findOwnedCharacter(
    userId: string,
    characterId: string,
  ): Promise<CustomTrackingTarget> {
    const character = await this._characterRepository.findOne({
      where: {
        id: characterId,
        deletedAt: IsNull(),
        account: { userId, deletedAt: IsNull() },
      },
      relations: { account: true },
    });

    if (!character) {
      throw new NotFoundException('That character could not be found.');
    }

    return this.toCharacterTarget(character);
  }

  /**
   * Lists a user's STO Accounts.
   *
   * @param userId - The user asking.
   * @returns Their Accounts, as targets.
   */
  private async listOwnedAccounts(
    userId: string,
  ): Promise<CustomTrackingTarget[]> {
    const accounts = await this._accountRepository.find({
      where: { userId, deletedAt: IsNull() },
      order: { handle: 'ASC', id: 'ASC' },
    });

    return accounts.map(account => this.toAccountTarget(account));
  }

  /**
   * Lists a user's STO Characters, across all of their Accounts.
   *
   * @param userId - The user asking.
   * @returns Their Characters, as targets.
   */
  private async listOwnedCharacters(
    userId: string,
  ): Promise<CustomTrackingTarget[]> {
    const characters = await this._characterRepository.find({
      where: { deletedAt: IsNull(), account: { userId, deletedAt: IsNull() } },
      relations: { account: true },
      order: { fullHandle: 'ASC', id: 'ASC' },
    });

    return characters.map(character => this.toCharacterTarget(character));
  }

  /**
   * Describes an Account as a target.
   *
   * @param account - The Account.
   * @returns The target.
   */
  private toAccountTarget(account: AccountEntity): CustomTrackingTarget {
    return {
      scope: CustomTrackingTargetScope.ACCOUNT,
      id: account.id,
      label: account.handle,
      publiclyVisible: account.publiclyVisible,
    };
  }

  /**
   * Describes a Character as a target.
   *
   * A Character's own visibility is reported here, not its Account's. The
   * public projection needs both, and conflating them at this level would hide
   * which of the two gates actually closed.
   *
   * @param character - The Character.
   * @returns The target.
   */
  private toCharacterTarget(character: CharacterEntity): CustomTrackingTarget {
    return {
      scope: CustomTrackingTargetScope.CHARACTER,
      id: character.id,
      label: character.fullHandle,
      publiclyVisible: character.publiclyVisible,
    };
  }
}
