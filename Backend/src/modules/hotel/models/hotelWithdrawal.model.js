import mongoose from 'mongoose';

// A hotel partner's payout request. The amount is held on request by a ledger
// WITHDRAWAL entry (core/finance/ledger.service.append, key forWithdrawal(id, 'requested'))
// and released by a reversing entry if an admin rejects it. core/payments/settlement.service
// only pays restaurants and riders, hence this collection.

export const WITHDRAWAL_STATUSES = Object.freeze(['pending', 'approved', 'rejected', 'paid']);

const hotelWithdrawalSchema = new mongoose.Schema(
    {
        partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelPartner', required: true },
        amount: { type: Number, min: 1, required: true },
        status: { type: String, enum: WITHDRAWAL_STATUSES, default: 'pending' },
        // Where the money goes, frozen at request time (masked; never a full number).
        bank: {
            accountHolder: String,
            accountNumberMasked: String,
            ifsc: String,
            bankName: String,
        },
        note: { type: String, trim: true, maxlength: 500 },
        utr: { type: String, trim: true, maxlength: 64 },
        processedAt: Date,
        processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodAdmin' },
        statusHistory: [
            {
                _id: false,
                status: { type: String, enum: WITHDRAWAL_STATUSES },
                at: { type: Date, default: Date.now },
                by: String,
                note: String,
            },
        ],
    },
    { collection: 'hotel_withdrawals', timestamps: true },
);

hotelWithdrawalSchema.index({ partnerId: 1, createdAt: -1 });
hotelWithdrawalSchema.index({ status: 1, createdAt: -1 });

export const HotelWithdrawal = mongoose.models.HotelWithdrawal
    || mongoose.model('HotelWithdrawal', hotelWithdrawalSchema);
