// Hotel phase 4: bookings and payments. Contract: docs/hotel-api-contract.md "Phase 4-5".
//
// Boots the real express app against an in-memory single-node REPLICA SET (real
// transactions). Razorpay is replaced at the hotel gateway boundary
// (services/gateway.js __setHotelGatewayForTests): no network; signatures are still
// real HMACs over a test key secret.
//
// Run: node tests/hotel.booking.smoke.mjs

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
        console.log(`  FAIL ${name}\n         ${err.stack?.split('\n').slice(0, 3).join('\n         ') || err.message}`);
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
const WEBHOOK_SECRET = 'hotel-webhook-test-secret';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
process.env.MONGO_URI = replSet.getUri();
process.env.NODE_ENV = 'test';
process.env.USE_DEFAULT_OTP = 'true';
process.env.RAZORPAY_KEY_ID = 'rzp_test_hotel';
process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-0123456789-0123456789-0123456789';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-0123456789-0123456789-0123456789';

await mongoose.connect(process.env.MONGO_URI);
const { default: app } = await import('../src/app.js');
const server = app.listen(0);

const { HOTEL_MODEL_NAMES } = await import('../src/modules/hotel/models/index.js');
const { signAccessToken } = await import('../src/core/auth/token.util.js');
const inv = await import('../src/modules/hotel/services/inventory.service.js');
const svc = await import('../src/modules/hotel/services/booking.service.js');
const { bookingEvents } = await import('../src/modules/hotel/services/bookingEvents.js');
const { __setHotelGatewayForTests } = await import('../src/modules/hotel/services/gateway.js');
const { invalidateHotelSettingsCache } = await import('../src/modules/hotel/services/settings.service.js');
const { CustomerWallet } = await import('../src/core/wallet/customerWallet.model.js');
const { FoodUser } = await import('../src/core/users/user.model.js');
const { Payment } = await import('../src/core/payments/models/payment.model.js');
const { Refund } = await import('../src/core/payments/models/refund.model.js');
const { handleRazorpayWebhook } = await import('../src/core/payments/controllers/razorpayWebhook.controller.js');
const M = mongoose.models;
await Promise.all(HOTEL_MODEL_NAMES.map((n) => M[n].syncIndexes()));

// ─── fake gateway ────────────────────────────────────────────────────────
const orders = new Map();
const gatewayRefunds = [];
let seq = 0;
let fetchOverride = null;
__setHotelGatewayForTests({
    async createOrder({ amountPaise, receipt, notes }) {
        const id = `order_T${++seq}`;
        orders.set(id, { amountPaise, receipt, notes });
        return { id, amount: amountPaise, currency: 'INR' };
    },
    async fetchPayment(paymentId, { orderId }) {
        if (fetchOverride) return fetchOverride(paymentId, orderId);
        return { id: paymentId, order_id: orderId, status: 'captured', amount: orders.get(orderId)?.amountPaise };
    },
    async refund(paymentId, amount) {
        gatewayRefunds.push({ paymentId, amount });
        return { id: `rfnd_T${++seq}`, status: 'processed' };
    },
});
const sign = (orderId, paymentId) => crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

// ─── event recorder ──────────────────────────────────────────────────────
const events = [];
for (const name of ['transition', 'payment', 'refund']) {
    bookingEvents.on(name, (p) => events.push({ name, id: String(p.booking?._id), ...p }));
}
const eventsFor = (id, name) => events.filter((e) => e.id === String(id) && (!name || e.name === name));

// ─── fixtures ────────────────────────────────────────────────────────────
const H = '/api/v1/hotel';
const today = inv.todayIST();
const d = (n) => inv.addDays(today, n);
const img = (t) => `https://placehold.co/1200x800?text=${t}`;

const partner = await M.HotelPartner.create({ phone: '9500000001', name: 'Asha Stays', status: 'approved', kyc: { ownerName: 'Asha', panNumber: 'ABCDE1234F' } });
const other = await M.HotelPartner.create({ phone: '9500000002', name: 'Other', status: 'approved' });
const partnerToken = signAccessToken({ userId: String(partner._id), role: 'HOTEL_PARTNER' });
const otherToken = signAccessToken({ userId: String(other._id), role: 'HOTEL_PARTNER' });
const admin = await M.FoodAdmin.create({ email: `hb${Date.now()}@ksg.test`, password: 'irrelevant-for-this-test', name: 'Hotel Admin', servicesAccess: ['hotel'] });
const adminToken = signAccessToken({ userId: String(admin._id), role: 'ADMIN' });
const guest = await FoodUser.create({ phone: '9811111111', name: 'Ravi Guest' });
const guest2 = await FoodUser.create({ phone: '9822222222', name: 'Second Guest' });
const userToken = signAccessToken({ userId: String(guest._id), role: 'USER' });
const user2Token = signAccessToken({ userId: String(guest2._id), role: 'USER' });

