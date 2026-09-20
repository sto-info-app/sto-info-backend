import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as bcrypt from 'bcrypt';
import { In, Repository } from 'typeorm';

import { FileAssetAudience } from 'src/file-assets/enums/file-asset-audience.enum';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AcceptedAsset } from 'src/file-assets/services/asset-ingress.service';
import { ImageIngressService } from 'src/file-assets/services/image-ingress.service';
import { MailService } from 'src/mail/mail.service';
import { UserSearchQueryDto } from 'src/notification/dto/user-search-query.dto';
import { UserSearchPageDto } from 'src/notification/dto/user-search-result.dto';
import { DEFAULT_MULTER_LIMITS } from 'src/shared/constants/file-upload.constants';
import { ValidatorsService } from 'src/shared/utilities/validators.service';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { UserRefreshTokenEntity } from 'src/user-refresh-token/entities/user-refresh-token.entity';

import { PROFILE_IMAGE_ENTITY_TAG } from './constants/profile-image.constants';
import { resolveSessionTimeoutMinutes } from './constants/session-timeout.constants';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserSettingsDto } from './dto/user-settings.dto';
import { UserPreferenceEntity } from './entities/user-preference.entity';
import { UserProfileEntity } from './entities/user-profile.entity';
import { UserEntity } from './entities/user.entity';
import { UserPreferenceService } from './user-preference.service';

@Injectable()
export class UserService {
  private readonly _logger = new Logger(UserService.name);

  /**
   * Creates an instance of UserService.
   *
   * @param _userRepository - The user repository.
   * @param _userProfileRepository - The user profile repository.
   * @param _validatorsService - The validators service.
   * @param _imageIngress - Where an uploaded picture is checked and quarantined.
   * @param _mailService - The mail service.
   * @param _userPreferenceService - Reads and writes account preferences.
   */
  constructor(
    @InjectRepository(UserEntity)
    private readonly _userRepository: Repository<UserEntity>,

    @InjectRepository(UserProfileEntity)
    private readonly _userProfileRepository: Repository<UserProfileEntity>,

    private readonly _validatorsService: ValidatorsService,
    private readonly _imageIngress: ImageIngressService,
    private readonly _mailService: MailService,
    private readonly _userPreferenceService: UserPreferenceService,
  ) {}

  /**
   * Retrieves the authenticated user's application settings.
   *
   * @param userId Authenticated user ID.
   * @returns The user's settings.
   */
  async getSettings(userId: string): Promise<UserSettingsDto> {
    // Still resolved through the profile so that a request for a user who does
    // not exist fails the same way it always has, rather than quietly returning
    // a set of defaults for an account that is not there.
    await this._getUserProfile(userId);

    const preference = await this._userPreferenceService.get(userId);

    return new UserSettingsDto(
      preference,
      this.getSessionTimeoutMinutes(preference),
    );
  }

  /**
   * Updates the authenticated user's application settings.
   *
   * @param userId Authenticated user ID.
   * @param settings Settings to persist.
   * @returns The updated settings.
   */
  async updateSettings(
    userId: string,
    settings: UpdateUserSettingsDto,
  ): Promise<UserSettingsDto> {
    await this._getUserProfile(userId);

    // Spread rather than assigned field by field: every optional field is
    // absent when the client did not send it, and `UserPreferenceService`
    // changes only what is present. Listing them here would mean a new
    // preference silently failing to save until somebody remembered this line.
    const updated = await this._userPreferenceService.update(userId, {
      ...settings,
    });

    return new UserSettingsDto(updated, this.getSessionTimeoutMinutes(updated));
  }

  /**
   * Returns the user's inactivity timeout, falling back to the deployment
   * default when they have never chosen one.
   *
   * @param preference - The preferences holding the stored choice.
   * @returns The inactivity timeout to apply, in minutes.
   */
  getSessionTimeoutMinutes(
    preference: Pick<UserPreferenceEntity, 'sessionTimeoutMinutes'>,
  ): number {
    return resolveSessionTimeoutMinutes(preference.sessionTimeoutMinutes);
  }

