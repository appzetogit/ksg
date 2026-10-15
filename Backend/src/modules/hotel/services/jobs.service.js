// Hotel background jobs not tied to a booking event (HOTEL_INTEGRATION_PLAN.md §4.6):
//
//   runPaymentExpiryWarnings   every 2 min   guest push ~10 min before an unpaid hold lapses
//   runNoShowSweep             hourly tick   partner push once a confirmed stay's check-in
//                                            day is over and nobody marked arrival / no-show
//   runMonthlyPartnerSummaries hourly tick   on the 1st-3rd (IST): last month's stays,
//                                            revenue, commission and payout, push + email
//
// server.js schedules them (gated on the hotel module, cleared on shutdown). There is
// no lock: every send is claimed first by a conditional write (a booking flag, or the
// partner's monthlySummaryFor), so overlapping runs or a second instance send once.
// Nothing here changes a booking's status: the no-show sweep only asks the partner.

import { logger } from '../../../utils/logger.js';
import { HotelBooking } from '../models/hotelBooking.model.js';
import { HotelPartner } from '../models/hotelPartner.model.js';
import { notifyGuest, pushToPartner, sendEmail, esc } from './notifications.listener.js';
import { addDays, todayIST, toNightDate, IST_OFFSET_MS } from './dates.js';

