// Hotel phase 9: coupons. Contract: docs/hotel-api-contract.md "Phase 9: coupons".
//
// Boots the real express app against an in-memory single-node REPLICA SET (real
// transactions), with Razorpay replaced at the hotel gateway boundary as in
// hotel.booking.smoke.mjs.
//
// Covers: admin CRUD + validation, percentage cap, flat, minimum amount, expired /
// scheduled / paused, property and property-type restrictions, first booking only,
// per-user limit, the total limit under parallel bookings, release on cancel and on
// expiry, the quote's discount line, customer offers list (public fields only),
// Master > Coupons listing, and settlement amounts for platform- and partner-funded
// coupons.
//
// Run: node tests/hotel.coupons.smoke.mjs

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
        console.log(`  FAIL ${name}\n         ${err.stack?.split('\n').slice(0, 4).join('\n         ') || err.message}`);
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

const KEY_SECRET = 'hotel_test_key_secret_0123456789';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
process.env.MONGO_URI = replSet.getUri();
process.env.NODE_ENV = 'test';
process.env.USE_DEFAULT_OTP = 'true';
process.env.RAZORPAY_KEY_ID = 'rzp_test_hotel';
process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = 'hotel-webhook-test-secret';
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-0123456789-0123456789-0123456789';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-0123456789-0123456789-0123456789';

await mongoose.connect(process.env.MONGO_URI);
const { default: app } = await import('../src/app.js');
const server = app.listen(0);

const { HOTEL_MODEL_NAMES } = await import('../src/modules/hotel/models/index.js');
const { signAccessToken } = await import('../src/core/auth/token.util.js');
const inv = await import('../src/modules/hotel/services/inventory.service.js');
const svc = await import('../src/modules/hotel/services/booking.service.js');
const offers = await import('../src/modules/hotel/services/offer.service.js');
const notif = await import('../src/modules/hotel/services/notifications.listener.js');
const { __setHotelGatewayForTests } = await import('../src/modules/hotel/services/gateway.js');
const { FoodUser } = await import('../src/core/users/user.model.js');
const { LedgerEntry } = await import('../src/core/finance/ledgerEntry.model.js');
const { PartnerBalance } = await import('../src/core/finance/partnerBalance.model.js');
const couponList = await import('../src/core/promotions/couponList.service.js');
const M = mongoose.models;
await Promise.all([...HOTEL_MODEL_NAMES.map((n) => M[n].syncIndexes()), LedgerEntry.syncIndexes(), PartnerBalance.syncIndexes()]);

notif.__setSenders({
    push: async () => ({ successCount: 0 }),
    pushTokens: async (tokens) => ({ successCount: tokens.length }),
    email: async () => true,
});

// ─── fake gateway ────────────────────────────────────────────────────────
const orders = new Map();
let seq = 0;
__setHotelGatewayForTests({
    async createOrder({ amountPaise }) {
        const id = `order_C${++seq}`;
        orders.set(id, { amountPaise });
        return { id, amount: amountPaise, currency: 'INR' };
    },
    async fetchPayment(paymentId, { orderId }) {
        return { id: paymentId, order_id: orderId, status: 'captured', amount: orders.get(orderId)?.amountPaise };
    },
    async refund() {
        return { id: `rfnd_C${++seq}`, status: 'processed' };
    },
});
const sign = (orderId, paymentId) => crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

// ─── fixtures ────────────────────────────────────────────────────────────
const H = '/api/v1/hotel';
const today = inv.todayIST();
const d = (n) => inv.addDays(today, n);
const DAY = 24 * 3600 * 1000;
const img = (t) => `https://placehold.co/1200x800?text=${t}`;
const r2 = (n) => Math.round(n * 100) / 100;
const waitFor = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error('timed out waiting');
        await new Promise((r) => setTimeout(r, 50));
    }
};

