import mongoose from 'mongoose';

// Hotel vertical settings: ONE document (key 'default') in hotel_settings.
//
// Kept here rather than in the core settings registry (core/config/registry.js): the
// hotel admin screen edits these as one form, and the GST slab table plus the
// settleOn enum do not fit the registry's scalar keys without new coercion types in
// core. Defaults live in services/settings.service.js (HOTEL_SETTINGS_DEFAULTS); a
// field missing here always means "use the default".

const hotelSettingsSchema = new mongoose.Schema(
    {
        key: { type: String, default: 'default', unique: true },
        commissionPercent: Number,
        minCommission: Number,
        commissionGstPercent: Number,
        paymentHoldMinutes: Number,
        prepaidDiscountPercent: Number,
        prepaidAdvancePercent: Number,
        allowPayAtHotel: Boolean,
        reviewAutoApprove: Boolean,
        minWithdrawal: Number,
        settleOn: { type: String, enum: ['checked_out', 'confirmed'] },
        gstSlabs: {
            type: [{ _id: false, upTo: { type: Number, default: null }, rate: Number }],
            default: undefined,
        },
        updatedBy: { type: mongoose.Schema.Types.ObjectId },
    },
    { collection: 'hotel_settings', timestamps: true },
);

export const HotelSettings = mongoose.models.HotelSettings || mongoose.model('HotelSettings', hotelSettingsSchema);
