import mongoose from 'mongoose';
import { INVENTORY_TYPES, MEAL_PLANS, AMENITY_KEYS } from '../constants.js';

const hotelRoomTypeSchema = new mongoose.Schema(
    {
        propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelProperty', required: true },
        name: { type: String, required: true, trim: true, maxlength: 80 },
        description: { type: String, trim: true, maxlength: 1000, default: '' },

        // Must be allowed for the property's type (constants.ALLOWED_INVENTORY_TYPES);
        // checked by the room-type service, which knows the property.
        inventoryType: { type: String, enum: INVENTORY_TYPES, required: true },
        roomCategory: { type: String, enum: ['private', 'shared', 'entire'] },

        baseAdults: { type: Number, min: 1, default: 2 },
        baseChildren: { type: Number, min: 0, default: 0 },
        maxAdults: { type: Number, min: 1, required: true },
        maxChildren: { type: Number, min: 0, default: 0 },
        bedsPerRoom: { type: Number, min: 1, default: 1 },
        // Rooms for 'room', rooms of beds for 'bed' (sellable units = this x bedsPerRoom),
        // always 1 for 'entire'.
        totalInventory: { type: Number, min: 1, required: true },

        pricePerNight: { type: Number, min: 0, required: true },
        originalPrice: { type: Number, min: 0 },
        weekendPrice: { type: Number, min: 0 }, // Fri and Sat nights, when set
        extraAdultPrice: { type: Number, min: 0, default: 0 },
        extraChildPrice: { type: Number, min: 0, default: 0 },
        mealPlan: { type: String, enum: MEAL_PLANS, default: 'room_only' },

        images: {
            type: [String],
            default: [],
            validate: { validator: (list) => list.length >= 3, message: 'At least 3 room photos are required' },
        },
        amenities: {
            type: [String],
            default: [],
            validate: {
                validator: (list) => list.every((a) => AMENITY_KEYS.includes(a)),
                message: 'Unknown amenity',
            },
        },
        isActive: { type: Boolean, default: true },
        isDeleted: { type: Boolean, default: false },
    },
    { collection: 'hotel_room_types', timestamps: true },
);

hotelRoomTypeSchema.path('maxAdults').validate(function maxAtLeastBase(v) {
    return v >= (this.baseAdults || 1);
}, 'maxAdults cannot be less than baseAdults');

hotelRoomTypeSchema.path('totalInventory').validate(function entireIsOne(v) {
    return this.inventoryType !== 'entire' || v === 1;
}, 'An entire-property listing has exactly one unit');

hotelRoomTypeSchema.index({ propertyId: 1, isActive: 1 });

/** Units sellable per night: beds for a bed listing, otherwise rooms. */
hotelRoomTypeSchema.methods.sellableUnits = function sellableUnits() {
    return this.inventoryType === 'bed' ? this.totalInventory * (this.bedsPerRoom || 1) : this.totalInventory;
};

export const HotelRoomType = mongoose.models.HotelRoomType || mongoose.model('HotelRoomType', hotelRoomTypeSchema);