const partner = await M.HotelPartner.create({ phone: '9500000101', name: 'Asha Stays', status: 'approved', kyc: { ownerName: 'Asha', panNumber: 'ABCDE1234F' } });
const partnerB = await M.HotelPartner.create({ phone: '9500000102', name: 'Beach Co', status: 'approved' });
const admin = await M.FoodAdmin.create({ email: `hc${Date.now()}@ksg.test`, password: 'irrelevant-for-this-test', name: 'Hotel Admin', servicesAccess: ['hotel'] });
const adminToken = signAccessToken({ userId: String(admin._id), role: 'ADMIN' });

const users = [];
for (let i = 0; i < 10; i++) {
    const u = await FoodUser.create({ phone: `98300000${String(i).padStart(2, '0')}`, name: `Guest ${i}` });
    users.push({ doc: u, token: signAccessToken({ userId: String(u._id), role: 'USER' }) });
}
const [U0, U1, U2, U3] = users;

const mkProperty = (over) => M.HotelProperty.create({
    partnerId: partner._id,
    propertyType: 'hotel',
    location: { type: 'Point', coordinates: [77.4126, 23.2599] },
    address: { line1: 'MP Nagar', area: 'MP Nagar', city: 'Bhopal', state: 'MP', pincode: '462011', country: 'India' },
    coverImage: img('cover'),
    images: [img('1'), img('2')],
    checkInTime: '12:00',
    checkOutTime: '11:00',
    cancellationPolicy: { type: 'moderate', freeCancelHours: 24, refundPercentAfter: 50 },
    status: 'approved',
    isLive: true,
    ...over,
});
const propA = await mkProperty({ name: 'Lakeview Inn', slug: 'lakeview-inn' });
const propB = await mkProperty({ name: 'Sea Resort', slug: 'sea-resort', propertyType: 'resort', partnerId: partnerB._id });
const mkRoom = (property, over) => M.HotelRoomType.create({
    propertyId: property._id, inventoryType: 'room', maxAdults: 3, maxChildren: 1, baseAdults: 2, baseChildren: 0,
    extraAdultPrice: 500, extraChildPrice: 300, images: [img('a'), img('b'), img('c')], totalInventory: 20, pricePerNight: 2000, name: 'Deluxe', ...over,
});
const rtA = await mkRoom(propA);
const rtB = await mkRoom(propB);

const body = (over = {}) => ({
    propertyId: String(propA._id), roomTypeId: String(rtA._id), checkIn: d(10), checkOut: d(11),
    rooms: 1, adults: 2, children: 0, paymentMode: 'pay_at_hotel',
    guestDetails: { name: 'Guest', phone: '9830000000' }, ...over,
});
const onB = { propertyId: String(propB._id), roomTypeId: String(rtB._id) };
const quote = (over, user = U0) => call(server, 'POST', `${H}/user/bookings/quote`, { token: user.token, body: body(over) });
const book = (over, user = U0) => call(server, 'POST', `${H}/user/bookings`, { token: user.token, body: body(over) });
const createOffer = (b) => call(server, 'POST', `${H}/admin/offers`, { token: adminToken, body: b });
const offerDoc = (code) => M.HotelOffer.findOne({ code }).lean();
const activeRedemptions = async (code) => M.HotelOfferRedemption.countDocuments({ offerId: (await offerDoc(code))._id, status: 'active' });

/** Online booking with a coupon, paid via verify. */
const paidOnline = async (over, user = U0) => {
    const res = await book({ paymentMode: 'online', ...over }, user);
    assert.equal(res.status, 201, res.raw);
    const { booking, payment } = res.json.data;
    const paymentId = `pay_C${++seq}`;
    const v = await call(server, 'POST', `${H}/user/bookings/${booking._id}/verify-payment`, {
        token: user.token,
        body: { razorpayOrderId: payment.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: sign(payment.razorpayOrderId, paymentId) },
    });
    assert.equal(v.status, 200, v.raw);
    return v.json.data.booking;
};

console.log('\n[1] admin CRUD');

