/**
 * What an uploader is told when their file is refused on safety grounds.
 *
 * One sentence, used everywhere, and deliberately saying nothing about why.
 * R24 requires a generic rejection to the user and scanner detail to
 * administrators only, and the reason is not politeness: naming the signature
 * that matched hands somebody probing the scanner a precise account of what
 * gets through it. The same message covers an infection, an unsupported
 * payload and a scanner that would not answer, because to the person who
 * uploaded the file those are the same event.
 *
 * It also says what did *not* happen. Somebody replacing a picture needs to
 * know their existing one is untouched, or they will try again and again.
 */
export const FILE_REJECTED_BY_SCANNER_MESSAGE =
  'This file was not accepted. Nothing already saved has been changed. ' +
  'Please try a different file.';
