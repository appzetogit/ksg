// Phase 1 exit criterion for the hotel integration (HOTEL_INTEGRATION_PLAN.md).
//
// Boots the real express app against an in-memory MongoDB and asserts: every hotel
// model is registered on a hotel_* collection with resolvable refs, schema guards
// hold, the /v1/hotel routes answer, hotel-partner OTP login works end to end, a
// blocked partner is cut off immediately, and admin access is gated by 'hotel'.
//
// Run: node tests/hotel.smoke.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let failures = 0;
const check = async (name, fn) => {
    try {
        await fn();
        console.log(`  ok   ${name}`);
    } catch (err) {
        failures++;
        console.log(`  FAIL ${name}\n         ${err.message}`);
    }
};

const call = (server, method, path, { body, token } = {}) =>
    new Promise((resolve, reject) => {
        const { port } = server.address();
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request(
            {
                host: '127.0.0.1',
                port,
                path,
                method,
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

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
process.env.NODE_ENV = 'test';
process.env.USE_DEFAULT_OTP = 'true';
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-0123456789-0123456789-0123456789';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-0123456789-0123456789-0123456789';

await mongoose.connect(process.env.MONGO_URI);
const { default: app } = await import('../src/app.js');
const server = app.listen(0);

const { HOTEL_MODEL_NAMES } = await import('../src/modules/hotel/models/index.js');
const { isInventoryTypeAllowed } = await import('../src/modules/hotel/constants.js');
const { invalidateAccountCache } = await import('../src/core/auth/auth.middleware.js');
const { signAccessToken } = await import('../src/core/auth/token.util.js');
const { MODULES } = await import('../src/core/modules/moduleRegistry.js');
const M = mongoose.models;

console.log('\n[1] model registry');

await check(`${HOTEL_MODEL_NAMES.length} Hotel* models registered`, () => {
    const missing = HOTEL_MODEL_NAMES.filter((n) => !M[n]);
    assert.deepEqual(missing, []);
});

await check('every hotel model lives on a hotel_* collection', () => {
    const bad = HOTEL_MODEL_NAMES
        .map((n) => [n, M[n].collection.name])
        .filter(([, c]) => !c.startsWith('hotel_'));
    assert.deepEqual(bad, []);
});

await check('every hotel model ref resolves to a registered model', () => {
    const missing = [];
    for (const name of HOTEL_MODEL_NAMES) {
        M[name].schema.eachPath((p, type) => {
            const ref = type.options?.ref || type.caster?.options?.ref;
            if (ref && !M[ref]) missing.push(`${name}.${p} -> ${ref}`);
        });
    }
    assert.deepEqual(missing, []);
});

await check('MODULES.HOTEL is registered for the kill switch', () => assert.equal(MODULES.HOTEL, 'hotel'));

console.log('\n[2] schema guards');

const oid = () => new mongoose.Types.ObjectId();

await check('inventory type follows property type', () => {
    assert.equal(isInventoryTypeAllowed('villa', 'entire'), true);
    assert.equal(isInventoryTypeAllowed('villa', 'room'), false);
    assert.equal(isInventoryTypeAllowed('hostel', 'bed'), true);
    assert.equal(isInventoryTypeAllowed('hotel', 'bed'), false);
});

await check('an entire-property room type must have exactly one unit', () => {
    const doc = new M.HotelRoomType({
        propertyId: oid(), name: 'Whole villa', inventoryType: 'entire',
        maxAdults: 6, totalInventory: 2, pricePerNight: 9000, images: ['a', 'b', 'c'],
    });
    assert.ok(doc.validateSync()?.errors?.totalInventory);
});

await check('a room type needs at least 3 photos', () => {
    const doc = new M.HotelRoomType({
        propertyId: oid(), name: 'Deluxe', inventoryType: 'room',
        maxAdults: 2, totalInventory: 5, pricePerNight: 2500, images: ['a'],
    });
    assert.ok(doc.validateSync()?.errors?.images);
});

await check('bed listings sell rooms x beds per night', () => {
    const doc = new M.HotelRoomType({ inventoryType: 'bed', totalInventory: 4, bedsPerRoom: 6 });
    assert.equal(doc.sellableUnits(), 24);
});

await check('a property rejects unknown amenities and bad coordinates', () => {
    const doc = new M.HotelProperty({
        partnerId: oid(), name: 'X', propertyType: 'hotel', coverImage: 'c',
        location: { type: 'Point', coordinates: [500, 23] }, amenities: ['wifi', 'jacuzzi_on_roof'],
    });
    const errors = doc.validateSync()?.errors || {};
    assert.ok(errors.amenities, 'amenities');
    assert.ok(errors['location.coordinates'], 'coordinates');
});

await check('a review must belong to a booking', () => {
    const doc = new M.HotelReview({ userId: oid(), propertyId: oid(), rating: 5 });
    assert.ok(doc.validateSync()?.errors?.bookingId);
});

await check('a booking cannot check out before it checks in', () => {
    const doc = new M.HotelBooking({ checkIn: new Date('2026-12-10'), checkOut: new Date('2026-12-09') });
    assert.ok(doc.validateSync()?.errors?.checkOut);
});

await check('unique indexes exist (inventory day, booking ref, one review per booking)', async () => {
    await Promise.all(HOTEL_MODEL_NAMES.map((n) => M[n].syncIndexes()));
    const has = async (model, key) => (await M[model].collection.indexes())
        .some((i) => i.unique && JSON.stringify(i.key) === JSON.stringify(key));
    assert.ok(await has('HotelInventoryDay', { roomTypeId: 1, date: 1 }), 'inventory day');
    assert.ok(await has('HotelBooking', { bookingRef: 1 }), 'booking ref');
    assert.ok(await has('HotelReview', { bookingId: 1 }), 'review per booking');
    assert.ok(await has('HotelPartner', { phone: 1 }), 'partner phone');
});

console.log('\n[3] routing');

await check('GET /api/v1/hotel/public/health -> 200', async () => {
    const res = await call(server, 'GET', '/api/v1/hotel/public/health');
    assert.equal(res.status, 200);
});

await check('GET /api/v1/hotel/public/catalogue lists the six property types', async () => {
    const res = await call(server, 'GET', '/api/v1/hotel/public/catalogue');
    assert.equal(res.status, 200);
    assert.equal(res.json.data.propertyTypes.length, 6);
});

await check('partner and admin areas need a token', async () => {
    assert.equal((await call(server, 'GET', '/api/v1/hotel/partner/me')).status, 401);
    assert.equal((await call(server, 'GET', '/api/v1/hotel/admin/overview')).status, 401);
});

await check('a customer token cannot use partner routes', async () => {
    const user = await M.FoodUser.create({ phone: '9111111111' });
    const token = signAccessToken({ userId: String(user._id), role: 'USER' });
    assert.equal((await call(server, 'GET', '/api/v1/hotel/partner/me', { token })).status, 403);
});

console.log('\n[4] hotel partner OTP login');

const PHONE = '9222222222';
let partnerToken;
let refreshToken;
let partnerId;

await check('request-otp accepts a +91 number and normalises it', async () => {
    const res = await call(server, 'POST', '/api/v1/hotel/partner/auth/request-otp', { body: { phone: `+91 ${PHONE}` } });
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.json.data.phone, PHONE);
    assert.equal(res.json.data.isExistingPartner, false);
});

await check('verify-otp with the dev code creates a pending partner and returns tokens', async () => {
    const res = await call(server, 'POST', '/api/v1/hotel/partner/auth/verify-otp', { body: { phone: PHONE, otp: '1234' } });
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.json.data.isNewPartner, true);
    assert.equal(res.json.data.partner.status, 'pending');
    assert.ok(res.json.data.accessToken && res.json.data.refreshToken);
    partnerToken = res.json.data.accessToken;
    refreshToken = res.json.data.refreshToken;
    partnerId = res.json.data.partner._id;
});

await check('the partner is linked to a platform user', async () => {
    const p = await M.HotelPartner.findById(partnerId).lean();
    assert.ok(p.platformUserId);
});

await check('a wrong OTP is refused', async () => {
    await call(server, 'POST', '/api/v1/hotel/partner/auth/request-otp', { body: { phone: '9333333333' } });
    const res = await call(server, 'POST', '/api/v1/hotel/partner/auth/verify-otp', { body: { phone: '9333333333', otp: '9999' } });
    assert.equal(res.status, 401);
});

await check('a pending partner can read and update their own profile', async () => {
    const me = await call(server, 'GET', '/api/v1/hotel/partner/me', { token: partnerToken });
    assert.equal(me.status, 200);
    const upd = await call(server, 'PUT', '/api/v1/hotel/partner/me', {
        token: partnerToken,
        body: { name: 'Demo Owner', kyc: { panNumber: 'abcde1234f', aadhaarNumberMasked: 'XXXXXXXX1234' }, acceptTerms: true },
    });
    assert.equal(upd.status, 200, upd.raw);
    assert.equal(upd.json.data.partner.name, 'Demo Owner');
    assert.equal(upd.json.data.partner.kyc.panNumber, 'ABCDE1234F');
    assert.ok(upd.json.data.partner.termsAcceptedAt);
});

await check('an unmasked Aadhaar number is rejected', async () => {
    const res = await call(server, 'PUT', '/api/v1/hotel/partner/me', {
        token: partnerToken, body: { kyc: { aadhaarNumberMasked: '123456789012' } },
    });
    assert.equal(res.status, 400);
});

await check('a partner cannot set their own status', async () => {
    const res = await call(server, 'PUT', '/api/v1/hotel/partner/me', { token: partnerToken, body: { status: 'approved' } });
    assert.equal(res.status, 400);
    assert.equal((await M.HotelPartner.findById(partnerId).lean()).status, 'pending');
});

await check('blocking a partner cuts off the access token and the refresh token', async () => {
    await M.HotelPartner.updateOne({ _id: partnerId }, { status: 'blocked' });
    invalidateAccountCache('HOTEL_PARTNER', partnerId);
    assert.equal((await call(server, 'GET', '/api/v1/hotel/partner/me', { token: partnerToken })).status, 403);
    const refresh = await call(server, 'POST', '/api/v1/auth/refresh-token', { body: { refreshToken } });
    assert.equal(refresh.status, 401, refresh.raw);
    const otp = await call(server, 'POST', '/api/v1/hotel/partner/auth/request-otp', { body: { phone: PHONE } });
    assert.equal(otp.status, 403);
});

console.log('\n[5] admin access');

const adminToken = async (servicesAccess) => {
    const admin = await M.FoodAdmin.create({
        email: `a${Date.now()}${Math.random().toString(36).slice(2, 6)}@ksg.test`,
        password: 'irrelevant-for-this-test',
        name: 'Test Admin',
        servicesAccess,
    });
    return signAccessToken({ userId: String(admin._id), role: 'ADMIN' });
};

await check("an admin without 'hotel' access gets 403", async () => {
    const token = await adminToken(['food']);
    assert.equal((await call(server, 'GET', '/api/v1/hotel/admin/overview', { token })).status, 403);
});

await check("an admin with 'hotel' access sees the overview", async () => {
    const token = await adminToken(['hotel']);
    const res = await call(server, 'GET', '/api/v1/hotel/admin/overview', { token });
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.json.data.partners.blocked, 1);
});

server.close();
await mongoose.disconnect();
await mongod.stop();

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall hotel phase-1 checks passed');
process.exit(failures ? 1 : 0);
