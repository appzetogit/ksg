# KSG Stays (hotel) API: mobile integration guide

For the Flutter developers building the **Hotels** section of the KSG customer app and
the **hotel partner** app. Everything here was checked against the backend code
(`Backend/src/modules/hotel/**`); where this guide and `docs/hotel-api-contract.md`
disagree, this guide describes what the server actually does today.

- Base URL: `https://ksgsons.com/api/v1/hotel` (all paths below are relative to it
  unless they start with `/api/v1/`).
- Web app routes for deep links: customer `/hotel/...`, partner `/hotel/partner/...`.
- Examples use the seeded demo data (`Backend/scripts/seed-hotel.js`): **KSG Demo Hotel**,
  MP Nagar, Bhopal; demo partner phone `9000000010`.

Contents

1. [Conventions](#1-conventions)
2. [Authentication](#2-authentication)
3. [Dates, nights and time zones](#3-dates-nights-and-time-zones)
4. [Customer: browse and search (public)](#4-customer-browse-and-search-public)
5. [Customer: booking and payment flow](#5-customer-booking-and-payment-flow)
6. [Customer: my stays, cancel, voucher](#6-customer-my-stays-cancel-voucher)
7. [Customer: reviews and saved](#7-customer-reviews-and-saved)
8. [Partner app](#8-partner-app)
9. [Uploads](#9-uploads)
10. [Push notifications (FCM)](#10-push-notifications-fcm)
11. [App services tile](#11-app-services-tile)
12. [Admin endpoints (reference only)](#12-admin-endpoints-reference-only)
13. [Shapes reference](#13-shapes-reference)
14. [Changelog](#14-changelog)

---

## 1. Conventions

**Envelope.** Every JSON response is

```json
{ "success": true, "message": "Properties", "data": { } }
```

Errors:

```json
{ "success": false, "message": "checkIn cannot be in the past", "error": "checkIn cannot be in the past", "requestId": "c0f1d2..." }
```

Show `message` to the user for 4xx. A 5xx message is generic ("Internal server error");
quote `requestId` to support. A few guard responses (403 from the hotel partner guard,
401 from the voucher) carry only `success` and `message`.

| Status | Meaning in this API |
|---|---|
| 400 | Validation failed (bad date, party does not fit, coupon sent, missing field). Message names the field, e.g. `guestDetails.phone: ...` |
| 401 | No token, expired token, or account deactivated. Refresh once, then send the user to login |
| 403 | Wrong role (`Hotel partner access required`), partner not approved yet (`Your hotel partner account is pending approval.`), blocked account |
| 404 | Not found, or not yours (someone else's booking is a 404, never a 403) |
| 409 | Conflict: sold out, payment window ended, booking already moved on, duplicate review, withdrawal above balance |
| 429 | OTP rate limit (`/partner/auth/*`, `/api/v1/auth/user/*`) |
| 502 / 503 | Payment gateway could not create an order (the booking is released at once). **503 with `Retry-After`** on any write when an admin has switched the hotel module off: show "Hotel booking is paused, try again later" |

**Pagination.** `?page=1&limit=20` (limit max 100). Paged responses:

```json
{ "items": [ ], "page": 1, "limit": 20, "total": 42 }
```

Some lists are plain arrays (not paged): `/public/cities`, `/user/saved`,
`/partner/properties`, `/partner/inventory/blocks`.

**Money.** Rupees as numbers with up to 2 decimals (`5877.9`). The only paise value is
`payment.amount` in the Razorpay checkout object.

**Ids.** 24-character Mongo ObjectId strings. A malformed id gives 404.

**Headers.** `Authorization: Bearer <accessToken>`, `Content-Type: application/json`.

---

## 2. Authentication

Two kinds of token, both JWTs with a 15-minute access token and a 7-day refresh token.

### 2.1 Customer (role `USER`): the normal KSG customer login

```
POST /api/v1/auth/user/request-otp
{ "phone": "9876543210" }
```
```json
{ "success": true, "message": "OTP sent successfully",
  "data": { "phone": "9876543210", "isExistingUser": true, "needsNamePrompt": false } }
```
(`data.otp` is echoed only outside production.)

```
POST /api/v1/auth/user/verify-otp
{ "phone": "9876543210", "otp": "1234", "name": "Riya Sharma",
  "fcmToken": "<device token>", "platform": "mobile" }
```
`otp` is exactly 4 digits; `name` (2-100 chars) only when `needsNamePrompt` was true;
`fcmToken` + `platform: "mobile"` registers the device for pushes (optional).

```json
{ "success": true, "message": "Login successful",
  "data": { "accessToken": "eyJ...", "refreshToken": "eyJ...",
            "user": { "_id": "6650f1c2a9b3c4d5e6f70811", "name": "Riya Sharma", "phone": "9876543210" },
            "isNewUser": false } }
```

The same customer token works for food, rides and hotels. Hotel customer endpoints
(`/user/*`) need it; `/public/*` needs nothing.

### 2.2 Hotel partner (role `HOTEL_PARTNER`)

```
POST /partner/auth/request-otp
{ "phone": "9000000010" }
```
```json
{ "success": true, "message": "OTP sent successfully",
  "data": { "phone": "9000000010", "isExistingPartner": true } }
```
`phone` may include `+91`; it is normalised to 10 digits. 403 if the partner is blocked
or deleted. `data.otp` is echoed only outside production.

```
POST /partner/auth/verify-otp
{ "phone": "9000000010", "otp": "1234", "fcmToken": "<device token>", "platform": "mobile" }
```
`otp` 4-6 digits; `fcmToken` (max 512) and `platform` (`web` | `mobile`) optional, see
[section 10](#10-push-notifications-fcm).

```json
{ "success": true, "message": "Login successful",
  "data": {
    "accessToken": "eyJ...", "refreshToken": "eyJ...", "isNewPartner": false,
    "partner": {
      "_id": "6651a0b1c2d3e4f5a6b70001", "name": "KSG Demo Hotel Partner", "phone": "9000000010",
      "email": "stays.demo@ksgsons.com", "status": "approved",
      "kyc": { "ownerName": "Arjun Verma", "panNumber": "ABCDE1234F", "aadhaarNumberMasked": "XXXXXXXX4321" },
      "bank": { "accountHolder": "Arjun Verma", "accountNumberMasked": "XXXXXXXX7788", "ifsc": "SBIN0001234", "bankName": "State Bank of India" },
      "address": { "line": "MP Nagar Zone 1", "city": "Bhopal", "state": "Madhya Pradesh", "pincode": "462011" },
      "fcmTokens": { "web": [], "app": ["<device token>"] },
      "termsAcceptedAt": "2026-10-01T06:12:40.000Z", "lastLoginAt": "2026-10-15T04:30:11.000Z",
      "createdAt": "2026-10-01T06:10:02.000Z", "updatedAt": "2026-10-15T04:30:11.000Z"
    } } }
```

First verification of a new number creates the partner with `status: "pending"`
(`isNewPartner: true`). A pending partner can sign in, fill KYC and build/submit property
drafts; everything touching guests or money (inventory, bookings, earnings, reviews,
dashboard) returns **403 "pending approval"** until an admin approves.

### 2.3 Refresh and logout (both roles)

```
POST /api/v1/auth/refresh-token
{ "refreshToken": "eyJ..." }
```
```json
{ "success": true, "message": "Access token refreshed", "data": { "accessToken": "eyJ...", "refreshToken": "eyJ..." } }
```
The refresh token is returned unchanged (no rotation). 401 when it is unknown, expired,
the customer is deactivated, or the partner is blocked/deleted: clear storage and go to
login. Recommended: on any 401, refresh once and retry the request once.

```
POST /api/v1/auth/logout
{ "refreshToken": "eyJ...", "fcmToken": "<device token>", "platform": "mobile" }
```
Never fails. Note: it removes customer FCM tokens but **not** hotel partner tokens (see
section 10).

---

## 3. Dates, nights and time zones

- All stay dates are **IST calendar dates** as `YYYY-MM-DD` strings. Never send times or
  UTC timestamps for `checkIn` / `checkOut` / `from` / `to`.
- A stay is a set of **nights**: `checkIn` is the first night, `checkOut` is the morning
  you leave and is **exclusive**. `2026-11-10 -> 2026-11-12` = 2 nights (10th and 11th).
- `checkOut` must be after `checkIn`; at most **30 nights**; `checkIn` cannot be before
  today in IST (400). Compute "today" in `Asia/Kolkata`, not device time.
- Friday and Saturday nights use the room type's `weekendPrice` when it is set; a
  partner's per-night `priceOverride` wins over both.
- Timestamps (`createdAt`, `expiresAt`, `freeCancellationUntil`, `statusHistory[].at`) are
  ISO-8601 UTC strings: convert to IST for display.
- The guest may check in from the property's `checkInTime` (`HH:mm`, IST) on the check-in
  date. That moment drives cancellation: see [6.3](#63-cancel).
- Partner inventory ranges (`from`/`to` on the calendar) are **inclusive** days; block
  `endDate` is a check-out date and **exclusive** (see [8.4](#84-inventory-calendar-and-blocks)).

---

## 4. Customer: browse and search (public)

No token needed. All `GET`.

### 4.1 Catalogue

`GET /public/catalogue`: the lists filters and the partner wizard are built from. Cache
it for the session; never hardcode.

```json
{ "success": true, "message": "Hotel catalogue", "data": {
  "propertyTypes": ["hotel", "resort", "villa", "homestay", "hostel", "pg"],
  "inventoryTypesByProperty": { "hotel": ["room"], "resort": ["room"], "villa": ["entire"], "homestay": ["room", "entire"], "hostel": ["bed"], "pg": ["bed"] },
  "requiredDocuments": { "hotel": ["trade_license"], "homestay": ["electricity_bill"], "hostel": ["trade_license", "rent_agreement"] },
  "amenities": [ { "key": "wifi", "label": "Free Wi-Fi" }, { "key": "ac", "label": "Air conditioning" }, { "key": "parking", "label": "Parking" } ],
  "cancellationPolicies": ["flexible", "moderate", "strict", "non_refundable"],
  "mealPlans": ["room_only", "breakfast", "half_board", "full_board"],
  "suitability": ["couple_friendly", "family_friendly", "both", "none"] } }
```
(lists shortened here; 20 amenities in total.)

### 4.2 Cities

`GET /public/cities`: cities that have live properties, most first.

```json
{ "success": true, "message": "Cities", "data": [ { "city": "Bhopal", "count": 3 }, { "city": "Indore", "count": 1 } ] }
```

### 4.3 Search

`GET /public/properties?city=Bhopal&checkIn=2026-11-10&checkOut=2026-11-12&adults=2&rooms=1&sort=price_low&page=1&limit=20`

| Query | Notes |
|---|---|
| `q` | substring of name, city or area (case-insensitive) |
| `city` | exact city name, case-insensitive |
| `lat`, `lng`, `radiusKm` | "near me"; both coordinates or neither; radius default 50 km |
| `types` | comma list of property types |
| `amenities` | comma list of amenity keys; all must match |
| `suitability` | `couple_friendly` / `family_friendly` also match `both` |
| `minPrice`, `maxPrice` | on the cheapest room type that fits the party |
| `minRating` | 0-5 |
| `checkIn`, `checkOut` | both or neither; with dates, properties without a free fitting room on every night are excluded |
| `adults` (default 2), `children` (0), `rooms` (1) | party |
| `sort` | `relevance` (distance with lat/lng, else rating), `price_low`, `price_high`, `rating`, `distance`, `newest` |
| `page`, `limit` | paging |

```json
{ "success": true, "message": "Properties", "data": {
  "items": [ {
    "_id": "6651a0b1c2d3e4f5a6b70101", "name": "KSG Demo Hotel", "slug": "ksg-demo-hotel-bhopal",
    "propertyType": "hotel", "coverImage": "https://ksgsons.com/uploads/hotel/properties/ksg-demo-hotel-cover.jpg",
    "address": { "area": "MP Nagar", "city": "Bhopal" },
    "location": { "type": "Point", "coordinates": [77.4343, 23.2332] },
    "avgRating": 4.3, "totalReviews": 18,
    "amenities": ["wifi", "ac", "parking", "restaurant", "room_service"],
    "startingPrice": 1899, "originalPrice": 2499, "available": true } ],
  "page": 1, "limit": 20, "total": 1 } }
```

`distanceKm` appears only with `lat`/`lng`; `available` only with dates (always `true`,
since unavailable ones are filtered out). `location.coordinates` is `[lng, lat]`.

### 4.4 Property detail

`GET /public/properties/:idOrSlug` (slug or id). 404 unless approved, live and the
partner is approved. `roomTypes` are the active ones, cheapest first.

```json
{ "success": true, "message": "Property", "data": {
  "property": {
    "_id": "6651a0b1c2d3e4f5a6b70101", "partnerId": "6651a0b1c2d3e4f5a6b70001",
    "name": "KSG Demo Hotel", "slug": "ksg-demo-hotel-bhopal", "propertyType": "hotel",
    "typeDetails": { "hotelCategory": "premium", "starRating": 4 }, "suitability": "both",
    "shortDescription": "Business hotel in MP Nagar, minutes from DB Mall.",
    "description": "A comfortable city hotel in the heart of Bhopal with a rooftop restaurant, free Wi-Fi and 24x7 front desk.",
    "contactNumber": "9000000010",
    "address": { "line1": "Plot 12, Zone 1", "area": "MP Nagar", "city": "Bhopal", "state": "Madhya Pradesh", "pincode": "462011", "country": "India" },
    "location": { "type": "Point", "coordinates": [77.4343, 23.2332] },
    "nearbyPlaces": [ { "name": "DB City Mall", "type": "mall", "distanceKm": 1.2 }, { "name": "Bhopal Junction", "type": "railway", "distanceKm": 5 } ],
    "coverImage": "https://ksgsons.com/uploads/hotel/properties/ksg-demo-hotel-cover.jpg",
    "images": [ "https://ksgsons.com/uploads/hotel/properties/ksg-demo-hotel-1.jpg", "https://ksgsons.com/uploads/hotel/properties/ksg-demo-hotel-2.jpg" ],
    "amenities": ["wifi", "ac", "parking", "restaurant", "room_service", "power_backup", "lift", "cctv", "housekeeping", "tv", "front_desk_24x7"],
    "houseRules": ["Valid photo ID required at check-in", "No smoking in rooms"],
    "checkInTime": "12:00", "checkOutTime": "11:00",
    "cancellationPolicy": { "type": "moderate", "freeCancelHours": 24, "refundPercentAfter": 50 },
    "status": "approved", "isLive": true,
    "startingPrice": 1899, "originalPrice": 2499, "avgRating": 4.3, "totalReviews": 18,
    "createdAt": "2026-10-01T06:20:00.000Z", "updatedAt": "2026-10-12T09:41:27.000Z" },
  "roomTypes": [ {
    "_id": "6651a0b1c2d3e4f5a6b70202", "propertyId": "6651a0b1c2d3e4f5a6b70101",
    "name": "Deluxe Room", "description": "", "inventoryType": "room", "roomCategory": "private",
    "baseAdults": 2, "baseChildren": 0, "maxAdults": 3, "maxChildren": 1, "bedsPerRoom": 1, "totalInventory": 6,
    "pricePerNight": 2799, "originalPrice": 3499, "weekendPrice": 3199,
    "extraAdultPrice": 600, "extraChildPrice": 300, "mealPlan": "breakfast",
    "images": [ "https://ksgsons.com/uploads/hotel/properties/deluxe-1.jpg" ],
    "amenities": ["wifi", "ac", "tv", "breakfast"], "isActive": true,
    "createdAt": "2026-10-01T06:21:00.000Z", "updatedAt": "2026-10-01T06:21:00.000Z" } ] } }
```

For the share sheet use `https://ksgsons.com/hotel/p/<slug>`.

### 4.5 Live availability for dates

`GET /public/properties/:id/availability?checkIn=2026-11-10&checkOut=2026-11-12&adults=2&children=0&rooms=1`
(`:id` must be the id, not the slug.)

```json
{ "success": true, "message": "Availability", "data": {
  "checkIn": "2026-11-10", "checkOut": "2026-11-12", "nights": 2,
  "roomTypes": [ {
    "roomTypeId": "6651a0b1c2d3e4f5a6b70202", "name": "Deluxe Room",
    "available": 4, "bookable": true,
    "nightlyPrices": [ { "date": "2026-11-10", "price": 2799 }, { "date": "2026-11-11", "price": 2799 } ],
    "total": 5598 } ] } }
```

`available` = fewest free rooms (beds for hostels) over the nights; a closed night counts
as 0. `bookable` = enough rooms **and** the party fits. `total` = rooms x sum of nightly
prices, before extra guests, discounts and GST: use the quote for the real price.

### 4.6 Reviews of a property

`GET /public/properties/:id/reviews?page=1&limit=10` (id only; approved reviews; reviewer
first name only).

```json
{ "success": true, "message": "Reviews", "data": {
  "items": [ {
    "_id": "6652c1d2e3f4a5b6c7d80301", "propertyId": "6651a0b1c2d3e4f5a6b70101", "bookingId": "6652b0c1d2e3f4a5b6c70401",
    "rating": 5, "subRatings": { "cleanliness": 5, "location": 4, "service": 5, "value": 4 },
    "comment": "Clean rooms and quick check-in. Breakfast was good.", "photos": [],
    "reply": { "text": "Thank you, Riya! See you again.", "at": "2026-10-14T08:00:00.000Z" },
    "user": { "name": "Riya" }, "status": "approved", "createdAt": "2026-10-13T12:30:00.000Z" } ],
  "page": 1, "limit": 10, "total": 18,
  "summary": { "avgRating": 4.3, "totalReviews": 18, "breakdown": { "1": 0, "2": 1, "3": 2, "4": 5, "5": 10 } } } }
```

---

## 5. Customer: booking and payment flow

All endpoints in this section need the customer token.

### 5.1 The sequence

1. **Quote** `POST /user/bookings/quote` whenever dates, party, room type or payment mode
   change. It holds nothing. If `available` is false, ask the user to change something.
2. **Create** `POST /user/bookings` with the same fields plus guest details and
   `useWallet`. The rooms (and any wallet part) are now held.
   - `payment == null` and `booking.status == "confirmed"`: nothing to pay online (pay at
     hotel, or the wallet covered it). Go to the confirmation screen.
   - `payment != null` and `booking.status == "awaiting_payment"`: open Razorpay.
     The hold lasts `quote.holdMinutes` (30 by default); show a countdown to
     `booking.payment.expiresAt`.
3. **Razorpay checkout** (`razorpay_flutter`): `options = { key: payment.keyId,
   order_id: payment.razorpayOrderId, amount: payment.amount (paise), currency: "INR",
   name: payment.name, description: payment.description, prefill: { name, contact, email } }`.
4. **Verify** on `PAYMENT_SUCCESS`: `POST /user/bookings/:id/verify-payment` with
   `{ razorpayOrderId, razorpayPaymentId, razorpaySignature }` from the SDK response.
   Returns the confirmed booking. Safe to call more than once.
5. **Poll** if verify failed on the network, returned 400 "not complete yet", or the app
   was killed mid-payment: `GET /user/bookings/:id` every 3-5 s for up to ~1 minute. The
   Razorpay webhook confirms the booking server-side too, so `status` turns `confirmed`
   even if verify never reached the server.
6. **Retry** after `PAYMENT_ERROR` / the user closed the sheet: `POST /user/bookings/:id/retry-payment`
   returns the same checkout object (same order) while the hold lasts. Re-open Razorpay
   and go to step 4.
7. **Expiry.** When `expiresAt` passes unpaid, a server job (every 60 s) moves the booking
   to `expired`, releases the rooms and refunds any wallet part. `retry-payment` then
   answers **409** "The payment window has ended; please book again". A payment that
   still arrives after expiry is refunded automatically and verify answers 409 with
   "...it has been refunded".

```
quote ──> create ──┬─ confirmed (payment null) ───────────────────────> done
                   └─ awaiting_payment ─> Razorpay ─> verify ─> confirmed
                          │  (dismissed)        └ (network fail) ─> poll GET /user/bookings/:id
                          └─> retry-payment ─> Razorpay ...
                          └─> (hold ends) expired
```

### 5.2 Payment modes

| `paymentMode` | Pay online now (`payNow`) | At the hotel (`payAtHotel`) | Discount |
|---|---|---|---|
| `pay_at_hotel` | 0 | total | none. Refused (400) if the admin turned pay-at-hotel off |
| `online` | total | 0 | none |
| `partial_prepaid` | `prepaidAdvancePercent` (30%) of total | the rest | `prepaidDiscountPercent` (5%) off before GST |

`useWallet: true` pays part or all of `payNow` from the KSG wallet (debited at create).
If it covers everything, no Razorpay order is made and the booking is confirmed at once.
The online part is never between Rs 0 and Rs 1 (Razorpay minimum): the wallet part is
reduced to leave Rs 1. `couponCode` is **not supported yet**: any value returns 400
"Coupons are not available for hotels yet" (omit the field).

### 5.3 Quote

`POST /user/bookings/quote`

```json
{ "propertyId": "6651a0b1c2d3e4f5a6b70101", "roomTypeId": "6651a0b1c2d3e4f5a6b70202",
  "checkIn": "2026-11-10", "checkOut": "2026-11-12",
  "rooms": 1, "adults": 2, "children": 0, "paymentMode": "online" }
```
`rooms` 1-20 (default 1), `adults` 1-100 (default 2), `children` 0-50 (default 0).
Unknown fields (e.g. a client-side price) are ignored.

```json
{ "success": true, "message": "Quote", "data": {
  "propertyId": "6651a0b1c2d3e4f5a6b70101", "roomTypeId": "6651a0b1c2d3e4f5a6b70202",
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

Same stay with `"paymentMode": "partial_prepaid"`: `prepaidDiscount: 279.9`,
`taxableAmount: 5318.1`, `gstAmount: 265.9`, `total: 5584`, `payNow: 1675.2`,
`payAtHotel: 3908.8`.

Pricing rules: extra adults/children beyond `rooms x baseAdults` / `rooms x baseChildren`
are charged per night; GST slab is chosen by the per-room-per-night tariff after
discounts (0% up to Rs 1,000, 5% up to Rs 7,500, 18% above, admin-configurable);
`platformFee` is the Master "platform fee" for hotels (often 0) plus its GST.
`walletApplicable` = min(wallet balance, payNow). `freeCancellationUntil` is absent for
`non_refundable`.

Errors: 400 (dates, coupon, pay-at-hotel disabled), 404 (property or room type not
listable). A party that does not fit or too few rooms is **not** an error here: it comes
back as `available: false`.

### 5.4 Create

`POST /user/bookings`: the quote body plus

```json
{ "guestDetails": { "name": "Riya Sharma", "phone": "9876543210", "email": "riya.sharma@example.com" },
  "specialRequests": "Late check-in around 10 pm", "useWallet": false }
```
`guestDetails.name` 2-80 chars; `phone` an Indian mobile (`+91`, spaces and dashes
allowed; stored as 10 digits); `email` optional (may be `""`); `specialRequests` max 500.

**201**, message "Booking created; complete the payment" (or "Booking confirmed"):

```json
{ "success": true, "message": "Booking created; complete the payment", "data": {
  "booking": {
    "_id": "6652b0c1d2e3f4a5b6c70401", "bookingRef": "KSGHMGQ3Z8K1A7F",
    "userId": "6650f1c2a9b3c4d5e6f70811", "propertyId": "6651a0b1c2d3e4f5a6b70101",
    "partnerId": "6651a0b1c2d3e4f5a6b70001", "roomTypeId": "6651a0b1c2d3e4f5a6b70202",
    "snapshot": { "propertyName": "KSG Demo Hotel", "propertyType": "hotel", "roomTypeName": "Deluxe Room",
                  "address": "Plot 12, Zone 1, MP Nagar, Bhopal, Madhya Pradesh, 462011",
                  "coverImage": "https://ksgsons.com/uploads/hotel/properties/ksg-demo-hotel-cover.jpg",
                  "checkInTime": "12:00", "checkOutTime": "11:00",
                  "cancellationPolicy": { "type": "moderate", "freeCancelHours": 24, "refundPercentAfter": 50 } },
    "checkIn": "2026-11-10", "checkOut": "2026-11-12", "nights": 2, "rooms": 1,
    "guests": { "adults": 2, "children": 0 },
    "guestDetails": { "name": "Riya Sharma", "phone": "9876543210", "email": "riya.sharma@example.com" },
    "specialRequests": "Late check-in around 10 pm",
    "pricing": { "roomCharges": 5598, "extraGuestCharges": 0, "subtotal": 5598, "couponDiscount": 0, "prepaidDiscount": 0,
                 "taxableAmount": 5598, "gstRate": 5, "gstAmount": 279.9, "platformFee": 0, "platformFeeGst": 0, "total": 5877.9 },
    "payment": { "mode": "online", "status": "pending", "amountPaid": 0, "amountDue": 5877.9, "walletAmount": 0,
                 "payNow": 5877.9, "onlineAmount": 5877.9, "onlinePaid": 0, "collectedAtHotel": 0, "refundedAmount": 0,
                 "expiresAt": "2026-10-15T05:12:00.000Z" },
    "status": "awaiting_payment",
    "statusHistory": [ { "status": "awaiting_payment", "at": "2026-10-15T04:42:00.000Z", "by": { "role": "user" }, "note": "Waiting for online payment" } ],
    "refunds": [], "source": "app", "canCancel": true, "canReview": false,
    "createdAt": "2026-10-15T04:42:00.000Z", "updatedAt": "2026-10-15T04:42:01.000Z" },
  "payment": {
    "razorpayOrderId": "order_PQx7Kd2LmN81Ab", "amount": 587790, "currency": "INR",
    "keyId": "rzp_live_XXXXXXXXXXXXXX", "name": "KSG",
    "description": "KSG Demo Hotel · KSGHMGQ3Z8K1A7F",
    "prefill": { "name": "Riya Sharma", "contact": "9876543210", "email": "riya.sharma@example.com" } } } }
```

Errors: 400 (validation, party does not fit: "Deluxe Room fits at most 3 adult(s) and 1
child(ren) per room", coupon), 404, **409 "Sold out: not enough rooms for these dates"**
(re-quote), 400 from the wallet if the balance dropped, 502/503 if the gateway order
failed (the booking was already expired and the wallet part returned).

### 5.5 Verify payment

`POST /user/bookings/:id/verify-payment`

```json
{ "razorpayOrderId": "order_PQx7Kd2LmN81Ab", "razorpayPaymentId": "pay_PQx8A1b2C3d4E5", "razorpaySignature": "5f1c...e9" }
```
```json
{ "success": true, "message": "Payment confirmed", "data": { "booking": { "...": "status confirmed, payment.status paid, amountDue 0" } } }
```

The server checks the signature, then fetches the payment from Razorpay (must be
`captured`, same order, exact amount). Errors: 400 "Payment does not belong to this
booking" / "Payment signature is invalid" / "Payment is not complete yet (status:
authorized); please try again shortly" (poll), 409 after expiry (refunded).

Development servers without Razorpay keys return `mock_order_*` orders and accept
`"razorpaySignature": "mock_signature_bypass"`. Never in production.

### 5.6 Retry payment

`POST /user/bookings/:id/retry-payment` (no body). `data` **is** the checkout object (not
wrapped in `payment`):

```json
{ "success": true, "message": "Payment", "data": { "razorpayOrderId": "order_PQx7Kd2LmN81Ab", "amount": 587790, "currency": "INR",
  "keyId": "rzp_live_XXXXXXXXXXXXXX", "name": "KSG", "description": "KSG Demo Hotel · KSGHMGQ3Z8K1A7F",
  "prefill": { "name": "Riya Sharma", "contact": "9876543210", "email": "riya.sharma@example.com" } } }
```
409 "This booking is not waiting for payment" (already confirmed: just reload it) or
"The payment window has ended; please book again".

---

## 6. Customer: my stays, cancel, voucher

### 6.1 List

`GET /user/bookings?tab=upcoming&page=1&limit=20`

| `tab` | Contains |
|---|---|
| `upcoming` | awaiting_payment / confirmed with check-in today or later |
| `ongoing` | checked_in, or confirmed and today is inside the stay |
| `past` | checked_out, no_show, or confirmed whose check-out has passed |
| `cancelled` | cancelled and expired |
| (none) | everything |

Items are the booking (as in 5.4) without `statusHistory`, newest check-in first. Paged.

### 6.2 Detail

`GET /user/bookings/:id` → `data: { booking }` (with `statusHistory`, `canCancel`,
`canReview`, `reviewId` once reviewed, `cancellation` and `refunds` when relevant).

Booking `status`: `awaiting_payment`, `confirmed`, `checked_in`, `checked_out`,
`cancelled`, `no_show`, `expired`. `payment.status`: `pending`, `paid`,
`partially_paid`, `refunded`, `partially_refunded`, `failed`. `expiresAt` is present only
while `awaiting_payment`. Show "Pay Rs X at the hotel" from `payment.amountDue` when
`payment.mode` is `pay_at_hotel` / `partial_prepaid`.

### 6.3 Cancel

Preview first: `GET /user/bookings/:id/cancel-preview`

```json
{ "success": true, "message": "Cancellation preview", "data": {
  "refundAmount": 5877.9, "refundPercent": 100, "walletRefund": 0, "gatewayRefund": 5877.9,
  "policyText": "Free cancellation until 9 Nov 2026, 12:00 IST. After that, 50% of the amount paid is refunded.",
  "freeCancellationUntil": "2026-11-09T06:30:00.000Z", "canCancel": true } }
```

Then `POST /user/bookings/:id/cancel` with `{ "reason": "Change of plans" }` (reason
optional, max 500) → `data: { booking }` with `status: "cancelled"`,
`cancellation: { by, reason, at, refundAmount }` and a `refunds[]` row.

Rules: the guest can cancel `awaiting_payment` / `confirmed` bookings until the check-in
moment (check-in date at `checkInTime`, IST). Before `freeCancellationUntil` (= check-in
moment − `freeCancelHours`) the refund is 100%, after it `refundPercentAfter`% of what was
paid online + wallet; `non_refundable` refunds 0. Cash paid at the hotel is not refunded
by KSG. Refunds go back to card/UPI first, then the wallet. When `canCancel` is false
the preview shows zeros and message "This booking cannot be cancelled online", and
`cancel` returns **409**.

### 6.4 Voucher

`GET /user/bookings/:id/voucher` returns an **HTML page** (`text/html`), not JSON, with a
"Print / Save as PDF" button. Open it in a WebView or the external browser:

```
https://ksgsons.com/api/v1/hotel/user/bookings/<id>/voucher?token=<accessToken>
```
(or send the `Authorization` header from a WebView). Errors are JSON: 401 missing/expired
token, 403 not a customer token, 404 not your booking. The token in the URL is a 15-minute
access token: build the URL right before opening it.

---

## 7. Customer: reviews and saved

### 7.1 Write a review

Allowed once per booking, after `checked_out` (`booking.canReview == true`).

`POST /user/reviews`

```json
{ "bookingId": "6652b0c1d2e3f4a5b6c70401", "rating": 5,
  "subRatings": { "cleanliness": 5, "location": 4, "service": 5, "value": 4 },
  "comment": "Clean rooms and quick check-in.", "photos": ["https://ksgsons.com/uploads/hotel/reviews/r1.jpg"] }
```
`rating` 1-5 (required), sub-ratings optional 1-5, `comment` max 2000, `photos` up to 10
URLs (upload first, [section 9](#9-uploads)).

**201** `data: { review }` (shape as in 4.6; `status` is `approved`, or `pending` when the
admin has turned auto-approval off). Errors: 400 "You can review a stay after you check
out", 404 not your booking, 409 "You have already reviewed this stay".

### 7.2 Saved properties

| Method | Path | Result |
|---|---|---|
| GET | `/user/saved` | plain array of PropertyCard (newest saved first; only still-listable properties; `startingPrice` is the property's stored price, no `available`/`distanceKm`) |
| POST | `/user/saved/:propertyId` | `{ "saved": true }`; idempotent; 404 if the property is not listable |
| DELETE | `/user/saved/:propertyId` | `{ "saved": false }`; idempotent |

---

## 8. Partner app

All endpoints need the partner token. "Approved" = 403 until an admin approves the
partner.

### 8.1 Profile

| Method | Path | Notes |
|---|---|---|
| GET | `/partner/me` | `data: { partner }` (shape as in 2.2) |
| PUT | `/partner/me` | partial update → `data: { partner }`. 409 if the email is taken |

```json
{ "name": "Arjun Verma", "email": "stays.demo@ksgsons.com",
  "kyc": { "ownerName": "Arjun Verma", "panNumber": "ABCDE1234F", "aadhaarNumberMasked": "XXXXXXXX4321",
           "aadhaarFront": "https://ksgsons.com/api/v1/files/p/aadhaar/...", "panImage": "https://ksgsons.com/api/v1/files/p/pan/..." },
  "bank": { "accountHolder": "Arjun Verma", "accountNumberMasked": "XXXXXXXX7788", "ifsc": "SBIN0001234", "bankName": "State Bank of India" },
  "address": { "line": "MP Nagar Zone 1", "city": "Bhopal", "state": "Madhya Pradesh", "pincode": "462011", "lat": 23.2332, "lng": 77.4343 },
  "acceptTerms": true }
```
Unknown keys are refused (400). Aadhaar and account numbers must be **masked** (at most 4
visible digits): never send the full number. PAN `AAAAA9999A`, GSTIN 15 chars, IFSC
`AAAA0XXXXXX`, pincode 6 digits. `acceptTerms` only accepts `true`. A `rejected` partner who
saves the profile goes back to `pending` review.

### 8.2 Properties (pending partners allowed)

| Method | Path | Body / result |
|---|---|---|
| GET | `/partner/properties` | plain array of own properties |
| POST | `/partner/properties` | create a draft; only `name` + `propertyType` required → **201** `{ property }` |
| GET | `/partner/properties/:id` | `{ property, roomTypes (incl. inactive), documents }` |
| PUT | `/partner/properties/:id` | partial update → `{ property }`. Changing name/type/location/address of an approved property sends it back to `pending` (message says so) |
| DELETE | `/partner/properties/:id` | soft delete → `{ _id }`; 409 with upcoming bookings |
| POST | `/partner/properties/:id/room-types` | required `name`, `maxAdults`, `pricePerNight`, `images` → **201** `{ roomType }` |
| PUT | `/partner/properties/:id/room-types/:roomTypeId` | partial → `{ roomType }`; `originalPrice`/`weekendPrice` accept `null` |
| DELETE | `/partner/properties/:id/room-types/:roomTypeId` | deactivates → `{ roomType }`; 409 with upcoming bookings |
| PUT | `/partner/properties/:id/documents` | `{ documents: [{ type, name?, fileUrl }] }` replaces the list → PropertyDocuments; resets verification to `pending` |
| POST | `/partner/properties/:id/submit` | draft/rejected → pending → `{ property }`; 400 lists every missing item; 409 if not draft/rejected |
| PUT | `/partner/properties/:id/live` | `{ isLive: true|false }` → `{ property }`; 403 unless property and partner are approved |

Property body (create/update; all optional on update):

```json
{ "name": "KSG Demo Hotel", "propertyType": "hotel",
  "typeDetails": { "hotelCategory": "premium", "starRating": 4 }, "suitability": "both",
  "shortDescription": "Business hotel in MP Nagar, minutes from DB Mall.", "description": "A comfortable city hotel ...",
  "contactNumber": "9000000010",
  "address": { "line1": "Plot 12, Zone 1", "area": "MP Nagar", "city": "Bhopal", "state": "Madhya Pradesh", "pincode": "462011", "country": "India" },
  "location": { "lat": 23.2332, "lng": 77.4343 },
  "nearbyPlaces": [ { "name": "DB City Mall", "type": "mall", "distanceKm": 1.2 } ],
  "coverImage": "https://ksgsons.com/uploads/hotel/properties/cover.jpg",
  "images": ["https://ksgsons.com/uploads/hotel/properties/1.jpg", "https://ksgsons.com/uploads/hotel/properties/2.jpg"],
  "amenities": ["wifi", "ac", "parking"], "houseRules": ["Valid photo ID required at check-in"],
  "checkInTime": "12:00", "checkOutTime": "11:00",
  "cancellationPolicy": { "type": "moderate", "freeCancelHours": 24, "refundPercentAfter": 50 } }
```
Note `location` is sent as `{ lat, lng }` but returned as GeoJSON `[lng, lat]`. Slug is
generated once at create from name + city and never changes.

Room type body:

```json
{ "name": "Deluxe Room", "description": "City view, queen bed", "inventoryType": "room", "roomCategory": "private",
  "baseAdults": 2, "baseChildren": 0, "maxAdults": 3, "maxChildren": 1, "bedsPerRoom": 1, "totalInventory": 6,
  "pricePerNight": 2799, "originalPrice": 3499, "weekendPrice": 3199, "extraAdultPrice": 600, "extraChildPrice": 300,
  "mealPlan": "breakfast", "images": ["https://ksgsons.com/uploads/hotel/properties/deluxe-1.jpg"], "amenities": ["wifi", "ac", "tv"] }
```
`inventoryType` must be allowed for the property type (`catalogue.inventoryTypesByProperty`);
it may be omitted when only one is allowed. Lowering `totalInventory`/`bedsPerRoom` below
what is booked on a future night → 409.

Submit needs: at least one active room type, location, `address.city`, cover image and
3+ photos in total (cover + gallery), the required documents
(`documents.requiredTypes`), and partner KYC `ownerName` + `panNumber`.

### 8.3 Dashboard (approved)

`GET /partner/dashboard`

```json
{ "success": true, "message": "Dashboard", "data": {
  "properties": { "total": 3, "live": 3, "pending": 0 },
  "todayArrivals": 2, "todayDepartures": 1, "upcomingBookings": 9,
  "revenueThisMonth": 48210.5, "occupancyThisMonth": 0.4167,
  "recentBookings": [ { "_id": "6652b0c1d2e3f4a5b6c70401", "bookingRef": "KSGHMGQ3Z8K1A7F", "status": "confirmed",
    "checkIn": "2026-11-10", "checkOut": "2026-11-12", "nights": 2, "rooms": 1,
    "guestDetails": { "name": "Riya Sharma", "phone": "9876543210" },
    "pricing": { "total": 5877.9, "commissionAmount": 559.8, "commissionGst": 100.76, "partnerPayout": 5217.34 },
    "payment": { "mode": "online", "status": "paid", "amountPaid": 5877.9, "amountDue": 0, "walletAmount": 0 } } ] } }
```
(`recentBookings` items shortened; they also carry ids, `snapshot`, `guests`, full `pricing`.)
`occupancyThisMonth` is 0..1.

### 8.4 Inventory calendar and blocks (approved)

| Method | Path | Notes |
|---|---|---|
| GET | `/partner/inventory?roomTypeId&from&to[&propertyId]` | `from`..`to` **inclusive**, max 92 days → `{ roomTypeId, days: InventoryDay[] }` |
| PUT | `/partner/inventory` | `{ roomTypeId, from, to, priceOverride?: number|null, closed?: boolean }` (inclusive, max 366 days; at least one of the two) → `{ roomTypeId, updated, days? }` |
| GET | `/partner/inventory/blocks?propertyId&from&to` | plain array of offline blocks |
| POST | `/partner/inventory/blocks` | **201** block; 409 if not enough rooms |
| DELETE | `/partner/inventory/blocks/:id` | releases the units → `{ _id }` |

```json
{ "date": "2026-11-13", "capacity": 6, "booked": 2, "available": 4, "price": 3199, "priceOverride": null, "closed": false }
```
(`price` is what a guest pays that night; `available` ignores `closed`, show `closed`
separately. `priceOverride: null` in PUT removes the override.)

Block body: `{ "roomTypeId": "...", "source": "walk_in" | "external" | "manual_block",
"startDate": "2026-11-20", "endDate": "2026-11-22", "units": 1, "externalPlatform": "MakeMyTrip",
"externalReference": "MMT-778812", "notes": "Booked by phone" }`. `endDate` is the
check-out day (exclusive); `startDate` not in the past; max 366 nights. Response row:
`{ _id, propertyId, roomTypeId, roomTypeName, source, startDate, endDate, units,
externalPlatform, externalReference, notes, createdBy, createdAt }`.

### 8.5 Bookings (approved)

| Method | Path | Body | Allowed when |
|---|---|---|---|
| GET | `/partner/bookings?status&propertyId&from&to&q&page&limit` | | paged; `from`/`to` filter the **check-in date** inclusive; `q` = booking ref, guest name or phone |
| GET | `/partner/bookings/:id` | | `data: { booking }` |
| PUT | `/partner/bookings/:id/check-in` | | confirmed, from the check-in date until before check-out |
| PUT | `/partner/bookings/:id/check-out` | `{ "force": true }` optional | checked_in; 409 with an unpaid balance unless `force` |
| PUT | `/partner/bookings/:id/no-show` | | confirmed, only after the check-in day |
| PUT | `/partner/bookings/:id/mark-paid` | `{ "amount": 3908.8 }` | confirmed/checked_in/checked_out; 0 < amount ≤ `amountDue` |
| PUT | `/partner/bookings/:id/cancel` | `{ "reason": "Room under maintenance" }` (3-500 chars, required) | awaiting_payment/confirmed, stay not over; guest refunded **100%** |

All actions return `data: { booking }`. Partner bookings include commission figures in
`pricing` (`commissionRate`, `commissionAmount`, `commissionGst`, `partnerPayout`) and
full `statusHistory[].by` (role + id). Rule violations are **409** with a readable message
("Check-in opens on the check-in date", "Rs 3908.8 is still unpaid. Record it with
mark-paid, or check out with force.").

### 8.6 Reviews (approved)

| Method | Path | Notes |
|---|---|---|
| GET | `/partner/reviews?propertyId&page&limit` | paged, all statuses, items add `property: { _id, name }` |
| POST | `/partner/reviews/:id/reply` | `{ "text": "Thank you, Riya! See you again." }` (1-1000) → `{ review }`; replying again replaces the reply |

### 8.7 Earnings and withdrawals (approved)

`GET /partner/earnings`

```json
{ "success": true, "message": "Earnings", "data": {
  "balance": 15620.4, "pendingSettlement": 4410.2, "totalEarned": 61230.75, "thisMonth": 15620.4,
  "withdrawable": 15620.4, "minWithdrawal": 500 } }
```
`balance` can be negative for pay-at-hotel stays (the hotel owes commission);
`pendingSettlement` is not withdrawable yet (settles at `checked_out` by default).

`GET /partner/ledger?page&limit` → paged
`{ _id, type, amount, bookingRef?, description, createdAt, balanceAfter }` (`type` e.g.
`EARNING`, `COMMISSION`, `PLATFORM_FEE`, `REFUND`, `ADJUSTMENT`, `WITHDRAWAL`; negative
amounts are debits).

`POST /partner/withdrawals` `{ "amount": 5000 }` → **201**
`{ withdrawal: { _id, amount, status: "pending", bank: { accountHolder, accountNumberMasked, ifsc, bankName }, createdAt, updatedAt, partnerId, partner: { name, phone } } }`.
400 below `minWithdrawal` or bank details missing, 409 above balance. The amount is held
from the balance at once; a rejected request gives it back.

`GET /partner/withdrawals?page&limit` → paged withdrawals; `status` `pending` →
`approved` → `paid` (with `utr`), or `rejected` (with `note`).

---

## 9. Uploads

Upload the file first, then put the returned URL into the JSON body. Any signed-in token
(customer or partner) works. Multipart, field **`file`**, optional field `folder`;
max 5 MB by default.

| Endpoint | Use | `folder` |
|---|---|---|
| `POST /api/v1/uploads/image` | property / room photos, review photos | `hotel/properties`, `hotel/reviews` |
| `POST /api/v1/uploads/document` | KYC and property documents (image or PDF) | `aadhaar`, `pan`, `gst`, `documents` |

```json
{ "success": true, "message": "Image uploaded successfully",
  "data": { "url": "https://ksgsons.com/uploads/hotel/properties/1729000000000-cover.webp", "publicId": null,
            "path": "hotel/properties/1729000000000-cover.webp", "size": 182340, "mimeType": "image/webp" } }
```

Document folders are private: the API returns short-lived **signed** links (about 2 h)
to signed-in callers. Store whatever URL you were given; to show the document again,
re-read it from `GET /partner/me` or `GET /partner/properties/:id` rather than caching
the link. 400 "No file provided" / "Unexpected file field", 413 too large.

---

## 10. Push notifications (FCM)

**Customer.** Register the device as for the rest of KSG: send `fcmToken` +
`platform: "mobile"` to `/api/v1/auth/user/verify-otp`, or later
`POST /api/v1/fcm-tokens/mobile/save` `{ "token": "<fcm token>" }` (customer token, no
`platform` field). Hotel pushes arrive with `data`:

```json
{ "type": "hotel_booking_confirmed", "bookingId": "6652b0c1d2e3f4a5b6c70401", "bookingRef": "KSGHMGQ3Z8K1A7F", "link": "/hotel/bookings/6652b0c1d2e3f4a5b6c70401" }
```
Types: `hotel_booking_confirmed`, `hotel_booking_cancelled`, `hotel_checked_in`,
`hotel_checked_out`, `hotel_no_show`, `hotel_booking_expired`, `hotel_refund`,
`hotel_checkin_reminder`, `hotel_review_request`. Open the booking screen for
`bookingId`. The same rows appear in the customer notification inbox (vertical `hotel`).

**Hotel partner.** The core `/api/v1/fcm-tokens/*` endpoints do **not** accept the
`HOTEL_PARTNER` role. The only way to register is `fcmToken` + `platform: "mobile"` on
`POST /partner/auth/verify-otp` (kept per partner, last 5 per platform). There is no
endpoint to update a rotated token or remove it on logout yet: re-login registers a new
one. Partner pushes: `hotel_new_booking`, `hotel_booking_cancelled`, with
`link: /hotel/partner/bookings/<id>`.

---

## 11. App services tile

`GET /api/v1/platform/app-services?lat=23.2332&lng=77.4343` (no auth) lists the customer
app's service tiles. Hotels is `key: "hotel"`, label "Hotels":

```json
{ "key": "hotel", "label": "Hotels", "inZone": null, "zone": null, "visible": true, "reason": null }
```
Hide the Hotels tile when `visible` is false (admin switched it off in Master > App
services). Hotels have no delivery zones, so `inZone` is always `null` and only the
platform-wide switch applies.

---

## 12. Admin endpoints (reference only)

Admin token with `hotel` service access. Not for the mobile apps.

- Overview: `GET /admin/overview`
- Partners: `GET /admin/partners`, `GET /admin/partners/:id`, `PUT /admin/partners/:id/status`
- Properties: `GET /admin/properties`, `GET /admin/properties/:id`, `PUT /admin/properties/:id/status`,
  `PUT /admin/properties/:id/documents/verify`, `PUT /admin/properties/:id/live`
- Bookings: `GET /admin/bookings`, `GET /admin/bookings/:id`, `PUT /admin/bookings/:id/status`,
  `POST /admin/bookings/:id/refund`
- Reviews: `GET /admin/reviews`, `PUT /admin/reviews/:id/status`
- Withdrawals: `GET /admin/withdrawals`, `PUT /admin/withdrawals/:id/status`
- Settings: `GET /admin/settings`, `PUT /admin/settings`

Details: `docs/hotel-api-contract.md`.

---

## 13. Shapes reference

**PropertyCard** (search, saved): `_id, name, slug, propertyType, coverImage,
address { area, city }, location, distanceKm?, avgRating, totalReviews, amenities,
startingPrice, originalPrice?, available?`.

**Booking** (customer view): as in 5.4. Partner view adds `pricing.commissionRate,
commissionAmount, commissionGst, partnerPayout` and full `statusHistory[].by`. Lists omit
`statusHistory`. `cancellation: { by, reason, at, refundAmount }` after a cancel;
`refunds: [{ amount, walletAmount, gatewayAmount, status, reason, by, at }]`.

**Review**: `_id, propertyId, bookingId, rating, subRatings?, comment, photos,
reply? { text, at }, user { name }, status, createdAt` (+ `property { _id, name }` for
partners).

**Enums**: property types `hotel resort villa homestay hostel pg`; booking status
`awaiting_payment confirmed checked_in checked_out cancelled no_show expired`; payment
mode `pay_at_hotel online partial_prepaid`; cancellation policy `flexible moderate strict
non_refundable`; meal plan `room_only breakfast half_board full_board`.

---

## 14. Changelog

| Date | Change |
|---|---|
| 2026-10-15 | First version, written against the phase 4-5 backend (bookings, payments, reviews, money). Hotels added to App services (`key: "hotel"`, no zones). Web route `/hotel/bookings/:id` (used in push `link`s) now redirects to `/hotel/stays/:id`. |
