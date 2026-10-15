// Customer extras: saved properties and the printable booking voucher.

import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { sendResponse, sendError } from '../../../utils/response.js';
import { NotFoundError } from '../../../core/auth/errors.js';
import { verifyAccessToken } from '../../../core/auth/token.util.js';
import { FoodUser } from '../../../core/users/user.model.js';
import { HotelProperty } from '../models/hotelProperty.model.js';
import { HotelSavedProperty } from '../models/hotelSavedProperty.model.js';
import { HotelBooking } from '../models/hotelBooking.model.js';
import { isObjectId, round2 } from '../services/property.service.js';
import { listableMatch } from '../services/search.service.js';
import { toDateString } from '../services/dates.js';

const handle = (fn) => async (req, res, next) => {
    try {
        return await fn(req, res);
    } catch (err) {
        return next(err);
    }
};

// ─── saved ────────────────────────────────────────────────────────────────

/** PropertyCard (docs/hotel-api-contract.md) from a property document. */
export const propertyCard = (p) => ({
    _id: p._id,
    name: p.name,
    slug: p.slug,
    propertyType: p.propertyType,
    coverImage: p.coverImage,
    address: { area: p.address?.area || '', city: p.address?.city || '' },
    location: p.location,
    avgRating: p.avgRating || 0,
    totalReviews: p.totalReviews || 0,
    amenities: p.amenities || [],
    startingPrice: p.startingPrice ?? null,
    ...(p.originalPrice > (p.startingPrice || 0) ? { originalPrice: p.originalPrice } : {}),
});

export const listSaved = handle(async (req, res) => {
    const saved = await HotelSavedProperty.find({ userId: req.user.userId }).sort({ createdAt: -1 }).limit(500).lean();
    const ids = saved.map((s) => s.propertyId);
    const props = await HotelProperty.find({ _id: { $in: ids }, ...(await listableMatch()) }).lean();
    const byId = new Map(props.map((p) => [String(p._id), p]));
    const cards = saved.map((s) => byId.get(String(s.propertyId))).filter(Boolean).map(propertyCard);
    return sendResponse(res, 200, 'Saved properties', cards);
});

export const saveProperty = handle(async (req, res) => {
    const { propertyId } = req.params;
    const listable = isObjectId(propertyId)
        && await HotelProperty.exists({ _id: propertyId, ...(await listableMatch()) });
    if (!listable) throw new NotFoundError('Property not found');
    await HotelSavedProperty.updateOne(
        { userId: req.user.userId, propertyId },
        { $setOnInsert: { userId: req.user.userId, propertyId } },
        { upsert: true },
    );
    return sendResponse(res, 200, 'Saved', { saved: true });
});

export const unsaveProperty = handle(async (req, res) => {
    const { propertyId } = req.params;
    if (isObjectId(propertyId)) await HotelSavedProperty.deleteOne({ userId: req.user.userId, propertyId });
    return sendResponse(res, 200, 'Removed', { saved: false });
});