await check('POST /admin/offers creates; code uppercased; defaults platform-funded and active', async () => {
    const res = await createOffer({ code: 'pct20', title: '20% off stays', discountType: 'percentage', discountValue: 20, maxDiscount: 300 });
    assert.equal(res.status, 201, res.raw);
    const o = res.json.data;
    assert.equal(o.code, 'PCT20');
    assert.equal(o.funding, 'platform');
    assert.equal(o.isActive, true);
    assert.equal(o.state, 'live');
    assert.equal(o.usedCount, 0);
    assert.equal(o.summary, '20% off up to Rs 300');
});

await check('duplicate code -> 409; bad values -> 400 with the field', async () => {
    const dup = await createOffer({ code: 'PCT20', discountType: 'flat', discountValue: 10 });
    assert.equal(dup.status, 409, dup.raw);
    const pct = await createOffer({ code: 'BIG150', discountType: 'percentage', discountValue: 150 });
    assert.equal(pct.status, 400);
    assert.match(pct.json.message, /more than 100/);
    const partnerFunded = await createOffer({ code: 'PARTNERALL', discountType: 'flat', discountValue: 100, funding: 'partner' });
    assert.equal(partnerFunded.status, 400);
    assert.match(partnerFunded.json.message, /specific properties/);
    const dates = await createOffer({ code: 'BADDATES', discountType: 'flat', discountValue: 100, validFrom: new Date(Date.now() + 5 * DAY).toISOString(), validTo: new Date().toISOString() });
    assert.equal(dates.status, 400);
    assert.match(dates.json.message, /validTo/);
    const badCode = await createOffer({ code: 'a b', discountType: 'flat', discountValue: 100 });
    assert.equal(badCode.status, 400);
    const ghost = await createOffer({ code: 'GHOST', discountType: 'flat', discountValue: 100, propertyIds: [String(new mongoose.Types.ObjectId())] });
    assert.equal(ghost.status, 400);
});

await check('GET list (with state counts), PUT update, DELETE an unused coupon; customers get 403', async () => {
    const tmp = await createOffer({ code: 'TEMP1', discountType: 'flat', discountValue: 99 });
    assert.equal(tmp.status, 201);
    const list = await call(server, 'GET', `${H}/admin/offers?state=live`, { token: adminToken });
    assert.equal(list.status, 200, list.raw);
    assert.ok(list.json.data.items.some((o) => o.code === 'TEMP1'));
    assert.ok(list.json.data.counts.live >= 2);
    const put = await call(server, 'PUT', `${H}/admin/offers/${tmp.json.data._id}`, { token: adminToken, body: { discountValue: 149, isActive: false } });
    assert.equal(put.status, 200, put.raw);
    assert.equal(put.json.data.discountValue, 149);
    assert.equal(put.json.data.state, 'paused');
    const del = await call(server, 'DELETE', `${H}/admin/offers/${tmp.json.data._id}`, { token: adminToken });
    assert.equal(del.status, 200, del.raw);
    assert.equal(await offerDoc('TEMP1'), null);
    const forbidden = await call(server, 'GET', `${H}/admin/offers`, { token: U0.token });
    assert.equal(forbidden.status, 403);
});

// The rest of the fixtures.
const now = Date.now();
const fixtures = [
    { code: 'FLAT500', discountType: 'flat', discountValue: 500 },
    { code: 'MIN5K', discountType: 'flat', discountValue: 400, minBookingAmount: 5000 },
    { code: 'OLD10', discountType: 'percentage', discountValue: 10, validFrom: new Date(now - 10 * DAY).toISOString(), validTo: new Date(now - DAY).toISOString() },
    { code: 'SOON10', discountType: 'percentage', discountValue: 10, validFrom: new Date(now + 2 * DAY).toISOString() },
    { code: 'PAUSED10', discountType: 'percentage', discountValue: 10, isActive: false },
    { code: 'ONLYB', discountType: 'flat', discountValue: 300, propertyIds: [String(propB._id)] },
    { code: 'RESORTS', discountType: 'flat', discountValue: 250, propertyTypes: ['resort'] },
    { code: 'ONCE', discountType: 'flat', discountValue: 200, perUserLimit: 1 },
    { code: 'FIRST', discountType: 'flat', discountValue: 150, firstBookingOnly: true },
    { code: 'LIMIT3', discountType: 'flat', discountValue: 100, usageLimit: 3 },
    { code: 'EXP1', discountType: 'flat', discountValue: 120, usageLimit: 1 },
    { code: 'KSGPAYS', discountType: 'flat', discountValue: 200, funding: 'platform' },
    { code: 'HOTELPAYS', discountType: 'flat', discountValue: 200, funding: 'partner', propertyIds: [String(propA._id)] },
];
for (const f of fixtures) {
    const res = await createOffer(f);
    if (res.status !== 201) throw new Error(`fixture ${f.code}: ${res.raw}`);
}