const property = await M.HotelProperty.create({
    partnerId: partner._id,
    name: 'Lakeview Inn',
    slug: 'lakeview-inn-bhopal',
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
});
const mkRoom = (over) => M.HotelRoomType.create({
    propertyId: property._id, inventoryType: 'room', maxAdults: 3, maxChildren: 1, baseAdults: 2, baseChildren: 0,
    extraAdultPrice: 500, extraChildPrice: 300, images: [img('a'), img('b'), img('c')], ...over,
});
const rtA = await mkRoom({ name: 'Deluxe', totalInventory: 5, pricePerNight: 2000 });
const rtLast = await mkRoom({ name: 'Suite', totalInventory: 1, pricePerNight: 4000 });
const rtOther = await M.HotelRoomType.create({
    propertyId: new mongoose.Types.ObjectId(), name: 'Elsewhere', inventoryType: 'room', maxAdults: 2, totalInventory: 1,
    pricePerNight: 100, images: [img('a'), img('b'), img('c')],
});

const body = (over = {}) => ({
    propertyId: String(property._id), roomTypeId: String(rtA._id), checkIn: d(10), checkOut: d(11),
    rooms: 1, adults: 2, children: 0, paymentMode: 'pay_at_hotel',
    guestDetails: { name: 'Ravi Guest', phone: '+91 98111 11111', email: 'ravi@example.com' }, ...over,
});
const book = (over, token = userToken) => call(server, 'POST', `${H}/user/bookings`, { token, body: body(over) });
const bookedOn = async (rt, date) => (await M.HotelInventoryDay.findOne({ roomTypeId: rt, date: inv.toNightDate(date) }).lean())?.booked ?? 0;
const balance = async (u = guest._id) => (await CustomerWallet.findOne({ userId: u }).lean())?.balance ?? 0;
const setBalance = (amount, u = guest._id) => CustomerWallet.updateOne({ userId: u }, { $set: { balance: amount }, $setOnInsert: { transactions: [] } }, { upsert: true });
const verify = (b, payment, paymentId = `pay_T${++seq}`, token = userToken) => call(server, 'POST', `${H}/user/bookings/${b._id}/verify-payment`, {
    token, body: { razorpayOrderId: payment.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: sign(payment.razorpayOrderId, paymentId) },
});
const reload = (id) => M.HotelBooking.findById(id).lean();

/** An online booking that is paid and confirmed. */
const paidOnline = async (over = {}) => {
    const res = await book({ paymentMode: 'online', ...over });
    assert.equal(res.status, 201, res.raw);
    const v = await verify(res.json.data.booking, res.json.data.payment);
    assert.equal(v.status, 200, v.raw);
    return v.json.data.booking;
};

console.log('\n[0] settings');

await check('GET /admin/settings returns the contract defaults (bare object)', async () => {
    const res = await call(server, 'GET', `${H}/admin/settings`, { token: adminToken });
    assert.equal(res.status, 200, res.raw);
    const s = res.json.data;
    assert.equal(s.commissionPercent, 10);
    assert.equal(s.minCommission, 50);
    assert.equal(s.paymentHoldMinutes, 30);
    assert.equal(s.settleOn, 'checked_out');
    assert.deepEqual(s.gstSlabs, [{ upTo: 1000, rate: 0 }, { upTo: 7500, rate: 5 }, { upTo: null, rate: 18 }]);
});

await check('PUT /admin/settings validates (bad slabs, out of range) and saves a partial update', async () => {
    const bad = await call(server, 'PUT', `${H}/admin/settings`, { token: adminToken, body: { gstSlabs: [{ upTo: 1000, rate: 0 }] } });
    assert.equal(bad.status, 400, bad.raw);
    const bad2 = await call(server, 'PUT', `${H}/admin/settings`, { token: adminToken, body: { commissionPercent: 140 } });
    assert.equal(bad2.status, 400);
    const ok = await call(server, 'PUT', `${H}/admin/settings`, { token: adminToken, body: { allowPayAtHotel: false } });
    assert.equal(ok.status, 200, ok.raw);
    assert.equal(ok.json.data.allowPayAtHotel, false);
    assert.equal(ok.json.data.commissionPercent, 10);
    const q = await call(server, 'POST', `${H}/user/bookings/quote`, { token: userToken, body: body() });
    assert.equal(q.status, 400);
    assert.match(q.json.message, /Pay at hotel/);
    const full = await call(server, 'GET', `${H}/admin/settings`, { token: adminToken });
    const back = await call(server, 'PUT', `${H}/admin/settings`, { token: adminToken, body: { ...full.json.data, allowPayAtHotel: true } });
    assert.equal(back.status, 200, back.raw);
    invalidateHotelSettingsCache();
});

await check('settings need hotel admin access', async () => {
    assert.equal((await call(server, 'GET', `${H}/admin/settings`, { token: userToken })).status, 403);
});

console.log('\n[1] quote');

