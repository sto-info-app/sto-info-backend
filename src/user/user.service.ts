import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { MailService } from 'src/mail/mail.service';
import { ImageUploadsService } from 'src/shared/utilities/image-uploads.service';
import { UserRefreshTokenEntity } from 'src/user-refresh-token/entities/user-refresh-token.entity';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { ValidatorsService } from 'src/shared/utilities/validators.service';
import { In, Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdatedUserProfileResultDto } from './dto/updated-user-profile-result.dto';
import { UserProfileEntity } from './entities/user-profile.entity';
import { UserEntity } from './entities/user.entity';

@Injectable()
export class UserService {
  private readonly _logger = new Logger(UserService.name);

  /**
   * Creates an instance of UserService.
   *
   * @param _userRepository - The user repository.
   * @param _userProfileRepository - The user profile repository.
   * @param _validatorsService - The validators service.
   * @param _imageUploadsService - The image uploads service.
   */
  constructor(
    @InjectRepository(UserEntity)
    private readonly _userRepository: Repository<UserEntity>,

    @InjectRepository(UserProfileEntity)
    private readonly _userProfileRepository: Repository<UserProfileEntity>,

    private readonly _validatorsService: ValidatorsService,
    private readonly _imageUploadsService: ImageUploadsService,
    private readonly _mailService: MailService,
  ) {}

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
    return await this._userRepository.findOne({
      where: { email: email },
      relations: { profile: true },
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
    userProfileData.publiclyVisible = user.profile.publiclyVisible;

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
   * Uploads a profile picture for a user to Cloudflare Images.
   *
   * Automatically deletes the old profile picture from Cloudflare if one existed.
   *
   * @param userId - The ID of the user.
   * @param file - The file to be uploaded.
   * @returns A promise that resolves to the updated user profile result object.
   * @throws HttpException if the user is not found or the upload fails.
   */
  async uploadProfilePicture(
    userId: string,
    file: Express.Multer.File,
  ): Promise<UpdatedUserProfileResultDto> {
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

    const existingProfilePictureId = user.profile.profilePictureId;

    user.profile.profilePictureId =
      await this._imageUploadsService.uploadImageToCloudflareImages(
        userId,
        file,
        'user',
        userId,
      );

    if (!user.profile.profilePictureId) {
      throw new HttpException(
        'Profile picture upload failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const updatedUserProfile = await this._userProfileRepository.save(
      user.profile,
    );

    if (!updatedUserProfile.profilePictureId) {
      throw new HttpException(
        'Profile picture upload failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    if (existingProfilePictureId) {
      await this._imageUploadsService.deleteImageFromCloudflareImages(
        existingProfilePictureId,
      );
    }

    return {
      affected: 1,
      userProfileData: updatedUserProfile,
    };
  }
}
