# KSG Stays (hotel) API reference for the Flutter apps

The complete, current API for the two Flutter clients:

- the **customer app** (the existing KSG customer app gets a "Hotels" section), and
- the **hotel partner app** (a separate app, or a partner section).

Every endpoint, field, limit and error below was checked against the backend code in
`Backend/src/modules/hotel/**` and the core auth / FCM / upload code it relies on. Where
this file disagrees with `docs/hotel-api-contract.md` or `HOTEL_INTEGRATION_PLAN.md`,
**this file describes what the server does today**. Example responses for public
endpoints were captured from the live server on 2026-10-17; the rest are built from the
serializers with the same demo data, so ids and amounts are consistent across the file.

Anything ambiguous or surprising is marked **⚠️ Note**.

The implementation plan for the Flutter team is in `docs/hotel-flutter-plan.md`.

| | |
|---|---|
| Base URL | `https://ksgsons.com/api/v1/hotel` (paths below are relative to it unless they start with `/api/v1/`) |
| Core auth | `https://ksgsons.com/api/v1/auth/...` |
| Uploads | `https://ksgsons.com/api/v1/uploads/...` |
| FCM device tokens | `https://ksgsons.com/api/v1/fcm-tokens/...` |
| Web deep-link paths | customer `/hotel/...`, partner `/hotel/partner/...` (used in push `data.link`) |
| Demo data | `Backend/scripts/seed-hotel.js` + `seed-ksg-more.js`: KSG Demo Hotel (Bhopal) and others |
| Demo logins (while mock OTP is on, OTP `1234`) | customer `9000000001`; hotel partners `9000000010` (Bhopal properties), `9000000011` (Indore etc.) |

## Contents

