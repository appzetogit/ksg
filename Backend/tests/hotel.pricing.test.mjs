// Hotel pricing: pure unit tests for services/pricing.service.js (no database).
// Run: node tests/hotel.pricing.test.mjs

import assert from 'node:assert/strict';
import { priceStay, gstRateFor, round2, customerPricing } from '../src/modules/hotel/services/pricing.service.js';
import { HOTEL_SETTINGS_DEFAULTS } from '../src/modules/hotel/services/settings.service.js';

let failures = 0;
let passed = 0;
const check = (name, fn) => {
    try {
        fn();
        passed++;
        console.log(`  ok   ${name}`);
    } catch (err) {
        failures++;
        console.log(`  FAIL ${name}\n         ${err.message}`);
    }
};

const S = { ...HOTEL_SETTINGS_DEFAULTS };
const RT = { baseAdults: 2, baseChildren: 0, extraAdultPrice: 500, extraChildPrice: 300 };
const nights = (...prices) => prices.map((price, i) => ({ date: `2026-12-${String(10 + i).padStart(2, '0')}`, price }));
const paise = (n) => Math.round(n * 100);

/** Every identity the pricing promises, checked in paise. */
const assertAddsUp = (r) => {
    const p = r.pricing;
    assert.equal(paise(p.subtotal), paise(p.roomCharges) + paise(p.extraGuestCharges), 'subtotal');
    assert.equal(paise(p.taxableAmount), paise(p.subtotal) - paise(p.couponDiscount) - paise(p.prepaidDiscount), 'taxable');
    assert.equal(paise(p.total), paise(p.taxableAmount) + paise(p.gstAmount) + paise(p.platformFee) + paise(p.platformFeeGst), 'total');
    assert.equal(paise(r.payNow) + paise(r.payAtHotel), paise(p.total), 'payNow + payAtHotel');
    assert.equal(paise(p.partnerPayout), paise(p.taxableAmount) + paise(p.gstAmount) - paise(p.commissionAmount) - paise(p.commissionGst), 'payout');
    for (const [k, v] of Object.entries(p)) {
        if (typeof v === 'number') assert.equal(round2(v), v, `${k} has more than 2 decimals: ${v}`);
    }
    assert.equal(round2(r.payNow), r.payNow);
};

const base = (over = {}) => priceStay({
    roomType: RT, nights: nights(2000), rooms: 1, adults: 2, children: 0, paymentMode: 'online', settings: S, ...over,
});

console.log('\n[gst slabs]');
check('slab boundaries: <=1000 -> 0, <=7500 -> 5, above -> 18', () => {
    assert.equal(gstRateFor(0, S.gstSlabs), 0);
    assert.equal(gstRateFor(1000, S.gstSlabs), 0);
    assert.equal(gstRateFor(1000.01, S.gstSlabs), 5);
    assert.equal(gstRateFor(7500, S.gstSlabs), 5);
    assert.equal(gstRateFor(7500.01, S.gstSlabs), 18);
    assert.equal(gstRateFor(99999, S.gstSlabs), 18);
});
check('empty slab list means no GST', () => assert.equal(gstRateFor(5000, []), 0));
check('custom slabs from settings are honoured', () => {
    const r = base({ settings: { ...S, gstSlabs: [{ upTo: 2500, rate: 12 }, { upTo: null, rate: 28 }] } });
    assert.equal(r.pricing.gstRate, 12);
});

