import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class UserLoginDto {
  @IsNotEmpty()
  @IsEmail()
  @ApiProperty({
    description: 'User email address used to sign in.',
    example: 'captain.picard@starfleet.example',
    format: 'email',
  })
  readonly email: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @ApiProperty({
    description: 'User password (minimum 8 characters).',
    example: 'CorrectHorseBatteryStaple',
    minLength: 8,
  })
  readonly password: string;
}
