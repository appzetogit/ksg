// Hotel coupons (phase 9). Contract: docs/hotel-api-contract.md "Phase 9: coupons".
// Logic: services/offer.service.js.

import { sendResponse } from '../../../utils/response.js';
import * as offers from '../services/offer.service.js';

const handle = (fn) => async (req, res, next) => {
    try {
        return await fn(req, res);
    } catch (err) {
        return next(err);
    }
};

// ─── admin ────────────────────────────────────────────────────────────────

export const adminList = handle(async (req, res) =>
    sendResponse(res, 200, 'Hotel coupons', await offers.listOffers(req.query)));

export const adminGet = handle(async (req, res) =>
    sendResponse(res, 200, 'Hotel coupon', await offers.getOffer(req.params.id)));

export const adminCreate = handle(async (req, res) =>
    sendResponse(res, 201, 'Coupon created', await offers.createOffer(req.body, req.user?.userId)));

export const adminUpdate = handle(async (req, res) =>
    sendResponse(res, 200, 'Coupon updated', await offers.updateOffer(req.params.id, req.body)));

export const adminDelete = handle(async (req, res) =>
    sendResponse(res, 200, 'Coupon deleted', await offers.deleteOffer(req.params.id)));

// ─── customer ─────────────────────────────────────────────────────────────

export const userList = handle(async (req, res) =>
    sendResponse(res, 200, 'Offers', await offers.userOffers({ userId: req.user.userId, propertyId: req.query.propertyId })));
