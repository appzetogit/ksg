// Per-night inventory for hotel room types (hotel_inventory_days).
//
// Dates follow services/dates.js: 'YYYY-MM-DD' IST strings at the API, Date at
// 00:00 IST in the database, stays are [checkIn, checkOut).
//
// reserve() is the overselling guard: each night is incremented with a conditional
// update (booked + units <= capacity, not closed). It runs inside a Mongo transaction,
// so on a replica set a failed night rolls back the others. The superapp server runs
// a standalone mongod where config/standaloneTransactions.js turns transactions into
// no-ops, so reserve() also undoes the nights it already took before throwing; each
// night's conditional $inc is atomic on its own, so a night is never oversold either way.
//
// Reused by the booking phase: reserve / release / runInTransaction / ensureInventoryDays.

import mongoose from 'mongoose';
import { NotFoundError, ValidationError } from '../../../core/auth/errors.js';
import { ConflictError } from '../errors.js';
import { HotelRoomType } from '../models/hotelRoomType.model.js';
import { HotelInventoryDay } from '../models/hotelInventoryDay.model.js';
import {
    toNightDate,
    toDateString,
    todayIST,
    todayStartIST,
    addDays,
    nightsBetween,
    isWeekendNight,
} from './dates.js';

export * from './dates.js';

/** How far ahead inventory rows are kept (room type create / nightly job). */
export const BACKFILL_DAYS = 365;

/**
 * Run fn(session) in a transaction. With an existing session (the caller's
 * transaction) fn simply runs in it.
 */
export const runInTransaction = async (fn, existingSession = null) => {
    if (existingSession) return fn(existingSession);
    const session = await mongoose.startSession();
    try {
        let out;
        await session.withTransaction(async () => {
            out = await fn(session);
        });
        return out;
    } finally {
        await session.endSession();
    }
};

const capacityOf = (roomType) =>
    (typeof roomType.sellableUnits === 'function'
        ? roomType.sellableUnits()
        : HotelRoomType.prototype.sellableUnits.call(roomType));

/** Nightly rate before any per-night override. */
export const basePriceForNight = (roomType, date) =>
    (isWeekendNight(date) && roomType.weekendPrice != null ? roomType.weekendPrice : roomType.pricePerNight);

/** Nightly rate: override ?? weekend price on Fri/Sat ?? price per night. */
export const nightlyPrice = (roomType, date, day) =>
    (day?.priceOverride != null ? day.priceOverride : basePriceForNight(roomType, date));

/**
 * Make sure a row exists for every night in [from, to) ('YYYY-MM-DD', `to` exclusive).
 * New rows get capacity = sellableUnits(); existing rows are left alone.
 * Idempotent and safe to run concurrently (the upsert key is the unique index).
 */
export const ensureInventoryDays = async (roomType, from, to, { session } = {}) => {
    const nights = nightsBetween(from, to);
    if (!nights.length) return 0;
    const capacity = capacityOf(roomType);
    const now = new Date();
    // timestamps: false — otherwise Mongoose adds `$set: {updatedAt}` and every existing
    // row gets rewritten, which makes a concurrent transaction on those nights
    // write-conflict (and retry) forever.
    const ops = nights.map((d) => ({
        updateOne: {
            filter: { roomTypeId: roomType._id, date: toNightDate(d) },
            update: {
                $setOnInsert: {
                    propertyId: roomType.propertyId,
                    roomTypeId: roomType._id,
                    date: toNightDate(d),
                    booked: 0,
                    capacity,
                    closed: false,
                    createdAt: now,
                    updatedAt: now,
                },
            },
            upsert: true,
            timestamps: false,
        },
    }));
    const res = await HotelInventoryDay.bulkWrite(ops, {
        ordered: false,
        timestamps: false,
        ...(session ? { session } : {}),
    });
    return res.upsertedCount || 0;
};

/** Rows for the next BACKFILL_DAYS nights starting today (IST). */
export const backfillInventory = (roomType, { days = BACKFILL_DAYS, session } = {}) => {
    const from = todayIST();
    return ensureInventoryDays(roomType, from, addDays(from, days), { session });
};

/**
 * Apply a room type's new capacity to every night from today on. Refuses (409) when a
 * night already has more units booked than the new capacity.
 */
export const applyCapacity = async (roomType, { session } = {}) => {
    const capacity = capacityOf(roomType);
    const today = todayStartIST();
    const over = await HotelInventoryDay.findOne({
        roomTypeId: roomType._id,
        date: { $gte: today },
        booked: { $gt: capacity },
    }).session(session || null).lean();
    if (over) {
        throw new ConflictError(
            `Cannot reduce inventory to ${capacity}: ${over.booked} unit(s) are already booked on ${toDateString(over.date)}`,
        );
    }
    await HotelInventoryDay.updateMany(
        { roomTypeId: roomType._id, date: { $gte: today } },
        { $set: { capacity } },
        session ? { session } : {},
    );
    return capacity;
};

