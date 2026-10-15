// Hotel notifications (HOTEL_INTEGRATION_PLAN.md §4.7): booking events -> guest push +
// customer inbox, partner push, confirmation email; and the reminder job.
//
// A LISTENER on services/bookingEvents.js. Every send is best-effort: a missing FCM
// sender, SMTP config or token is logged and skipped, never thrown.

import { logger } from '../../../utils/logger.js';
import { recordCustomerNotification } from '../../../core/notifications/customerInbox.js';
import { HotelBooking } from '../models/hotelBooking.model.js';
import { HotelPartner } from '../models/hotelPartner.model.js';
import { onBookingEvent } from './bookingEvents.js';
import { toDateString, todayIST, addDays, toNightDate } from './dates.js';

const r2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const rupees = (n) => `Rs ${r2(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const nice = (d) => {
    if (!d) return '';
    const s = typeof d === 'string' ? d : toDateString(d);
    return new Date(`${s}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

// Tests and callers can replace the senders (see __setSenders).
const senders = {
    push: async (target, payload) => {
        const { sendNotificationToOwner } = await import('../../../core/notifications/firebase.service.js');
        return sendNotificationToOwner({ ...target, payload });
    },
    pushTokens: async (tokens, payload) => {
        const { sendPushNotification } = await import('../../../core/notifications/firebase.service.js');
        return sendPushNotification(tokens, payload);
    },
    email: async (mail) => {
        const { sendHtmlEmail } = await import('../../../services/email.service.js');
        return sendHtmlEmail(mail);
    },
};
export const sent = []; // last messages, for tests and debugging (bounded)
const remember = (entry) => {
    sent.push({ ...entry, at: new Date() });
    if (sent.length > 200) sent.shift();
};
export const __setSenders = (overrides = {}) => Object.assign(senders, overrides);

/** Guest: inbox (vertical hotel) + push. */
export const notifyGuest = async (booking, { title, body, type }) => {
    if (!booking?.userId) return;
    const data = { type, bookingId: String(booking._id), bookingRef: String(booking.bookingRef || ''), link: `/hotel/bookings/${booking._id}` };
    remember({ to: 'guest', userId: String(booking.userId), title, body, type });
    await recordCustomerNotification({
        vertical: 'hotel', userId: booking.userId, title, message: body, data, source: 'BOOKING', link: data.link,
    });
    try {
        await senders.push({ ownerType: 'USER', ownerId: String(booking.userId) }, { title, body, data, skipInbox: true });
    } catch (err) {
        logger.warn(`[hotel] guest push skipped for ${booking.bookingRef}: ${err.message}`);
    }
};

