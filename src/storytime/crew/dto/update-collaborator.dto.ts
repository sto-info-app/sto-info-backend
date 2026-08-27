import { OmitType, PartialType } from '@nestjs/swagger';
import { InviteCollaboratorDto } from './invite-collaborator.dto';

/**
 * Changes what a collaborator may do.
 *
 * Who they are is not among the fields: moving a collaboration to a different
 * member would silently transfer whatever the first person had accepted, so
 * that is an invitation and a revocation rather than an edit.
 */
export class UpdateCollaboratorDto extends PartialType(
  OmitType(InviteCollaboratorDto, ['userId'] as const),
) {}