await check('quote math: extra adult, GST slab after discounts, partial prepaid', async () => {
    const res = await call(server, 'POST', `${H}/user/bookings/quote`, {
        token: userToken, body: body({ checkOut: d(12), adults: 3, paymentMode: 'online' }),
    });
    assert.equal(res.status, 200, res.raw);
    const q = res.json.data;
    assert.equal(q.available, true);
    assert.equal(q.nights, 2);
    assert.equal(q.pricing.roomCharges, 4000);
    assert.equal(q.pricing.extraGuestCharges, 1000);
    assert.equal(q.pricing.taxableAmount, 5000);
    assert.equal(q.pricing.gstRate, 5);
    assert.equal(q.pricing.total, 5250);
    assert.equal(q.payNow, 5250);
    assert.equal(q.payAtHotel, 0);
    assert.equal(q.holdMinutes, 30);
    assert.equal(q.pricing.commissionAmount, undefined, 'no commission in the customer quote');
    assert.equal(q.pricing.partnerPayout, undefined);
    assert.equal(q.walletApplicable, 0);
    assert.ok(q.freeCancellationUntil);
    assert.equal(q.cancellationPolicy.type, 'moderate');

    const pp = await call(server, 'POST', `${H}/user/bookings/quote`, {
        token: userToken, body: body({ checkOut: d(12), adults: 3, paymentMode: 'partial_prepaid' }),
    });
    assert.equal(pp.json.data.pricing.prepaidDiscount, 250);
    assert.equal(pp.json.data.pricing.total, 4987.5);
    assert.equal(pp.json.data.payNow, 1496.25);
    assert.equal(pp.json.data.payAtHotel, 3491.25);
});

await check('quote: walletApplicable is min(balance, payNow); 0 for pay at hotel', async () => {
    await setBalance(1000);
    const q = await call(server, 'POST', `${H}/user/bookings/quote`, { token: userToken, body: body({ paymentMode: 'online' }) });
    assert.equal(q.json.data.walletApplicable, 1000);
    const h = await call(server, 'POST', `${H}/user/bookings/quote`, { token: userToken, body: body() });
    assert.equal(h.json.data.walletApplicable, 0);
    await setBalance(0);
});

await check('quote: coupon -> 400 with the reason; party too big -> available false; validation', async () => {
    const c = await call(server, 'POST', `${H}/user/bookings/quote`, { token: userToken, body: body({ couponCode: 'STAY10' }) });
    assert.equal(c.status, 400);
    assert.match(c.json.message, /Coupons are not available/);
    const big = await call(server, 'POST', `${H}/user/bookings/quote`, { token: userToken, body: body({ adults: 4 }) });
    assert.equal(big.status, 200);
    assert.equal(big.json.data.available, false);
    const past = await call(server, 'POST', `${H}/user/bookings/quote`, { token: userToken, body: body({ checkIn: d(-1), checkOut: d(1) }) });
    assert.equal(past.status, 400);
    const long = await call(server, 'POST', `${H}/user/bookings/quote`, { token: userToken, body: body({ checkOut: d(41) }) });
    assert.equal(long.status, 400);
    const foreign = await call(server, 'POST', `${H}/user/bookings/quote`, { token: userToken, body: body({ roomTypeId: String(rtOther._id) }) });
    assert.equal(foreign.status, 404);
    const noAuth = await call(server, 'POST', `${H}/user/bookings/quote`, { body: body() });
    assert.equal(noAuth.status, 401);
    assert.equal((await call(server, 'POST', `${H}/user/bookings/quote`, { token: partnerToken, body: body() })).status, 403);
});

console.log('\n[2] pay at hotel');

let hotelBooking;
await check('pay_at_hotel -> confirmed, no payment object, rooms reserved, ledger row, one creation event', async () => {
    const before = await bookedOn(rtA._id, d(10));
    const res = await book({ specialRequests: 'Late arrival', pricing: { total: 1 } });
    assert.equal(res.status, 201, res.raw);
    const b = res.json.data.booking;
    hotelBooking = b;
    assert.equal(b.status, 'confirmed');
    assert.equal(res.json.data.payment, null);
    assert.match(b.bookingRef, /^KSGH[0-9A-Z]+$/);
    assert.equal(b.checkIn, d(10));
    assert.equal(b.pricing.total, 2100, 'client prices ignored');
    assert.equal(b.pricing.commissionAmount, undefined);
    assert.equal(b.payment.amountDue, 2100);
    assert.equal(b.guestDetails.phone, '9811111111');
    assert.equal(b.canCancel, true);
    assert.equal(b.canReview, false);
    assert.equal(b.snapshot.propertyName, 'Lakeview Inn');
    assert.equal(await bookedOn(rtA._id, d(10)), before + 1);
    assert.ok(await M.HotelAvailability.findOne({ bookingId: b._id, source: 'platform' }));
    const t = eventsFor(b._id, 'transition');
    assert.equal(t.length, 1);
    assert.equal(t[0].from, null);
    assert.equal(t[0].to, 'confirmed');
    assert.equal(t[0].actor.role, 'user');
});

console.log('\n[3] online payment');

let onlineBooking;
let onlinePayment;
await check('online -> awaiting_payment with a Razorpay order (paise, keyId, prefill, hotel notes)', async () => {
    const res = await book({ paymentMode: 'online' });
    assert.equal(res.status, 201, res.raw);
    onlineBooking = res.json.data.booking;
    onlinePayment = res.json.data.payment;
    assert.equal(onlineBooking.status, 'awaiting_payment');
    assert.ok(onlineBooking.payment.expiresAt);
    assert.equal(onlinePayment.amount, 210000);
    assert.equal(onlinePayment.currency, 'INR');
    assert.equal(onlinePayment.keyId, 'rzp_test_hotel');
    assert.equal(onlinePayment.prefill.contact, '9811111111');
    assert.equal(orders.get(onlinePayment.razorpayOrderId).notes.vertical, 'hotel');
    const attempt = await Payment.findOne({ gatewayOrderId: onlinePayment.razorpayOrderId }).lean();
    assert.equal(attempt.status, 'created');
    assert.equal(attempt.vertical, 'hotel');
    assert.equal(attempt.subjectModel, 'HotelBooking');
});