/** Partner: push to the hotel partner's own device tokens. */
export const notifyPartner = async (booking, { title, body, type }) => {
    if (!booking?.partnerId) return;
    remember({ to: 'partner', partnerId: String(booking.partnerId), title, body, type });
    try {
        const partner = await HotelPartner.findById(booking.partnerId).select('fcmTokens').lean();
        const tokens = [...(partner?.fcmTokens?.web || []), ...(partner?.fcmTokens?.app || [])].filter(Boolean);
        if (!tokens.length) return;
        await senders.pushTokens(tokens, {
            title,
            body,
            data: { type, bookingId: String(booking._id), bookingRef: String(booking.bookingRef || ''), link: `/hotel/partner/bookings/${booking._id}` },
        });
    } catch (err) {
        logger.warn(`[hotel] partner push skipped for ${booking.bookingRef}: ${err.message}`);
    }
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const confirmationEmail = async (booking) => {
    const to = booking.guestDetails?.email;
    if (!to) return;
    const s = booking.snapshot || {};
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0f172a">
<div style="background:#0B2A6F;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><b style="font-size:18px">KSG Stays</b>
<span style="float:right;color:#FF7A00;font-weight:bold">Booking confirmed</span></div>
<div style="border:1px solid #e2e8f0;border-top:0;padding:20px;border-radius:0 0 10px 10px">
<p>Hi ${esc(booking.guestDetails?.name || 'there')}, your stay is confirmed.</p>
<p><b>${esc(s.propertyName)}</b><br>${esc(s.roomTypeName)} &middot; ${esc(booking.rooms)} room(s)<br>
Check-in ${esc(nice(booking.checkIn))} from ${esc(s.checkInTime || '12:00')} &middot; Check-out ${esc(nice(booking.checkOut))} by ${esc(s.checkOutTime || '11:00')}</p>
<p>Booking ID <b>${esc(booking.bookingRef)}</b><br>Total ${esc(rupees(booking.pricing?.total))}${booking.payment?.amountDue > 0 ? ` &middot; due at the hotel ${esc(rupees(booking.payment.amountDue))}` : ''}</p>
<p style="color:#64748b;font-size:12px">Open My stays in the KSG app for the full voucher.</p></div></div>`;
    try {
        await senders.email({ to, subject: `Booking confirmed: ${s.propertyName || 'your stay'} (${booking.bookingRef})`, html, fromName: 'KSG Stays' });
        remember({ to: 'email', email: to, type: 'hotel_booking_confirmed' });
    } catch (err) {
        logger.warn(`[hotel] confirmation email skipped for ${booking.bookingRef}: ${err.message}`);
    }
};

// ─── transitions ─────────────────────────────────────────────────────────

export const onTransition = async ({ booking, from, to } = {}) => {
    if (!booking?._id || from === to) return;
    const name = booking.snapshot?.propertyName || 'your stay';
    const ref = booking.bookingRef || '';
    const dates = `${nice(booking.checkIn)} - ${nice(booking.checkOut)}`;
    switch (to) {
        case 'confirmed':
            await notifyGuest(booking, { type: 'hotel_booking_confirmed', title: 'Booking confirmed', body: `${name}, ${dates}. Booking ID ${ref}.` });
            await notifyPartner(booking, {
                type: 'hotel_new_booking',
                title: 'New booking',
                body: `${booking.guestDetails?.name || 'A guest'} booked ${booking.snapshot?.roomTypeName || 'a room'} for ${dates} (${ref}).`,
            });
            await confirmationEmail(booking);
            break;
        case 'cancelled': {
            const refund = r2(booking.cancellation?.refundAmount);
            await notifyGuest(booking, {
                type: 'hotel_booking_cancelled',
                title: 'Booking cancelled',
                body: `${name} (${ref}) is cancelled.${refund > 0 ? ` A refund of ${rupees(refund)} is on its way.` : ''}`,
            });
            if (from && from !== 'awaiting_payment') {
                await notifyPartner(booking, { type: 'hotel_booking_cancelled', title: 'Booking cancelled', body: `${ref} for ${dates} was cancelled; the rooms are free again.` });
            }
            break;
        }
        case 'checked_in':
            await notifyGuest(booking, { type: 'hotel_checked_in', title: 'Welcome!', body: `You are checked in at ${name}. Enjoy your stay.` });
            break;
        case 'checked_out':
            await notifyGuest(booking, { type: 'hotel_checked_out', title: 'Thanks for staying', body: `You have checked out of ${name}. We hope to see you again.` });
            break;
        case 'no_show':
            await notifyGuest(booking, { type: 'hotel_no_show', title: 'Marked as no-show', body: `${name} marked booking ${ref} as a no-show. Contact support if this is wrong.` });
            break;
        case 'expired':
            await notifyGuest(booking, { type: 'hotel_booking_expired', title: 'Booking not completed', body: `Payment for ${name} was not received in time, so the rooms were released.` });
            break;
        default:
    }
};

export const onRefund = async ({ booking, amount } = {}) => {
    if (!booking?._id || !(Number(amount) > 0)) return;
    await notifyGuest(booking, {
        type: 'hotel_refund',
        title: 'Refund initiated',
        body: `${rupees(amount)} for booking ${booking.bookingRef || ''} is on its way to you.`,
    });
};

// ─── reminders (server.js runs this every 30 minutes) ────────────────────

export const CHECKIN_REMINDER_HOURS = 5;
const HOUR = 60 * 60 * 1000;

/** The guest's check-in moment: the check-in date at checkInTime, IST. */
export const checkInAt = (booking) => {
    const [h, m] = String(booking.snapshot?.checkInTime || '12:00').split(':').map(Number);
    return new Date(new Date(booking.checkIn).getTime() + ((h || 0) * 60 + (m || 0)) * 60 * 1000);
};

/**
 * Check-in reminders (from ~5 h before check-in until check-in time) and review
 * requests (after check-out, within 14 days). Each booking is claimed with a
 * conditional flag write, so overlapping runs or instances send once.
 */
export const runHotelReminders = async (now = new Date()) => {
    const out = { checkInReminders: 0, reviewRequests: 0 };
    const today = todayIST(now);

    const arriving = await HotelBooking.find({
        status: 'confirmed',
        'notificationsSent.checkInReminder': { $ne: true },
        checkIn: { $gte: toNightDate(addDays(today, -1)), $lte: toNightDate(addDays(today, 1)) },
    }).limit(500).lean();
    for (const b of arriving) {
        const at = checkInAt(b).getTime();
        if (now.getTime() < at - CHECKIN_REMINDER_HOURS * HOUR || now.getTime() > at) continue;
        const claim = await HotelBooking.updateOne(
            { _id: b._id, 'notificationsSent.checkInReminder': { $ne: true } },
            { $set: { 'notificationsSent.checkInReminder': true } },
        );
        if (claim.modifiedCount !== 1) continue;
        out.checkInReminders += 1;
        await notifyGuest(b, {
            type: 'hotel_checkin_reminder',
            title: 'Check-in today',
            body: `${b.snapshot?.propertyName || 'Your stay'}: check-in from ${b.snapshot?.checkInTime || '12:00'}. Booking ID ${b.bookingRef}.`,
        });
    }

    const stayed = await HotelBooking.find({
        status: 'checked_out',
        review: { $exists: false },
        'notificationsSent.reviewRequest': { $ne: true },
        checkOut: { $gte: toNightDate(addDays(today, -14)) },
    }).limit(500).lean();
    for (const b of stayed) {
        const claim = await HotelBooking.updateOne(
            { _id: b._id, 'notificationsSent.reviewRequest': { $ne: true } },
            { $set: { 'notificationsSent.reviewRequest': true } },
        );
        if (claim.modifiedCount !== 1) continue;
        out.reviewRequests += 1;
        await notifyGuest(b, {
            type: 'hotel_review_request',
            title: 'How was your stay?',
            body: `Rate ${b.snapshot?.propertyName || 'your stay'} and help other travellers.`,
        });
    }
    if (out.checkInReminders || out.reviewRequests) logger.info(`[hotel] reminders sent: ${JSON.stringify(out)}`);
    return out;
};


let registered = false;
export const registerNotificationListeners = () => {
    if (registered) return;
    registered = true;
    onBookingEvent('transition', 'notifications', onTransition);
    onBookingEvent('refund', 'notifications', onRefund);
};

registerNotificationListeners();
