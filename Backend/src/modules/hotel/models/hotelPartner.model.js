import mongoose from 'mongoose';
import { PARTNER_STATUSES } from '../constants.js';

// A hotel owner / operator. Logs in by phone OTP (no password) with role HOTEL_PARTNER.
// Status is re-checked on every request by core auth middleware, so rejecting or
// blocking a partner takes effect immediately rather than when their token expires.

const pointSchema = new mongoose.Schema(
    {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: undefined }, // [lng, lat]
    },
    { _id: false },
);

const hotelPartnerSchema = new mongoose.Schema(
    {
        name: { type: String, trim: true, default: '' },
        // Last 10 digits only, so +91 / 0 prefixes cannot create a second account.
        phone: { type: String, required: true, trim: true, match: /^\d{10}$/ },
        email: { type: String, trim: true, lowercase: true },
        platformUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser' },

        status: { type: String, enum: PARTNER_STATUSES, default: 'pending' },
        rejectionReason: { type: String, default: '' },
        approvedAt: Date,
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodAdmin' },

        // File URLs point at private upload folders (core/files/privateFiles.js).
        // Full ID numbers are never stored, only the masked form.
        kyc: {
            ownerName: { type: String, trim: true },
            aadhaarNumberMasked: { type: String, trim: true },
            aadhaarFront: String,
            aadhaarBack: String,
            panNumber: { type: String, trim: true, uppercase: true },
            panImage: String,
            gstNumber: { type: String, trim: true, uppercase: true },
            gstCertificate: String,
        },
        bank: {
            accountHolder: { type: String, trim: true },
            accountNumberMasked: { type: String, trim: true },
            ifsc: { type: String, trim: true, uppercase: true },
            bankName: { type: String, trim: true },
            razorpayFundAccountId: String,
        },
        address: {
            line: { type: String, trim: true },
            city: { type: String, trim: true },
            state: { type: String, trim: true },
            pincode: { type: String, trim: true },
            location: { type: pointSchema, default: undefined },
        },

        fcmTokens: {
            web: { type: [String], default: [] },
            app: { type: [String], default: [] },
        },
        termsAcceptedAt: Date,
        lastLoginAt: Date,
        isDeleted: { type: Boolean, default: false },
    },
    { collection: 'hotel_partners', timestamps: true },
);

hotelPartnerSchema.index({ phone: 1 }, { unique: true });
hotelPartnerSchema.index({ email: 1 }, { unique: true, sparse: true });
hotelPartnerSchema.index({ status: 1, createdAt: -1 });

// Fields a partner may never see or set about themselves.
hotelPartnerSchema.methods.toPartnerJSON = function toPartnerJSON() {
    const obj = this.toObject({ versionKey: false });
    delete obj.approvedBy;
    delete obj.isDeleted;
    // Device push tokens are credentials for this account's devices; never echoed back.
    delete obj.fcmTokens;
    if (obj.bank) delete obj.bank.razorpayFundAccountId;
    return obj;
};

export const HotelPartner = mongoose.models.HotelPartner || mongoose.model('HotelPartner', hotelPartnerSchema);
