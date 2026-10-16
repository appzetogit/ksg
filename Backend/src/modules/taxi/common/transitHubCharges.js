/**
 * Transit-hub charges: the pure maths (no database). Spec:
 * docs/taxi-transit-hubs-contract.md.
 *
 * A hub (airport, railway station, bus stand) applies to a ride when its pickup
 * or drop is inside the hub. It can charge:
 *   - a pickup fee / drop fee, per vehicle type (null entry = every type),
 *   - parking for the driver's wait at a PICKUP hub, billed per started block
 *     after some free minutes, capped,
 *   - a hub surge (percent of the fare before surge + flat), which is ordinary
 *     surge.
 * Fees and parking are pass-through: not taxed, no platform fee, no commission,
 * all of it to the driver (who pays the gate / parking).
 *
 * A special date (IST) beats the time windows; otherwise the first time window
 * that matches (IST, may cross midnight) scales fees and parking:
 * round(amount x multiplier + extra_flat). extra_flat is only added to a
 * charge that is non-zero -- a Rs 0 drop fee stays Rs 0 at night, and parking
 * with no billable block stays Rs 0.
 *
 * Used by the quote, the booking and the completion (services/rideService.js),
 * and by the admin's calculator (POST /admin/airports/:id/preview).
 */

export const HUB_TYPE_LABELS = {
    airport: 'Airport',
    railway_station: 'Railway station',
    bus_stand: 'Bus stand',
};

const IST_OFFSET_MS = 330 * 60 * 1000;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};
const nonNeg = (value, fallback = 0) => Math.max(0, num(value, fallback));
const money = (value) => Math.round(num(value) * 100) / 100;
const idOf = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'object' && value._id) return String(value._id);
    return String(value);
};

/** IST clock for a moment: { date: 'YYYY-MM-DD', day: 0-6, minutes: 0-1439 }. */
export const istClock = (at = new Date()) => {
    const ms = new Date(at).getTime();
    const d = new Date((Number.isFinite(ms) ? ms : Date.now()) + IST_OFFSET_MS);
    const pad = (n) => String(n).padStart(2, '0');
    return {
        date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
        day: d.getUTCDay(),
        minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    };
};

