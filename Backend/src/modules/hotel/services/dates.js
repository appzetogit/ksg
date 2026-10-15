// IST calendar dates for the hotel vertical.
//
// CONVENTION (used everywhere in this module):
//   - The API speaks 'YYYY-MM-DD' strings, meaning a calendar date in India (IST).
//   - A night is stored as a Date at 00:00 IST of that calendar date, i.e. 18:30 UTC
//     on the previous day. Example: '2026-12-10' <-> 2026-12-09T18:30:00.000Z.
//   - Ranges of nights are [checkIn, checkOut): the check-out date is exclusive.
// IST has no daylight saving, so a fixed +05:30 offset is exact.

import { ValidationError } from '../../../core/auth/errors.js';

export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `s` is a real 'YYYY-MM-DD' calendar date. */
export const isDateString = (s) => {
    if (typeof s !== 'string') return false;
    const m = DATE_RE.exec(s);
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};

/** 'YYYY-MM-DD' (IST) -> Date at 00:00 IST. Throws a 400 on a bad string. */
export const toNightDate = (s, field = 'date') => {
    if (!isDateString(s)) throw new ValidationError(`${field} must be a date in YYYY-MM-DD format`);
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
};

/** Any Date -> the IST calendar date it falls on, as 'YYYY-MM-DD'. */
export const toDateString = (date) => new Date(new Date(date).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Today's IST calendar date. */
export const todayIST = (now = new Date()) => toDateString(now);

/** Today at 00:00 IST, as a Date. */
export const todayStartIST = (now = new Date()) => toNightDate(todayIST(now));

/** Shift a 'YYYY-MM-DD' by n days. */
export const addDays = (s, n) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
};

/** Whole days from a to b ('YYYY-MM-DD'); b - a. */
export const daysBetween = (a, b) => {
    const [y1, m1, d1] = a.split('-').map(Number);
    const [y2, m2, d2] = b.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS);
};

/** The nights of a stay: every date in [from, to), as strings. */
export const nightsBetween = (from, to) => {
    const n = daysBetween(from, to);
    const out = [];
    for (let i = 0; i < n; i++) out.push(addDays(from, i));
    return out;
};

/** Friday and Saturday nights take the weekend price. */
export const isWeekendNight = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return dow === 5 || dow === 6;
};

/**
 * Validate a stay window from query/body strings.
 * @returns {{ checkIn, checkOut, nights: string[] }}
 */
export const parseStay = (checkIn, checkOut, { maxNights = 30, allowPast = false } = {}) => {
    toNightDate(checkIn, 'checkIn');
    toNightDate(checkOut, 'checkOut');
    const n = daysBetween(checkIn, checkOut);
    if (n < 1) throw new ValidationError('checkOut must be after checkIn');
    if (n > maxNights) throw new ValidationError(`A stay can be at most ${maxNights} nights`);
    if (!allowPast && checkIn < todayIST()) throw new ValidationError('checkIn cannot be in the past');
    return { checkIn, checkOut, nights: nightsBetween(checkIn, checkOut) };
};
