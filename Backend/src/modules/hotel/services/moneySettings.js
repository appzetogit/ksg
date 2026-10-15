// Hotel settings the money workstream reads (settlement, withdrawals, reviews), from
// the shared settings service (services/settings.service.js, one hotel_settings
// document). The defaults below are only used if that read fails.

import { logger } from '../../../utils/logger.js';
import { getHotelSettings } from './settings.service.js';

export const MONEY_SETTING_DEFAULTS = Object.freeze({
    minWithdrawal: 500,
    settleOn: 'checked_out',
    reviewAutoApprove: true,
    commissionPercent: 10,
    minCommission: 50,
    commissionGstPercent: 18,
});

// Statuses after which a booking can be settled, in lifecycle order.
export const SETTLE_ORDER = Object.freeze(['confirmed', 'checked_in', 'checked_out']);

/** Current settings: the settings service's values over the contract defaults. */
export const getMoneySettings = async () => {
    try {
        const s = await getHotelSettings();
        const out = { ...MONEY_SETTING_DEFAULTS, ...(s || {}) };
        if (!SETTLE_ORDER.includes(out.settleOn)) out.settleOn = MONEY_SETTING_DEFAULTS.settleOn;
        return out;
    } catch (err) {
        logger.warn(`[hotel] settings read failed, using defaults: ${err.message}`);
        return { ...MONEY_SETTING_DEFAULTS };
    }
};
