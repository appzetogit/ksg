// Phase 5 routes: money, reviews, saved, voucher (docs/hotel-api-contract.md, Phase 4-5).
//
// Mounted by ./index.js. Middleware is attached PER ROUTE on purpose: this router sits
// in front of the booking workstream's /user and /partner routes, so a router-level
// auth guard here would intercept (and 401/403) requests meant for them.
//
// Importing this file also registers the settlement and notification listeners on
// services/bookingEvents.js.

import express from 'express';
import { authMiddleware } from '../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../core/roles/role.middleware.js';
import { requireApprovedHotelPartner } from '../middleware/hotelAuth.js';
import '../services/settlement.listener.js';
import '../services/notifications.listener.js';
import * as money from '../controllers/money.controller.js';
import * as reviews from '../controllers/review.controller.js';
import * as extras from '../controllers/userExtras.controller.js';

const customer = [authMiddleware, requireRoles('USER')];
const partner = [authMiddleware, requireApprovedHotelPartner];

/** Public, customer and partner routes. */
export const moneyRouter = express.Router();

// Public
moneyRouter.get('/public/properties/:id/reviews', reviews.publicReviews);

// Customer. The voucher authenticates itself (header or ?token=) so it can open in a tab.
moneyRouter.get('/user/bookings/:id/voucher', extras.voucher);
// A short-lived, single-booking link for the voucher tab (instead of ?token=<session>).
moneyRouter.post('/user/bookings/:id/voucher-link', ...customer, extras.voucherLink);
moneyRouter.post('/user/reviews', ...customer, reviews.createReview);
moneyRouter.get('/user/saved', ...customer, extras.listSaved);
moneyRouter.post('/user/saved/:propertyId', ...customer, extras.saveProperty);
moneyRouter.delete('/user/saved/:propertyId', ...customer, extras.unsaveProperty);

// Partner (approved)
moneyRouter.get('/partner/earnings', ...partner, money.earnings);
moneyRouter.get('/partner/ledger', ...partner, money.ledger);
moneyRouter.post('/partner/withdrawals', ...partner, money.requestWithdrawal);
moneyRouter.get('/partner/withdrawals', ...partner, money.listMyWithdrawals);
moneyRouter.get('/partner/reviews', ...partner, reviews.partnerReviews);
moneyRouter.post('/partner/reviews/:id/reply', ...partner, reviews.replyToReview);

/** Admin routes; mounted inside the guarded admin router (ADMIN + hotel access). */
export const moneyAdminRouter = express.Router();
moneyAdminRouter.get('/reviews', reviews.adminReviews);
moneyAdminRouter.put('/reviews/:id/status', reviews.adminSetReviewStatus);
moneyAdminRouter.get('/withdrawals', money.adminListWithdrawals);
moneyAdminRouter.put('/withdrawals/:id/status', money.adminSetWithdrawalStatus);
