import { ApiProperty } from '@nestjs/swagger';

export class AuthLoginResultDto {
  @ApiProperty({
    description: 'JWT access token for authenticated API requests.',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2N2Y4Y2U5YS0yODNjLTRhYWEtOGU0Ny1lN2I4YjJjMGQyMTciLCJlbWFpbCI6ImNhcHRhaW4ucGljYXJkQHN0YXJmbGVldC5leGFtcGxlIiwiaWF0IjoxNzA0ODAwMDAwLCJleHAiOjE3MDQ4MDM2MDB9.6hYl0oXlZ6oY0V6B8s3dQn1Jt5Q7n2xRjQp9m0x2v3Q',
  })
  access_token: string;

  @ApiProperty({
    description:
      'JWT refresh token used to obtain new access tokens without re-entering credentials.',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2N2Y4Y2U5YS0yODNjLTRhYWEtOGU0Ny1lN2I4YjJjMGQyMTciLCJlbWFpbCI6ImNhcHRhaW4ucGljYXJkQHN0YXJmbGVldC5leGFtcGxlIiwianRpIjoiMmYxZTU0YjQ5NDRlNGZhZWEzNzg1MmZiZTNlOGViMjMiLCJpYXQiOjE3MDQ4MDAwMDAsImV4cCI6MTcwNDg4NjQwMH0.9q3bR7u2kQxw0KfVq1Qe0w5c1rK6pR6o0YxS5Zy7v1s',
  })
  refresh_token: string;

  @ApiProperty({
    description:
      'Access token lifetime in seconds. Refresh before expiry to avoid re-authentication.',
    example: 3600,
    minimum: 1,
  })
  expires_in: number;

  @ApiProperty({
    description: 'User UUID associated with the issued tokens.',
    example: '67f8ce9a-283c-4aaa-8e47-e7b8b2c0d217',
    format: 'uuid',
  })
  user_id: string;
}

export class AuthRefreshResultDto {
  @ApiProperty({
    description: 'New JWT access token for authenticated API requests.',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2N2Y4Y2U5YS0yODNjLTRhYWEtOGU0Ny1lN2I4YjJjMGQyMTciLCJlbWFpbCI6ImNhcHRhaW4ucGljYXJkQHN0YXJmbGVldC5leGFtcGxlIiwiaWF0IjoxNzA0ODAwMDAwLCJleHAiOjE3MDQ4MDM2MDB9.6hYl0oXlZ6oY0V6B8s3dQn1Jt5Q7n2xRjQp9m0x2v3Q',
  })
  access_token: string;

  @ApiProperty({
    description: 'New refresh token. The old refresh token is revoked.',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2N2Y4Y2U5YS0yODNjLTRhYWEtOGU0Ny1lN2I4YjJjMGQyMTciLCJlbWFpbCI6ImNhcHRhaW4ucGljYXJkQHN0YXJmbGVldC5leGFtcGxlIiwianRpIjoiY2QwZDU3YzYxNmJhNDk2N2I2NDEwYjJjNGE1MjQxOTYiLCJpYXQiOjE3MDQ4MDAwMDAsImV4cCI6MTcwNDg4NjQwMH0.p8oZJt9qUuX1yZc8cM1DkV5Wm9Qb0qEo7x1B2a3C4d5',
  })
  refresh_token: string;

  @ApiProperty({
    description: 'Access token lifetime in seconds.',
    example: 3600,
    minimum: 1,
  })
  expires_in: number;
}
