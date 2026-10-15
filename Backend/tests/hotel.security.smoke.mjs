// Hotel phase 9 (workstream D): security and correctness regression checks.
// Findings and fixes: docs/hotel-security-review.md.
//
// Boots the real express app against an in-memory single-node REPLICA SET with a fake
// Razorpay at the hotel gateway boundary (signatures are still checked for real).
//
// Run: node tests/hotel.security.smoke.mjs

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
        console.log(`  FAIL ${name}\n         ${err.stack || err.message}`);
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
                    try { json = JSON.parse(raw); } catch { /* html */ }
                    resolve({ status: res.statusCode, json, raw, headers: res.headers });
                });
            },
        );
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });

const KEY_SECRET = 'hotel_sec_key_secret_0123456789';
const WEBHOOK_SECRET = 'hotel-sec-webhook-secret';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
process.env.MONGO_URI = replSet.getUri();
process.env.NODE_ENV = 'test';
process.env.USE_DEFAULT_OTP = 'true';
process.env.RAZORPAY_KEY_ID = 'rzp_test_hotel_sec';
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
const { __setHotelGatewayForTests } = await import('../src/modules/hotel/services/gateway.js');
const { signVoucherToken } = await import('../src/modules/hotel/controllers/userExtras.controller.js');
const { redactUrl } = await import('../src/utils/redactUrl.js');
const { FoodUser } = await import('../src/core/users/user.model.js');
const { Payment } = await import('../src/core/payments/models/payment.model.js');
const { CustomerWallet } = await import('../src/core/wallet/customerWallet.model.js');
const { handleRazorpayWebhook } = await import('../src/core/payments/controllers/razorpayWebhook.controller.js');
const { append } = await import('../src/core/finance/ledger.service.js');
const { LedgerEntry } = await import('../src/core/finance/ledgerEntry.model.js');
const { PartnerBalance } = await import('../src/core/finance/partnerBalance.model.js');
const M = mongoose.models;
await Promise.all([...HOTEL_MODEL_NAMES.map((n) => M[n].syncIndexes()), LedgerEntry.syncIndexes(), PartnerBalance.syncIndexes()]);

// ─── fake gateway ────────────────────────────────────────────────────────
const orders = new Map();
const gatewayRefunds = [];
let seq = 0;
__setHotelGatewayForTests({
    async createOrder({ amountPaise }) {
        const id = `order_S${++seq}`;
        orders.set(id, { amountPaise });
        return { id, amount: amountPaise, currency: 'INR' };
    },
    async fetchPayment(paymentId, { orderId }) {
        return { id: paymentId, order_id: orderId, status: 'captured', amount: orders.get(orderId)?.amountPaise };
    },
    async refund(paymentId, amount) {
        gatewayRefunds.push({ paymentId, amount });
        return { id: `rfnd_S${++seq}`, status: 'processed' };
    },
});
const sign = (orderId, paymentId) => crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

