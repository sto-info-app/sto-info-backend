import { ApiProperty } from '@nestjs/swagger';

import { IsNotEmpty } from 'class-validator';

export class UserRefreshTokenDto {
  @IsNotEmpty()
  @ApiProperty({
    description:
      'JWT refresh token previously returned by login/refresh. Used to obtain new access tokens.',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2N2Y4Y2U5YS0yODNjLTRhYWEtOGU0Ny1lN2I4YjJjMGQyMTciLCJlbWFpbCI6ImNhcHRhaW4ucGljYXJkQHN0YXJmbGVldC5leGFtcGxlIiwianRpIjoiMmYxZTU0YjQ5NDRlNGZhZWEzNzg1MmZiZTNlOGViMjMiLCJpYXQiOjE3MDQ4MDAwMDAsImV4cCI6MTcwNDg4NjQwMH0.9q3bR7u2kQxw0KfVq1Qe0w5c1rK6pR6o0YxS5Zy7v1s',
  })
  readonly refresh_token: string;
}
