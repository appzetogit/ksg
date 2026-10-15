// Hotel settings (docs/hotel-api-contract.md, HotelSettings).
//
// Stored as one document in hotel_settings (models/hotelSettings.model.js); unset
// fields fall back to HOTEL_SETTINGS_DEFAULTS. Reads are cached for 30 s per process;
// an update clears the cache of the process that made it (others catch up within 30 s).

import { z } from 'zod';
import { HotelSettings } from '../models/hotelSettings.model.js';
import { parse } from '../validators/partner.validators.js';

export const HOTEL_SETTINGS_DEFAULTS = Object.freeze({
    commissionPercent: 10,
    minCommission: 50,
    commissionGstPercent: 18,
    paymentHoldMinutes: 30,
    prepaidDiscountPercent: 5,
    prepaidAdvancePercent: 30,
    allowPayAtHotel: true,
    reviewAutoApprove: true,
    minWithdrawal: 500,
    settleOn: 'checked_out',
    // Per room per night tariff (after discounts). upTo null = no upper bound.
    gstSlabs: Object.freeze([
        Object.freeze({ upTo: 1000, rate: 0 }),
        Object.freeze({ upTo: 7500, rate: 5 }),
        Object.freeze({ upTo: null, rate: 18 }),
    ]),
});

const KEYS = Object.keys(HOTEL_SETTINGS_DEFAULTS);
const CACHE_MS = 30 * 1000;
let cache = null;

const percent = z.number().finite().min(0).max(100);

export const hotelSettingsSchema = z.object({
    commissionPercent: percent,
    minCommission: z.number().finite().min(0).max(100000),
    commissionGstPercent: percent,
    paymentHoldMinutes: z.number().int().min(5).max(24 * 60),
    prepaidDiscountPercent: percent,
    prepaidAdvancePercent: z.number().finite().min(1).max(100),
    allowPayAtHotel: z.boolean(),
    reviewAutoApprove: z.boolean(),
    minWithdrawal: z.number().finite().min(0).max(10000000),
    settleOn: z.enum(['checked_out', 'confirmed']),
    gstSlabs: z.array(z.object({
        upTo: z.number().finite().positive().nullable(),
        rate: percent,
    }).strict()).min(1).max(10)
        .superRefine((slabs, ctx) => {
            // Ascending upper bounds, exactly one open-ended slab, and it comes last.
            const open = slabs.filter((s) => s.upTo === null).length;
            if (open !== 1 || slabs[slabs.length - 1].upTo !== null) {
                ctx.addIssue({ code: 'custom', message: 'the last slab (and only the last) must have upTo: null' });
                return;
            }
            for (let i = 1; i < slabs.length - 1; i++) {
                if (!(slabs[i].upTo > slabs[i - 1].upTo)) {
                    ctx.addIssue({ code: 'custom', message: 'slab upTo values must increase' });
                    return;
                }
            }
        }),
}).partial(); // unknown keys (e.g. a full object echoed back with extras) are dropped

const merge = (doc) => {
    const out = {};
    for (const k of KEYS) {
        const v = doc?.[k];
        out[k] = v === undefined || v === null || (Array.isArray(v) && !v.length)
            ? HOTEL_SETTINGS_DEFAULTS[k]
            : v;
    }
    out.gstSlabs = out.gstSlabs.map((s) => ({ upTo: s.upTo ?? null, rate: s.rate }));
    return out;
};

/** Effective hotel settings (defaults filled in). */
export const getHotelSettings = async ({ fresh = false } = {}) => {
    if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
    const doc = await HotelSettings.findOne({ key: 'default' }).lean();
    const value = merge(doc);
    cache = { at: Date.now(), value };
    return value;
};

export const invalidateHotelSettingsCache = () => {
    cache = null;
};

/** Validate and save a partial update; returns the effective settings. */
export const updateHotelSettings = async (partial, { updatedBy } = {}) => {
    const data = parse(hotelSettingsSchema, partial);
    await HotelSettings.updateOne(
        { key: 'default' },
        { $set: { ...data, ...(updatedBy ? { updatedBy } : {}) }, $setOnInsert: { key: 'default' } },
        { upsert: true },
    );
    invalidateHotelSettingsCache();
    return getHotelSettings({ fresh: true });
};
