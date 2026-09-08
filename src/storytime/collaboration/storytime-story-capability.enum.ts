/**
 * Something a person may be allowed to do to somebody else's Story.
 *
 * Each maps to one column on the collaborator row. Publishing is deliberately
 * absent: only the owner may publish, so there is nothing for a collaborator
 * to be granted and no capability to name.
 */
export enum StoryCapability {
  /** Change the Story's own details. */
  EDIT_STORY = 'EDIT_STORY',
  /** Write and edit Chapters. */
  MANAGE_CHAPTERS = 'MANAGE_CHAPTERS',
  /** Manage the cast. */
  MANAGE_CHARACTERS = 'MANAGE_CHARACTERS',
  /** Manage Crew credits. */
  MANAGE_CREW = 'MANAGE_CREW',
  /** Invite and remove other collaborators. */
  MANAGE_COLLABORATORS = 'MANAGE_COLLABORATORS',
}
