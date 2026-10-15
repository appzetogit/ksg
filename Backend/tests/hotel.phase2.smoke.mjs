// Hotel phases 2-3: partner properties, inventory, search, admin approvals.
// Contract: docs/hotel-api-contract.md.
//
// Boots the real express app against an in-memory single-node REPLICA SET (so Mongo
// transactions are real) and walks: draft -> room types -> documents -> submit
// validations -> admin approval -> partner approval -> live -> search; inventory
// backfill; the last-unit race; blocks; search filters; ownership; approval gates.
//
// Run: node tests/hotel.phase2.smoke.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
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

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
process.env.MONGO_URI = replSet.getUri();
process.env.NODE_ENV = 'test';
process.env.USE_DEFAULT_OTP = 'true';
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-0123456789-0123456789-0123456789';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-0123456789-0123456789-0123456789';

await mongoose.connect(process.env.MONGO_URI);
const { default: app } = await import('../src/app.js');
const server = app.listen(0);

const { HOTEL_MODEL_NAMES } = await import('../src/modules/hotel/models/index.js');
const { signAccessToken } = await import('../src/core/auth/token.util.js');
const inv = await import('../src/modules/hotel/services/inventory.service.js');
const M = mongoose.models;
await Promise.all(HOTEL_MODEL_NAMES.map((n) => M[n].syncIndexes()));

const H = '/api/v1/hotel';
const today = inv.todayIST();
const d = (n) => inv.addDays(today, n);
const img = (t) => `https://placehold.co/1200x800?text=${t}`;

const makePartner = async (phone, status, extra = {}) => {
    const p = await M.HotelPartner.create({ phone, name: `Partner ${phone}`, status, ...extra });
    return { id: String(p._id), token: signAccessToken({ userId: String(p._id), role: 'HOTEL_PARTNER' }) };
};
const A = await makePartner('9400000001', 'pending');
const B = await makePartner('9400000002', 'approved', { kyc: { ownerName: 'B', panNumber: 'ABCDE1234F' } });
const C = await makePartner('9400000003', 'pending');
const admin = await M.FoodAdmin.create({
    email: `hoteladmin${Date.now()}@ksg.test`, password: 'irrelevant-for-this-test', name: 'Hotel Admin', servicesAccess: ['hotel'],
});
const adminToken = signAccessToken({ userId: String(admin._id), role: 'ADMIN' });

// Bhopal, and a point ~10 km away for the second property.
const BHOPAL = { lat: 23.2599, lng: 77.4126 };
const LAKE = { lat: 23.2500, lng: 77.3150 };

let propId;
let slug;
let rt1; // 2 rooms
let rt2; // 1 room (race)

console.log('\n[1] property draft -> room types -> documents -> submit');

await check('a pending partner creates a draft with only basics (no location, no cover)', async () => {
    const res = await call(server, 'POST', `${H}/partner/properties`, {
        token: A.token, body: { name: 'Lakeview Inn', propertyType: 'hotel' },
    });
    assert.equal(res.status, 201, res.raw);
    const p = res.json.data.property;
    assert.equal(p.status, 'draft');
    assert.equal(p.isLive, false);
    assert.equal(p.location, undefined);
    assert.ok(p.slug.startsWith('lakeview-inn'));
    propId = p._id;
    slug = p.slug;
    const raw = await M.HotelProperty.collection.findOne({ _id: new mongoose.Types.ObjectId(propId) });
    assert.equal(raw.location, undefined, 'no half-built GeoJSON stored');
});

await check('a second property with the same name gets a different slug', async () => {
    const res = await call(server, 'POST', `${H}/partner/properties`, {
        token: A.token, body: { name: 'Lakeview Inn', propertyType: 'homestay', location: BHOPAL },
    });
    assert.equal(res.status, 201, res.raw);
    assert.notEqual(res.json.data.property.slug, slug);
    await call(server, 'DELETE', `${H}/partner/properties/${res.json.data.property._id}`, { token: A.token });
});