const MINUTE = 60 * 1000;
const r2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const rupees = (n) => `Rs ${r2(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const istHour = (now) => new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();

// ─── payment-expiry warning ──────────────────────────────────────────────

export const PAYMENT_WARNING_MINUTES = 10;
// A hold that only just started (short holds of 5-10 min) gets no warning: the guest
// is still on the payment screen.
const MIN_HOLD_AGE_MS = 2 * MINUTE;
// Under a minute left, a push arrives after the rooms are gone.
const MIN_LEFT_MS = 1 * MINUTE;

/**
 * Guest push for awaiting_payment bookings whose payment.expiresAt is within the next
 * PAYMENT_WARNING_MINUTES. Claimed with notificationsSent.paymentExpiryWarning.
 */
export const runPaymentExpiryWarnings = async (now = new Date()) => {
    const t = now.getTime();
    const due = await HotelBooking.find({
        status: 'awaiting_payment',
        'notificationsSent.paymentExpiryWarning': { $ne: true },
        'payment.expiresAt': { $gt: new Date(t + MIN_LEFT_MS), $lte: new Date(t + PAYMENT_WARNING_MINUTES * MINUTE) },
        createdAt: { $lte: new Date(t - MIN_HOLD_AGE_MS) },
    }).limit(500).lean();

    let warned = 0;
    for (const b of due) {
        const claim = await HotelBooking.updateOne(
            { _id: b._id, status: 'awaiting_payment', 'notificationsSent.paymentExpiryWarning': { $ne: true } },
            { $set: { 'notificationsSent.paymentExpiryWarning': true } },
        );
        if (claim.modifiedCount !== 1) continue;
        warned += 1;
        const mins = Math.max(1, Math.round((new Date(b.payment.expiresAt).getTime() - t) / MINUTE));
        await notifyGuest(b, {
            type: 'hotel_payment_expiring',
            title: 'Complete your payment',
            body: `${b.snapshot?.propertyName || 'Your stay'} is held for ${mins} more min. Pay now to keep the room (${b.bookingRef}).`,
        });
    }
    if (warned) logger.info(`[hotel] payment-expiry warnings sent: ${warned}`);
    return { warned };
};

// ─── no-show sweep ───────────────────────────────────────────────────────

// Prompts go out from 03:00 IST on the day after check-in (plan §4.6: daily 03:00 IST).
export const NO_SHOW_SWEEP_HOUR_IST = 3;
// Older stays are left alone, so switching the job on does not page partners about
// bookings from months ago.
const NO_SHOW_LOOKBACK_DAYS = 7;

/**
 * Confirmed bookings whose check-in date is over (before today, IST) and that are
 * still 'confirmed': the partner never marked the guest checked in or no-show. One
 * push per partner listing them; each booking is flagged notificationsSent.noShowPrompt
 * so it is asked about once. The booking is NOT changed: only the partner knows.
 */
export const runNoShowSweep = async (now = new Date(), { ignoreHour = false } = {}) => {
    if (!ignoreHour && istHour(now) < NO_SHOW_SWEEP_HOUR_IST) return { prompted: 0, partners: 0, skipped: 'before_hour' };
    const today = todayIST(now);
    const candidates = await HotelBooking.find({
        status: 'confirmed',
        'notificationsSent.noShowPrompt': { $ne: true },
        checkIn: { $gte: toNightDate(addDays(today, -NO_SHOW_LOOKBACK_DAYS)), $lt: toNightDate(today) },
    }).select('_id partnerId bookingRef guestDetails.name snapshot.propertyName checkIn').limit(1000).lean();

    const byPartner = new Map();
    for (const b of candidates) {
        const claim = await HotelBooking.updateOne(
            { _id: b._id, status: 'confirmed', 'notificationsSent.noShowPrompt': { $ne: true } },
            { $set: { 'notificationsSent.noShowPrompt': true } },
        );
        if (claim.modifiedCount !== 1) continue;
        const key = String(b.partnerId);
        if (!byPartner.has(key)) byPartner.set(key, []);
        byPartner.get(key).push(b);
    }

    for (const [partnerId, list] of byPartner) {
        const refs = list.map((b) => b.bookingRef).filter(Boolean);
        const one = list.length === 1 ? list[0] : null;
        await pushToPartner(partnerId, {
            type: 'hotel_mark_arrival',
            title: one ? 'Did the guest arrive?' : `${list.length} stays need an update`,
            body: one
                ? `${one.guestDetails?.name || 'The guest'} (${one.bookingRef}) at ${one.snapshot?.propertyName || 'your property'}: mark checked in or no-show.`
                : `Mark checked in or no-show for ${refs.slice(0, 5).join(', ')}${refs.length > 5 ? ` and ${refs.length - 5} more` : ''}.`,
            data: {
                bookingIds: list.map((b) => String(b._id)).join(','),
                link: one ? `/hotel/partner/bookings/${one._id}` : '/hotel/partner/bookings?status=confirmed',
                ...(one ? { bookingId: String(one._id), bookingRef: String(one.bookingRef || '') } : {}),
            },
        }, 'no-show sweep');
    }
    const prompted = [...byPartner.values()].reduce((n, l) => n + l.length, 0);
    if (prompted) logger.info(`[hotel] no-show prompts: ${prompted} booking(s), ${byPartner.size} partner(s)`);
    return { prompted, partners: byPartner.size };
};

// ─── monthly partner summary ─────────────────────────────────────────────

// The 1st, with two catch-up days in case the server was down on the 1st.
const SUMMARY_LAST_DAY = 3;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 'YYYY-MM' of the month before the IST month of `now`, and its [from, to) bounds. */
export const previousMonthIST = (now = new Date()) => {
    const today = todayIST(now);
    const [y, m] = today.split('-').map(Number);
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    const month = `${py}-${String(pm).padStart(2, '0')}`;
    return {
        month,
        label: `${MONTH_NAMES[pm - 1]} ${py}`,
        from: toNightDate(`${month}-01`),
        to: toNightDate(`${today.slice(0, 7)}-01`),
    };
};

/** Last month's figures per partner: stays checked out in that month (IST). */
export const monthlyPartnerFigures = async ({ from, to }, partnerIds = null) => {
    const match = { status: 'checked_out', checkOut: { $gte: from, $lt: to } };
    if (partnerIds) match.partnerId = { $in: partnerIds };
    const rows = await HotelBooking.aggregate([
        { $match: match },
        {
            $group: {
                _id: '$partnerId',
                stays: { $sum: 1 },
                nights: { $sum: { $multiply: ['$nights', { $ifNull: ['$rooms', 1] }] } },
                revenue: { $sum: { $ifNull: ['$pricing.total', 0] } },
                commission: { $sum: { $add: [{ $ifNull: ['$pricing.commissionAmount', 0] }, { $ifNull: ['$pricing.commissionGst', 0] }] } },
                payout: { $sum: { $ifNull: ['$pricing.partnerPayout', 0] } },
            },
        },
    ]);
    return new Map(rows.map((r) => [String(r._id), {
        stays: r.stays, roomNights: r.nights, revenue: r2(r.revenue), commission: r2(r.commission), payout: r2(r.payout),
    }]));
};

const summaryEmail = (partner, label, f) => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0f172a">
<div style="background:#0B2A6F;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><b style="font-size:18px">KSG Stays</b>
<span style="float:right;color:#FF7A00;font-weight:bold">${esc(label)} summary</span></div>
<div style="border:1px solid #e2e8f0;border-top:0;padding:20px;border-radius:0 0 10px 10px">
<p>Hi ${esc(partner.name || 'there')}, here is how ${esc(label)} went.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
<tr><td style="padding:6px 0">Completed stays</td><td style="text-align:right"><b>${esc(f.stays)}</b> (${esc(f.roomNights)} room-nights)</td></tr>
<tr><td style="padding:6px 0">Booking value</td><td style="text-align:right"><b>${esc(rupees(f.revenue))}</b></td></tr>
<tr><td style="padding:6px 0">Commission (incl. GST)</td><td style="text-align:right">${esc(rupees(f.commission))}</td></tr>
<tr><td style="padding:6px 0;border-top:1px solid #e2e8f0">Your payout</td><td style="text-align:right;border-top:1px solid #e2e8f0"><b>${esc(rupees(f.payout))}</b></td></tr>
</table>
<p style="color:#64748b;font-size:12px">Earnings and withdrawals are in the KSG Hotel partner app.</p></div></div>`;

