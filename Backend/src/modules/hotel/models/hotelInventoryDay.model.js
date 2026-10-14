import mongoose from 'mongoose';

// One row per room type per night. `booked` is incremented with a conditional update
// (booked + n <= capacity) inside a transaction, which is what makes two guests
// unable to book the last room at the same moment. The source app checked
// availability and inserted the booking as two separate steps, so it could oversell.

const hotelInventoryDaySchema = new mongoose.Schema(
    {
        propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelProperty', required: true },
        roomTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelRoomType', required: true },
        date: { type: Date, required: true }, // the night, 00:00 IST
        booked: { type: Number, min: 0, default: 0 },
        capacity: { type: Number, min: 0, required: true },
        priceOverride: { type: Number, min: 0 }, // seasonal / per-night rate
        closed: { type: Boolean, default: false }, // stop-sell
    },
    { collection: 'hotel_inventory_days', timestamps: true },
);

hotelInventoryDaySchema.index({ roomTypeId: 1, date: 1 }, { unique: true });
hotelInventoryDaySchema.index({ propertyId: 1, date: 1 });

export const HotelInventoryDay = mongoose.models.HotelInventoryDay
    || mongoose.model('HotelInventoryDay', hotelInventoryDaySchema);
