// Phase-9 coupon routes, mounted by routes/index.js:
//   userOfferRouter   at /user (auth per route, like userBookingRouter)
//   adminOfferRouter  on the admin router (already ADMIN + 'hotel' access)

import express from 'express';
import { authMiddleware } from '../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../core/roles/role.middleware.js';
import * as c from '../controllers/offer.controller.js';

export const userOfferRouter = express.Router();
userOfferRouter.get('/offers', authMiddleware, requireRoles('USER'), c.userList);

export const adminOfferRouter = express.Router();
adminOfferRouter.get('/offers', c.adminList);
adminOfferRouter.post('/offers', c.adminCreate);
adminOfferRouter.get('/offers/:id', c.adminGet);
adminOfferRouter.put('/offers/:id', c.adminUpdate);
adminOfferRouter.delete('/offers/:id', c.adminDelete);