// ─── voucher ──────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `&#8377;${round2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDate = (d) => new Date(`${toDateString(d)}T00:00:00Z`)
    .toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const time12 = (hhmm) => {
    const [h, m] = String(hhmm || '12:00').split(':').map(Number);
    const hour = ((h + 11) % 12) + 1;
    return `${hour}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const STATUS_LABEL = {
    awaiting_payment: 'Awaiting payment',
    confirmed: 'Confirmed',
    checked_in: 'Checked in',
    checked_out: 'Completed',
    cancelled: 'Cancelled',
    no_show: 'No-show',
    expired: 'Expired',
};
const PAYMENT_LABEL = {
    pending: 'Pending',
    paid: 'Paid',
    partially_paid: 'Partially paid',
    refunded: 'Refunded',
    partially_refunded: 'Partially refunded',
    failed: 'Failed',
};
const MODE_LABEL = { pay_at_hotel: 'Pay at hotel', online: 'Paid online', wallet: 'KSG wallet', partial_prepaid: 'Advance online, rest at hotel' };
const MEAL = { room_only: 'Room only', breakfast: 'Breakfast included', half_board: 'Half board', full_board: 'Full board' };

export const policyText = (policy = {}) => {
    if (!policy?.type) return 'As per the property policy.';
    if (policy.type === 'non_refundable') return 'Non-refundable: no refund on cancellation or no-show.';
    const hours = Number(policy.freeCancelHours) || 0;
    const after = Number(policy.refundPercentAfter) || 0;
    const later = after > 0 ? `${after}% refund after that` : 'no refund after that';
    return `Free cancellation up to ${hours} hours before check-in; ${later}. No refund for a no-show.`;
};

/** Self-contained printable HTML. Never includes commission or partner payout. */
export const voucherHTML = (b, { support = {}, nonce = '' } = {}) => {
    const s = b.snapshot || {};
    const p = b.pricing || {};
    const pay = b.payment || {};
    const guests = `${b.guests?.adults || 0} adult${b.guests?.adults === 1 ? '' : 's'}${b.guests?.children ? `, ${b.guests.children} child${b.guests.children === 1 ? '' : 'ren'}` : ''}`;
    const line = (label, value, cls = '') => `<tr class="${cls}"><td>${esc(label)}</td><td class="r">${value}</td></tr>`;
    const lines = [
        line('Room charges', money(p.roomCharges)),
        p.extraGuestCharges > 0 ? line('Extra guest charges', money(p.extraGuestCharges)) : '',
        p.couponDiscount > 0 ? line(`Coupon${p.couponCode ? ` (${p.couponCode})` : ''}`, `&minus;${money(p.couponDiscount)}`) : '',
        p.prepaidDiscount > 0 ? line('Prepaid discount', `&minus;${money(p.prepaidDiscount)}`) : '',
        line(`GST${p.gstRate ? ` (${p.gstRate}%)` : ''}`, money(p.gstAmount)),
        p.platformFee > 0 ? line('Booking fee (incl. GST)', money((p.platformFee || 0) + (p.platformFeeGst || 0))) : '',
        line('Total', money(p.total), 'total'),
    ].join('');
    const due = round2(pay.amountDue);
    const supportBits = [
        support.phone ? `Call ${esc(support.phoneCountryCode ? `+${String(support.phoneCountryCode).replace(/^\+/, '')} ` : '')}${esc(support.phone)}` : '',
        support.email ? `email ${esc(support.email)}` : '',
    ].filter(Boolean).join(' or ');
    const cancelled = ['cancelled', 'no_show', 'expired'].includes(b.status);

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Booking voucher ${esc(b.bookingRef)}</title>
<style>
:root{--navy:#0B2A6F;--saffron:#FF7A00;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0}
*{box-sizing:border-box}body{margin:0;background:#f1f5f9;font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:var(--ink)}
.page{max-width:760px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(15,23,42,.08)}
header{background:var(--navy);color:#fff;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.brand{font-size:20px;font-weight:800;letter-spacing:.3px}.brand span{color:var(--saffron)}
.ref{text-align:right}.ref small{display:block;opacity:.75;font-size:11px;text-transform:uppercase;letter-spacing:1px}.ref b{font-size:18px}
.bar{height:4px;background:var(--saffron)}
section{padding:18px 24px;border-bottom:1px solid var(--line)}
h1{margin:0 0 4px;font-size:20px;color:var(--navy)}h2{margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--muted)}
.muted{color:var(--muted)}.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;background:#dcfce7;color:#166534}
.badge.bad{background:#fee2e2;color:#991b1b}.badge.wait{background:#ffedd5;color:#9a3412}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.cell small{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.6px}.cell b{font-size:15px}
table{width:100%;border-collapse:collapse}td{padding:6px 0}td.r{text-align:right;white-space:nowrap}
tr.total td{border-top:1px dashed var(--line);font-weight:800;font-size:16px;padding-top:10px;color:var(--navy)}
.due{margin-top:10px;padding:10px 12px;border-radius:10px;background:#fff7ed;border:1px solid #fed7aa;font-weight:700;color:#9a3412}
footer{padding:16px 24px;font-size:12px;color:var(--muted)}
.actions{text-align:center;padding:0 24px 20px}button{background:var(--saffron);color:#fff;border:0;border-radius:8px;padding:10px 22px;font-weight:700;cursor:pointer}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;border-radius:0}.actions{display:none}header,.bar{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head>
<body><div class="page">
<header><div class="brand">KSG <span>Stays</span></div>
<div class="ref"><small>Booking ID</small><b>${esc(b.bookingRef)}</b></div></header><div class="bar"></div>
<section>
<h1>${esc(s.propertyName || 'Your stay')}</h1>
<div class="muted">${esc(s.address || '')}</div>
<p style="margin:10px 0 0"><span class="badge${cancelled ? ' bad' : b.status === 'awaiting_payment' ? ' wait' : ''}">${esc(STATUS_LABEL[b.status] || b.status)}</span></p>
</section>
<section><h2>Stay</h2><div class="grid">
<div class="cell"><small>Check-in</small><b>${esc(longDate(b.checkIn))}</b><div class="muted">from ${esc(time12(s.checkInTime || '12:00'))}</div></div>
<div class="cell"><small>Check-out</small><b>${esc(longDate(b.checkOut))}</b><div class="muted">by ${esc(time12(s.checkOutTime || '11:00'))}</div></div>
<div class="cell"><small>Nights</small><b>${esc(b.nights)}</b></div>
<div class="cell"><small>Room</small><b>${esc(s.roomTypeName || 'Room')}</b><div class="muted">${esc(b.rooms || 1)} room${b.rooms > 1 ? 's' : ''}${s.mealPlan && MEAL[s.mealPlan] ? ` &middot; ${esc(MEAL[s.mealPlan])}` : ''}</div></div>
<div class="cell"><small>Guests</small><b>${esc(guests)}</b></div>
</div></section>
<section><h2>Guest</h2><div class="grid">
<div class="cell"><small>Name</small><b>${esc(b.guestDetails?.name || '')}</b></div>
<div class="cell"><small>Phone</small><b>${esc(b.guestDetails?.phone || '')}</b></div>
${b.guestDetails?.email ? `<div class="cell"><small>Email</small><b>${esc(b.guestDetails.email)}</b></div>` : ''}
</div>${b.specialRequests ? `<p class="muted" style="margin:10px 0 0">Special requests: ${esc(b.specialRequests)}</p>` : ''}</section>
<section><h2>Price</h2><table>${lines}</table>
<p class="muted" style="margin:8px 0 0">${esc(MODE_LABEL[pay.mode] || pay.mode || '')} &middot; ${esc(PAYMENT_LABEL[pay.status] || pay.status || '')} &middot; paid ${money(pay.amountPaid)}${pay.walletAmount > 0 ? ` (wallet ${money(pay.walletAmount)})` : ''}</p>
${due > 0 && !cancelled ? `<div class="due">Pay at the hotel: ${money(due)}</div>` : ''}
${b.cancellation?.at ? `<p class="muted" style="margin:8px 0 0">Cancelled on ${esc(longDate(b.cancellation.at))}${b.cancellation.refundAmount > 0 ? `, refund ${money(b.cancellation.refundAmount)}` : ''}.</p>` : ''}
</section>
<section><h2>Cancellation policy</h2><div>${esc(policyText(s.cancellationPolicy))}</div></section>
<footer>Please carry a government photo ID; the hotel may ask for it at check-in.
Need help? ${supportBits ? `${supportBits}, or use` : 'Use'} Help in the KSG app and quote booking ID ${esc(b.bookingRef)}.</footer>
<div class="actions"><button id="print" type="button">Print / Save as PDF</button></div>
</div>
<script nonce="${esc(nonce)}">document.getElementById('print').addEventListener('click',function(){window.print()});</script>
</body></html>`;
};