await check('retry-payment returns the same order while held', async () => {
    const res = await call(server, 'POST', `${H}/user/bookings/${onlineBooking._id}/retry-payment`, { token: userToken });
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.json.data.razorpayOrderId, onlinePayment.razorpayOrderId);
});

await check('verify: bad signature 400, someone else\'s booking 404, wrong order 400', async () => {
    const bad = await call(server, 'POST', `${H}/user/bookings/${onlineBooking._id}/verify-payment`, {
        token: userToken, body: { razorpayOrderId: onlinePayment.razorpayOrderId, razorpayPaymentId: 'pay_x', razorpaySignature: 'deadbeef' },
    });
    assert.equal(bad.status, 400);
    assert.equal((await verify(onlineBooking, onlinePayment, 'pay_y', user2Token)).status, 404);
    const wrong = await verify(onlineBooking, { razorpayOrderId: 'order_other' });
    assert.equal(wrong.status, 400);
});

await check('verify: amount mismatch at the gateway is refused', async () => {
    fetchOverride = (paymentId, orderId) => ({ id: paymentId, order_id: orderId, status: 'captured', amount: 100 });
    const res = await verify(onlineBooking, onlinePayment, 'pay_short');
    fetchOverride = null;
    assert.equal(res.status, 400, res.raw);
    assert.equal((await reload(onlineBooking._id)).status, 'awaiting_payment');
});

await check('verify -> confirmed, payment recorded once; second verify and webhook are idempotent', async () => {
    const res = await verify(onlineBooking, onlinePayment, 'pay_good');
    assert.equal(res.status, 200, res.raw);
    const b = res.json.data.booking;
    assert.equal(b.status, 'confirmed');
    assert.equal(b.payment.status, 'paid');
    assert.equal(b.payment.amountPaid, 2100);
    assert.equal(b.payment.amountDue, 0);
    assert.equal(b.payment.expiresAt, undefined);
    const again = await verify(onlineBooking, onlinePayment, 'pay_good');
    assert.equal(again.status, 200, again.raw);
    const hook = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_good', order_id: onlinePayment.razorpayOrderId, amount: 210000 } } } };
    const rawBody = Buffer.from(JSON.stringify(hook));
    const req = { headers: { 'x-razorpay-signature': crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex') }, body: hook, rawBody };
    const out = { statusCode: 200 };
    out.status = (c) => { out.statusCode = c; return out; };
    out.json = (j) => { out.body = j; return out; };
    out.send = out.json;
    await handleRazorpayWebhook(req, out);
    assert.equal(out.statusCode, 200);
    const rows = await Payment.find({ gatewayOrderId: onlinePayment.razorpayOrderId }).lean();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'success');
    assert.equal(rows[0].gatewayPaymentId, 'pay_good');
    assert.equal(eventsFor(onlineBooking._id, 'payment').length, 1);
    const t = eventsFor(onlineBooking._id, 'transition').map((e) => e.to);
    assert.deepEqual(t, ['awaiting_payment', 'confirmed']);
});

const webhookCall = async (orderId, paymentId, amountPaise) => {
    const hook = { event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: amountPaise } } } };
    const rawBody = Buffer.from(JSON.stringify(hook));
    const req = { headers: { 'x-razorpay-signature': crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex') }, body: hook, rawBody };
    const out = { statusCode: 200 };
    out.status = (c) => { out.statusCode = c; return out; };
    out.json = (j) => { out.body = j; return out; };
    out.send = out.json;
    await handleRazorpayWebhook(req, out);
    return out;
};

await check('webhook first confirms the booking; a later verify is idempotent', async () => {
    const res = await book({ paymentMode: 'online', checkIn: d(12), checkOut: d(13) });
    const { booking: b, payment } = res.json.data;
    const out = await webhookCall(payment.razorpayOrderId, 'pay_hook', payment.amount);
    assert.equal(out.statusCode, 200);
    assert.equal((await reload(b._id)).status, 'confirmed');
    const v = await verify(b, payment, 'pay_hook');
    assert.equal(v.status, 200, v.raw);
    assert.equal(eventsFor(b._id, 'payment').length, 1);
    assert.equal(eventsFor(b._id, 'transition').filter((e) => e.to === 'confirmed').length, 1);
});

console.log('\n[4] sold out and the last room');

await check('8 parallel bookings for the last room -> exactly one wins, the rest 409', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => book({ roomTypeId: String(rtLast._id), checkIn: d(15), checkOut: d(17) })));
    const codes = results.map((r) => r.status);
    assert.equal(codes.filter((c) => c === 201).length, 1, codes.join(','));
    assert.equal(codes.filter((c) => c === 409).length, 7, codes.join(','));
    assert.equal(await bookedOn(rtLast._id, d(15)), 1);
    assert.equal(await bookedOn(rtLast._id, d(16)), 1);
    assert.equal(await M.HotelBooking.countDocuments({ roomTypeId: rtLast._id }), 1);
    assert.equal(await M.HotelAvailability.countDocuments({ roomTypeId: rtLast._id }), 1);
    const again = await book({ roomTypeId: String(rtLast._id), checkIn: d(16), checkOut: d(18) });
    assert.equal(again.status, 409);
    const q = await call(server, 'POST', `${H}/user/bookings/quote`, { token: userToken, body: body({ roomTypeId: String(rtLast._id), checkIn: d(15), checkOut: d(16) }) });
    assert.equal(q.json.data.available, false);
});

