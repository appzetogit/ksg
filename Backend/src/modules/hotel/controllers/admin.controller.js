import { sendResponse } from '../../../utils/response.js';
import { HotelPartner, HotelProperty, HotelBooking } from '../models/index.js';

const countBy = async (Model, field, match = {}) => {
    const rows = await Model.aggregate([{ $match: match }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]);
    return Object.fromEntries(rows.map((r) => [r._id ?? 'unknown', r.n]));
};

// Phase 1: counts only, so the admin panel can show the vertical is wired up.
// The full dashboard (revenue, occupancy, queues) arrives with the admin phase.
export const overviewController = async (req, res, next) => {
    try {
        const [partners, properties, bookings] = await Promise.all([
            countBy(HotelPartner, 'status', { isDeleted: { $ne: true } }),
            countBy(HotelProperty, 'status', { isDeleted: { $ne: true } }),
            countBy(HotelBooking, 'status'),
        ]);
        return sendResponse(res, 200, 'Hotel overview', { partners, properties, bookings });
    } catch (err) {
        return next(err);
    }
};
