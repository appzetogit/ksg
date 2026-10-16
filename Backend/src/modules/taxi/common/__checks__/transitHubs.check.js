/**
 * Self-check for transit-hub charges (airports, railway stations, bus stands).
 * Run: node src/modules/taxi/common/__checks__/transitHubs.check.js
 * Spec: docs/taxi-transit-hubs-contract.md.
 */
import assert from 'node:assert/strict';
import {
    applyModifier,
    computeParking,
    effectiveHubCharges,
    istClock,
    pickVehicleAmount,
    resolveHubCharges,
    resolveModifier,
    snapshotHub,
    sumHubLines,
    validateBoundaryInput,
    validateHubChargesInput,
    windowMatches,
} from '../transitHubCharges.js';
import { computeRideFare } from '../rideFare.js';

// An IST wall-clock moment as a Date (IST = UTC+05:30).
const ist = (isoLocal) => new Date(`${isoLocal}+05:30`);

const CAR = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const AUTO = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const BIKE = 'cccccccccccccccccccccccc';

// --- IST clock --------------------------------------------------------------
// 2026-10-16 is a Friday.
assert.deepEqual(istClock(ist('2026-10-16T23:30:00')), { date: '2026-10-16', day: 5, minutes: 23 * 60 + 30 });
// 20:00 UTC is 01:30 IST the next day.
assert.deepEqual(istClock(new Date('2026-10-16T20:00:00Z')), { date: '2026-10-17', day: 6, minutes: 90 });

// --- vehicle-type fallback ---------------------------------------------------
const fees = [{ vehicle_type_id: CAR, amount: 100 }, { vehicle_type_id: null, amount: 40 }];
assert.equal(pickVehicleAmount(fees, CAR), 100);
assert.equal(pickVehicleAmount(fees, AUTO), 40, 'no own entry: the all-types entry');
assert.equal(pickVehicleAmount([{ vehicle_type_id: CAR, amount: 100 }], AUTO), 0, 'no entry at all: 0');
assert.equal(pickVehicleAmount(fees, null), 40);
assert.equal(pickVehicleAmount([{ vehicle_type_id: { _id: CAR }, amount: 70 }], CAR), 70, 'populated ids match');

// --- time windows ------------------------------------------------------------
const night = { name: 'Night', days: [], start: '22:00', end: '06:00', multiplier: 1.25, extra_flat: 0 };
const at = (s) => istClock(ist(s));
assert.equal(windowMatches(night, at('2026-10-16T22:00:00')), true, '22:00 is in');
assert.equal(windowMatches(night, at('2026-10-16T23:59:00')), true);
assert.equal(windowMatches(night, at('2026-10-17T00:00:00')), true, 'midnight is in');
assert.equal(windowMatches(night, at('2026-10-17T05:59:00')), true);
assert.equal(windowMatches(night, at('2026-10-17T06:00:00')), false, 'end is exclusive');
assert.equal(windowMatches(night, at('2026-10-17T12:00:00')), false);
// A day-limited window crossing midnight belongs to the day it starts on.
const friNight = { ...night, days: [5] };
assert.equal(windowMatches(friNight, at('2026-10-16T23:00:00')), true, 'Friday 23:00');
assert.equal(windowMatches(friNight, at('2026-10-17T02:00:00')), true, 'Saturday 02:00 is still Friday night');
assert.equal(windowMatches(friNight, at('2026-10-17T23:00:00')), false, 'Saturday 23:00 is not');
const peak = { name: 'Peak', days: [1, 2, 3, 4, 5], start: '08:00', end: '11:00', multiplier: 1.5, extra_flat: 10 };
assert.equal(windowMatches(peak, at('2026-10-16T09:00:00')), true);
assert.equal(windowMatches(peak, at('2026-10-18T09:00:00')), false, 'Sunday');
assert.equal(windowMatches({ start: '00:00', end: '00:00', days: [] }, at('2026-10-16T15:00:00')), true, 'start = end: all day');

