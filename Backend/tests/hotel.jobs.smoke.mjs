// Hotel phase 9: the background jobs in services/jobs.service.js (HOTEL_INTEGRATION_PLAN.md §4.6)
//   - payment-expiry warning ~10 min before an unpaid hold lapses
//   - no-show sweep: partner asked to mark arrival / no-show once check-in day is over
//   - monthly partner summary (push + email), once per partner per month
//
// Runs against an in-memory single-node REPLICA SET like the other hotel tests. The
// jobs are called directly with a chosen `now`; pushes and emails go to recorders.
//
// Run: node tests/hotel.jobs.smoke.mjs

import assert from 'node:assert/strict';
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

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
process.env.MONGO_URI = replSet.getUri();
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-0123456789-0123456789-0123456789';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-0123456789-0123456789-0123456789';

await mongoose.connect(process.env.MONGO_URI);
// Only the models the jobs touch (not the whole app: importing src/app.js costs minutes
// on a busy machine and nothing here goes through HTTP).
await import('../src/core/users/user.model.js');
await import('../src/core/notifications/models/notification.model.js');

const { HOTEL_MODEL_NAMES } = await import('../src/modules/hotel/models/index.js');
const dates = await import('../src/modules/hotel/services/dates.js');
const notif = await import('../src/modules/hotel/services/notifications.listener.js');
const jobs = await import('../src/modules/hotel/services/jobs.service.js');
const M = mongoose.models;
await Promise.all(HOTEL_MODEL_NAMES.map((n) => M[n].syncIndexes()));

const pushes = [];
const emails = [];
const recorders = {
    push: async (target, payload) => { pushes.push({ target, payload }); return { successCount: 1 }; },
    pushTokens: async (tokens, payload) => { pushes.push({ tokens, payload }); return { successCount: tokens.length }; },
    email: async (mail) => { emails.push(mail); return true; },
};
notif.__setSenders(recorders);
const reset = () => { pushes.length = 0; emails.length = 0; };
const ofType = (type) => pushes.filter((p) => p.payload?.data?.type === type);

const MIN = 60 * 1000;
const now = new Date();
const today = dates.todayIST(now);
const d = (n) => dates.addDays(today, n);
const night = (s) => dates.toNightDate(s);
const oid = () => new mongoose.Types.ObjectId();

// ─── fixtures ─────────────────────────────────────────────────────────────

const U = await M.FoodUser.create({ phone: '9811100091', name: 'Asha Verma', isActive: true });
const P1 = await M.HotelPartner.create({
    phone: '9422200091', name: 'Lake Hotels', email: 'lake@example.com', status: 'approved', fcmTokens: { web: ['tok-p1'], app: [] },
});
const P2 = await M.HotelPartner.create({ phone: '9422200092', name: 'Hill Hotels', status: 'approved', fcmTokens: { web: [], app: ['tok-p2'] } });
const P3 = await M.HotelPartner.create({ phone: '9422200093', name: 'Blocked Hotels', email: 'blocked@example.com', status: 'blocked', fcmTokens: { web: ['tok-p3'] } });
const P4 = await M.HotelPartner.create({ phone: '9422200094', name: 'Quiet Hotels', email: 'quiet@example.com', status: 'approved', fcmTokens: { web: ['tok-p4'] } });

