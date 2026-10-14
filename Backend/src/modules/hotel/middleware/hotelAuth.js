import { sendError } from '../../../utils/response.js';
import { HOTEL_PARTNER_ROLE } from '../constants.js';

// Run after core authMiddleware, which has already verified the token and refused a
// blocked, rejected or deleted partner (see lookupAccount there).

/** Any signed-in hotel partner, including one still pending approval (onboarding). */
export const requireHotelPartner = (req, res, next) => {
    if (req.user?.role !== HOTEL_PARTNER_ROLE) {
        return sendError(res, 403, 'Hotel partner access required');
    }
    return next();
};

/** An approved hotel partner: anything that affects guests or money. */
export const requireApprovedHotelPartner = (req, res, next) => {
    if (req.user?.role !== HOTEL_PARTNER_ROLE) {
        return sendError(res, 403, 'Hotel partner access required');
    }
    if (req.user.accountStatus !== 'approved') {
        return sendError(res, 403, 'Your hotel partner account is pending approval.');
    }
    return next();
};