// First match wins; a special date beats every window.
const charges = {
    time_windows: [peak, night],
    special_dates: [{ date: '2026-11-08', label: 'Diwali', multiplier: 2, extra_flat: 5 }],
};
assert.equal(resolveModifier(charges, ist('2026-10-16T09:30:00')).label, 'Peak');
assert.equal(resolveModifier(charges, ist('2026-10-16T23:00:00')).multiplier, 1.25);
assert.equal(resolveModifier(charges, ist('2026-10-16T14:00:00')).source, 'none');
const diwali = resolveModifier(charges, ist('2026-11-08T23:00:00'));
assert.equal(diwali.source, 'special_date', 'special date beats the night window');
assert.equal(diwali.multiplier, 2);

// round(amount x multiplier + extra_flat); a Rs 0 charge stays Rs 0.
assert.equal(applyModifier(100, { multiplier: 1.25, extraFlat: 0 }), 125);
assert.equal(applyModifier(30, { multiplier: 1.5, extraFlat: 10 }), 55);
assert.equal(applyModifier(0, { multiplier: 2, extraFlat: 20 }), 0);

// --- parking -----------------------------------------------------------------
const parking = { enabled: true, free_minutes: 10, block_minutes: 15, block_amount: 30, max_amount: 150 };
const none = { multiplier: 1, extraFlat: 0 };
assert.equal(computeParking(parking, 0, none), 0);
assert.equal(computeParking(parking, 10, none), 0, 'within the free minutes');
assert.equal(computeParking(parking, 11, none), 30, 'a started block is billed');
assert.equal(computeParking(parking, 25, none), 30);
assert.equal(computeParking(parking, 26, none), 60);
assert.equal(computeParking(parking, 70, none), 120);
assert.equal(computeParking(parking, 500, none), 150, 'capped');
assert.equal(computeParking({ ...parking, max_amount: null }, 500, none), 990, 'no cap');
assert.equal(computeParking({ ...parking, enabled: false }, 500, none), 0);
assert.equal(computeParking(parking, 26, { multiplier: 1.25, extraFlat: 0 }), 75, 'the night multiplier applies');
assert.equal(computeParking(parking, 500, { multiplier: 2, extraFlat: 0 }), 150, 'cap after the multiplier');

// --- legacy rows -------------------------------------------------------------
const legacy = effectiveHubCharges({ name: 'Old', support_airport_fee: 50, airport_surge: 10 });
assert.equal(legacy.legacy, true);
assert.deepEqual(legacy.pickup_fee, [{ vehicle_type_id: null, amount: 50 }]);
assert.equal(legacy.surge.percent, 10);
assert.equal(effectiveHubCharges({ name: 'Bare' }).enabled, false, 'no fee, no surge: nothing applies');

// --- the lines for a ride ----------------------------------------------------
const airport = {
    _id: 'a1', name: 'Raja Bhoj Airport', code: 'BHO', hub_type: 'airport',
    charges: {
        enabled: true,
        pickup_fee: [{ vehicle_type_id: CAR, amount: 100 }, { vehicle_type_id: AUTO, amount: 50 }, { vehicle_type_id: BIKE, amount: 30 }],
        drop_fee: [],
        parking,
        time_windows: [night],
        special_dates: [],
        surge: { percent: 10, flat: 5 },
    },
};
const station = {
    _id: 's1', name: 'Bhopal Junction', code: 'BPL', hub_type: 'railway_station',
    charges: { enabled: true, pickup_fee: [{ vehicle_type_id: null, amount: 40 }], drop_fee: [{ vehicle_type_id: null, amount: 15 }], parking: { enabled: false }, surge: { percent: 0, flat: 0 } },
};
const day = ist('2026-10-16T14:00:00');

