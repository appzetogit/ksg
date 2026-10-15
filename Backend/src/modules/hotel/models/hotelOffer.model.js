import mongoose from 'mongoose';
import { PROPERTY_TYPES } from '../constants.js';

// Hotel coupons (phase 9). Shaped like the other per-vertical offer models
// (food_offers, qc_offers) where it fits; logic in services/offer.service.js.
//
// usedCount is the number of ACTIVE redemptions (hotel_offer_redemptions with
// status 'active'): +1 inside the booking-create transaction, -1 when the booking is
// cancelled or expires. Redemption takes it with a conditional $inc
// ({ usedCount: { $lt: limit } }), so parallel bookings can never exceed usageLimit.
//
// funding decides who bears the discount (see pricing.service.js):
//   platform  the hotel is paid as if the guest had paid the full price; the
//             platform tops the discount up at settlement (pricing.platformSubsidy)
//   partner   the discount comes out of the hotel's revenue; only allowed on coupons
//             restricted to specific properties (propertyIds)

export const OFFER_DISCOUNT_TYPES = Object.freeze(['percentage', 'flat']);
export const OFFER_FUNDING = Object.freeze(['platform', 'partner']);

const hotelOfferSchema = new mongoose.Schema(
    {
        code: { type: String, required: true, trim: true, uppercase: true, maxlength: 30 },
        title: { type: String, trim: true, maxlength: 80, default: '' },
        description: { type: String, trim: true, maxlength: 500, default: '' },
        discountType: { type: String, enum: OFFER_DISCOUNT_TYPES, required: true },
        discountValue: { type: Number, required: true, min: 0 },
        maxDiscount: { type: Number, default: null, min: 0 }, // percentage cap; null = none
        minBookingAmount: { type: Number, default: 0, min: 0 }, // against the stay subtotal
        validFrom: { type: Date, default: null },
        validTo: { type: Date, default: null },
        usageLimit: { type: Number, default: null, min: 0 }, // total; null/0 = unlimited
        perUserLimit: { type: Number, default: null, min: 0 }, // null/0 = unlimited
        usedCount: { type: Number, default: 0, min: 0 },
        firstBookingOnly: { type: Boolean, default: false },
        propertyIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'HotelProperty' }], // empty = all
        propertyTypes: [{ type: String, enum: PROPERTY_TYPES }], // empty = all
        funding: { type: String, enum: OFFER_FUNDING, default: 'platform' },
        isActive: { type: Boolean, default: true, index: true },
        createdBy: {
            role: { type: String, default: 'admin' },
            id: { type: mongoose.Schema.Types.ObjectId },
        },
    },
    { collection: 'hotel_offers', timestamps: true },
);

hotelOfferSchema.index({ code: 1 }, { unique: true });
hotelOfferSchema.index({ isActive: 1, validTo: 1 });

export const HotelOffer = mongoose.models.HotelOffer || mongoose.model('HotelOffer', hotelOfferSchema);
