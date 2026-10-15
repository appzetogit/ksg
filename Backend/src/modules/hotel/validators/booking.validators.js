import { z } from 'zod';
import { PAY_MODES } from '../services/pricing.service.js';

const objectId = (name) => z.string({ required_error: `${name} is required` }).trim().regex(/^[a-f\d]{24}$/i, `${name} is not a valid id`);
const date = (name) => z.string({ required_error: `${name} is required` }).trim().regex(/^\d{4}-\d{2}-\d{2}$/, `${name} must be YYYY-MM-DD`);
const int = (min, max) => z.coerce.number().int().min(min).max(max);

// Unknown fields (e.g. client-side prices) are stripped, never trusted.
export const quoteSchema = z.object({
    propertyId: objectId('propertyId'),
    roomTypeId: objectId('roomTypeId'),
    checkIn: date('checkIn'),
    checkOut: date('checkOut'),
    rooms: int(1, 20).default(1),
    adults: int(1, 100).default(2),
    children: int(0, 50).default(0),
    paymentMode: z.enum(PAY_MODES),
    couponCode: z.string().trim().max(40).nullable().optional(),
});

const phone = z.string().trim()
    .transform((s) => s.replace(/[\s-]/g, ''))
    .refine((s) => /^(\+?91)?[6-9]\d{9}$/.test(s), 'guestDetails.phone must be a valid 10-digit mobile number')
    .transform((s) => s.slice(-10));

export const createBookingSchema = quoteSchema.extend({
    guestDetails: z.object({
        name: z.string().trim().min(2).max(80),
        phone,
        email: z.union([z.string().trim().toLowerCase().email().max(120), z.literal('')]).optional(),
    }),
    specialRequests: z.string().trim().max(500).optional(),
    useWallet: z.boolean().optional().default(false),
});

export const verifyPaymentSchema = z.object({
    razorpayOrderId: z.string().trim().min(1).max(100),
    razorpayPaymentId: z.string().trim().min(1).max(100),
    razorpaySignature: z.string().trim().min(1).max(200),
});

export const reasonSchema = z.object({ reason: z.string().trim().max(500).optional() });
export const partnerCancelSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const checkOutSchema = z.object({ force: z.boolean().optional() });
export const markPaidSchema = z.object({ amount: z.number().finite().positive().max(10000000) });

export const adminStatusSchema = z.object({
    status: z.enum(['checked_in', 'checked_out', 'no_show', 'cancelled']),
    reason: z.string().trim().max(500).optional(),
    force: z.boolean().optional(),
});
export const adminRefundSchema = z.object({
    amount: z.number().finite().positive().max(10000000),
    reason: z.string().trim().min(3).max(500),
});

const paging = {
    page: int(1, 100000).optional(),
    limit: int(1, 100).optional(),
};
export const userListSchema = z.object({
    tab: z.enum(['upcoming', 'ongoing', 'past', 'cancelled']).optional(),
    ...paging,
});
const BOOKING_STATUS = z.enum(['awaiting_payment', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show', 'expired']);
export const partnerListSchema = z.object({
    status: BOOKING_STATUS.optional(),
    propertyId: objectId('propertyId').optional(),
    from: date('from').optional(),
    to: date('to').optional(),
    q: z.string().trim().max(100).optional(),
    ...paging,
});
export const adminListSchema = partnerListSchema.extend({
    partnerId: objectId('partnerId').optional(),
});
