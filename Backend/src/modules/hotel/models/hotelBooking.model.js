import mongoose from 'mongoose';
import { BOOKING_STATUSES, PAYMENT_MODES, PAYMENT_STATUSES, CANCELLATION_POLICY_TYPES } from '../constants.js';

const actorSchema = new mongoose.Schema(
    {
        role: { type: String, enum: ['user', 'partner', 'admin', 'system'], required: true },
        id: { type: mongoose.Schema.Types.ObjectId },
    },
    { _id: false },
);

const hotelBookingSchema = new mongoose.Schema(
    {
        bookingRef: { type: String, required: true, trim: true, uppercase: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', required: true },
        propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelProperty', required: true },
        partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelPartner', required: true },
        roomTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelRoomType', required: true },
        zoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodZone' },

        // Frozen at booking time so later edits to the property never rewrite history.
        snapshot: {
            propertyName: String,
            propertyType: String,
            roomTypeName: String,
            address: String,
            coverImage: String,
            checkInTime: String,
            checkOutTime: String,
            cancellationPolicy: {
                type: { type: String, enum: CANCELLATION_POLICY_TYPES },
                freeCancelHours: Number,
                refundPercentAfter: Number,
            },
        },

        checkIn: { type: Date, required: true },
        checkOut: { type: Date, required: true },
        nights: { type: Number, min: 1, required: true },
        rooms: { type: Number, min: 1, default: 1 },
        guests: {
            adults: { type: Number, min: 1, required: true },
            children: { type: Number, min: 0, default: 0 },
        },
        guestDetails: {
            name: { type: String, trim: true },
            phone: { type: String, trim: true },
            email: { type: String, trim: true, lowercase: true },
        },
        specialRequests: { type: String, trim: true, maxlength: 500 },

        // Computed by the pricing service; the client never supplies any of these.
        pricing: {
            roomCharges: { type: Number, min: 0, required: true },
            extraGuestCharges: { type: Number, min: 0, default: 0 },
            subtotal: { type: Number, min: 0, required: true },
            couponCode: String,
            couponDiscount: { type: Number, min: 0, default: 0 },
            prepaidDiscount: { type: Number, min: 0, default: 0 },
            taxableAmount: { type: Number, min: 0, required: true },
            gstRate: { type: Number, min: 0, default: 0 },
            gstAmount: { type: Number, min: 0, default: 0 },
            platformFee: { type: Number, min: 0, default: 0 },
            platformFeeGst: { type: Number, min: 0, default: 0 },
            total: { type: Number, min: 0, required: true },
            commissionRate: { type: Number, min: 0, default: 0 },
            commissionAmount: { type: Number, min: 0, default: 0 },
            commissionGst: { type: Number, min: 0, default: 0 },
            partnerPayout: { type: Number, default: 0 },
        },

        payment: {
            mode: { type: String, enum: PAYMENT_MODES, required: true },
            status: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
            amountPaid: { type: Number, min: 0, default: 0 },
            amountDue: { type: Number, min: 0, default: 0 },
            walletAmount: { type: Number, min: 0, default: 0 },
            // Booking phase (services/booking.service.js): how payNow splits and what
            // has moved. amountPaid = walletAmount (debited at create) + onlinePaid +
            // collectedAtHotel; refunds never reduce it (see refundedAmount).
            payNow: { type: Number, min: 0, default: 0 },
            onlineAmount: { type: Number, min: 0, default: 0 }, // gateway part of payNow
            onlinePaid: { type: Number, min: 0, default: 0 },
            collectedAtHotel: { type: Number, min: 0, default: 0 },
            refundedAmount: { type: Number, min: 0, default: 0 },
            walletRefunded: { type: Number, min: 0, default: 0 },
            gatewayRefunded: { type: Number, min: 0, default: 0 },
            razorpayOrderId: String,
            razorpayPaymentId: String,
            paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
            expiresAt: Date, // unpaid hold expiry
        },

        status: { type: String, enum: BOOKING_STATUSES, required: true },
        statusHistory: [
            {
                _id: false,
                status: { type: String, enum: BOOKING_STATUSES, required: true },
                at: { type: Date, default: Date.now },
                by: actorSchema,
                note: String,
            },
        ],
        cancellation: {
            by: { type: String, enum: ['user', 'partner', 'admin', 'system'] },
            reason: String,
            at: Date,
            refundAmount: { type: Number, min: 0 },
            refundId: { type: mongoose.Schema.Types.ObjectId, ref: 'Refund' },
        },
        // Every refund on this booking (policy cancel, partner/admin cancel, expiry,
        // admin manual refund, late capture). `key` makes each one idempotent.
        refunds: [
            {
                _id: false,
                key: { type: String, required: true },
                amount: { type: Number, min: 0, required: true },
                walletAmount: { type: Number, min: 0, default: 0 },
                gatewayAmount: { type: Number, min: 0, default: 0 },
                refundId: { type: mongoose.Schema.Types.ObjectId, ref: 'Refund' },
                gatewayRefundId: String,
                status: { type: String, enum: ['processed', 'pending', 'failed'], default: 'processed' },
                reason: String,
                by: { type: String, enum: ['user', 'partner', 'admin', 'system'] },
                at: { type: Date, default: Date.now },
            },
        ],
        review: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelReview' },
        notificationsSent: {
            checkInReminder: { type: Boolean, default: false },
            reviewRequest: { type: Boolean, default: false },
            paymentExpiryWarning: { type: Boolean, default: false },
        },
        source: { type: String, enum: ['app', 'web', 'admin'], default: 'app' },
    },
    { collection: 'hotel_bookings', timestamps: true },
);

hotelBookingSchema.path('checkOut').validate(function afterCheckIn(v) {
    return this.checkIn && v > this.checkIn;
}, 'checkOut must be after checkIn');

hotelBookingSchema.index({ bookingRef: 1 }, { unique: true });
hotelBookingSchema.index({ userId: 1, createdAt: -1 });
hotelBookingSchema.index({ partnerId: 1, status: 1, checkIn: 1 });
hotelBookingSchema.index({ propertyId: 1, checkIn: 1 });
hotelBookingSchema.index({ status: 1, 'payment.expiresAt': 1 });
hotelBookingSchema.index({ 'payment.razorpayOrderId': 1 }, { sparse: true });

export const HotelBooking = mongoose.models.HotelBooking || mongoose.model('HotelBooking', hotelBookingSchema);
