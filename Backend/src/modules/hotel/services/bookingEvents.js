import { EventEmitter } from 'node:events';
import { logger } from '../../../utils/logger.js';

// Hotel booking events (docs/hotel-api-contract.md, "Internal backend interface").
//
// The booking service emits after each DB commit:
//   'transition' { booking, from, to, actor }   every status change, creation has from: null
//   'payment'    { booking, amount, kind, paymentId? }
//   'refund'     { booking, amount, walletAmount, gatewayAmount, refundId? }
//
// Settlement, notifications and other side effects subscribe here instead of being
// called inline, so a failing listener can never undo or block a booking.

export const bookingEvents = new EventEmitter();
bookingEvents.setMaxListeners(50);

/** Subscribe with the error isolation every listener needs. */
export const onBookingEvent = (event, name, handler) => {
    bookingEvents.on(event, (payload) => {
        Promise.resolve()
            .then(() => handler(payload))
            .catch((err) => logger.error(`[hotel:${name}] ${event} listener failed: ${err?.message || err}`));
    });
};
