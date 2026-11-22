import { Logger } from '@nestjs/common';

import { jest } from '@jest/globals';
import { Repository } from 'typeorm';

import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetAttachment,
  AssetPublisherRegistry,
} from 'src/file-assets/services/asset-publisher.registry';

import { CharacterEntity } from '../entities/character.entity';
import { CharacterImagePublisher } from './character-image.publisher';

const attachment: AssetAttachment = {
  subjectId: 'char-1',
  slot: FileAssetSlot.PORTRAIT,
  deliveryReference: 'new-image',
  uploadedByUserId: 'user-1',
  detail: null,
};

describe('CharacterImagePublisher', () => {
  let findOne: jest.Mock<(...args: any[]) => Promise<any>>;
  let save: jest.Mock<(...args: any[]) => Promise<any>>;
  let register: jest.Mock;
  let publisher: CharacterImagePublisher;

  beforeEach(() => {
    findOne = jest.fn<(...args: any[]) => Promise<any>>();
    save = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockImplementation((row: unknown) => Promise.resolve(row));
    register = jest.fn();

    publisher = new CharacterImagePublisher(
      { findOne, save } as unknown as Repository<CharacterEntity>,
      { register } as unknown as AssetPublisherRegistry,
    );

    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('publishes for Characters', () => {
    expect(publisher.subject).toBe(FileAssetSubject.STO_CHARACTER);
  });

  it('registers itself', () => {
    publisher.onModuleInit();

    expect(register).toHaveBeenCalledWith(publisher);
  });

  it('points the Character at the new portrait and reports the old one', async () => {
    const character = { id: 'char-1', profilePictureId: 'old-image' };

    findOne.mockResolvedValue(character);

    await expect(publisher.attach(attachment)).resolves.toBe('old-image');

    expect(character.profilePictureId).toBe('new-image');
    expect(save).toHaveBeenCalledWith(character);
  });

  it('reports no previous portrait for a Character without one', async () => {
    findOne.mockResolvedValue({ id: 'char-1', profilePictureId: null });

    await expect(publisher.attach(attachment)).resolves.toBeNull();
  });

  // A portrait cleared after its Character was removed finds nothing to
  // attach to and is withdrawn again.
  it('reports the new portrait as unattachable when the Character has gone', async () => {
    findOne.mockResolvedValue(null);

    await expect(publisher.attach(attachment)).resolves.toBe('new-image');
    expect(save).not.toHaveBeenCalled();
  });
});
