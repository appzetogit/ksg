// Hotel phase 5: settlement, earnings, withdrawals, reviews, saved, voucher, dashboard,
// reminders, notifications and the cross-vertical lists.
// Contract: docs/hotel-api-contract.md (Phase 4-5).
//
// Boots the real express app against an in-memory single-node REPLICA SET (ledger
// appends are real transactions). The booking workstream is simulated: HotelBooking
// documents are created directly and booking events are emitted by hand through
// services/bookingEvents.js, exactly as the contract's internal interface says.
//
// Run: node tests/hotel.money.smoke.mjs

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

const call = (server, method, path, { body, token, raw: rawHeaders } = {}) =>
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
                    ...(rawHeaders || {}),
                },
            },
            (res) => {
                let raw = '';
                res.on('data', (c) => (raw += c));
                res.on('end', () => {
                    let json = null;
                    try { json = JSON.parse(raw); } catch { /* not json */ }
                    resolve({ status: res.statusCode, json, raw, headers: res.headers });
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
const { bookingEvents } = await import('../src/modules/hotel/services/bookingEvents.js');
const dates = await import('../src/modules/hotel/services/dates.js');
const notif = await import('../src/modules/hotel/services/notifications.listener.js');
const { LedgerEntry } = await import('../src/core/finance/ledgerEntry.model.js');
const { PartnerBalance } = await import('../src/core/finance/partnerBalance.model.js');
const { reconcileOwner } = await import('../src/core/finance/ledger.service.js');
const M = mongoose.models;
await Promise.all([...HOTEL_MODEL_NAMES.map((n) => M[n].syncIndexes()), LedgerEntry.syncIndexes(), PartnerBalance.syncIndexes()]);

// No real pushes or emails in a test: record them instead.
const pushes = [];
notif.__setSenders({
    push: async (target, payload) => { pushes.push({ target, payload }); return { successCount: 0 }; },
    pushTokens: async (tokens, payload) => { pushes.push({ tokens, payload }); return { successCount: tokens.length }; },
    email: async (mail) => { pushes.push({ email: mail.to }); return true; },
});

const H = '/api/v1/hotel';
const today = dates.todayIST();
const d = (n) => dates.addDays(today, n);
const night = (s) => dates.toNightDate(s);
const r2 = (n) => Math.round(n * 100) / 100;
const oid = () => new mongoose.Types.ObjectId();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) return v;
        await sleep(50);
    }
};

// ─── fixtures ─────────────────────────────────────────────────────────────

const U1 = await M.FoodUser.create({ phone: '9811100001', name: 'Asha Verma', isActive: true });
const U2 = await M.FoodUser.create({ phone: '9811100002', name: 'Ravi Kumar', isActive: true });
const userToken = (u) => signAccessToken({ userId: String(u._id), role: 'USER' });
const T1 = userToken(U1);
const T2 = userToken(U2);

const bank = { accountHolder: 'Lake Hotels', accountNumberMasked: 'XXXXXXXX1234', ifsc: 'HDFC0001234', bankName: 'HDFC' };
const P = await M.HotelPartner.create({ phone: '9422200001', name: 'Lake Hotels', status: 'approved', bank, fcmTokens: { web: ['tok-web-1'], app: [] } });
const Q = await M.HotelPartner.create({ phone: '9422200002', name: 'Other Hotels', status: 'approved' });
const PEND = await M.HotelPartner.create({ phone: '9422200003', name: 'Pending Hotels', status: 'pending' });
const partnerToken = (p) => signAccessToken({ userId: String(p._id), role: 'HOTEL_PARTNER' });
const TP = partnerToken(P);
const TQ = partnerToken(Q);
const TPEND = partnerToken(PEND);
const admin = await M.FoodAdmin.create({
    email: `hotelmoney${Date.now()}@ksg.test`, password: 'irrelevant-for-this-test', name: 'Hotel Admin', servicesAccess: ['hotel'],
});
const adminToken = signAccessToken({ userId: String(admin._id), role: 'ADMIN' });

const point = { type: 'Point', coordinates: [77.4126, 23.2599] };
const prop = await M.HotelProperty.create({
    partnerId: P._id, name: 'Lakeview Inn', slug: 'lakeview-inn-bhopal', propertyType: 'hotel',
    address: { city: 'Bhopal', area: 'MP Nagar' }, location: point, coverImage: 'https://placehold.co/1.jpg',
    status: 'approved', isLive: true, startingPrice: 2000, originalPrice: 2500,
});
const hidden = await M.HotelProperty.create({
    partnerId: P._id, name: 'Draft Inn', propertyType: 'hotel', address: { city: 'Bhopal' }, location: point, status: 'draft',
});
const qProp = await M.HotelProperty.create({
    partnerId: Q._id, name: 'Q Inn', slug: 'q-inn', propertyType: 'hotel', address: { city: 'Indore' }, location: point,
    status: 'approved', isLive: true, startingPrice: 1500,
});
const roomTypeId = oid();