export const parseHHmm = (value) => {
    const m = TIME_RE.exec(String(value || '').trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Does a window cover this IST moment? A window crossing midnight (22:00-06:00)
 * belongs to the day it STARTS on: Friday's 22:00-06:00 covers Saturday 02:00
 * when Friday (5) is in `days`. start === end means the whole day.
 */
export const windowMatches = (window, clock) => {
    const start = parseHHmm(window?.start);
    const end = parseHHmm(window?.end);
    if (start === null || end === null) return false;
    const days = Array.isArray(window.days) ? window.days.map(Number) : [];
    const dayOk = (day) => days.length === 0 || days.includes(day);
    const t = clock.minutes;
    if (start === end) return dayOk(clock.day);
    if (start < end) return t >= start && t < end && dayOk(clock.day);
    // crosses midnight
    if (t >= start) return dayOk(clock.day);
    if (t < end) return dayOk((clock.day + 6) % 7);
    return false;
};

/** The modifier at a moment: a special date, else the first matching window, else none. */
export const resolveModifier = (charges, at = new Date()) => {
    const clock = istClock(at);
    const special = (charges?.special_dates || []).find((s) => String(s?.date || '') === clock.date);
    if (special) {
        return {
            source: 'special_date',
            label: special.label || special.date,
            multiplier: nonNeg(special.multiplier, 1),
            extraFlat: nonNeg(special.extra_flat),
        };
    }
    const window = (charges?.time_windows || []).find((w) => windowMatches(w, clock));
    if (window) {
        return {
            source: 'time_window',
            label: window.name || `${window.start}-${window.end}`,
            multiplier: nonNeg(window.multiplier, 1),
            extraFlat: nonNeg(window.extra_flat),
        };
    }
    return { source: 'none', label: '', multiplier: 1, extraFlat: 0 };
};

/** The amount for a vehicle type: its own entry, else the all-types (null) entry, else 0. */
export const pickVehicleAmount = (entries = [], vehicleTypeId = null) => {
    const list = Array.isArray(entries) ? entries : [];
    const wanted = idOf(vehicleTypeId);
    const own = wanted ? list.find((e) => idOf(e?.vehicle_type_id) === wanted) : null;
    if (own) return nonNeg(own.amount);
    const all = list.find((e) => idOf(e?.vehicle_type_id) === null);
    return all ? nonNeg(all.amount) : 0;
};

export const applyModifier = (amount, modifier) => {
    const base = nonNeg(amount);
    if (!(base > 0)) return 0;
    return Math.max(0, Math.round(base * nonNeg(modifier?.multiplier, 1) + nonNeg(modifier?.extraFlat)));
};

/**
 * Parking for `waitedMinutes` at a pickup hub:
 * blocks = ceil(max(0, waited - free) / block); min(blocks x amount x mult + flat, cap).
 * A cap of null (or 0) means no cap; disable parking to make it free.
 */
export const computeParking = (parking, waitedMinutes, modifier = { multiplier: 1, extraFlat: 0 }) => {
    if (!parking?.enabled) return 0;
    const block = nonNeg(parking.block_minutes);
    const blockAmount = nonNeg(parking.block_amount);
    if (!(block > 0) || !(blockAmount > 0)) return 0;
    const billable = Math.max(0, nonNeg(waitedMinutes) - nonNeg(parking.free_minutes));
    const blocks = Math.ceil(billable / block);
    if (!(blocks > 0)) return 0;
    const raw = applyModifier(blocks * blockAmount, modifier);
    const cap = parking.max_amount === null || parking.max_amount === undefined ? 0 : nonNeg(parking.max_amount);
    return cap > 0 ? Math.min(raw, Math.round(cap)) : raw;
};

/**
 * The charges a hub actually has. A row from before `charges` existed is read
 * through its legacy fields: support_airport_fee -> pickup fee for every
 * vehicle type, airport_surge -> surge percent.
 */
export const effectiveHubCharges = (hub = {}) => {
    const c = hub?.charges;
    const hasCharges = c && typeof c === 'object' && Object.keys(c.toObject ? c.toObject() : c).length > 0;
    if (!hasCharges) {
        const fee = nonNeg(hub?.support_airport_fee);
        const surge = nonNeg(hub?.airport_surge);
        return {
            enabled: fee > 0 || surge > 0,
            pickup_fee: fee > 0 ? [{ vehicle_type_id: null, amount: fee }] : [],
            drop_fee: [],
            parking: { enabled: false, free_minutes: 0, block_minutes: 15, block_amount: 0, max_amount: null },
            time_windows: [],
            special_dates: [],
            surge: { percent: surge, flat: 0 },
            legacy: true,
        };
    }
    const plain = c.toObject ? c.toObject() : c;
    const list = (entries) => (Array.isArray(entries) ? entries : []).map((e) => ({
        vehicle_type_id: idOf(e?.vehicle_type_id),
        amount: nonNeg(e?.amount),
    }));
    const parking = plain.parking || {};
    return {
        enabled: plain.enabled !== false,
        pickup_fee: list(plain.pickup_fee),
        drop_fee: list(plain.drop_fee),
        parking: {
            enabled: Boolean(parking.enabled),
            free_minutes: nonNeg(parking.free_minutes),
            block_minutes: nonNeg(parking.block_minutes, 15),
            block_amount: nonNeg(parking.block_amount),
            max_amount: parking.max_amount === null || parking.max_amount === undefined ? null : nonNeg(parking.max_amount),
        },
        time_windows: (plain.time_windows || []).map((w) => ({
            name: String(w?.name || ''),
            days: (Array.isArray(w?.days) ? w.days : []).map(Number),
            start: String(w?.start || '00:00'),
            end: String(w?.end || '00:00'),
            multiplier: nonNeg(w?.multiplier, 1),
            extra_flat: nonNeg(w?.extra_flat),
        })),
        special_dates: (plain.special_dates || []).map((s) => ({
            date: String(s?.date || ''),
            label: String(s?.label || ''),
            multiplier: nonNeg(s?.multiplier, 1),
            extra_flat: nonNeg(s?.extra_flat),
        })),
        surge: { percent: nonNeg(plain.surge?.percent), flat: nonNeg(plain.surge?.flat) },
        legacy: false,
    };
};

/**
 * A frozen copy of a hub for a ride: what it charged when the ride was booked,
 * so a later admin edit does not change a ride already under way.
 */
export const snapshotHub = (hub) => {
    if (!hub) return null;
    // Already a snapshot (has `id` and effective charges, no `_id`): keep it as frozen.
    const isSnapshot = !hub._id && hub.id && hub.charges && hub.charges.legacy !== undefined;
    return {
        id: idOf(hub._id || hub.id),
        name: String(hub.name || ''),
        code: String(hub.code || ''),
        type: hub.hub_type || hub.type || 'airport',
        charges: isSnapshot ? hub.charges : effectiveHubCharges(hub),
    };
};

export const hubRef = (snap) => (snap ? { id: snap.id, name: snap.name, type: snap.type, code: snap.code } : null);

/**
 * The hub lines for a ride.
 *
 * pickupHub / dropHub: hub documents or snapshots (snapshotHub).
 * waitingMinutes: the driver's wait at pickup; null/undefined = not known yet,
 *   in which case a pickup hub with parking gets a line of Rs 0 marked
 *   `estimated: true` (the quote and the booking), recomputed at completion.
 * fareBeforeSurge: what a hub's surge percent is taken of.
 *
 * Returns contract `hubCharges` lines; zero-amount fee / surge lines are left out.
 */
export const resolveHubCharges = ({
    pickupHub = null,
    dropHub = null,
    vehicleTypeId = null,
    at = new Date(),
    waitingMinutes = null,
    parkingAt = null,
    fareBeforeSurge = 0,
} = {}) => {
    const lines = [];
    const pickup = pickupHub ? snapshotHub(pickupHub) : null;
    const drop = dropHub ? snapshotHub(dropHub) : null;
    const base = (snap) => ({ hubId: snap.id, hubName: snap.name, hubType: snap.type });
    const waitingKnown = waitingMinutes !== null && waitingMinutes !== undefined && Number.isFinite(Number(waitingMinutes));

    if (pickup?.charges?.enabled) {
        const mod = resolveModifier(pickup.charges, at);
        const fee = applyModifier(pickVehicleAmount(pickup.charges.pickup_fee, vehicleTypeId), mod);
        if (fee > 0) {
            lines.push({ code: 'hub_pickup_fee', label: `${pickup.name} pickup fee`, amount: fee, ...base(pickup), passThrough: true });
        }
        if (pickup.charges.parking?.enabled) {
            if (waitingKnown) {
                const parkingMod = parkingAt ? resolveModifier(pickup.charges, parkingAt) : mod;
                const amount = computeParking(pickup.charges.parking, Number(waitingMinutes), parkingMod);
                if (amount > 0) {
                    lines.push({ code: 'hub_parking', label: `${pickup.name} parking`, amount, ...base(pickup), passThrough: true, estimated: false });
                }
            } else {
                lines.push({ code: 'hub_parking', label: `${pickup.name} parking (est.)`, amount: 0, ...base(pickup), passThrough: true, estimated: true });
            }
        }
    }

    if (drop?.charges?.enabled) {
        const mod = resolveModifier(drop.charges, at);
        const fee = applyModifier(pickVehicleAmount(drop.charges.drop_fee, vehicleTypeId), mod);
        if (fee > 0) {
            lines.push({ code: 'hub_drop_fee', label: `${drop.name} drop fee`, amount: fee, ...base(drop), passThrough: true });
        }
    }

    // Hub surge: once per hub (a ride from a hub back to the same hub pays it once).
    const surged = new Set();
    for (const snap of [pickup, drop]) {
        if (!snap?.charges?.enabled || surged.has(snap.id)) continue;
        surged.add(snap.id);
        const percent = nonNeg(snap.charges.surge?.percent);
        const flat = nonNeg(snap.charges.surge?.flat);
        const amount = Math.round((nonNeg(fareBeforeSurge) * percent) / 100 + flat);
        if (amount > 0) {
            lines.push({ code: 'hub_surge', label: `${snap.name} surge`, amount, ...base(snap), passThrough: false });
        }
    }

    return lines;
};

export const sumHubLines = (lines = [], { passThrough } = {}) => money(
    (Array.isArray(lines) ? lines : [])
        .filter((l) => passThrough === undefined || Boolean(l?.passThrough) === passThrough)
        .reduce((sum, l) => sum + nonNeg(l?.amount), 0),
);

/* ------------------------------------------------------------------ admin input */

const bad = (message) => {
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
};

const validAmount = (value, field) => {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n) || n < 0) bad(`${field} must be a number >= 0`);
    return Math.round(n * 100) / 100;
};