/** Checks the units fit before any write: positive whole number. */
const assertUnits = (units) => {
    if (!Number.isInteger(units) || units < 1) throw new ValidationError('units must be a whole number of at least 1');
};

/**
 * Take `units` on every night of [checkIn, checkOut) for a room type.
 * Throws ConflictError (409) if any night is closed or lacks capacity; nothing is
 * kept in that case. Pass `session` to join the caller's transaction.
 * @returns {{ nights: string[] }}
 */
export const reserve = async ({ roomTypeId, checkIn, checkOut, units = 1, session = null }) => {
    assertUnits(units);
    const nights = nightsBetween(checkIn, checkOut);
    if (!nights.length) throw new ValidationError('checkOut must be after checkIn');

    const roomType = await HotelRoomType.findById(roomTypeId).session(session || null);
    if (!roomType || roomType.isDeleted) throw new NotFoundError('Room type not found');
    if (!roomType.isActive) throw new ConflictError('This room type is not available for booking');

    // Rows must exist before the conditional $inc (no upsert in the guard itself, so a
    // failed night is a 0-match). Without a caller session they are created before our
    // transaction starts. Inside a caller's transaction a row inserted outside it would
    // be invisible to its snapshot, so they are created in that session instead —
    // callers should run ensureInventoryDays() before opening their transaction, which
    // makes this a no-op.
    await ensureInventoryDays(roomType, checkIn, checkOut, { session });

    return runInTransaction(async (s) => {
        const taken = [];
        try {
            for (const night of nights) {
                const res = await HotelInventoryDay.updateOne(
                    {
                        roomTypeId: roomType._id,
                        date: toNightDate(night),
                        closed: { $ne: true },
                        $expr: { $lte: [{ $add: ['$booked', units] }, '$capacity'] },
                    },
                    { $inc: { booked: units } },
                    { session: s },
                );
                if (res.modifiedCount !== 1) {
                    throw new ConflictError(`Not enough rooms available on ${night}`, { date: night });
                }
                taken.push(night);
            }
            return { nights };
        } catch (err) {
            // Standalone servers have no rollback (see the header). On a replica set the
            // abort undoes these anyway and the compensation is a harmless no-op/failure.
            if (taken.length) {
                await HotelInventoryDay.updateMany(
                    { roomTypeId: roomType._id, date: { $in: taken.map((d) => toNightDate(d)) }, booked: { $gte: units } },
                    { $inc: { booked: -units } },
                    { session: s },
                ).catch(() => {});
            }
            throw err;
        }
    }, session);
};

/** Give back `units` on every night of [checkIn, checkOut). Never goes below zero. */
export const release = async ({ roomTypeId, checkIn, checkOut, units = 1, session = null }) => {
    assertUnits(units);
    const dates = nightsBetween(checkIn, checkOut).map((d) => toNightDate(d));
    if (!dates.length) return { released: 0 };
    const res = await HotelInventoryDay.updateMany(
        { roomTypeId, date: { $in: dates }, booked: { $gte: units } },
        { $inc: { booked: -units } },
        session ? { session } : {},
    );
    return { released: res.modifiedCount };
};

/**
 * Calendar rows for [from, to) as API InventoryDay objects. Missing rows are created
 * first so the calendar always shows every night.
 */
export const getCalendar = async (roomType, from, to) => {
    await ensureInventoryDays(roomType, from, to);
    const rows = await HotelInventoryDay.find({
        roomTypeId: roomType._id,
        date: { $gte: toNightDate(from), $lt: toNightDate(to) },
    }).sort({ date: 1 }).lean();
    return rows.map((r) => {
        const date = toDateString(r.date);
        return {
            date,
            capacity: r.capacity,
            booked: r.booked,
            available: Math.max(0, r.capacity - r.booked),
            price: nightlyPrice(roomType, date, r),
            ...(r.priceOverride != null ? { priceOverride: r.priceOverride } : {}),
            closed: Boolean(r.closed),
        };
    });
};

/**
 * Per-night availability and price for a stay, without creating rows (missing rows
 * mean full capacity at the base price).
 */
export const quoteNights = async (roomType, checkIn, checkOut) => {
    const nights = nightsBetween(checkIn, checkOut);
    const rows = await HotelInventoryDay.find({
        roomTypeId: roomType._id,
        date: { $gte: toNightDate(checkIn), $lt: toNightDate(checkOut) },
    }).lean();
    const byDate = new Map(rows.map((r) => [toDateString(r.date), r]));
    const capacity = capacityOf(roomType);
    return nights.map((date) => {
        const row = byDate.get(date);
        const available = row ? (row.closed ? 0 : Math.max(0, row.capacity - row.booked)) : capacity;
        return { date, available, price: nightlyPrice(roomType, date, row) };
    });
};