// Pricing: tariff 2000 + 5% GST 100 = partner gross 2100; fee 20 + 3.6 GST;
// commission 200 + 36 GST. total = 2123.6
const PRICING = {
    roomCharges: 2000, extraGuestCharges: 0, subtotal: 2000, couponDiscount: 0, prepaidDiscount: 0,
    taxableAmount: 2000, gstRate: 5, gstAmount: 100, platformFee: 20, platformFeeGst: 3.6, total: 2123.6,
    commissionRate: 10, commissionAmount: 200, commissionGst: 36, partnerPayout: 1864,
};
const TOTAL = 2123.6;

let refN = 0;
const bookings = [];
const makeBooking = async ({ user = U1, mode = 'online', status = 'checked_out', payStatus, amountPaid, amountDue = 0, checkIn = d(-3), checkOut = d(-1), property = prop, partner = P, extra = {} } = {}) => {
    refN += 1;
    const b = await M.HotelBooking.create({
        bookingRef: `KSGHTEST${refN}`,
        userId: user._id, propertyId: property._id, partnerId: partner._id, roomTypeId,
        snapshot: {
            propertyName: property.name, propertyType: 'hotel', roomTypeName: 'Deluxe Room', address: 'MP Nagar, Bhopal',
            checkInTime: '12:00', checkOutTime: '11:00', cancellationPolicy: { type: 'moderate', freeCancelHours: 24, refundPercentAfter: 50 },
        },
        checkIn: night(checkIn), checkOut: night(checkOut), nights: dates.daysBetween(checkIn, checkOut), rooms: 1,
        guests: { adults: 2, children: 0 }, guestDetails: { name: user.name, phone: user.phone, email: 'guest@example.com' },
        pricing: PRICING,
        payment: {
            mode,
            status: payStatus || (mode === 'pay_at_hotel' ? 'pending' : 'paid'),
            amountPaid: amountPaid ?? (mode === 'pay_at_hotel' ? 0 : TOTAL),
            amountDue,
        },
        status,
        statusHistory: [{ status, by: { role: 'system' } }],
        ...extra,
    });
    bookings.push(b);
    return b;
};

const partnerRows = (bookingId) => LedgerEntry.find({ jobId: String(bookingId), ownerType: 'partner' }).lean();
const allRows = (bookingId) => LedgerEntry.find({ jobId: String(bookingId) }).lean();
const sumOf = (rows) => r2(rows.reduce((s, e) => s + e.amount, 0));
const balanceOf = async (p) => r2((await PartnerBalance.findOne({ ownerType: 'partner', ownerId: String(p._id) }).lean())?.balance || 0);
const transition = (booking, from, to, actor = { role: 'partner', id: String(P._id) }) =>
    bookingEvents.emit('transition', { booking: booking.toObject ? booking.toObject() : booking, from, to, actor });

console.log('\n[1] settlement');

const B1 = await makeBooking({ mode: 'online' });
await check('online: payment marker + checked_out -> EARNING +2100, COMMISSION -236, platform +236 / +23.6', async () => {
    bookingEvents.emit('payment', { booking: B1.toObject(), amount: TOTAL, kind: 'online', paymentId: 'pay_B1' });
    await waitFor(async () => (await allRows(B1._id)).length >= 1);
    transition(B1, 'checked_in', 'checked_out');
    const rows = await waitFor(async () => { const r = await allRows(B1._id); return r.length >= 5 ? r : null; });
    assert.ok(rows, 'entries written');
    const by = Object.fromEntries(rows.map((e) => [`${e.ownerType}:${e.type}`, e.amount]));
    assert.equal(by['partner:EARNING'], 2100);
    assert.equal(by['partner:COMMISSION'], -236);
    assert.equal(by['platform:COMMISSION'], 236);
    assert.equal(by['platform:PLATFORM_FEE'], 23.6);
    assert.equal(by['platform:NON_WALLET'], 0);
    assert.ok(rows.every((e) => e.vertical === 'hotel'));
    assert.ok(rows.every((e) => e.keyKind === 'hotel_booking'));
    assert.equal(await balanceOf(P), 1864);
});

await check('emitting the same events again moves nothing (idempotent)', async () => {
    bookingEvents.emit('payment', { booking: B1.toObject(), amount: TOTAL, kind: 'online', paymentId: 'pay_B1' });
    transition(B1, 'checked_in', 'checked_out');
    transition(B1, 'checked_in', 'checked_out');
    await sleep(800);
    assert.equal((await allRows(B1._id)).length, 5);
    assert.equal(await balanceOf(P), 1864);
});

await check('a non-settling transition (checked_in) settles nothing', async () => {
    const b = await makeBooking({ mode: 'online', status: 'checked_in', checkIn: d(-1), checkOut: d(1) });
    transition(b, 'confirmed', 'checked_in');
    await sleep(600);
    assert.equal((await partnerRows(b._id)).length, 0);
    await M.HotelBooking.deleteOne({ _id: b._id });
    bookings.pop();
});

