import { z } from 'zod';
import { ValidationError } from '../../../core/auth/errors.js';

const phone = z.string().trim().min(10).max(16);

export const requestOtpSchema = z.object({ phone });

export const verifyOtpSchema = z.object({
    phone,
    otp: z.string().trim().regex(/^\d{4,6}$/, 'OTP must be 4-6 digits'),
    fcmToken: z.string().trim().max(512).optional(),
    platform: z.enum(['web', 'mobile']).optional(),
});

// Full ID and account numbers are never stored: at most the last 4 digits may show.
const masked = (label) => z.string().trim().max(32).refine(
    (v) => (v.match(/\d/g) || []).length <= 4,
    `${label} must be masked, showing at most the last 4 digits (e.g. XXXXXXXX1234)`,
);

// What a partner may change about themselves. Status, approval and platform links are
// admin- or system-owned and are not accepted here.
export const updateProfileSchema = z.object({
    name: z.string().trim().min(2).max(80).optional(),
    email: z.string().trim().email().max(120).optional(),
    kyc: z.object({
        ownerName: z.string().trim().max(80).optional(),
        aadhaarNumberMasked: masked('Aadhaar number').optional(),
        aadhaarFront: z.string().trim().max(500).optional(),
        aadhaarBack: z.string().trim().max(500).optional(),
        panNumber: z.string().trim().regex(/^[A-Za-z]{5}\d{4}[A-Za-z]$/, 'Invalid PAN').optional(),
        panImage: z.string().trim().max(500).optional(),
        gstNumber: z.string().trim().regex(/^\d{2}[A-Za-z0-9]{13}$/, 'Invalid GSTIN').optional(),
        gstCertificate: z.string().trim().max(500).optional(),
    }).partial().optional(),
    bank: z.object({
        accountHolder: z.string().trim().max(80).optional(),
        accountNumberMasked: masked('Account number').optional(),
        ifsc: z.string().trim().regex(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, 'Invalid IFSC').optional(),
        bankName: z.string().trim().max(80).optional(),
    }).partial().optional(),
    address: z.object({
        line: z.string().trim().max(200).optional(),
        city: z.string().trim().max(80).optional(),
        state: z.string().trim().max(80).optional(),
        pincode: z.string().trim().regex(/^\d{6}$/, 'Invalid pincode').optional(),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
    }).partial().optional(),
    acceptTerms: z.literal(true).optional(),
}).strict();

/** Parse or throw a 400 with the first issue's message. */
export const parse = (schema, data) => {
    const result = schema.safeParse(data ?? {});
    if (!result.success) {
        const issue = result.error.issues[0];
        const field = issue?.path?.join('.');
        throw new ValidationError(field ? `${field}: ${issue.message}` : issue?.message || 'Invalid request');
    }
    return result.data;
};
