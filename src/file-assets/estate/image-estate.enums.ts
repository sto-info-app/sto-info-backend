/** What an image estate run does (FC-040). */
export enum ImageEstateRunKind {
  /** Copies each public picture to a private one and repoints its rows. */
  COPY = 'COPY',
  /** Puts every copy not yet retired back as it was. */
  UNDO = 'UNDO',
  /** Deletes the old public copies, after which a copy cannot be undone. */
  RETIRE = 'RETIRE',
}

/** Where an image estate run is. */
export enum ImageEstateRunState {
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  DONE = 'DONE',
  /** Stopped by an error; resumed like a pause. */
  FAILED = 'FAILED',
}

/** What became of one picture's copy. */
export enum ImageEstateStepState {
  /** Under way: the private copy may exist, the rows are not yet repointed. */
  PENDING = 'PENDING',
  /** The rows point at the private copy; the old public one still exists. */
  COPIED = 'COPIED',
  /** Put back: the rows point at the old copy again. */
  UNDONE = 'UNDONE',
  /** The old public copy is deleted. Final. */
  RETIRED = 'RETIRED',
  /** Could not be copied; the picture is as it was. */
  FAILED = 'FAILED',
}

/** Where an inventory is. */
export enum ImageInventoryRunState {
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}
