// Phase-4 booking routes, mounted by routes/index.js:
//   userBookingRouter     at /user          (auth applied per route, so other /user/*
//                                            routes -- e.g. the voucher's ?token= -- are
//                                            not forced through it)
//   partnerBookingRouter  on the partner router (already authenticated as a hotel partner)
//   adminBookingRouter    on the admin router   (already ADMIN + 'hotel' access)

import express from 'express';
import { authMiddleware } from '../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../core/roles/role.middleware.js';
import { requireApprovedHotelPartner } from '../middleware/hotelAuth.js';
import * as c from '../controllers/booking.controller.js';

const customer = [authMiddleware, requireRoles('USER')];

export const userBookingRouter = express.Router();
userBookingRouter.post('/bookings/quote', ...customer, c.quote);
userBookingRouter.post('/bookings', ...customer, c.create);
userBookingRouter.get('/bookings', ...customer, c.listMine);
userBookingRouter.get('/bookings/:id', ...customer, c.getMine);
userBookingRouter.post('/bookings/:id/verify-payment', ...customer, c.verifyPayment);
userBookingRouter.post('/bookings/:id/retry-payment', ...customer, c.retryPayment);
userBookingRouter.get('/bookings/:id/cancel-preview', ...customer, c.cancelPreview);
userBookingRouter.post('/bookings/:id/cancel', ...customer, c.cancelMine);

export const partnerBookingRouter = express.Router();
partnerBookingRouter.get('/bookings', requireApprovedHotelPartner, c.partnerList);
partnerBookingRouter.get('/bookings/:id', requireApprovedHotelPartner, c.partnerGet);
partnerBookingRouter.put('/bookings/:id/check-in', requireApprovedHotelPartner, c.partnerCheckIn);
partnerBookingRouter.put('/bookings/:id/check-out', requireApprovedHotelPartner, c.partnerCheckOut);
partnerBookingRouter.put('/bookings/:id/no-show', requireApprovedHotelPartner, c.partnerNoShow);
partnerBookingRouter.put('/bookings/:id/mark-paid', requireApprovedHotelPartner, c.partnerMarkPaid);
partnerBookingRouter.put('/bookings/:id/cancel', requireApprovedHotelPartner, c.partnerCancel);

export const adminBookingRouter = express.Router();
adminBookingRouter.get('/bookings', c.adminList);
adminBookingRouter.get('/bookings/:id', c.adminGet);
adminBookingRouter.put('/bookings/:id/status', c.adminSetStatus);
adminBookingRouter.post('/bookings/:id/refund', c.adminRefund);
adminBookingRouter.get('/settings', c.adminGetSettings);
adminBookingRouter.put('/settings', c.adminPutSettings);
