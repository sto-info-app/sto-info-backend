import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

import { NotificationSeverity } from '../enums/notification-severity.enum';

export class CreateBannerDto {
  @ApiPropertyOptional({ enum: NotificationSeverity })
  @IsOptional()
  @IsEnum(NotificationSeverity)
  readonly severity?: NotificationSeverity;

  @ApiPropertyOptional({ description: 'Optional short title.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  readonly title?: string;

  @ApiProperty({ description: 'Banner message (plain text).' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  readonly message: string;

  @ApiPropertyOptional({ description: 'Optional call-to-action URL.' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  readonly linkUrl?: string;

  @ApiPropertyOptional({ description: 'Optional call-to-action label.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  readonly linkLabel?: string;

  @ApiPropertyOptional({ description: 'Whether visitors may dismiss it.' })
  @IsOptional()
  @IsBoolean()
  readonly dismissible?: boolean;

  @ApiPropertyOptional({ description: 'Whether the banner is enabled.' })
  @IsOptional()
  @IsBoolean()
  readonly active?: boolean;

  @ApiPropertyOptional({ description: 'Start of the display window (ISO).' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  readonly startsAt?: Date;

  @ApiPropertyOptional({ description: 'End of the display window (ISO).' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  readonly endsAt?: Date;
}