const point = { type: 'Point', coordinates: [77.4126, 23.2599] };
const mkProp = (partner, name) => M.HotelProperty.create({
    partnerId: partner._id, name, slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${partner.phone}`, propertyType: 'hotel',
    address: { city: 'Bhopal' }, location: point, coverImage: 'https://placehold.co/1.jpg', status: 'approved', isLive: true, startingPrice: 2000,
});
const props = new Map();
for (const p of [P1, P2, P3, P4]) props.set(String(p._id), await mkProp(p, `${p.name} Inn`));

const PRICING = {
    roomCharges: 2000, extraGuestCharges: 0, subtotal: 2000, couponDiscount: 0, prepaidDiscount: 0,
    taxableAmount: 2000, gstRate: 5, gstAmount: 100, platformFee: 20, platformFeeGst: 3.6, total: 2123.6,
    commissionRate: 10, commissionAmount: 200, commissionGst: 36, partnerPayout: 1864,
};

let refN = 0;
const makeBooking = async ({ partner = P1, status = 'confirmed', checkIn = d(-1), checkOut = d(1), mode = 'online', payment = {}, createdAt } = {}) => {
    refN += 1;
    const property = props.get(String(partner._id));
    const b = await M.HotelBooking.create({
        bookingRef: `KSGHJOB${refN}`,
        userId: U._id, propertyId: property._id, partnerId: partner._id, roomTypeId: oid(),
        snapshot: { propertyName: property.name, roomTypeName: 'Deluxe Room', checkInTime: '12:00', checkOutTime: '11:00' },
        checkIn: night(checkIn), checkOut: night(checkOut), nights: dates.daysBetween(checkIn, checkOut), rooms: 1,
        guests: { adults: 2 }, guestDetails: { name: 'Asha Verma', phone: U.phone, email: 'guest@example.com' },
        pricing: PRICING,
        payment: { mode, status: status === 'awaiting_payment' ? 'pending' : 'paid', amountPaid: 0, ...payment },
        status,
        statusHistory: [{ status, by: { role: 'system' } }],
    });
    // timestamps would stamp "now"; the warning job looks at how old the hold is.
    if (createdAt) await M.HotelBooking.collection.updateOne({ _id: b._id }, { $set: { createdAt } });
    return b;
};
const flags = async (b) => (await M.HotelBooking.findById(b._id).lean()).notificationsSent || {};

// ─── [1] payment-expiry warning ──────────────────────────────────────────

console.log('\n[1] payment-expiry warning');

const at = (ms) => new Date(now.getTime() + ms);
const W = await makeBooking({ status: 'awaiting_payment', payment: { expiresAt: at(8 * MIN) }, createdAt: at(-22 * MIN) });
const fresh = await makeBooking({ status: 'awaiting_payment', payment: { expiresAt: at(8 * MIN) }, createdAt: at(-30 * 1000) });
const far = await makeBooking({ status: 'awaiting_payment', payment: { expiresAt: at(25 * MIN) }, createdAt: at(-5 * MIN) });
const late = await makeBooking({ status: 'awaiting_payment', payment: { expiresAt: at(30 * 1000) }, createdAt: at(-29 * MIN) });
const paid = await makeBooking({ status: 'confirmed', payment: { expiresAt: at(8 * MIN) }, createdAt: at(-22 * MIN) });

await check('warns the guest of a hold lapsing within 10 min, once, even when two runs overlap', async () => {
    reset();
    const [a, b] = await Promise.all([jobs.runPaymentExpiryWarnings(now), jobs.runPaymentExpiryWarnings(now)]);
    assert.equal(a.warned + b.warned, 1);
    const sent = ofType('hotel_payment_expiring');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].target.ownerId, String(U._id));
    assert.equal(sent[0].payload.data.bookingId, String(W._id));
    assert.match(sent[0].payload.body, /8 more min/);
    assert.equal((await flags(W)).paymentExpiryWarning, true);
    assert.equal((await jobs.runPaymentExpiryWarnings(now)).warned, 0);
});

await check('no warning for a hold just started, far from expiry, about to lapse, or already paid', async () => {
    for (const b of [fresh, far, late, paid]) assert.notEqual((await flags(b)).paymentExpiryWarning, true, b.bookingRef);
});

await check('the hold that was too far out is warned once it gets close', async () => {
    reset();
    const r = await jobs.runPaymentExpiryWarnings(at(17 * MIN));
    assert.equal(r.warned, 1);
    assert.equal(ofType('hotel_payment_expiring')[0].payload.data.bookingId, String(far._id));
});

await check('the warning lands in the customer inbox (vertical hotel)', async () => {
    const rows = await M.FoodNotification.find({ vertical: 'hotel', title: 'Complete your payment' }).lean();
    assert.equal(rows.length, 2); // W, then `far` in the previous check: one row each
});

// ─── [2] no-show sweep ───────────────────────────────────────────────────

console.log('\n[2] no-show sweep');

await M.HotelBooking.deleteMany({});
const ns1 = await makeBooking({ partner: P1, checkIn: d(-1), checkOut: d(1) });
const ns2 = await makeBooking({ partner: P1, checkIn: d(-2), checkOut: d(0) });
const ns3 = await makeBooking({ partner: P2, checkIn: d(-1), checkOut: d(2) });
const arrivingToday = await makeBooking({ partner: P1, checkIn: d(0), checkOut: d(2) });
const alreadyIn = await makeBooking({ partner: P1, status: 'checked_in', checkIn: d(-1), checkOut: d(1) });
const ancient = await makeBooking({ partner: P1, checkIn: d(-20), checkOut: d(-18) });
const sweepAt = new Date(`${today}T04:00:00+05:30`);

await check('does nothing before 03:00 IST', async () => {
    reset();
    const r = await jobs.runNoShowSweep(new Date(`${today}T01:30:00+05:30`));
    assert.equal(r.prompted, 0);
    assert.equal(r.skipped, 'before_hour');
    assert.equal(pushes.length, 0);
});

await check('asks each partner once about stays whose check-in day is over; one push per partner', async () => {
    reset();
    const [a, b] = await Promise.all([jobs.runNoShowSweep(sweepAt), jobs.runNoShowSweep(sweepAt)]);
    assert.equal(a.prompted + b.prompted, 3);
    const sent = ofType('hotel_mark_arrival');
    assert.equal(sent.length >= 2 && sent.length <= 3, true, `pushes: ${sent.length}`);
    const toP2 = sent.filter((p) => p.tokens.includes('tok-p2'));
    assert.equal(toP2.length, 1);
    assert.equal(toP2[0].payload.title, 'Did the guest arrive?');
    assert.equal(toP2[0].payload.data.bookingId, String(ns3._id));
    const toP1Ids = sent.filter((p) => p.tokens.includes('tok-p1')).flatMap((p) => p.payload.data.bookingIds.split(','));
    assert.deepEqual(toP1Ids.sort(), [String(ns1._id), String(ns2._id)].sort());
});

await check('when one run sees both of a partner\'s stays, the push lists them together', async () => {
    await M.HotelBooking.updateMany({ _id: { $in: [ns1._id, ns2._id] } }, { $set: { 'notificationsSent.noShowPrompt': false } });
    reset();
    await jobs.runNoShowSweep(sweepAt);
    const sent = ofType('hotel_mark_arrival');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].payload.title, '2 stays need an update');
    assert.match(sent[0].payload.body, new RegExp(ns1.bookingRef));
});

await check('never changes the booking: still confirmed, only flagged', async () => {
    for (const b of [ns1, ns2, ns3]) {
        const row = await M.HotelBooking.findById(b._id).lean();
        assert.equal(row.status, 'confirmed');
        assert.equal(row.notificationsSent.noShowPrompt, true);
    }
});

await check('skips stays arriving today, already checked in, or older than the look-back', async () => {
    for (const b of [arrivingToday, alreadyIn, ancient]) assert.notEqual((await flags(b)).noShowPrompt, true, b.bookingRef);
    reset();
    assert.equal((await jobs.runNoShowSweep(sweepAt)).prompted, 0);
    assert.equal(pushes.length, 0);
});

// ─── [3] monthly partner summary ─────────────────────────────────────────

console.log('\n[3] monthly partner summary');

await check('previous month is computed in IST, across the year boundary', () => {
    assert.equal(jobs.previousMonthIST(new Date('2027-01-01T10:00:00+05:30')).month, '2026-12');
    // 19:00 UTC on 31 Oct is 00:30 IST on 1 Nov.
    const p = jobs.previousMonthIST(new Date('2026-10-31T19:00:00Z'));
    assert.equal(p.month, '2026-10');
    assert.equal(p.label, 'October 2026');
    assert.equal(p.from.toISOString(), night('2026-10-01').toISOString());
    assert.equal(p.to.toISOString(), night('2026-11-01').toISOString());
});

await M.HotelBooking.deleteMany({});
await makeBooking({ partner: P1, status: 'checked_out', checkIn: '2026-10-03', checkOut: '2026-10-05' });
await makeBooking({ partner: P1, status: 'checked_out', checkIn: '2026-10-30', checkOut: '2026-10-31' });
await makeBooking({ partner: P1, status: 'checked_out', checkIn: '2026-10-30', checkOut: '2026-11-01' }); // November
await makeBooking({ partner: P1, status: 'checked_out', checkIn: '2026-09-28', checkOut: '2026-09-30' }); // September
await makeBooking({ partner: P1, status: 'cancelled', checkIn: '2026-10-10', checkOut: '2026-10-12' });
await makeBooking({ partner: P2, status: 'checked_out', checkIn: '2026-10-15', checkOut: '2026-10-16' });
await makeBooking({ partner: P3, status: 'checked_out', checkIn: '2026-10-15', checkOut: '2026-10-16' }); // blocked partner
const monthStart = new Date('2026-11-01T06:00:00+05:30');

await check('figures: only stays checked out within the month count', async () => {
    const figs = await jobs.monthlyPartnerFigures(jobs.previousMonthIST(monthStart));
    const f = figs.get(String(P1._id));
    assert.equal(f.stays, 2);
    assert.equal(f.roomNights, 3);
    assert.equal(f.revenue, 4247.2);
    assert.equal(f.commission, 472);
    assert.equal(f.payout, 3728);
    assert.ok(!figs.has(String(P4._id)), 'a partner without stays has no row');
});

await check('not sent after the 3rd of the month', async () => {
    reset();
    const r = await jobs.runMonthlyPartnerSummaries(new Date('2026-11-04T06:00:00+05:30'));
    assert.equal(r.sent, 0);
    assert.equal(r.skipped, 'not_month_start');
    assert.equal(pushes.length + emails.length, 0);
});

await check('on the 1st: push + email to approved partners with stays, once each even across overlapping runs', async () => {
    reset();
    const [a, b] = await Promise.all([jobs.runMonthlyPartnerSummaries(monthStart), jobs.runMonthlyPartnerSummaries(monthStart)]);
    assert.equal(a.sent + b.sent, 2);
    const sent = ofType('hotel_monthly_summary');
    assert.equal(sent.length, 2);
    const p1 = sent.find((p) => p.tokens.includes('tok-p1'));
    assert.equal(p1.payload.title, 'October 2026: Rs 3,728 earned');
    assert.match(p1.payload.body, /2 stay\(s\)/);
    assert.equal(p1.payload.data.month, '2026-10');
    assert.ok(sent.some((p) => p.tokens.includes('tok-p2')));
    assert.ok(!sent.some((p) => p.tokens.includes('tok-p3')), 'blocked partner skipped');
    assert.ok(!sent.some((p) => p.tokens.includes('tok-p4')), 'partner without stays skipped');
    // Only P1 has an email.
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to, 'lake@example.com');
    assert.match(emails[0].subject, /October 2026/);
    assert.match(emails[0].html, /3,728/);
    assert.match(emails[0].html, /472/);
});

await check('the marker makes it once per partner per month', async () => {
    assert.equal((await M.HotelPartner.findById(P1._id).lean()).monthlySummaryFor, '2026-10');
    reset();
    assert.equal((await jobs.runMonthlyPartnerSummaries(new Date('2026-11-02T06:00:00+05:30'))).sent, 0);
    assert.equal(pushes.length + emails.length, 0);
});

await check('the marker is not part of what a partner sees about themselves', async () => {
    const doc = await M.HotelPartner.findById(P1._id);
    assert.equal('monthlySummaryFor' in doc.toPartnerJSON(), false);
});

await check('without SMTP the email is skipped quietly and the push still goes', async () => {
    const { sendHtmlEmail } = await import('../src/services/email.service.js');
    notif.__setSenders({ email: sendHtmlEmail });
    try {
        await M.HotelPartner.updateOne({ _id: P1._id }, { $set: { monthlySummaryFor: '' } });
        reset();
        const r = await jobs.runMonthlyPartnerSummaries(monthStart);
        assert.equal(r.sent, 1);
        assert.equal(r.emailed, 0);
        assert.equal(ofType('hotel_monthly_summary').length, 1);
    } finally {
        notif.__setSenders(recorders);
    }
});

await check('the hourly tick runs both and is harmless when repeated', async () => {
    reset();
    const r = await jobs.runHotelHourlyJobs(monthStart);
    assert.equal(r.noShow.prompted, 0);
    assert.equal(r.summary.sent, 0);
});

await mongoose.disconnect();
await replSet.stop();

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall hotel jobs checks passed');
process.exit(failures ? 1 : 0);