// Quote: pickup at the airport, parking not known yet.
let lines = resolveHubCharges({ pickupHub: airport, dropHub: station, vehicleTypeId: CAR, at: day, fareBeforeSurge: 200 });
const byCode = (code) => lines.find((l) => l.code === code);
assert.equal(byCode('hub_pickup_fee').amount, 100);
assert.equal(byCode('hub_pickup_fee').passThrough, true);
assert.equal(byCode('hub_pickup_fee').hubType, 'airport');
assert.equal(byCode('hub_parking').amount, 0);
assert.equal(byCode('hub_parking').estimated, true, 'parking is an estimate until the wait is known');
assert.equal(byCode('hub_drop_fee').amount, 15);
assert.equal(byCode('hub_drop_fee').hubName, 'Bhopal Junction');
assert.equal(byCode('hub_surge').amount, 25, '10% of 200 + 5');
assert.equal(byCode('hub_surge').passThrough, false);
assert.equal(sumHubLines(lines, { passThrough: true }), 115);
assert.equal(sumHubLines(lines, { passThrough: false }), 25);

// At night the fee and the parking are scaled.
lines = resolveHubCharges({ pickupHub: airport, vehicleTypeId: AUTO, at: ist('2026-10-16T23:00:00'), waitingMinutes: 26 });
assert.equal(byCode('hub_pickup_fee').amount, 63, 'round(50 x 1.25)');
assert.equal(byCode('hub_parking').amount, 75);
assert.equal(byCode('hub_parking').estimated, false);

// Parking is only for a PICKUP hub.
lines = resolveHubCharges({ dropHub: airport, vehicleTypeId: CAR, at: day, waitingMinutes: 60 });
assert.equal(byCode('hub_parking'), undefined);
assert.equal(byCode('hub_pickup_fee'), undefined);
// A completed ride with no billable wait has no parking line.
lines = resolveHubCharges({ pickupHub: airport, vehicleTypeId: CAR, at: day, waitingMinutes: 5 });
assert.equal(byCode('hub_parking'), undefined);
// Disabled charges: nothing.
assert.deepEqual(resolveHubCharges({ pickupHub: { ...airport, charges: { ...airport.charges, enabled: false } }, vehicleTypeId: CAR, at: day }), []);
// Same hub both ends: surge once.
lines = resolveHubCharges({ pickupHub: airport, dropHub: airport, vehicleTypeId: CAR, at: day, fareBeforeSurge: 100 });
assert.equal(lines.filter((l) => l.code === 'hub_surge').length, 1);

// A snapshot prices exactly as the hub it froze, and stays frozen.
const snap = JSON.parse(JSON.stringify(snapshotHub(airport)));
assert.deepEqual(
    resolveHubCharges({ pickupHub: snap, vehicleTypeId: CAR, at: day, waitingMinutes: 40 }),
    resolveHubCharges({ pickupHub: airport, vehicleTypeId: CAR, at: day, waitingMinutes: 40 }),
);
assert.equal(snapshotHub(snap).charges, snap.charges, 'a snapshot is not re-derived');

// --- the fare: pass-through is outside tax, platform fee and rounding ---------
const rule = { base_price: 100, base_distance: 2, price_per_distance: 10, time_price: 1, service_tax: 5, admin_commision: 10, admin_commision_type: 1 };
const plain = computeRideFare({ pricingRule: rule, distanceMeters: 5000, durationMinutes: 10, surgeAmount: 10 });
const hubLines = resolveHubCharges({ pickupHub: airport, dropHub: station, vehicleTypeId: CAR, at: day, fareBeforeSurge: plain.fareBeforeSurge });
const withHub = computeRideFare({ pricingRule: rule, distanceMeters: 5000, durationMinutes: 10, surgeAmount: 10, hubCharges: hubLines });
assert.equal(withHub.serviceTax, plain.serviceTax, 'no tax on hub fees');
assert.equal(withHub.platformFee, plain.platformFee, 'no platform fee on hub fees');
assert.equal(withHub.fareBeforeSurge, plain.fareBeforeSurge);
const hubSurge = sumHubLines(hubLines, { passThrough: false });
assert.equal(withHub.surge, plain.surge + hubSurge, 'hub surge is folded into the surge');
assert.equal(withHub.hubSurge, hubSurge);
assert.equal(withHub.hubPassThroughTotal, 115);
assert.equal(withHub.total, plain.total + hubSurge + 115);
assert.equal(withHub.hubCharges.length, hubLines.length);
const rows = withHub.baseFare + withHub.distanceFare + withHub.timeFare + withHub.serviceTax
    + withHub.platformFee + withHub.roundOff + withHub.surge + withHub.hubPassThroughTotal;
