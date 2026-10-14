import mongoose from 'mongoose';

// A customer's saved (wishlisted) properties. Kept out of the shared users document so
// the hotel vertical never writes to it.

const hotelSavedPropertySchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', required: true },
        propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelProperty', required: true },
    },
    { collection: 'hotel_saved_properties', timestamps: { createdAt: true, updatedAt: false } },
);

hotelSavedPropertySchema.index({ userId: 1, propertyId: 1 }, { unique: true });
hotelSavedPropertySchema.index({ userId: 1, createdAt: -1 });

export const HotelSavedProperty = mongoose.models.HotelSavedProperty
    || mongoose.model('HotelSavedProperty', hotelSavedPropertySchema);