await check('party that does not fit -> 400 on create', async () => {
    assert.equal((await book({ adults: 7 })).status, 400);
});

console.log('\n[5] wallet');

let walletBooking;
await check('wallet covers payNow -> confirmed without a Razorpay order', async () => {
    await setBalance(5000);
    const res = await book({ paymentMode: 'online', useWallet: true, checkIn: d(20), checkOut: d(21) });
    assert.equal(res.status, 201, res.raw);
    walletBooking = res.json.data.booking;
    assert.equal(walletBooking.status, 'confirmed');
    assert.equal(res.json.data.payment, null);
    assert.equal(walletBooking.payment.walletAmount, 2100);
    assert.equal(walletBooking.payment.status, 'paid');
    assert.equal(await balance(), 2900);
    const pay = eventsFor(walletBooking._id, 'payment');
    assert.equal(pay.length, 1);
    assert.equal(pay[0].kind, 'wallet');
    assert.equal(pay[0].amount, 2100);
});

await check('wallet covers part -> gateway order for the rest; verify confirms', async () => {
    const res = await book({ paymentMode: 'online', useWallet: true, checkIn: d(20), checkOut: d(22) });
    assert.equal(res.status, 201, res.raw);
    const { booking: b, payment } = res.json.data;
    assert.equal(b.status, 'awaiting_payment');
    assert.equal(b.payment.walletAmount, 2900);
    assert.equal(payment.amount, (4200 - 2900) * 100);
    assert.equal(await balance(), 0);
    const v = await verify(b, payment);
    assert.equal(v.status, 200, v.raw);
    assert.equal(v.json.data.booking.payment.amountPaid, 4200);
    assert.equal(v.json.data.booking.payment.status, 'paid');
});

await check('useWallet with an empty wallet just pays online', async () => {
    const res = await book({ paymentMode: 'online', useWallet: true, checkIn: d(23), checkOut: d(24) });
    assert.equal(res.json.data.booking.payment.walletAmount, 0);
    assert.equal(res.json.data.payment.amount, 210000);
});

console.log('\n[6] customer cancellation');

await check('preview before the free window: 100% back to the wallet; cancel releases rooms; one refund event', async () => {
    const pv = await call(server, 'GET', `${H}/user/bookings/${walletBooking._id}/cancel-preview`, { token: userToken });
    assert.equal(pv.status, 200, pv.raw);
    assert.equal(pv.json.data.refundPercent, 100);
    assert.equal(pv.json.data.refundAmount, 2100);
    assert.equal(pv.json.data.walletRefund, 2100);
    assert.equal(pv.json.data.gatewayRefund, 0);
    assert.match(pv.json.data.policyText, /Free cancellation until/);
    const before = await bookedOn(rtA._id, d(20));
    const c = await call(server, 'POST', `${H}/user/bookings/${walletBooking._id}/cancel`, { token: userToken, body: { reason: 'plans changed' } });
    assert.equal(c.status, 200, c.raw);
    const b = c.json.data.booking;
    assert.equal(b.status, 'cancelled');
    assert.equal(b.payment.status, 'refunded');
    assert.equal(b.cancellation.refundAmount, 2100);
    assert.equal(b.canCancel, false);
    assert.equal(await balance(), 2100);
    assert.equal(await bookedOn(rtA._id, d(20)), before - 1);
    assert.equal(await M.HotelAvailability.countDocuments({ bookingId: b._id }), 0);
    assert.equal(eventsFor(b._id, 'refund').length, 1);
    const again = await call(server, 'POST', `${H}/user/bookings/${walletBooking._id}/cancel`, { token: userToken, body: {} });
    assert.equal(again.status, 409);
    assert.equal(await balance(), 2100, 'no second refund');
});

await check('after the free window: refundPercentAfter of the online payment, through core refunds', async () => {
    await setBalance(0);
    const b = await paidOnline({ checkIn: d(25), checkOut: d(26) });
    await M.HotelBooking.updateOne({ _id: b._id }, { $set: { 'snapshot.cancellationPolicy.freeCancelHours': 24 * 60 } });
    const pv = await call(server, 'GET', `${H}/user/bookings/${b._id}/cancel-preview`, { token: userToken });
    assert.equal(pv.json.data.refundPercent, 50);
    assert.equal(pv.json.data.refundAmount, 1050);
    assert.equal(pv.json.data.gatewayRefund, 1050);
    const n = gatewayRefunds.length;
    const c = await call(server, 'POST', `${H}/user/bookings/${b._id}/cancel`, { token: userToken, body: {} });
    assert.equal(c.status, 200, c.raw);
    assert.equal(c.json.data.booking.payment.status, 'partially_refunded');
    assert.equal(c.json.data.booking.payment.refundedAmount, 1050);
    assert.equal(gatewayRefunds.length, n + 1);
    assert.equal(gatewayRefunds.at(-1).amount, 1050);
    const r = await Refund.findOne({ orderId: b._id }).lean();
    assert.equal(r.status, 'processed');
    assert.equal(r.amount, 1050);
    const p = await Payment.findOne({ subjectId: b._id }).lean();
    assert.equal(p.status, 'success', 'partially refunded payment stays success');
});