assert.equal(Math.round(rows * 100) / 100, withHub.total, 'the rows add up to the total');
// No hubs: the fare is unchanged and gains empty hub fields.
assert.deepEqual(computeRideFare({ pricingRule: rule, distanceMeters: 5000, durationMinutes: 10 }).hubCharges, []);

// --- admin input ---------------------------------------------------------------
const ok = validateHubChargesInput({
    pickup_fee: [{ vehicle_type_id: CAR, amount: '100' }, { vehicle_type_id: null, amount: 40 }],
    parking: { enabled: true, free_minutes: 10, block_minutes: 15, block_amount: 30, max_amount: '' },
    time_windows: [{ name: 'Night', days: [5, 6, 5], start: '22:00', end: '06:00', multiplier: 1.25 }],
    special_dates: [{ date: '2026-11-08', label: 'Diwali', multiplier: 2 }],
    surge: { percent: 0 },
});
assert.equal(ok.pickup_fee[0].amount, 100);
assert.equal(ok.parking.max_amount, null);
assert.deepEqual(ok.time_windows[0].days, [5, 6]);
assert.equal(ok.enabled, true);
const rejects = (input, re) => assert.throws(() => validateHubChargesInput(input), (err) => err.statusCode === 400 && re.test(err.message));
rejects({ pickup_fee: [{ amount: -1 }] }, /amount/);
rejects({ time_windows: [{ start: '25:00', end: '06:00' }] }, /HH:mm/);
rejects({ time_windows: [{ start: '22:00', end: '6:00' }] }, /HH:mm/);
rejects({ time_windows: [{ start: '22:00', end: '06:00', days: [7] }] }, /0-6/);
rejects({ time_windows: [{ start: '22:00', end: '06:00', multiplier: -1 }] }, /multiplier/);
rejects({ special_dates: [{ date: '2026-13-01' }] }, /YYYY-MM-DD/);
rejects({ parking: { enabled: true, block_minutes: 0, block_amount: 10 } }, /block_minutes/);
rejects({ pickup_fee: [{ vehicle_type_id: null, amount: 1 }, { amount: 2 }] }, /same vehicle type/);
assert.throws(() => validateHubChargesInput({ pickup_fee: [{ vehicle_type_id: 'nope', amount: 1 }] }, { isValidId: (v) => /^[0-9a-f]{24}$/.test(v) }), /invalid/);

// Boundaries: closed GeoJSON out, legacy points accepted, junk refused.
const box = validateBoundaryInput({ type: 'Polygon', coordinates: [[[77.33, 23.28], [77.34, 23.28], [77.34, 23.29], [77.33, 23.29]]] });
assert.deepEqual(box.coordinates[0][0], box.coordinates[0][4], 'an open ring is closed');
assert.equal(validateBoundaryInput([{ lat: 1, lng: 2 }, { lat: 1, lng: 3 }, { lat: 2, lng: 3 }]).coordinates[0].length, 4);
assert.throws(() => validateBoundaryInput({ type: 'Point', coordinates: [1, 2] }), /Polygon/);
assert.throws(() => validateBoundaryInput([{ lat: 1, lng: 2 }, { lat: 1, lng: 2 }, { lat: 1, lng: 2 }]), /3 distinct/);
assert.throws(() => validateBoundaryInput([{ lat: 100, lng: 2 }, { lat: 1, lng: 3 }, { lat: 2, lng: 3 }]), /invalid/);

console.log('All transit-hub checks passed.');
