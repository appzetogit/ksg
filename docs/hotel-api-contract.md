# Hotel API contract (phases 2–3, plus admin)

Single source of truth for the backend and the three frontends (partner portal,
customer app, admin panel) built in parallel. Backend implements exactly this;
frontends call exactly this. Change it only by editing this file.

Base URL: `/api/v1/hotel` (frontend: `${VITE_API_BASE_URL}/hotel`, i.e. `/api/v1/hotel`).

Every response: `{ success: boolean, message: string, data: any }`. Errors:
`{ success: false, message }` with 400 (validation), 401 (no/expired token),
403 (not allowed / not approved), 404, 409 (conflict, e.g. sold out).

Auth header: `Authorization: Bearer <accessToken>`.
- Partner token: from `POST /partner/auth/verify-otp` (role `HOTEL_PARTNER`).
- Customer token: existing customer login `POST /api/v1/auth/user/request-otp` +
  `/verify-otp` (role `USER`); the food app stores it (see
  `Frontend/src/modules/Food` auth utils).
- Admin token: existing `/admin/login` (`admin_accessToken` in localStorage).

Dates: `YYYY-MM-DD` strings (IST calendar dates). Money: rupees, numbers, 2 dp.
Pagination: `?page=1&limit=20` → `data: { items: [...], page, limit, total }`.
Ids: Mongo ObjectId strings.

---

## Shared shapes

```ts
Partner = {
  _id, name, phone, email?, status: 'pending'|'approved'|'rejected'|'blocked',
  rejectionReason?, kyc?: { ownerName?, aadhaarNumberMasked?, aadhaarFront?, aadhaarBack?,
  panNumber?, panImage?, gstNumber?, gstCertificate? },
  bank?: { accountHolder?, accountNumberMasked?, ifsc?, bankName? },
  address?: { line?, city?, state?, pincode?, location?: { type:'Point', coordinates:[lng,lat] } },
  termsAcceptedAt?, createdAt, updatedAt
}

Property = {
  _id, partnerId, name, slug, propertyType: 'hotel'|'resort'|'villa'|'homestay'|'hostel'|'pg',
  typeDetails?: { hotelCategory?, starRating?, resortType?, pgType?, hostelType?, hostLivesOnProperty? },
  suitability: 'couple_friendly'|'family_friendly'|'both'|'none',
  description, shortDescription, contactNumber?,
  address: { line1?, area?, city, state?, pincode?, country, fullAddress? },
  location: { type:'Point', coordinates: [lng, lat] },
  nearbyPlaces: [{ name, type, distanceKm }],
  coverImage, images: string[], amenities: string[] /* catalogue keys */, houseRules: string[],
  checkInTime: 'HH:mm', checkOutTime: 'HH:mm',
  cancellationPolicy: { type: 'flexible'|'moderate'|'strict'|'non_refundable', freeCancelHours, refundPercentAfter },
  status: 'draft'|'pending'|'approved'|'rejected'|'suspended', rejectionReason?, isLive: boolean,
  startingPrice?, originalPrice?, avgRating, totalReviews, createdAt, updatedAt
}

RoomType = {
  _id, propertyId, name, description, inventoryType: 'room'|'bed'|'entire',
  roomCategory?, baseAdults, baseChildren, maxAdults, maxChildren, bedsPerRoom, totalInventory,
  pricePerNight, originalPrice?, weekendPrice?, extraAdultPrice, extraChildPrice,
  mealPlan: 'room_only'|'breakfast'|'half_board'|'full_board',
  images: string[] /* >= 3 */, amenities: string[], isActive
}

PropertyDocuments = {
  propertyId, documents: [{ type: 'trade_license'|'rent_agreement'|'electricity_bill'|'gst_certificate'|'fire_noc'|'other',
  name?, fileUrl, isRequired, uploadedAt }],
  verificationStatus: 'pending'|'verified'|'rejected', adminRemark?,
  requiredTypes: string[]   // computed: what this property type must upload
}

InventoryDay = { date: 'YYYY-MM-DD', capacity, booked, available, price, priceOverride?, closed }

PropertyCard = {           // search result item
  _id, name, slug, propertyType, coverImage, address: { area, city },
  location, distanceKm?, avgRating, totalReviews, amenities,
  startingPrice, originalPrice?, available?: boolean   // available only when dates given
}
```

Catalogue (already live): `GET /public/catalogue` →
`{ propertyTypes, inventoryTypesByProperty, requiredDocuments, amenities:[{key,label}],
cancellationPolicies, mealPlans, suitability }`.

Uploads: use the existing `POST /api/v1/uploads/image` (multipart field `file`,
optional field `folder`, returns the URL in `data.url`) for photos, folder
`hotel/properties`; and `POST /api/v1/uploads/document` for KYC and property
documents with a private folder: `aadhaar`, `pan`, `gst` or `documents` (served via
signed links, see `Backend/src/core/files/privateFiles.js`). Any logged-in token works.

---