await check('PUT adds location (GeoJSON), address, cover and gallery', async () => {
    const res = await call(server, 'PUT', `${H}/partner/properties/${propId}`, {
        token: A.token,
        body: {
            location: BHOPAL,
            address: { line1: 'MP Nagar', area: 'MP Nagar', city: 'Bhopal', state: 'Madhya Pradesh', pincode: '462011' },
            coverImage: img('cover'),
            images: [img('one'), img('two')],
            amenities: ['wifi', 'parking', 'ac'],
            suitability: 'both',
        },
    });
    assert.equal(res.status, 200, res.raw);
    assert.deepEqual(res.json.data.property.location.coordinates, [BHOPAL.lng, BHOPAL.lat]);
    assert.equal(res.json.data.property.address.city, 'Bhopal');
});

await check('a hotel cannot sell beds (server-side inventory-type rule)', async () => {
    const res = await call(server, 'POST', `${H}/partner/properties/${propId}/room-types`, {
        token: A.token,
        body: { name: 'Dorm', inventoryType: 'bed', maxAdults: 1, totalInventory: 2, pricePerNight: 500, images: [img('a'), img('b'), img('c')] },
    });
    assert.equal(res.status, 400, res.raw);
});

await check('room types are created and inventory is backfilled for 365 nights', async () => {
    const r1 = await call(server, 'POST', `${H}/partner/properties/${propId}/room-types`, {
        token: A.token,
        body: {
            name: 'Deluxe', maxAdults: 2, maxChildren: 1, totalInventory: 2, pricePerNight: 2000, weekendPrice: 2500,
            originalPrice: 2600, images: [img('a'), img('b'), img('c')], amenities: ['wifi', 'tv'],
        },
    });
    assert.equal(r1.status, 201, r1.raw);
    assert.equal(r1.json.data.roomType.inventoryType, 'room');
    rt1 = r1.json.data.roomType._id;
    const r2 = await call(server, 'POST', `${H}/partner/properties/${propId}/room-types`, {
        token: A.token,
        body: { name: 'Suite', maxAdults: 3, totalInventory: 1, pricePerNight: 4000, images: [img('a'), img('b'), img('c')] },
    });
    assert.equal(r2.status, 201, r2.raw);
    rt2 = r2.json.data.roomType._id;
    assert.equal(await M.HotelInventoryDay.countDocuments({ roomTypeId: rt1 }), 365);
    assert.equal(await M.HotelInventoryDay.countDocuments({ roomTypeId: rt2 }), 365);
    const first = await M.HotelInventoryDay.findOne({ roomTypeId: rt1 }).sort({ date: 1 }).lean();
    assert.equal(inv.toDateString(first.date), today);
    assert.equal(first.date.toISOString().slice(11), '18:30:00.000Z', 'nights stored at 00:00 IST');
    assert.equal(first.capacity, 2);
});

await check('startingPrice / originalPrice follow the cheapest active room type', async () => {
    const p = await M.HotelProperty.findById(propId).lean();
    assert.equal(p.startingPrice, 2000);
    assert.equal(p.originalPrice, 2600);
});

await check('submit lists what is missing (documents, KYC) with 400', async () => {
    const res = await call(server, 'POST', `${H}/partner/properties/${propId}/submit`, { token: A.token });
    assert.equal(res.status, 400, res.raw);
    assert.match(res.json.message, /trade_license/);
    assert.match(res.json.message, /KYC/);
});

await check('submit needs 3 photos counting the cover', async () => {
    await M.HotelProperty.updateOne({ _id: propId }, { images: [img('one')] });
    const res = await call(server, 'POST', `${H}/partner/properties/${propId}/submit`, { token: A.token });
    assert.match(res.json.message, /3 photos/);
    await M.HotelProperty.updateOne({ _id: propId }, { images: [img('one'), img('two')] });
});