1. [Conventions](#1-conventions)
2. [Authentication](#2-authentication)
3. [Dates, nights and time zones](#3-dates-nights-and-time-zones)
4. [Endpoint index](#4-endpoint-index)
5. [Public: catalogue, search, property, availability, reviews](#5-public-browse-no-auth)
6. [Customer: quote, booking and payment](#6-customer-quote-booking-and-payment)
7. [Customer: my stays, cancellation, voucher](#7-customer-my-stays-cancellation-voucher)
8. [Customer: coupons, reviews, saved](#8-customer-coupons-reviews-saved)
9. [Partner: profile and onboarding](#9-partner-profile-and-onboarding)
10. [Partner: properties, room types, documents, submit, live](#10-partner-properties-room-types-documents-submit-live)
11. [Partner: inventory calendar and blocks](#11-partner-inventory-calendar-and-blocks)
12. [Partner: bookings](#12-partner-bookings)
13. [Partner: reviews, dashboard, earnings, ledger, withdrawals](#13-partner-reviews-dashboard-earnings-ledger-withdrawals)
14. [Uploads](#14-uploads)
15. [Push notifications](#15-push-notifications)
16. [App services tile and notification inbox](#16-app-services-tile-and-notification-inbox)
17. [Admin endpoints (not for Flutter)](#17-admin-endpoints-not-for-flutter)
18. [Shapes reference](#18-shapes-reference)
19. [Known gaps and inconsistencies](#19-known-gaps-and-inconsistencies)

---

## 1. Conventions

### 1.1 Envelope

Success (any 2xx):

```json
{ "success": true, "message": "Properties", "data": { } }
```

`data` is an object, an array, or (rarely) `null` depending on the endpoint. Always read
`data`; `message` is a short human label ("Booking confirmed", "Booking created; complete
the payment") that you may show in a snackbar.

Error from the global error handler (`Backend/src/middleware/errorHandler.js`):

```json
{ "success": false,
  "message": "checkIn cannot be in the past",
  "error": "checkIn cannot be in the past",
  "requestId": "9f36a488-5245-49a2-bb1e-659f48eb7393" }
```

Error from a guard (auth middleware, hotel partner guard, voucher, rate limiter): only
`success` and `message`:

```json
{ "success": false, "message": "Authentication token missing" }
```

Rules for the app:

- For any **4xx**, show `message` as is. The server writes them for end users and names
  the field for validation failures (`guestDetails.phone: guestDetails.phone must be a
  valid 10-digit mobile number`).
- For **5xx**, `message` is the generic `Internal server error` in production (except a
  few deliberate ones such as gateway errors). Show a generic "Something went wrong"
  with the `requestId` (also in the `x-request-id` response header) for support.
- **⚠️ Note: there is no machine-readable error code in responses.** Some server errors
  carry a `details` object internally (`{ code: "too_many_holds" }`, `{ code: "stale" }`,
  `{ date: "2026-11-10" }`), and `docs/hotel-security-review.md` documents
  `details.code = too_many_holds`, but the global error handler does **not** serialize
  `details`. Branch on **HTTP status + endpoint**; where you must tell two 409s apart, match
  the message prefix listed in this document (e.g. `You already have`). Treat any
  future `details` field as optional.

### 1.2 Status codes

| Status | Meaning here | App behaviour |
|---|---|---|
| 200 / 201 | OK / created (`POST /user/bookings`, `POST /partner/properties`, room type, block, review, withdrawal create return 201) | |
| 400 | Validation failed: bad/missing field, bad date, stay rule (past, >30 nights, >365 days ahead), invalid coupon, party does not fit (create), pay-at-hotel disabled, review before check-out, withdrawal below minimum, wrong OTP format, **OTP request rate limit** (see 2.4) | Show `message` inline; do not retry |
| 401 | No token, invalid/expired access token, deactivated customer, unknown partner, wrong/expired OTP on verify-otp, invalid refresh token, voucher link expired | Access-token 401 on a normal call: refresh once and retry (2.5). 401 from `verify-otp` / `refresh-token`: never refresh; show message / log out |
| 403 | Wrong role (`Hotel partner access required`, `Customer access required`), partner **pending approval** (`Your hotel partner account is pending approval.`), partner blocked, going live before approval, voucher link for another booking | Do not refresh. Pending partner: show the onboarding/pending screen |
| 404 | Not found **or not yours** (someone else's booking is 404, never 403); malformed id | Show "not found", pop the screen |
| 409 | Conflict: sold out, too many unpaid holds, payment window ended, booking state moved on ("This booking was changed by someone else; reload and try again"), duplicate review, withdrawal above balance, delete with upcoming bookings, capacity below booked | Show `message`; re-fetch the resource |
| 413 | Upload too large | "Pick a smaller file" |
| 429 | Rate limited (auth limiter on OTP routes, sensitive-action limiter on create/verify/retry, global API limiter) | Back off; show `message` |
| 502 | Payment gateway error creating an order or fetching a payment | Booking create: the hold was already released, ask to try again. Verify: poll the booking (6.7) |
| 503 | Hotel module switched off by an admin (any **write** under `/api/v1/hotel`, has `Retry-After: 300`), or online payment unavailable | "Hotel booking is paused, try again later". ⚠️ Note: this also blocks `verify-payment`; see 6.7 |

### 1.3 Pagination

Query `?page=1&limit=20`; `page` ≥ 1, `limit` 1-100 (default 20). Paged responses:

```json
{ "items": [ ], "page": 1, "limit": 20, "total": 42 }
```

`hasMore = page * limit < total`.

Not paged (plain arrays): `/public/cities`, `/user/saved`, `/user/offers`,
`/partner/properties`, `/partner/inventory/blocks` (max 500 rows).

### 1.4 Money

- All amounts are **rupees** as JSON numbers with up to 2 decimals (`5877.9`, `100.76`).
  Parse as `num` and convert to a decimal/paise type for display; format with `en_IN`
  grouping (`₹5,877.90`).
- The **only** paise value is `amount` in the Razorpay checkout object (`587790` = ₹5,877.90).
  Pass it to Razorpay unchanged.
- The server computes every price (quote, booking `pricing`). **Never compute totals,
  GST, discounts or refunds on the device** and never send prices: unknown fields are
  stripped.

### 1.5 Ids, headers, strings

- Ids are 24-hex MongoDB ObjectId strings. A malformed id gives 404.
- Send `Authorization: Bearer <accessToken>` and `Content-Type: application/json`.
- ⚠️ Note: a platform-wide `xss-clean` middleware HTML-escapes stored strings, so a
  guest named `O'Brien` may come back as `O&#39;Brien`. Unescape HTML entities in
  free-text fields (names, comments, special requests) before display.
- `location` in responses is GeoJSON: `{ "type": "Point", "coordinates": [lng, lat] }`
  (longitude first). Partner writes send `{ "lat": .., "lng": .. }`.

---

## 2. Authentication

Both roles get a JWT **access token (15 min)** and a **refresh token (7 days)**. The
refresh token is **not rotated or extended**: `/refresh-token` returns the same
refresh token, so a session ends 7 days after login and the user must log in again.

### 2.1 Customer (role `USER`): the normal KSG customer login

The same customer token works for food, rides, quick commerce and hotels. If the KSG
customer app already logs the user in, reuse that session: **no hotel-specific login**.

`POST /api/v1/auth/user/request-otp`

| Field | Type | Rules |
|---|---|---|
| `phone` | string | digits only, 8-15 chars (send the 10-digit number) |

```json
{ "phone": "9000000001" }
```
```json
{ "success": true, "message": "OTP sent successfully",
  "data": { "phone": "9000000001", "isExistingUser": true, "needsNamePrompt": false } }
```
`data.otp` is included only on non-production servers.

`POST /api/v1/auth/user/verify-otp`

| Field | Type | Rules |
|---|---|---|
| `phone` | string | as above |
| `otp` | string | exactly 4 digits |
| `name` | string? | 2-100 chars; send when `needsNamePrompt` was true |
| `ref` | string? | referral code, max 64 |
| `fcmToken` | string? | device FCM token (registers pushes) |
| `platform` | `"mobile"` \| `"web"`? | send `"mobile"` from Flutter |

```json
{ "phone": "9000000001", "otp": "1234", "fcmToken": "eXJ0...", "platform": "mobile" }
```
```json
{ "success": true, "message": "Login successful",
  "data": { "accessToken": "eyJhbGciOi...", "refreshToken": "eyJhbGciOi...",
            "user": { "_id": "6650f1c2a9b3c4d5e6f70811", "name": "KSG Demo Customer", "phone": "9000000001",
                      "role": "USER", "isVerified": true, "isActive": true, "referralCode": "6650f1c2a9b3c4d5e6f70811" },
            "isNewUser": false } }
```
(`user` is the full customer document; only `_id`, `name`, `phone`, `email` matter here.)

Errors: 400 bad phone/otp format or OTP request limit; 401 `Invalid OTP`, `OTP expired`,
`Max attempts exceeded` (5 tries), `OTP already used`, `Your account has been
deactivated. Please contact support.`

`GET /api/v1/auth/me` (Bearer) returns the profile if you need it.

### 2.2 Hotel partner (role `HOTEL_PARTNER`)

`POST /partner/auth/request-otp` (open, auth rate limiter)

| Field | Type | Rules |
|---|---|---|
| `phone` | string | 10-16 chars; `+91`/`0` prefixes and spaces allowed, normalised to the last 10 digits |

```json
{ "phone": "9000000010" }
```
```json
{ "success": true, "message": "OTP sent successfully",
  "data": { "phone": "9000000010", "isExistingPartner": true } }
```
403 `This partner account is not active. Please contact support.` when blocked/deleted.
`data.otp` only on non-production servers.

`POST /partner/auth/verify-otp`

| Field | Type | Rules |
|---|---|---|
| `phone` | string | as above |
| `otp` | string | 4-6 digits |
| `fcmToken` | string? | max 512; **the only way to register a partner device** (see 15.3) |
| `platform` | `"mobile"` \| `"web"`? | send `"mobile"`; stored in the `app` bucket (last 5 kept) |

```json
{ "phone": "9000000010", "otp": "1234", "fcmToken": "fT9k...", "platform": "mobile" }
```
```json
{ "success": true, "message": "Login successful", "data": {
  "accessToken": "eyJhbGciOi...", "refreshToken": "eyJhbGciOi...", "isNewPartner": false,
  "partner": {
    "_id": "6ad08398a409d8c2d05bb901", "name": "KSG Demo Hotel Partner", "phone": "9000000010",
    "email": "stays.demo@ksgsons.com", "platformUserId": "6650f1c2a9b3c4d5e6f70899",
    "status": "approved", "rejectionReason": "", "approvedAt": "2026-10-15T07:41:12.900Z",
    "kyc": { "ownerName": "Arjun Verma", "panNumber": "ABCDE1234F", "aadhaarNumberMasked": "XXXXXXXX4321",
             "panImage": "https://ksgsons.com/api/v1/files/p/pan/1729000000000-pan.webp?e=1792224000&s=Qk3...",
             "aadhaarFront": "https://ksgsons.com/api/v1/files/p/aadhaar/1729000000001-front.webp?e=1792224000&s=Zm9..." },
    "bank": { "accountHolder": "Arjun Verma", "accountNumberMasked": "XXXXXXXX7788", "ifsc": "SBIN0001234", "bankName": "State Bank of India" },
    "address": { "line": "MP Nagar Zone 1", "city": "Bhopal", "state": "Madhya Pradesh", "pincode": "462011",
                 "location": { "type": "Point", "coordinates": [77.4343, 23.2332] } },
    "termsAcceptedAt": "2026-10-15T07:41:12.900Z", "lastLoginAt": "2026-10-17T06:20:11.000Z",
    "createdAt": "2026-10-15T07:41:12.900Z", "updatedAt": "2026-10-17T06:20:11.000Z" } } }
```

- The first verification of a new number **creates** the partner with
  `status: "pending"` and `isNewPartner: true`.
- `status`: `pending` → `approved` | `rejected` (with `rejectionReason`) | `blocked`.
  A pending or rejected partner can log in, edit the profile and build/submit property
  drafts; every guest- or money-facing endpoint (inventory, blocks, dashboard, bookings,
  reviews, earnings, ledger, withdrawals) returns **403 `Your hotel partner account is
  pending approval.`** until approved. A blocked partner gets 403 on everything and on
  refresh.
- Partner JSON never contains `fcmTokens`, `isDeleted`, `approvedBy`,
  `monthlySummaryFor` or `bank.razorpayFundAccountId`.
- KYC image fields are **private files**: the server returns short-lived signed links
  (about 2 h, `?e=...&s=...`). Re-read the profile to get a fresh link; do not cache.

### 2.3 Refresh (both roles)

`POST /api/v1/auth/refresh-token` (not rate limited)

```json
{ "refreshToken": "eyJhbGciOi..." }
```
```json
{ "success": true, "message": "Access token refreshed",
  "data": { "accessToken": "eyJhbGciOi...(new)", "refreshToken": "eyJhbGciOi...(same as sent)" } }
```
401 `Invalid refresh token` (unknown, expired, logged out), `User account is
deactivated`, `This partner account is not active` (blocked/deleted partner). On any
401 here: clear the session and go to login.

### 2.4 Logout (both roles)

`POST /api/v1/auth/logout` (no auth header needed; never fails)

```json
{ "refreshToken": "eyJhbGciOi...", "fcmToken": "fT9k...", "platform": "mobile" }
```
```json
{ "success": true, "message": "Logged out successfully", "data": { "invalidated": true } }
```
All fields optional/nullable. It deletes the refresh token and removes the FCM token
from every account that has it, **including hotel partners** (`fcmTokens.web` and
`fcmTokens.app`). Always send the device's FCM token so the phone stops receiving pushes.

Rate limits on auth: `request-otp`/`verify-otp` routes are limited per IP+phone (30 per
15 min in production, message `Too many authentication attempts. Please try again
later.`, status 429). Separately, **OTP issuance is capped per phone at 3 per 10 minutes
across all KSG services** and that refusal is a **400** with a "try again in N
minutes"-style message. ⚠️ Note: treat both as "wait and retry", not as a bad number.

### 2.5 Token storage and 401 handling (both apps)

- Store `accessToken` and `refreshToken` in secure storage (`flutter_secure_storage`).
  Customer and partner sessions are separate keys (a phone can be both).
- Interceptor: attach `Bearer accessToken`; on **401** from any endpoint *other than*
  `/auth/*/verify-otp`, `/partner/auth/*`, `/auth/refresh-token`, call refresh **once**
  (single-flight: queue concurrent 401s behind one refresh), retry the original request
  once with the new token; if refresh fails, clear the session and route to login.
- Do **not** refresh on 403 (role/approval problems are not fixed by a new token).
- Proactive refresh: the access token is a standard JWT; you may refresh when `exp` is
  less than 60 s away.

---

## 3. Dates, nights and time zones

- Stay dates are **IST calendar dates** as `"YYYY-MM-DD"` strings. Never send a time or
  a UTC timestamp for `checkIn`, `checkOut`, `from`, `to`, `startDate`, `endDate`.
- A stay is a set of **nights**: `checkIn` is the first night, `checkOut` is the
  departure morning and is **exclusive**. `2026-11-10 → 2026-11-12` = 2 nights
  (10th and 11th).
- Server rules for every stay (`services/dates.js parseStay`; search, availability,
  quote, create):

  | Rule | Error (400) |
  |---|---|
  | real date in `YYYY-MM-DD` | `checkIn must be a date in YYYY-MM-DD format` |
  | `checkOut` after `checkIn` | `checkOut must be after checkIn` |
  | at most **30 nights** | `A stay can be at most 30 nights` |
  | `checkIn` not before today (IST) | `checkIn cannot be in the past` |
  | `checkIn` at most **365 days** after today (IST) | `checkIn can be at most 365 days ahead` |

- Compute "today" in `Asia/Kolkata`, not device time (use the `timezone` package or
  `DateTime.now().toUtc().add(Duration(hours: 5, minutes: 30))`). Limit the date picker
  to `[todayIST, todayIST + 365]` and the range to 30 nights.
- **Friday and Saturday** nights use the room type's `weekendPrice` when set; a partner's
  per-night `priceOverride` wins over both. That is why availability and quote show
  per-night prices (`nightlyPrices`).
- Timestamps (`createdAt`, `payment.expiresAt`, `freeCancellationUntil`,
  `statusHistory[].at`, `reply.at`) are ISO-8601 UTC strings. Convert to IST for display.
- **Check-in moment** = check-in date at the property's `checkInTime` (`"HH:mm"`, IST).
  It drives cancellation (7.3).
- Partner ranges: the inventory calendar `from`/`to` are **inclusive** days; a block's
  `endDate` is a check-out date and **exclusive** (section 11).

---

## 4. Endpoint index

Auth column: `-` none, `C` customer token (role `USER`), `P` any hotel partner token
(pending allowed), `PA` approved hotel partner, `any` any signed-in token.

### 4.1 Customer app

| Method | Path | Auth | Section |
|---|---|---|---|
| POST | `/api/v1/auth/user/request-otp` | - | 2.1 |
| POST | `/api/v1/auth/user/verify-otp` | - | 2.1 |
| POST | `/api/v1/auth/refresh-token` | - | 2.3 |
| POST | `/api/v1/auth/logout` | - | 2.4 |
| POST | `/api/v1/fcm-tokens/mobile/save` | C | 15.2 |
| DELETE | `/api/v1/fcm-tokens/remove` | C | 15.2 |
| GET | `/api/v1/platform/app-services` | - | 16 |
| GET | `/public/catalogue` | - | 5.1 |
| GET | `/public/cities` | - | 5.2 |
| GET | `/public/properties` | - | 5.3 |
| GET | `/public/properties/:idOrSlug` | - | 5.4 |
| GET | `/public/properties/:id/availability` | - | 5.5 |
| GET | `/public/properties/:id/reviews` | - | 5.6 |
| POST | `/user/bookings/quote` | C | 6.3 |
| POST | `/user/bookings` | C (+rate limit) | 6.4 |
| POST | `/user/bookings/:id/verify-payment` | C (+rate limit) | 6.6 |
| POST | `/user/bookings/:id/retry-payment` | C (+rate limit) | 6.8 |
| GET | `/user/bookings` | C | 7.1 |
| GET | `/user/bookings/:id` | C | 7.2 |
| GET | `/user/bookings/:id/cancel-preview` | C | 7.3 |
| POST | `/user/bookings/:id/cancel` | C | 7.3 |
| POST | `/user/bookings/:id/voucher-link` | C | 7.4 |
| GET | `/user/bookings/:id/voucher?vt=` | vt link | 7.4 |
| GET | `/user/offers` | C | 8.1 |
| POST | `/user/reviews` | C | 8.2 |
| GET | `/user/saved` | C | 8.3 |
| POST | `/user/saved/:propertyId` | C | 8.3 |
| DELETE | `/user/saved/:propertyId` | C | 8.3 |
| POST | `/api/v1/uploads/image` | any | 14 |

### 4.2 Partner app

| Method | Path | Auth | Section |
|---|---|---|---|
| POST | `/partner/auth/request-otp` | - | 2.2 |
| POST | `/partner/auth/verify-otp` | - | 2.2 |
| POST | `/api/v1/auth/refresh-token` | - | 2.3 |
| POST | `/api/v1/auth/logout` | - | 2.4 |
| GET | `/partner/me` | P | 9.1 |
| PUT | `/partner/me` | P | 9.2 |
| GET | `/public/catalogue` | - | 5.1 |
| GET | `/partner/properties` | P | 10.1 |
| POST | `/partner/properties` | P | 10.2 |
| GET | `/partner/properties/:id` | P | 10.3 |
| PUT | `/partner/properties/:id` | P | 10.4 |
| DELETE | `/partner/properties/:id` | P | 10.5 |
| POST | `/partner/properties/:id/room-types` | P | 10.6 |
| PUT | `/partner/properties/:id/room-types/:roomTypeId` | P | 10.7 |
| DELETE | `/partner/properties/:id/room-types/:roomTypeId` | P | 10.8 |
| PUT | `/partner/properties/:id/documents` | P | 10.9 |
| POST | `/partner/properties/:id/submit` | P | 10.10 |
| PUT | `/partner/properties/:id/live` | P (needs approvals, else 403) | 10.11 |
| GET | `/partner/inventory` | PA | 11.1 |
| PUT | `/partner/inventory` | PA | 11.2 |
| GET | `/partner/inventory/blocks` | PA | 11.3 |
| POST | `/partner/inventory/blocks` | PA | 11.4 |
| DELETE | `/partner/inventory/blocks/:id` | PA | 11.5 |
| GET | `/partner/dashboard` | PA | 13.2 |
| GET | `/partner/bookings` | PA | 12.1 |
| GET | `/partner/bookings/:id` | PA | 12.2 |
| PUT | `/partner/bookings/:id/check-in` | PA | 12.3 |
| PUT | `/partner/bookings/:id/check-out` | PA | 12.3 |
| PUT | `/partner/bookings/:id/no-show` | PA | 12.3 |
| PUT | `/partner/bookings/:id/mark-paid` | PA | 12.3 |
| PUT | `/partner/bookings/:id/cancel` | PA | 12.3 |
| GET | `/partner/reviews` | PA | 13.1 |
| POST | `/partner/reviews/:id/reply` | PA | 13.1 |
| GET | `/partner/earnings` | PA | 13.3 |
| GET | `/partner/ledger` | PA | 13.4 |
| POST | `/partner/withdrawals` | PA | 13.5 |
| GET | `/partner/withdrawals` | PA | 13.5 |
| POST | `/api/v1/uploads/image` | any | 14 |
| POST | `/api/v1/uploads/document` | any | 14 |

---

## 5. Public browse (no auth)

All `GET`, no token. Safe to cache briefly (catalogue for the session, cities for an hour).

### 5.1 Catalogue

`GET /public/catalogue`: the lists filters and the partner wizard are built from. Never
hardcode them. Live response (complete):

```json
{ "success": true, "message": "Hotel catalogue", "data": {
  "propertyTypes": ["hotel", "resort", "villa", "homestay", "hostel", "pg"],
  "inventoryTypesByProperty": { "hotel": ["room"], "resort": ["room"], "villa": ["entire"], "homestay": ["room", "entire"], "hostel": ["bed"], "pg": ["bed"] },
  "requiredDocuments": { "hotel": ["trade_license"], "resort": ["trade_license"], "villa": ["trade_license"], "homestay": ["electricity_bill"], "hostel": ["trade_license", "rent_agreement"], "pg": ["trade_license", "rent_agreement"] },
  "amenities": [
    { "key": "wifi", "label": "Free Wi-Fi" }, { "key": "ac", "label": "Air conditioning" }, { "key": "parking", "label": "Parking" },
    { "key": "restaurant", "label": "Restaurant" }, { "key": "room_service", "label": "Room service" }, { "key": "pool", "label": "Swimming pool" },
    { "key": "gym", "label": "Gym" }, { "key": "spa", "label": "Spa" }, { "key": "power_backup", "label": "Power backup" },
    { "key": "lift", "label": "Lift" }, { "key": "cctv", "label": "CCTV" }, { "key": "housekeeping", "label": "Daily housekeeping" },
    { "key": "tv", "label": "TV" }, { "key": "geyser", "label": "Hot water" }, { "key": "kitchen", "label": "Kitchen access" },
    { "key": "laundry", "label": "Laundry" }, { "key": "breakfast", "label": "Breakfast available" }, { "key": "pet_friendly", "label": "Pet friendly" },
    { "key": "wheelchair", "label": "Wheelchair accessible" }, { "key": "front_desk_24x7", "label": "24x7 front desk" } ],
  "cancellationPolicies": ["flexible", "moderate", "strict", "non_refundable"],
  "mealPlans": ["room_only", "breakfast", "half_board", "full_board"],
  "suitability": ["couple_friendly", "family_friendly", "both", "none"] } }
```

⚠️ Note: the catalogue has keys but no display labels for property types, meal plans,
policies and suitability. Keep a client-side label map (e.g. `half_board` → "Half board",
`pg` → "PG") and fall back to a title-cased key for unknown values. Document types
(`trade_license`, `rent_agreement`, `electricity_bill`, `gst_certificate`, `fire_noc`,
`other`) are also not in the catalogue; `requiredDocuments` lists the mandatory ones.

### 5.2 Cities

`GET /public/cities`: cities with at least one listable property, most properties first.
Live:

```json
{ "success": true, "message": "Cities", "data": [
  { "city": "Bhopal", "count": 3 }, { "city": "Delhi", "count": 1 }, { "city": "Goa", "count": 1 },
  { "city": "Indore", "count": 1 }, { "city": "Manali", "count": 1 } ] }
```

### 5.3 Search

`GET /public/properties`

| Query | Type | Rules / meaning |
|---|---|---|
| `q` | string | max 100; case-insensitive substring of name, city or area |
| `city` | string | max 80; case-insensitive **exact** city name (use a value from `/public/cities`) |
| `lat`, `lng` | number | -90..90 / -180..180; **both or neither** (`lat and lng go together`) |
| `radiusKm` | number | 0.1-1000, default 50; only with lat/lng |
| `types` | csv | property types, e.g. `hotel,resort`; unknown value → 400 `types: unknown value "castle"` |
| `amenities` | csv | amenity keys; the property must have **all** of them |
| `suitability` | enum | `couple_friendly` / `family_friendly` also match `both`; `both`, `none` exact |
| `minPrice`, `maxPrice` | number | 0-10,000,000; on the cheapest fitting room type's base `pricePerNight`; min ≤ max |
| `minRating` | number | 0-5, on `avgRating` |
| `checkIn`, `checkOut` | date | **both or neither**; stay rules of section 3. With dates, only properties with a fitting room type free on every night are returned |
| `adults` | int | 1-100, default 2 |
| `children` | int | 0-100, default 0 |
| `rooms` | int | 1-50, default 1 |
| `sort` | enum | `relevance` (default: distance with lat/lng, else rating then newest), `price_low`, `price_high`, `rating`, `distance` (falls back to rating without lat/lng), `newest` |
| `page`, `limit` | int | page 1-10000, limit 1-100 (default 20) |

A room type "fits" when `rooms × maxAdults ≥ adults`, `rooms × maxChildren ≥ children`
and it has at least `rooms` sellable units.

Live: `GET /public/properties?city=Bhopal`

```json
{ "success": true, "message": "Properties", "data": {
  "items": [
    { "_id": "6ad08398a409d8c2d05bb909", "name": "KSG Demo Hotel", "slug": "ksg-demo-hotel-bhopal", "propertyType": "hotel",
      "coverImage": "https://placehold.co/1200x800?text=KSG+Demo+Hotel",
      "address": { "area": "MP Nagar", "city": "Bhopal" },
      "location": { "type": "Point", "coordinates": [77.4343, 23.2332] },
      "avgRating": 4.8, "totalReviews": 4,
      "amenities": ["wifi", "ac", "parking", "restaurant", "room_service", "power_backup", "lift", "cctv", "housekeeping", "tv", "front_desk_24x7"],
      "startingPrice": 1899, "originalPrice": 2499 },
    { "_id": "6ad08399a409d8c2d05bb920", "name": "KSG Demo Resort", "slug": "ksg-demo-resort-bhopal", "propertyType": "resort",
      "coverImage": "https://placehold.co/1200x800?text=KSG+Demo+Resort",
      "address": { "area": "Shyamla Hills", "city": "Bhopal" },
      "location": { "type": "Point", "coordinates": [77.3787, 23.2486] },
      "avgRating": 4.5, "totalReviews": 2,
      "amenities": ["wifi", "ac", "parking", "restaurant", "pool", "spa", "gym", "power_backup", "cctv", "housekeeping", "breakfast", "front_desk_24x7"],
      "startingPrice": 4499, "originalPrice": 5499 },
    { "_id": "6ad08399a409d8c2d05bb932", "name": "KSG Demo Homestay", "slug": "ksg-demo-homestay-bhopal", "propertyType": "homestay",
      "coverImage": "https://placehold.co/1200x800?text=KSG+Demo+Homestay",
      "address": { "area": "Arera Colony", "city": "Bhopal" },
      "location": { "type": "Point", "coordinates": [77.4344, 23.2105] },
      "avgRating": 4, "totalReviews": 3,
      "amenities": ["wifi", "ac", "parking", "kitchen", "geyser", "breakfast", "pet_friendly"],
      "startingPrice": 1299, "originalPrice": 1599 } ],
  "page": 1, "limit": 20, "total": 3 } }
```

Live "near me" with dates:
`GET /public/properties?lat=23.2332&lng=77.4343&radiusKm=10&checkIn=2026-11-13&checkOut=2026-11-15&sort=distance&limit=2`

```json
{ "success": true, "message": "Properties", "data": {
  "items": [
    { "_id": "6ad08398a409d8c2d05bb909", "name": "KSG Demo Hotel", "slug": "ksg-demo-hotel-bhopal", "propertyType": "hotel",
      "coverImage": "https://placehold.co/1200x800?text=KSG+Demo+Hotel", "address": { "area": "MP Nagar", "city": "Bhopal" },
      "location": { "type": "Point", "coordinates": [77.4343, 23.2332] }, "distanceKm": 0,
      "avgRating": 4.8, "totalReviews": 4, "amenities": ["wifi", "ac", "parking", "restaurant", "room_service", "power_backup", "lift", "cctv", "housekeeping", "tv", "front_desk_24x7"],
      "startingPrice": 1899, "originalPrice": 2499, "available": true },
    { "_id": "6ad08399a409d8c2d05bb932", "name": "KSG Demo Homestay", "slug": "ksg-demo-homestay-bhopal", "propertyType": "homestay",
      "coverImage": "https://placehold.co/1200x800?text=KSG+Demo+Homestay", "address": { "area": "Arera Colony", "city": "Bhopal" },
      "location": { "type": "Point", "coordinates": [77.4344, 23.2105] }, "distanceKm": 2.53,
      "avgRating": 4, "totalReviews": 3, "amenities": ["wifi", "ac", "parking", "kitchen", "geyser", "breakfast", "pet_friendly"],
      "startingPrice": 1299, "originalPrice": 1599, "available": true } ],
  "page": 1, "limit": 2, "total": 3 } }
```

- `distanceKm` (2 decimals) only with lat/lng; `available` only with dates and always
  `true` (unavailable properties are filtered out, not flagged).
- `originalPrice` only when it is higher than `startingPrice` (show strike-through).
- ⚠️ Note: `startingPrice` (and `minPrice`/`maxPrice`) use the room type's base
  `pricePerNight`, **not** weekend prices or per-night overrides. 13-14 Nov 2026 are
  Fri/Sat, so the card says ₹1,899 but those nights cost ₹2,199 (see 5.5). Label it
  "from ₹1,899 / night" and show real prices from availability/quote.

### 5.4 Property detail

`GET /public/properties/:idOrSlug` (id or slug). 404 `Property not found` unless the
property is approved, live, not deleted and its partner is approved. `roomTypes` are the
active ones, cheapest first. Live (`/public/properties/ksg-demo-hotel-bhopal`):

```json
{ "success": true, "message": "Property", "data": {
  "property": {
    "_id": "6ad08398a409d8c2d05bb909", "name": "KSG Demo Hotel", "slug": "ksg-demo-hotel-bhopal", "propertyType": "hotel",
    "typeDetails": { "hotelCategory": "premium", "starRating": 4 }, "suitability": "both",
    "description": "A comfortable city hotel in the heart of Bhopal with a rooftop restaurant, free Wi-Fi and 24x7 front desk. DEMO LISTING.",
    "shortDescription": "Business hotel in MP Nagar, minutes from DB Mall.",
    "contactNumber": "9000000010",
    "address": { "line1": "Plot 12, Zone 1", "area": "MP Nagar", "city": "Bhopal", "state": "Madhya Pradesh", "pincode": "462011", "country": "India" },
    "location": { "type": "Point", "coordinates": [77.4343, 23.2332] },
    "nearbyPlaces": [ { "name": "DB City Mall", "type": "mall", "distanceKm": 1.2 }, { "name": "Bhopal Junction", "type": "railway", "distanceKm": 5 } ],
    "coverImage": "https://placehold.co/1200x800?text=KSG+Demo+Hotel",
    "images": [ "https://placehold.co/1200x800?text=KSG+Demo+Hotel+1", "https://placehold.co/1200x800?text=KSG+Demo+Hotel+2",
                "https://placehold.co/1200x800?text=KSG+Demo+Hotel+3", "https://placehold.co/1200x800?text=KSG+Demo+Hotel+4" ],
    "amenities": ["wifi", "ac", "parking", "restaurant", "room_service", "power_backup", "lift", "cctv", "housekeeping", "tv", "front_desk_24x7"],
    "houseRules": ["Valid photo ID required at check-in", "No smoking in rooms"],
    "checkInTime": "12:00", "checkOutTime": "11:00",
    "cancellationPolicy": { "type": "moderate", "freeCancelHours": 24, "refundPercentAfter": 50 },
    "status": "approved", "isLive": true, "avgRating": 4.8, "totalReviews": 4,
    "startingPrice": 1899, "originalPrice": 2499,
    "createdAt": "2026-10-15T07:41:12.912Z", "updatedAt": "2026-10-15T12:31:45.639Z" },
  "roomTypes": [
    { "_id": "6ad08398a409d8c2d05bb90c", "propertyId": "6ad08398a409d8c2d05bb909", "name": "Standard Room", "description": "",
      "inventoryType": "room", "roomCategory": "private", "baseAdults": 2, "baseChildren": 0, "maxAdults": 2, "maxChildren": 1,
      "bedsPerRoom": 1, "totalInventory": 10, "pricePerNight": 1899, "originalPrice": 2499, "weekendPrice": 2199,
      "extraAdultPrice": 0, "extraChildPrice": 300, "mealPlan": "room_only",
      "images": [ "https://placehold.co/1200x800?text=KSG+Demo+Hotel+Standard+Room+1", "https://placehold.co/1200x800?text=KSG+Demo+Hotel+Standard+Room+2", "https://placehold.co/1200x800?text=KSG+Demo+Hotel+Standard+Room+3" ],
      "amenities": ["wifi", "ac", "tv"], "isActive": true,
      "createdAt": "2026-10-15T07:41:12.939Z", "updatedAt": "2026-10-15T07:41:12.939Z" },
    { "_id": "6ad08398a409d8c2d05bb90f", "propertyId": "6ad08398a409d8c2d05bb909", "name": "Deluxe Room", "description": "",
      "inventoryType": "room", "roomCategory": "private", "baseAdults": 2, "baseChildren": 0, "maxAdults": 3, "maxChildren": 1,
      "bedsPerRoom": 1, "totalInventory": 6, "pricePerNight": 2799, "originalPrice": 3499, "weekendPrice": 3199,
      "extraAdultPrice": 600, "extraChildPrice": 300, "mealPlan": "breakfast",
      "images": [ "https://placehold.co/1200x800?text=KSG+Demo+Hotel+Deluxe+Room+1", "https://placehold.co/1200x800?text=KSG+Demo+Hotel+Deluxe+Room+2", "https://placehold.co/1200x800?text=KSG+Demo+Hotel+Deluxe+Room+3" ],
      "amenities": ["wifi", "ac", "tv", "breakfast"], "isActive": true,
      "createdAt": "2026-10-15T07:41:12.946Z", "updatedAt": "2026-10-15T07:41:12.946Z" },
    { "_id": "6ad08398a409d8c2d05bb912", "propertyId": "6ad08398a409d8c2d05bb909", "name": "Executive Suite", "description": "",
      "inventoryType": "room", "roomCategory": "private", "baseAdults": 2, "baseChildren": 0, "maxAdults": 4, "maxChildren": 2,
      "bedsPerRoom": 1, "totalInventory": 2, "pricePerNight": 4999, "originalPrice": 5999,
      "extraAdultPrice": 800, "extraChildPrice": 400, "mealPlan": "breakfast",
      "images": [ "https://placehold.co/1200x800?text=KSG+Demo+Hotel+Executive+Suite+1", "https://placehold.co/1200x800?text=KSG+Demo+Hotel+Executive+Suite+2", "https://placehold.co/1200x800?text=KSG+Demo+Hotel+Executive+Suite+3" ],
      "amenities": ["wifi", "ac", "tv", "breakfast", "room_service"], "isActive": true,
      "createdAt": "2026-10-15T07:41:12.953Z", "updatedAt": "2026-10-15T07:41:12.953Z" } ] } }
```

- Optional fields may be missing entirely (e.g. `weekendPrice` on the suite,
  `originalPrice`, `typeDetails.*`, `address.fullAddress`, `nearbyPlaces`). Make every
  non-id field nullable in the models.
- `images` is the gallery **without** the cover; show `[coverImage, ...images]`.
- `inventoryType: "bed"` (hostel/pg) means `rooms` counts **beds** in availability,
  quote and booking; `"entire"` (villa) has exactly one unit.
- Map: `location.coordinates` = `[lng, lat]`.
- Share link: `https://ksgsons.com/hotel/p/<slug>` (web route; use it for app links).
- Public JSON never contains `partnerId`, `zoneId`, `approvedBy`, `rejectionReason`.

### 5.5 Live availability for dates

`GET /public/properties/:id/availability?checkIn&checkOut&adults&children&rooms`
(`:id` is the **id**, not the slug)

| Query | Rules |
|---|---|
| `checkIn`, `checkOut` | required (`checkIn and checkOut are required`), stay rules of section 3 |
| `adults` | int 1-100, default 2 |
| `children` | int 0-100, default 0 |
| `rooms` | int 1-50, default 1 |

Live: `?checkIn=2026-11-13&checkOut=2026-11-15&adults=2&rooms=1` (a Fri+Sat stay)

```json
{ "success": true, "message": "Availability", "data": {
  "checkIn": "2026-11-13", "checkOut": "2026-11-15", "nights": 2,
  "roomTypes": [
    { "roomTypeId": "6ad08398a409d8c2d05bb90c", "name": "Standard Room", "available": 10, "bookable": true,
      "nightlyPrices": [ { "date": "2026-11-13", "price": 2199 }, { "date": "2026-11-14", "price": 2199 } ], "total": 4398 },
    { "roomTypeId": "6ad08398a409d8c2d05bb90f", "name": "Deluxe Room", "available": 6, "bookable": true,
      "nightlyPrices": [ { "date": "2026-11-13", "price": 3199 }, { "date": "2026-11-14", "price": 3199 } ], "total": 6398 },
    { "roomTypeId": "6ad08398a409d8c2d05bb912", "name": "Executive Suite", "available": 2, "bookable": true,
      "nightlyPrices": [ { "date": "2026-11-13", "price": 4999 }, { "date": "2026-11-14", "price": 4999 } ], "total": 9998 } ] } }
```

- `available` = fewest free units over the nights (a closed night counts as 0).
- `bookable` = `available ≥ rooms` **and** the party fits the room type.
- `total` = `rooms × Σ nightlyPrices`: before extra-guest charges, coupons, prepaid
  discount, GST and fees. Show it as "₹6,398 for 2 nights + taxes"; the real price comes
  from the quote.
- ⚠️ Note: limits differ from quote/create (`rooms` ≤ 50 and `children` ≤ 100 here, but
  ≤ 20 and ≤ 50 on quote). Cap the room/guest pickers at **20 rooms, 50 children**.

### 5.6 Reviews of a property

`GET /public/properties/:id/reviews?page=1&limit=10` (id only; approved reviews only;
reviewer **first name** only; newest first). Live (`limit=2`):

```json
{ "success": true, "message": "Reviews", "data": {
  "items": [
    { "_id": "6ad094d3a874a5a8c78315ca", "propertyId": "6ad08398a409d8c2d05bb909", "bookingId": "6ad094b5a874a5a8c783155b",
      "rating": 5, "subRatings": { "cleanliness": 5, "location": 4, "service": 5, "value": 5 },
      "comment": "Lovely stay, great staff. (KSG demo review)", "photos": [],
      "user": { "name": "KSG" }, "status": "approved", "createdAt": "2026-10-15T08:54:43.152Z" },
    { "_id": "6ad0c7b161a0a4249c99d6a9", "propertyId": "6ad08398a409d8c2d05bb909", "bookingId": "6ad0c7b161a0a4249c99d6a0",
      "rating": 5, "subRatings": { "cleanliness": 5, "location": 4, "service": 5, "value": 4 },
      "comment": "Spacious suite, room service was quick. Great for a family stay.", "photos": [],
      "user": { "name": "KSG" }, "status": "approved", "createdAt": "2026-09-29T08:54:00.000Z" } ],
  "page": 1, "limit": 2, "total": 4,
  "summary": { "avgRating": 4.8, "totalReviews": 4, "breakdown": { "1": 0, "2": 0, "3": 0, "4": 1, "5": 3 } } } }
```

`subRatings` is omitted when none were given; `reply: { text, at }` appears when the
hotel replied. `summary.breakdown` keys are the strings `"1"`..`"5"`. 404 for a
non-listable property.

---

## 6. Customer: quote, booking and payment

All endpoints need the **customer** token (role `USER`). A partner/admin token gets 403.

⚠️ Note: the quote requires login. Before login, show prices from availability (5.5)
and ask the user to log in when they tap "Book".

### 6.1 Payment modes

| `paymentMode` | Pay online now (`payNow`) | At the hotel (`payAtHotel`) | Discount |
|---|---|---|---|
| `online` | total | 0 | none |
| `partial_prepaid` | `prepaidAdvancePercent` (default 30%) of total | the rest | `prepaidDiscountPercent` (default 5%) off the stay, before GST |
| `pay_at_hotel` | 0 | total | none. 400 `Pay at hotel is not available; choose online or part payment` when an admin disabled it |

- `useWallet: true` (create only) pays part or all of `payNow` from the customer's KSG
  wallet; the wallet part is debited at create. If the wallet covers all of `payNow`,
  there is **no Razorpay step** and the booking is confirmed immediately.
- The gateway part is never between ₹0 and ₹1 (Razorpay minimum): the wallet part is
  reduced to leave ₹1 for the gateway in that edge case.
- With `pay_at_hotel`, `payNow` is 0, so the wallet is never used.
- ⚠️ Note: there is no endpoint that says whether pay-at-hotel is enabled. Offer all
  three modes and, if a quote with `pay_at_hotel` returns that 400, hide the option for
  the session.
- `wallet` exists in the booking `payment.mode` enum but is **not** accepted as a
  `paymentMode`; it is not used.

### 6.2 The booking sequence

```
           (dates/party/room/mode/coupon change)
  quote ────────────────────────────────────────────┐
    │ available: true                                │
    ▼                                                │
  create ──┬── status confirmed, payment null ───────┼──────────────────────► confirmation
           │   (pay at hotel, or wallet covered it)  │
           └── status awaiting_payment, payment {…}  │
                  │                                  │
                  ▼                                  │
            Razorpay checkout ── success ──► verify-payment ──► confirmed ──► confirmation
                  │                              │ network error / 400 "not complete yet" / 502 / 503
                  │                              └──► poll GET /user/bookings/:id
                  │ error / user closed sheet
                  └──► "Pay now" ──► retry-payment (same order) ──► Razorpay …
                  hold ends (payment.expiresAt) ──► server expires it ──► "expired"
```

1. **Quote** `POST /user/bookings/quote` every time the dates, party, room type, payment
   mode or coupon change. It holds nothing. If `available` is false, ask the user to
   change something.
2. **Create** `POST /user/bookings` with the same fields + `guestDetails`,
   `specialRequests`, `useWallet`. Rooms (and any wallet part) are now held.
3. If `data.payment` is `null` and `booking.status == "confirmed"`: done.
4. Otherwise (`awaiting_payment`): open Razorpay with `data.payment` (6.5). Show a
   countdown to `booking.payment.expiresAt` (hold = `quote.holdMinutes`, default 30).
5. On Razorpay success: **verify** (6.6). On any doubt: **poll** (6.7).
6. On Razorpay error/dismiss: keep the user on a "Complete payment" screen with
   "Pay now" → **retry-payment** (6.8) → Razorpay again.
7. When the hold ends unpaid, a server job (every 60 s) moves the booking to
   `expired`, releases the rooms, refunds any wallet part and gives back a coupon use.

### 6.3 Quote

`POST /user/bookings/quote`

| Field | Type | Rules |
|---|---|---|
| `propertyId` | id | required, listable property |
| `roomTypeId` | id | required, active room type of that property |
| `checkIn`, `checkOut` | date | required, section 3 rules |
| `rooms` | int | 1-20, default 1 |
| `adults` | int | 1-100, default 2 |
| `children` | int | 0-50, default 0 |
| `paymentMode` | enum | required: `pay_at_hotel` \| `online` \| `partial_prepaid` |
| `couponCode` | string? | max 40, case-insensitive; `null`/omitted = no coupon |

```json
{ "propertyId": "6ad08398a409d8c2d05bb909", "roomTypeId": "6ad08398a409d8c2d05bb90f",
  "checkIn": "2026-11-10", "checkOut": "2026-11-12",
  "rooms": 1, "adults": 2, "children": 0, "paymentMode": "online" }
```
```json
{ "success": true, "message": "Quote", "data": {
  "propertyId": "6ad08398a409d8c2d05bb909", "roomTypeId": "6ad08398a409d8c2d05bb90f",
  "checkIn": "2026-11-10", "checkOut": "2026-11-12", "nights": 2, "rooms": 1,
  "guests": { "adults": 2, "children": 0 }, "available": true, "paymentMode": "online",
  "pricing": { "roomCharges": 5598, "extraGuestCharges": 0, "subtotal": 5598, "couponDiscount": 0,
               "prepaidDiscount": 0, "taxableAmount": 5598, "gstRate": 5, "gstAmount": 279.9,
               "platformFee": 0, "platformFeeGst": 0, "total": 5877.9 },
  "nightlyPrices": [ { "date": "2026-11-10", "price": 2799 }, { "date": "2026-11-11", "price": 2799 } ],
  "payNow": 5877.9, "payAtHotel": 0, "walletApplicable": 250,
  "cancellationPolicy": { "type": "moderate", "freeCancelHours": 24, "refundPercentAfter": 50 },
  "freeCancellationUntil": "2026-11-09T06:30:00.000Z",
  "holdMinutes": 30 } }
```

Same stay, `"paymentMode": "partial_prepaid"`:
`pricing.prepaidDiscount: 279.9, taxableAmount: 5318.1, gstAmount: 265.9, total: 5584`,
`payNow: 1675.2, payAtHotel: 3908.8`.

Same stay, `"paymentMode": "online", "couponCode": "stay20"` (a platform coupon, 20% up
to ₹500):

```json
{ "pricing": { "roomCharges": 5598, "extraGuestCharges": 0, "subtotal": 5598,
               "couponCode": "STAY20", "couponDiscount": 500, "prepaidDiscount": 0,
               "taxableAmount": 5098, "gstRate": 5, "gstAmount": 254.9,
               "platformFee": 0, "platformFeeGst": 0, "total": 5352.9 },
  "payNow": 5352.9, "payAtHotel": 0,
  "coupon": { "code": "STAY20", "title": "20% off your stay", "discount": 500 } }
```

Field notes:

- `available` is `false` (not an error) when the party does not fit or rooms are short.
- Pricing order: `subtotal = roomCharges + extraGuestCharges` → minus `couponDiscount`
  → minus `prepaidDiscount` = `taxableAmount` → `gstAmount` at `gstRate` → `total =
  taxableAmount + gstAmount + platformFee + platformFeeGst`. Show the lines exactly as
  returned; hide zero lines.
- Extra guests are adults beyond `rooms × baseAdults` and children beyond
  `rooms × baseChildren`, charged per night.
- GST slab is chosen by the per-room-per-night tariff after discounts (defaults: 0% up to
  ₹1,000, 5% up to ₹7,500, 18% above; admin-configurable). Applying a coupon can change
  `gstRate`.
- `platformFee` is the Master "platform fee" for hotels (often 0) and `platformFeeGst`
  its GST.
- `walletApplicable` = what the wallet would pay of `payNow` now
  (`min(balance, payNow)`, Rs-1 rule). 0 when `payNow` is 0.
- `freeCancellationUntil` is absent for `non_refundable`.
- `coupon` appears only when a valid `couponCode` was sent.
- Commission, payout and coupon funding are never in customer responses.

Errors: 400 (validation, dates, coupon (8.1), pay-at-hotel disabled), 404 `Property not
found` / `Room type not found`.

### 6.4 Create

`POST /user/bookings` (sensitive-action rate limit: 30 per 5 min per user in production)

The quote body plus:

| Field | Type | Rules |
|---|---|---|
| `guestDetails.name` | string | required, 2-80 |
| `guestDetails.phone` | string | required, Indian mobile `[6-9]XXXXXXXXX`; `+91`/`91`, spaces, dashes allowed; stored as 10 digits |
| `guestDetails.email` | string? | valid email ≤ 120, or `""` |
| `specialRequests` | string? | max 500 |
| `useWallet` | bool? | default false |

```json
{ "propertyId": "6ad08398a409d8c2d05bb909", "roomTypeId": "6ad08398a409d8c2d05bb90f",
  "checkIn": "2026-11-10", "checkOut": "2026-11-12", "rooms": 1, "adults": 2, "children": 0,
  "paymentMode": "online",
  "guestDetails": { "name": "Riya Sharma", "phone": "9000000001", "email": "riya.sharma@example.com" },
  "specialRequests": "Late check-in around 10 pm", "useWallet": false }
```

**201** `Booking created; complete the payment` (or `Booking confirmed`):

```json
{ "success": true, "message": "Booking created; complete the payment", "data": {
  "booking": {
    "_id": "6ad1f0c1d2e3f4a5b6c70401", "bookingRef": "KSGHMGQ3Z8K1A7F",
    "userId": "6650f1c2a9b3c4d5e6f70811", "propertyId": "6ad08398a409d8c2d05bb909",
    "roomTypeId": "6ad08398a409d8c2d05bb90f",
    "snapshot": { "propertyName": "KSG Demo Hotel", "propertyType": "hotel", "roomTypeName": "Deluxe Room",
                  "address": "Plot 12, Zone 1, MP Nagar, Bhopal, Madhya Pradesh, 462011",
                  "coverImage": "https://placehold.co/1200x800?text=KSG+Demo+Hotel",
                  "checkInTime": "12:00", "checkOutTime": "11:00",
                  "cancellationPolicy": { "type": "moderate", "freeCancelHours": 24, "refundPercentAfter": 50 } },
    "checkIn": "2026-11-10", "checkOut": "2026-11-12", "nights": 2, "rooms": 1,
    "guests": { "adults": 2, "children": 0 },
    "guestDetails": { "name": "Riya Sharma", "phone": "9000000001", "email": "riya.sharma@example.com" },
    "specialRequests": "Late check-in around 10 pm",
    "pricing": { "roomCharges": 5598, "extraGuestCharges": 0, "subtotal": 5598, "couponDiscount": 0, "prepaidDiscount": 0,
                 "taxableAmount": 5598, "gstRate": 5, "gstAmount": 279.9, "platformFee": 0, "platformFeeGst": 0, "total": 5877.9 },
    "payment": { "mode": "online", "status": "pending", "amountPaid": 0, "amountDue": 5877.9, "walletAmount": 0,
                 "payNow": 5877.9, "onlineAmount": 5877.9, "onlinePaid": 0, "collectedAtHotel": 0, "refundedAmount": 0,
                 "expiresAt": "2026-10-17T07:12:00.000Z" },
    "status": "awaiting_payment",
    "statusHistory": [ { "status": "awaiting_payment", "at": "2026-10-17T06:42:00.000Z", "by": { "role": "user" }, "note": "Waiting for online payment" } ],
    "refunds": [], "source": "app", "canCancel": true, "canReview": false,
    "createdAt": "2026-10-17T06:42:00.000Z", "updatedAt": "2026-10-17T06:42:01.000Z" },
  "payment": {
    "razorpayOrderId": "order_PQx7Kd2LmN81Ab", "amount": 587790, "currency": "INR",
    "keyId": "rzp_live_XXXXXXXXXXXXXX", "name": "KSG",
    "description": "KSG Demo Hotel · KSGHMGQ3Z8K1A7F",
    "prefill": { "name": "Riya Sharma", "contact": "9000000001", "email": "riya.sharma@example.com" } } } }
```

(`zoneId` may also be present on the booking; ignore it.)

Errors:

| Status | Message | App |
|---|---|---|
| 400 | validation (`guestDetails.phone: ...`), stay rules, coupon reasons, `Deluxe Room fits at most 3 adult(s) and 1 child(ren) per room`, wallet `Insufficient wallet balance`-style if the balance dropped | Show, fix input |
| 400 | `STAY20 has just been fully used; please book without it` | Remove coupon, re-quote |
| 404 | property / room type not listable | Back to search |
| 409 | `Sold out: not enough rooms for these dates` or `Not enough rooms available on 2026-11-10` | Re-quote / pick other room |
| 409 | `You already have 3 bookings waiting for payment. Complete or cancel one of them before booking again.` | Link to My stays → Upcoming |
| 429 | `Too many attempts. Please slow down and try again in a few minutes.` | Back off |
| 502 / 503 | gateway could not create an order (`Payment gateway error: ...`, `Online payment is not available right now`) | The booking was already expired and the wallet part refunded; ask to retry or choose pay at hotel |

- **At most 3 unpaid online holds per customer** (`awaiting_payment` with an unexpired
  hold). Pay-at-hotel and wallet-only bookings do not count.
- ⚠️ Note: **create is not idempotent** (no idempotency key). A double tap or an
  automatic retry after a timeout creates a second hold. Disable the button while the
  request is in flight, never auto-retry `POST /user/bookings`, and after a timeout
  check `GET /user/bookings?tab=upcoming` before letting the user try again.

### 6.5 Razorpay checkout (`razorpay_flutter`)

Open checkout with the `payment` object from create (or the `data` of retry-payment):

```dart
final options = {
  'key': payment.keyId,                 // never hardcode; it comes from the server
  'order_id': payment.razorpayOrderId,
  'amount': payment.amount,             // paise, as given
  'currency': payment.currency,         // "INR"
  'name': payment.name,                 // "KSG"
  'description': payment.description,
  'prefill': {
    'name': payment.prefill.name,
    'contact': payment.prefill.contact,
    'email': payment.prefill.email,
  },
  'retry': {'enabled': true, 'max_count': 2},
  'timeout': secondsUntil(booking.payment.expiresAt), // do not let the sheet outlive the hold
};
_razorpay.open(options);
```

- `EVENT_PAYMENT_SUCCESS` gives `PaymentSuccessResponse { paymentId, orderId, signature }`
  → call verify (6.6) with those three values.
- `EVENT_PAYMENT_ERROR` (including user cancel, code 2 / `PAYMENT_CANCELLED`): do **not**
  treat the booking as failed. Re-fetch it (a payment may still have been captured), then
  show "Complete payment" with "Pay now" (retry-payment) while `expiresAt` is ahead.
- `EVENT_EXTERNAL_WALLET`: treat like an error/dismiss and poll.
- Development servers without Razorpay keys return `mock_order_*` orders and
  `keyId: "rzp_test_mock"`; the real SDK cannot open those. In dev builds, skip the SDK
  for `mock_order_` ids and call verify with `razorpayPaymentId: "mock_pay_<anything>"`
  and `razorpaySignature: "mock_signature_bypass"`. Never in production.

### 6.6 Verify payment

`POST /user/bookings/:id/verify-payment` (sensitive-action rate limit)

| Field | Type | Rules |
|---|---|---|
| `razorpayOrderId` | string | 1-100, must equal the booking's order |
| `razorpayPaymentId` | string | 1-100 |
| `razorpaySignature` | string | 1-200 |

```json
{ "razorpayOrderId": "order_PQx7Kd2LmN81Ab", "razorpayPaymentId": "pay_PQx8A1b2C3d4E5", "razorpaySignature": "5f1c0d7e...e9" }
```
```json
{ "success": true, "message": "Payment confirmed", "data": { "booking": {
  "_id": "6ad1f0c1d2e3f4a5b6c70401", "bookingRef": "KSGHMGQ3Z8K1A7F", "status": "confirmed",
  "payment": { "mode": "online", "status": "paid", "amountPaid": 5877.9, "amountDue": 0, "walletAmount": 0,
               "payNow": 5877.9, "onlineAmount": 5877.9, "onlinePaid": 5877.9, "collectedAtHotel": 0, "refundedAmount": 0 },
  "statusHistory": [
    { "status": "awaiting_payment", "at": "2026-10-17T06:42:00.000Z", "by": { "role": "user" }, "note": "Waiting for online payment" },
    { "status": "confirmed", "at": "2026-10-17T06:44:10.000Z", "by": { "role": "system" }, "note": "Paid online (verify)" } ],
  "canCancel": true, "canReview": false, "...": "rest as in 6.4" } } }
```

The server checks the HMAC signature, then fetches the payment from Razorpay: same
order, status `captured`, amount = the gateway part in paise. **Idempotent**: calling it
again with the same payment id returns the booking.

| Status | Message | App |
|---|---|---|
| 400 | `Payment does not belong to this booking` | Bug; re-fetch booking |
| 400 | `Payment signature is invalid` | Poll; contact support if not confirmed |
| 400 | `Payment is not complete yet (status: authorized); please try again shortly` | **Poll** (6.7) |
| 400 | `Paid amount does not match this booking` | Support |
| 409 | `The payment window ended before this payment arrived; it has been refunded` | Show "Payment refunded, please book again" |
| 502 | `Could not confirm the payment with the gateway: ...` | Poll |
| 503 | module switched off / gateway unavailable | Poll (the webhook still confirms) |

**Always look at `data.booking.status` after verify**, not only at the HTTP status.
⚠️ Note: if the Razorpay webhook already handled a payment that arrived after the hold
expired, verify answers **200 "Payment confirmed"** with a booking whose `status` is
`expired` and `payment.status` `refunded` (the idempotent short-circuit in
`booking.service.js verifyBookingPayment` runs before any status check). Treat
`status != confirmed` as "not booked; refunded".

### 6.7 Polling and the webhook-first case

The Razorpay webhook (`payment.captured`) confirms hotel bookings on the server through
the same idempotent path. So the booking may already be `confirmed` before verify
arrives (verify then just returns it), or even if the app was killed mid-payment.

Poll `GET /user/bookings/:id` every 3 s for up to 60 s (then every 10 s while the
screen is open) when:

- verify failed on the network, timed out, or returned 400 "not complete yet", 502, 503;
- Razorpay returned an error but the user may have paid (UPI intent apps often do this);
- the app resumes on a booking that is `awaiting_payment` (e.g. after being killed).

Stop when `status` is `confirmed` (success screen), `expired` or `cancelled` (failure
screen; `refunds[]` shows any refund). If `expiresAt` has passed and the status is still
`awaiting_payment`, keep polling for up to 2 more minutes: the expiry job runs every 60 s.

### 6.8 Retry payment

`POST /user/bookings/:id/retry-payment` (no body; sensitive-action rate limit).
`data` **is** the checkout object (not wrapped in `payment`); it is the **same order**
for the whole hold:

```json
{ "success": true, "message": "Payment", "data": {
  "razorpayOrderId": "order_PQx7Kd2LmN81Ab", "amount": 587790, "currency": "INR",
  "keyId": "rzp_live_XXXXXXXXXXXXXX", "name": "KSG", "description": "KSG Demo Hotel · KSGHMGQ3Z8K1A7F",
  "prefill": { "name": "Riya Sharma", "contact": "9000000001", "email": "riya.sharma@example.com" } } }
```
409 `This booking is not waiting for payment` (it is already confirmed: reload it) or
`The payment window has ended; please book again`.

### 6.9 Hold expiry

- `booking.payment.expiresAt` is present only while `status == "awaiting_payment"`.
- About 10 minutes before expiry (hold at least 2 min old), the guest gets a push
  `hotel_payment_expiring` (section 15).
- At expiry: status `expired`, `payment.amountDue: 0`, rooms released, wallet part
  refunded (a `refunds[]` row with reason "Payment window ended"), coupon use released,
  push `hotel_booking_expired`. `payment.status` becomes `failed` if nothing was paid.
- A payment captured after expiry is refunded in full automatically.

---

## 7. Customer: my stays, cancellation, voucher

### 7.1 List

`GET /user/bookings?tab=upcoming&page=1&limit=20`

| `tab` | Contains |
|---|---|
| `upcoming` | `awaiting_payment` / `confirmed` with check-in today or later |
| `ongoing` | `checked_in`, or `confirmed` with check-in before today and check-out after today |
| `past` | `checked_out`, `no_show`, or `confirmed` whose check-out date has passed |
| `cancelled` | `cancelled` and `expired` |
| (omitted) | everything |

Paged. Items are the booking (6.4 shape) **without `statusHistory`**, sorted by
check-in **newest first** (then created newest first), with `canCancel`, `canReview` and
`reviewId` when reviewed.

⚠️ Note: the sort is check-in descending for every tab, so in "Upcoming" the soonest
stay is last on the page. Re-sort ascending client-side for the Upcoming tab (fine while
a user has fewer than `limit` upcoming stays; with more, page through all of them).

```json
{ "success": true, "message": "Bookings", "data": {
  "items": [ { "_id": "6ad1f0c1d2e3f4a5b6c70401", "bookingRef": "KSGHMGQ3Z8K1A7F", "status": "confirmed",
               "snapshot": { "propertyName": "KSG Demo Hotel", "roomTypeName": "Deluxe Room", "coverImage": "https://placehold.co/1200x800?text=KSG+Demo+Hotel", "...": "..." },
               "checkIn": "2026-11-10", "checkOut": "2026-11-12", "nights": 2, "rooms": 1,
               "pricing": { "total": 5877.9, "...": "..." },
               "payment": { "mode": "online", "status": "paid", "amountPaid": 5877.9, "amountDue": 0, "...": "..." },
               "canCancel": true, "canReview": false } ],
  "page": 1, "limit": 20, "total": 1 } }
```

### 7.2 Detail

`GET /user/bookings/:id` → `data: { booking }` (full 6.4 shape with `statusHistory`).

| Field | Meaning |
|---|---|
| `status` | `awaiting_payment`, `confirmed`, `checked_in`, `checked_out`, `cancelled`, `no_show`, `expired` |
| `payment.status` | `pending`, `paid`, `partially_paid`, `refunded`, `partially_refunded`, `failed` |
| `payment.amountDue` | still to pay (at the hotel for `pay_at_hotel` / `partial_prepaid`); 0 once cancelled/expired |
| `payment.amountPaid` | wallet + online + collected at hotel (refunds do **not** reduce it; see `refundedAmount`) |
| `payment.expiresAt` | only while `awaiting_payment` |
| `canCancel` | the guest can cancel now (7.3) |
| `canReview` | `checked_out` and not reviewed yet |
| `reviewId` | present once reviewed |
| `cancellation` | `{ by: user|partner|admin|system, reason, at, refundAmount }` after a cancel |
| `refunds[]` | `{ amount, walletAmount, gatewayAmount, status: processed|pending|failed, reason, by, at }` |
| `statusHistory[]` | `{ status, at, by: { role }, note? }` |

404 for someone else's booking.

### 7.3 Cancellation

**Preview** `GET /user/bookings/:id/cancel-preview`

```json
{ "success": true, "message": "Cancellation preview", "data": {
  "refundAmount": 5877.9, "refundPercent": 100, "walletRefund": 0, "gatewayRefund": 5877.9,
  "policyText": "Free cancellation until 9 Nov 2026, 12:00 IST. After that, 50% of the amount paid is refunded.",
  "freeCancellationUntil": "2026-11-09T06:30:00.000Z", "canCancel": true } }
```

When the booking can no longer be cancelled online, the preview still answers 200,
message `This booking cannot be cancelled online`, with `canCancel: false` and all
refund figures 0 (`policyText` still filled): show "Contact the property" instead of a
Cancel button.

**Cancel** `POST /user/bookings/:id/cancel`

| Field | Type | Rules |
|---|---|---|
| `reason` | string? | max 500 |

```json
{ "reason": "Change of plans" }
```
→ `data: { booking }` with `status: "cancelled"`, `cancellation: { by: "user", reason,
at, refundAmount }`, `payment.amountDue: 0` and a `refunds[]` row when money is returned.
409 `This booking can no longer be cancelled online; please contact the property` or
`A checked in booking cannot be cancelled`.

Rules:

- The guest can cancel `awaiting_payment` and `confirmed` bookings until the **check-in
  moment** (check-in date at `checkInTime`, IST).
- `confirmed`: before `freeCancellationUntil` (= check-in moment − `freeCancelHours`)
  100%, after it `refundPercentAfter`% of what was paid **online + wallet**;
  `non_refundable` 0%. Cash collected at the hotel is never refunded by KSG.
- `awaiting_payment`: any wallet part is refunded in full; the Razorpay order is
  abandoned (a payment that still arrives is refunded automatically).
- Partner/admin cancellations always refund 100%.
- Refunds go to the card/UPI first (`gatewayRefund`, normal Razorpay speed, 5-7 days),
  then the wallet (`walletRefund`, instant).
- A coupon use is given back on cancel/expiry.
- Always show the server's `policyText` and figures; never compute refunds on the device.

### 7.4 Voucher

The voucher is an **HTML page** (not JSON, not PDF) with a "Print / Save as PDF" button.

1. `POST /user/bookings/:id/voucher-link` (customer token) →

   ```json
   { "success": true, "message": "Voucher link", "data": { "token": "eyJhbGciOi...", "expiresIn": 300 } }
   ```
   404 if not your booking.
2. Open, within 5 minutes, in a WebView or the external browser
   (`url_launcher`, `LaunchMode.externalApplication` so the user can print/save as PDF):

   ```
   https://ksgsons.com/api/v1/hotel/user/bookings/<id>/voucher?vt=<token>
   ```

The `vt` token works for that one booking only, for 5 minutes, and cannot be used as a
session token. Errors are JSON: 401 `This voucher link has expired. Open the voucher
again from your booking.` (also for a malformed token), 403 `This link is not for this
booking`, 404. Always request a fresh link right before opening. Do **not** use the
legacy `?token=<accessToken>` form (it leaks the session into browser history; kept only
for old web builds).

The voucher shows status, stay, guest, the price breakdown, the amount due at the hotel
and the cancellation policy; never commission or payout.

---

## 8. Customer: coupons, reviews, saved

### 8.1 Coupons (offers)

`GET /user/offers?propertyId=<id>` (customer token; `propertyId` optional) → plain array
of coupons the customer can use **now** (active, inside their window, not used up,
applicable to the property, within the per-user limit, first-booking codes only before
the first booking):

```json
{ "success": true, "message": "Offers", "data": [
  { "code": "STAY20", "title": "20% off your stay", "description": "On stays of Rs 2,000 or more.",
    "discountType": "percentage", "discountValue": 20, "maxDiscount": 500, "minBookingAmount": 2000,
    "validTo": "2026-12-31T18:29:59.000Z", "firstBookingOnly": false, "summary": "20% off up to Rs 500" },
  { "code": "FIRSTSTAY", "title": "First stay offer", "description": "",
    "discountType": "flat", "discountValue": 300, "maxDiscount": null, "minBookingAmount": 0,
    "validTo": null, "firstBookingOnly": true, "summary": "Rs 300 off" } ] }
```

400 `propertyId is not a valid id`, 404 `Property not found`.

Apply a coupon by sending `couponCode` on **quote** (to show the discount) and the same
code on **create**. The discount is a percentage of the stay `subtotal` (capped by
`maxDiscount`) or a flat amount, never more than the subtotal; `minBookingAmount` is
compared with the subtotal before taxes. The quote returns `coupon { code, title,
discount }` and `pricing.couponCode`/`couponDiscount`.

Coupon errors (all **400**, on quote and create, `<CODE>` uppercased):

| Message | When |
|---|---|
| `Enter a coupon code` | blank code |
| `<CODE> is not a valid coupon code` | unknown |
| `<CODE> is not active right now` | paused |
| `<CODE> is not active yet` | before `validFrom` |
| `<CODE> has expired` | after `validTo` |
| `<CODE> does not apply to this property` | restricted to other properties/types |
| `<CODE> needs a booking of at least Rs 2,000 before taxes` | below minimum |
| `<CODE> has been fully used` | total limit reached |
| `You have already used <CODE>` / `You have already used <CODE> 2 times, the most allowed` | per-user limit |
| `<CODE> is only for your first hotel booking` | first-booking code, customer has an earlier booking |
| `<CODE> gives no discount on this booking` | discount computes to 0 |
| `<CODE> has just been fully used; please book without it` | create only: last use taken meanwhile |

UX: on a coupon 400 from quote, keep the previous valid quote, show the message under
the coupon field and clear the code. ⚠️ Note: "earlier booking" for first-booking codes
includes an unpaid `awaiting_payment` hold, so a customer with a pending hold cannot use
a first-booking code until that hold is paid, cancelled or expired.

### 8.2 Write a review

Allowed once per booking after `checked_out` (`booking.canReview == true`).

`POST /user/reviews`

| Field | Type | Rules |
|---|---|---|
| `bookingId` | id | required, your booking |
| `rating` | int | required, 1-5 |
| `subRatings` | object? | `cleanliness`, `location`, `service`, `value`: each optional int 1-5 |
| `comment` | string? | max 2000 |
| `photos` | string[]? | max 10; **http(s) URLs** from `/api/v1/uploads/image` (public folders only) |

```json
{ "bookingId": "6ad1f0c1d2e3f4a5b6c70401", "rating": 5,
  "subRatings": { "cleanliness": 5, "location": 4, "service": 5, "value": 4 },
  "comment": "Clean rooms and quick check-in.",
  "photos": ["https://ksgsons.com/uploads/hotel/reviews/1729100000000-r1.webp"] }
```
**201**:
```json
{ "success": true, "message": "Review saved", "data": { "review": {
  "_id": "6ad2a0b1c2d3e4f5a6b70501", "propertyId": "6ad08398a409d8c2d05bb909", "bookingId": "6ad1f0c1d2e3f4a5b6c70401",
  "rating": 5, "subRatings": { "cleanliness": 5, "location": 4, "service": 5, "value": 4 },
  "comment": "Clean rooms and quick check-in.", "photos": ["https://ksgsons.com/uploads/hotel/reviews/1729100000000-r1.webp"],
  "user": { "name": "Riya" }, "status": "approved", "createdAt": "2026-11-12T08:10:00.000Z" } } }
```
`status` is `pending` when the admin turned auto-approval off (then it is not public yet).
Errors: 400 `You can review a stay after you check out`, `photos.0: photos must be
public photo links`; 404 `Booking not found`; 409 `You have already reviewed this stay`.

### 8.3 Saved properties

| Method | Path | Result |
|---|---|---|
| GET | `/user/saved` | plain array of PropertyCard, newest saved first, only still-listable properties (max 500) |
| POST | `/user/saved/:propertyId` | `{ "saved": true }`; idempotent; 404 if not listable |
| DELETE | `/user/saved/:propertyId` | `{ "saved": false }`; idempotent |

Saved cards: `_id, name, slug, propertyType, coverImage, address { area, city },
location, avgRating, totalReviews, amenities, startingPrice (or null), originalPrice?`
(no `distanceKm`/`available`).

⚠️ Note: no endpoint says whether one property is saved. Load `/user/saved` once after
login, keep a `Set<propertyId>` in memory, and update it optimistically on save/unsave.

---

## 9. Partner: profile and onboarding

### 9.1 Read profile

`GET /partner/me` (any partner, including pending) → `data: { partner }` (2.2 shape).
Use `partner.status` to route: `pending` → onboarding/pending screen, `rejected` → show
`rejectionReason` + fix-and-resubmit, `approved` → full app.

### 9.2 Update profile, KYC, bank, address

`PUT /partner/me`: partial update; **unknown keys are refused (400)**.

| Field | Type | Rules |
|---|---|---|
| `name` | string? | 2-80 |
| `email` | string? | valid email ≤ 120; unique across partners (409 `That email is already used by another partner account`) |
| `kyc.ownerName` | string? | ≤ 80 |
| `kyc.aadhaarNumberMasked` | string? | ≤ 32, **at most 4 digits visible** (e.g. `XXXXXXXX4321`) |
| `kyc.aadhaarFront`, `kyc.aadhaarBack` | url? | ≤ 500, from `/uploads/document` folder `aadhaar` |
| `kyc.panNumber` | string? | `AAAAA9999A` (stored uppercase) |
| `kyc.panImage` | url? | ≤ 500, folder `pan` |
| `kyc.gstNumber` | string? | 15 chars: 2 digits + 13 alphanumerics |
| `kyc.gstCertificate` | url? | ≤ 500, folder `gst` |
| `bank.accountHolder` | string? | ≤ 80 |
| `bank.accountNumberMasked` | string? | ≤ 32, **at most 4 digits visible** (e.g. `XXXXXXXX7788`) |
| `bank.ifsc` | string? | `AAAA0XXXXXX` |
| `bank.bankName` | string? | ≤ 80 |
| `address.line`, `city`, `state` | string? | ≤ 200 / 80 / 80 |
| `address.pincode` | string? | 6 digits |
| `address.lat`, `address.lng` | number? | send both to set the location |
| `acceptTerms` | `true`? | only `true`; stamps `termsAcceptedAt` once |

```json
{ "name": "Arjun Verma", "email": "stays.demo@ksgsons.com",
  "kyc": { "ownerName": "Arjun Verma", "panNumber": "ABCDE1234F", "aadhaarNumberMasked": "XXXXXXXX4321",
           "aadhaarFront": "https://ksgsons.com/api/v1/files/p/aadhaar/1729000000001-front.webp",
           "panImage": "https://ksgsons.com/api/v1/files/p/pan/1729000000000-pan.webp" },
  "bank": { "accountHolder": "Arjun Verma", "accountNumberMasked": "XXXXXXXX7788", "ifsc": "SBIN0001234", "bankName": "State Bank of India" },
  "address": { "line": "MP Nagar Zone 1", "city": "Bhopal", "state": "Madhya Pradesh", "pincode": "462011", "lat": 23.2332, "lng": 77.4343 },
  "acceptTerms": true }
```
→ `data: { partner }`, message `Profile updated`.

- **Masking is the app's job.** Never send a full Aadhaar or bank account number: the
  server rejects more than 4 digits (`kyc.aadhaarNumberMasked: Aadhaar number must be
  masked, showing at most the last 4 digits (e.g. XXXXXXXX1234)`). Let the user type the
  full number, validate it locally (12 digits / 9-18 digits), then send
  `'X' * (len - 4) + last4`. The full number never leaves the phone.
- `kyc` and `bank` are **merged** with what is stored (send only what changed).
- A `rejected` partner who saves the profile goes back to `pending` review.
- Submitting a property needs `kyc.ownerName` and `kyc.panNumber` (10.10); a withdrawal
  needs `bank.ifsc` plus `accountNumberMasked` or `accountHolder` (13.5).
- ⚠️ Note: a partner can change the bank account and withdraw straight away (no
  re-verification; security review D3). Consider a confirmation step in the app.

---

## 10. Partner: properties, room types, documents, submit, live

A pending partner may create, edit and submit properties. Property statuses: `draft` →
(`submit`) `pending` → `approved` | `rejected` (with `rejectionReason`); an admin may also
`suspend`. A property is **listed to customers** only when `status == approved`,
`isLive == true` and the partner is approved.

### 10.1 List

`GET /partner/properties` → plain array of the partner's properties (newest first), in
the partner Property shape (18.3).

### 10.2 Create a draft

`POST /partner/properties` → **201** `{ property }` with `status: "draft"`,
`isLive: false`. Only `name` and `propertyType` are required, so the wizard can save
after step 1. Body fields (all optional except those two; **unknown keys → 400**):

| Field | Type | Rules |
|---|---|---|
| `name` | string | 2-120 (required on create) |
| `propertyType` | enum | catalogue `propertyTypes` (required on create) |
| `typeDetails` | object? | `hotelCategory` `budget|premium|luxury`, `starRating` 1-5, `resortType` `beach|hill|jungle|desert`, `pgType` `boys|girls|unisex`, `hostelType` `boys|girls|mixed`, `hostLivesOnProperty` bool |
| `suitability` | enum? | catalogue `suitability` |
| `description` | string? | ≤ 5000 |
| `shortDescription` | string? | ≤ 200 |
| `contactNumber` | string? | ≤ 16 (shown publicly) |
| `address` | object? | `line1` ≤200, `area` ≤120, `city` ≤80, `state` ≤80, `pincode` 6 digits or `""`, `country` ≤60, `fullAddress` ≤500 |
| `location` | object? | `{ lat: -90..90, lng: -180..180 }` |
| `nearbyPlaces` | array? | ≤ 30 of `{ name 1-120, type? ≤60, distanceKm? 0-1000 }` |
| `coverImage` | url? | ≤ 1000, **public** image (not a private document link) |
| `images` | url[]? | ≤ 40, public images; gallery without the cover |
| `amenities` | enum[]? | catalogue amenity keys |
| `houseRules` | string[]? | ≤ 40 items of ≤ 300 |
| `checkInTime`, `checkOutTime` | string? | `HH:mm` 24 h (defaults `12:00` / `11:00`) |
| `cancellationPolicy` | object? | `type` (catalogue), `freeCancelHours` 0-720, `refundPercentAfter` 0-100 (defaults moderate / 24 / 0) |

```json
{ "name": "KSG Demo Hotel", "propertyType": "hotel",
  "typeDetails": { "hotelCategory": "premium", "starRating": 4 }, "suitability": "both",
  "shortDescription": "Business hotel in MP Nagar, minutes from DB Mall.",
  "description": "A comfortable city hotel in the heart of Bhopal ...",
  "contactNumber": "9000000010",
  "address": { "line1": "Plot 12, Zone 1", "area": "MP Nagar", "city": "Bhopal", "state": "Madhya Pradesh", "pincode": "462011", "country": "India" },
  "location": { "lat": 23.2332, "lng": 77.4343 },
  "nearbyPlaces": [ { "name": "DB City Mall", "type": "mall", "distanceKm": 1.2 } ],
  "coverImage": "https://ksgsons.com/uploads/hotel/properties/1729000000100-cover.webp",
  "images": ["https://ksgsons.com/uploads/hotel/properties/1729000000101-1.webp", "https://ksgsons.com/uploads/hotel/properties/1729000000102-2.webp"],
  "amenities": ["wifi", "ac", "parking"], "houseRules": ["Valid photo ID required at check-in"],
  "checkInTime": "12:00", "checkOutTime": "11:00",
  "cancellationPolicy": { "type": "moderate", "freeCancelHours": 24, "refundPercentAfter": 50 } }
```

- `location` is sent as `{ lat, lng }` and returned as GeoJSON `[lng, lat]`.
- The `slug` is generated once at create from name + city and never changes.
- `cover`/`images` pointing into a private folder → 400 `coverImage: must be a public
  photo link, not a private document`.

### 10.3 Detail

`GET /partner/properties/:id` → `{ property, roomTypes, documents }`. `roomTypes`
includes inactive ones (`isActive: false`), cheapest first. `documents` is the
PropertyDocuments shape (10.9). 404 for someone else's property.

### 10.4 Update

`PUT /partner/properties/:id`: same fields as create, all optional (partial).
`address`, `typeDetails` and `cancellationPolicy` are **merged** with what is stored.
→ `{ property }`.

- Changing `name`, `propertyType`, `location` or `address` of an **approved** property
  sends it back to `pending` (message `Property updated and sent back for approval`); it
  stops being listed until re-approved. Warn the partner before saving such a change.
- Changing `propertyType` to one its active room types cannot sell → 400 naming the room
  type.

### 10.5 Delete

`DELETE /partner/properties/:id` → `{ _id }` (soft delete, also takes it offline). 409
`This property has upcoming bookings. Cancel or complete them before deleting it.`

### 10.6 Create room type

`POST /partner/properties/:id/room-types` → **201** `{ roomType }`. Required: `name`,
`maxAdults`, `pricePerNight`, `images` (**at least 3**); unknown keys → 400.

| Field | Type | Rules |
|---|---|---|
| `name` | string | 1-80 |
| `description` | string? | ≤ 1000 |
| `inventoryType` | enum? | `room|bed|entire`, must be allowed for the property type (`catalogue.inventoryTypesByProperty`); may be omitted when only one is allowed |
| `roomCategory` | enum? | `private|shared|entire` |
| `baseAdults` | int? | 1-50, default 2 (adults included in the price) |
| `baseChildren` | int? | 0-50, default 0 |
| `maxAdults` | int | 1-50, ≥ `baseAdults` |
| `maxChildren` | int? | 0-50, default 0 |
| `bedsPerRoom` | int? | 1-50, default 1 (beds sold = `totalInventory × bedsPerRoom` for `bed`) |
| `totalInventory` | int | 1-1000 (required unless `entire`, which is always 1) |
| `pricePerNight` | number | 0-10,000,000, rounded to 2 dp |
| `originalPrice` | number? / null | strike-through price |
| `weekendPrice` | number? / null | Fri + Sat nights |
| `extraAdultPrice`, `extraChildPrice` | number? | per extra guest per night |
| `mealPlan` | enum? | catalogue `mealPlans`, default `room_only` |
| `images` | url[] | 3-30 public images |
| `amenities` | enum[]? | catalogue keys |
| `isActive` | bool? | default true |

```json
{ "name": "Deluxe Room", "description": "City view, queen bed", "roomCategory": "private",
  "baseAdults": 2, "baseChildren": 0, "maxAdults": 3, "maxChildren": 1, "totalInventory": 6,
  "pricePerNight": 2799, "originalPrice": 3499, "weekendPrice": 3199, "extraAdultPrice": 600, "extraChildPrice": 300,
  "mealPlan": "breakfast",
  "images": ["https://ksgsons.com/uploads/hotel/properties/d1.webp", "https://ksgsons.com/uploads/hotel/properties/d2.webp", "https://ksgsons.com/uploads/hotel/properties/d3.webp"],
  "amenities": ["wifi", "ac", "tv", "breakfast"] }
```

Errors: 400 `A hotel cannot sell by bed. Allowed: room`, `Some details are missing or
invalid: images` (fewer than 3 photos), `maxAdults cannot be less than baseAdults`.
Creating a room type also creates its inventory rows for the next 365 days and updates
the property's `startingPrice`.

### 10.7 Update room type

`PUT /partner/properties/:id/room-types/:roomTypeId`: partial; `originalPrice` /
`weekendPrice` accept `null` to clear → `{ roomType }`.
409 `Cannot reduce inventory to 4: 5 unit(s) are already booked on 2026-11-10` when the
new capacity is below what is booked on a future night; 409 `This room type has upcoming
bookings and cannot be deactivated.` for `isActive: false` with upcoming bookings.

### 10.8 Deactivate room type

`DELETE /partner/properties/:id/room-types/:roomTypeId` → `{ roomType }` with
`isActive: false` (not deleted; reactivate with PUT `isActive: true`). 409 with upcoming
bookings.

### 10.9 Documents

`PUT /partner/properties/:id/documents` **replaces** the whole list:

| Field | Type | Rules |
|---|---|---|
| `documents` | array | ≤ 20 |
| `documents[].type` | enum | `trade_license`, `rent_agreement`, `electricity_bill`, `gst_certificate`, `fire_noc`, `other` |
| `documents[].name` | string? | ≤ 120 |
| `documents[].fileUrl` | string | 1-1000, from `/api/v1/uploads/document` folder `documents` |

```json
{ "documents": [
  { "type": "trade_license", "name": "Trade licence 2026", "fileUrl": "https://ksgsons.com/api/v1/files/p/documents/1729000000200-tl.pdf" },
  { "type": "gst_certificate", "fileUrl": "https://ksgsons.com/api/v1/files/p/documents/1729000000201-gst.pdf" } ] }
```
```json
{ "success": true, "message": "Documents saved", "data": {
  "propertyId": "6ad08398a409d8c2d05bb909",
  "documents": [
    { "type": "trade_license", "name": "Trade licence 2026", "fileUrl": "https://ksgsons.com/api/v1/files/p/documents/1729000000200-tl.pdf?e=1792224000&s=Ab1...",
      "isRequired": true, "uploadedAt": "2026-10-17T07:00:00.000Z" },
    { "type": "gst_certificate", "fileUrl": "https://ksgsons.com/api/v1/files/p/documents/1729000000201-gst.pdf?e=1792224000&s=Cd2...",
      "isRequired": true, "uploadedAt": "2026-10-17T07:00:00.000Z" } ],
  "verificationStatus": "pending", "adminRemark": "",
  "requiredTypes": ["trade_license", "gst_certificate"] } }
```

- `requiredTypes` = catalogue `requiredDocuments[propertyType]`, plus `gst_certificate`
  when the partner has a `kyc.gstNumber`.
- Any save resets `verificationStatus` to `pending` (admin re-checks). Values:
  `pending`, `verified`, `rejected` (with `adminRemark`).
- It is a replace: when adding one document, send the existing ones too. The links you
  read back are signed (`?e=..&s=..`); you may send them back as they are (the server
  normalises posted-back signed links, `core/files/privateFiles.js`), but compare
  documents by the path without the query string. The same applies to KYC image fields
  in `PUT /partner/me`.

### 10.10 Submit for approval

`POST /partner/properties/:id/submit` → `{ property }` with `status: "pending"`.
Only `draft` or `rejected` properties (409 `Only a draft or rejected property can be
submitted (this one is pending)`). Every missing item is listed in **one 400 message**:

```
Cannot submit: the property address needs a city; set the property location on the map;
a cover image is required; at least 3 photos (including the cover) are required; add at
least one active room type; missing documents: trade_license; complete your KYC (owner
name and PAN) in your profile
```
Run the same checklist in the app before enabling "Submit" (address.city, location,
cover, cover + gallery ≥ 3 distinct photos, ≥ 1 active room type, all `requiredTypes`
uploaded, KYC owner name + PAN).

### 10.11 Live toggle

`PUT /partner/properties/:id/live` `{ "isLive": true }` → `{ property }`, message
`Property is live` / `Property is offline`. Going live needs the **partner** approved
(403 `Your hotel partner account must be approved before a property can go live.`) and
the **property** approved (403 `This property must be approved before it can go live.`).
Going offline is always allowed. Body is strict (`isLive` only).

---

## 11. Partner: inventory calendar and blocks

Approved partners only.

### 11.1 Calendar

`GET /partner/inventory?roomTypeId=<id>&from=2026-11-10&to=2026-11-16[&propertyId=<id>]`

`from`..`to` are **inclusive** days, at most **92 days**. 404 if the room type is not
yours. → `{ roomTypeId, days: InventoryDay[] }`:

```json
{ "success": true, "message": "Inventory", "data": {
  "roomTypeId": "6ad08398a409d8c2d05bb90f",
  "days": [
    { "date": "2026-11-10", "capacity": 6, "booked": 1, "available": 5, "price": 2799, "closed": false },
    { "date": "2026-11-13", "capacity": 6, "booked": 2, "available": 4, "price": 3199, "closed": false },
    { "date": "2026-11-15", "capacity": 6, "booked": 0, "available": 6, "price": 2500, "priceOverride": 2500, "closed": false },
    { "date": "2026-11-16", "capacity": 6, "booked": 0, "available": 6, "price": 2799, "closed": true } ] } }
```
(shortened; one row per day.) `price` is what a guest pays that night (override ??
weekend price ?? base). `priceOverride` is present only when set. `booked` includes
platform bookings, holds and offline blocks. ⚠️ Note: `available` ignores `closed`; show a
closed day as closed regardless of `available`.

### 11.2 Bulk update price / closed

`PUT /partner/inventory`

| Field | Type | Rules |
|---|---|---|
| `roomTypeId` | id | required, yours |
| `from`, `to` | date | inclusive, at most **366 days** |
| `priceOverride` | number? / null | 0-10,000,000; `null` removes the override |
| `closed` | bool? | close/open the days |

At least one of `priceOverride` / `closed` (400 `Nothing to change: send priceOverride
and/or closed`). Strict body.

```json
{ "roomTypeId": "6ad08398a409d8c2d05bb90f", "from": "2026-12-24", "to": "2026-12-31", "priceOverride": 4499 }
```
→ `{ roomTypeId, updated, days? }` (`days` only when the range is ≤ 92 days).
Closing days does not cancel existing bookings; it stops new ones.

### 11.3 List blocks

`GET /partner/inventory/blocks?propertyId=<id>&from=2026-11-01&to=2026-11-30` (all
optional; without `propertyId`, all your properties; `from`/`to` inclusive select blocks
overlapping the range) → plain array (max 500), sorted by start date. Platform booking
rows are never listed here.

### 11.4 Create block (walk-in / external / manual)

`POST /partner/inventory/blocks` (strict body)

| Field | Type | Rules |
|---|---|---|
| `roomTypeId` | id | required, yours |
| `source` | enum | `walk_in`, `external`, `manual_block` |
| `startDate` | date | not in the past (IST) |
| `endDate` | date | **exclusive** (check-out day), after `startDate`, at most 366 nights |
| `units` | int | 1-1000 |
| `externalPlatform` | string? | ≤ 60 (e.g. `MakeMyTrip`) |
| `externalReference` | string? | ≤ 120 |
| `notes` | string? | ≤ 500 |

```json
{ "roomTypeId": "6ad08398a409d8c2d05bb90f", "source": "external", "startDate": "2026-11-20", "endDate": "2026-11-22",
  "units": 1, "externalPlatform": "MakeMyTrip", "externalReference": "MMT-778812", "notes": "Booked by phone" }
```
**201**:
```json
{ "success": true, "message": "Block created", "data": {
  "_id": "6ad2b1c2d3e4f5a6b7c80601", "propertyId": "6ad08398a409d8c2d05bb909", "roomTypeId": "6ad08398a409d8c2d05bb90f",
  "roomTypeName": "Deluxe Room", "source": "external", "startDate": "2026-11-20", "endDate": "2026-11-22", "units": 1,
  "externalPlatform": "MakeMyTrip", "externalReference": "MMT-778812", "notes": "Booked by phone",
  "createdBy": "partner", "createdAt": "2026-10-17T07:30:00.000Z" } }
```
409 `Not enough rooms available on 2026-11-21` when a night has no free unit (nothing
is kept).

### 11.5 Delete block

`DELETE /partner/inventory/blocks/:id` → `{ _id }`; the units are released. 404 for a
platform booking row or someone else's block.

---

## 12. Partner: bookings

Approved partners only. Partner booking view = customer view (6.4) **plus**
`partnerId`, commission figures in `pricing` (`commissionRate`, `commissionAmount`,
`commissionGst`, `partnerPayout`, and `couponFunding`/`platformSubsidy` when a coupon was
used), **minus** `userId`, `canCancel`, `canReview`. `statusHistory[].by` has the role only.

### 12.1 List

`GET /partner/bookings?status&propertyId&from&to&q&page&limit`

| Query | Rules |
|---|---|
| `status` | one booking status |
| `propertyId` | id |
| `from`, `to` | `YYYY-MM-DD`, filter on the **check-in date**, inclusive |
| `q` | ≤ 100; booking ref, guest name or guest phone |
| `page`, `limit` | paging (limit ≤ 100) |

Paged, newest created first, no `statusHistory`. Useful presets: today's arrivals
`status=confirmed&from=<today>&to=<today>`; in-house `status=checked_in`; needs action
`status=confirmed&to=<yesterday>`.

### 12.2 Detail

`GET /partner/bookings/:id` → `{ booking }`:

```json
{ "success": true, "message": "Booking", "data": { "booking": {
  "_id": "6ad1f0c1d2e3f4a5b6c70401", "bookingRef": "KSGHMGQ3Z8K1A7F",
  "propertyId": "6ad08398a409d8c2d05bb909", "partnerId": "6ad08398a409d8c2d05bb901", "roomTypeId": "6ad08398a409d8c2d05bb90f",
  "snapshot": { "propertyName": "KSG Demo Hotel", "roomTypeName": "Deluxe Room", "checkInTime": "12:00", "checkOutTime": "11:00", "...": "..." },
  "checkIn": "2026-11-10", "checkOut": "2026-11-12", "nights": 2, "rooms": 1, "guests": { "adults": 2, "children": 0 },
  "guestDetails": { "name": "Riya Sharma", "phone": "9000000001", "email": "riya.sharma@example.com" },
  "specialRequests": "Late check-in around 10 pm",
  "pricing": { "roomCharges": 5598, "extraGuestCharges": 0, "subtotal": 5598, "couponDiscount": 0, "platformSubsidy": 0,
               "prepaidDiscount": 279.9, "taxableAmount": 5318.1, "gstRate": 5, "gstAmount": 265.9, "platformFee": 0, "platformFeeGst": 0,
               "total": 5584, "commissionRate": 10, "commissionAmount": 531.81, "commissionGst": 95.73, "partnerPayout": 4956.46 },
  "payment": { "mode": "partial_prepaid", "status": "partially_paid", "amountPaid": 1675.2, "amountDue": 3908.8, "walletAmount": 0,
               "payNow": 1675.2, "onlineAmount": 1675.2, "onlinePaid": 1675.2, "collectedAtHotel": 0, "refundedAmount": 0 },
  "status": "confirmed",
  "statusHistory": [
    { "status": "awaiting_payment", "at": "2026-10-17T06:42:00.000Z", "by": { "role": "user" }, "note": "Waiting for online payment" },
    { "status": "confirmed", "at": "2026-10-17T06:44:10.000Z", "by": { "role": "system" }, "note": "Paid online (verify)" } ],
  "refunds": [], "source": "app", "createdAt": "2026-10-17T06:42:00.000Z", "updatedAt": "2026-10-17T06:44:10.000Z" } } }
```

### 12.3 Actions

All return `data: { booking }` (partner view). Rule violations are **409** with a
readable message; show it.

| Method | Path | Body | Allowed when | Errors (409 unless noted) |
|---|---|---|---|---|
| PUT | `/partner/bookings/:id/check-in` | none | `confirmed`, from the check-in date (IST) until before the check-out date | `Check-in opens on the check-in date`, `This stay has already ended`, `A cancelled booking cannot be moved to checked in` |
| PUT | `/partner/bookings/:id/check-out` | `{ "force": true }` optional | `checked_in` | `Rs 3908.8 is still unpaid. Record it with mark-paid, or check out with force.` |
| PUT | `/partner/bookings/:id/no-show` | none | `confirmed`, only **after** the check-in day | `A no-show can be marked only after the check-in day` |
| PUT | `/partner/bookings/:id/mark-paid` | `{ "amount": 3908.8 }` (number > 0, ≤ 10,000,000) | `confirmed` / `checked_in` / `checked_out`, `0 < amount ≤ amountDue` | 400 `amount must be more than 0 and at most the balance due (Rs 3908.8)`; 409 `Payments cannot be recorded on a cancelled booking` |
| PUT | `/partner/bookings/:id/cancel` | `{ "reason": "Room under maintenance" }` (**required**, 3-500) | `awaiting_payment` / `confirmed`, stay not over | `This stay has already ended`; message on success `Booking cancelled; the guest is refunded in full` |

- Any action can also return 409 `This booking was changed by someone else; reload and
  try again` (another actor won the race): re-fetch.
- Early check-out releases the unused nights. A no-show and a partner cancel free the
  rooms too.
- `mark-paid` records cash/UPI collected at the property (`collectedAtHotel`); use it
  before check-out for pay-at-hotel and part-payment bookings. Pre-fill `amount` with
  `payment.amountDue`.
- Partner cancel refunds the guest **100%** and notifies them; ask for confirmation and
  a reason.
- ⚠️ Note: `check-out` with `force: true` is accepted from partners and leaves the
  balance unpaid (only noted in history). Require an explicit second confirmation.

---

## 13. Partner: reviews, dashboard, earnings, ledger, withdrawals

Approved partners only.

### 13.1 Reviews and replies

`GET /partner/reviews?propertyId&page&limit` → paged reviews of your properties, **all
statuses** (`pending`, `approved`, `rejected`), newest first; reviewer first name; each
item adds `property: { _id, name }`.

`POST /partner/reviews/:id/reply` `{ "text": "Thank you, Riya! See you again." }`
(1-1000) → `{ review }` (without `property`). Replying again replaces the reply. 404 for
a review of someone else's property.

### 13.2 Dashboard

`GET /partner/dashboard`

```json
{ "success": true, "message": "Dashboard", "data": {
  "properties": { "total": 3, "live": 3, "pending": 0 },
  "todayArrivals": 2, "todayDepartures": 1, "upcomingBookings": 9,
  "revenueThisMonth": 48210.5, "occupancyThisMonth": 0.4167,
  "recentBookings": [ {
    "_id": "6ad1f0c1d2e3f4a5b6c70401", "bookingRef": "KSGHMGQ3Z8K1A7F",
    "propertyId": "6ad08398a409d8c2d05bb909", "roomTypeId": "6ad08398a409d8c2d05bb90f", "partnerId": "6ad08398a409d8c2d05bb901",
    "snapshot": { "propertyName": "KSG Demo Hotel", "roomTypeName": "Deluxe Room", "...": "..." },
    "checkIn": "2026-11-10", "checkOut": "2026-11-12", "nights": 2, "rooms": 1, "guests": { "adults": 2, "children": 0 },
    "guestDetails": { "name": "Riya Sharma", "phone": "9000000001" },
    "pricing": { "total": 5877.9, "commissionAmount": 559.8, "commissionGst": 100.76, "partnerPayout": 5217.34, "...": "..." },
    "payment": { "mode": "online", "status": "paid", "amountPaid": 5877.9, "amountDue": 0, "walletAmount": 0 },
    "status": "confirmed", "createdAt": "2026-10-17T06:42:00.000Z" } ] } }
```

- `todayArrivals`: confirmed/checked-in stays starting today; `todayDepartures`:
  checked-in/checked-out stays ending today; `upcomingBookings`: confirmed with check-in
  today or later.
- `revenueThisMonth` = Σ (taxableAmount + gstAmount) of confirmed/checked-in/checked-out
  bookings whose check-in is in this IST month.
- `occupancyThisMonth` is a 0..1 fraction (blocks count as booked). Show as %.
- `recentBookings`: last 5, excluding `awaiting_payment` and `expired`. The summary
  shape has a reduced `payment` (`mode, status, amountPaid, amountDue, walletAmount,
  expiresAt?`) and no `statusHistory`/`refunds`.

### 13.3 Earnings

`GET /partner/earnings`

```json
{ "success": true, "message": "Earnings", "data": {
  "balance": 15620.4, "pendingSettlement": 4410.2, "totalEarned": 61230.75, "thisMonth": 15620.4,
  "withdrawable": 15620.4, "minWithdrawal": 500 } }
```

- `balance`: ledger balance after held withdrawals. **Can be negative** (pay-at-hotel
  stays: the hotel owes commission).
- `withdrawable` = `max(0, balance)`.
- `pendingSettlement`: money for confirmed/in-house/checked-out bookings not yet settled
  (settles at `checked_out` by default); negative for pay-at-hotel. Not withdrawable.
- `totalEarned` / `thisMonth`: sum of non-withdrawal ledger rows (IST month for
  `thisMonth`).

### 13.4 Ledger

`GET /partner/ledger?page&limit` → paged, newest first:

```json
{ "success": true, "message": "Ledger", "data": { "items": [
  { "_id": "6ad3c1d2e3f4a5b6c7d80701", "type": "EARNING", "amount": 5877.9, "bookingRef": "KSGHMGQ3Z8K1A7F",
    "description": "Booking KSGHMGQ3Z8K1A7F: room charges", "createdAt": "2026-11-12T05:40:00.000Z", "balanceAfter": 21038.5 },
  { "_id": "6ad3c1d2e3f4a5b6c7d80702", "type": "COMMISSION", "amount": -660.56, "bookingRef": "KSGHMGQ3Z8K1A7F",
    "description": "Booking KSGHMGQ3Z8K1A7F: commission", "createdAt": "2026-11-12T05:40:00.000Z", "balanceAfter": 20377.94 },
  { "_id": "6ad3c1d2e3f4a5b6c7d80703", "type": "WITHDRAWAL", "amount": -5000,
    "description": "Withdrawal requested", "createdAt": "2026-11-12T09:00:00.000Z", "balanceAfter": 15377.94 } ],
  "page": 1, "limit": 20, "total": 3 } }
```

`type`: `EARNING`, `COMMISSION`, `PLATFORM_FEE`, `REFUND`, `ADJUSTMENT`, `WITHDRAWAL`.
Negative `amount` = debit. `bookingRef` only on booking rows. Show `description` as the
line title.

### 13.5 Withdrawals

`POST /partner/withdrawals` `{ "amount": 5000 }` (number > 0, ≤ 10,000,000) → **201**:

```json
{ "success": true, "message": "Withdrawal requested", "data": { "withdrawal": {
  "_id": "6ad3d1e2f3a4b5c6d7e80801", "amount": 5000, "status": "pending",
  "bank": { "accountHolder": "Arjun Verma", "accountNumberMasked": "XXXXXXXX7788", "ifsc": "SBIN0001234", "bankName": "State Bank of India" },
  "createdAt": "2026-11-12T09:00:00.000Z", "updatedAt": "2026-11-12T09:00:00.000Z",
  "partnerId": "6ad08398a409d8c2d05bb901", "partner": { "name": "KSG Demo Hotel Partner", "phone": "9000000010" } } } }
```

Errors: 400 `The minimum withdrawal is Rs 500`, `Add your bank account (account number
and IFSC) in your profile first`; 409 `You can withdraw at most Rs 15620.4`,
`Insufficient balance for this withdrawal`. The amount leaves the balance immediately (a
`WITHDRAWAL` ledger row); a rejected request puts it back.

`GET /partner/withdrawals?page&limit` → paged withdrawals, newest first. `status`:
`pending` → `approved` → `paid` (with `utr`, `processedAt`), or `rejected` (with
`note`). Fields: `_id, amount, status, bank, note?, utr?, processedAt?, createdAt,
updatedAt, partnerId, partner`.

---

## 14. Uploads

Upload the file first, then put the returned `data.url` in the JSON body.

| Endpoint | Accepts | Use | `folder` |
|---|---|---|---|
| `POST /api/v1/uploads/image` | images (transcoded to WebP) | property cover/gallery, room photos, review photos | `hotel/properties`, `hotel/reviews` |
| `POST /api/v1/uploads/document` | image or PDF | KYC (Aadhaar, PAN, GST) and property documents | `aadhaar`, `pan`, `gst`, `documents` |

- Auth: any signed-in token (customer or partner). Only the global API rate limiter
  applies.
- Multipart form: field **`file`** (one file), optional field `folder`.
- Max size **5 MB** (server default; **400** `That image is too large. The limit is 5MB
  — please pick a smaller photo.`). Compress photos on the device to ~1600 px / 80%
  JPEG before uploading.

```
POST /api/v1/uploads/image
Authorization: Bearer <token>
Content-Type: multipart/form-data
  file=@cover.jpg
  folder=hotel/properties
```
```json
{ "success": true, "message": "Image uploaded successfully",
  "data": { "url": "https://ksgsons.com/uploads/hotel/properties/1729000000100-cover.webp", "publicId": null,
            "path": "hotel/properties/1729000000100-cover.webp", "size": 182340, "mimeType": "image/webp" } }
```

Private folders (`aadhaar`, `pan`, `gst`, `documents`, and any path segment like
`license`, `registration`) are not publicly readable: their URLs are
`https://ksgsons.com/api/v1/files/p/<path>`, and JSON responses to signed-in callers
carry a **signed** version (`?e=<expiry>&s=<sig>`, about 2 h). Do not cache those links;
re-read the profile/property to show a document again. Photos (property, room, review)
**must** be uploaded to a public folder: the server refuses private links for photos.

Errors: 400 `No file provided`, `Unexpected file field. The image must be sent as
"file".`, `Please upload one image at a time.`, too large (above); 413 only if a proxy
rejects the body first; 401 no token.

---

## 15. Push notifications

### 15.1 Payload format

Hotel pushes are FCM messages with a `notification` (`title`, `body`) and a `data` map
of **strings**. Common data keys:

| Key | Meaning |
|---|---|
| `type` | one of the values below |
| `bookingId` | booking id (most types) |
| `bookingRef` | e.g. `KSGHMGQ3Z8K1A7F` |
| `link` | web path; map it to an in-app route (do not open a browser) |

### 15.2 Customer pushes

Register the device: send `fcmToken` + `platform: "mobile"` on
`/api/v1/auth/user/verify-otp`, and on every app start / token refresh call
`POST /api/v1/fcm-tokens/mobile/save` `{ "token": "<fcm token>" }` (customer Bearer;
**no `platform` field**, it is refused). Token length 20-4096.
`DELETE /api/v1/fcm-tokens/remove` `{ "token": "..." }` removes it (logout also does).

| `data.type` | When | Extra data | Deep link (customer app) |
|---|---|---|---|
| `hotel_booking_confirmed` | booking confirmed (paid, wallet, or pay at hotel) | `bookingId`, `bookingRef`, `link=/hotel/bookings/:id` | Booking detail (confirmation state) |
| `hotel_payment_expiring` | ~10 min before an unpaid hold ends | same | Booking detail with "Pay now" (retry-payment) |
| `hotel_booking_expired` | hold ended unpaid | same | Booking detail (expired) / "Book again" |
| `hotel_booking_cancelled` | cancelled by guest, hotel or admin; body mentions the refund | same | Booking detail (cancelled, refunds) |
| `hotel_refund` | a refund was paid (wallet and/or card) | same | Booking detail, refunds section |
| `hotel_checkin_reminder` | from 5 h before check-in time on the check-in day | same | Booking detail (directions, voucher) |
| `hotel_checked_in` | the hotel checked the guest in | same | Booking detail |
| `hotel_checked_out` | the hotel checked the guest out | same | Booking detail |
| `hotel_no_show` | the hotel marked a no-show | same | Booking detail (support CTA) |
| `hotel_review_request` | after check-out (within 14 days, once) | same | Booking detail → open the review sheet |

The same rows land in the customer notification inbox (16.2) with
`data.link = /hotel/bookings/:id`. A booking confirmation email is also sent when the
guest gave an email.

### 15.3 Partner pushes

Register the device **only** by sending `fcmToken` + `platform: "mobile"` on
`POST /partner/auth/verify-otp` (last 5 tokens per platform are kept). Logout removes it.

⚠️ Note: the core `/api/v1/fcm-tokens/*` endpoints **do not accept the `HOTEL_PARTNER`
role** (they answer 401 `Invalid or expired token`; `core/notifications/fcm.routes.js`
`ROLE_TO_OWNER_TYPE` has no hotel partner). When FCM rotates the token
(`onTokenRefresh`), there is no way to register the new one without logging in again.
Until the backend adds it (security review D13), on `onTokenRefresh` either prompt a
silent re-login (not possible without an OTP) or accept missed pushes until the next
login; see the Flutter plan for the recommended handling.

| `data.type` | When | Extra data | Deep link (partner app) |
|---|---|---|---|
| `hotel_new_booking` | a booking is confirmed | `bookingId`, `bookingRef`, `link=/hotel/partner/bookings/:id` | Partner booking detail |
| `hotel_booking_cancelled` | a confirmed booking was cancelled (not unpaid holds) | same | Partner booking detail |
| `hotel_mark_arrival` | from 03:00 IST the day after check-in, for confirmed bookings not marked | `bookingIds` (comma-separated), `link`; plus `bookingId`, `bookingRef` when only one | One: booking detail with Check-in / No-show; several: bookings list `status=confirmed` (link `/hotel/partner/bookings?status=confirmed`) |
| `hotel_monthly_summary` | 1st-3rd of the month (IST), previous month's figures | `month` (`YYYY-MM`), `link=/hotel/partner/earnings` | Earnings |

`hotel_booking_cancelled` is used for both audiences; the app you are in decides the
screen.

---

## 16. App services tile and notification inbox

### 16.1 Hotels tile

`GET /api/v1/platform/app-services?lat=23.2332&lng=77.4343` (no auth) lists the
customer app's service tiles. Live:

```json
{ "success": true, "message": "App services", "data": { "located": false, "services": [
  { "key": "food", "label": "Food", "inZone": null, "zone": null, "visible": true, "reason": null },
  { "key": "quick", "label": "Quick Commerce", "inZone": null, "zone": null, "visible": true, "reason": null },
  { "key": "medical", "label": "Medical", "inZone": null, "zone": null, "visible": true, "reason": null },
  { "key": "taxi", "label": "Taxi", "inZone": null, "zone": null, "visible": true, "reason": null },
  { "key": "hotel", "label": "Hotels", "inZone": null, "zone": null, "visible": true, "reason": null } ] } }
```
Hide the Hotels entry when `visible` is false. Hotels have no delivery zones
(`inZone` is always `null`).

### 16.2 Customer inbox

Hotel notifications are recorded in the shared customer inbox
(`GET /api/v1/food/notifications/inbox?page&limit`, customer Bearer;
`PATCH /api/v1/food/notifications/:id/read`, `PATCH .../inbox/read-all`). Rows carry
`vertical: "hotel"` and `data.link`. ⚠️ Note: the inbox has no vertical filter
parameter; filter on `vertical` client-side if the Hotels section shows its own list.

---

## 17. Admin endpoints (not for Flutter)

Admin token with `hotel` service access (sub-admins further limited by `hotel_*`
permissions). Used by the web admin panel only; listed so nobody re-implements them.

| Area | Endpoints |
|---|---|
| Overview | `GET /admin/overview` |
| Partners | `GET /admin/partners?status&page&limit`, `GET /admin/partners/:id`, `PUT /admin/partners/:id/status` |
| Properties | `GET /admin/properties?status&type&...`, `GET /admin/properties/:id`, `PUT /admin/properties/:id/status`, `PUT /admin/properties/:id/documents/verify`, `PUT /admin/properties/:id/live` |
| Bookings | `GET /admin/bookings`, `GET /admin/bookings/:id`, `PUT /admin/bookings/:id/status`, `POST /admin/bookings/:id/refund` |
| Reviews | `GET /admin/reviews`, `PUT /admin/reviews/:id/status` |
| Withdrawals | `GET /admin/withdrawals`, `PUT /admin/withdrawals/:id/status` |
| Coupons | `GET/POST /admin/offers`, `GET/PUT/DELETE /admin/offers/:id` |
| Settings | `GET /admin/settings`, `PUT /admin/settings` (commission, GST slabs, hold minutes, prepaid %, pay at hotel, auto-approve reviews, min withdrawal, settleOn) |

Payment webhook (server-to-server): `POST /api/v1/payments/webhook/...` (Razorpay).
Details: `docs/hotel-api-contract.md`.

---

## 18. Shapes reference

Types: `id` = 24-hex string, `date` = `YYYY-MM-DD` (IST), `ts` = ISO-8601 UTC, `?` =
may be absent.

### 18.1 PropertyCard (search, saved)

`_id: id, name, slug, propertyType, coverImage, address { area, city },
location { type, coordinates [lng, lat] }, distanceKm?: num, avgRating: num,
totalReviews: int, amenities: string[], startingPrice: num (saved: num|null),
originalPrice?: num, available?: bool`

### 18.2 Property (public detail)

`_id, name, slug, propertyType, typeDetails? { hotelCategory?, starRating?, resortType?,
pgType?, hostelType?, hostLivesOnProperty? }, suitability, description,
shortDescription, contactNumber?, address { line1?, area?, city?, state?, pincode?,
country?, fullAddress? }, location?, nearbyPlaces? [{ name, type?, distanceKm? }],
coverImage, images[], amenities[], houseRules[], checkInTime, checkOutTime,
cancellationPolicy { type, freeCancelHours, refundPercentAfter }, status, isLive,
startingPrice?, originalPrice?, avgRating, totalReviews, createdAt, updatedAt`

### 18.3 Property (partner view)

Public shape plus `partnerId, zoneId?, rejectionReason, approvedAt?, approvedBy?`;
`status` any of `draft, pending, approved, rejected, suspended`.

### 18.4 RoomType

`_id, propertyId, name, description, inventoryType (room|bed|entire), roomCategory?
(private|shared|entire), baseAdults, baseChildren, maxAdults, maxChildren, bedsPerRoom,
totalInventory, pricePerNight, originalPrice?, weekendPrice?, extraAdultPrice,
extraChildPrice, mealPlan, images[], amenities[], isActive, createdAt, updatedAt`

### 18.5 Availability

`checkIn, checkOut, nights: int, roomTypes: [{ roomTypeId, name, available: int,
bookable: bool, nightlyPrices: [{ date, price }], total }]`

### 18.6 Quote

`propertyId, roomTypeId, checkIn, checkOut, nights, rooms, guests { adults, children },
available, paymentMode, pricing (18.7 customer), nightlyPrices[], payNow, payAtHotel,
walletApplicable, cancellationPolicy, freeCancellationUntil?: ts, holdMinutes,
coupon? { code, title, discount }`

### 18.7 Pricing

Customer: `roomCharges, extraGuestCharges, subtotal, couponCode?, couponDiscount,
prepaidDiscount, taxableAmount, gstRate (percent), gstAmount, platformFee,
platformFeeGst, total`. Partner adds: `couponFunding? (platform|partner),
platformSubsidy, commissionRate, commissionAmount, commissionGst, partnerPayout`.

### 18.8 Booking

`_id, bookingRef, userId (customer view only), partnerId (partner view only),
propertyId, roomTypeId, zoneId?, snapshot { propertyName, propertyType, roomTypeName,
address, coverImage, checkInTime, checkOutTime, cancellationPolicy }, checkIn, checkOut,
nights, rooms, guests { adults, children }, guestDetails { name, phone, email? },
specialRequests?, pricing, payment { mode, status, amountPaid, amountDue, walletAmount,
payNow, onlineAmount, onlinePaid, collectedAtHotel, refundedAmount, expiresAt? },
status, statusHistory? [{ status, at, by { role }, note? }], cancellation? { by, reason,
at, refundAmount, refundId? }, refunds [{ amount, walletAmount, gatewayAmount, status,
reason, by, at }], reviewId?, source (app|web|admin), canCancel? / canReview? (customer
view), createdAt, updatedAt`. Lists omit `statusHistory`.

### 18.9 BookingSummary (partner dashboard)

`_id, bookingRef, propertyId, roomTypeId, partnerId, snapshot, checkIn, checkOut,
nights, rooms, guests, guestDetails, specialRequests?, pricing (partner), payment { mode,
status, amountPaid, amountDue, walletAmount, expiresAt? }, status, cancellation?,
reviewId?, createdAt`

### 18.10 Payment (Razorpay checkout object)

`razorpayOrderId, amount (paise int), currency ("INR"), keyId, name, description,
prefill { name, contact, email }`

### 18.11 CancelPreview

`refundAmount, refundPercent, walletRefund, gatewayRefund, policyText,
freeCancellationUntil?: ts, canCancel`

### 18.12 Review

`_id, propertyId, bookingId, rating, subRatings? { cleanliness?, location?, service?,
value? }, comment, photos[], reply? { text, at }, user { name }, status
(pending|approved|rejected), createdAt, property? { _id, name } (partner lists)`

### 18.13 ReviewList (public)

Paged Review items + `summary { avgRating, totalReviews, breakdown { "1".."5": int } }`

### 18.14 Offer (customer)

`code, title, description, discountType (percentage|flat), discountValue, maxDiscount:
num|null, minBookingAmount, validTo: ts|null, firstBookingOnly, summary`

### 18.15 Partner

`_id, name, phone, email?, platformUserId?, status (pending|approved|rejected|blocked),
rejectionReason, approvedAt?, kyc? { ownerName?, aadhaarNumberMasked?, aadhaarFront?,
aadhaarBack?, panNumber?, panImage?, gstNumber?, gstCertificate? }, bank? {
accountHolder?, accountNumberMasked?, ifsc?, bankName? }, address? { line?, city?,
state?, pincode?, location? }, termsAcceptedAt?, lastLoginAt?, createdAt, updatedAt`

### 18.16 PropertyDocuments

`propertyId, documents [{ type, name?, fileUrl, isRequired, uploadedAt }],
verificationStatus (pending|verified|rejected), adminRemark, verifiedAt?, requiredTypes[]`

### 18.17 InventoryDay

`date, capacity, booked, available, price, priceOverride?, closed`

### 18.18 Block

`_id, propertyId, roomTypeId, roomTypeName?, source (walk_in|external|manual_block),
startDate, endDate (exclusive), units, externalPlatform?, externalReference?, notes?,
createdBy, createdAt`

### 18.19 Dashboard, Earnings, LedgerEntry, Withdrawal

- Dashboard: `properties { total, live, pending }, todayArrivals, todayDepartures,
  upcomingBookings, revenueThisMonth, occupancyThisMonth (0..1), recentBookings
  BookingSummary[]`
- Earnings: `balance, pendingSettlement, totalEarned, thisMonth, withdrawable,
  minWithdrawal`
- LedgerEntry: `_id, type, amount, bookingRef?, description, createdAt, balanceAfter`
- Withdrawal: `_id, amount, status (pending|approved|rejected|paid), bank { accountHolder,
  accountNumberMasked, ifsc, bankName }, note?, utr?, processedAt?, createdAt, updatedAt,
  partnerId, partner { name, phone } | null`

### 18.20 Enums

| Enum | Values |
|---|---|
| propertyType | `hotel resort villa homestay hostel pg` |
| inventoryType | `room bed entire` |
| property status | `draft pending approved rejected suspended` |
| partner status | `pending approved rejected blocked` |
| booking status | `awaiting_payment confirmed checked_in checked_out cancelled no_show expired` |
| paymentMode (request) | `pay_at_hotel online partial_prepaid` |
| payment.status | `pending paid partially_paid refunded partially_refunded failed` |
| cancellation policy | `flexible moderate strict non_refundable` |
| mealPlan | `room_only breakfast half_board full_board` |
| suitability | `couple_friendly family_friendly both none` |
| document type | `trade_license rent_agreement electricity_bill gst_certificate fire_noc other` |
| block source | `walk_in external manual_block` |
| ledger type | `EARNING COMMISSION PLATFORM_FEE REFUND ADJUSTMENT WITHDRAWAL` |
| withdrawal status | `pending approved rejected paid` |
| review status | `pending approved rejected` |

Parse every enum with an `unknown` fallback so a new server value never crashes the app.

---

## 19. Known gaps and inconsistencies

Found while verifying this reference against the code (2026-10-17). None blocks the
Flutter work; each has a client-side workaround described above.

| # | Gap | Where | Workaround |
|---|---|---|---|
| 1 | Error `details` (e.g. `code: too_many_holds`, `stale`) is never serialized | `Backend/src/middleware/errorHandler.js`; `services/booking.service.js` `assertHoldCapacity` | Branch on status + message (1.1) |
| 2 | verify-payment answers 200 "Payment confirmed" for a late capture the webhook already refunded (booking `expired`) | `services/booking.service.js` `verifyBookingPayment` (payment-id short-circuit before status check) | Check `booking.status` after verify (6.6) |
| 3 | `POST /user/bookings` has no idempotency key; retries create duplicate holds | `controllers/booking.controller.js` `create` | Single-flight button, no auto-retry (6.4) |
| 4 | Hotel partners cannot use `/api/v1/fcm-tokens/*`; a rotated partner token cannot be registered without re-login | `core/notifications/fcm.routes.js` `ROLE_TO_OWNER_TYPE` | 15.3; backend fix pending (D13) |
| 5 | Search `startingPrice` and `minPrice`/`maxPrice` ignore weekend prices and overrides | `services/search.service.js` | "from ₹X" label; real prices from availability/quote |
| 6 | Availability accepts `rooms` ≤ 50 / `children` ≤ 100, quote/create only ≤ 20 / ≤ 50 | `controllers/public.controller.js` vs `validators/booking.validators.js` | Cap pickers at 20 rooms, 50 children |
| 7 | Voucher never shows the meal plan: it reads `snapshot.mealPlan`, which create does not store | `controllers/userExtras.controller.js` `voucherHTML` vs `services/booking.service.js` `createBooking` snapshot | Show the meal plan in-app from the room type |
| 8 | `GET /user/offers?propertyId=` accepts a non-listable property | `services/offer.service.js` `userOffers` | Only call it from a property you loaded publicly |
| 9 | OTP issuance limit is a 400, not 429; a wrong OTP is a 401 | `core/otp/otp.service.js`, `core/auth/auth.service.js` | Interceptor must not refresh on auth endpoints (2.5) |
| 10 | Malformed voucher `vt` is reported as "expired" | `controllers/userExtras.controller.js` `voucherCaller` | Always fetch a fresh link |
| 11 | First-booking coupons are refused while the customer has an unpaid hold | `services/offer.service.js` `hasEarlierBooking` | Message is shown; nothing else |
| 12 | No "is pay at hotel allowed" or "is saved" flag | settings / saved | 6.1 and 8.3 |
| 13 | Customer booking list is sorted check-in descending for every tab | `controllers/booking.controller.js` `pageResult` | Re-sort Upcoming ascending (7.1) |
| 14 | Refresh tokens are not rotated or extended; sessions end 7 days after login | `core/auth/auth.service.js` `refreshAccessToken` | Route to login on refresh 401 |
| 15 | A module switch-off (503) also blocks `verify-payment` | `middleware/moduleEnabled.js` | Poll; the webhook still confirms (6.7) |

Earlier versions of this file said coupons were unsupported, that logout kept partner
FCM tokens, and showed `fcmTokens` in the partner profile and `partnerId` in public and
customer JSON. All four were fixed in code and are corrected here.
