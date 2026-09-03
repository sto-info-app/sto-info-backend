import { ApiProperty } from '@nestjs/swagger';

import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'First name used for the user profile.',
    example: 'Jean-Luc',
  })
  readonly firstName: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Last name used for the user profile.',
    example: 'Picard',
  })
  readonly lastName: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(5)
  @ApiProperty({
    description:
      'Public username shown in the app (minimum 5 characters). Must be unique (case-insensitive).',
    example: 'captain.picard',
    minLength: 5,
  })
  readonly username: string;

  @IsNotEmpty()
  @IsEmail()
  @ApiProperty({
    description: 'Email address used for login and account verification.',
    example: 'captain.picard@starfleet.example',
    format: 'email',
  })
  readonly email: string;

  @IsNotEmpty()
  @MinLength(8)
  @ApiProperty({
    description: 'Password (minimum 8 characters).',
    example: 'CorrectHorseBatteryStaple',
    minLength: 8,
  })
  readonly password: string;

  @IsNotEmpty()
  @MinLength(8)
  @ApiProperty({
    description:
      'Password confirmation. Must match the password field exactly.',
    example: 'CorrectHorseBatteryStaple',
    minLength: 8,
  })
  readonly confirmPassword: string;
}