## Public (no auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/public/health` | live |
| GET | `/public/catalogue` | live |
| GET | `/public/properties` | search, see below |
| GET | `/public/properties/:idOrSlug` | `data: { property: Property, roomTypes: RoomType[] (active only) }` |
| GET | `/public/properties/:id/availability?checkIn&checkOut&adults&children&rooms` | `data: { checkIn, checkOut, nights, roomTypes: [{ roomTypeId, name, available: number, bookable: boolean, nightlyPrices: [{date, price}], total: number /* rooms × Σ nightly, before tax */ }] }` |
| GET | `/public/cities` | `data: [{ city, count }]` of cities with live properties |

**Search** `GET /public/properties` query (all optional):
`q` (text: name/city/area), `city`, `lat`, `lng`, `radiusKm` (default 50),
`types` (comma list), `amenities` (comma list, all must match), `suitability`,
`minPrice`, `maxPrice`, `minRating`, `checkIn`, `checkOut`, `adults` (default 2),
`children`, `rooms` (default 1), `sort` = `relevance|price_low|price_high|rating|distance|newest`,
`page`, `limit`.
→ `data: { items: PropertyCard[], page, limit, total }`.
Only approved + live properties of approved partners. With dates, properties that
cannot fit the party for every night are excluded.

## Partner (`HOTEL_PARTNER` token)

Auth & profile (live): `POST /partner/auth/request-otp {phone}`,
`POST /partner/auth/verify-otp {phone, otp}` → `{ accessToken, refreshToken, partner, isNewPartner }`,
`GET /partner/me`, `PUT /partner/me` (name, email, kyc, bank, address{line,city,state,pincode,lat,lng}, acceptTerms).

Properties (a pending partner may create drafts and submit; going live needs approval):

| Method | Path | Body / result |
|---|---|---|
| GET | `/partner/properties` | `data: Property[]` (own, not deleted) |
| POST | `/partner/properties` | create draft. Body: Property fields except status/isLive/ratings/slug/partnerId; `location` as `{ lat, lng }`. → `data: { property }` |
| GET | `/partner/properties/:id` | `data: { property, roomTypes, documents: PropertyDocuments }` |
| PUT | `/partner/properties/:id` | partial update, same fields as create. Editing an `approved` property's name/type/location/address sends it back to `pending`. |
| DELETE | `/partner/properties/:id` | soft delete; refused (409) if it has upcoming bookings |
| POST | `/partner/properties/:id/room-types` | body RoomType fields (inventoryType must be allowed for the property type) → `data: { roomType }` |
| PUT | `/partner/properties/:id/room-types/:roomTypeId` | partial |
| DELETE | `/partner/properties/:id/room-types/:roomTypeId` | soft (isActive=false); 409 if upcoming bookings |
| PUT | `/partner/properties/:id/documents` | body `{ documents: [{ type, name?, fileUrl }] }` replaces the list → `data: PropertyDocuments` |
| POST | `/partner/properties/:id/submit` | draft/rejected → pending. 400 if no active room type, missing required documents, < 3 images incl. cover, or partner KYC (ownerName + panNumber) missing |
| PUT | `/partner/properties/:id/live` | body `{ isLive: boolean }`; 403 unless property approved AND partner approved |

Inventory calendar (approved partner):

| Method | Path | Notes |
|---|---|---|
| GET | `/partner/inventory?propertyId&roomTypeId&from&to` | `data: { roomTypeId, days: InventoryDay[] }` (max 92 days) |
| PUT | `/partner/inventory` | body `{ roomTypeId, from, to, priceOverride?: number\|null, closed?: boolean }` bulk-sets nights in range |
| GET | `/partner/inventory/blocks?propertyId&from&to` | ledger rows (walk_in/external/manual_block) |
| POST | `/partner/inventory/blocks` | body `{ roomTypeId, source: 'walk_in'\|'external'\|'manual_block', startDate, endDate, units, externalPlatform?, externalReference?, notes? }`; 409 if not enough rooms |
| DELETE | `/partner/inventory/blocks/:id` | releases the units |

Dashboard (approved partner, phase-2 version): `GET /partner/dashboard` →
`data: { properties: { total, live, pending }, todayArrivals: 0, todayDepartures: 0, upcomingBookings: 0, revenueThisMonth: 0 }`
(booking numbers are 0 until the booking phase).