await check('non-refundable policy: preview 0, cancel refunds nothing', async () => {
    const b = await paidOnline({ checkIn: d(26), checkOut: d(27) });
    await M.HotelBooking.updateOne({ _id: b._id }, { $set: { 'snapshot.cancellationPolicy.type': 'non_refundable' } });
    const pv = await call(server, 'GET', `${H}/user/bookings/${b._id}/cancel-preview`, { token: userToken });
    assert.equal(pv.json.data.refundAmount, 0);
    assert.match(pv.json.data.policyText, /Non-refundable/);
    const c = await call(server, 'POST', `${H}/user/bookings/${b._id}/cancel`, { token: userToken, body: {} });
    assert.equal(c.status, 200);
    assert.equal(c.json.data.booking.payment.refundedAmount, 0);
    assert.equal(eventsFor(b._id, 'refund').length, 0);
});

console.log('\n[7] partner cancel');

await check('partner cancel of a non-refundable paid booking -> full refund to the guest', async () => {
    const b = await paidOnline({ checkIn: d(27), checkOut: d(28) });
    await M.HotelBooking.updateOne({ _id: b._id }, { $set: { 'snapshot.cancellationPolicy.type': 'non_refundable' } });
    const noReason = await call(server, 'PUT', `${H}/partner/bookings/${b._id}/cancel`, { token: partnerToken, body: {} });
    assert.equal(noReason.status, 400);
    assert.equal((await call(server, 'PUT', `${H}/partner/bookings/${b._id}/cancel`, { token: otherToken, body: { reason: 'overbooked' } })).status, 404);
    const res = await call(server, 'PUT', `${H}/partner/bookings/${b._id}/cancel`, { token: partnerToken, body: { reason: 'overbooked' } });
    assert.equal(res.status, 200, res.raw);
    const out = res.json.data.booking;
    assert.equal(out.status, 'cancelled');
    assert.equal(out.cancellation.by, 'partner');
    assert.equal(out.payment.refundedAmount, 2100);
    assert.equal(out.payment.status, 'refunded');
    assert.equal((await Payment.findOne({ subjectId: b._id }).lean()).status, 'refunded');
});

console.log('\n[8] expiry job');

await check('expired hold: rooms released, wallet part refunded, double run safe; late payment refunded', async () => {
    await setBalance(500);
    const res = await book({ paymentMode: 'online', useWallet: true, checkIn: d(29), checkOut: d(30) });
    const { booking: b, payment } = res.json.data;
    assert.equal(b.status, 'awaiting_payment');
    assert.equal(await balance(), 0);
    const booked = await bookedOn(rtA._id, d(29));
    const none = await svc.expireStaleBookings();
    assert.equal(none.expired, 0, 'not yet expired');
    await M.HotelBooking.updateOne({ _id: b._id }, { $set: { 'payment.expiresAt': new Date(Date.now() - 1000) } });
    const [r1, r2] = await Promise.all([svc.expireStaleBookings(), svc.expireStaleBookings()]);
    assert.equal(r1.expired + r2.expired, 1);
    const after = await reload(b._id);
    assert.equal(after.status, 'expired');
    assert.equal(await bookedOn(rtA._id, d(29)), booked - 1);
    assert.equal(await balance(), 500);
    assert.equal(eventsFor(b._id, 'transition').filter((e) => e.to === 'expired').length, 1);
    assert.equal(eventsFor(b._id, 'refund').length, 1);
    const retry = await call(server, 'POST', `${H}/user/bookings/${b._id}/retry-payment`, { token: userToken });
    assert.equal(retry.status, 409);
    const n = gatewayRefunds.length;
    const late = await verify(b, payment, 'pay_late');
    assert.equal(late.status, 409, late.raw);
    assert.equal(gatewayRefunds.length, n + 1, 'late capture refunded');
    assert.equal(gatewayRefunds.at(-1).amount, 1600);
    const lateAgain = await webhookCall(payment.razorpayOrderId, 'pay_late', payment.amount);
    assert.equal(lateAgain.statusCode, 200);
    assert.equal(gatewayRefunds.length, n + 1, 'not refunded twice');
});

console.log('\n[9] partner actions');

