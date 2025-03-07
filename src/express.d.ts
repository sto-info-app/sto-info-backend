import 'express';

// Extend the Request interface to include userUuid
declare module 'express' {
  export interface Request {
    userUuid?: string;
  }
}