## Admin (admin token with `hotel` access)

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/overview` | live: `{ partners: {status: n}, properties: {status: n}, bookings: {status: n} }` |
| GET | `/admin/partners?status&q&page&limit` | paginated Partner |
| GET | `/admin/partners/:id` | `data: { partner, properties: Property[] }` |
| PUT | `/admin/partners/:id/status` | body `{ status: 'approved'\|'rejected'\|'blocked'\|'pending', reason? }` (reason required for rejected/blocked) |
| GET | `/admin/properties?status&type&city&q&partnerId&page&limit` | paginated Property (+ `partner: {name, phone}`) |
| GET | `/admin/properties/:id` | `data: { property, partner, roomTypes, documents }` |
| PUT | `/admin/properties/:id/status` | body `{ status: 'approved'\|'rejected'\|'suspended'\|'pending', reason? }`; approving also marks documents verified; reason required for rejected/suspended |
| PUT | `/admin/properties/:id/documents/verify` | body `{ verificationStatus: 'verified'\|'rejected', adminRemark? }` |
| PUT | `/admin/properties/:id/live` | body `{ isLive }` (admin override) |

Bookings, reviews and settings admin endpoints arrive with the booking phase.

---

## Deviations (backend, phases 2–3)

Where the backend had to pick an interpretation. Frontends should follow this section
over the tables above if they disagree.

1. **Drafts are partial.** `POST /partner/properties` requires only `name` and
   `propertyType`; `location` and `coverImage` may be missing on a draft (the wizard
   saves right after the basics step). `/submit` then requires a location, `address.city`
   and a cover image. A missing location is left unset, never stored as an empty Point.
2. **Photo count at submit** = `(coverImage ? 1 : 0) + images.length >= 3`, where
   `images` is the gallery without the cover (a copy of the cover in `images` is not
   counted twice).
3. **Submitting a property that is not `draft`/`rejected`** returns **409** (the
   validation failures listed in the contract stay 400; all problems are listed in one
   message).
4. **Slug** is generated once from `name + city` at create (`-2`, `-3`… on clashes) and
   stays stable when the name changes, so shared links keep working.
5. **Room types:** `inventoryType` may be omitted when the property type allows exactly
   one (hotel/resort → `room`, villa → `entire`, hostel/pg → `bed`); `entire` always
   has `totalInventory: 1`. `originalPrice`/`weekendPrice` accept `null` to clear.
   Lowering `totalInventory`/`bedsPerRoom` below what is already booked on any future
   night → **409**. `PUT … {isActive:false}` behaves like DELETE (409 with upcoming
   bookings). Changing an approved property's `propertyType` to one its active room
   types cannot sell → 400.
6. **Documents:** `PUT /documents` resets `verificationStatus` to `pending` (new files
   need a fresh admin look). `isRequired` on each document is computed, not accepted.
7. **Inventory calendar:** `from`/`to` on GET and PUT `/partner/inventory` are
   **inclusive** nights (GET max 92 days, PUT max 366). `InventoryDay.available` is
   `max(0, capacity − booked)` regardless of `closed` (the calendar shows `closed`
   separately); the public availability endpoint treats a closed night as 0 available.
   PUT returns `{ roomTypeId, updated, days? }` (`days` when the range ≤ 92 days).
8. **Blocks:** `endDate` is the check-out date, **exclusive**. `startDate` cannot be in
   the past; at most 366 nights. GET `/inventory/blocks` returns a plain array of
   `{ _id, propertyId, roomTypeId, roomTypeName, source, startDate, endDate, units,
   externalPlatform?, externalReference?, notes?, createdBy, createdAt }` with dates as
   `YYYY-MM-DD`; `from`/`to` (inclusive) select blocks overlapping that range; without
   `propertyId` all the partner's properties are listed. Platform-booking rows are not
   listed and cannot be deleted here.
9. **Search:** `PropertyCard.startingPrice` is the cheapest room type that fits the
   party (and, with dates, is free every night) — so it can be higher than
   `Property.startingPrice`. A room type fits when `rooms × maxAdults ≥ adults`,
   `rooms × maxChildren ≥ children` and it has at least `rooms` units. `suitability`
   `couple_friendly`/`family_friendly` also match `both`. `sort=relevance` is distance
   with `lat/lng`, else rating then newest; `sort=distance` without `lat/lng` falls back
   to rating. `distanceKm` has 2 decimals. Stays are limited to 30 nights and cannot
   start in the past (400). `city` is a case-insensitive exact match; `q` a
   case-insensitive substring of name/city/area.
10. **Availability** uses the same 30-night / not-in-the-past rules; nights with no
    inventory row count as full capacity at the base price.
11. **Admin:** `PUT /admin/properties/:id/status` to `rejected`/`suspended` also switches
    `isLive` off (the partner switches it back on after re-approval). Admin `live: true`
    requires the property to be `approved` (400 otherwise). The admin partner JSON omits
    `fcmTokens` and the Razorpay fund-account id. Admin property detail lists all room
    types including inactive ones.
12. **Dates storage:** nights are stored as `Date` at 00:00 IST (18:30 UTC the previous
    day); see `Backend/src/modules/hotel/services/dates.js`.

---

# Phase 4–5: bookings, payments, reviews, money

Same conventions as above. New shared shapes:

```ts
Quote = {
  propertyId, roomTypeId, checkIn, checkOut, nights, rooms, guests: { adults, children },
  available: boolean,              // enough rooms every night and the party fits
  paymentMode: 'pay_at_hotel'|'online'|'partial_prepaid',
  pricing: { roomCharges, extraGuestCharges, subtotal, couponCode?, couponDiscount, prepaidDiscount,
             taxableAmount, gstRate, gstAmount, platformFee, platformFeeGst, total },
  payNow: number,                  // charged online now (0 for pay_at_hotel)
  payAtHotel: number,              // collected by the hotel
  walletApplicable: number,        // max wallet amount usable against payNow (0 if no wallet)
  cancellationPolicy: { type, freeCancelHours, refundPercentAfter },
  freeCancellationUntil?: ISODateTime,
  holdMinutes: number,             // how long an unpaid booking holds the rooms
  coupon?: { code, title, discount } // phase 9, when couponCode applied
}

