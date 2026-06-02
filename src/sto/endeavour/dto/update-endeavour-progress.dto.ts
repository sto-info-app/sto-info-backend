import { IsInt, Max, Min } from 'class-validator';

export class UpdateEndeavourProgressDto {
  @IsInt()
  @Min(0)
  @Max(25)
  currentNodes: number;
}
