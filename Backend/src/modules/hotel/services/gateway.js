// Razorpay, as the hotel booking service sees it: one small adapter over the core
// credentials (Master settings, else .env -- core/settings/platformProfile.service.js)
// and the food Razorpay helper, so tests can swap the network calls at this boundary
// (__setHotelGatewayForTests) while signatures are still checked for real.
//
// Dev fallback: outside production, when no Razorpay keys are configured, orders are
// mock ("mock_order_…") and verify accepts the food helper's mock signature
// ("mock_signature_bypass"), so the frontends can be built without keys. Production
// never takes that path (same rule as the food helper's MOCK_GATEWAY_ALLOWED).

import { config } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import {
    getRazorpayInstance,
    getRazorpayKeyId,
    isRazorpayConfigured,
    verifyPaymentSignature,
} from '../../food/orders/helpers/razorpay.helper.js';

const errorMessage = (err) =>
    err?.error?.description || err?.error?.message || err?.description || err?.message || 'Razorpay request failed';

const mockAllowed = () => config.nodeEnv !== 'production' && !isRazorpayConfigured();
const isMockOrder = (orderId) => String(orderId || '').startsWith('mock_order_');

const razorpay = {
    keyId: () => (isRazorpayConfigured() ? getRazorpayKeyId() : 'rzp_test_mock'),

    /** @returns {{ id, amount, currency }} amount in paise */
    async createOrder({ amountPaise, receipt, notes }) {
        if (mockAllowed()) {
            logger.warn('[hotel] Razorpay not configured: issuing a mock order (non-production only)');
            return { id: `mock_order_${Date.now()}${Math.random().toString(36).slice(2, 6)}`, amount: amountPaise, currency: 'INR' };
        }
        const instance = getRazorpayInstance();
        if (!instance) throw Object.assign(new Error('Online payment is not available right now'), { statusCode: 503 });
        try {
            return await instance.orders.create({ amount: amountPaise, currency: 'INR', receipt, notes });
        } catch (err) {
            throw Object.assign(new Error(`Payment gateway error: ${errorMessage(err)}`), { statusCode: 502 });
        }
    },

    verifySignature: (orderId, paymentId, signature) => verifyPaymentSignature(orderId, paymentId, signature),

    /**
     * The payment as the gateway reports it: { id, order_id, status, amount (paise) }.
     * Mock orders (dev without keys) report a capture of the expected amount.
     */
    async fetchPayment(paymentId, { orderId, expectedPaise } = {}) {
        if (isMockOrder(orderId) && config.nodeEnv !== 'production') {
            return { id: paymentId, order_id: orderId, status: 'captured', amount: expectedPaise, mock: true };
        }
        const instance = getRazorpayInstance();
        if (!instance) throw Object.assign(new Error('Online payment is not available right now'), { statusCode: 503 });
        try {
            return await instance.payments.fetch(String(paymentId));
        } catch (err) {
            throw Object.assign(new Error(`Could not confirm the payment with the gateway: ${errorMessage(err)}`), { statusCode: 502 });
        }
    },

    /** @returns {{ id, status }} */
    async refund(paymentId, amountRupees, notes = {}) {
        if (config.nodeEnv !== 'production' && String(paymentId || '').startsWith('mock_')) {
            return { id: `mock_rfnd_${Date.now()}`, status: 'processed' };
        }
        const instance = getRazorpayInstance();
        if (!instance) throw new Error('Razorpay is not configured');
        try {
            return await instance.payments.refund(String(paymentId), {
                amount: Math.round(Number(amountRupees) * 100),
                speed: 'normal',
                notes,
            });
        } catch (err) {
            throw new Error(errorMessage(err));
        }
    },
};

let impl = razorpay;

/** The adapter in use. */
export const gateway = new Proxy({}, { get: (_, key) => impl[key] });

/** Tests only: replace some or all gateway calls; call with no argument to restore. */
export const __setHotelGatewayForTests = (fake) => {
    impl = fake ? { ...razorpay, ...fake } : razorpay;
};