  /**
   * Create a new user account.
   *
   * @param createUserDto - Data for the new user, including email and password.
   * @returns A promise that resolves to the newly created UserEntity.
   * @throws HttpException if the email is invalid, the password is missing, or the email is already in use.
   */
  async create(createUserDto: CreateUserDto): Promise<UserEntity> {
    this._logger.debug(
      `[create] Creating new user - Email: ${createUserDto.email}`,
    );

    if (!this.validateEmailUsername(createUserDto.email)) {
      this._logger.warn(
        `[create] Invalid email format - Email: ${createUserDto.email}`,
      );
      throw new HttpException('Invalid email', HttpStatus.BAD_REQUEST);
    }

    if (!createUserDto.password) {
      this._logger.warn(
        `[create] Missing password - Email: ${createUserDto.email}`,
      );
      throw new HttpException('Invalid password', HttpStatus.BAD_REQUEST);
    }

    if (
      await this._userRepository.findOne({
        where: { email: createUserDto.email },
      })
    ) {
      this._logger.warn(
        `[create] Email already exists - Email: ${createUserDto.email}`,
      );
      throw new HttpException('Email already in use', HttpStatus.BAD_REQUEST);
    }

    const user = new UserEntity();
    user.email = createUserDto.email;
    user.password = await bcrypt.hash(
      createUserDto.password,
      +process.env.AUTH_SALT_ROUNDS!,
    );
    user.emailVerified = false;

    const newUser = await this._userRepository.save(user);

    this._logger.log(
      `[create] User created successfully - UserId: ${newUser.id}, Email: ${newUser.email}`,
    );
    return newUser;
  }

  /**
   * Update an existing user's basic account data.
   *
   * @param id - The UUID of the user to update.
   * @param post - The updated user data.
   * @returns A promise that resolves to the updated UserEntity.
   * @throws HttpException if the ID is invalid or the user is not found after update.
   */
  async update(id: string, post: UpdateUserDto): Promise<UserEntity> {
    if (!id || !this._validatorsService.validateUuid(id)) {
      throw new HttpException(
        'Invalid username and password',
        HttpStatus.NOT_FOUND,
      );
    }

    await this._userRepository.update(id, post);
    const updatedUser = await this._userRepository.findOne({
      where: { id: id },
    });
    if (updatedUser) {
      return updatedUser;
    }

    throw new HttpException(
      'Invalid username and password',
      HttpStatus.NOT_FOUND,
    );
  }

