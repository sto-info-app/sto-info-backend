import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePlatformDto {
  @IsNotEmpty()
  @IsString()
  readonly name: string;

  /**
   * Whether the game provides a fleet roster export on this platform.
   *
   * Optional, and leaving it out means no, which is what the column's
   * default already says. A platform nobody has vouched for cannot import.
   */
  @IsOptional()
  @IsBoolean()
  readonly providesRosterExport?: boolean;
}
