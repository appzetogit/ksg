// Hotel settings the money workstream reads (settlement, withdrawals, reviews).
//
// The settings service (services/settings.service.js, HotelSettings in
// docs/hotel-api-contract.md) is owned by the booking workstream. When it exists its
// values win; until then the contract defaults below apply.
// TODO: switch to settings.service.js once it lands (drop the defaults copy then).

import { logger } from '../../../utils/logger.js';

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

let settingsModule; // undefined = not tried yet, null = not available

const loadSettingsModule = async () => {
    if (settingsModule !== undefined) return settingsModule;
    try {
        settingsModule = await import('./settings.service.js');
    } catch {
        settingsModule = null;
    }
    return settingsModule;
};

/** Current settings: the settings service's values over the contract defaults. */
export const getMoneySettings = async () => {
    const mod = await loadSettingsModule();
    const getter = mod && (mod.getHotelSettings || mod.getSettings || mod.default?.getHotelSettings);
    if (typeof getter === 'function') {
        try {
            const s = await getter();
            if (s && typeof s === 'object') {
                const out = { ...MONEY_SETTING_DEFAULTS, ...s };
                if (!SETTLE_ORDER.includes(out.settleOn)) out.settleOn = MONEY_SETTING_DEFAULTS.settleOn;
                return out;
            }
        } catch (err) {
            logger.warn(`[hotel] settings read failed, using defaults: ${err.message}`);
        }
    }
    return { ...MONEY_SETTING_DEFAULTS };
};
