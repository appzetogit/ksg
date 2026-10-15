// Hotel stay pricing (HOTEL_INTEGRATION_PLAN.md §4.2). PURE: no I/O, no clock.
// Unit-tested in tests/hotel.pricing.test.mjs.
//
// Every money figure is rounded to 2 dp as it is produced, and every derived figure is
// computed from already-rounded parts, so the parts always add up exactly:
//   subtotal      = roomCharges + extraGuestCharges
//   taxableAmount = subtotal - couponDiscount - prepaidDiscount
//   total         = taxableAmount + gstAmount + platformFee + platformFeeGst
//   payNow + payAtHotel = total
//   partnerPayout = taxableAmount + gstAmount + platformSubsidy - commissionAmount - commissionGst
//
// Coupon funding (phase 9, services/offer.service.js):
//   - the coupon always lowers what the guest pays, before the prepaid discount and
//     before GST (GST is on the discounted taxable amount, as before);
//   - commission is always on the post-discount taxable amount;
//   - platform-funded: platformSubsidy = couponDiscount, added to the partner payout, so
//     the hotel's room revenue is what it would have been without the coupon and the
//     platform absorbs the discount (settlement.listener.js pays it out);
//   - partner-funded (and a coupon with no funding given): platformSubsidy = 0, the
//     discount comes out of the hotel's revenue.
//
// The client never supplies any of these: the booking service recomputes them from
// the room type, the night prices (inventory.quoteNights) and the settings.

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Paise-exact helpers: sums/differences of 2 dp figures without float drift.
const toPaise = (n) => Math.round(Number(n) * 100);
const fromPaise = (p) => p / 100;
const add = (...xs) => fromPaise(xs.reduce((s, x) => s + toPaise(x), 0));
const sub = (a, ...xs) => fromPaise(toPaise(a) - xs.reduce((s, x) => s + toPaise(x), 0));

export const PAY_MODES = Object.freeze(['pay_at_hotel', 'online', 'partial_prepaid']);

/** GST rate for a per-room-per-night tariff from slabs [{ upTo|null, rate }]. */
export const gstRateFor = (tariff, slabs) => {
    const list = Array.isArray(slabs) && slabs.length ? slabs : [{ upTo: null, rate: 0 }];
    for (const s of list) {
        if (s.upTo === null || s.upTo === undefined || tariff <= s.upTo) return Number(s.rate) || 0;
    }
    return Number(list[list.length - 1].rate) || 0;
};

/**
 * @param {object}   p
 * @param {object}   p.roomType      { baseAdults, baseChildren, extraAdultPrice, extraChildPrice }
 * @param {Array}    p.nights        [{ date, price }] (one entry per night)
 * @param {number}   p.rooms
 * @param {number}   p.adults
 * @param {number}   p.children
 * @param {string}   p.paymentMode   pay_at_hotel | online | partial_prepaid
 * @param {object}  [p.coupon]       { code, discount, funding? } -- discount in rupees, already
 *                                   validated; funding 'platform' | 'partner' (default partner)
 * @param {object}   p.settings      HotelSettings
 * @param {object}  [p.platformFee]  { fee, gstRate } (rupees, percent)
 * @returns {{ pricing, payNow, payAtHotel }}
 */
