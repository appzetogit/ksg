import mongoose from 'mongoose';

// One row per coupon use on a booking (services/offer.service.js). Written in the
// booking-create transaction; 'released' when the booking is cancelled or expires,
// which gives the use back (offer.usedCount -1, and it stops counting per user).

const hotelOfferRedemptionSchema = new mongoose.Schema(
    {
        offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelOffer', required: true },
        code: { type: String, trim: true, uppercase: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', required: true },
        bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelBooking', required: true },
        discount: { type: Number, min: 0, required: true },
        funding: { type: String, enum: ['platform', 'partner'] },
        status: { type: String, enum: ['active', 'released'], default: 'active' },
        releasedAt: Date,
        releaseReason: String,
    },
    { collection: 'hotel_offer_redemptions', timestamps: true },
);

hotelOfferRedemptionSchema.index({ offerId: 1, bookingId: 1 }, { unique: true });
hotelOfferRedemptionSchema.index({ offerId: 1, userId: 1, status: 1 });
hotelOfferRedemptionSchema.index({ bookingId: 1, status: 1 });

export const HotelOfferRedemption = mongoose.models.HotelOfferRedemption
    || mongoose.model('HotelOfferRedemption', hotelOfferRedemptionSchema);