const B2 = await makeBooking({ mode: 'pay_at_hotel', amountPaid: TOTAL, payStatus: 'paid' });
await check('pay at hotel: partner debited commission (-236) and the fee it collected (-23.6) only', async () => {
    bookingEvents.emit('payment', { booking: B2.toObject(), amount: TOTAL, kind: 'at_hotel' });
    transition(B2, 'checked_in', 'checked_out');
    const rows = await waitFor(async () => { const r = await partnerRows(B2._id); return r.length >= 2 ? r : null; });
    assert.ok(rows);
    const by = Object.fromEntries(rows.map((e) => [e.type, e.amount]));
    assert.equal(by.COMMISSION, -236);
    assert.equal(by.PLATFORM_FEE, -23.6);
    assert.equal(by.EARNING, undefined);
    assert.equal(sumOf(rows), -259.6);
});

const B3 = await makeBooking({ mode: 'partial_prepaid', amountPaid: 700, payStatus: 'partially_paid', amountDue: 1423.6 });
await check('partial prepaid (700 online): EARNING +676.4 (700 - fee), COMMISSION -236', async () => {
    bookingEvents.emit('payment', { booking: B3.toObject(), amount: 700, kind: 'online', paymentId: 'pay_B3' });
    await waitFor(async () => (await allRows(B3._id)).length >= 1);
    transition(B3, 'checked_in', 'checked_out');
    const rows = await waitFor(async () => { const r = await partnerRows(B3._id); return r.length >= 2 ? r : null; });
    assert.ok(rows);
    const by = Object.fromEntries(rows.map((e) => [e.type, e.amount]));
    assert.equal(by.EARNING, 676.4);
    assert.equal(by.COMMISSION, -236);
    // Hotel holds 1423.6 cash + 440.4 wallet = 1864 = partner gross - commission.
    assert.equal(r2(sumOf(rows) + 1423.6), 1864);
});

const B4 = await makeBooking({ mode: 'wallet' });
await check('wallet-paid with no payment event: the mode decides (full EARNING)', async () => {
    transition(B4, 'checked_in', 'checked_out', { role: 'admin', id: String(admin._id) });
    const rows = await waitFor(async () => { const r = await partnerRows(B4._id); return r.length >= 2 ? r : null; });
    assert.ok(rows);
    assert.equal(sumOf(rows), 1864);
    assert.equal(rows[0].actor.kind, 'admin');
});

const B5 = await makeBooking({ mode: 'online' });
await check('cancelled after settlement (full refund): every settle row reversed, partner nets 0', async () => {
    bookingEvents.emit('payment', { booking: B5.toObject(), amount: TOTAL, kind: 'online', paymentId: 'pay_B5' });
    await waitFor(async () => (await allRows(B5._id)).length >= 1);
    transition(B5, 'checked_in', 'checked_out');
    await waitFor(async () => (await partnerRows(B5._id)).length >= 2);
    await M.HotelBooking.updateOne({ _id: B5._id }, {
        $set: { status: 'cancelled', 'payment.status': 'refunded', cancellation: { by: 'admin', reason: 'test', at: new Date(), refundAmount: TOTAL } },
    });
    const fresh = await M.HotelBooking.findById(B5._id);
    bookingEvents.emit('refund', { booking: fresh.toObject(), amount: TOTAL, walletAmount: 0, gatewayAmount: TOTAL, refundId: 'rfnd_B5' });
    transition(fresh, 'checked_out', 'cancelled', { role: 'admin', id: String(admin._id) });
    const rows = await waitFor(async () => { const r = await partnerRows(B5._id); return r.length >= 4 ? r : null; });
    assert.ok(rows, 'reversal rows written');
    assert.equal(sumOf(rows), 0);
    assert.ok(rows.some((e) => e.type === 'REFUND' && e.amount === -2100));
    const platform = (await allRows(B5._id)).filter((e) => e.ownerType === 'platform' && e.type !== 'NON_WALLET');
    assert.equal(sumOf(platform), 0);
    // replay of the cancel
    transition(fresh, 'checked_out', 'cancelled');
    await sleep(600);
    assert.equal((await partnerRows(B5._id)).length, 4);
});