Booking = {
  _id, bookingRef, propertyId, roomTypeId, partnerId,
  snapshot: { propertyName, propertyType, roomTypeName, address, coverImage, checkInTime, checkOutTime, cancellationPolicy },
  checkIn: 'YYYY-MM-DD', checkOut: 'YYYY-MM-DD', nights, rooms, guests: { adults, children },
  guestDetails: { name, phone, email? }, specialRequests?,
  pricing: Quote.pricing & { commissionRate?, commissionAmount?, commissionGst?, partnerPayout? },  // commission/payout only in partner & admin views
  payment: { mode, status, amountPaid, amountDue, walletAmount, expiresAt? },
  status: 'awaiting_payment'|'confirmed'|'checked_in'|'checked_out'|'cancelled'|'no_show'|'expired',
  statusHistory: [{ status, at, by: { role }, note? }],
  cancellation?: { by, reason, at, refundAmount },
  canCancel: boolean, canReview: boolean,     // user view
  reviewId?, createdAt
}

BookingSummary = Booking minus statusHistory (lists)

Review = { _id, propertyId, bookingId, rating, subRatings?, comment, photos, reply?: { text, at },
           user: { name }, status, createdAt }
```

Payment modes: `pay_at_hotel` (nothing online), `online` (full total now), `partial_prepaid`
(advance % now, rest at hotel; prepaid discount applies). The customer may also tick
`useWallet` to pay part or all of `payNow` from the KSG wallet; if the wallet covers all of
it, no Razorpay order is created. Gateway: Razorpay only.

## Customer (`USER` token = `user_accessToken`)

| Method | Path | Body / result |
|---|---|---|
| POST | `/user/bookings/quote` | `{ propertyId, roomTypeId, checkIn, checkOut, rooms, adults, children, paymentMode, couponCode? }` → `data: Quote` (no hold) |
| POST | `/user/bookings` | quote body + `{ guestDetails: { name, phone, email? }, specialRequests?, useWallet?: boolean }` → `data: { booking, payment: null \| { razorpayOrderId, amount /* paise */, currency: 'INR', keyId, name, description, prefill: { name, contact, email } } }`. 409 if sold out. `confirmed` when nothing is payable online, else `awaiting_payment` with `payment.expiresAt`. |
| POST | `/user/bookings/:id/verify-payment` | `{ razorpayOrderId, razorpayPaymentId, razorpaySignature }` → `data: { booking }` (idempotent) |
| POST | `/user/bookings/:id/retry-payment` | → the same `payment` object for a still-held `awaiting_payment` booking |
| GET | `/user/bookings?tab=upcoming\|ongoing\|past\|cancelled&page&limit` | page of BookingSummary |
| GET | `/user/bookings/:id` | `data: { booking }` |
| GET | `/user/bookings/:id/cancel-preview` | `data: { refundAmount, refundPercent, walletRefund, gatewayRefund, policyText, freeCancellationUntil? }` |
| POST | `/user/bookings/:id/cancel` | `{ reason }` → `data: { booking }` |
| GET | `/user/bookings/:id/voucher` | printable HTML voucher (`text/html`); also accepts `?token=` so it can open in a new tab |
| POST | `/user/reviews` | `{ bookingId, rating, subRatings?, comment?, photos? }` → `data: { review }`; only after `checked_out`, once per booking |
| GET | `/user/saved` | `data: PropertyCard[]` |
| POST / DELETE | `/user/saved/:propertyId` | `data: { saved: boolean }` |
| GET | `/public/properties/:id/reviews?page&limit` | page of Review (approved only) plus `data.summary: { avgRating, totalReviews, breakdown: { 5: n, ..., 1: n } }` |

## Partner (approved `HOTEL_PARTNER`)

| Method | Path | Notes |
|---|---|---|
| GET | `/partner/bookings?status&propertyId&from&to&q&page&limit` | page of Booking (with commission/payout); `q` = ref or guest name/phone |
| GET | `/partner/bookings/:id` | `data: { booking }` |
| PUT | `/partner/bookings/:id/check-in` | confirmed → checked_in (on/after check-in date) |
| PUT | `/partner/bookings/:id/check-out` | checked_in → checked_out; `{ force?: boolean }` if a balance is unpaid |
| PUT | `/partner/bookings/:id/no-show` | confirmed → no_show (after the check-in day) |
| PUT | `/partner/bookings/:id/mark-paid` | `{ amount }` records cash collected at the hotel |
| PUT | `/partner/bookings/:id/cancel` | `{ reason }` partner cancel → full refund to the guest |
| GET | `/partner/reviews?propertyId&page&limit` | page of Review (all statuses) |
| POST | `/partner/reviews/:id/reply` | `{ text }` |
| GET | `/partner/earnings` | `data: { balance, pendingSettlement, totalEarned, thisMonth, withdrawable, minWithdrawal }` |
| GET | `/partner/ledger?page&limit` | page of `{ _id, type, amount, bookingRef?, description, createdAt, balanceAfter? }` |
| POST | `/partner/withdrawals` | `{ amount }` → `data: { withdrawal: { _id, amount, status, createdAt } }` |
| GET | `/partner/withdrawals?page` | page of withdrawals |
| GET | `/partner/dashboard` | now real: `{ properties, todayArrivals, todayDepartures, upcomingBookings, revenueThisMonth, occupancyThisMonth /* 0..1 */, recentBookings: BookingSummary[] }` |

## Admin (`hotel` access)

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/bookings?status&propertyId&partnerId&q&from&to&page&limit` | page of Booking (+ `partner: {name, phone}`, `user: {name, phone}`) |
| GET | `/admin/bookings/:id` | `data: { booking, partner, user, payments: [...], refunds: [...] }` |
| PUT | `/admin/bookings/:id/status` | `{ status: 'checked_in'\|'checked_out'\|'no_show'\|'cancelled', reason?, force? }` (admin may override date rules) |
| POST | `/admin/bookings/:id/refund` | `{ amount, reason }` manual refund (≤ amount paid − already refunded) |
| GET | `/admin/reviews?status&propertyId&page&limit` | page of Review |
| PUT | `/admin/reviews/:id/status` | `{ status: 'approved'\|'rejected' }` |
| GET | `/admin/withdrawals?status&page&limit` | page (+ partner) |
| PUT | `/admin/withdrawals/:id/status` | `{ status: 'approved'\|'rejected'\|'paid', note?, utr? }` |
| GET | `/admin/settings` | `data: HotelSettings` |
| PUT | `/admin/settings` | partial HotelSettings |