await check('documents PUT returns computed requiredTypes', async () => {
    const res = await call(server, 'PUT', `${H}/partner/properties/${propId}/documents`, {
        token: A.token, body: { documents: [{ type: 'trade_license', fileUrl: 'https://files.test/private/documents/tl.pdf' }] },
    });
    assert.equal(res.status, 200, res.raw);
    assert.deepEqual(res.json.data.requiredTypes, ['trade_license']);
    assert.equal(res.json.data.documents[0].isRequired, true);
    assert.equal(res.json.data.verificationStatus, 'pending');
});

await check('with KYC done the property submits to pending', async () => {
    const me = await call(server, 'PUT', `${H}/partner/me`, {
        token: A.token, body: { kyc: { ownerName: 'Asha', panNumber: 'ABCDE1234F' } },
    });
    assert.equal(me.status, 200, me.raw);
    const res = await call(server, 'POST', `${H}/partner/properties/${propId}/submit`, { token: A.token });
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.json.data.property.status, 'pending');
    const again = await call(server, 'POST', `${H}/partner/properties/${propId}/submit`, { token: A.token });
    assert.equal(again.status, 409);
});

console.log('\n[2] approvals and live');

await check('an unapproved property cannot go live', async () => {
    const res = await call(server, 'PUT', `${H}/partner/properties/${propId}/live`, { token: A.token, body: { isLive: true } });
    assert.equal(res.status, 403);
});

await check('admin rejects without a reason -> 400; approves -> documents verified', async () => {
    const bad = await call(server, 'PUT', `${H}/admin/properties/${propId}/status`, { token: adminToken, body: { status: 'rejected' } });
    assert.equal(bad.status, 400);
    const res = await call(server, 'PUT', `${H}/admin/properties/${propId}/status`, { token: adminToken, body: { status: 'approved' } });
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.json.data.property.status, 'approved');
    assert.equal(String(res.json.data.property.approvedBy), String(admin._id));
    const docs = await M.HotelPropertyDocument.findOne({ propertyId: propId }).lean();
    assert.equal(docs.verificationStatus, 'verified');
});

await check('an approved property of a PENDING partner still cannot go live', async () => {
    const res = await call(server, 'PUT', `${H}/partner/properties/${propId}/live`, { token: A.token, body: { isLive: true } });
    assert.equal(res.status, 403);
});

await check('a pending partner is refused inventory and dashboard (403)', async () => {
    assert.equal((await call(server, 'GET', `${H}/partner/dashboard`, { token: C.token })).status, 403);
    assert.equal((await call(server, 'GET', `${H}/partner/inventory?roomTypeId=${rt1}&from=${today}&to=${d(3)}`, { token: A.token })).status, 403);
});

await check('admin approves the partner (cache invalidated) -> partner goes live', async () => {
    // Warm the auth cache with the pending status first.
    await call(server, 'GET', `${H}/partner/me`, { token: A.token });
    const res = await call(server, 'PUT', `${H}/admin/partners/${A.id}/status`, { token: adminToken, body: { status: 'approved' } });
    assert.equal(res.status, 200, res.raw);
    assert.ok(res.json.data.partner.approvedAt);
    const live = await call(server, 'PUT', `${H}/partner/properties/${propId}/live`, { token: A.token, body: { isLive: true } });
    assert.equal(live.status, 200, live.raw);
    assert.equal(live.json.data.property.isLive, true);
});

await check('the live property appears in search, detail (id and slug) and cities', async () => {
    const res = await call(server, 'GET', `${H}/public/properties`);
    assert.equal(res.status, 200, res.raw);
    const card = res.json.data.items.find((i) => i._id === propId);
    assert.ok(card, 'in search');
    assert.equal(card.startingPrice, 2000);
    assert.equal(card.originalPrice, 2600);
    assert.equal(card.address.city, 'Bhopal');
    const bySlug = await call(server, 'GET', `${H}/public/properties/${slug}`);
    assert.equal(bySlug.status, 200, bySlug.raw);
    assert.equal(bySlug.json.data.roomTypes.length, 2);
    assert.equal(bySlug.json.data.property.approvedBy, undefined);
    assert.equal((await call(server, 'GET', `${H}/public/properties/${propId}`)).status, 200);
    const cities = await call(server, 'GET', `${H}/public/cities`);
    assert.deepEqual(cities.json.data, [{ city: 'Bhopal', count: 1 }]);
});

