// Hotel module router, mounted by src/routes/index.js at /api/v1/hotel behind
// requireModuleEnabled(MODULES.HOTEL). Contract: docs/hotel-api-contract.md.
//
// Areas:
//   /public    no auth
//   /partner   hotel partners (role HOTEL_PARTNER); /partner/auth/* is open
//   /admin     platform admins with 'hotel' service access
//   /user      customers (booking phase)
//
// Every path is under /v1/hotel on purpose: the service-provider legacy delegation
// at the end of src/routes/index.js swallows bare /bookings, /payments, /users, ...

import express from 'express';
import '../models/index.js';
import { authMiddleware } from '../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../core/roles/role.middleware.js';
import { requireServiceAccess } from '../../../core/roles/serviceAccess.middleware.js';
import { authRateLimiter } from '../../../middleware/rateLimit.js';
import { requireHotelPartner, requireApprovedHotelPartner } from '../middleware/hotelAuth.js';
import {
    healthController,
    catalogueController,
    searchController,
    propertyDetailController,
    availabilityController,
    citiesController,
} from '../controllers/public.controller.js';
import {
    requestOtpController,
    verifyOtpController,
    getMeController,
    updateMeController,
} from '../controllers/partner.controller.js';
import * as partnerProps from '../controllers/partnerProperty.controller.js';
import * as partnerInv from '../controllers/partnerInventory.controller.js';
import * as admin from '../controllers/admin.controller.js';
import { moneyRouter, moneyAdminRouter } from './money.routes.js';

const router = express.Router();

// ─── Public ────────────────────────────────────────────────────────────────
router.get('/public/health', healthController);
router.get('/public/catalogue', catalogueController);
router.get('/public/cities', citiesController);
router.get('/public/properties', searchController);
router.get('/public/properties/:id/availability', availabilityController);
router.get('/public/properties/:idOrSlug', propertyDetailController);

// ─── Phase 5: money, reviews, saved, voucher (routes/money.routes.js) ──────
// Per-route guards; must stay ahead of the /user and /partner routers (voucher ?token=).
router.use(moneyRouter);

// ─── Partner ───────────────────────────────────────────────────────────────
router.post('/partner/auth/request-otp', authRateLimiter, requestOtpController);
router.post('/partner/auth/verify-otp', authRateLimiter, verifyOtpController);

const partner = express.Router();
partner.use(authMiddleware, requireHotelPartner);
partner.get('/me', getMeController);
partner.put('/me', updateMeController);

// Properties: a pending partner may build drafts and submit them.
partner.get('/properties', partnerProps.listProperties);
partner.post('/properties', partnerProps.createProperty);
partner.get('/properties/:id', partnerProps.getProperty);
partner.put('/properties/:id', partnerProps.updateProperty);
partner.delete('/properties/:id', partnerProps.deleteProperty);
partner.post('/properties/:id/room-types', partnerProps.createRoomType);
partner.put('/properties/:id/room-types/:roomTypeId', partnerProps.updateRoomType);
partner.delete('/properties/:id/room-types/:roomTypeId', partnerProps.deleteRoomType);
partner.put('/properties/:id/documents', partnerProps.putDocuments);
partner.post('/properties/:id/submit', partnerProps.submitProperty);
partner.put('/properties/:id/live', partnerProps.setLive); // checks approvals itself (403)

// Inventory and dashboard: approved partners only.
partner.get('/inventory', requireApprovedHotelPartner, partnerInv.getInventory);
partner.put('/inventory', requireApprovedHotelPartner, partnerInv.putInventory);
partner.get('/inventory/blocks', requireApprovedHotelPartner, partnerInv.listBlocks);
partner.post('/inventory/blocks', requireApprovedHotelPartner, partnerInv.createBlock);
partner.delete('/inventory/blocks/:id', requireApprovedHotelPartner, partnerInv.deleteBlock);
partner.get('/dashboard', requireApprovedHotelPartner, partnerInv.dashboard);
router.use('/partner', partner);

// ─── Admin ─────────────────────────────────────────────────────────────────
const adminRouter = express.Router();
adminRouter.use(authMiddleware, requireRoles('ADMIN'), requireServiceAccess('hotel'));
adminRouter.get('/overview', admin.overviewController);
adminRouter.get('/partners', admin.listPartners);
adminRouter.get('/partners/:id', admin.getPartner);
adminRouter.put('/partners/:id/status', admin.setPartnerStatus);
adminRouter.get('/properties', admin.listProperties);
adminRouter.get('/properties/:id', admin.getProperty);
adminRouter.put('/properties/:id/status', admin.setPropertyStatus);
adminRouter.put('/properties/:id/documents/verify', admin.verifyDocuments);
adminRouter.put('/properties/:id/live', admin.setPropertyLive);
adminRouter.use(moneyAdminRouter); // phase 5: reviews + withdrawals (routes/money.routes.js)
router.use('/admin', adminRouter);

export default router;
