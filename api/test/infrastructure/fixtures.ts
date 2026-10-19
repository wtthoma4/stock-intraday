// The fixtures are real Yahoo replies, saved without changes. Refer to the names below.
//
// The fixtures with data use `interval=15m`, `period1` and `period2`, as the client sends them.
// `period1` was 1 month and 2 days before `period2`. Each `*_FETCHED_AT` constant is the `period2` of that file.

import { readFileSync } from 'node:fs';

import type { JsonBodyType } from 'msw';

/** TSLA (Nasdaq, New York). The session of 16 October 2026 was open at the time of the request. */
export const TSLA = 'tsla-15m-period.json';
export const TSLA_FETCHED_AT = new Date('2026-10-16T14:48:44Z');

/** 7203.T (Tokyo). Bars in the lunch break have `null` in all fields. The session of 16 October was closed. */
export const TOKYO = '7203-t-15m-period.json';
export const TOKYO_FETCHED_AT = new Date('2026-10-16T14:48:44Z');

/** BHP.AX (Sydney). The session starts at 23:00 UTC after the daylight saving change on 4 October 2026. */
export const SYDNEY = 'bhp-ax-15m-period.json';
export const SYDNEY_FETCHED_AT = new Date('2026-10-16T14:34:05Z');

/** The HTTP 404 body for the symbol `ZZZZZZ1`, which does not exist. */
export const NOT_FOUND = 'invalid-symbol-404.json';

/** Reads a fixture as a JSON value. The return type is the JSON body type of MSW, so a handler can send it. */
export function readFixture(name: string): JsonBodyType {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'),
  ) as JsonBodyType;
}