let todayBooking;
await check('partner list/detail show commission and payout; filters work; other partner sees nothing', async () => {
    const res = await book({ checkIn: d(0), checkOut: d(2) });
    assert.equal(res.status, 201, res.raw);
    todayBooking = res.json.data.booking;
    const list = await call(server, 'GET', `${H}/partner/bookings?status=confirmed&from=${d(0)}&to=${d(0)}`, { token: partnerToken });
    assert.equal(list.status, 200, list.raw);
    assert.ok(list.json.data.items.some((b) => b._id === todayBooking._id));
    assert.ok(list.json.data.items.every((b) => b.checkIn === d(0)));
    const item = list.json.data.items.find((b) => b._id === todayBooking._id);
    assert.ok(item.pricing.commissionAmount > 0);
    assert.ok(item.pricing.partnerPayout > 0);
    assert.equal(item.statusHistory, undefined);
    const q = await call(server, 'GET', `${H}/partner/bookings?q=${todayBooking.bookingRef}`, { token: partnerToken });
    assert.equal(q.json.data.total, 1);
    const byPhone = await call(server, 'GET', `${H}/partner/bookings?q=98111`, { token: partnerToken });
    assert.ok(byPhone.json.data.total >= 1);
    const detail = await call(server, 'GET', `${H}/partner/bookings/${todayBooking._id}`, { token: partnerToken });
    assert.equal(detail.json.data.booking.statusHistory.length, 1);
    assert.equal((await call(server, 'GET', `${H}/partner/bookings`, { token: otherToken })).json.data.total, 0);
    assert.equal((await call(server, 'GET', `${H}/partner/bookings/${todayBooking._id}`, { token: otherToken })).status, 404);
});

await check('a pending partner cannot see bookings', async () => {
    const p = await M.HotelPartner.create({ phone: '9500000009', name: 'Pending', status: 'pending' });
    const t = signAccessToken({ userId: String(p._id), role: 'HOTEL_PARTNER' });
    assert.equal((await call(server, 'GET', `${H}/partner/bookings`, { token: t })).status, 403);
});

await check('check-in today; check-out refused while unpaid; mark-paid; early check-out frees the unused nights', async () => {
    const id = todayBooking._id;
    const ci = await call(server, 'PUT', `${H}/partner/bookings/${id}/check-in`, { token: partnerToken });
    assert.equal(ci.status, 200, ci.raw);
    assert.equal(ci.json.data.booking.status, 'checked_in');
    const co = await call(server, 'PUT', `${H}/partner/bookings/${id}/check-out`, { token: partnerToken, body: {} });
    assert.equal(co.status, 409);
    const due = ci.json.data.booking.payment.amountDue;
    const over = await call(server, 'PUT', `${H}/partner/bookings/${id}/mark-paid`, { token: partnerToken, body: { amount: due + 1 } });
    assert.equal(over.status, 400);
    const part = await call(server, 'PUT', `${H}/partner/bookings/${id}/mark-paid`, { token: partnerToken, body: { amount: 1000 } });
    assert.equal(part.status, 200, part.raw);
    assert.equal(part.json.data.booking.payment.status, 'partially_paid');
    const rest = await call(server, 'PUT', `${H}/partner/bookings/${id}/mark-paid`, { token: partnerToken, body: { amount: due - 1000 } });
    assert.equal(rest.json.data.booking.payment.status, 'paid');
    assert.equal(rest.json.data.booking.payment.amountDue, 0);
    assert.equal(eventsFor(id, 'payment').filter((e) => e.kind === 'at_hotel').length, 2);
    const night1 = await bookedOn(rtA._id, d(1));
    const out = await call(server, 'PUT', `${H}/partner/bookings/${id}/check-out`, { token: partnerToken, body: {} });
    assert.equal(out.status, 200, out.raw);
    assert.equal(out.json.data.booking.status, 'checked_out');
    // Early check-out (today, stay ends tomorrow after night d(1)) gives back the unused nights from today.
    assert.equal(await bookedOn(rtA._id, d(1)), night1 - 1);
    const ledger = await M.HotelAvailability.findOne({ bookingId: id }).lean();
    assert.equal(ledger, null, 'checked out on the check-in day: whole stay freed');
    const user = await call(server, 'GET', `${H}/user/bookings/${id}`, { token: userToken });
    assert.equal(user.json.data.booking.canReview, true);
    await M.HotelReview.create({ userId: guest._id, propertyId: property._id, bookingId: id, rating: 5 });
    const user2 = await call(server, 'GET', `${H}/user/bookings/${id}`, { token: userToken });
    assert.equal(user2.json.data.booking.canReview, false);
    assert.ok(user2.json.data.booking.reviewId);
});

await check('date rules: no check-in before the date, no no-show on/before the check-in day; admin force overrides', async () => {
    const id = hotelBooking._id; // check-in d(10)
    assert.equal((await call(server, 'PUT', `${H}/partner/bookings/${id}/check-in`, { token: partnerToken })).status, 409);
    assert.equal((await call(server, 'PUT', `${H}/partner/bookings/${id}/no-show`, { token: partnerToken })).status, 409);
    const res = await call(server, 'PUT', `${H}/admin/bookings/${id}/status`, { token: adminToken, body: { status: 'checked_in', force: true } });
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.json.data.booking.status, 'checked_in');
    const bad = await call(server, 'PUT', `${H}/admin/bookings/${id}/status`, { token: adminToken, body: { status: 'no_show' } });
    assert.equal(bad.status, 409, 'checked_in cannot become no_show');
    const cancel = await call(server, 'PUT', `${H}/admin/bookings/${id}/status`, { token: adminToken, body: { status: 'cancelled', reason: 'guest left' } });
    assert.equal(cancel.status, 200, cancel.raw);
    assert.equal(cancel.json.data.booking.status, 'cancelled');
});

