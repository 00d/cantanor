/**
 * ID helpers for battle entities and events.
 * Mirrors engine/core/ids.py
 */

const ID_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;

export function isValidId(value: string): boolean {
  return ID_PATTERN.test(value);
}

export function eventId(sequence: number): string {
  return `ev_${String(sequence).padStart(6, "0")}`;
}