console.log('\n[2] validation through the quote');

await check('percentage is capped by maxDiscount; quote shows the discount line', async () => {
    const res = await quote({ checkOut: d(12), couponCode: 'pct20' }); // 2 nights: 4000, 20% = 800 -> cap 300
    assert.equal(res.status, 200, res.raw);
    const q = res.json.data;
    assert.equal(q.pricing.subtotal, 4000);
    assert.equal(q.pricing.couponCode, 'PCT20');
    assert.equal(q.pricing.couponDiscount, 300);
    assert.equal(q.pricing.taxableAmount, 3700);
    assert.equal(q.pricing.gstAmount, 185);
    assert.equal(q.pricing.total, 3885);
    assert.deepEqual(q.coupon, { code: 'PCT20', title: '20% off stays', discount: 300 });
    assert.equal(q.pricing.couponFunding, undefined, 'funding is not shown to customers');
    assert.equal(q.pricing.platformSubsidy, undefined);
    const small = await quote({ couponCode: 'PCT20' }); // 2000 * 20% = 400 -> cap 300
    assert.equal(small.json.data.pricing.couponDiscount, 300);
});

await check('flat discount', async () => {
    const res = await quote({ couponCode: 'FLAT500' });
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.json.data.pricing.couponDiscount, 500);
    assert.equal(res.json.data.pricing.taxableAmount, 1500);
});

await check('minimum booking amount', async () => {
    const res = await quote({ couponCode: 'MIN5K' });
    assert.equal(res.status, 400);
    assert.match(res.json.message, /at least Rs 5,000/);
    const ok = await quote({ checkOut: d(13), couponCode: 'MIN5K' }); // 3 nights = 6000
    assert.equal(ok.status, 200, ok.raw);
    assert.equal(ok.json.data.pricing.couponDiscount, 400);
});

await check('expired / not yet started / paused / unknown', async () => {
    assert.match((await quote({ couponCode: 'OLD10' })).json.message, /OLD10 has expired/);
    assert.match((await quote({ couponCode: 'SOON10' })).json.message, /not active yet/);
    assert.match((await quote({ couponCode: 'PAUSED10' })).json.message, /not active right now/);
    const unknown = await quote({ couponCode: 'NOPE' });
    assert.equal(unknown.status, 400);
    assert.match(unknown.json.message, /not a valid coupon code/);
});

await check('property and property-type restrictions', async () => {
    const wrong = await quote({ couponCode: 'ONLYB' });
    assert.equal(wrong.status, 400);
    assert.match(wrong.json.message, /does not apply to this property/);
    const right = await quote({ ...onB, couponCode: 'ONLYB' });
    assert.equal(right.status, 200, right.raw);
    assert.equal(right.json.data.pricing.couponDiscount, 300);
    assert.equal((await quote({ couponCode: 'RESORTS' })).status, 400);
    assert.equal((await quote({ ...onB, couponCode: 'RESORTS' })).status, 200);
});

