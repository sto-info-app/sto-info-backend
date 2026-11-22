/** What happened to an application, as its audit log records it (FC-021). */
export enum FleetApplicationActionKind {
  SUBMITTED = 'SUBMITTED',
  WITHDRAWN = 'WITHDRAWN',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}
