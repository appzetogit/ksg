/**
 * Taxi transit hubs (airports, railway stations, bus stands): admin CRUD and
 * calculator, the quote and the booking from inside an airport, completion
 * billing parking from the real wait, the driver keeping the pass-through, and
 * the public "hubs near me" endpoint. Spec: docs/taxi-transit-hubs-contract.md.
 *
 * Run: node tests/taxi-hubs.smoke.mjs
 *
 * Boots the real express app on a single-node replica set (settlement runs in
 * a transaction). Booking and the trip lifecycle are driven through the ride
 * service, as tests/taxi-completion-fare.smoke.mjs does.
 */
process.env.TAXI_DISTANCE_SOURCE = 'straight';

import assert from 'node:assert/strict';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let failures = 0;
const check = async (name, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${name}`);
    } catch (err) {
        failures += 1;
        console.log(`  FAIL  ${name}\n        ${err.message}`);
    }
};

const call = (server, method, path, { body, token } = {}) =>
    new Promise((resolve, reject) => {
        const { port } = server.address();
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request(
            {
                host: '127.0.0.1', port, path, method,
                headers: {
                    ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
            },
            (res) => {
                let raw = '';
                res.on('data', (c) => (raw += c));
                res.on('end', () => {
                    let json = null;
                    try { json = JSON.parse(raw); } catch { /* not json */ }
                    resolve({ status: res.statusCode, json, raw });
                });
            },
        );
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
process.env.MONGO_URI = replSet.getUri();
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-0123456789-0123456789-0123456789';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-0123456789-0123456789-0123456789';

await mongoose.connect(process.env.MONGO_URI);
const { default: app } = await import('../src/app.js');
const server = app.listen(0);

const { Airport } = await import('../src/modules/taxi/admin/models/Airport.js');
const { Vehicle } = await import('../src/modules/taxi/admin/models/Vehicle.js');
const { SetPrice } = await import('../src/modules/taxi/admin/models/SetPrice.js');
const { User } = await import('../src/modules/taxi/user/models/User.js');
const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
const { WalletTransaction } = await import('../src/modules/taxi/driver/models/WalletTransaction.js');
const svc = await import('../src/modules/taxi/services/rideService.js');
const { invalidateHubCache } = await import('../src/modules/taxi/services/transitHubs.service.js');
for (const model of Object.values(mongoose.models)) await model.init().catch(() => {});

const id = () => new mongoose.Types.ObjectId();
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const T = '/api/v1/taxi';

// A platform super-admin with taxi access.
const adminId = id();
await mongoose.connection.collection('admins').insertOne({
    _id: adminId, name: 'Hub Admin', email: `hubs${Date.now()}@ksg.test`, role: 'superadmin', admin_type: 'superadmin',
    servicesAccess: ['taxi'], isActive: true, active: true, status: 'active', createdAt: new Date(),
});
const adminToken = jwt.sign({ sub: String(adminId), userId: String(adminId), role: 'admin' }, process.env.JWT_ACCESS_SECRET);

// Ride types and the Sedan's price.
const sedan = id();
const bike = id();
await Vehicle.collection.insertMany([
    { _id: sedan, name: 'Cab Sedan', active: true, status: 1, transport_type: 'taxi', createdAt: new Date() },
    { _id: bike, name: 'Bike', active: true, status: 1, transport_type: 'taxi', createdAt: new Date() },
]);
const serviceLocation = id();
await SetPrice.collection.insertOne({
    vehicle_type: sedan, transport_type: 'taxi', pricing_scope: 'ride', active: 1, status: 'active',
    zone_id: null, service_location_id: serviceLocation, service_tax: 5,
    base_price: 70, base_distance: 2, price_per_distance: 17, time_price: 2,
    admin_commission_type_from_driver: 1, admin_commission_from_driver: 10,
    waiting_charge: 0, free_waiting_before: 0,
    createdAt: new Date(), updatedAt: new Date(),
});

// Raja Bhoj Airport (BHO), Bhopal, and a drop in MP Nagar.
const BHO = { lat: 23.2875, lng: 77.3374 };
const box = (c, d = 0.003) => ({
    type: 'Polygon',
    coordinates: [[[c.lng - d, c.lat - d], [c.lng + d, c.lat - d], [c.lng + d, c.lat + d], [c.lng - d, c.lat + d], [c.lng - d, c.lat - d]]],
});
const pickup = [BHO.lng, BHO.lat];
const drop = [77.4126, 23.2599];

const airportCharges = {
    enabled: true,
    pickup_fee: [{ vehicle_type_id: String(sedan), amount: 100 }, { vehicle_type_id: null, amount: 30 }],
    drop_fee: [],
    parking: { enabled: true, free_minutes: 10, block_minutes: 15, block_amount: 30, max_amount: 150 },
    time_windows: [],
    special_dates: [],
    surge: { percent: 0, flat: 0 },
};

let hubId;

console.log('\nadmin: create, list, preview');
await check('creates an airport with charges and a boundary', async () => {
    const res = await call(server, 'POST', `${T}/admin/airports`, {
        token: adminToken,
        body: {
            name: 'Raja Bhoj Airport', code: 'bho', hub_type: 'airport', service_location_id: String(serviceLocation),
            latitude: BHO.lat, longitude: BHO.lng, boundary: box(BHO), radius_meters: 600, charges: airportCharges,
        },
    });
    assert.equal(res.status, 200, res.raw);
    const hub = res.json.data;
    hubId = String(hub._id);
    assert.equal(hub.code, 'BHO');
    assert.equal(hub.hub_type, 'airport');
    assert.equal(hub.boundary.type, 'Polygon');
    assert.equal(hub.boundary_coordinates.length, 5);
    assert.equal(hub.charges.pickup_fee.length, 2);
    assert.equal(hub.charges.parking.block_amount, 30);
    assert.equal(hub.support_airport_fee, 30, 'the legacy fee mirrors the all-types pickup fee');
});
await check('refuses bad input: negative fee, bad time, open polygon of 2 points', async () => {
    const bad = async (body) => (await call(server, 'POST', `${T}/admin/airports`, {
        token: adminToken, body: { name: 'X', service_location_id: String(serviceLocation), ...body },
    })).status;
    assert.equal(await bad({ charges: { pickup_fee: [{ amount: -5 }] } }), 400);
    assert.equal(await bad({ charges: { time_windows: [{ start: '9:00', end: '10:00' }] } }), 400);
    assert.equal(await bad({ charges: { time_windows: [{ start: '09:00', end: '10:00', days: [9] }] } }), 400);
    assert.equal(await bad({ boundary: { type: 'Polygon', coordinates: [[[1, 1], [2, 2]]] } }), 400);
    assert.equal(await bad({ hub_type: 'harbour' }), 400);
});
await check('a railway station and a legacy airport row', async () => {
    const res = await call(server, 'POST', `${T}/admin/airports`, {
        token: adminToken,
        body: {
            name: 'Bhopal Junction', code: 'BPL', hub_type: 'railway_station', service_location_id: String(serviceLocation),
            latitude: 23.2668, longitude: 77.4136, charges: { pickup_fee: [{ vehicle_type_id: null, amount: 40 }] },
        },
    });
    assert.equal(res.status, 200, res.raw);
    // Written the old way: no `charges`, only the legacy fee.
    await Airport.collection.insertOne({
        name: 'Old Airport', code: 'OLD', service_location_id: serviceLocation, latitude: 10, longitude: 10,
        location: { type: 'Point', coordinates: [10, 10] }, support_airport_fee: 50, airport_surge: 5,
        status: 'active', active: true, createdAt: new Date(0), updatedAt: new Date(0),
    });
});
await check('lists every hub for the old page (data.airports), filters by type and q, pages', async () => {
    let res = await call(server, 'GET', `${T}/admin/airports`, { token: adminToken });
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.json.data.airports.length, 3);
    const legacy = res.json.data.airports.find((a) => a.code === 'OLD');
    assert.equal(legacy.hub_type, 'airport');
    assert.equal(legacy.charges_source, 'legacy');
    assert.deepEqual(legacy.charges.pickup_fee, [{ vehicle_type_id: null, amount: 50 }]);
    assert.equal(legacy.charges.surge.percent, 5);
    res = await call(server, 'GET', `${T}/admin/airports?type=railway_station`, { token: adminToken });
    assert.deepEqual(res.json.data.items.map((a) => a.code), ['BPL']);
    res = await call(server, 'GET', `${T}/admin/airports?type=airport`, { token: adminToken });
    assert.equal(res.json.data.total, 2, 'a row with no hub_type is an airport');
    res = await call(server, 'GET', `${T}/admin/airports?q=raja`, { token: adminToken });
    assert.deepEqual(res.json.data.items.map((a) => a.code), ['BHO']);
    res = await call(server, 'GET', `${T}/admin/airports?page=2&limit=2`, { token: adminToken });
    assert.equal(res.json.data.items.length, 1);
    assert.equal(res.json.data.total, 3);
});
await check('preview: a Sedan pickup with a 40 minute wait', async () => {
    const res = await call(server, 'POST', `${T}/admin/airports/${hubId}/preview`, {
        token: adminToken, body: { vehicle_type_id: String(sedan), role: 'pickup', waiting_minutes: 40 },
    });
    assert.equal(res.status, 200, res.raw);
    const { lines, total } = res.json.data;
    assert.equal(lines.find((l) => l.code === 'hub_pickup_fee').amount, 100);
    assert.equal(lines.find((l) => l.code === 'hub_parking').amount, 60, '30 billable minutes = 2 blocks');
    assert.equal(total, 160);
});
await check('preview: a Bike drop at the airport is free', async () => {
    const res = await call(server, 'POST', `${T}/admin/airports/${hubId}/preview`, {
        token: adminToken, body: { vehicle_type_id: String(bike), role: 'drop' },
    });
    assert.equal(res.status, 200, res.raw);
    assert.deepEqual(res.json.data.lines, []);
    assert.equal(res.json.data.total, 0);
});

console.log('\nthe quote from inside the airport');
let quoted;
await check('shows the pickup fee and an estimated parking line, in the total', async () => {
    invalidateHubCache();
    const res = await call(server, 'POST', `${T}/rides/quote`, {
        body: { pickup, drop, vehicleTypeIds: [String(sedan)], transport_type: 'taxi' },
    });
    assert.equal(res.status, 200, res.raw);
    const quotes = res.json.data?.quotes || res.json.data;
    quoted = (Array.isArray(quotes) ? quotes : quotes.items).find((q) => q.vehicleTypeId === String(sedan));
    assert.ok(quoted?.fare, res.raw);
    const fee = quoted.hubCharges.find((l) => l.code === 'hub_pickup_fee');
    assert.equal(fee.amount, 100);
    assert.equal(fee.passThrough, true);
    assert.equal(fee.hubName, 'Raja Bhoj Airport');
    const parking = quoted.hubCharges.find((l) => l.code === 'hub_parking');
    assert.equal(parking.amount, 0);
    assert.equal(parking.estimated, true);
    assert.equal(quoted.hubs.pickup.code, 'BHO');
    assert.equal(quoted.hubs.drop, undefined);
    assert.equal(quoted.fare.hubPassThroughTotal, 100);
    assert.equal(quoted.fare.total, quoted.fare.fareBeforeSurge + quoted.fare.surge + 100);
});
await check('a quote outside every hub has no hub lines', async () => {
    const res = await call(server, 'POST', `${T}/rides/quote`, {
        body: { pickup: drop, drop: [77.43, 23.25], vehicleTypeIds: [String(sedan)], transport_type: 'taxi' },
    });
    const quotes = res.json.data?.quotes || res.json.data;
    const q = (Array.isArray(quotes) ? quotes : quotes.items)[0];
    assert.deepEqual(q.hubCharges, []);
    assert.deepEqual(q.hubs, {});
});

console.log('\nbooking and completing a cash ride from the airport');
const userId = id();
await User.collection.insertOne({ _id: userId, name: 'Rider', phone: '9811111111', createdAt: new Date() });
const driverId = id();
await Driver.collection.insertOne({
    _id: driverId, name: 'Driver', phone: '9822222222', password: 'secret123', vehicleType: 'car', vehicleTypeId: sedan,
    isOnline: true, isOnRide: true, approve: true, status: 'approved', location: { type: 'Point', coordinates: pickup },
    wallet: { balance: 0 }, createdAt: new Date(),
});
let ride;
await check('the booking stores the lines, the hubs and a snapshot, and charges the quote', async () => {
    ride = await svc.createRideRecord({
        userId, pickupCoords: pickup, dropCoords: drop, pickupAddress: 'BHO', dropAddress: 'MP Nagar',
        fare: 0, vehicleTypeId: String(sedan), paymentMethod: 'cash', serviceType: 'ride', transport_type: 'taxi',
    });
    assert.equal(r2(ride.fare), r2(quoted.fare.total), `charged ${ride.fare}, quoted ${quoted.fare.total}`);
    assert.equal(ride.hubPassThroughTotal, 100);
    assert.equal(ride.hubCharges.find((l) => l.code === 'hub_pickup_fee').amount, 100);
    assert.equal(ride.hubs.pickup.code, 'BHO');
    assert.equal(ride.hubSnapshot.pickup.charges.parking.block_amount, 30);
    assert.equal(r2(ride.pricingSnapshot.agreed_fare), r2(ride.fare - 100), 'the agreed fare is without the pass-through');
    const serialized = svc.serializeRideRealtime(ride);
    assert.equal(serialized.hubCharges.length, 2);
    assert.equal(serialized.hubs.pickup.name, 'Raja Bhoj Airport');
});
await check('an admin edit after booking does not change the ride', async () => {
    const res = await call(server, 'PATCH', `${T}/admin/airports/${hubId}`, {
        token: adminToken,
        body: { charges: { ...airportCharges, pickup_fee: [{ vehicle_type_id: null, amount: 999 }], parking: { ...airportCharges.parking, block_amount: 500, max_amount: null } } },
    });
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.json.data.support_airport_fee, 999);
});
let done;
await check('completion bills 40 minutes of waiting as Rs 60 parking, from the snapshot', async () => {
    await Ride.updateOne({ _id: ride._id }, { $set: { driverId, status: 'accepted', liveStatus: 'accepted', acceptedAt: new Date() } });
    await svc.updateRideLifecycle({ rideId: ride._id, driverId, nextStatus: 'arriving' });
    // The driver arrived 45 minutes ago and the trip started 5 minutes ago: a 40 minute wait.
    const now = Date.now();
    await Ride.updateOne({ _id: ride._id }, { $set: { arrivedAt: new Date(now - 45 * 60000) } });
    await svc.updateRideLifecycle({ rideId: ride._id, driverId, nextStatus: 'started', otp: ride.otp });
    await Ride.updateOne({ _id: ride._id }, { $set: { startedAt: new Date(now - 5 * 60000) } });
    await svc.updateRideLifecycle({ rideId: ride._id, driverId, nextStatus: 'completed' });
    done = await Ride.findById(ride._id).lean();
    const parking = done.hubCharges.find((l) => l.code === 'hub_parking');
    assert.equal(parking.amount, 60, `parking ${parking?.amount}`);
    assert.equal(parking.estimated, false);
    assert.equal(done.hubCharges.find((l) => l.code === 'hub_pickup_fee').amount, 100, 'the fee is as booked, not 999');
    assert.equal(done.hubPassThroughTotal, 160);
    assert.equal(r2(done.fare), r2(done.pricingSnapshot.agreed_fare + 160), `fare ${done.fare}`);
    assert.equal(r2(done.baseFare), r2(done.pricingSnapshot.agreed_fare), 'baseFare carries no hub fees');
    assert.equal(Number(done.waitingChargeAmount || 0), 0, 'parking is not folded into the waiting charge');
});
await check('the driver keeps the pass-through: no commission on it, cash wallet debited only the commission', async () => {
    const rideFare = r2(done.fare - 160);
    assert.equal(r2(done.commissionAmount), r2(Math.round(rideFare * 10) / 100), `commission ${done.commissionAmount} on ${rideFare}`);
    assert.equal(r2(done.driverEarnings), r2(done.fare - done.commissionAmount), `earnings ${done.driverEarnings}`);
    assert.ok(done.driverEarnings >= 160);
    const tx = await WalletTransaction.findOne({ rideId: ride._id }).lean();
    assert.ok(tx, 'no settlement transaction');
    assert.equal(r2(tx.amount), r2(-done.commissionAmount), `wallet moved ${tx.amount}`);
});

console.log('\nan online ride from the airport');
await check('online: driverEarnings includes the pass-through in full', async () => {
    await User.collection.updateOne({ _id: userId }, { $set: { currentRideId: null } });
    const r = await svc.createRideRecord({
        userId, pickupCoords: pickup, dropCoords: drop, pickupAddress: 'BHO', dropAddress: 'MP Nagar',
        fare: 0, vehicleTypeId: String(sedan), paymentMethod: 'online', serviceType: 'ride', transport_type: 'taxi',
    });
    // Booked after the admin's edit: Rs 999 fee.
    assert.equal(r.hubPassThroughTotal, 999);
    await Ride.updateOne({ _id: r._id }, { $set: { driverId, status: 'ongoing', liveStatus: 'started', startedAt: new Date(), arrivedAt: new Date() } });
    await svc.updateRideLifecycle({ rideId: r._id, driverId, nextStatus: 'completed' });
    const o = await Ride.findById(r._id).lean();
    assert.equal(o.paymentMethod, 'online');
    assert.equal(o.hubPassThroughTotal, 999, 'no wait: no parking');
    assert.equal(r2(o.commissionAmount), r2(Math.round((o.fare - 999) * 10) / 100));
    assert.equal(r2(o.driverEarnings), r2(o.fare - o.commissionAmount));
});

console.log('\nthe public hubs endpoint');
await check('lists active hubs near MP Nagar, nearest first, filtered by type', async () => {
    let res = await call(server, 'GET', `${T}/common/transit-hubs?lat=23.2599&lng=77.4126&radiusKm=25`);
    assert.equal(res.status, 200, res.raw);
    const items = res.json.data.items;
    assert.deepEqual(items.map((h) => h.code), ['BPL', 'BHO']);
    assert.equal(items[1].type, 'airport');
    assert.ok(items[1].distanceKm > 7 && items[1].distanceKm < 10, `distance ${items[1].distanceKm}`);
    res = await call(server, 'GET', `${T}/common/transit-hubs?lat=23.2599&lng=77.4126&type=airport`);
    assert.deepEqual(res.json.data.items.map((h) => h.code), ['BHO']);
    res = await call(server, 'GET', `${T}/common/transit-hubs?lat=23.2599`);
    assert.equal(res.status, 400);
});
await check('an inactive hub is not listed and not charged', async () => {
    await call(server, 'PATCH', `${T}/admin/airports/${hubId}`, { token: adminToken, body: { status: 'inactive' } });
    const res = await call(server, 'GET', `${T}/common/transit-hubs?lat=23.2599&lng=77.4126&type=airport`);
    assert.deepEqual(res.json.data.items, []);
    const q = await call(server, 'POST', `${T}/rides/quote`, { body: { pickup, drop, vehicleTypeIds: [String(sedan)], transport_type: 'taxi' } });
    const quotes = q.json.data?.quotes || q.json.data;
    assert.deepEqual((Array.isArray(quotes) ? quotes : quotes.items)[0].hubCharges, []);
});
await check('delete', async () => {
    const res = await call(server, 'DELETE', `${T}/admin/airports/${hubId}`, { token: adminToken });
    assert.equal(res.status, 200, res.raw);
    assert.equal(await Airport.countDocuments({ _id: hubId }), 0);
});

server.close();
await mongoose.disconnect();
await replSet.stop();
console.log(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
