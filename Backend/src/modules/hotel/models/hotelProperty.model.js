import mongoose from 'mongoose';
import {
    PROPERTY_TYPES,
    PROPERTY_STATUSES,
    SUITABILITY,
    CANCELLATION_POLICY_TYPES,
    AMENITY_KEYS,
    TIME_OF_DAY,
} from '../constants.js';

const pointSchema = new mongoose.Schema(
    {
        type: { type: String, enum: ['Point'], default: 'Point', required: true },
        coordinates: {
            type: [Number], // [lng, lat]
            required: true,
            validate: {
                validator: (c) => Array.isArray(c) && c.length === 2
                    && c[0] >= -180 && c[0] <= 180 && c[1] >= -90 && c[1] <= 90,
                message: 'location.coordinates must be [lng, lat]',
            },
        },
    },
    { _id: false },
);

const hotelPropertySchema = new mongoose.Schema(
    {
        partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelPartner', required: true },
        name: { type: String, required: true, trim: true, maxlength: 120 },
        slug: { type: String, trim: true, lowercase: true },
        propertyType: { type: String, enum: PROPERTY_TYPES, required: true },

        typeDetails: {
            hotelCategory: { type: String, enum: ['budget', 'premium', 'luxury'] },
            starRating: { type: Number, min: 1, max: 5 },
            resortType: { type: String, enum: ['beach', 'hill', 'jungle', 'desert'] },
            pgType: { type: String, enum: ['boys', 'girls', 'unisex'] },
            hostelType: { type: String, enum: ['boys', 'girls', 'mixed'] },
            hostLivesOnProperty: Boolean,
        },
        suitability: { type: String, enum: SUITABILITY, default: 'none' },

        description: { type: String, trim: true, maxlength: 5000, default: '' },
        shortDescription: { type: String, trim: true, maxlength: 200, default: '' },
        contactNumber: { type: String, trim: true },

        address: {
            line1: { type: String, trim: true },
            area: { type: String, trim: true },
            city: { type: String, trim: true },
            state: { type: String, trim: true },
            pincode: { type: String, trim: true },
            country: { type: String, trim: true, default: 'India' },
            fullAddress: { type: String, trim: true },
        },
        // Optional on a draft (the wizard saves after the basics step); submit requires it.
        // Never store a Point without coordinates: leave the field unset instead.
        location: { type: pointSchema, default: undefined },
        zoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodZone' },
        nearbyPlaces: [
            {
                _id: false,
                name: { type: String, trim: true },
                type: { type: String, trim: true },
                distanceKm: { type: Number, min: 0 },
            },
        ],

        // Optional on a draft (the wizard saves before photos are uploaded); submit
        // refuses a property without a cover and at least 3 photos in total.
        coverImage: { type: String, trim: true, default: '' },
        images: { type: [String], default: [] },
        amenities: {
            type: [String],
            default: [],
            validate: {
                validator: (list) => list.every((a) => AMENITY_KEYS.includes(a)),
                message: 'Unknown amenity',
            },
        },
        houseRules: { type: [String], default: [] },
        checkInTime: { type: String, match: TIME_OF_DAY, default: '12:00' },
        checkOutTime: { type: String, match: TIME_OF_DAY, default: '11:00' },

        // Enforced by the cancellation service (the source kept this as free text).
        cancellationPolicy: {
            type: { type: String, enum: CANCELLATION_POLICY_TYPES, default: 'moderate' },
            freeCancelHours: { type: Number, min: 0, default: 24 },
            refundPercentAfter: { type: Number, min: 0, max: 100, default: 0 },
        },

        status: { type: String, enum: PROPERTY_STATUSES, default: 'draft' },
        rejectionReason: { type: String, default: '' },
        // Partner's own on/off switch; only takes effect once status is approved.
        isLive: { type: Boolean, default: false },
        approvedAt: Date,
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodAdmin' },

        // Denormalised for search and listing cards; maintained by the room-type service.
        startingPrice: { type: Number, min: 0 },
        originalPrice: { type: Number, min: 0 },
        avgRating: { type: Number, min: 0, max: 5, default: 0 },
        totalReviews: { type: Number, min: 0, default: 0 },

        isDeleted: { type: Boolean, default: false },
    },
    { collection: 'hotel_properties', timestamps: true },
);

hotelPropertySchema.index({ location: '2dsphere' });
hotelPropertySchema.index({ status: 1, isLive: 1, propertyType: 1 });
hotelPropertySchema.index({ 'address.city': 1 });
hotelPropertySchema.index({ partnerId: 1, createdAt: -1 });
hotelPropertySchema.index({ slug: 1 }, { unique: true, sparse: true });
hotelPropertySchema.index(
    { name: 'text', 'address.city': 'text', 'address.area': 'text' },
    { name: 'hotel_property_text', weights: { name: 5, 'address.city': 3, 'address.area': 2 } },
);

/** Publicly listable: approved, switched live, not deleted. */
hotelPropertySchema.statics.publicFilter = () => ({ status: 'approved', isLive: true, isDeleted: false });

export const HotelProperty = mongoose.models.HotelProperty || mongoose.model('HotelProperty', hotelPropertySchema);