/**
 * On the 1st-3rd of a month (IST), every approved partner with completed stays last
 * month gets one push + one email (when they have an email; without SMTP the email
 * is skipped quietly). Claimed per partner+month by HotelPartner.monthlySummaryFor.
 */
export const runMonthlyPartnerSummaries = async (now = new Date(), { ignoreDay = false } = {}) => {
    const day = Number(todayIST(now).slice(8, 10));
    if (!ignoreDay && day > SUMMARY_LAST_DAY) return { sent: 0, skipped: 'not_month_start' };
    const period = previousMonthIST(now);
    const figures = await monthlyPartnerFigures(period);
    if (!figures.size) return { sent: 0, month: period.month };

    let sent = 0;
    let emailed = 0;
    for (const [partnerId, f] of figures) {
        const claim = await HotelPartner.findOneAndUpdate(
            { _id: partnerId, status: 'approved', isDeleted: { $ne: true }, monthlySummaryFor: { $ne: period.month } },
            { $set: { monthlySummaryFor: period.month } },
            { new: true },
        ).select('name email').lean();
        if (!claim) continue;
        sent += 1;
        await pushToPartner(partnerId, {
            type: 'hotel_monthly_summary',
            title: `${period.label}: ${rupees(f.payout)} earned`,
            body: `${f.stays} stay(s), ${rupees(f.revenue)} booked, ${rupees(f.commission)} commission.`,
            data: { month: period.month, link: '/hotel/partner/earnings' },
        }, `summary ${period.month}`);
        if (claim.email) {
            const ok = await sendEmail({
                to: claim.email,
                subject: `Your KSG Stays summary for ${period.label}`,
                html: summaryEmail(claim, period.label, f),
                fromName: 'KSG Stays',
                type: 'hotel_monthly_summary',
            });
            if (ok) emailed += 1;
        }
    }
    if (sent) logger.info(`[hotel] monthly summaries for ${period.month}: ${sent} partner(s), ${emailed} email(s)`);
    return { sent, emailed, month: period.month };
};

/** The hourly tick server.js runs: no-show sweep, then the monthly summary. */
export const runHotelHourlyJobs = async (now = new Date()) => {
    const noShow = await runNoShowSweep(now);
    const summary = await runMonthlyPartnerSummaries(now);
    return { noShow, summary };
};
