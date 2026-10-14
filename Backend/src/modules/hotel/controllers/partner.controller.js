import { sendResponse } from '../../../utils/response.js';
import { NotFoundError } from '../../../core/auth/errors.js';
import { invalidateAccountCache } from '../../../core/auth/auth.middleware.js';
import { HotelPartner } from '../models/hotelPartner.model.js';
import { HOTEL_PARTNER_ROLE } from '../constants.js';
import { requestPartnerOtp, verifyPartnerOtp } from '../services/partnerAuth.service.js';
import { parse, requestOtpSchema, verifyOtpSchema, updateProfileSchema } from '../validators/partner.validators.js';

export const requestOtpController = async (req, res, next) => {
    try {
        const { phone } = parse(requestOtpSchema, req.body);
        const result = await requestPartnerOtp(phone);
        return sendResponse(res, 200, 'OTP sent successfully', result);
    } catch (err) {
        return next(err);
    }
};

export const verifyOtpController = async (req, res, next) => {
    try {
        const { phone, otp, fcmToken, platform } = parse(verifyOtpSchema, req.body);
        const result = await verifyPartnerOtp(phone, otp, { fcmToken, platform });
        return sendResponse(res, 200, 'Login successful', result);
    } catch (err) {
        return next(err);
    }
};

const loadSelf = async (req) => {
    const partner = await HotelPartner.findById(req.user.userId);
    if (!partner || partner.isDeleted) throw new NotFoundError('Partner account not found');
    return partner;
};

export const getMeController = async (req, res, next) => {
    try {
        const partner = await loadSelf(req);
        return sendResponse(res, 200, 'Partner profile', { partner: partner.toPartnerJSON() });
    } catch (err) {
        return next(err);
    }
};

export const updateMeController = async (req, res, next) => {
    try {
        const body = parse(updateProfileSchema, req.body);
        const partner = await loadSelf(req);

        if (body.name !== undefined) partner.name = body.name;
        if (body.email !== undefined) partner.email = body.email;
        if (body.kyc) partner.kyc = { ...(partner.kyc?.toObject?.() || partner.kyc || {}), ...body.kyc };
        if (body.bank) partner.bank = { ...(partner.bank?.toObject?.() || partner.bank || {}), ...body.bank };
        if (body.address) {
            const { lat, lng, ...rest } = body.address;
            const current = partner.address?.toObject?.() || partner.address || {};
            partner.address = {
                ...current,
                ...rest,
                ...(lat !== undefined && lng !== undefined
                    ? { location: { type: 'Point', coordinates: [lng, lat] } }
                    : {}),
            };
        }
        if (body.acceptTerms && !partner.termsAcceptedAt) partner.termsAcceptedAt = new Date();

        // A rejected partner who fixes their details goes back into the review queue.
        if (partner.status === 'rejected') {
            partner.status = 'pending';
            partner.rejectionReason = '';
            invalidateAccountCache(HOTEL_PARTNER_ROLE, String(partner._id));
        }

        await partner.save();
        return sendResponse(res, 200, 'Profile updated', { partner: partner.toPartnerJSON() });
    } catch (err) {
        if (err?.code === 11000) {
            err.statusCode = 409;
            err.message = 'That email is already used by another partner account';
        }
        return next(err);
    }
};