await check('a blocked partner\'s property drops out of search', async () => {
    await call(server, 'PUT', `${H}/admin/partners/${A.id}/status`, { token: adminToken, body: { status: 'blocked', reason: 'test block' } });
    const res = await call(server, 'GET', `${H}/public/properties`);
    assert.equal(res.json.data.items.some((i) => i._id === propId), false);
    await call(server, 'PUT', `${H}/admin/partners/${A.id}/status`, { token: adminToken, body: { status: 'approved' } });
    assert.equal((await call(server, 'GET', `${H}/public/properties/${propId}`)).status, 200);
});

console.log('\n[3] ownership');

await check('another partner gets 404 on someone else\'s property, room type and inventory', async () => {
    assert.equal((await call(server, 'GET', `${H}/partner/properties/${propId}`, { token: B.token })).status, 404);
    assert.equal((await call(server, 'PUT', `${H}/partner/properties/${propId}`, { token: B.token, body: { name: 'Hijack' } })).status, 404);
    assert.equal((await call(server, 'DELETE', `${H}/partner/properties/${propId}`, { token: B.token })).status, 404);
    assert.equal((await call(server, 'PUT', `${H}/partner/properties/${propId}/room-types/${rt1}`, { token: B.token, body: { pricePerNight: 1 } })).status, 404);
    assert.equal((await call(server, 'GET', `${H}/partner/inventory?roomTypeId=${rt1}&from=${today}&to=${d(3)}`, { token: B.token })).status, 404);
    const block = await call(server, 'POST', `${H}/partner/inventory/blocks`, {
        token: B.token, body: { roomTypeId: rt1, source: 'manual_block', startDate: d(1), endDate: d(2), units: 1 },
    });
    assert.equal(block.status, 404);
    const list = await call(server, 'GET', `${H}/partner/properties`, { token: B.token });
    assert.deepEqual(list.json.data, []);
});

console.log('\n[4] inventory');

await check('reserve: 10 parallel requests for the last unit -> exactly one wins', async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, () =>
        inv.reserve({ roomTypeId: rt2, checkIn: d(5), checkOut: d(7), units: 1 })));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const conflicts = results.filter((r) => r.status === 'rejected' && r.reason?.statusCode === 409).length;
    assert.equal(ok, 1, `winners: ${ok}; errors: ${results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message).join(' | ')}`);
    assert.equal(conflicts, 9);
    const rows = await M.HotelInventoryDay.find({ roomTypeId: rt2, date: { $in: [inv.toNightDate(d(5)), inv.toNightDate(d(6))] } }).lean();
    assert.deepEqual(rows.map((r) => r.booked), [1, 1]);
});

await check('reserve fails as a whole when one night is full (no partial hold)', async () => {
    await assert.rejects(inv.reserve({ roomTypeId: rt2, checkIn: d(4), checkOut: d(6), units: 1 }), /Not enough rooms/);
    const night4 = await M.HotelInventoryDay.findOne({ roomTypeId: rt2, date: inv.toNightDate(d(4)) }).lean();
    assert.equal(night4.booked, 0);
    await inv.release({ roomTypeId: rt2, checkIn: d(5), checkOut: d(7), units: 1 });
    const night5 = await M.HotelInventoryDay.findOne({ roomTypeId: rt2, date: inv.toNightDate(d(5)) }).lean();
    assert.equal(night5.booked, 0);
});