const B6 = await makeBooking({ mode: 'online', status: 'confirmed', checkIn: d(5), checkOut: d(6) });
await check('cancelled before settlement with a 50% refund: the retained half settles pro rata', async () => {
    bookingEvents.emit('payment', { booking: B6.toObject(), amount: TOTAL, kind: 'online', paymentId: 'pay_B6' });
    await waitFor(async () => (await allRows(B6._id)).length >= 1);
    await M.HotelBooking.updateOne({ _id: B6._id }, {
        $set: { status: 'cancelled', cancellation: { by: 'user', reason: 'plans changed', at: new Date(), refundAmount: 1061.8 } },
    });
    const fresh = await M.HotelBooking.findById(B6._id);
    transition(fresh, 'confirmed', 'cancelled', { role: 'user', id: String(U1._id) });
    bookingEvents.emit('refund', { booking: fresh.toObject(), amount: 1061.8, walletAmount: 0, gatewayAmount: 1061.8, refundId: 'rfnd_B6' });
    const rows = await waitFor(async () => { const r = await partnerRows(B6._id); return r.length >= 2 ? r : null; });
    assert.ok(rows);
    const by = Object.fromEntries(rows.map((e) => [e.type, e.amount]));
    assert.equal(by.EARNING, 1050);
    assert.equal(by.COMMISSION, -118);
    await sleep(500);
    assert.equal((await partnerRows(B6._id)).length, 2, 'the late refund event does not settle again');
});

const EXPECTED_BALANCE = r2(1864 - 259.6 + 440.4 + 1864 + 0 + 932);
await check(`partner balance = ${EXPECTED_BALANCE} and the snapshot agrees with the ledger`, async () => {
    assert.equal(await balanceOf(P), EXPECTED_BALANCE);
    const rec = await reconcileOwner('partner', String(P._id));
    assert.equal(rec.clean, true, JSON.stringify(rec));
    const plat = await reconcileOwner('platform', 'platform');
    assert.equal(plat.clean, true, JSON.stringify(plat));
});

console.log('\n[2] earnings, ledger, withdrawals');

const B7 = await makeBooking({ mode: 'online', status: 'confirmed', checkIn: d(1), checkOut: d(2) });
await check('GET /partner/earnings', async () => {
    const res = await call(server, 'GET', `${H}/partner/earnings`, { token: TP });
    assert.equal(res.status, 200, res.raw);
    const e = res.json.data;
    assert.equal(e.balance, EXPECTED_BALANCE);
    assert.equal(e.totalEarned, EXPECTED_BALANCE);
    assert.equal(e.thisMonth, EXPECTED_BALANCE);
    assert.equal(e.withdrawable, EXPECTED_BALANCE);
    assert.equal(e.minWithdrawal, 500);
    assert.equal(e.pendingSettlement, 1864, 'B7 confirmed online, not settled yet');
});

await check('GET /partner/ledger pages rows with bookingRef and balanceAfter, no markers', async () => {
    const res = await call(server, 'GET', `${H}/partner/ledger?page=1&limit=5`, { token: TP });
    assert.equal(res.status, 200, res.raw);
    const { items, total, limit } = res.json.data;
    assert.equal(limit, 5);
    assert.equal(items.length, 5);
    assert.equal(total, await LedgerEntry.countDocuments({ ownerType: 'partner', ownerId: String(P._id) }));
    assert.ok(items.every((i) => i.bookingRef && i.description && typeof i.balanceAfter === 'number'));
    assert.ok(items.every((i) => i.type !== 'NON_WALLET'));
});

await check('money routes need an approved partner (pending 403, customer 403)', async () => {
    assert.equal((await call(server, 'GET', `${H}/partner/earnings`, { token: TPEND })).status, 403);
    assert.equal((await call(server, 'GET', `${H}/partner/earnings`, { token: T1 })).status, 403);
    assert.equal((await call(server, 'GET', `${H}/partner/earnings`)).status, 401);
});

let W1;
await check('withdrawal rules: below minimum 400, more than balance 409, no bank 400', async () => {
    const low = await call(server, 'POST', `${H}/partner/withdrawals`, { token: TP, body: { amount: 100 } });
    assert.equal(low.status, 400, low.raw);
    const over = await call(server, 'POST', `${H}/partner/withdrawals`, { token: TP, body: { amount: EXPECTED_BALANCE + 1 } });
    assert.equal(over.status, 409, over.raw);
    const noBank = await call(server, 'POST', `${H}/partner/withdrawals`, { token: TQ, body: { amount: 600 } });
    assert.equal(noBank.status, 400, noBank.raw);
    assert.equal(await M.HotelWithdrawal.countDocuments({}), 0);
});

await check('a valid request holds the amount (balance drops)', async () => {
    const res = await call(server, 'POST', `${H}/partner/withdrawals`, { token: TP, body: { amount: 1000 } });
    assert.equal(res.status, 201, res.raw);
    W1 = res.json.data.withdrawal;
    assert.equal(W1.status, 'pending');
    assert.equal(W1.amount, 1000);
    assert.equal(await balanceOf(P), r2(EXPECTED_BALANCE - 1000));
    const list = await call(server, 'GET', `${H}/partner/withdrawals?page=1`, { token: TP });
    assert.equal(list.json.data.total, 1);
    const earn = await call(server, 'GET', `${H}/partner/earnings`, { token: TP });
    assert.equal(earn.json.data.totalEarned, EXPECTED_BALANCE, 'a payout is not negative earnings');
});