```ts
HotelSettings = {
  commissionPercent: 10, minCommission: 50, commissionGstPercent: 18,
  paymentHoldMinutes: 30, prepaidDiscountPercent: 5, prepaidAdvancePercent: 30,
  allowPayAtHotel: true, reviewAutoApprove: true, minWithdrawal: 500,
  settleOn: 'checked_out',
  gstSlabs: [ { upTo: 1000, rate: 0 }, { upTo: 7500, rate: 5 }, { upTo: null, rate: 18 } ]  // per room per night tariff
}
```

## Internal backend interface (between the booking and money workstreams)

`Backend/src/modules/hotel/services/bookingEvents.js` exports a Node `EventEmitter` named
`bookingEvents`. The booking service emits, **after the DB commit**:
- `bookingEvents.emit('transition', { booking /* lean doc */, from, to, actor: { role, id } })`
  for every status change, including creation (`from: null`);
- `bookingEvents.emit('payment', { booking, amount, kind: 'online'|'wallet'|'at_hotel', paymentId? })`;
- `bookingEvents.emit('refund', { booking, amount, walletAmount, gatewayAmount, refundId? })`.

Listeners must be idempotent (key on booking id + status / payment id) and must never throw
into the emitter (wrap in try/catch and log).

## Deviations (backend, phase 4: bookings + payments)

Where the booking backend had to pick an interpretation. Frontends follow this section
over the tables above if they disagree.

1. **Coupons — resolved in phase 9.** `couponCode` on quote/create is now validated
   against hotel coupons (`hotel_offers`); see "Phase 9: coupons" below. A bad code is
   still a **400**, now with the specific reason.
2. **Settings** live in one `hotel_settings` document (model `HotelSettings`), not the
   core settings registry (the slab table and the hotel admin form do not fit its scalar
   keys). `GET/PUT /admin/settings` return the settings object as `data` (bare). PUT
   takes a partial or full object (unknown keys ignored); `gstSlabs` must ascend and end
   with exactly one `{ upTo: null }` slab. Cached 30 s per process.
3. **Pricing details.** Extra guests = beyond `rooms × baseAdults` / `rooms × baseChildren`,
   charged per night. GST slab = per-room-per-night tariff of the taxable amount (after
   prepaid/coupon discounts). Commission = `max(taxable × %, minCommission)` but never
   more than the taxable amount. Platform fee = Master `fees.platformFee` resolved for
   vertical `hotel` + the zone (0 when unset); its GST uses `fees.platformFeeGstRate`
   (18% when the fee is set but the rate is not). The quote also returns
   `nightlyPrices: [{date, price}]`.
4. **Party fit.** Quote returns `available: false` when the party does not fit or rooms
   are short; create returns **400** for a party that does not fit and **409** when sold out.
5. **Wallet.** `walletApplicable` = `min(wallet balance, payNow)`. With `useWallet`, the
   wallet part is debited at create (in the same transaction as the room hold). The
   gateway part is never between 0 and Rs 1 (Razorpay minimum): the wallet part is
   reduced to leave Rs 1 for the gateway in that edge case.
