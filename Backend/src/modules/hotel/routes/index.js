// Hotel module router, mounted by src/routes/index.js at /api/v1/hotel behind
// requireModuleEnabled(MODULES.HOTEL).
//
// Areas:
//   /public    no auth
//   /partner   hotel partners (role HOTEL_PARTNER); /partner/auth/* is open
//   /admin     platform admins with 'hotel' service access
//   /user      customers (phase 3-4)
//
// Every path is under /v1/hotel on purpose: the service-provider legacy delegation
// at the end of src/routes/index.js swallows bare /bookings, /payments, /users, ...

import express from 'express';
import '../models/index.js';
import { authMiddleware } from '../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../core/roles/role.middleware.js';
import { requireServiceAccess } from '../../../core/roles/serviceAccess.middleware.js';
import { authRateLimiter } from '../../../middleware/rateLimit.js';
import { requireHotelPartner } from '../middleware/hotelAuth.js';
import { healthController, catalogueController } from '../controllers/public.controller.js';
import {
    requestOtpController,
    verifyOtpController,
    getMeController,
    updateMeController,
} from '../controllers/partner.controller.js';
import { overviewController } from '../controllers/admin.controller.js';

const router = express.Router();

// ─── Public ────────────────────────────────────────────────────────────────
router.get('/public/health', healthController);
router.get('/public/catalogue', catalogueController);

// ─── Partner ───────────────────────────────────────────────────────────────
router.post('/partner/auth/request-otp', authRateLimiter, requestOtpController);
router.post('/partner/auth/verify-otp', authRateLimiter, verifyOtpController);

const partner = express.Router();
partner.use(authMiddleware, requireHotelPartner);
partner.get('/me', getMeController);
partner.put('/me', updateMeController);
router.use('/partner', partner);

// ─── Admin ─────────────────────────────────────────────────────────────────
const admin = express.Router();
admin.use(authMiddleware, requireRoles('ADMIN'), requireServiceAccess('hotel'));
admin.get('/overview', overviewController);
router.use('/admin', admin);

export default router;