await check('GET /user/offers: applicable live offers only, public fields only', async () => {
    const res = await call(server, 'GET', `${H}/user/offers?propertyId=${propA._id}`, { token: U0.token });
    assert.equal(res.status, 200, res.raw);
    const codes = res.json.data.map((o) => o.code);
    for (const c of ['PCT20', 'FLAT500', 'MIN5K', 'ONCE', 'FIRST', 'KSGPAYS', 'HOTELPAYS']) assert.ok(codes.includes(c), `${c} listed`);
    for (const c of ['OLD10', 'SOON10', 'PAUSED10', 'ONLYB', 'RESORTS']) assert.ok(!codes.includes(c), `${c} hidden`);
    const one = res.json.data.find((o) => o.code === 'PCT20');
    assert.deepEqual(Object.keys(one).sort(), ['code', 'description', 'discountType', 'discountValue', 'firstBookingOnly', 'maxDiscount', 'minBookingAmount', 'summary', 'title', 'validTo']);
    const onBList = await call(server, 'GET', `${H}/user/offers?propertyId=${propB._id}`, { token: U0.token });
    assert.ok(onBList.json.data.some((o) => o.code === 'ONLYB'));
    assert.ok(!onBList.json.data.some((o) => o.code === 'HOTELPAYS'));
    assert.equal((await call(server, 'GET', `${H}/user/offers`)).status, 401);
});

console.log('\n[3] redemption limits');

let onceBooking;
await check('per-user limit: second use refused, listing hides it; other users unaffected', async () => {
    const res = await book({ couponCode: 'ONCE' }, U1);
    assert.equal(res.status, 201, res.raw);
    onceBooking = res.json.data.booking;
    assert.equal(onceBooking.pricing.couponDiscount, 200);
    assert.equal(onceBooking.pricing.couponCode, 'ONCE');
    assert.equal((await offerDoc('ONCE')).usedCount, 1);
    assert.equal(await activeRedemptions('ONCE'), 1);
    const again = await quote({ couponCode: 'ONCE' }, U1);
    assert.equal(again.status, 400);
    assert.match(again.json.message, /already used ONCE/);
    const create = await book({ couponCode: 'ONCE' }, U1);
    assert.equal(create.status, 400);
    const list = await call(server, 'GET', `${H}/user/offers?propertyId=${propA._id}`, { token: U1.token });
    assert.ok(!list.json.data.some((o) => o.code === 'ONCE'));
    assert.equal((await quote({ couponCode: 'ONCE' }, U2)).status, 200);
});

await check('cancelling the booking releases the use; the customer can use it again', async () => {
    const res = await call(server, 'POST', `${H}/user/bookings/${onceBooking._id}/cancel`, { token: U1.token, body: { reason: 'change of plan' } });
    assert.equal(res.status, 200, res.raw);
    await waitFor(async () => (await offerDoc('ONCE')).usedCount === 0);
    const r = await M.HotelOfferRedemption.findOne({ bookingId: onceBooking._id }).lean();
    assert.equal(r.status, 'released');
    assert.equal(r.releaseReason, 'cancelled');
    assert.equal((await quote({ couponCode: 'ONCE' }, U1)).status, 200);
});

await check('first booking only', async () => {
    assert.equal((await quote({ couponCode: 'FIRST' }, U3)).status, 200);
    const b = await book({}, U3);
    assert.equal(b.status, 201, b.raw);
    const res = await quote({ couponCode: 'FIRST' }, U3);
    assert.equal(res.status, 400);
    assert.match(res.json.message, /first hotel booking/);
    // U1's only booking was cancelled: still a first booking.
    assert.equal((await quote({ couponCode: 'FIRST' }, U1)).status, 200);
});

await check('total limit holds under 6 parallel bookings (exactly 3 succeed)', async () => {
    const results = await Promise.all(users.slice(4, 10).map((u) => book({ couponCode: 'LIMIT3', checkIn: d(20), checkOut: d(21) }, u)));
    const ok = results.filter((r) => r.status === 201);
    const refused = results.filter((r) => r.status !== 201);
    assert.equal(ok.length, 3, results.map((r) => `${r.status} ${r.json?.message}`).join(' | '));
    for (const r of refused) {
        assert.equal(r.status, 400, r.raw);
        assert.match(r.json.message, /fully used/);
    }
    assert.equal((await offerDoc('LIMIT3')).usedCount, 3);
    assert.equal(await activeRedemptions('LIMIT3'), 3);
    // Refused bookings left nothing behind.
    assert.equal(await M.HotelBooking.countDocuments({ 'pricing.couponCode': 'LIMIT3' }), 3);
    assert.equal((await quote({ couponCode: 'LIMIT3' }, U2)).status, 400);
});

