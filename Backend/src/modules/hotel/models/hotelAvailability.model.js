import mongoose from 'mongoose';
import { AVAILABILITY_SOURCES } from '../constants.js';

// Human-readable record of everything holding inventory: platform bookings, walk-ins,
// bookings from other sites and manual blocks. The atomic counter that actually
// prevents overselling is hotel_inventory_days; both are written in one transaction.
//
// Dates are nights at 00:00 IST; endDate is the check-out date and is exclusive.

const hotelAvailabilitySchema = new mongoose.Schema(
    {
        propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelProperty', required: true },
        roomTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelRoomType', required: true },
        source: { type: String, enum: AVAILABILITY_SOURCES, required: true },
        bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelBooking' },
        externalPlatform: { type: String, trim: true },
        externalReference: { type: String, trim: true },
        startDate: { type: Date, required: true },
        endDate: { type: Date, required: true },
        units: { type: Number, min: 1, required: true },
        notes: { type: String, trim: true, maxlength: 500 },
        createdBy: { type: String, enum: ['system', 'partner', 'admin'], default: 'system' },
    },
    { collection: 'hotel_availability_ledger', timestamps: true },
);

hotelAvailabilitySchema.path('endDate').validate(function afterStart(v) {
    return this.startDate && v > this.startDate;
}, 'endDate must be after startDate');

hotelAvailabilitySchema.index({ roomTypeId: 1, startDate: 1, endDate: 1 });
hotelAvailabilitySchema.index({ propertyId: 1, startDate: 1 });
hotelAvailabilitySchema.index({ bookingId: 1 }, { unique: true, sparse: true });

export const HotelAvailability = mongoose.models.HotelAvailability
    || mongoose.model('HotelAvailability', hotelAvailabilitySchema);