await check('admin lists and rejects -> balance restored; a second reject is 409', async () => {
    const list = await call(server, 'GET', `${H}/admin/withdrawals?status=pending`, { token: adminToken });
    assert.equal(list.status, 200, list.raw);
    assert.equal(list.json.data.items[0].partner.name, 'Lake Hotels');
    const rej = await call(server, 'PUT', `${H}/admin/withdrawals/${W1._id}/status`, { token: adminToken, body: { status: 'rejected', note: 'bank mismatch' } });
    assert.equal(rej.status, 200, rej.raw);
    assert.equal(rej.json.data.withdrawal.status, 'rejected');
    assert.equal(await balanceOf(P), EXPECTED_BALANCE);
    const again = await call(server, 'PUT', `${H}/admin/withdrawals/${W1._id}/status`, { token: adminToken, body: { status: 'rejected' } });
    assert.equal(again.status, 409, again.raw);
    assert.equal(await balanceOf(P), EXPECTED_BALANCE);
});

await check('approve then paid keeps the hold; partner cannot reach admin routes', async () => {
    const res = await call(server, 'POST', `${H}/partner/withdrawals`, { token: TP, body: { amount: 500 } });
    assert.equal(res.status, 201, res.raw);
    const id = res.json.data.withdrawal._id;
    assert.equal((await call(server, 'PUT', `${H}/admin/withdrawals/${id}/status`, { token: TP, body: { status: 'paid' } })).status, 403);
    const ap = await call(server, 'PUT', `${H}/admin/withdrawals/${id}/status`, { token: adminToken, body: { status: 'approved' } });
    assert.equal(ap.json.data.withdrawal.status, 'approved');
    const paid = await call(server, 'PUT', `${H}/admin/withdrawals/${id}/status`, { token: adminToken, body: { status: 'paid', utr: 'UTR123' } });
    assert.equal(paid.json.data.withdrawal.status, 'paid');
    assert.equal(paid.json.data.withdrawal.utr, 'UTR123');
    assert.equal(await balanceOf(P), r2(EXPECTED_BALANCE - 500));
    const back = await call(server, 'PUT', `${H}/admin/withdrawals/${id}/status`, { token: adminToken, body: { status: 'approved' } });
    assert.equal(back.status, 409);
});

console.log('\n[3] reviews');

let R1;
let R2;
await check('not stayed (confirmed) -> 400; someone else\'s booking -> 404; bad rating -> 400', async () => {
    const r = await call(server, 'POST', `${H}/user/reviews`, { token: T1, body: { bookingId: String(B7._id), rating: 5 } });
    assert.equal(r.status, 400, r.raw);
    const other = await call(server, 'POST', `${H}/user/reviews`, { token: T2, body: { bookingId: String(B1._id), rating: 5 } });
    assert.equal(other.status, 404, other.raw);
    const bad = await call(server, 'POST', `${H}/user/reviews`, { token: T1, body: { bookingId: String(B1._id), rating: 6 } });
    assert.equal(bad.status, 400, bad.raw);
    assert.equal((await call(server, 'POST', `${H}/user/reviews`, { token: TP, body: { bookingId: String(B1._id), rating: 5 } })).status, 403);
});

await check('a checked-out guest reviews once; rating recomputed; booking.review set', async () => {
    const r = await call(server, 'POST', `${H}/user/reviews`, {
        token: T1, body: { bookingId: String(B1._id), rating: 4, comment: 'Lovely lake view', subRatings: { cleanliness: 5 } },
    });
    assert.equal(r.status, 201, r.raw);
    R1 = r.json.data.review;
    assert.equal(R1.status, 'approved');
    assert.equal(R1.user.name, 'Asha');
    const p = await M.HotelProperty.findById(prop._id).lean();
    assert.equal(p.avgRating, 4);
    assert.equal(p.totalReviews, 1);
    assert.equal(String((await M.HotelBooking.findById(B1._id).lean()).review), String(R1._id));
    const dup = await call(server, 'POST', `${H}/user/reviews`, { token: T1, body: { bookingId: String(B1._id), rating: 1 } });
    assert.equal(dup.status, 409, dup.raw);
    const r2_ = await call(server, 'POST', `${H}/user/reviews`, { token: T1, body: { bookingId: String(B4._id), rating: 2 } });
    assert.equal(r2_.status, 201, r2_.raw);
    R2 = r2_.json.data.review;
    assert.equal((await M.HotelProperty.findById(prop._id).lean()).avgRating, 3);
});