await check('an unpaid booking that expires releases its use', async () => {
    const res = await book({ couponCode: 'EXP1', paymentMode: 'online' }, U2);
    assert.equal(res.status, 201, res.raw);
    const id = res.json.data.booking._id;
    assert.equal((await offerDoc('EXP1')).usedCount, 1);
    assert.match((await quote({ couponCode: 'EXP1' }, U3)).json.message, /fully used/);
    await svc.expireBooking(id);
    await waitFor(async () => (await offerDoc('EXP1')).usedCount === 0);
    assert.equal((await M.HotelOfferRedemption.findOne({ bookingId: id }).lean()).status, 'released');
    assert.equal((await quote({ couponCode: 'EXP1' }, U3)).status, 200);
    // Releasing again is a no-op.
    assert.equal(await offers.releaseHotelCoupon(id, 'again'), null);
    assert.equal((await offerDoc('EXP1')).usedCount, 0);
});

console.log('\n[4] settlement and funding');

const settleRows = async (bookingId) => LedgerEntry.find({ jobType: 'hotel_booking', jobId: String(bookingId), type: { $ne: 'NON_WALLET' } }).lean();
const checkoutBooking = async (id) => {
    for (const status of ['checked_in', 'checked_out']) {
        const r = await call(server, 'PUT', `${H}/admin/bookings/${id}/status`, { token: adminToken, body: { status, force: true } });
        assert.equal(r.status, 200, r.raw);
    }
};
// No booking fee is configured here, so zero PLATFORM_FEE rows are skipped: wait for the
// rows that must exist (partner earning + commission, platform commission, and the
// platform subsidy when one is expected) and then a beat for any stragglers.
const settledRows = async (id, { subsidy }) => {
    const rows = await waitFor(async () => {
        const r = await settleRows(id);
        const has = (o, t) => r.some((e) => e.ownerType === o && e.type === t);
        return has('partner', 'EARNING') && has('partner', 'COMMISSION') && has('platform', 'COMMISSION')
            && (!subsidy || has('platform', 'ADJUSTMENT')) ? r : null;
    });
    await new Promise((res) => setTimeout(res, 300));
    return (await settleRows(id)).length === rows.length ? rows : settleRows(id);
};
const sumOf = (rows, pred) => r2(rows.filter(pred).reduce((s, e) => s + e.amount, 0));

await check('platform-funded: guest pays less, hotel nets its payout as if no coupon, platform absorbs it', async () => {
    const b = await paidOnline({ couponCode: 'KSGPAYS', checkIn: d(30), checkOut: d(31) }, U2);
    const full = await M.HotelBooking.findById(b._id).lean();
    const p = full.pricing;
    assert.equal(p.couponDiscount, 200);
    assert.equal(p.couponFunding, 'platform');
    assert.equal(p.platformSubsidy, 200);
    assert.equal(p.taxableAmount, 1800);
    assert.equal(p.commissionAmount, 180);
    assert.equal(p.partnerPayout, r2(1800 + 90 + 200 - 180 - 32.4));
    assert.equal(b.pricing.platformSubsidy, undefined, 'customer view hides the subsidy');

    await checkoutBooking(b._id);
    const rows = await settledRows(b._id, { subsidy: true });
    const partnerNet = sumOf(rows, (e) => e.ownerType === 'partner');
    assert.equal(partnerNet, p.partnerPayout, 'partner nets the payout incl. the subsidy');
    const earning = rows.find((e) => e.ownerType === 'partner' && e.type === 'EARNING');
    assert.equal(earning.amount, r2(p.total - p.platformFee - p.platformFeeGst + 200));
    const subsidy = rows.find((e) => e.ownerType === 'platform' && e.type === 'ADJUSTMENT');
    assert.equal(subsidy.amount, -200);
    assert.match(subsidy.reason, /KSGPAYS funded by the platform/);
    assert.equal(sumOf(rows, () => true), p.total, 'every rupee the guest paid is accounted for');
});