6. **Payment object** on create / `retry-payment` (`data` is the object itself for
   retry-payment): `{ razorpayOrderId, amount (paise), currency, keyId, name: 'KSG',
   description, prefill }`. `retry-payment` returns the SAME order while the hold lasts;
   409 after expiry. If the gateway order cannot be created, the booking is expired at
   once (rooms + wallet part returned) and create answers 502/503.
   Dev only: with no Razorpay keys and `NODE_ENV !== 'production'`, orders are
   `mock_order_*` and verify accepts `razorpaySignature: 'mock_signature_bypass'`.
7. **Verify / webhook.** Verify checks the HMAC, then fetches the payment from Razorpay
   (order id must match, status `captured`, amount == the gateway part in paise). The
   core Razorpay webhook (`payment.captured`) confirms hotel bookings through the same
   path, idempotently. A payment arriving after the booking expired/was cancelled is
   refunded in full automatically (verify answers 409).
8. **Booking.payment** carries extra fields: `payNow, onlineAmount` (gateway part),
   `onlinePaid, collectedAtHotel, refundedAmount`; `amountPaid` = wallet + online +
   collected at hotel (refunds do not reduce it; see `refundedAmount`). `amountDue` is 0
   once cancelled/expired. `Booking.refunds: [{ amount, walletAmount, gatewayAmount,
   status, reason, by, at }]` lists every refund.