await check('calendar GET (inclusive range) and bulk PUT of price/stop-sell', async () => {
    const put = await call(server, 'PUT', `${H}/partner/inventory`, {
        token: A.token, body: { roomTypeId: rt1, from: d(30), to: d(31), priceOverride: 3333, closed: true },
    });
    assert.equal(put.status, 200, put.raw);
    const res = await call(server, 'GET', `${H}/partner/inventory?propertyId=${propId}&roomTypeId=${rt1}&from=${d(29)}&to=${d(31)}`, { token: A.token });
    assert.equal(res.status, 200, res.raw);
    const days = res.json.data.days;
    assert.equal(days.length, 3);
    assert.equal(days[1].price, 3333);
    assert.equal(days[1].closed, true);
    assert.equal(days[0].closed, false);
    const clear = await call(server, 'PUT', `${H}/partner/inventory`, {
        token: A.token, body: { roomTypeId: rt1, from: d(30), to: d(31), priceOverride: null, closed: false },
    });
    assert.equal(clear.status, 200);
    const after = await M.HotelInventoryDay.findOne({ roomTypeId: rt1, date: inv.toNightDate(d(30)) }).lean();
    assert.equal(after.priceOverride, undefined);
    const tooLong = await call(server, 'GET', `${H}/partner/inventory?roomTypeId=${rt1}&from=${today}&to=${d(100)}`, { token: A.token });
    assert.equal(tooLong.status, 400);
});

let blockId;
await check('a block takes units (ledger + counter); an over-block is 409', async () => {
    const res = await call(server, 'POST', `${H}/partner/inventory/blocks`, {
        token: A.token,
        body: { roomTypeId: rt1, source: 'external', externalPlatform: 'OTA', startDate: d(10), endDate: d(12), units: 2 },
    });
    assert.equal(res.status, 201, res.raw);
    blockId = res.json.data._id;
    assert.equal(res.json.data.endDate, d(12));
    const cal = await call(server, 'GET', `${H}/partner/inventory?roomTypeId=${rt1}&from=${d(10)}&to=${d(12)}`, { token: A.token });
    assert.deepEqual(cal.json.data.days.map((x) => x.available), [0, 0, 2]);
    const over = await call(server, 'POST', `${H}/partner/inventory/blocks`, {
        token: A.token, body: { roomTypeId: rt1, source: 'walk_in', startDate: d(11), endDate: d(12), units: 1 },
    });
    assert.equal(over.status, 409, over.raw);
    assert.equal(await M.HotelAvailability.countDocuments({ roomTypeId: rt1 }), 1, 'no ledger row for the refused block');
    const list = await call(server, 'GET', `${H}/partner/inventory/blocks?propertyId=${propId}&from=${d(9)}&to=${d(10)}`, { token: A.token });
    assert.equal(list.json.data.length, 1);
    assert.equal(list.json.data[0].roomTypeName, 'Deluxe');
});

await check('capacity cannot drop below what is booked (409); raising it works', async () => {
    const down = await call(server, 'PUT', `${H}/partner/properties/${propId}/room-types/${rt1}`, { token: A.token, body: { totalInventory: 1 } });
    assert.equal(down.status, 409, down.raw);
    assert.equal((await M.HotelRoomType.findById(rt1).lean()).totalInventory, 2);
    const up = await call(server, 'PUT', `${H}/partner/properties/${propId}/room-types/${rt1}`, { token: A.token, body: { totalInventory: 3 } });
    assert.equal(up.status, 200, up.raw);
    const row = await M.HotelInventoryDay.findOne({ roomTypeId: rt1, date: inv.toNightDate(d(10)) }).lean();
    assert.equal(row.capacity, 3);
    await call(server, 'PUT', `${H}/partner/properties/${propId}/room-types/${rt1}`, { token: A.token, body: { totalInventory: 2 } });
});

console.log('\n[5] search');

