import { validateDto } from '../../utils/testing/dto-validation.util';
import { FriendRequestDirection } from '../enums/friend-request-direction.enum';
import { CreateBlockDto } from './create-block.dto';
import { CreateFriendRequestDto } from './create-friend-request.dto';
import { FriendRequestsQueryDto } from './friend-requests-query.dto';
import { FriendsQueryDto } from './friends-query.dto';

describe('CreateFriendRequestDto Validation', () => {
  it('should accept a username', async () => {
    const { errors } = await validateDto(CreateFriendRequestDto, {
      username: 'captain.picard',
    });

    expect(errors).toHaveLength(0);
  });

  it('should trim the username', async () => {
    const { dto } = await validateDto(CreateFriendRequestDto, {
      username: '  captain.picard  ',
    });

    expect(dto.username).toBe('captain.picard');
  });

  it('should reject a missing username', async () => {
    const { errors } = await validateDto(CreateFriendRequestDto, {});

    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject a username that is only whitespace', async () => {
    const { errors } = await validateDto(CreateFriendRequestDto, {
      username: '   ',
    });

    expect(errors[0].constraints).toHaveProperty('isNotEmpty');
  });

  it('should leave a non-string username untransformed for validation', async () => {
    const { errors } = await validateDto(CreateFriendRequestDto, {
      username: 42,
    });

    expect(errors[0].constraints).toHaveProperty('isString');
  });

  it('should reject a username longer than 50 characters', async () => {
    const { errors } = await validateDto(CreateFriendRequestDto, {
      username: 'a'.repeat(51),
    });

    expect(errors[0].constraints).toHaveProperty('maxLength');
  });
});

describe('CreateBlockDto Validation', () => {
  it('should accept a username without a note', async () => {
    const { errors } = await validateDto(CreateBlockDto, {
      username: 'captain.picard',
    });

    expect(errors).toHaveLength(0);
  });

  it('should trim the username and the note', async () => {
    const { dto } = await validateDto(CreateBlockDto, {
      username: '  captain.picard  ',
      reason: '  Harassment  ',
    });

    expect(dto.username).toBe('captain.picard');
    expect(dto.reason).toBe('Harassment');
  });

  it('should leave a non-string note untransformed for validation', async () => {
    const { errors } = await validateDto(CreateBlockDto, {
      username: 'captain.picard',
      reason: 42,
    });

    expect(errors[0].constraints).toHaveProperty('isString');
  });

  it('should reject a note longer than 500 characters', async () => {
    const { errors } = await validateDto(CreateBlockDto, {
      username: 'captain.picard',
      reason: 'a'.repeat(501),
    });

    expect(errors[0].constraints).toHaveProperty('maxLength');
  });
});

describe('FriendsQueryDto Validation', () => {
  it('should accept an empty query', async () => {
    const { errors } = await validateDto(FriendsQueryDto, {});

    expect(errors).toHaveLength(0);
  });

  it('should trim the search term', async () => {
    const { dto } = await validateDto(FriendsQueryDto, {
      search: '  picard  ',
    });

    expect(dto.search).toBe('picard');
  });

  it('should leave a non-string search term untransformed for validation', async () => {
    const { errors } = await validateDto(FriendsQueryDto, { search: 42 });

    expect(errors[0].constraints).toHaveProperty('isString');
  });

  it('should reject a search term longer than 50 characters', async () => {
    const { errors } = await validateDto(FriendsQueryDto, {
      search: 'a'.repeat(51),
    });

    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('should coerce a numeric string page', async () => {
    const { dto, errors } = await validateDto(FriendsQueryDto, { page: '3' });

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(3);
  });

  it('should reject a page below 1', async () => {
    const { errors } = await validateDto(FriendsQueryDto, { page: 0 });

    expect(errors[0].constraints).toHaveProperty('min');
  });

  it('should reject a page size above 50', async () => {
    const { errors } = await validateDto(FriendsQueryDto, { pageSize: 51 });

    expect(errors[0].constraints).toHaveProperty('max');
  });
});

describe('FriendRequestsQueryDto Validation', () => {
  it('should accept an empty query', async () => {
    const { errors } = await validateDto(FriendRequestsQueryDto, {});

    expect(errors).toHaveLength(0);
  });

  it('should accept every supported direction', async () => {
    for (const direction of Object.values(FriendRequestDirection)) {
      const { errors } = await validateDto(FriendRequestsQueryDto, {
        direction,
      });
      expect(errors).toHaveLength(0);
    }
  });

  it('should reject an unknown direction', async () => {
    const { errors } = await validateDto(FriendRequestsQueryDto, {
      direction: 'SIDEWAYS',
    });

    expect(errors[0].constraints).toHaveProperty('isEnum');
  });
});