  /**
   * Soft-delete a user account by ID.
   *
   * @param id - The UUID of the user to delete.
   * @returns A promise that resolves when the deletion is complete.
   * @throws HttpException if the ID is invalid or no user was affected by the deletion.
   */
  async delete(id: string) {
    if (!id || !this._validatorsService.validateUuid(id)) {
      throw new HttpException(
        'Invalid username and password',
        HttpStatus.NOT_FOUND,
      );
    }

    const deletedUser = await this._userRepository.softDelete(id);
    if (!deletedUser.affected) {
      throw new HttpException(
        'Invalid username and password',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  /**
   * Marks the authenticated user's account data as deleted.
   *
   * This performs a coordinated soft-delete across the user, profile,
   * STO accounts, and STO characters, and revokes active refresh tokens
   * immediately to terminate active sessions.
   *
   * @param userId - The authenticated user's UUID.
   */
  async closeAccount(userId: string): Promise<void> {
    if (!userId || !this._validatorsService.validateUuid(userId)) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const user = await this._userRepository.findOne({
      where: { id: userId },
      relations: { profile: true },
    });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const closureEmail = user.email;
    const closureFirstName = user.profile?.firstName || 'Captain!';

    await this._userRepository.manager.transaction(async manager => {
      await manager.update(
        UserRefreshTokenEntity,
        { userId, isRevoked: false },
        { isRevoked: true },
      );

      const ownedAccounts = await manager.find(AccountEntity, {
        where: { userId },
        select: { id: true },
      });

      const accountIds = ownedAccounts.map(account => account.id);

      if (accountIds.length) {
        await manager.softDelete(CharacterEntity, {
          accountId: In(accountIds),
        });
      }

      await manager.softDelete(AccountEntity, { userId });
      await manager.softDelete(UserProfileEntity, { userId });
      await manager.softDelete(UserEntity, userId);
    });

    await this._mailService.sendAccountClosureEmail(
      closureEmail,
      closureFirstName,
    );
  }

  /**
   * Find a user by their unique ID, including their profile relations.
   *
   * @param id - The UUID string of the user.
   * @returns A promise that resolves to the UserEntity.
   * @throws HttpException if the ID is invalid or the user is not found.
   */
  async findById(id: string): Promise<UserEntity> {
    if (!id || !this._validatorsService.validateUuid(id)) {
      throw new HttpException(
        'Invalid username and password',
        HttpStatus.NOT_FOUND,
      );
    }

    const user = await this._userRepository.findOne({
      where: {
        id: id,
      },
      relations: { profile: true },
    });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    return user;
  }

  /**
   * Find a user by their email address, including their profile relation.
   *
   * @param email - The email address to search for.
   * @returns A promise that resolves to the UserEntity or null if not found.
   */
  async findByEmail(email: string): Promise<UserEntity | null> {
    // Preferences come along because the login path sizes the refresh token to
    // the user's chosen inactivity window; without them every session would
    // silently fall back to the deployment default.
    return await this._userRepository.findOne({
      where: { email: email },
      relations: { profile: true, preference: true },
    });
  }

  /**
   * Update the email verification status for a user.
   *
   * @param email - The email address of the user.
   * @param verified - The new verification status.
   * @returns A promise that resolves when the update is complete.
   * @throws HttpException if the user is not found.
   */
  async updateUserEmailVerifiedStatus(
    email: string,
    verified: boolean,
  ): Promise<void> {
    const user = await this._userRepository.findOne({
      where: { email: email },
    });
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    user.emailVerified = verified;
    await this._userRepository.save(user);
  }

  /**
   * Validate if an email string has a correct format.
   *
   * @param email - The email string to validate.
   * @returns `true` if the email is valid; `false` otherwise.
   */
  validateEmailUsername(email: string): boolean {
    if (!email) {
      return false;
    }
    return this._validatorsService.validateEmail(email);
  }

  /**
   * Gets the profile owned by an authenticated user.
   *
   * @param userId Authenticated user ID.
   * @returns The user's profile.
   * @throws HttpException when the identifier is invalid or the profile is absent.
   */
  private async _getUserProfile(userId: string): Promise<UserProfileEntity> {
    if (!userId || !this._validatorsService.validateUuid(userId)) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const profile = await this._userProfileRepository.findOne({
      where: { userId },
    });

    if (!profile) {
      throw new HttpException('User data not found', HttpStatus.NOT_FOUND);
    }

    return profile;
  }

  /**
   * Update a user's profile information.
   *
   * @param userId - The UUID of the user owning the profile.
   * @param userProfileData - The updated profile details.
   * @returns A promise resolving to the number of affected rows and the updated UserProfileEntity.
   * @throws HttpException if the user or profile is not found, or if the username already exists.
   */
  async updateUserProfile(
    userId: string,
    userProfileData: UpdateUserProfileDto,
  ): Promise<{ affected: number; updatedProfile: UserProfileEntity }> {
    if (!userId || !this._validatorsService.validateUuid(userId)) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const user = await this._userRepository.findOne({
      where: { id: userId },
      relations: { profile: true },
    });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    if (!user.profile?.userId || user.profile.userId !== userId) {
      throw new HttpException('User data not found', HttpStatus.NOT_FOUND);
    }

    const keys = Object.keys(userProfileData) as Array<
      keyof UpdateUserProfileDto
    >;
    const isProfileUnchanged = keys.every(key => {
      return userProfileData[key] === (user.profile as any)[key];
    });

    if (isProfileUnchanged) {
      return { affected: 0, updatedProfile: user.profile };
    }

    if (userProfileData.username !== user.profile.username) {
      const usernameExists = await this.doesUsernameExist(
        userProfileData.username,
      );
      if (usernameExists) {
        throw new HttpException('Username already exists', HttpStatus.CONFLICT);
      }
    }

    //NOTE: Use the original user profile data to save the non-updated data as the audit subscriber will not detect old values in an update(), so save() is used instead
    userProfileData.userId = userId;
    userProfileData.profilePictureId = user.profile.profilePictureId;
    // Registry opt-in is settable here, but an omitted value must never
    // silently flip a profile's visibility, so fall back to the stored flag.
    userProfileData.publiclyVisible =
      userProfileData.publiclyVisible ?? user.profile.publiclyVisible;

    const updateResult =
      await this._userProfileRepository.save(userProfileData);
    if (!updateResult) {
      throw new HttpException(
        'User profile update failed',
        HttpStatus.NOT_FOUND,
      );
    }

    const updatedProfile = await this._userProfileRepository.findOne({
      where: { userId: userId },
    });

    if (!updatedProfile) {
      throw new HttpException(
        'Updated profile not found',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      affected: 1,
      updatedProfile: updatedProfile,
    };
  }

  /**
   * Checks if a username already exists in the user profile repository.
   *
   * @param username - The username to check for existence.
   * @returns A promise that resolves to a boolean indicating whether the username exists.
   */
  async doesUsernameExist(username: string): Promise<boolean> {
    const count = await this._userProfileRepository
      .createQueryBuilder('user_profile')
      .where('LOWER(user_profile.username) = LOWER(:username)', { username })
      .getCount();
    return count > 0;
  }

  /**
   * Checks if an email already exists in the user repository.
   *
   * @param email - The email to check for existence.
   * @returns A promise that resolves to a boolean indicating whether the email exists.
   */
  async doesEmailExist(email: string): Promise<boolean> {
    const count = await this._userRepository
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getCount();
    return count > 0;
  }

  /**
   * Accepts a new profile picture and sends it to be scanned.
   *
   * Nothing is published here and the profile is not written to. The picture
   * reaches the account when a scanner has cleared it, which is seconds
   * later and in another process; until then the account keeps the picture
   * it had. FC-012.
   *
   * @param userId - The ID of the user.
   * @param file - The file to be uploaded.
   * @returns The asset to ask about, and how far along it is.
   * @throws HttpException if the user is not found.
   */
  async uploadProfilePicture(
    userId: string,
    file: Express.Multer.File,
  ): Promise<AcceptedAsset> {
    if (!userId || !this._validatorsService.validateUuid(userId)) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const user = await this._userRepository.findOne({
      where: { id: userId },
      relations: { profile: true },
    });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    if (!user.profile?.userId || user.profile.userId !== userId) {
      throw new HttpException('User data not found', HttpStatus.NOT_FOUND);
    }

    // The profile is left exactly as it is. Whatever picture it shows goes
    // on being shown until a scanner has cleared the new one and
    // UserProfileImagePublisher swaps the reference over, which is the
    // third acceptance criterion: a replacement that is refused costs the
    // uploader nothing.
    return this._imageIngress.accept({
      spec: null,
      userId,
      kind: FileAssetKind.PROFILE_IMAGE,
      audience: FileAssetAudience.PUBLIC,
      subject: FileAssetSubject.USER_PROFILE,
      subjectId: userId,
      slot: FileAssetSlot.PICTURE,
      entityTag: PROFILE_IMAGE_ENTITY_TAG,
      entityId: userId,
      maximumBytes:
        Number(process.env.MAX_IMAGE_SIZE_IN_BYTES) ||
        DEFAULT_MULTER_LIMITS.fileSize,
      sizeLimitLabel: 'Profile pictures',
      file,
    });
  }

  /**
   * Searches users by username or real name.
   *
   * Called by the admin notification controller so an administrator can find a
   * recipient without knowing their UUID. Only non-deleted accounts appear.
   *
   * Addresses are searched neither by nor for. A site notification is read
   * where it was written, and an address on the screen that picks its reader
   * only suggests otherwise. What is left is what an administrator actually
   * knows somebody by: their handle, or their name.
   *
   * Each result carries the account's role and last sign-in as well, because a
   * list of names alone leaves an administrator guessing which of two similar
   * accounts they are about to write to.
   *
   * @param query - The search term and pagination options.
   * @returns A paginated page of matching users.
   */
  async searchUsers(query: UserSearchQueryDto): Promise<UserSearchPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 5;
    const term = `%${query.q}%`;

    const [rows, total] = await this._userRepository
      .createQueryBuilder('u')
      .innerJoin('u.profile', 'p')
      .select([
        'u.id',
        'u.role',
        'u.lastLoginAt',
        'p.username',
        'p.firstName',
        'p.lastName',
      ])
      // The two names are matched together as well as apart, so somebody
      // typing a person's whole name finds them rather than nothing.
      .where(
        `p.username ILIKE :term
         OR p.firstName ILIKE :term
         OR p.lastName ILIKE :term
         OR CONCAT(p.firstName, ' ', p.lastName) ILIKE :term`,
        { term },
      )
      .andWhere('u.deletedAt IS NULL')
      .orderBy('p.username', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items: rows.map(u => ({
        id: u.id,
        username: u.profile?.username ?? '',
        fullName: this.fullNameOf(u.profile),
        role: u.role,
        lastLoginAt: u.lastLoginAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * A member's real name, as much of it as they have given.
   *
   * Either half may be missing, and somebody who gave neither has no real name
   * rather than an empty one, so the screen showing them can say so instead of
   * leaving a blank line where a name should be.
   *
   * @param profile - The member's profile, when they have one.
   * @returns The name, or null when there is none.
   */
  private fullNameOf(profile?: UserProfileEntity | null): string | null {
    return (
      [profile?.firstName, profile?.lastName]
        .filter(part => part?.trim())
        .join(' ') || null
    );
  }
}
