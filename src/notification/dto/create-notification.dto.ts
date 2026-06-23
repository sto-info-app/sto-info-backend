import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { NotificationSeverity } from '../enums/notification-severity.enum';
import { NotificationTarget } from '../enums/notification-target.enum';

export class CreateNotificationDto {
  @ApiPropertyOptional({
    enum: NotificationTarget,
    description: 'Defaults to BROADCAST.',
  })
  @IsOptional()
  @IsEnum(NotificationTarget)
  readonly target?: NotificationTarget;

  @ApiPropertyOptional({
    description: 'Recipient user ID. Required when target is USER.',
  })
  @ValidateIf(o => o.target === NotificationTarget.USER)
  @IsNotEmpty()
  @IsUUID()
  readonly userId?: string;

  @ApiPropertyOptional({ enum: NotificationSeverity })
  @IsOptional()
  @IsEnum(NotificationSeverity)
  readonly severity?: NotificationSeverity;

  @ApiProperty({ description: 'Notification title.' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(160)
  readonly title: string;

  @ApiProperty({ description: 'Notification body (plain text).' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  readonly body: string;

  @ApiPropertyOptional({ description: 'Optional deep link.' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  readonly linkUrl?: string;
}