const validVehicleList = (entries, field, isValidId) => {
    if (entries === undefined || entries === null) return [];
    if (!Array.isArray(entries)) bad(`${field} must be a list`);
    const seen = new Set();
    return entries.map((e, i) => {
        const raw = e?.vehicle_type_id;
        const id = raw === null || raw === undefined || raw === '' || raw === 'all' ? null : String(raw);
        if (id !== null && !isValidId(id)) bad(`${field}[${i}].vehicle_type_id is invalid`);
        const key = id || 'all';
        if (seen.has(key)) bad(`${field} has two entries for the same vehicle type`);
        seen.add(key);
        return { vehicle_type_id: id, amount: validAmount(e?.amount, `${field}[${i}].amount`) };
    });
};

/**
 * Validate and normalise an admin's `charges` payload. Throws an Error with
 * statusCode 400 on bad input. `isValidId` checks a vehicle type id.
 */
export const validateHubChargesInput = (input, { isValidId = () => true } = {}) => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) bad('charges must be an object');
    const parking = input.parking || {};
    const blockMinutes = validAmount(parking.block_minutes ?? 15, 'charges.parking.block_minutes');
    if (parking.enabled && !(blockMinutes > 0)) bad('charges.parking.block_minutes must be > 0 when parking is enabled');
    const maxAmount = parking.max_amount === null || parking.max_amount === undefined || parking.max_amount === ''
        ? null
        : validAmount(parking.max_amount, 'charges.parking.max_amount');

    const windows = input.time_windows ?? [];
    if (!Array.isArray(windows)) bad('charges.time_windows must be a list');
    const specials = input.special_dates ?? [];
    if (!Array.isArray(specials)) bad('charges.special_dates must be a list');

    return {
        enabled: input.enabled === undefined ? true : Boolean(input.enabled),
        pickup_fee: validVehicleList(input.pickup_fee, 'charges.pickup_fee', isValidId),
        drop_fee: validVehicleList(input.drop_fee, 'charges.drop_fee', isValidId),
        parking: {
            enabled: Boolean(parking.enabled),
            free_minutes: validAmount(parking.free_minutes, 'charges.parking.free_minutes'),
            block_minutes: blockMinutes,
            block_amount: validAmount(parking.block_amount, 'charges.parking.block_amount'),
            max_amount: maxAmount,
        },
        time_windows: windows.map((w, i) => {
            const f = `charges.time_windows[${i}]`;
            if (parseHHmm(w?.start) === null) bad(`${f}.start must be HH:mm`);
            if (parseHHmm(w?.end) === null) bad(`${f}.end must be HH:mm`);
            const days = w?.days ?? [];
            if (!Array.isArray(days) || days.some((d) => !Number.isInteger(Number(d)) || Number(d) < 0 || Number(d) > 6)) {
                bad(`${f}.days must be numbers 0-6 (0 = Sunday)`);
            }
            return {
                name: String(w?.name || '').trim(),
                days: [...new Set(days.map(Number))].sort(),
                start: String(w.start).trim(),
                end: String(w.end).trim(),
                multiplier: validAmount(w?.multiplier ?? 1, `${f}.multiplier`),
                extra_flat: validAmount(w?.extra_flat, `${f}.extra_flat`),
            };
        }),
        special_dates: specials.map((s, i) => {
            const f = `charges.special_dates[${i}]`;
            const date = String(s?.date || '').trim();
            if (!DATE_RE.test(date)) bad(`${f}.date must be YYYY-MM-DD`);
            return {
                date,
                label: String(s?.label || '').trim(),
                multiplier: validAmount(s?.multiplier ?? 1, `${f}.multiplier`),
                extra_flat: validAmount(s?.extra_flat, `${f}.extra_flat`),
            };
        }),
        surge: {
            percent: validAmount(input.surge?.percent, 'charges.surge.percent'),
            flat: validAmount(input.surge?.flat, 'charges.surge.flat'),
        },
    };
};

