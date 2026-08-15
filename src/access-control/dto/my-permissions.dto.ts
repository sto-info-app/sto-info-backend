import { ApiProperty } from '@nestjs/swagger';

/**
 * The permissions the calling user currently holds.
 *
 * Intended for presentation decisions in the client. It is not an
 * authorisation boundary — every capability listed is independently enforced
 * server-side on the endpoint that performs the action.
 */
export class MyPermissionsDto {
  @ApiProperty({
    description: 'Permission codes held by the caller, alphabetically ordered.',
    type: [String],
    example: ['storytime.story.create', 'storytime.view'],
  })
  readonly permissions: string[];
}