await check('public reviews: approved, paginated, summary + breakdown, first names only', async () => {
    const res = await call(server, 'GET', `${H}/public/properties/${prop._id}/reviews?page=1&limit=1`);
    assert.equal(res.status, 200, res.raw);
    const data = res.json.data;
    assert.equal(data.total, 2);
    assert.equal(data.items.length, 1);
    assert.deepEqual(data.summary, { avgRating: 3, totalReviews: 2, breakdown: { 5: 0, 4: 1, 3: 0, 2: 1, 1: 0 } });
    assert.ok(!res.raw.includes('Verma'), 'surname not exposed');
    assert.ok(!res.raw.includes(String(U1._id)), 'user id not exposed');
    assert.equal((await call(server, 'GET', `${H}/public/properties/${oid()}/reviews`)).status, 404);
});

await check('partner lists and replies to own reviews; another partner gets 404', async () => {
    const list = await call(server, 'GET', `${H}/partner/reviews?propertyId=${prop._id}`, { token: TP });
    assert.equal(list.status, 200, list.raw);
    assert.equal(list.json.data.total, 2);
    assert.equal(list.json.data.items[0].property.name, 'Lakeview Inn');
    const reply = await call(server, 'POST', `${H}/partner/reviews/${R1._id}/reply`, { token: TP, body: { text: 'Thank you, Asha!' } });
    assert.equal(reply.status, 200, reply.raw);
    assert.equal(reply.json.data.review.reply.text, 'Thank you, Asha!');
    const foreign = await call(server, 'POST', `${H}/partner/reviews/${R1._id}/reply`, { token: TQ, body: { text: 'hi' } });
    assert.equal(foreign.status, 404, foreign.raw);
    assert.equal((await call(server, 'GET', `${H}/partner/reviews?propertyId=${prop._id}`, { token: TQ })).status, 404);
});

await check('admin moderation: rejecting a review recomputes the rating and hides it', async () => {
    const res = await call(server, 'PUT', `${H}/admin/reviews/${R2._id}/status`, { token: adminToken, body: { status: 'rejected' } });
    assert.equal(res.status, 200, res.raw);
    const p = await M.HotelProperty.findById(prop._id).lean();
    assert.equal(p.avgRating, 4);
    assert.equal(p.totalReviews, 1);
    const pub = await call(server, 'GET', `${H}/public/properties/${prop._id}/reviews`);
    assert.equal(pub.json.data.total, 1);
    const adminList = await call(server, 'GET', `${H}/admin/reviews?status=rejected`, { token: adminToken });
    assert.equal(adminList.json.data.total, 1);
    assert.equal(adminList.json.data.items[0].user.name, 'Asha Verma');
    const back = await call(server, 'PUT', `${H}/admin/reviews/${R2._id}/status`, { token: adminToken, body: { status: 'approved' } });
    assert.equal(back.status, 200);
    assert.equal((await M.HotelProperty.findById(prop._id).lean()).totalReviews, 2);
});

console.log('\n[4] saved');

await check('save, list (PropertyCards of listable only), unsave', async () => {
    const s = await call(server, 'POST', `${H}/user/saved/${prop._id}`, { token: T1 });
    assert.equal(s.status, 200, s.raw);
    assert.deepEqual(s.json.data, { saved: true });
    assert.equal((await call(server, 'POST', `${H}/user/saved/${prop._id}`, { token: T1 })).status, 200, 'idempotent');
    assert.equal((await call(server, 'POST', `${H}/user/saved/${hidden._id}`, { token: T1 })).status, 404);
    await call(server, 'POST', `${H}/user/saved/${qProp._id}`, { token: T1 });
    await M.HotelProperty.updateOne({ _id: qProp._id }, { $set: { isLive: false } });
    const list = await call(server, 'GET', `${H}/user/saved`, { token: T1 });
    assert.equal(list.status, 200, list.raw);
    assert.equal(list.json.data.length, 1);
    const card = list.json.data[0];
    assert.equal(card.name, 'Lakeview Inn');
    assert.equal(card.startingPrice, 2000);
    assert.equal(card.originalPrice, 2500);
    assert.deepEqual(card.address, { area: 'MP Nagar', city: 'Bhopal' });
    const del = await call(server, 'DELETE', `${H}/user/saved/${prop._id}`, { token: T1 });
    assert.deepEqual(del.json.data, { saved: false });
    assert.equal((await call(server, 'GET', `${H}/user/saved`, { token: T1 })).json.data.length, 0);
    assert.equal((await call(server, 'GET', `${H}/user/saved`, { token: TP })).status, 403);
});

console.log('\n[5] voucher');