console.log('\n[basic stay]');
check('1 room, 1 night, Rs 2000, online', () => {
    const r = base();
    const p = r.pricing;
    assert.equal(p.roomCharges, 2000);
    assert.equal(p.extraGuestCharges, 0);
    assert.equal(p.subtotal, 2000);
    assert.equal(p.taxableAmount, 2000);
    assert.equal(p.gstRate, 5);
    assert.equal(p.gstAmount, 100);
    assert.equal(p.total, 2100);
    assert.equal(r.payNow, 2100);
    assert.equal(r.payAtHotel, 0);
    assert.equal(p.commissionAmount, 200); // 10%
    assert.equal(p.commissionGst, 36);
    assert.equal(p.partnerPayout, 1864);
    assertAddsUp(r);
});
check('multi-night with different nightly prices and several rooms', () => {
    const r = base({ nights: nights(2000, 2500, 2500), rooms: 2, adults: 4 });
    assert.equal(r.pricing.roomCharges, 14000);
    assert.equal(r.pricing.gstRate, 5); // 14000 / 2 rooms / 3 nights = 2333.33
    assert.equal(r.pricing.gstAmount, 700);
    assertAddsUp(r);
});
check('a cheap room (<= Rs 1000 per room-night) has 0% GST', () => {
    const r = base({ nights: nights(999, 1000) });
    assert.equal(r.pricing.gstRate, 0);
    assert.equal(r.pricing.gstAmount, 0);
    assertAddsUp(r);
});
check('a luxury room (> Rs 7500 per room-night) has 18% GST', () => {
    const r = base({ nights: nights(9000) });
    assert.equal(r.pricing.gstRate, 18);
    assert.equal(r.pricing.gstAmount, 1620);
    assertAddsUp(r);
});
check('slab is chosen per room per night, not on the stay total', () => {
    const r = base({ nights: nights(900, 900, 900, 900, 900), rooms: 3, adults: 6 });
    assert.equal(r.pricing.taxableAmount, 13500);
    assert.equal(r.pricing.gstRate, 0);
});

console.log('\n[extra guests]');
check('extra adults beyond rooms x baseAdults are charged per night', () => {
    const r = base({ nights: nights(2000, 2000), adults: 3 });
    assert.equal(r.extraAdults, 1);
    assert.equal(r.pricing.extraGuestCharges, 1000); // 500 x 1 x 2 nights
    assert.equal(r.pricing.subtotal, 5000);
    assertAddsUp(r);
});
check('children beyond rooms x baseChildren are charged per night', () => {
    const r = base({ nights: nights(2000, 2000, 2000), children: 2 });
    assert.equal(r.extraChildren, 2);
    assert.equal(r.pricing.extraGuestCharges, 1800); // 300 x 2 x 3
    assertAddsUp(r);
});
check('base allowance scales with rooms (2 rooms x 2 base = 4 adults free)', () => {
    const r = base({ rooms: 2, adults: 4 });
    assert.equal(r.pricing.extraGuestCharges, 0);
    const r5 = base({ rooms: 2, adults: 5 });
    assert.equal(r5.pricing.extraGuestCharges, 500);
});
check('extra guest charges count towards the GST slab', () => {
    // 7000 room + 2 extra adults x 500 = 8000 per night -> 18%
    const r = base({ nights: nights(7000), adults: 4 });
    assert.equal(r.pricing.taxableAmount, 8000);
    assert.equal(r.pricing.gstRate, 18);
});

console.log('\n[payment modes]');
check('pay_at_hotel: nothing now, everything at the hotel, no prepaid discount', () => {
    const r = base({ paymentMode: 'pay_at_hotel' });
    assert.equal(r.payNow, 0);
    assert.equal(r.payAtHotel, r.pricing.total);
    assert.equal(r.pricing.prepaidDiscount, 0);
    assertAddsUp(r);
});
check('online: full total now, no prepaid discount', () => {
    const r = base({ paymentMode: 'online' });
    assert.equal(r.pricing.prepaidDiscount, 0);
    assert.equal(r.payNow, r.pricing.total);
});
check('partial_prepaid: 5% discount before GST, 30% advance of the total', () => {
    const r = base({ paymentMode: 'partial_prepaid', nights: nights(3000) });
    const p = r.pricing;
    assert.equal(p.prepaidDiscount, 150);
    assert.equal(p.taxableAmount, 2850);
    assert.equal(p.gstRate, 5);
    assert.equal(p.gstAmount, 142.5);
    assert.equal(p.total, 2992.5);
    assert.equal(r.payNow, 897.75);
    assert.equal(r.payAtHotel, 2094.75);
    assertAddsUp(r);
});
check('the prepaid discount can drop the stay into a lower GST slab (GST after discounts)', () => {
    // 1050 -> 5% off = 997.5 per room-night -> 0% slab
    const r = base({ paymentMode: 'partial_prepaid', nights: nights(1050) });
    assert.equal(r.pricing.taxableAmount, 997.5);
    assert.equal(r.pricing.gstRate, 0);
    const online = base({ paymentMode: 'online', nights: nights(1050) });
    assert.equal(online.pricing.gstRate, 5);
});
check('advance percent comes from settings', () => {
    const r = base({ paymentMode: 'partial_prepaid', settings: { ...S, prepaidAdvancePercent: 50, prepaidDiscountPercent: 0 } });
    assert.equal(r.payNow, round2(r.pricing.total / 2));
    assertAddsUp(r);
});
check('unknown payment mode throws', () => {
    assert.throws(() => base({ paymentMode: 'wallet' }), /unknown payment mode/);
});