const supportContact = async () => {
    try {
        const { managedBrand } = await import('../../../core/settings/platformProfile.service.js');
        return await managedBrand();
    } catch {
        return {};
    }
};

/** GET /user/bookings/:id/voucher — token from the Authorization header or ?token=. */
export const voucher = async (req, res, next) => {
    try {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : (typeof req.query.token === 'string' ? req.query.token : '');
        if (!token) return sendError(res, 401, 'Authentication token missing');
        let decoded;
        try {
            decoded = verifyAccessToken(token);
        } catch {
            return sendError(res, 401, 'Invalid or expired token');
        }
        const userId = String(decoded.userId || decoded.sub || '');
        if (String(decoded.role || '').toUpperCase() !== 'USER' || !mongoose.Types.ObjectId.isValid(userId)) {
            return sendError(res, 403, 'Customer access required');
        }
        const user = await FoodUser.findById(userId).select('isActive').lean();
        if (!user || user.isActive === false) return sendError(res, 401, 'User account not found');

        const booking = isObjectId(req.params.id) ? await HotelBooking.findById(req.params.id).lean() : null;
        if (!booking || String(booking.userId) !== userId) return sendError(res, 404, 'Booking not found');

        const nonce = crypto.randomBytes(16).toString('base64');
        const html = voucherHTML(booking, { support: await supportContact(), nonce });
        res.set({
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
        });
        return res.status(200).send(html);
    } catch (err) {
        return next(err);
    }
};