await check('owner gets printable HTML (header token), with no commission or payout', async () => {
    const res = await call(server, 'GET', `${H}/user/bookings/${B3._id}/voucher`, { token: T1 });
    assert.equal(res.status, 200, res.raw.slice(0, 200));
    assert.match(res.headers['content-type'], /text\/html/);
    assert.ok(res.raw.includes(B3.bookingRef));
    assert.ok(res.raw.includes('#0B2A6F') && res.raw.includes('#FF7A00'));
    assert.ok(res.raw.includes('Lakeview Inn'));
    assert.ok(res.raw.includes('Pay at the hotel'), 'amount due at the hotel shown');
    assert.ok(!/commission|payout/i.test(res.raw), 'no commission/payout');
    assert.ok(!res.raw.includes('236'), 'commission figure absent');
    assert.match(res.headers['content-security-policy'], /script-src 'nonce-/);
});

await check('?token= works; another user 404; partner 403; none 401; bad token 401', async () => {
    const q = await call(server, 'GET', `${H}/user/bookings/${B1._id}/voucher?token=${encodeURIComponent(T1)}`);
    assert.equal(q.status, 200);
    assert.equal((await call(server, 'GET', `${H}/user/bookings/${B1._id}/voucher`, { token: T2 })).status, 404);
    assert.equal((await call(server, 'GET', `${H}/user/bookings/${B1._id}/voucher`, { token: TP })).status, 403);
    assert.equal((await call(server, 'GET', `${H}/user/bookings/${B1._id}/voucher`)).status, 401);
    assert.equal((await call(server, 'GET', `${H}/user/bookings/${B1._id}/voucher?token=nope`)).status, 401);
});

console.log('\n[6] dashboard');

const B8 = await makeBooking({ mode: 'pay_at_hotel', status: 'confirmed', checkIn: today, checkOut: d(1), amountDue: TOTAL });
const B9 = await makeBooking({ mode: 'online', status: 'checked_in', checkIn: d(-2), checkOut: today });
await makeBooking({ mode: 'online', status: 'awaiting_payment', checkIn: d(3), checkOut: d(4), payStatus: 'pending', amountPaid: 0 });
const monthFirst = `${today.slice(0, 7)}-01`;
await M.HotelInventoryDay.create([
    { propertyId: prop._id, roomTypeId, date: night(monthFirst), capacity: 4, booked: 3 },
    { propertyId: prop._id, roomTypeId, date: night(dates.addDays(monthFirst, 1)), capacity: 4, booked: 1 },
]);

await check('dashboard: arrivals, departures, upcoming, revenue, occupancy, recent', async () => {
    const res = await call(server, 'GET', `${H}/partner/dashboard`, { token: TP });
    assert.equal(res.status, 200, res.raw);
    const x = res.json.data;
    assert.deepEqual(x.properties, { total: 2, live: 1, pending: 0 });
    assert.equal(x.todayArrivals, 1); // B8
    assert.equal(x.todayDepartures, 1); // B9
    assert.equal(x.upcomingBookings, 2); // B7, B8
    const inMonth = bookings.filter((b) => ['confirmed', 'checked_in', 'checked_out'].includes(b.status)
        && dates.toDateString(b.checkIn).slice(0, 7) === today.slice(0, 7));
    // B5/B6 were cancelled after creation (their in-memory status is stale).
    const live = [];
    for (const b of inMonth) {
        const fresh = await M.HotelBooking.findById(b._id).lean();
        if (['confirmed', 'checked_in', 'checked_out'].includes(fresh.status)) live.push(b);
    }
    assert.equal(x.revenueThisMonth, r2(live.length * 2100));
    assert.equal(x.occupancyThisMonth, 0.5);
    assert.equal(x.recentBookings.length, 5);
    assert.ok(x.recentBookings.every((b) => b.status !== 'awaiting_payment'));
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(x.recentBookings[0].checkIn));
    assert.equal(x.recentBookings[0].bookingRef, B9.bookingRef);
    assert.equal(x.recentBookings[0].pricing.commissionAmount, 200, 'partner view keeps commission');
});

console.log('\n[7] notifications and reminders');

await check('confirmation: guest inbox (vertical hotel) + push, partner push to its own tokens, email', async () => {
    pushes.length = 0;
    const b = await makeBooking({ user: U2, mode: 'online', status: 'confirmed', checkIn: d(10), checkOut: d(12) });
    transition(b, null, 'confirmed', { role: 'user', id: String(U2._id) });
    const inbox = await waitFor(() => M.FoodNotification.findOne({ ownerId: U2._id, vertical: 'hotel' }).lean());
    assert.ok(inbox, 'inbox row filed');
    assert.equal(inbox.source, 'BOOKING');
    assert.equal(inbox.title, 'Booking confirmed');
    await waitFor(async () => pushes.length >= 3);
    assert.ok(pushes.some((p) => p.target?.ownerType === 'USER' && p.payload.skipInbox === true));
    assert.ok(pushes.some((p) => p.tokens?.includes('tok-web-1') && p.payload.title === 'New booking'));
    assert.ok(pushes.some((p) => p.email === 'guest@example.com'));
});

