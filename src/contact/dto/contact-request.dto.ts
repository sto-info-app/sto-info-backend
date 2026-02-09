import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ContactRequestDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  readonly name: string;

  @IsNotEmpty()
  @IsEmail()
  @MaxLength(254)
  readonly email: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  readonly topic: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  readonly message: string;
}