// A second live property (resort, by the lake, pricier) built straight in the DB.
const p2 = await M.HotelProperty.create({
    partnerId: A.id, name: 'Upper Lake Resort', slug: 'upper-lake-resort', propertyType: 'resort',
    address: { area: 'Van Vihar', city: 'Bhopal' }, location: { type: 'Point', coordinates: [LAKE.lng, LAKE.lat] },
    coverImage: img('resort'), images: [img('r1'), img('r2')], amenities: ['wifi', 'pool'],
    status: 'approved', isLive: true, avgRating: 4.6, totalReviews: 12, suitability: 'family_friendly',
});
const p2rt = await M.HotelRoomType.create({
    propertyId: p2._id, name: 'Lake Cottage', inventoryType: 'room', maxAdults: 4, maxChildren: 2,
    totalInventory: 3, pricePerNight: 6000, images: [img('a'), img('b'), img('c')],
});
await inv.backfillInventory(p2rt);
const { refreshPropertyPrices } = await import('../src/modules/hotel/services/property.service.js');
await refreshPropertyPrices(p2._id);

const search = async (qs) => {
    const res = await call(server, 'GET', `${H}/public/properties?${qs}`);
    assert.equal(res.status, 200, res.raw);
    return res.json.data;
};
const ids = (data) => data.items.map((i) => i._id);

await check('type filter', async () => {
    assert.deepEqual(ids(await search('types=resort')), [String(p2._id)]);
    assert.deepEqual(ids(await search('types=hotel,villa')), [propId]);
});

await check('price filter and price sort', async () => {
    assert.deepEqual(ids(await search('maxPrice=3000')), [propId]);
    assert.deepEqual(ids(await search('minPrice=5000')), [String(p2._id)]);
    assert.deepEqual(ids(await search('sort=price_high')), [String(p2._id), propId]);
    assert.deepEqual(ids(await search('sort=price_low')), [propId, String(p2._id)]);
});

await check('amenities (all must match), rating, suitability, text', async () => {
    assert.deepEqual(ids(await search('amenities=wifi,pool')), [String(p2._id)]);
    assert.deepEqual(ids(await search('minRating=4')), [String(p2._id)]);
    assert.deepEqual(ids(await search('suitability=couple_friendly')), [propId]);
    assert.deepEqual(ids(await search('q=van%20vihar')), [String(p2._id)]);
    assert.equal((await search('city=bhopal')).total, 2);
});

await check('party size: 5 adults in 1 room fits nowhere; 2 rooms fits the resort', async () => {
    assert.equal((await search('adults=5&rooms=1')).total, 0);
    assert.deepEqual(ids(await search('adults=5&rooms=2')), [String(p2._id)]);
});

await check('geo: distance sort, distanceKm, radius', async () => {
    const near = await search(`lat=${LAKE.lat}&lng=${LAKE.lng}&sort=distance`);
    assert.deepEqual(ids(near), [String(p2._id), propId]);
    assert.ok(near.items[0].distanceKm < 0.1);
    assert.ok(near.items[1].distanceKm > 5 && near.items[1].distanceKm < 15, `got ${near.items[1].distanceKm}`);
    assert.deepEqual(ids(await search(`lat=${LAKE.lat}&lng=${LAKE.lng}&radiusKm=3`)), [String(p2._id)]);
});

await check('dates: sold-out nights exclude a property; free nights include it', async () => {
    // rt1 is fully blocked d10-d11; block the suite too so the whole property is sold out.
    const b2 = await call(server, 'POST', `${H}/partner/inventory/blocks`, {
        token: A.token, body: { roomTypeId: rt2, source: 'manual_block', startDate: d(10), endDate: d(11), units: 1 },
    });
    assert.equal(b2.status, 201, b2.raw);
    const sold = await search(`checkIn=${d(10)}&checkOut=${d(12)}`);
    assert.deepEqual(ids(sold), [String(p2._id)]);
    assert.equal(sold.items[0].available, true);
    // Only d11 has the suite free -> one night stay d11-d12 fits the suite (rt1 is still full).
    const card = (await search(`checkIn=${d(11)}&checkOut=${d(12)}`)).items.find((i) => i._id === propId);
    assert.ok(card, 'suite free on d11');
    assert.equal(card.startingPrice, 4000, 'priced from the room type that is actually free');
    // Stop-sell on the resort's d20 night.
    await M.HotelInventoryDay.updateOne({ roomTypeId: p2rt._id, date: inv.toNightDate(d(20)) }, { closed: true });
    assert.deepEqual(ids(await search(`checkIn=${d(20)}&checkOut=${d(21)}`)), [propId]);
    // rooms=3 needs 3 free units: only the resort has 3 rooms.
    assert.deepEqual(ids(await search(`checkIn=${d(40)}&checkOut=${d(41)}&rooms=3`)), [String(p2._id)]);
});