await check('runHotelReminders: check-in reminder ~5h before, review request after check-out, once each', async () => {
    const b10 = await makeBooking({ mode: 'online', status: 'confirmed', checkIn: today, checkOut: d(1) });
    await M.HotelBooking.updateOne({ _id: b10._id }, { $set: { 'snapshot.checkInTime': '14:00' } });
    const now = new Date(night(today).getTime() + 13 * 3600 * 1000); // 13:00 IST today
    const first = await notif.runHotelReminders(now);
    assert.equal(first.checkInReminders, 1, JSON.stringify(first));
    // checked_out without a review: B2, B3 (B1 and B4 were reviewed).
    assert.equal(first.reviewRequests, 2, JSON.stringify(first));
    assert.equal((await M.HotelBooking.findById(b10._id).lean()).notificationsSent.checkInReminder, true);
    assert.equal((await M.HotelBooking.findById(B2._id).lean()).notificationsSent.reviewRequest, true);
    assert.equal((await M.HotelBooking.findById(B1._id).lean()).notificationsSent.reviewRequest, false);
    const again = await notif.runHotelReminders(now);
    assert.deepEqual(again, { checkInReminders: 0, reviewRequests: 0 });
    const early = await makeBooking({ mode: 'online', status: 'confirmed', checkIn: today, checkOut: d(1) });
    await M.HotelBooking.updateOne({ _id: early._id }, { $set: { 'snapshot.checkInTime': '23:00' } });
    assert.equal((await notif.runHotelReminders(now)).checkInReminders, 0, '10h ahead is too early');
});

console.log('\n[8] cross-vertical lists and finance');

await check('My orders lists hotel stays (no unpaid holds)', async () => {
    const { listMyOrders } = await import('../src/core/orders/myOrders.service.js');
    const r = await listMyOrders(String(U1._id), { service: 'hotel', limit: 50 });
    assert.ok(r.items.length > 0);
    assert.ok(r.items.every((i) => i.service === 'hotel' && i.route.startsWith('/hotel/bookings/')));
    const hold = bookings.find((b) => b.status === 'awaiting_payment');
    assert.ok(hold && !r.items.some((i) => i.number === hold.bookingRef));
    const b1 = r.items.find((i) => i.number === B1.bookingRef);
    assert.equal(b1.state, 'completed');
    assert.equal(b1.title, 'Lakeview Inn');
});

await check('Master orders has a hotel tab and refuses to delete a stay', async () => {
    const { listMasterOrders, deleteMasterOrder } = await import('../src/core/orders/masterOrders.service.js');
    const r = await listMasterOrders({ tab: 'hotel', limit: 100 });
    assert.ok(r.counts.hotel > 0);
    assert.ok(r.orders.every((o) => o.source === 'hotel'));
    // Search is a case-insensitive substring of the booking ref (KSGHTEST1 also matches KSGHTEST1x).
    const s = await listMasterOrders({ tab: 'hotel', search: B1.bookingRef.toLowerCase() });
    assert.ok(s.orders.every((o) => o.orderId.startsWith(B1.bookingRef)));
    const row = s.orders.find((o) => o.orderId === B1.bookingRef);
    assert.ok(row);
    assert.equal(row.customerName, 'Asha Verma');
    assert.equal(row.storeName, 'Lakeview Inn');
    await assert.rejects(() => deleteMasterOrder({ source: 'hotel', id: String(B1._id) }), /cannot be deleted/);
});

await check('platform P&L and commission overview include hotels', async () => {
    const { platformPnl } = await import('../src/core/finance/platformPnl.service.js');
    const { commissionOverview } = await import('../src/core/finance/commissionOverview.service.js');
    const owner = { _id: oid(), role: 'ADMIN', adminLevel: 'platform_superadmin' };
    const pnl = await platformPnl(owner, { from: d(-30), to: today });
    const hotel = pnl.services.find((s) => s.key === 'hotel');
    assert.ok(hotel, 'hotel in P&L');
    const checkedOut = await M.HotelBooking.countDocuments({ status: 'checked_out' });
    assert.equal(hotel.count, checkedOut);
    assert.equal(hotel.net, r2(checkedOut * 220));
    const co = await commissionOverview(owner);
    const h = co.services.find((s) => s.key === 'hotel');
    assert.ok(h, 'hotel in commission overview');
    assert.equal(h.rate.value, 10);
    assert.ok(h.rows.some((r) => r.name === 'Lake Hotels' && r.last30.orders === checkedOut));
});

await check('activity feed maps hotel statuses', async () => {
    const { normaliseStatus, ACTIVITY_STATUS } = await import('../src/core/activity/activity.service.js');
    assert.equal(normaliseStatus('hotel', 'checked_out'), ACTIVITY_STATUS.COMPLETED);
    assert.equal(normaliseStatus('hotel', 'no_show'), ACTIVITY_STATUS.CANCELLED);
    assert.equal(normaliseStatus('hotel', 'awaiting_payment'), ACTIVITY_STATUS.PENDING);
});

server.close();
await mongoose.disconnect();
await replSet.stop();

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall hotel money checks passed');
process.exit(failures ? 1 : 0);
