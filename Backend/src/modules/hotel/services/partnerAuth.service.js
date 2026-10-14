import ms from 'ms';
import { config } from '../../../config/env.js';
import { createOrUpdateOtp, verifyOtp } from '../../../core/otp/otp.service.js';
import { signAccessToken, signRefreshToken } from '../../../core/auth/token.util.js';
import { FoodRefreshToken } from '../../../core/refreshTokens/refreshToken.model.js';
import { ensurePlatformUser, toTenDigits } from '../../../core/identity/identityLink.service.js';
import { AuthError, ForbiddenError, ValidationError } from '../../../core/auth/errors.js';
import { logger } from '../../../utils/logger.js';
import { HotelPartner } from '../models/hotelPartner.model.js';
import { HOTEL_PARTNER_ROLE } from '../constants.js';

// Hotel partners sign in with a phone OTP. The first successful verification creates
// the partner in `pending`, so onboarding (KYC, first property) happens while logged
// in; an admin approves the partner before any property can go live.

const OTP_SCOPE = 'hotel_partner';
const OTP_SERVICE = 'hotel';

const issueTokens = async (partner) => {
    const payload = { userId: partner._id.toString(), role: HOTEL_PARTNER_ROLE };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    const expiresAt = new Date(Date.now() + ms(config.jwtRefreshExpiresIn || '7d'));
    await FoodRefreshToken.create({ userId: partner._id, token: refreshToken, expiresAt });
    return { accessToken, refreshToken };
};

export const requestPartnerOtp = async (rawPhone) => {
    const phone = toTenDigits(rawPhone);
    if (!phone) throw new ValidationError('A valid 10-digit phone number is required');

    const existing = await HotelPartner.findOne({ phone }).select('status isDeleted').lean();
    if (existing?.isDeleted || existing?.status === 'blocked') {
        throw new ForbiddenError('This partner account is not active. Please contact support.');
    }

    const otp = await createOrUpdateOtp(phone, OTP_SCOPE, { service: OTP_SERVICE });
    // The code is only echoed back outside production; there it goes by SMS only.
    return {
        phone,
        isExistingPartner: Boolean(existing),
        ...(config.nodeEnv !== 'production' ? { otp } : {}),
    };
};

export const verifyPartnerOtp = async (rawPhone, otp, { fcmToken, platform } = {}) => {
    const phone = toTenDigits(rawPhone);
    if (!phone) throw new ValidationError('A valid 10-digit phone number is required');

    const result = await verifyOtp(phone, otp, OTP_SCOPE);
    if (!result.valid) throw new AuthError(result.reason || 'OTP verification failed');

    let partner = await HotelPartner.findOne({ phone });
    let isNewPartner = false;

    if (!partner) {
        partner = new HotelPartner({ phone, status: 'pending' });
        isNewPartner = true;
    }
    if (partner.isDeleted || partner.status === 'blocked') {
        throw new ForbiddenError('This partner account is not active. Please contact support.');
    }

    // Link to the platform identity (users), like QC sellers and SP vendors.
    if (!partner.platformUserId) {
        try {
            partner.platformUserId = await ensurePlatformUser({ phone, name: partner.name || undefined });
        } catch (err) {
            logger.warn(`[hotel] platform user link failed for partner ${phone}: ${err.message}`);
        }
    }

    if (fcmToken) {
        const bucket = platform === 'mobile' ? 'app' : 'web';
        if (!partner.fcmTokens?.[bucket]?.includes(fcmToken)) {
            partner.fcmTokens[bucket] = [...(partner.fcmTokens?.[bucket] || []), fcmToken].slice(-5);
        }
    }
    partner.lastLoginAt = new Date();
    await partner.save();

    const tokens = await issueTokens(partner);
    return { ...tokens, partner: partner.toPartnerJSON(), isNewPartner };
};