const webhook = async (entity) => {
    const hook = { event: 'payment.captured', payload: { payment: { entity } } };
    const rawBody = Buffer.from(JSON.stringify(hook));
    const req = { headers: { 'x-razorpay-signature': crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex') }, body: hook, rawBody };
    const out = { statusCode: 200 };
    out.status = (c) => { out.statusCode = c; return out; };
    out.json = (j) => { out.body = j; return out; };
    out.send = out.json;
    await handleRazorpayWebhook(req, out);
    return out;
};

// ─── fixtures ────────────────────────────────────────────────────────────
const H = '/api/v1/hotel';
const today = inv.todayIST();
const d = (n) => inv.addDays(today, n);
const img = (t) => `https://placehold.co/1200x800?text=${t}`;

const partner = await M.HotelPartner.create({
    phone: '9600000001', name: 'Asha Stays', email: 'asha@partner.test', status: 'approved',
    kyc: { ownerName: 'Asha', panNumber: 'ABCDE1234F' },
    bank: { accountHolder: 'Asha', accountNumberMasked: 'XXXX1234', ifsc: 'HDFC0001234', bankName: 'HDFC' },
});
const other = await M.HotelPartner.create({ phone: '9600000002', name: 'Other', status: 'approved' });
const pending = await M.HotelPartner.create({ phone: '9600000003', name: 'Pending', status: 'pending' });
const partnerToken = signAccessToken({ userId: String(partner._id), role: 'HOTEL_PARTNER' });
const otherToken = signAccessToken({ userId: String(other._id), role: 'HOTEL_PARTNER' });
const pendingToken = signAccessToken({ userId: String(pending._id), role: 'HOTEL_PARTNER' });
const admin = await M.FoodAdmin.create({ email: `hs${Date.now()}@ksg.test`, password: 'irrelevant-for-this-test', name: 'Hotel Admin', servicesAccess: ['hotel'] });
const adminToken = signAccessToken({ userId: String(admin._id), role: 'ADMIN' });
const mkGuest = async (phone, name) => {
    const u = await FoodUser.create({ phone, name });
    return { user: u, token: signAccessToken({ userId: String(u._id), role: 'USER' }) };
};
const g1 = await mkGuest('9711111111', 'Ravi Kumar Sharma');
const g2 = await mkGuest('9722222222', 'Second Guest');
const g3 = await mkGuest('9733333333', 'Hold Tester');
const g4 = await mkGuest('9744444444', 'Race Tester');

const property = await M.HotelProperty.create({
    partnerId: partner._id,
    name: 'Secure Inn',
    slug: 'secure-inn-pune',
    propertyType: 'hotel',
    contactNumber: '9600000001',
    location: { type: 'Point', coordinates: [73.8567, 18.5204] },
    address: { line1: 'FC Road', area: 'Shivajinagar', city: 'Pune', state: 'MH', pincode: '411005', country: 'India' },
    coverImage: img('cover'),
    images: [img('1'), img('2')],
    checkInTime: '12:00',
    checkOutTime: '11:00',
    cancellationPolicy: { type: 'moderate', freeCancelHours: 24, refundPercentAfter: 50 },
    status: 'approved',
    isLive: true,
});
const rt = await M.HotelRoomType.create({
    propertyId: property._id, name: 'Deluxe', inventoryType: 'room', maxAdults: 3, maxChildren: 1, baseAdults: 2,
    totalInventory: 20, pricePerNight: 2000, images: [img('a'), img('b'), img('c')],
});

const body = (over = {}) => ({
    propertyId: String(property._id), roomTypeId: String(rt._id), checkIn: d(10), checkOut: d(11),
    rooms: 1, adults: 2, children: 0, paymentMode: 'pay_at_hotel',
    guestDetails: { name: 'Ravi Guest', phone: '9711111111', email: 'ravi@example.com' }, ...over,
});
const book = (over, token = g1.token) => call(server, 'POST', `${H}/user/bookings`, { token, body: body(over) });
const reload = (id) => M.HotelBooking.findById(id).lean();
const verify = (b, payment, paymentId, token) => call(server, 'POST', `${H}/user/bookings/${b._id}/verify-payment`, {
    token, body: { razorpayOrderId: payment.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: sign(payment.razorpayOrderId, paymentId) },
});
const paidOnline = async (token, over = {}) => {
    const res = await book({ paymentMode: 'online', ...over }, token);
    assert.equal(res.status, 201, res.raw);
    const pid = `pay_S${++seq}`;
    const v = await verify(res.json.data.booking, res.json.data.payment, pid, token);
    assert.equal(v.status, 200, v.raw);
    return { booking: v.json.data.booking, payment: res.json.data.payment, paymentId: pid };
};
const bookedOn = async (date) => (await M.HotelInventoryDay.findOne({ roomTypeId: rt._id, date: inv.toNightDate(date) }).lean())?.booked ?? 0;

const baseBooking = (await book({ checkIn: d(5), checkOut: d(6) })).json.data.booking;

// ─── 1. token leakage ────────────────────────────────────────────────────
console.log('\n[1] credentials in URLs');

await check('redactUrl masks token / vt / signature query values', async () => {
    assert.equal(redactUrl('/a/voucher?token=abc.def&x=1'), '/a/voucher?token=[REDACTED]&x=1');
    assert.equal(redactUrl('/a/voucher?x=1&vt=zzz'), '/a/voucher?x=1&vt=[REDACTED]');
    assert.equal(redactUrl('/files/p/pan/a.jpg?e=1&s=sig'), '/files/p/pan/a.jpg?e=1&s=[REDACTED]');
    assert.equal(redactUrl('/plain/path'), '/plain/path');
});

await check('a ?token= voucher request never writes the token to stdout/stderr (access, timing, error logs)', async () => {
    const secretish = signAccessToken({ userId: String(g1.user._id), role: 'USER' });
    const captured = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (chunk, ...rest) => { captured.push(String(chunk)); return origOut(chunk, ...rest); };
    process.stderr.write = (chunk, ...rest) => { captured.push(String(chunk)); return origErr(chunk, ...rest); };
    try {
        const ok = await call(server, 'GET', `${H}/user/bookings/${baseBooking._id}/voucher?token=${secretish}`);
        assert.equal(ok.status, 200);
        await call(server, 'GET', `${H}/user/bookings/${baseBooking._id}/voucher?token=${secretish}x`); // 401 path
        await new Promise((r) => setTimeout(r, 50));
    } finally {
        process.stdout.write = origOut;
        process.stderr.write = origErr;
    }
    const all = captured.join('');
    assert.ok(all.includes('/voucher'), 'expected the request to be logged at all');
    assert.ok(!all.includes(secretish), 'access token leaked into logs');
});

// ─── 2. voucher links ────────────────────────────────────────────────────
console.log('\n[2] voucher links');

await check('voucher-link: owner gets a short-lived single-booking token that opens the voucher', async () => {
    const res = await call(server, 'POST', `${H}/user/bookings/${baseBooking._id}/voucher-link`, { token: g1.token, body: {} });
    assert.equal(res.status, 200, res.raw);
    assert.ok(res.json.data.token);
    assert.ok(res.json.data.expiresIn <= 600);
    const page = await call(server, 'GET', `${H}/user/bookings/${baseBooking._id}/voucher?vt=${encodeURIComponent(res.json.data.token)}`);
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.ok(page.raw.includes(baseBooking.bookingRef));
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.ok(!/commission|partnerPayout/i.test(page.raw));
});

await check('voucher-link: another customer gets 404; partner/admin tokens refused', async () => {
    assert.equal((await call(server, 'POST', `${H}/user/bookings/${baseBooking._id}/voucher-link`, { token: g2.token, body: {} })).status, 404);
    assert.equal((await call(server, 'POST', `${H}/user/bookings/${baseBooking._id}/voucher-link`, { token: partnerToken, body: {} })).status, 403);
});

await check('a voucher token is bound to its booking and cannot be used as a session token (or vice versa)', async () => {
    const other = (await book({ checkIn: d(6), checkOut: d(7) })).json.data.booking;
    const vt = signVoucherToken(baseBooking._id, g1.user._id);
    assert.equal((await call(server, 'GET', `${H}/user/bookings/${other._id}/voucher?vt=${vt}`)).status, 403);
    // As a Bearer session token: signed with a different key -> 401 everywhere.
    assert.equal((await call(server, 'GET', `${H}/user/bookings`, { token: vt })).status, 401);
    // A session access token is not a voucher token.
    assert.equal((await call(server, 'GET', `${H}/user/bookings/${baseBooking._id}/voucher?vt=${g1.token}`)).status, 401);
    // A voucher token minted for g1's booking but claiming g2 still cannot open it.
    const forged = signVoucherToken(baseBooking._id, g2.user._id);
    assert.equal((await call(server, 'GET', `${H}/user/bookings/${baseBooking._id}/voucher?vt=${forged}`)).status, 404);
});

await check('legacy ?token= still requires a USER token for the owner', async () => {
    assert.equal((await call(server, 'GET', `${H}/user/bookings/${baseBooking._id}/voucher?token=${partnerToken}`)).status, 403);
    assert.equal((await call(server, 'GET', `${H}/user/bookings/${baseBooking._id}/voucher?token=${g2.token}`)).status, 404);
    assert.equal((await call(server, 'GET', `${H}/user/bookings/${baseBooking._id}/voucher`)).status, 401);
});

// ─── 3. authZ / IDOR ─────────────────────────────────────────────────────
console.log('\n[3] authorization');

await check('customer routes are scoped to the owner', async () => {
    const id = baseBooking._id;
    assert.equal((await call(server, 'GET', `${H}/user/bookings/${id}`, { token: g2.token })).status, 404);
    assert.equal((await call(server, 'GET', `${H}/user/bookings/${id}/cancel-preview`, { token: g2.token })).status, 404);
    assert.equal((await call(server, 'POST', `${H}/user/bookings/${id}/cancel`, { token: g2.token, body: {} })).status, 404);
    assert.equal((await call(server, 'POST', `${H}/user/bookings/${id}/retry-payment`, { token: g2.token })).status, 404);
    assert.equal((await call(server, 'POST', `${H}/user/bookings/${id}/verify-payment`, { token: g2.token, body: { razorpayOrderId: 'x', razorpayPaymentId: 'y', razorpaySignature: 'z' } })).status, 404);
    const list = await call(server, 'GET', `${H}/user/bookings?limit=100`, { token: g2.token });
    assert.ok(list.json.data.items.every((b) => String(b._id) !== String(id)));
});

await check('partner routes are scoped to the partner; pending partner refused; roles enforced', async () => {
    const id = baseBooking._id;
    assert.equal((await call(server, 'GET', `${H}/partner/bookings/${id}`, { token: otherToken })).status, 404);
    assert.equal((await call(server, 'PUT', `${H}/partner/bookings/${id}/cancel`, { token: otherToken, body: { reason: 'not mine' } })).status, 404);
    assert.equal((await call(server, 'PUT', `${H}/partner/bookings/${id}/mark-paid`, { token: otherToken, body: { amount: 1 } })).status, 404);
    assert.equal((await call(server, 'GET', `${H}/partner/bookings`, { token: pendingToken })).status, 403);
    assert.equal((await call(server, 'GET', `${H}/partner/earnings`, { token: pendingToken })).status, 403);
    assert.equal((await call(server, 'POST', `${H}/partner/withdrawals`, { token: pendingToken, body: { amount: 600 } })).status, 403);
    assert.equal((await call(server, 'GET', `${H}/partner/bookings`, { token: g1.token })).status, 403);
    assert.equal((await call(server, 'GET', `${H}/admin/bookings`, { token: partnerToken })).status, 403);
    assert.equal((await call(server, 'GET', `${H}/admin/withdrawals`, { token: g1.token })).status, 403);
    assert.equal((await call(server, 'POST', `${H}/user/bookings`, { token: partnerToken, body: body() })).status, 403);
    const others = await call(server, 'GET', `${H}/partner/bookings?limit=100`, { token: otherToken });
    assert.equal(others.json.data.items.length, 0);
    assert.equal((await call(server, 'GET', `${H}/partner/properties/${property._id}`, { token: otherToken })).status, 404);
    assert.equal((await call(server, 'PUT', `${H}/partner/properties/${property._id}/room-types/${rt._id}`, { token: otherToken, body: { pricePerNight: 1 } })).status, 404);
    assert.equal((await call(server, 'GET', `${H}/partner/inventory?roomTypeId=${rt._id}&from=${d(1)}&to=${d(2)}`, { token: otherToken })).status, 404);
});

await check('partner blocks and review replies are scoped to the owner', async () => {
    const block = await call(server, 'POST', `${H}/partner/inventory/blocks`, {
        token: partnerToken, body: { roomTypeId: String(rt._id), source: 'walk_in', startDate: d(40), endDate: d(41), units: 1 },
    });
    assert.equal(block.status, 201, block.raw);
    assert.equal((await call(server, 'DELETE', `${H}/partner/inventory/blocks/${block.json.data._id}`, { token: otherToken })).status, 404);
    assert.equal((await call(server, 'POST', `${H}/partner/inventory/blocks`, {
        token: otherToken, body: { roomTypeId: String(rt._id), source: 'walk_in', startDate: d(40), endDate: d(41), units: 1 },
    })).status, 404);
    const review = await M.HotelReview.create({ userId: g1.user._id, propertyId: property._id, bookingId: new mongoose.Types.ObjectId(), rating: 4, status: 'approved' });
    assert.equal((await call(server, 'POST', `${H}/partner/reviews/${review._id}/reply`, { token: otherToken, body: { text: 'hi' } })).status, 404);
});

// ─── 4. input validation ─────────────────────────────────────────────────
console.log('\n[4] input validation');

await check('NoSQL operator injection via query params is refused (400), never applied', async () => {
    for (const path of [
        `${H}/partner/bookings?status[$ne]=cancelled`,
        `${H}/partner/bookings?q[$regex]=.*`,
        `${H}/partner/bookings?propertyId[$ne]=x`,
    ]) {
        const r = await call(server, 'GET', path, { token: partnerToken });
        assert.equal(r.status, 400, `${path}: ${r.raw}`);
    }
    assert.equal((await call(server, 'GET', `${H}/user/bookings?tab[$ne]=x`, { token: g1.token })).status, 400);
    assert.equal((await call(server, 'GET', `${H}/admin/bookings?partnerId[$ne]=x`, { token: adminToken })).status, 400);
    const pub = await call(server, 'GET', `${H}/public/properties?city[$ne]=x`);
    assert.equal(pub.status, 400, pub.raw);
});

await check('regex search input is escaped (no ReDoS / wildcard match)', async () => {
    const r = await call(server, 'GET', `${H}/partner/bookings?q=${encodeURIComponent('.*')}`, { token: partnerToken });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.items.length, 0);
    const bad = await call(server, 'GET', `${H}/admin/bookings?q=${encodeURIComponent('(a+)+$')}`, { token: adminToken });
    assert.equal(bad.status, 200);
});

await check('dates: invalid, past, >30 nights and > 365 days ahead are refused', async () => {
    const q = (over) => call(server, 'POST', `${H}/user/bookings/quote`, { token: g1.token, body: body(over) });
    assert.equal((await q({ checkIn: '2026-02-30', checkOut: '2026-03-02' })).status, 400);
    assert.equal((await q({ checkIn: d(-1), checkOut: d(1) })).status, 400);
    assert.equal((await q({ checkIn: d(1), checkOut: d(32) })).status, 400);
    assert.equal((await q({ checkIn: d(400), checkOut: d(401) })).status, 400);
    assert.equal((await q({ checkIn: d(1), checkOut: d(1) })).status, 400);
    assert.equal((await call(server, 'GET', `${H}/public/properties/${property._id}/availability?checkIn=${d(500)}&checkOut=${d(501)}`)).status, 400);
});

await check('numeric bounds: rooms, negative / NaN / huge amounts', async () => {
    assert.equal((await book({ rooms: 0 })).status, 400);
    assert.equal((await book({ rooms: 1000 })).status, 400);
    assert.equal((await book({ adults: -1 })).status, 400);
    assert.equal((await call(server, 'PUT', `${H}/partner/bookings/${baseBooking._id}/mark-paid`, { token: partnerToken, body: { amount: -5 } })).status, 400);
    assert.equal((await call(server, 'PUT', `${H}/partner/bookings/${baseBooking._id}/mark-paid`, { token: partnerToken, body: { amount: 'NaN' } })).status, 400);
    assert.equal((await call(server, 'POST', `${H}/admin/bookings/${baseBooking._id}/refund`, { token: adminToken, body: { amount: -1, reason: 'test' } })).status, 400);
    assert.equal((await call(server, 'POST', `${H}/partner/withdrawals`, { token: partnerToken, body: { amount: -100 } })).status, 400);
});

await check('client-supplied prices are ignored (server prices the stay)', async () => {
    const res = await book({ checkIn: d(7), checkOut: d(8), pricing: { total: 1 }, payment: { amountPaid: 99999 }, status: 'checked_out' });
    assert.equal(res.status, 201, res.raw);
    const b = await reload(res.json.data.booking._id);
    assert.ok(b.pricing.total >= 2000);
    assert.equal(b.status, 'confirmed');
    assert.equal(b.payment.amountPaid, 0);
});

await check('private document paths are refused as property / room / review photos', async () => {
    const priv = 'https://api.ksg.test/uploads/pan/partner-123.jpg';
    const priv2 = '/api/v1/files/p/documents/abc.pdf';
    const r1 = await call(server, 'PUT', `${H}/partner/properties/${property._id}`, { token: partnerToken, body: { coverImage: priv } });
    assert.equal(r1.status, 400, r1.raw);
    const r2 = await call(server, 'PUT', `${H}/partner/properties/${property._id}`, { token: partnerToken, body: { images: [img('ok'), priv2] } });
    assert.equal(r2.status, 400, r2.raw);
    const r3 = await call(server, 'PUT', `${H}/partner/properties/${property._id}/room-types/${rt._id}`, { token: partnerToken, body: { images: [priv] } });
    assert.equal(r3.status, 400, r3.raw);
    const ok = await call(server, 'PUT', `${H}/partner/properties/${property._id}`, { token: partnerToken, body: { images: [img('1'), img('2'), 'https://cdn.ksg.test/uploads/hotel/properties/x.webp'] } });
    assert.equal(ok.status, 200, ok.raw);

    const stay = await M.HotelBooking.create({
        ...(await reload(baseBooking._id)), _id: new mongoose.Types.ObjectId(), bookingRef: `KSGHSEC${Date.now()}`, status: 'checked_out', review: undefined,
    });
    const bad = await call(server, 'POST', `${H}/user/reviews`, { token: g1.token, body: { bookingId: String(stay._id), rating: 5, photos: [priv] } });
    assert.equal(bad.status, 400, bad.raw);
    const js = await call(server, 'POST', `${H}/user/reviews`, { token: g1.token, body: { bookingId: String(stay._id), rating: 5, photos: ['javascript:alert(1)'] } });
    assert.equal(js.status, 400, js.raw);
});

// ─── 5. data exposure ────────────────────────────────────────────────────
console.log('\n[5] data exposure');

await check('public property / search / reviews never carry partner id, phone, email or full reviewer names', async () => {
    const detail = await call(server, 'GET', `${H}/public/properties/${property._id}`);
    assert.equal(detail.status, 200);
    const text = detail.raw;
    assert.equal(detail.json.data.property.partnerId, undefined);
    assert.ok(!text.includes(String(partner._id)));
    assert.ok(!text.includes('asha@partner.test'));
    assert.ok(!/commission|partnerPayout|rejectionReason|approvedBy/.test(text));
    const search = await call(server, 'GET', `${H}/public/properties?city=Pune`);
    assert.ok(!search.raw.includes(String(partner._id)));
    const reviews = await call(server, 'GET', `${H}/public/properties/${property._id}/reviews`);
    assert.equal(reviews.status, 200);
    assert.ok(!reviews.raw.includes('Ravi Kumar Sharma'));
    assert.ok(!reviews.raw.includes('9711111111'));
    assert.ok(!reviews.raw.includes(String(g1.user._id)));
});

await check('customer booking views carry no commission / payout / partner id; partner view no customer account id', async () => {
    const mine = await call(server, 'GET', `${H}/user/bookings/${baseBooking._id}`, { token: g1.token });
    const b = mine.json.data.booking;
    for (const k of ['commissionRate', 'commissionAmount', 'commissionGst', 'partnerPayout']) assert.equal(b.pricing[k], undefined, k);
    assert.equal(b.partnerId, undefined);
    assert.equal(b.payment.razorpayOrderId, undefined);
    const list = await call(server, 'GET', `${H}/user/bookings?limit=100`, { token: g1.token });
    assert.ok(!/commission|partnerPayout/.test(list.raw));
    const p = await call(server, 'GET', `${H}/partner/bookings/${baseBooking._id}`, { token: partnerToken });
    assert.equal(p.status, 200);
    assert.equal(p.json.data.booking.userId, undefined);
    assert.ok(!p.raw.includes(String(g1.user._id)));
    assert.equal(p.json.data.booking.guestDetails.name, 'Ravi Guest');
});

await check('partner profile never echoes FCM device tokens; logout removes the device token', async () => {
    await M.HotelPartner.updateOne({ _id: partner._id }, { $set: { 'fcmTokens.web': ['fcm-web-device-1'], 'fcmTokens.app': ['fcm-app-device-1'] } });
    const me = await call(server, 'GET', `${H}/partner/me`, { token: partnerToken });
    assert.equal(me.status, 200, me.raw);
    assert.equal(me.json.data.partner.fcmTokens, undefined);
    assert.ok(!me.raw.includes('fcm-web-device-1'));
    const out = await call(server, 'POST', '/api/v1/auth/logout', { body: { fcmToken: 'fcm-app-device-1', platform: 'mobile' } });
    assert.equal(out.status, 200, out.raw);
    const out2 = await call(server, 'POST', '/api/v1/auth/logout', { body: { fcmToken: 'fcm-web-device-1', platform: 'web' } });
    assert.equal(out2.status, 200, out2.raw);
    const p = await M.HotelPartner.findById(partner._id).lean();
    assert.deepEqual(p.fcmTokens.app, []);
    assert.deepEqual(p.fcmTokens.web, []);
});

await check('reviews of a property that is not listable (offline / suspended) are not public', async () => {
    const off = await M.HotelProperty.create({
        partnerId: partner._id, name: 'Offline Inn', slug: `offline-inn-${Date.now()}`, propertyType: 'hotel',
        location: { type: 'Point', coordinates: [73.85, 18.52] }, status: 'approved', isLive: false,
    });
    await M.HotelReview.create({ userId: g1.user._id, propertyId: off._id, bookingId: new mongoose.Types.ObjectId(), rating: 2, status: 'approved' });
    assert.equal((await call(server, 'GET', `${H}/public/properties/${off._id}/reviews`)).status, 404);
    assert.equal((await call(server, 'GET', `${H}/public/properties/${property._id}/reviews`)).status, 200);
});

// ─── 6. holds and rate limits ────────────────────────────────────────────
console.log('\n[6] unpaid holds');

await check(`at most ${svc.MAX_ACTIVE_HOLDS_PER_USER} unpaid online holds per customer (409 too_many_holds)`, async () => {
    const holds = [];
    for (let i = 0; i < svc.MAX_ACTIVE_HOLDS_PER_USER; i++) {
        const r = await book({ paymentMode: 'online', checkIn: d(60 + i), checkOut: d(61 + i) }, g3.token);
        assert.equal(r.status, 201, r.raw);
        holds.push(r.json.data.booking);
    }
    const before = await bookedOn(d(70));
    const over = await book({ paymentMode: 'online', checkIn: d(70), checkOut: d(71) }, g3.token);
    assert.equal(over.status, 409, over.raw);
    assert.match(over.json.message, /waiting for payment/);
    assert.equal(await bookedOn(d(70)), before, 'the refused booking must not hold inventory');
    // Pay at hotel needs no hold.
    assert.equal((await book({ checkIn: d(70), checkOut: d(71) }, g3.token)).status, 201);
    // An ended hold no longer counts.
    await M.HotelBooking.updateOne({ _id: holds[0]._id }, { $set: { 'payment.expiresAt': new Date(Date.now() - 1000) } });
    assert.equal((await book({ paymentMode: 'online', checkIn: d(72), checkOut: d(73) }, g3.token)).status, 201);
    // Cancelling a hold frees a slot too.
    await call(server, 'POST', `${H}/user/bookings/${holds[1]._id}/cancel`, { token: g3.token, body: {} });
    assert.equal((await book({ paymentMode: 'online', checkIn: d(74), checkOut: d(75) }, g3.token)).status, 201);
});

// ─── 7. money ────────────────────────────────────────────────────────────
console.log('\n[7] money');

await check('verify: bad signature, foreign order and wrong amount are refused', async () => {
    const r = await book({ paymentMode: 'online', checkIn: d(80), checkOut: d(81) }, g4.token);
    const b = r.json.data.booking;
    const p = r.json.data.payment;
    const badSig = await call(server, 'POST', `${H}/user/bookings/${b._id}/verify-payment`, {
        token: g4.token, body: { razorpayOrderId: p.razorpayOrderId, razorpayPaymentId: 'pay_x', razorpaySignature: 'f'.repeat(64) },
    });
    assert.equal(badSig.status, 400);
    const foreign = await call(server, 'POST', `${H}/user/bookings/${b._id}/verify-payment`, {
        token: g4.token, body: { razorpayOrderId: 'order_other', razorpayPaymentId: 'pay_y', razorpaySignature: sign('order_other', 'pay_y') },
    });
    assert.equal(foreign.status, 400);
    // Captured amount lower than the booking's online amount.
    orders.get(p.razorpayOrderId).amountPaise = 100;
    const cheap = await verify(b, p, 'pay_cheap', g4.token);
    assert.equal(cheap.status, 400, cheap.raw);
    assert.equal((await reload(b._id)).status, 'awaiting_payment');
    orders.get(p.razorpayOrderId).amountPaise = p.amount;
    await call(server, 'POST', `${H}/user/bookings/${b._id}/cancel`, { token: g4.token, body: {} });
});

await check('concurrent cancel + verify: never both confirmed and unrefunded; inventory consistent', async () => {
    const day = d(90);
    const before = await bookedOn(day);
    const r = await book({ paymentMode: 'online', checkIn: day, checkOut: d(91) }, g4.token);
    const b = r.json.data.booking;
    const [cancel, v] = await Promise.all([
        call(server, 'POST', `${H}/user/bookings/${b._id}/cancel`, { token: g4.token, body: {} }),
        verify(b, r.json.data.payment, `pay_race${++seq}`, g4.token),
    ]);
    const after = await reload(b._id);
    if (after.status === 'cancelled') {
        assert.equal(await bookedOn(day), before);
        if (after.payment.onlinePaid > 0) {
            assert.equal(after.payment.gatewayRefunded, after.payment.onlinePaid, 'a late capture must be refunded in full');
        }
    } else {
        assert.equal(after.status, 'confirmed');
        assert.equal(await bookedOn(day), before + 1);
        assert.equal(cancel.status, 409, cancel.raw);
        assert.equal(v.status, 200, v.raw);
    }
});

await check('concurrent refunds (admin manual + partner cancel) never exceed what was paid', async () => {
    const { booking } = await paidOnline(g4.token, { checkIn: d(100), checkOut: d(101) });
    const paid = booking.payment.onlinePaid;
    const refundsBefore = gatewayRefunds.length;
    const results = await Promise.all([
        call(server, 'POST', `${H}/admin/bookings/${booking._id}/refund`, { token: adminToken, body: { amount: paid, reason: 'goodwill' } }),
        call(server, 'PUT', `${H}/partner/bookings/${booking._id}/cancel`, { token: partnerToken, body: { reason: 'overbooked' } }),
    ]);
    const after = await reload(booking._id);
    const moved = gatewayRefunds.slice(refundsBefore).reduce((s, r) => s + r.amount, 0);
    assert.ok(moved <= paid + 0.001, `refunded ${moved} of ${paid} (${results.map((r) => r.status)})`);
    assert.ok(after.payment.gatewayRefunded <= paid + 0.001);
    assert.ok(after.payment.refundedAmount <= after.payment.amountPaid + 0.001);
    const logged = (after.refunds || []).reduce((s, r) => s + (r.walletAmount || 0) + (r.gatewayAmount || 0), 0);
    assert.ok(Math.abs(logged - after.payment.refundedAmount) < 0.01, `log ${logged} vs refundedAmount ${after.payment.refundedAmount}`);
});

await check('applyRefund: two racing keys for the full amount -> one pays, the other is capped (clamp off) or clamped to 0', async () => {
    const { booking } = await paidOnline(g4.token, { checkIn: d(102), checkOut: d(103) });
    const paid = booking.payment.onlinePaid;
    const [a, b] = await Promise.all([
        svc.applyRefund(booking._id, { key: 'race:a', gatewayAmount: paid, clamp: false, by: 'admin' }),
        svc.applyRefund(booking._id, { key: 'race:b', gatewayAmount: paid, clamp: true, by: 'admin' }),
    ]);
    assert.equal(a.refunded + b.refunded, paid);
    const after = await reload(booking._id);
    assert.equal(after.payment.gatewayRefunded, paid);
    assert.equal(after.payment.status, 'refunded');
    // And a sequential over-refund is refused too.
    const again = await svc.applyRefund(booking._id, { key: 'race:c', gatewayAmount: 1, clamp: false });
    assert.equal(again.refunded, 0);
    assert.ok(again.capped);
    const admin = await call(server, 'POST', `${H}/admin/bookings/${booking._id}/refund`, { token: adminToken, body: { amount: 1, reason: 'too much' } });
    assert.equal(admin.status, 400, admin.raw);
});

await check('partial refunds sum exactly (paise) and a reason starting with $ is stored as text', async () => {
    const { booking } = await paidOnline(g4.token, { checkIn: d(104), checkOut: d(105) });
    const r1 = await svc.applyRefund(booking._id, { key: 'p:1', gatewayAmount: 0.1, reason: '$where: 1' });
    const r2 = await svc.applyRefund(booking._id, { key: 'p:2', gatewayAmount: 0.2, reason: '$$ROOT' });
    assert.equal(Math.round((r1.refunded + r2.refunded) * 100), 30);
    const after = await reload(booking._id);
    assert.equal(after.payment.gatewayRefunded, 0.3);
    assert.equal(after.payment.refundedAmount, 0.3);
    assert.equal(after.payment.status, 'partially_refunded');
    assert.deepEqual(after.refunds.map((r) => r.reason), ['$where: 1', '$$ROOT']);
    // Same key again: nothing moves.
    const dup = await svc.applyRefund(booking._id, { key: 'p:1', gatewayAmount: 0.1 });
    assert.ok(dup.duplicate);
});

await check('wallet: refund keys are idempotent; a cancelled wallet booking is credited once', async () => {
    await CustomerWallet.updateOne({ userId: g2.user._id }, { $set: { balance: 10000 }, $setOnInsert: { transactions: [] } }, { upsert: true });
    const res = await book({ paymentMode: 'online', useWallet: true, checkIn: d(110), checkOut: d(111) }, g2.token);
    assert.equal(res.status, 201, res.raw);
    const b = res.json.data.booking;
    assert.equal(b.status, 'confirmed');
    const afterDebit = (await CustomerWallet.findOne({ userId: g2.user._id }).lean()).balance;
    const [c1, c2] = await Promise.all([
        call(server, 'POST', `${H}/user/bookings/${b._id}/cancel`, { token: g2.token, body: {} }),
        call(server, 'POST', `${H}/user/bookings/${b._id}/cancel`, { token: g2.token, body: {} }),
    ]);
    assert.deepEqual([c1.status, c2.status].sort(), [200, 409]);
    const wallet = await CustomerWallet.findOne({ userId: g2.user._id }).lean();
    const credits = wallet.transactions.filter((t) => t.referenceKey === `hotel:${b._id}:refund:cancel`);
    assert.equal(credits.length, 1);
    assert.equal(wallet.balance, afterDebit + b.payment.walletAmount);
});

await check('a second capture on a paid order is refunded on its own (stray), booking money untouched', async () => {
    const { booking, payment, paymentId } = await paidOnline(g4.token, { checkIn: d(120), checkOut: d(121) });
    const before = await reload(booking._id);
    const refundsBefore = gatewayRefunds.length;
    const out = await webhook({ id: 'pay_stray1', order_id: payment.razorpayOrderId, amount: payment.amount });
    assert.equal(out.statusCode, 200);
    const again = await webhook({ id: 'pay_stray1', order_id: payment.razorpayOrderId, amount: payment.amount });
    assert.equal(again.statusCode, 200);
    const after = await reload(booking._id);
    const stray = gatewayRefunds.slice(refundsBefore);
    assert.deepEqual(stray.map((r) => r.paymentId), ['pay_stray1'], 'refunded exactly once, against the stray payment');
    assert.equal(after.status, 'confirmed');
    assert.equal(after.payment.razorpayPaymentId, paymentId);
    assert.equal(after.payment.onlinePaid, before.payment.onlinePaid);
    assert.equal(after.payment.refundedAmount || 0, 0);
    assert.equal(after.refunds.find((r) => r.key === 'stray:pay_stray1')?.status, 'processed');
    const row = await Payment.findOne({ gatewayOrderId: payment.razorpayOrderId }).lean();
    assert.equal(row.gatewayPaymentId, paymentId, 'the booking\'s payment row is not overwritten');
});

await check('webhook: a transient error confirming a hotel capture returns 500 (Razorpay retries); the retry confirms', async () => {
    const r = await book({ paymentMode: 'online', checkIn: d(130), checkOut: d(131) }, g1.token);
    const b = r.json.data.booking;
    const p = r.json.data.payment;
    const realFindById = M.HotelBooking.findById;
    M.HotelBooking.findById = function failing() { throw new Error('connection reset'); };
    let out;
    try {
        out = await webhook({ id: 'pay_retry1', order_id: p.razorpayOrderId, amount: p.amount });
    } finally {
        M.HotelBooking.findById = realFindById;
    }
    assert.equal(out.statusCode, 500);
    assert.equal((await reload(b._id)).status, 'awaiting_payment');
    const retry = await webhook({ id: 'pay_retry1', order_id: p.razorpayOrderId, amount: p.amount });
    assert.equal(retry.statusCode, 200);
    assert.equal((await reload(b._id)).status, 'confirmed');
    // An amount mismatch is acknowledged (cannot succeed on retry).
    const r2 = await book({ paymentMode: 'online', checkIn: d(132), checkOut: d(133) }, g1.token);
    const mismatch = await webhook({ id: 'pay_short', order_id: r2.json.data.payment.razorpayOrderId, amount: 100 });
    assert.equal(mismatch.statusCode, 200);
    assert.equal((await reload(r2.json.data.booking._id)).status, 'awaiting_payment');
});

await check('parallel withdrawals cannot overdraw the partner balance', async () => {
    await append({
        ownerType: 'partner', ownerId: String(partner._id), vertical: 'hotel', jobType: 'hotel_booking', jobId: 'seed',
        type: 'EARNING', amount: 1000, idempotencyKey: `hotel_booking:seed${Date.now()}:settle:partner_earning`, reason: 'seed',
    });
    const results = await Promise.all(Array.from({ length: 4 }, () =>
        call(server, 'POST', `${H}/partner/withdrawals`, { token: partnerToken, body: { amount: 600 } })));
    const ok = results.filter((r) => r.status === 201);
    assert.equal(ok.length, 1, results.map((r) => `${r.status} ${r.json?.message}`).join(' | '));
    const bal = await PartnerBalance.findOne({ ownerType: 'partner', ownerId: String(partner._id) }).lean();
    assert.ok(bal.balance >= -0.001, `balance went to ${bal.balance}`);
    assert.equal(await M.HotelWithdrawal.countDocuments({ partnerId: partner._id }), 1);
});

// ─── 8. inventory symmetry ───────────────────────────────────────────────
console.log('\n[8] inventory');

await check('gateway order failure after reserve gives the rooms (and wallet part) back', async () => {
    const day = d(140);
    const before = await bookedOn(day);
    __setHotelGatewayForTests({
        async createOrder() { throw Object.assign(new Error('gateway down'), { statusCode: 502 }); },
        async refund(paymentId, amount) { gatewayRefunds.push({ paymentId, amount }); return { id: `rfnd_S${++seq}` }; },
    });
    try {
        const r = await book({ paymentMode: 'online', checkIn: day, checkOut: d(141) }, g1.token);
        assert.equal(r.status, 502, r.raw);
    } finally {
        __setHotelGatewayForTests({
            async createOrder({ amountPaise }) { const id = `order_S${++seq}`; orders.set(id, { amountPaise }); return { id, amount: amountPaise, currency: 'INR' }; },
            async fetchPayment(paymentId, { orderId }) { return { id: paymentId, order_id: orderId, status: 'captured', amount: orders.get(orderId)?.amountPaise }; },
            async refund(paymentId, amount) { gatewayRefunds.push({ paymentId, amount }); return { id: `rfnd_S${++seq}`, status: 'processed' }; },
        });
    }
    assert.equal(await bookedOn(day), before);
    const failed = await M.HotelBooking.findOne({ userId: g1.user._id, checkIn: inv.toNightDate(day) }).lean();
    assert.equal(failed.status, 'expired');
});

await check('every exit path releases exactly what it reserved', async () => {
    const day = d(150);
    const before = await bookedOn(day);
    const a = (await book({ checkIn: day, checkOut: d(152), rooms: 2 }, g2.token)).json.data.booking;
    const b = (await book({ paymentMode: 'online', checkIn: day, checkOut: d(151) }, g2.token)).json.data.booking;
    assert.equal(await bookedOn(day), before + 3);
    await call(server, 'PUT', `${H}/partner/bookings/${a._id}/cancel`, { token: partnerToken, body: { reason: 'maintenance' } });
    await svc.expireBooking(b._id);
    assert.equal(await bookedOn(day), before);
    assert.equal(await bookedOn(d(151)), 0);
    // Releasing twice (a replayed transition) is refused, never double-released.
    await assert.rejects(svc.expireBooking(b._id), (e) => e.statusCode === 409);
    assert.equal(await bookedOn(day), before);
});

__setHotelGatewayForTests(null);
server.close();
await mongoose.disconnect();
// Bounded: on a loaded Windows host the mongod shutdown can hang past the run.
await Promise.race([replSet.stop(), new Promise((r) => setTimeout(r, 30_000).unref())]);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall hotel security checks passed');
process.exit(failures ? 1 : 0);