9. **Cancellation.** Check-in moment = check-in date at the property's `checkInTime`
   (IST). `freeCancellationUntil` = that − `freeCancelHours`; before it 100%, after it
   `refundPercentAfter` % of what was paid online + wallet (cash collected at the hotel is
   the property's to return). `non_refundable` = 0%. An unpaid/awaiting booking refunds
   any wallet part in full. Customers can cancel `awaiting_payment`/`confirmed` bookings
   until the check-in moment (`canCancel`); partner/admin cancels refund 100%. Refunds go
   back to the card/UPI first, then the wallet. Gateway refunds create a core `Refund`
   row (refund.service `initiateRefund`, `refundTo: 'gateway'`) and call Razorpay through
   the hotel gateway adapter; wallet refunds credit the customer wallet with an
   idempotent `referenceKey`. `cancel-preview` adds `canCancel` (0 refund when false).
10. **Status rules.** Transitions: `awaiting_payment → confirmed|cancelled|expired`,
    `confirmed → checked_in|cancelled|no_show`, `checked_in → checked_out`, and
    `checked_in → cancelled` for admins only. Check-in: from the check-in date until
    before the check-out date. No-show: only after the check-in day. Check-out with an
    unpaid balance → 409 unless `force: true` (partner or admin). Admin `force` skips the
    date rules. Inventory is released from `max(today, checkIn)` to `checkOut` on
    cancelled / expired / no_show / checked_out (so an early check-out frees the unused
    nights); the availability ledger row is deleted or trimmed to match.
11. **mark-paid** works on confirmed / checked_in / checked_out bookings, `amount` must be
    > 0 and ≤ `amountDue`; emits `payment` with `kind: 'at_hotel'`.
12. **Lists.** Customer tabs: `upcoming` = awaiting_payment/confirmed with check-in today
    or later; `ongoing` = checked_in, or confirmed with check-in before today and
    check-out after today; `past` = checked_out, no_show, or confirmed whose check-out
    has passed; `cancelled` = cancelled + expired. Partner/admin `from`/`to` filter the
    **check-in date** (inclusive); `status` is a single value; `q` = booking ref or guest
    name/phone.
13. **Admin booking detail** `data: { booking, partner, user, property, payments,
    refunds, refundable }`. `payments` rows: `{ kind: 'online'|'wallet'|'at_hotel',
    method, amount, status, razorpayPaymentId?, paymentId?, createdAt }`. `refunds` = the
    booking's refund log rows `{ amount, walletAmount, gatewayAmount, reason, status, by,
    createdAt, gatewayRefund? }` (a failed row's wallet/gateway amounts show what actually
    moved). `refundable` = wallet + online paid − refunded: the cap for
    `POST /admin/bookings/:id/refund` (cash collected at the hotel is not refundable by the
    platform, so this can be less than `amountPaid − refunds`).
14. **Events** (`bookingEvents`): creation emits `transition` with `from: null`; a wallet
    part emits `payment` `kind: 'wallet'` at create; a gateway payment emits `payment`
    (`kind: 'online'`) just before its `confirmed` transition. A payment event's
    `booking` is the post-commit document. Wallet payments are not written to the core
    `payments` collection (it is the gateway-payment aggregate).
15. **Expiry job** `expireStaleBookings()` runs every 60 s from `server.js`
    `startIntervals()` when `BACKGROUND_JOBS_ENABLED` and the hotel module are on.

## Deviations (backend, phase 5: money, reviews, notifications)

1. **Settlement** (`services/settlement.listener.js`, a listener on `bookingEvents`) writes
   core-ledger rows (`vertical: 'hotel'`, `jobType: 'hotel_booking'`, `jobId` = booking id,
   key kind `hotel_booking`). With `partnerGross = taxableAmount + gstAmount`,
   `commission = commissionAmount + commissionGst`, `fee = platformFee + platformFeeGst` and
   `P` = what the platform collected (online + wallet, less refunds): partner
   `EARNING +(P − fee)` (or `PLATFORM_FEE` if negative) and `COMMISSION −commission`;
   platform `COMMISSION +commission`, `PLATFORM_FEE +fee`. So pay-at-hotel = commission
   (+ any booking fee) debit only. Settles on the first transition at/after `settleOn`
   (confirmed < checked_in < checked_out). The booking service must fill
   `pricing.commissionAmount`/`commissionGst`; `partnerPayout` is not read.
2. **Prepaid amount** is learnt from `payment` / `refund` events, stored as zero-amount
   `NON_WALLET` marker rows on the platform owner. Without a payment marker: `online`/`wallet`
   = total (when paid), `partial_prepaid` = `payment.amountPaid`, `pay_at_hotel` = 0.
3. **Cancellation / no-show**: if settled, every settle row is reversed exactly
   (EARNING by `REFUND`, the rest by `ADJUSTMENT`). Then the money the platform keeps
   (`P − max(refund markers, cancellation.refundAmount)`) settles pro rata
   (`ratio = retained / total`), so the hotel gets its share of a late-cancel fee or a
   prepaid no-show. A refund on a booking that stays settled reverses the same pro-rata share.
4. **Withdrawals** use a new `HotelWithdrawal` (`hotel_withdrawals`; core
   `settlement.service` only supports restaurants/riders). Request: `amount ≥ minWithdrawal`
   (400); partner bank needs `ifsc` and (`accountNumberMasked` or `accountHolder`) (400);
   `amount ≤ balance` (409). The amount is held at once by a ledger `WITHDRAWAL −amount`
   entry; reject releases it (`WITHDRAWAL +amount`). Status: pending → approved | rejected |
   paid; approved → paid | rejected; anything else 409. Items (partner and admin lists):
   `{ _id, amount, status, bank (masked snapshot), note?, utr?, processedAt?, createdAt,
   updatedAt, partnerId, partner: { name, phone } }`.
5. **Earnings**: `balance` = ledger balance (after held withdrawals); `withdrawable` =
   `max(0, balance)`; `totalEarned` / `thisMonth` = sum of non-withdrawal ledger rows (IST
   month); `pendingSettlement` = for confirmed/checked-in/checked-out bookings not yet
   settled, `prepaid − fee − commission` (negative for pay-at-hotel).
6. **Ledger** items' `description` is the entry reason; marker rows are not listed.
7. **Reviews**: a booking that is not `checked_out` → **400**; someone else's booking → 404;
   duplicate → 409. `photos` up to 10 URLs. Public items show the reviewer's first name
   only, admin items the full name; partner and admin items carry `property: { _id, name }`.
   `avgRating` is rounded to 1 decimal. `GET /public/properties/:id/reviews` takes an id
   (not a slug); 404 for an unknown/deleted property.
8. **Saved**: `GET /user/saved` returns a plain array of PropertyCards
   (`startingPrice` = the property's stored starting price; no `available`/`distanceKm`).
   `POST` is 404 unless the property is listable; `POST`/`DELETE` are idempotent.
9. **Voucher** is HTML (not PDF; no new dependency) with a "Print / Save as PDF" button;
   auth errors are JSON 401/403, someone else's booking 404.
10. **Dashboard**: `revenueThisMonth` = Σ (taxableAmount + gstAmount) of confirmed /
    checked-in / checked-out bookings whose check-in is in this IST month;
    `occupancyThisMonth` = Σ booked ÷ Σ capacity of this month's `hotel_inventory_days`
    rows (blocks count as booked), 4 decimals; `todayDepartures` counts checked-in and
    checked-out stays leaving today; `recentBookings` excludes `awaiting_payment`/`expired`.
11. **Notifications**: guest inbox rows use `vertical: 'hotel'`, `source: 'BOOKING'`,
    `data.link = /hotel/bookings/:id`; partner pushes go to `HotelPartner.fcmTokens`
    (web + app). The confirmation email is sent only when SMTP is configured.
    `runHotelReminders` (every 30 min when `BACKGROUND_JOBS_ENABLED`): check-in reminder from
    5 h before `checkInTime` until check-in; review request for checked-out stays without a
    review, within 14 days.
12. **My orders / Master orders**: hotel rows use service/tab `hotel` (label "Stays"),
    route `/hotel/bookings/:id`; unpaid holds (`awaiting_payment` in My orders, `expired` in
    both) are hidden. Master > Orders refuses to delete a hotel booking.
13. **Settings**: `minWithdrawal`, `settleOn` and `reviewAutoApprove` are read through
    `services/moneySettings.js` from `settings.service.js` `getHotelSettings()` (contract
    defaults only if that read fails).
14. **With the phase-4 booking service**: the reminder job and the settlement read the
    same `hotel_bookings` fields the booking service writes; the `payment` event with
    `kind: 'at_hotel'` (mark-paid) is recorded but never counts as prepaid, and each `refund`
    event (one per actual refund) is keyed by its `refundId`.

## Phase 9: coupons

Hotel coupons live in `hotel_offers` (model `HotelOffer`); each use is a row in
`hotel_offer_redemptions` (`{ offerId, userId, bookingId, discount, funding, status: 'active'|'released' }`,
unique `(offerId, bookingId)`). Logic: `Backend/src/modules/hotel/services/offer.service.js`.
Tests: `Backend/tests/hotel.coupons.smoke.mjs`.

```ts
HotelOffer (admin view) = {
  _id, code /* unique, uppercase, 3-30 of A-Z 0-9 _ - */, title, description,
  discountType: 'percentage'|'flat', discountValue, maxDiscount: number|null /* % cap */,
  minBookingAmount /* vs the stay subtotal, before taxes */, validFrom: ISO|null, validTo: ISO|null,
  usageLimit: number|null /* total, null/0 = unlimited */, perUserLimit: number|null,
  effectiveUsageLimit, effectivePerUserLimit /* tightened by Master promo ceiling, vertical 'hotel' */,
  usedCount /* ACTIVE redemptions */, firstBookingOnly: boolean,
  propertyIds: string[] /* [] = all */, propertyTypes: string[] /* [] = all */,
  funding: 'platform'|'partner', isActive: boolean,
  state: 'live'|'scheduled'|'paused'|'used_up'|'expired', summary /* "20% off up to Rs 300" */,
  createdBy, createdAt, updatedAt
}
Offer (customer view) = { code, title, description, discountType, discountValue, maxDiscount,
  minBookingAmount, validTo, firstBookingOnly, summary }
