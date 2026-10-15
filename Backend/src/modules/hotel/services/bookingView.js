// BookingSummary JSON for the money workstream's own screens (dashboard recent
// bookings). Shape: docs/hotel-api-contract.md "Booking" minus statusHistory.
// Commission and payout fields appear only in partner/admin views.

import { toDateString } from './dates.js';

const PARTNER_ONLY_PRICING = ['commissionRate', 'commissionAmount', 'commissionGst', 'partnerPayout'];

export const bookingSummaryJSON = (doc, { view = 'partner' } = {}) => {
    const b = doc?.toObject ? doc.toObject({ versionKey: false }) : { ...doc };
    const pricing = { ...(b.pricing || {}) };
    if (view === 'user') for (const k of PARTNER_ONLY_PRICING) delete pricing[k];
    const payment = b.payment || {};
    return {
        _id: b._id,
        bookingRef: b.bookingRef,
        propertyId: b.propertyId,
        roomTypeId: b.roomTypeId,
        partnerId: b.partnerId,
        snapshot: b.snapshot,
        checkIn: b.checkIn ? toDateString(b.checkIn) : undefined,
        checkOut: b.checkOut ? toDateString(b.checkOut) : undefined,
        nights: b.nights,
        rooms: b.rooms,
        guests: b.guests,
        guestDetails: b.guestDetails,
        specialRequests: b.specialRequests,
        pricing,
        payment: {
            mode: payment.mode,
            status: payment.status,
            amountPaid: payment.amountPaid || 0,
            amountDue: payment.amountDue || 0,
            walletAmount: payment.walletAmount || 0,
            ...(payment.expiresAt ? { expiresAt: payment.expiresAt } : {}),
        },
        status: b.status,
        ...(b.cancellation?.at ? { cancellation: b.cancellation } : {}),
        ...(b.review ? { reviewId: b.review } : {}),
        createdAt: b.createdAt,
    };
};