export const priceStay = ({
    roomType,
    nights,
    rooms = 1,
    adults = 1,
    children = 0,
    paymentMode,
    coupon = null,
    settings,
    platformFee = null,
}) => {
    if (!Array.isArray(nights) || !nights.length) throw new Error('priceStay: at least one night is required');
    if (!Number.isInteger(rooms) || rooms < 1) throw new Error('priceStay: rooms must be a positive integer');
    if (!PAY_MODES.includes(paymentMode)) throw new Error(`priceStay: unknown payment mode "${paymentMode}"`);
    const n = nights.length;

    // Rooms: each night's rate × rooms.
    const perRoomStay = add(...nights.map((x) => round2(x.price)));
    const roomCharges = round2(perRoomStay * rooms);

    // Extra guests beyond what the booked rooms include, charged per night.
    const extraAdults = Math.max(0, adults - rooms * (roomType.baseAdults ?? 2));
    const extraChildren = Math.max(0, children - rooms * (roomType.baseChildren ?? 0));
    const extraPerNight = add(
        round2(extraAdults * (Number(roomType.extraAdultPrice) || 0)),
        round2(extraChildren * (Number(roomType.extraChildPrice) || 0)),
    );
    const extraGuestCharges = round2(extraPerNight * n);

    const subtotal = add(roomCharges, extraGuestCharges);

    const couponDiscount = coupon && coupon.discount > 0 ? Math.min(round2(coupon.discount), subtotal) : 0;
    const afterCoupon = sub(subtotal, couponDiscount);

    const prepaidDiscount = paymentMode === 'partial_prepaid'
        ? round2((afterCoupon * (Number(settings.prepaidDiscountPercent) || 0)) / 100)
        : 0;

    // GST after every discount, at the slab of the per-room-per-night tariff.
    const taxableAmount = sub(afterCoupon, prepaidDiscount);
    const tariff = taxableAmount / rooms / n;
    const gstRate = gstRateFor(tariff, settings.gstSlabs);
    const gstAmount = round2((taxableAmount * gstRate) / 100);

    const fee = platformFee && platformFee.fee > 0 ? round2(platformFee.fee) : 0;
    const feeGst = fee > 0 ? round2((fee * (Number(platformFee.gstRate) || 0)) / 100) : 0;

    const total = add(taxableAmount, gstAmount, fee, feeGst);

    let payNow = 0;
    if (paymentMode === 'online') payNow = total;
    else if (paymentMode === 'partial_prepaid') {
        payNow = Math.min(total, round2((total * (Number(settings.prepaidAdvancePercent) || 0)) / 100));
    }
    const payAtHotel = sub(total, payNow);

    // Commission on the taxable amount, at least the minimum but never more than the
    // taxable amount itself (a fully discounted stay must not leave a negative payout).
    const commissionRate = Number(settings.commissionPercent) || 0;
    const commissionAmount = Math.min(
        taxableAmount,
        Math.max(round2((taxableAmount * commissionRate) / 100), round2(Number(settings.minCommission) || 0)),
    );
    const commissionGst = round2((commissionAmount * (Number(settings.commissionGstPercent) || 0)) / 100);
    const couponFunding = couponDiscount > 0 ? (coupon.funding === 'platform' ? 'platform' : 'partner') : null;
    const platformSubsidy = couponFunding === 'platform' ? couponDiscount : 0;
    const partnerPayout = sub(add(taxableAmount, gstAmount, platformSubsidy), commissionAmount, commissionGst);

    return {
        pricing: {
            roomCharges,
            extraGuestCharges,
            subtotal,
            ...(couponDiscount > 0 && coupon?.code ? { couponCode: coupon.code } : {}),
            couponDiscount,
            ...(couponFunding ? { couponFunding } : {}),
            platformSubsidy,
            prepaidDiscount,
            taxableAmount,
            gstRate,
            gstAmount,
            platformFee: fee,
            platformFeeGst: feeGst,
            total,
            commissionRate,
            commissionAmount,
            commissionGst,
            partnerPayout,
        },
        payNow,
        payAtHotel,
        extraAdults,
        extraChildren,
    };
};

/** Pricing fields only partners and admins see. */
export const PARTNER_ONLY_PRICING = Object.freeze([
    'commissionRate', 'commissionAmount', 'commissionGst', 'partnerPayout', 'couponFunding', 'platformSubsidy',
]);

/** The customer-facing part of a pricing object (no commission, payout or coupon funding). */
export const customerPricing = (pricing) => {
    if (!pricing) return pricing;
    const rest = { ...pricing };
    for (const k of PARTNER_ONLY_PRICING) delete rest[k];
    return rest;
};
