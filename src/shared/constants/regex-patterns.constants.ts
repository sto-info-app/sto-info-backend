import {
  MAX_CHARS_PASSWORD,
  MAX_CHARS_USERNAME,
  MIN_CHARS_PASSWORD,
  MIN_CHARS_USERNAME,
} from './user.constants';

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export const USERNAME_PATTERN = new RegExp(
  `^[a-zA-Z0-9]{${MIN_CHARS_USERNAME},${MAX_CHARS_USERNAME}}$`,
);

export const PASSWORD_PATTERN = new RegExp(
  `^(?=.*[0-9])(?=.*[a-z])(?=.*[A-Z])(?=.*[^a-zA-Z0-9\n\r\t]).{${MIN_CHARS_PASSWORD},${MAX_CHARS_PASSWORD}}$`,
);

export const SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
export const UNSAFE_FILENAME_PATTERN = /[^a-zA-Z0-9._-]/g;

export const CHARACTER_NAME_PATTERN =
  /^[A-Za-z'.-]([A-Za-z' .-]*[A-Za-z'.-])?$/;

export const STO_HANDLE_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]{2,15}(#\d{4,})?$/;