console.log('\n[coupon]');
check('coupon discount applies before the prepaid discount and before GST', () => {
    const r = base({ paymentMode: 'partial_prepaid', nights: nights(2000), coupon: { code: 'STAY200', discount: 200 } });
    const p = r.pricing;
    assert.equal(p.couponCode, 'STAY200');
    assert.equal(p.couponDiscount, 200);
    assert.equal(p.prepaidDiscount, 90); // 5% of 1800
    assert.equal(p.taxableAmount, 1710);
    assertAddsUp(r);
});
check('coupon never exceeds the subtotal', () => {
    const r = base({ coupon: { code: 'HUGE', discount: 99999 } });
    assert.equal(r.pricing.couponDiscount, 2000);
    assert.equal(r.pricing.taxableAmount, 0);
    assert.equal(r.pricing.commissionAmount, 0, 'commission capped at taxable');
    assert.equal(r.pricing.partnerPayout, 0);
    assertAddsUp(r);
});

console.log('\n[platform fee]');
check('platform fee and its GST are added to the total, not to taxable or payout', () => {
    const r = base({ platformFee: { fee: 25, gstRate: 18 } });
    assert.equal(r.pricing.platformFee, 25);
    assert.equal(r.pricing.platformFeeGst, 4.5);
    assert.equal(r.pricing.total, 2129.5);
    assert.equal(r.pricing.partnerPayout, 1864);
    assertAddsUp(r);
});
check('no platform fee object -> 0', () => {
    const r = base({ platformFee: null });
    assert.equal(r.pricing.platformFee, 0);
    assert.equal(r.pricing.platformFeeGst, 0);
});

console.log('\n[commission]');
check('minimum commission applies on small stays', () => {
    const r = base({ nights: nights(400) }); // 10% = 40 < 50
    assert.equal(r.pricing.commissionAmount, 50);
    assert.equal(r.pricing.commissionGst, 9);
    assert.equal(r.pricing.partnerPayout, 341);
    assertAddsUp(r);
});
check('percentage commission above the minimum', () => {
    const r = base({ nights: nights(1234.56) });
    assert.equal(r.pricing.commissionAmount, 123.46);
    assert.equal(r.pricing.commissionGst, 22.22);
    assertAddsUp(r);
});
check('commission uses settings (rate, minimum, GST on commission)', () => {
    const r = base({ settings: { ...S, commissionPercent: 15, minCommission: 0, commissionGstPercent: 0 } });
    assert.equal(r.pricing.commissionRate, 15);
    assert.equal(r.pricing.commissionAmount, 300);
    assert.equal(r.pricing.commissionGst, 0);
});

console.log('\n[rounding]');
check('awkward prices stay exact to the paisa across many combinations', () => {
    const prices = [999.99, 1000.01, 1333.33, 2499.5, 4567.89, 7500, 7500.01, 333.33];
    const modes = ['online', 'pay_at_hotel', 'partial_prepaid'];
    for (const a of prices) {
        for (const b of prices) {
            for (const rooms of [1, 2, 3]) {
                for (const paymentMode of modes) {
                    const r = priceStay({
                        roomType: RT, nights: nights(a, b), rooms, adults: rooms * 2 + 1, children: 1,
                        paymentMode, settings: S, platformFee: { fee: 9.99, gstRate: 18 },
                    });
                    assertAddsUp(r);
                }
            }
        }
    }
});

check('customerPricing hides commission and payout', () => {
    const p = customerPricing(base().pricing);
    for (const k of ['commissionRate', 'commissionAmount', 'commissionGst', 'partnerPayout']) assert.equal(p[k], undefined, k);
    assert.equal(p.total, 2100);
});

console.log(failures ? `\n${failures} pricing check(s) FAILED (${passed} passed)` : `\nall ${passed} hotel pricing checks passed`);
process.exit(failures ? 1 : 0);