/**
 * A boundary from the admin: GeoJSON { type: 'Polygon', coordinates: [[[lng, lat], ...]] }
 * or the legacy [{ lat, lng }, ...]. Returns a closed GeoJSON Polygon (outer ring only),
 * closing an open ring. Throws (statusCode 400) on fewer than 3 distinct points or
 * coordinates out of range.
 */
export const validateBoundaryInput = (input) => {
    let ring;
    if (Array.isArray(input)) {
        ring = input.map((p) => [Number(p?.lng), Number(p?.lat)]);
    } else if (input && typeof input === 'object') {
        if (input.type !== 'Polygon' || !Array.isArray(input.coordinates) || !Array.isArray(input.coordinates[0])) {
            bad('boundary must be a GeoJSON Polygon');
        }
        ring = input.coordinates[0].map((p) => [Number(p?.[0]), Number(p?.[1])]);
    } else {
        bad('boundary must be a GeoJSON Polygon');
    }
    for (const [lng, lat] of ring) {
        if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
            bad('boundary contains invalid coordinates');
        }
    }
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (ring.length && (first[0] !== last[0] || first[1] !== last[1])) ring.push([first[0], first[1]]);
    const distinct = new Set(ring.map(([lng, lat]) => `${lng},${lat}`));
    if (ring.length < 4 || distinct.size < 3) bad('boundary needs at least 3 distinct points');
    return { type: 'Polygon', coordinates: [ring] };
};
