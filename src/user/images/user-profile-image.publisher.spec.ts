import { Logger } from '@nestjs/common';

import { jest } from '@jest/globals';
import { Repository } from 'typeorm';

import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetAttachment,
  AssetPublisherRegistry,
} from 'src/file-assets/services/asset-publisher.registry';

import { UserProfileEntity } from '../entities/user-profile.entity';
import { UserProfileImagePublisher } from './user-profile-image.publisher';

const attachment: AssetAttachment = {
  subjectId: 'user-1',
  slot: FileAssetSlot.PICTURE,
  deliveryReference: 'new-image',
  uploadedByUserId: 'user-1',
  detail: null,
};

describe('UserProfileImagePublisher', () => {
  let findOne: jest.Mock<(...args: any[]) => Promise<any>>;
  let save: jest.Mock<(...args: any[]) => Promise<any>>;
  let register: jest.Mock;
  let publisher: UserProfileImagePublisher;

  beforeEach(() => {
    findOne = jest.fn<(...args: any[]) => Promise<any>>();
    save = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockImplementation((row: unknown) => Promise.resolve(row));
    register = jest.fn();

    publisher = new UserProfileImagePublisher(
      { findOne, save } as unknown as Repository<UserProfileEntity>,
      { register } as unknown as AssetPublisherRegistry,
    );

    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('publishes for profiles', () => {
    expect(publisher.subject).toBe(FileAssetSubject.USER_PROFILE);
  });

  it('registers itself', () => {
    publisher.onModuleInit();

    expect(register).toHaveBeenCalledWith(publisher);
  });

  it('points the profile at the new picture and reports the old one', async () => {
    const profile = { userId: 'user-1', profilePictureId: 'old-image' };

    findOne.mockResolvedValue(profile);

    await expect(publisher.attach(attachment)).resolves.toBe('old-image');

    expect(profile.profilePictureId).toBe('new-image');
    expect(save).toHaveBeenCalledWith(profile);
  });

  it('reports no previous picture for an empty profile', async () => {
    findOne.mockResolvedValue({ userId: 'user-1', profilePictureId: null });

    await expect(publisher.attach(attachment)).resolves.toBeNull();
  });

  // The account went while the picture was being scanned. Nothing points
  // at it, and the caller withdraws it as it would any replaced picture.
  it('reports the new picture as unattachable when the profile has gone', async () => {
    findOne.mockResolvedValue(null);

    await expect(publisher.attach(attachment)).resolves.toBe('new-image');
    expect(save).not.toHaveBeenCalled();
  });
});
