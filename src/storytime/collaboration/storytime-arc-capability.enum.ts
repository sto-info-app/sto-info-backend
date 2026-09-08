/**
 * Something a person may be allowed to do to somebody else's Arc.
 *
 * Each maps to one column on the Arc collaborator row. Publishing is absent
 * for the same reason it is absent from Stories: only the curator may publish,
 * so there is nothing to grant and no capability to name.
 */
export enum ArcCapability {
  /** Change the Arc's own details. */
  EDIT_ARC = 'EDIT_ARC',
  /** Invite Stories, answer requests, and set the reading order. */
  MANAGE_STORIES = 'MANAGE_STORIES',
  /** Invite and remove other collaborators. */
  MANAGE_COLLABORATORS = 'MANAGE_COLLABORATORS',
}