await check('no-show after the check-in day releases the remaining nights', async () => {
    const res = await book({ checkIn: d(0), checkOut: d(3) });
    const id = res.json.data.booking._id;
    await M.HotelBooking.updateOne({ _id: id }, { $set: { checkIn: inv.toNightDate(d(-1)) } });
    const n2 = await bookedOn(rtA._id, d(2));
    const ns = await call(server, 'PUT', `${H}/partner/bookings/${id}/no-show`, { token: partnerToken });
    assert.equal(ns.status, 200, ns.raw);
    assert.equal(ns.json.data.booking.status, 'no_show');
    assert.equal(await bookedOn(rtA._id, d(2)), n2 - 1);
    const ledger = await M.HotelAvailability.findOne({ bookingId: id }).lean();
    assert.equal(inv.toDateString(ledger.endDate), today, 'ledger trimmed to the nights used');
});

console.log('\n[10] admin');

await check('admin list (with partner and user), detail (payments, refunds), manual refund', async () => {
    const list = await call(server, 'GET', `${H}/admin/bookings?partnerId=${partner._id}&limit=100`, { token: adminToken });
    assert.equal(list.status, 200, list.raw);
    assert.ok(list.json.data.total >= 10);
    assert.equal(list.json.data.items[0].partner.name, 'Asha Stays');
    assert.equal(list.json.data.items[0].user.name, 'Ravi Guest');
    const b = await paidOnline({ checkIn: d(28), checkOut: d(29) });
    const detail = await call(server, 'GET', `${H}/admin/bookings/${b._id}`, { token: adminToken });
    assert.equal(detail.status, 200, detail.raw);
    assert.equal(detail.json.data.payments.length, 1);
    assert.equal(detail.json.data.payments[0].kind, 'online');
    assert.ok(detail.json.data.payments[0].razorpayPaymentId);
    assert.equal(detail.json.data.booking.pricing.commissionAmount, 200);
    assert.equal(detail.json.data.refundable, 2100);
    const tooMuch = await call(server, 'POST', `${H}/admin/bookings/${b._id}/refund`, { token: adminToken, body: { amount: 2100.01, reason: 'goodwill' } });
    assert.equal(tooMuch.status, 400);
    const ok = await call(server, 'POST', `${H}/admin/bookings/${b._id}/refund`, { token: adminToken, body: { amount: 300, reason: 'AC broken' } });
    assert.equal(ok.status, 200, ok.raw);
    assert.equal(ok.json.data.refunds.length, 1);
    assert.equal(ok.json.data.refunds[0].gatewayAmount, 300);
    assert.equal(ok.json.data.refunds[0].status, 'processed');
    assert.ok(ok.json.data.refunds[0].createdAt);
    assert.equal(ok.json.data.refundable, 1800);
    assert.equal(ok.json.data.booking.status, 'confirmed', 'a manual refund does not change status');
    const second = await call(server, 'POST', `${H}/admin/bookings/${b._id}/refund`, { token: adminToken, body: { amount: 1800, reason: 'full' } });
    assert.equal(second.status, 200, second.raw);
    assert.equal(second.json.data.booking.payment.status, 'refunded');
    assert.equal(eventsFor(b._id, 'refund').length, 2);
});

console.log('\n[11] customer lists');

await check('tabs: upcoming / ongoing / past / cancelled; user view hides commission', async () => {
    const get = async (tab) => (await call(server, 'GET', `${H}/user/bookings?tab=${tab}&limit=100`, { token: userToken })).json.data;
    const up = await get('upcoming');
    assert.ok(up.items.length > 0);
    assert.ok(up.items.every((b) => ['awaiting_payment', 'confirmed'].includes(b.status) && b.checkIn >= today));
    assert.ok(up.items.every((b) => b.pricing.commissionAmount === undefined && b.pricing.partnerPayout === undefined));
    assert.ok(up.items.every((b) => b.statusHistory === undefined && typeof b.canCancel === 'boolean'));
    const past = await get('past');
    assert.ok(past.items.some((b) => b.status === 'checked_out'));
    assert.ok(past.items.some((b) => b.status === 'no_show'));
    const cancelled = await get('cancelled');
    assert.ok(cancelled.items.every((b) => ['cancelled', 'expired'].includes(b.status)));
    assert.ok(cancelled.items.some((b) => b.status === 'expired'));
    const other = (await call(server, 'GET', `${H}/user/bookings`, { token: user2Token })).json.data;
    assert.equal(other.total, 0);
});

console.log('\n[12] events');

await check('every transition was emitted exactly once', async () => {
    const seen = new Map();
    for (const e of events.filter((x) => x.name === 'transition')) {
        const key = `${e.id}:${e.to}`;
        seen.set(key, (seen.get(key) || 0) + 1);
    }
    const dupes = [...seen].filter(([, n]) => n > 1);
    assert.deepEqual(dupes, []);
    const bookings = await M.HotelBooking.find().lean();
    for (const b of bookings) {
        const statuses = b.statusHistory.map((h) => h.status);
        const emitted = events.filter((e) => e.name === 'transition' && e.id === String(b._id)).map((e) => e.to);
        assert.deepEqual(emitted, statuses, `booking ${b.bookingRef}`);
    }
});

__setHotelGatewayForTests(null);
server.close();
await mongoose.disconnect();
await replSet.stop();

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall hotel booking checks passed');
process.exit(failures ? 1 : 0);