```

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/offers?state&q&page&limit` | page of HotelOffer + `counts` per state (`state=all` or omitted = all) |
| POST | `/admin/offers` | create; `code`, `discountType`, `discountValue` required; defaults `funding: 'platform'`, `isActive: true`. 409 duplicate code; 400 percentage > 100, `validTo <= validFrom`, unknown property, or `funding: 'partner'` with no `propertyIds` |
| GET | `/admin/offers/:id` | `data: HotelOffer` |
| PUT | `/admin/offers/:id` | partial update (same rules on the merged coupon); `{ isActive }` pauses/resumes |
| DELETE | `/admin/offers/:id` | only a never-used coupon; a used one → **409** (pause it instead) |
| GET | `/user/offers?propertyId` | `USER` token. `data: Offer[]`: active, inside their window, not used up, applicable to the property, and usable by this customer (per-user limit, first booking) |

Rules:
1. **Validation** (quote and create): unknown code, paused, not started, expired, wrong
   property / property type, subtotal below `minBookingAmount`, total limit reached,
   per-user limit reached (counts the customer's ACTIVE redemptions), first-booking-only
   with an earlier non-cancelled/non-expired booking → **400** with a message naming the code.
   Discount: percentage of the subtotal capped by `maxDiscount`, or the flat amount; never
   more than the subtotal. The Quote gains `coupon: { code, title, discount }` and
   `pricing.couponCode` / `pricing.couponDiscount`.
2. **Redemption** happens inside the booking-create transaction: a conditional
   `$inc` on `usedCount` (`usedCount < limit`) makes the total limit exact under parallel
   bookings; the per-user count runs in the same transaction (concurrent redemptions of one
   coupon write-conflict and are retried). If the last use went meanwhile, create answers
   **400** "... has just been fully used" and nothing is booked.
3. **Release**: when a booking becomes `cancelled` or `expired`, its redemption is
   released and `usedCount` decremented (a `transition` listener on `bookingEvents`;
   idempotent). `no_show` and `checked_out` keep the use.
4. **Funding** (who bears the discount):
   - the coupon always lowers what the guest pays, before the prepaid discount and before
     GST; commission is always on the post-discount `taxableAmount`;
   - `platform`: `pricing.platformSubsidy = couponDiscount` and
     `partnerPayout = taxableAmount + gstAmount + platformSubsidy − commission − commissionGst`,
     i.e. the hotel's room revenue is as if the guest paid full price. Settlement adds the
     subsidy to the hotel's `EARNING` and writes a platform `ADJUSTMENT −subsidy`
     (`platform_subsidy` role). Pro-rata settlement on cancellation/no-show/late refund
     scales the subsidy like every other row. Platform P&L counts it against net.
   - `partner`: no subsidy; the discount comes out of the hotel's revenue. Only allowed on
     coupons restricted to specific `propertyIds`.
   - `pricing.couponFunding` and `pricing.platformSubsidy` are partner/admin-only (hidden
     from customer views, like commission).
5. **Master > Coupons** (`/v1/platform/coupons`) lists hotel coupons as source `hotel`
   ("Hotels") and pauses/resumes them through `isActive`; editing happens on the hotel
   admin's Offers screen (`/admin/hotel/offers`).