await check('deleting a block releases its units and the property is back for those dates', async () => {
    const del = await call(server, 'DELETE', `${H}/partner/inventory/blocks/${blockId}`, { token: A.token });
    assert.equal(del.status, 200, del.raw);
    const row = await M.HotelInventoryDay.findOne({ roomTypeId: rt1, date: inv.toNightDate(d(10)) }).lean();
    assert.equal(row.booked, 0);
    assert.equal(await M.HotelAvailability.countDocuments({ _id: blockId }), 0);
    assert.ok(ids(await search(`checkIn=${d(10)}&checkOut=${d(12)}`)).includes(propId));
    assert.equal((await call(server, 'DELETE', `${H}/partner/inventory/blocks/${blockId}`, { token: A.token })).status, 404);
});

await check('bad search input is a 400', async () => {
    assert.equal((await call(server, 'GET', `${H}/public/properties?checkIn=${d(3)}`)).status, 400);
    assert.equal((await call(server, 'GET', `${H}/public/properties?checkIn=${d(3)}&checkOut=${d(2)}`)).status, 400);
    assert.equal((await call(server, 'GET', `${H}/public/properties?types=castle`)).status, 400);
});

console.log('\n[6] availability');

await check('nightly prices use weekend price on Fri/Sat and overrides; bookable follows the party', async () => {
    // Find the next Friday at least 50 days out.
    let fri = d(50);
    while (!inv.isWeekendNight(fri) || inv.isWeekendNight(inv.addDays(fri, -1))) fri = inv.addDays(fri, 1);
    const thu = inv.addDays(fri, -1);
    await M.HotelInventoryDay.updateOne({ roomTypeId: rt1, date: inv.toNightDate(thu) }, { priceOverride: 1800 });
    const res = await call(server, 'GET', `${H}/public/properties/${propId}/availability?checkIn=${thu}&checkOut=${inv.addDays(fri, 1)}&adults=2&rooms=2`);
    assert.equal(res.status, 200, res.raw);
    const deluxe = res.json.data.roomTypes.find((r) => r.roomTypeId === rt1);
    assert.deepEqual(deluxe.nightlyPrices.map((n) => n.price), [1800, 2500]);
    assert.equal(deluxe.total, 2 * (1800 + 2500));
    assert.equal(deluxe.available, 2);
    assert.equal(deluxe.bookable, true);
    const suite = res.json.data.roomTypes.find((r) => r.roomTypeId === rt2);
    assert.equal(suite.bookable, false, 'only 1 suite, 2 rooms asked');
    assert.equal(res.json.data.nights, 2);
    const kids = await call(server, 'GET', `${H}/public/properties/${propId}/availability?checkIn=${thu}&checkOut=${fri}&adults=2&children=1`);
    assert.equal(kids.json.data.roomTypes.find((r) => r.roomTypeId === rt2).bookable, false, 'suite takes no children');
});

console.log('\n[7] edits, deletes, dashboard, admin lists');

await check('renaming an approved property sends it back to pending; other edits do not', async () => {
    const soft = await call(server, 'PUT', `${H}/partner/properties/${propId}`, { token: A.token, body: { description: 'Nice', location: BHOPAL } });
    assert.equal(soft.json.data.property.status, 'approved');
    const res = await call(server, 'PUT', `${H}/partner/properties/${propId}`, { token: A.token, body: { name: 'Lakeview Inn & Suites' } });
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.json.data.property.status, 'pending');
    assert.equal(res.json.data.property.slug, slug, 'slug stays stable');
    assert.equal((await call(server, 'GET', `${H}/public/properties/${propId}`)).status, 404);
    await call(server, 'PUT', `${H}/admin/properties/${propId}/status`, { token: adminToken, body: { status: 'approved' } });
});

