import mongoose from 'mongoose';
import { DOCUMENT_TYPES } from '../constants.js';

// Verification documents for a property. Files live in private upload folders and are
// served through signed, expiring links (core/files/privateFiles.js).

const hotelPropertyDocumentSchema = new mongoose.Schema(
    {
        propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelProperty', required: true },
        documents: [
            {
                _id: false,
                type: { type: String, enum: DOCUMENT_TYPES, required: true },
                name: { type: String, trim: true },
                fileUrl: { type: String, required: true },
                isRequired: { type: Boolean, default: false },
                uploadedAt: { type: Date, default: Date.now },
            },
        ],
        verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
        adminRemark: { type: String, trim: true, default: '' },
        verifiedAt: Date,
        verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodAdmin' },
    },
    { collection: 'hotel_property_documents', timestamps: true },
);

hotelPropertyDocumentSchema.index({ propertyId: 1 }, { unique: true });
hotelPropertyDocumentSchema.index({ verificationStatus: 1, updatedAt: -1 });

export const HotelPropertyDocument = mongoose.models.HotelPropertyDocument
    || mongoose.model('HotelPropertyDocument', hotelPropertyDocumentSchema);
