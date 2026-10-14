import mongoose from 'mongoose';

// One review per completed stay. Tying it to a booking (required + unique) is what
// stops reviews from people who never stayed, which the source app allowed.

const subRating = { type: Number, min: 1, max: 5 };

const hotelReviewSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', required: true },
        propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelProperty', required: true },
        bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelBooking', required: true },
        rating: { type: Number, min: 1, max: 5, required: true },
        subRatings: {
            cleanliness: subRating,
            location: subRating,
            service: subRating,
            value: subRating,
        },
        comment: { type: String, trim: true, maxlength: 2000, default: '' },
        photos: { type: [String], default: [] },
        reply: {
            text: { type: String, trim: true, maxlength: 1000 },
            at: Date,
        },
        helpfulVotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser' }],
        status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
    },
    { collection: 'hotel_reviews', timestamps: true },
);

hotelReviewSchema.index({ bookingId: 1 }, { unique: true });
hotelReviewSchema.index({ propertyId: 1, status: 1, createdAt: -1 });
hotelReviewSchema.index({ userId: 1, createdAt: -1 });

export const HotelReview = mongoose.models.HotelReview || mongoose.model('HotelReview', hotelReviewSchema);