await check('an upcoming booking blocks deleting the property and its room type (409)', async () => {
    await M.HotelBooking.create({
        bookingRef: 'KSGHTEST1', userId: new mongoose.Types.ObjectId(), propertyId: propId, partnerId: A.id, roomTypeId: rt2,
        checkIn: inv.toNightDate(d(60)), checkOut: inv.toNightDate(d(61)), nights: 1, guests: { adults: 2 },
        pricing: { roomCharges: 4000, subtotal: 4000, taxableAmount: 4000, total: 4000 },
        payment: { mode: 'pay_at_hotel' }, status: 'confirmed',
    });
    assert.equal((await call(server, 'DELETE', `${H}/partner/properties/${propId}/room-types/${rt2}`, { token: A.token })).status, 409);
    assert.equal((await call(server, 'DELETE', `${H}/partner/properties/${propId}`, { token: A.token })).status, 409);
    const ok = await call(server, 'DELETE', `${H}/partner/properties/${propId}/room-types/${rt1}`, { token: A.token });
    assert.equal(ok.status, 200, ok.raw);
    assert.equal(ok.json.data.roomType.isActive, false);
    assert.equal((await M.HotelProperty.findById(propId).lean()).startingPrice, 4000, 'price follows the remaining room type');
});

await check('dashboard counts the partner\'s properties', async () => {
    const res = await call(server, 'GET', `${H}/partner/dashboard`, { token: A.token });
    assert.equal(res.status, 200, res.raw);
    assert.deepEqual(res.json.data.properties, { total: 2, live: 2, pending: 0 });
    // Real since phase 5: the confirmed booking made above (d+60) is upcoming.
    assert.equal(res.json.data.upcomingBookings, 1);
});

await check('admin lists and details', async () => {
    const partners = await call(server, 'GET', `${H}/admin/partners?status=approved&page=1&limit=10`, { token: adminToken });
    assert.equal(partners.status, 200, partners.raw);
    assert.equal(partners.json.data.total, 2);
    assert.equal(partners.json.data.items[0].fcmTokens, undefined);
    const pd = await call(server, 'GET', `${H}/admin/partners/${A.id}`, { token: adminToken });
    assert.equal(pd.json.data.properties.length, 2);
    const props = await call(server, 'GET', `${H}/admin/properties?type=resort&city=Bhopal`, { token: adminToken });
    assert.equal(props.json.data.total, 1);
    assert.equal(props.json.data.items[0].partner.phone, '9400000001');
    const detail = await call(server, 'GET', `${H}/admin/properties/${propId}`, { token: adminToken });
    assert.equal(detail.status, 200);
    assert.equal(detail.json.data.roomTypes.length, 2);
    assert.deepEqual(detail.json.data.documents.requiredTypes, ['trade_license']);
    const verify = await call(server, 'PUT', `${H}/admin/properties/${propId}/documents/verify`, {
        token: adminToken, body: { verificationStatus: 'rejected', adminRemark: 'blurry' },
    });
    assert.equal(verify.status, 200, verify.raw);
    assert.equal(verify.json.data.verificationStatus, 'rejected');
    const off = await call(server, 'PUT', `${H}/admin/properties/${p2._id}/live`, { token: adminToken, body: { isLive: false } });
    assert.equal(off.json.data.property.isLive, false);
    const susp = await call(server, 'PUT', `${H}/admin/properties/${propId}/status`, { token: adminToken, body: { status: 'suspended', reason: 'audit' } });
    assert.equal(susp.json.data.property.isLive, false);
    assert.equal((await search('')).total, 0);
});

server.close();
await mongoose.disconnect();
await replSet.stop();

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall hotel phase-2/3 checks passed');
process.exit(failures ? 1 : 0);