await check('partner-funded: the discount comes off the hotel, no platform subsidy', async () => {
    const b = await paidOnline({ couponCode: 'HOTELPAYS', checkIn: d(32), checkOut: d(33) }, U3);
    const p = (await M.HotelBooking.findById(b._id).lean()).pricing;
    assert.equal(p.couponFunding, 'partner');
    assert.equal(p.platformSubsidy, 0);
    assert.equal(p.partnerPayout, r2(1800 + 90 - 180 - 32.4));
    await checkoutBooking(b._id);
    const rows = await settledRows(b._id, { subsidy: false });
    assert.equal(sumOf(rows, (e) => e.ownerType === 'partner'), p.partnerPayout);
    assert.ok(!rows.some((e) => e.type === 'ADJUSTMENT'), 'no subsidy row');
    assert.equal(sumOf(rows, () => true), p.total);
});

await check('platform-funded, cancelled late with 50% refund: retained money settles pro rata incl. the subsidy', async () => {
    const b = await paidOnline({ couponCode: 'KSGPAYS', checkIn: d(34), checkOut: d(35) }, U0);
    // A free-cancellation window that has already closed, so the user pays the 50% fee.
    await M.HotelBooking.updateOne({ _id: b._id }, { $set: { 'snapshot.cancellationPolicy.freeCancelHours': 5000 } });
    const res = await call(server, 'POST', `${H}/user/bookings/${b._id}/cancel`, { token: U0.token, body: {} });
    assert.equal(res.status, 200, res.raw);
    const full = await M.HotelBooking.findById(b._id).lean();
    const p = full.pricing;
    const retained = r2(p.total - full.cancellation.refundAmount);
    assert.ok(retained > 0);
    const rows = await settledRows(b._id, { subsidy: true });
    const ratio = retained / p.total;
    assert.equal(sumOf(rows, (e) => e.ownerType === 'platform' && e.type === 'ADJUSTMENT'), r2(-200 * ratio));
    assert.ok(Math.abs(sumOf(rows, () => true) - retained) <= 0.02, 'what the platform kept is fully allocated');
    await waitFor(async () => (await offerDoc('KSGPAYS')).usedCount === 1); // the checked-out one stays used
});

console.log('\n[5] Master > Coupons');

await check('hotel coupons appear in the Master list and pause from there', async () => {
    const owner = { _id: new mongoose.Types.ObjectId(), role: 'ADMIN', adminLevel: 'platform_superadmin' };
    const res = await couponList.listCoupons(owner, { source: 'hotel', limit: 100 });
    assert.ok(res.sources.some((s) => s.key === 'hotel'));
    const row = res.items.find((r) => r.code === 'ONLYB');
    assert.equal(row.where, 'Sea Resort');
    assert.equal(row.discount, '₹300 off');
    const paused = await couponList.setCouponLive(owner, 'hotel', row.id, false);
    assert.equal(paused.state, 'paused');
    assert.match((await quote({ ...onB, couponCode: 'ONLYB' })).json.message, /not active right now/);
    await couponList.setCouponLive(owner, 'hotel', row.id, true);
    assert.equal((await quote({ ...onB, couponCode: 'ONLYB' })).status, 200);
});

await check('a used coupon cannot be deleted (409), only deactivated', async () => {
    const o = await offerDoc('LIMIT3');
    const del = await call(server, 'DELETE', `${H}/admin/offers/${o._id}`, { token: adminToken });
    assert.equal(del.status, 409, del.raw);
    assert.match(del.json.message, /deactivate it instead/);
});

server.close();
await mongoose.disconnect();
await replSet.stop();
console.log(failures ? `\n${failures} hotel coupon check(s) FAILED` : '\nall hotel coupon checks passed');
process.exit(failures ? 1 : 0);
