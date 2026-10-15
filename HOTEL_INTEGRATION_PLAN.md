# Hotel Booking — Integration Plan

Bringing the hotel module from `D:\projects\mydestination` into KSG as a fifth vertical,
next to food, taxi, quick commerce/medical and service provider.

Source: Express 5 + Mongoose 9 ESM backend (`backend/modules/hotel`), React 19 + Vite
frontend. Same stack and module system as KSG, so no CommonJS shim (unlike SP).

---

## 0. Ground rules

1. **Port by reading and rewriting, never bulk-copy.** The source repo has had malware
   injected three times (`mydestination/PROJECT-NOTES.md` §6; commits `6d68826`,
   `2b751e9`, `37aff0a`). Never copy its `vite.config.js`, `package.json` scripts,
   `.vscode/`, `public/fonts`, root-level scripts or `backend/.env`. Run
   `Frontend/scripts/check-source-integrity.mjs` and `Backend/scripts/sourceIntegrity.mjs`
   after every port batch.
2. **One mount: `/api/v1/hotel/*`.** The SP legacy delegation is registered last and
   swallows unprefixed paths like `/bookings` and `/payments`.
3. **Everything namespaced.** Models `Hotel*`, collections `hotel_*`. Source names
   `Booking`, `Review`, `Offer`, `Wallet`, `Transaction`, `Partner`, `User`, `Admin`,
   `Notification`, `Payment` all collide with core, SP or QC.
4. **Reuse KSG core, don't port source infrastructure.** Users, OTP, JWT, Razorpay,
   ledger, wallet, uploads, notifications, coupons and settings already exist in
   `Backend/src/core`. Only hotel *domain* code comes across.
5. **Behind a kill switch.** `MODULES.HOTEL` on the backend, `VITE_ENABLE_HOTEL` on the
   frontend, so it can ship dark and be switched on per site.

---

## 1. Target architecture

```
Backend/src/modules/hotel/
  models/            HotelProperty, HotelRoomType, HotelAvailability, HotelBooking,
                     HotelReview, HotelPropertyDocument, HotelPartner, HotelSavedProperty
  services/          availability, pricing, booking (state machine), settlement,
                     cancellation, search, notifications, jobs
  controllers/       public, user, partner, admin
  routes/            index.js -> /public, /user, /partner, /admin, /payments
  validators/        zod/joi schemas per endpoint
  constants.js       enums (property types, inventory types, statuses)
  tests/

Frontend/src/modules/Hotel/
  user/      search, listing, property detail, checkout, my stays, saved, reviews
  partner/   onboarding wizard, dashboard, properties, rooms, inventory calendar,
             bookings, reviews, earnings
  admin/     own layout (Pattern A, like SP): dashboard, properties & approvals,
             bookings, partners, reviews, settings
  services/  hotelApi.js (axios, contextModule 'hotel')
```

Alias `@hotel` → `Frontend/src/modules/Hotel` in `vite.config.js` (edit by hand, add
the alias line only).

---

## 2. Identity and roles

| Source | KSG | Notes |
|---|---|---|
| `User` (customers) | **core `users`** (`FoodUser`) | No `hotel_users`. Bookings reference `users._id`. Login is the existing `/v1/auth/user/request-otp` + `verify-otp`. |
| `User.savedHotels` | `hotel_saved_properties` `{userId, propertyId}` | Unique index on the pair. |
| `Partner` | **`hotel_partners`** (`HotelPartner`) | New role `HOTEL_PARTNER`, OTP login only (drop the source's password). |
| `Admin` | core `admins` | Add `'hotel'` to `servicesAccess`; gate with `requireServiceAccess('hotel')`. |
| `Wallet` (user) | core `CustomerWallet` | One wallet per person across verticals. |
| `Wallet` (partner/admin) | core ledger + `partner_balances` | See §6. |

**Backend role wiring**
- `src/core/auth/auth.middleware.js`: `lookupAccount` for `HOTEL_PARTNER`, checked on
  every request (the source only checked approval in the frontend). Blocked or deleted
  → refused; pending/rejected keep access to their own profile to finish onboarding;
  guest- and money-facing routes add `requireApprovedHotelPartner`.
  *(Done in phase 1, also in `refreshAccessToken`.)*
- Partner OTP lives inside the module: `POST /v1/hotel/partner/auth/request-otp` and
  `/verify-otp` (OTP scope `hotel_partner`, quota service `hotel` in
  `core/otp/otpRateLimit.service.js`). First verification creates the partner as
  `pending`. *(Done in phase 1.)*
- Admin hierarchy: `HOTEL` in `ADMIN_MODULES`, a `hotel_superadmin` level, and
  `'hotel'` in the `admin.model.js` `servicesAccess` enum, `platformAdmins.service.js`
  full-access list and `auth.service.js` default/allowed admin services *(done in
  phase 1)*; `adminAccessPolicy.js` (`ADMIN_SERVICES`, a `HOTEL_ADMIN_RULES` table) for
  sub-admin permissions comes with the admin phase.

**Frontend**
- `Frontend/src/services/api/axios.js` `isTokenForModule`: `hotel` → `HOTEL_PARTNER`
  token for partner screens, `USER` for customer screens, admin token for `/admin/hotel`.

---

## 3. Data models

All `timestamps: true`. Money in rupees as `Number` with 2-decimal rounding in the
service layer (matching KSG food/QC); paise only at the Razorpay boundary.

### 3.1 `HotelPartner` → `hotel_partners`
```
name            String, required
phone           String, required, unique (last 10 digits)
email           String, lowercase, sparse unique
platformUserId  ObjectId ref users        // via ensurePlatformUser, like SP/QC
status          enum pending|approved|rejected|blocked, default pending
rejectionReason String
kyc: {
  ownerName, aadhaarNumberMasked, aadhaarFront, aadhaarBack,   // private files
  panNumber, panImage, gstNumber, gstCertificate
}
bank: { accountHolder, accountNumberMasked, ifsc, bankName, razorpayFundAccountId }
address: { line, city, state, pincode, location: GeoJSON Point }
fcmTokens: { web: [String], app: [String] }
termsAcceptedAt Date
approvedAt, approvedBy (ref admins)
isDeleted       Boolean, default false
indexes: { phone: 1 } unique, { status: 1, createdAt: -1 }
```

### 3.2 `HotelProperty` → `hotel_properties`
```
partnerId         ObjectId ref HotelPartner, required, index
name              String, required, trim
slug              String, unique                   // SEO URLs
propertyType      enum hotel|resort|villa|homestay|hostel|pg, required
typeDetails: {
  hotelCategory   enum budget|premium|luxury
  starRating      Number 1-5
  resortType      enum beach|hill|jungle|desert
  pgType          enum boys|girls|unisex
  hostelType      enum boys|girls|mixed
  hostLivesOnProperty Boolean
}
suitability       enum couple_friendly|family_friendly|both|none, default none
description       String                            // declared (source dropped it)
shortDescription  String, maxlength 200
contactNumber     String
address: { line1, area, city, state, pincode, country: 'India', fullAddress }
location          GeoJSON Point, required          // [lng, lat]
zoneId            ObjectId ref food_zones          // which KSG zone it falls in
nearbyPlaces      [{ name, type, distanceKm }]
coverImage        String, required
images            [String]
amenities         [String]                          // from a fixed catalogue (§3.9)
houseRules        [String]
checkInTime       String 'HH:mm', default '12:00'
checkOutTime      String 'HH:mm', default '11:00'
cancellationPolicy {                                 // enforced, not free text
  type            enum flexible|moderate|strict|non_refundable, default moderate
  freeCancelHours Number, default 24
  refundPercentAfter Number, default 0
}
status            enum draft|pending|approved|rejected|suspended, default draft
rejectionReason   String
isLive            Boolean, default false            // partner toggle, only if approved
startingPrice     Number                            // denormalised min room price
originalPrice     Number
avgRating         Number, default 0
totalReviews      Number, default 0
approvedAt, approvedBy
indexes:
  { location: '2dsphere' }
  { status: 1, isLive: 1, propertyType: 1 }
  { 'address.city': 1 }
  { partnerId: 1, createdAt: -1 }
  text index on name, address.city, address.area
```

### 3.3 `HotelRoomType` → `hotel_room_types`
```
propertyId      ObjectId ref HotelProperty, required, index
name            String, required
inventoryType   enum room|bed|entire, required      // derived from propertyType
roomCategory    enum private|shared|entire
baseAdults      Number, default 2
baseChildren    Number, default 0
maxAdults       Number, required, min 1
maxChildren     Number, default 0
bedsPerRoom     Number, default 1                    // used when inventoryType = bed
totalInventory  Number, required, min 1              // rooms, beds, or 1 for entire
pricePerNight   Number, required, min 0
originalPrice   Number
weekendPrice    Number                               // optional Fri/Sat override
extraAdultPrice Number, default 0
extraChildPrice Number, default 0
mealPlan        enum room_only|breakfast|half_board|full_board, default room_only
images          [String], validate length >= 3
amenities       [String]
isActive        Boolean, default true
indexes: { propertyId: 1, isActive: 1 }
```
Server enforces the source's property-type → inventory-type mapping:
villa → entire; hotel/resort → room; hostel/pg → bed; homestay → room|entire.

### 3.4 `HotelAvailability` → `hotel_availability_ledger`
Kept from the source: one ledger for platform bookings, walk-ins, OTA bookings and
manual blocks.
```
propertyId      ObjectId, required
roomTypeId      ObjectId, required
source          enum platform|walk_in|external|manual_block, required
bookingId       ObjectId ref HotelBooking            // when source = platform
externalPlatform String; externalReference String
startDate       Date (check-in, 00:00 IST), required
endDate         Date (check-out, exclusive), required
units           Number, min 1, required
notes           String
createdBy       enum system|partner|admin
indexes:
  { roomTypeId: 1, startDate: 1, endDate: 1 }
  { bookingId: 1 } sparse unique
```

### 3.5 `HotelInventoryDay` → `hotel_inventory_days` (new — fixes overselling)
One row per room type per night, holding the booked count. Gives an atomic guard:
```
roomTypeId  ObjectId, required
date        Date (night, 00:00 IST), required
booked      Number, default 0
capacity    Number                    // snapshot of totalInventory (× bedsPerRoom)
priceOverride Number                  // optional per-night rate (seasonal pricing)
closed      Boolean, default false    // stop-sell
unique index { roomTypeId: 1, date: 1 }
```
Booking reserves each night inside a Mongo transaction with
`updateOne({roomTypeId, date, $expr: {$lte: [{$add:['$booked', n]}, '$capacity']}}, {$inc: {booked: n}}, {upsert})`;
if any night fails, the transaction aborts. The ledger stays as the human-readable
record; `hotel_inventory_days` is the counter the guard runs on. (KSG Mongo is already a
replica set, so transactions work.)

### 3.6 `HotelBooking` → `hotel_bookings`
```
bookingRef      String, unique ('KSGH' + base36), required
userId          ObjectId ref users, required
propertyId      ObjectId ref HotelProperty, required
partnerId       ObjectId ref HotelPartner, required    // denormalised for partner queries
roomTypeId      ObjectId ref HotelRoomType, required
zoneId          ObjectId
snapshot: {                                             // frozen at booking time
  propertyName, propertyType, roomTypeName, address, coverImage,
  checkInTime, checkOutTime, cancellationPolicy
}
checkIn         Date, required
checkOut        Date, required
nights          Number, required
rooms           Number, default 1, min 1
guests:         { adults: Number, children: Number }
guestDetails:   { name, phone, email }
specialRequests String
pricing: {
  roomCharges, extraGuestCharges, subtotal,
  couponCode, couponDiscount, prepaidDiscount,
  taxableAmount, gstRate, gstAmount,
  platformFee, platformFeeGst,
  total,
  commissionRate, commissionAmount, commissionGst,
  partnerPayout
}
payment: {
  mode          enum pay_at_hotel|online|wallet|partial_prepaid, required
  status        enum pending|paid|partially_paid|refunded|partially_refunded|failed
  amountPaid, amountDue,
  walletAmount,                                // CustomerWallet debit
  razorpayOrderId, razorpayPaymentId,
  paymentId     ObjectId ref payments           // core payments row
  expiresAt     Date                            // unpaid hold expiry
}
status          enum awaiting_payment|confirmed|checked_in|checked_out|
                     cancelled|no_show|expired, required
statusHistory   [{ status, at, by: {role, id}, note }]
cancellation: { by: enum user|partner|admin|system, reason, at,
                refundAmount, refundId ref refunds }
review          ObjectId ref HotelReview
notificationsSent { checkInReminder, reviewRequest, paymentExpiryWarning }
source          enum app|web|admin
indexes:
  { userId: 1, createdAt: -1 }
  { partnerId: 1, status: 1, checkIn: 1 }
  { propertyId: 1, checkIn: 1 }
  { status: 1, 'payment.expiresAt': 1 }        // expiry job
```
Legacy `completed`/`rejected` states dropped; `expired` added for auto-cancelled holds.

### 3.7 `HotelReview` → `hotel_reviews`
```
userId      ObjectId ref users, required
propertyId  ObjectId, required
bookingId   ObjectId ref HotelBooking, required    // only stayed guests can review
rating      Number 1-5, required
subRatings  { cleanliness, location, service, value }
comment     String, maxlength 2000
photos      [String]
reply       { text, at }
helpfulVotes [ObjectId ref users]
status      enum pending|approved|rejected, default approved (admin-configurable)
unique index { bookingId: 1 }                     // one review per stay
index { propertyId: 1, status: 1, createdAt: -1 }
```
`avgRating` / `totalReviews` on the property recomputed in a post-save hook.

### 3.8 `HotelPropertyDocument` → `hotel_property_documents`
```
propertyId  ObjectId, required, unique
documents   [{ type, name, fileUrl (private folder), isRequired, uploadedAt }]
verificationStatus enum pending|verified|rejected
adminRemark String; verifiedAt Date; verifiedBy ObjectId
```
Required-document rules ported from `backend/config/propertyDocumentRules.js`
(trade licence; rent agreement for hostel/PG; electricity bill for homestay; plus GST
certificate if the partner is GST-registered).

### 3.9 Catalogue & settings (no new collection needed)
- **Amenities catalogue**: a constant list in `constants.js` (Wi-Fi, AC, parking,
  restaurant, pool, gym, power backup, lift, CCTV, …) with icons, so filters work.
- **Settings registry** (`core/config/registry.js`, scope `vertical: 'hotel'`, plus
  zone/partner overrides):
  `hotel.commissionPercent` (10), `hotel.minCommission` (50),
  `hotel.paymentHoldMinutes` (30), `hotel.prepaidDiscountPercent` (5),
  `hotel.prepaidAdvancePercent` (30), `hotel.allowPayAtHotel` (true),
  `hotel.reviewAutoApprove` (true), `hotel.searchRadiusKm` (50).
- **Platform fee**: existing `fees.platformFee` / `fees.platformFeeGstRate` via
  `resolveMasterFees('hotel', zoneId)`.
- **Coupons**: superseded in phase 9 — core has no shared coupon engine (each vertical
  keeps its own offer collection), so hotels got their own `hotel_offers` +
  `hotel_offer_redemptions`, listed in Master > Coupons via `couponList.service.js`
  `SOURCES.hotel`. See "Phase 9 coupons, as built" in §8.

### 3.10 Dropped from the source
`HotelUISetting` (white-label demo), source `Wallet`/`Transaction`/`Withdrawal`
(→ core ledger), `Offer` (→ core coupons), `Otp`, `Notification`, referral models,
and all root-level debug/seed scripts.

---

## 4. Business logic (rewritten, with source bugs fixed)

### 4.1 Search — `GET /v1/hotel/public/properties`
Port `getPublicProperties` aggregation: optional `$geoNear` (lat/lng/radius), filters
for city/area text, property types, amenities (`$all`), suitability, star rating,
price range, guests (room types with `maxAdults ≥ adults`), dates (exclude properties
with no room type available for every night — reads `hotel_inventory_days`).
Sort: relevance, price low/high, rating, distance, newest. Paginated (cursor).
Only `status: approved`, `isLive: true`, partner `approved`.

### 4.2 Pricing — `services/pricing.service.js` (pure function, unit-tested)
```
nightly       = priceOverride ?? (weekend ? weekendPrice : pricePerNight), per night
roomCharges   = Σ nightly × rooms
extraGuests   = (extraAdultPrice × extraAdults + extraChildPrice × extraChildren) × nights
subtotal      = roomCharges + extraGuests
couponDiscount= core coupon engine (window, min amount, per-user and TOTAL usage limits)
prepaidDiscount = if mode = partial_prepaid: prepaidDiscountPercent × (subtotal − coupon)
taxableAmount = subtotal − couponDiscount − prepaidDiscount     // GST AFTER discounts
gstRate       = slab on per-room-per-night tariff:  ≤ ₹1,000 → 0%,  ≤ ₹7,500 → 5%*, > ₹7,500 → 18%
gstAmount     = round2(taxableAmount × gstRate)
platformFee   = resolveMasterFees('hotel', zoneId)  (+ its GST)
total         = taxableAmount + gstAmount + platformFee + platformFeeGst
commission    = max(round2(taxableAmount × commissionPercent), minCommission)
commissionGst = 18% of commission
partnerPayout = taxableAmount + gstAmount − commission − commissionGst
```
\* GST slabs must be confirmed with the client's CA before launch (the source used a
flat 12% on the pre-discount gross, which is wrong). Keep the slab table in settings,
not code.

Fixes vs source: capacity validated server-side (`rooms × maxAdults ≥ adults`), room
type must belong to the property, all client price fields ignored — the server
recomputes everything, and the checkout shows the server quote.

### 4.3 Booking flow & state machine
```
POST /v1/hotel/user/bookings/quote      -> price breakdown (no hold)
POST /v1/hotel/user/bookings            -> transaction:
      reserve hotel_inventory_days (atomic guard) + ledger row + booking
      pay_at_hotel          -> confirmed
      wallet (full)         -> CustomerWallet debit -> confirmed
      online/partial_prepaid-> awaiting_payment, Razorpay order, expiresAt = now + hold
POST /v1/hotel/user/bookings/:id/verify -> Razorpay signature + gateway amount check
      (SP confirmGatewayPayment pattern) -> recordPayment() -> confirmed
Razorpay webhook (add 'hotel' source in razorpayWebhook.controller) -> same confirm, idempotent

confirmed   -> checked_in   (partner/admin, on/after check-in date)
checked_in  -> checked_out  (requires paid unless admin force)
confirmed   -> no_show      (partner, after check-in day ends)
awaiting_payment -> expired (job, releases inventory and refunds any wallet part)
confirmed|awaiting_payment -> cancelled (user/partner/admin, policy below)
```
Every transition through one `transition(booking, to, actor)` function with an allowed
-transitions table, written with an atomic `findOneAndUpdate({_id, status: from})`,
appended to `statusHistory`, then side effects (inventory, money, notifications).
Admin actions are allowed (source bug: admins always got 403).

### 4.4 Cancellation & refunds
Policy from the property's `cancellationPolicy`, evaluated against check-in time in IST:
- before `freeCancelHours` → full refund; after → `refundPercentAfter`; no-show → 0.
- Partner/admin cancellations → always full refund to the guest.
- Refunds: online part via `core/payments/refund.service.initiateRefund` (Razorpay);
  wallet part back to `CustomerWallet` (idempotent `referenceKey`).
- Inventory released (decrement `hotel_inventory_days`, delete ledger row).

### 4.5 Settlement (core ledger)
On `checked_out` (or on `confirmed` for online, configurable), via
`core/finance/ledger.service.append` with idempotency keys:
- Paid online/wallet: partner `EARNING +taxableAmount+gst`, `COMMISSION −(commission+gst)`;
  platform credited commission + platform fee.
- Pay at hotel: partner `COMMISSION −(commission+gst)` (balance may go negative,
  recovered from future online payouts).
- Cancellation / no-show reverses with `REFUND` / `ADJUSTMENT` entries.
Partner withdrawals reuse the existing settlement/withdrawal flow
(`core/payments/settlement.service.js`), min amount from settings.
Add `hotel` to `LEDGER_VERTICALS`, `commissionOverview.service.js` and
`platformPnl.service.js` so Master finance screens include hotels.

### 4.6 Background jobs (gated `startIntervals` in `server.js`, not node-cron side effects)
| Every | Job |
|---|---|
| 1 min | expire `awaiting_payment` past `expiresAt` → `expired`, release inventory, refund wallet part |
| 15 min | payment-expiry warning push |
| 30 min | check-in reminder (~5 h before), review request (after check-out) |
| daily 03:00 IST | no-show sweep reminder to partners; inventory-day backfill for next 365 days |
| monthly | partner earnings summary email |
Guarded by `BACKGROUND_JOBS_ENABLED` and a Redis lock so two processes never double-run.

### 4.7 Notifications
`sendNotificationToOwner` (FCM) + `recordCustomerNotification({vertical: 'hotel'})` for
the guest; partner push + SMS on new booking; email confirmation with PDF voucher
(pdfkit, without the commission line the source leaked to customers). Add `hotel` to
`notification.model.js` verticals and `customerInbox.js`.

---

## 5. API surface (`/api/v1/hotel`)

**Public**
| Method | Path |
|---|---|
| GET | `/public/properties` (search) |
| GET | `/public/properties/:slugOrId` |
| GET | `/public/properties/:id/availability?checkIn&checkOut&adults&children&rooms` |
| GET | `/public/properties/:id/reviews` |
| GET | `/public/amenities`, `/public/cities` |

**Customer** (`USER` token)
| Method | Path |
|---|---|
| POST | `/user/bookings/quote` |
| POST | `/user/bookings` |
| POST | `/user/bookings/:id/verify-payment` |
| GET | `/user/bookings?tab=upcoming\|ongoing\|past\|cancelled` |
| GET | `/user/bookings/:id`, `/user/bookings/:id/voucher` (PDF) |
| POST | `/user/bookings/:id/cancel` (returns refund preview first via `?preview=1`) |
| POST | `/user/reviews` · POST `/user/reviews/:id/helpful` |
| GET/POST/DELETE | `/user/saved` · `/user/saved/:propertyId` |

**Partner** (`HOTEL_PARTNER` token; `/partner/auth/*` open)
| Method | Path |
|---|---|
| POST | `/partner/auth/request-otp`, `/partner/auth/verify-otp` |
| GET/PUT | `/partner/me` (profile, KYC, bank) |
| CRUD | `/partner/properties`, `/partner/properties/:id/room-types` |
| PUT | `/partner/properties/:id/documents` · `/partner/properties/:id/submit` · `/partner/properties/:id/live` |
| GET/PUT | `/partner/inventory?roomTypeId&from&to` (calendar: prices, stop-sell) |
| POST/DELETE | `/partner/inventory/blocks` (walk-in / external / manual block) |
| GET | `/partner/bookings?status&from&to` · `/partner/bookings/:id` |
| PUT | `/partner/bookings/:id/{check-in,check-out,no-show,mark-paid,cancel}` |
| GET/POST | `/partner/reviews` · `/partner/reviews/:id/reply` |
| GET | `/partner/earnings`, `/partner/ledger` · POST `/partner/withdrawals` |
| GET | `/partner/dashboard` (KPIs: occupancy, ADR, revenue, upcoming arrivals) |

**Admin** (`authMiddleware, requireRoles('ADMIN'), requireServiceAccess('hotel')`)
| Method | Path |
|---|---|
| GET | `/admin/dashboard` |
| GET/PUT | `/admin/partners`, `/admin/partners/:id/{approve,reject,block}` |
| GET/PUT | `/admin/properties`, `/admin/properties/:id`, `/admin/properties/:id/{approve,reject,suspend}` |
| PUT | `/admin/properties/:id/documents/verify` |
| GET/PUT | `/admin/bookings`, `/admin/bookings/:id/{status,cancel,refund}` |
| GET/PUT/DELETE | `/admin/reviews`, `/admin/reviews/:id/status` |
| GET/PUT | `/admin/settings` (proxies the settings registry, vertical `hotel`) |

Uploads use the existing `/v1/uploads/image` and `/v1/uploads/document`; KYC and
property documents go to private folders (`core/files/privateFiles.js`).

Mount in `src/routes/index.js`, **before** the SP legacy delegation:
```js
router.use('/v1/hotel', requireModuleEnabled(MODULES.HOTEL), hotelRouter);
```

---

## 6. Core files to extend (hardcoded vertical lists)

| File | Change |
|---|---|
| `core/modules/moduleRegistry.js` | `MODULES.HOTEL` |
| `core/payments/models/payment.model.js` | `PAYMENT_VERTICALS`, `PAYER_MODELS`, `SUBJECT_MODELS` |
| `core/payments/payments.facade.js` | `SUBJECT_BY_VERTICAL`, `PAYER_BY_VERTICAL` |
| `core/payments/controllers/razorpayWebhook.controller.js` | hotel order source |
| `core/finance/ledgerEntry.model.js` | `LEDGER_VERTICALS` |
| `core/finance/commissionOverview.service.js`, `platformPnl.service.js` | `SERVICES` |
| `core/activity/activity.model.js`, `attachActivityHooks.js`, `identityResolver.js` | hotel hooks |
| `core/notifications/models/notification.model.js`, `customerInbox.js` | vertical |
| `core/otp/otpRateLimit.service.js` | `HOTEL` |
| `core/promotions/couponList.service.js` | `SOURCES` |
| `core/orders/myOrders.service.js`, `masterOrders.service.js` | read `hotel_bookings` |
| `core/appServices/appServices.rules.js` | `APP_SERVICES` hotel tile |
| `core/admin/*` (model enum, hierarchy, access policy, platformAdmins), `core/auth/auth.service.js` | `'hotel'` service access |
| `core/config/registry.js` | hotel settings keys |

---

## 7. Frontend

**Customer (`/hotel/*`, lazy `HotelApp` in `Frontend/src/app/routes.jsx`)**
- Home/search: city or "near me", date range, guests & rooms; property-type chips.
- Listing: filters (price, type, rating, amenities, suitability), map toggle, sort.
- Property detail: gallery, amenities, room types with live availability and price
  for the chosen dates, policies, reviews, map.
- Checkout: guest details, payment mode (pay at hotel / pay now / 30% advance), coupon,
  wallet, server quote, Razorpay checkout.
- My stays, booking detail + voucher, cancel with refund preview, write review, saved.
- Rebuilt in KSG style (navy/saffron/green, the landing page's components), not the
  source's 1,700-line pages. Landing page: set `href: '/hotel'`, `cta: 'Book a stay'`
  for the `hotel` entry in `LandingPage/constants/brand.js`; add a Hotels tab next to
  Rides in `Food/components/user/home/HomeHeader.jsx`.

**Partner (`/hotel/partner/*`)**
- Onboarding: add `hotel` to `partner/partnerApi.js` `PARTNER_TYPES` and a card on
  `ChoosePartner.jsx` → hotel partner OTP login → KYC → property wizard.
- **One** data-driven property wizard (steps: type → basics → location (reuse
  `MapPinPicker`) → photos → amenities & rules → room types → documents → review &
  submit), driven by a per-type config. Replaces the source's six ~1,800-line copies.
- Dashboard (today's arrivals/departures, occupancy, revenue), properties, room types,
  **inventory calendar** (price + availability + stop-sell per night), bookings
  (check-in/out, no-show, mark paid), reviews & replies, earnings & withdrawals.

**Admin (`/admin/hotel/*`, Pattern A like SP — own layout, KSG sidebar palette)**
- Dashboard, partner approvals (KYC viewer), property approvals (documents viewer,
  approve/reject/suspend), bookings (with admin actions), reviews moderation, settings.
- Reuse master screens for coupons, finance, notifications and users — no copies.
- Add a **Hotel** tab to every panel switcher: Food `AdminSidebar.jsx`, Taxi
  `AdminLayout.jsx`, SP `AdminSidebar.jsx` / `AdminHeader.jsx` / `AdminBottomNav.jsx`.
- `Frontend/src/config/features.js`: `HOTEL_ENABLED` from `VITE_ENABLE_HOTEL`.

**Flutter**: customer and partner apps get a Hotels section later against the same
`/v1/hotel` API; publish an API doc (`docs/hotel-api.md`) with request/response examples.

---

## 8. Phases

| # | Phase | Deliverables | Est. |
|---|---|---|---|
| 1 | Foundation | `modules/hotel` skeleton, models + indexes, `MODULES.HOTEL`, mount, `HOTEL_PARTNER` role + OTP auth, admin service access, feature flag | 3–4 d |
| 2 | Partner onboarding & properties **(done, backend)** | partner KYC, property + room-type CRUD, documents, admin approval APIs, inventory days backfill | 4–5 d |
| 3 | Search & availability **(done, backend)** | search aggregation, availability endpoint, inventory guard, calendar APIs | 3 d |
| 4 | Booking & payments **(done, backend)** | pricing service (+unit tests), quote/create/verify, Razorpay + webhook, wallet, state machine, cancellation/refunds | 5–6 d |
| 5 | Money & jobs **(done, backend)** | ledger settlement, withdrawals, finance/P&L hooks, background jobs, notifications, voucher PDF | 3–4 d |
| 6 | Frontend — partner | onboarding, wizard, dashboard, inventory calendar, bookings, reviews, earnings | 6–7 d |
| 7 | Frontend — customer | search, listing, detail, checkout, my stays, reviews, saved; landing + home links | 6–7 d |
| 8 | Frontend — admin | hotel admin panel, switcher tabs, settings | 3–4 d |
| 9 | Hardening & launch | integration tests (overbooking race, payment/refund idempotency, expiry), fresh demo seed (`seed-hotel.js`, §10), load test search, docs, flag on | 3 d |

**Phases 2–3 backend, as built** (API: `docs/hotel-api-contract.md`, incl. its
Deviations section; tests: `Backend/tests/hotel.phase2.smoke.mjs`):
- `services/inventory.service.js` holds the reusable guard for the booking phase:
  `reserve` / `release` / `runInTransaction` / `ensureInventoryDays` / `backfillInventory`
  / `applyCapacity` / `quoteNights`, and the IST date helpers (`services/dates.js`:
  nights stored at 00:00 IST, stays `[checkIn, checkOut)`). Because the superapp server
  is a standalone mongod (transactions become no-ops via
  `config/standaloneTransactions.js`), `reserve` also undoes the nights it took before
  throwing, so a failed multi-night reserve never leaves a partial hold.
- Zone: properties get `zoneId` from the food zones via the existing
  `food/shared/zoneMatching.js` (`resolveZoneIdForPoint`).
- Deviations from this plan: search pagination is page/limit, not cursor (matches the
  contract); drafts may lack `location`/`coverImage` (enforced at submit); the inventory
  backfill job (§4.6) is not scheduled yet — room types are backfilled 365 days on
  create/update and the calendar/reserve create missing rows on demand; the seed
  (`scripts/seed-hotel.js`) skips settings keys (none registered yet) and the demo
  booking/review (booking phase).

**Phase 4 backend, as built** (API: `docs/hotel-api-contract.md` "Phase 4–5" + its phase-4
Deviations; tests: `Backend/tests/hotel.pricing.test.mjs`, `hotel.booking.smoke.mjs`):
- `services/pricing.service.js` (pure `priceStay`), `services/booking.service.js`
  (quote/create/verify/webhook/transition table/cancel/refunds/`expireStaleBookings`),
  `services/settings.service.js` + `models/hotelSettings.model.js` (one `hotel_settings`
  document instead of registry keys), `services/gateway.js` (Razorpay adapter, swappable in
  tests), `services/wallet.js` (CustomerWallet moves keyed by `referenceKey`),
  `routes/booking.routes.js`, `controllers/booking.controller.js`.
- Core edits: `payments/models/payment.model.js` + `payments.facade.js` (vertical `hotel`,
  subject `HotelBooking`, payer `FoodUser`); `payments/controllers/razorpayWebhook.controller.js`
  (hotel `payment.captured` hook); `server.js` (60 s expiry interval, gated).
- Deviations: coupons returned 400 until hotel coupons existed (resolved in phase 9);
  settings not in the registry; gateway refunds create the core `Refund` row via
  `initiateRefund` but call Razorpay through the hotel adapter (the core
  `processGatewayRefund` marks the whole payment refunded on a partial refund).

**Phase 5 backend, as built** (API + deviations: `docs/hotel-api-contract.md`, "Deviations
(backend, phase 5)"; tests: `Backend/tests/hotel.money.smoke.mjs`):
- Settlement and notifications are listeners on `services/bookingEvents.js`
  (`settlement.listener.js`, `notifications.listener.js`), registered by `routes/money.routes.js`.
- Withdrawals use `HotelWithdrawal` (`hotel_withdrawals`) with a ledger hold, not
  `core/payments/settlement.service.js` (restaurant/rider only).
- Voucher is printable HTML, not a pdfkit PDF (no new dependency).
- Only the 30-min reminder job is scheduled here (next to the expiry interval); the
  payment-expiry warning, no-show sweep and monthly summary email are not built yet. No
  Redis lock: each send is claimed by a conditional flag write instead.
- Settings (minWithdrawal, settleOn, reviewAutoApprove) come from
  `services/settings.service.js` `getHotelSettings()` via `services/moneySettings.js`.

**Phase 9 coupons, as built** (API + rules: `docs/hotel-api-contract.md` "Phase 9: coupons";
tests: `Backend/tests/hotel.coupons.smoke.mjs`, coupon cases in `hotel.pricing.test.mjs`,
`coupon-list.smoke.mjs`):
- `models/hotelOffer.model.js` (`hotel_offers`), `models/hotelOfferRedemption.model.js`
  (`hotel_offer_redemptions`), `services/offer.service.js` (validate / redeem in the
  create transaction / release on cancel+expire via a `bookingEvents` listener / admin CRUD
  / customer list), `routes/offer.routes.js`, `controllers/offer.controller.js`.
- Funding rule: commission always on the post-discount taxable amount; platform-funded
  coupons add `pricing.platformSubsidy` (= the discount) to the partner payout and the
  settlement (platform `ADJUSTMENT −subsidy`); partner-funded coupons cost the hotel and
  must be property-restricted. GST stays on the discounted amount (§4.2 unchanged).
- Core edits: `core/promotions/couponList.service.js` (`hotel` source),
  `core/finance/platformPnl.service.js` (subsidy reduces hotel net).
- Frontend: hotel admin **Offers** page (`/admin/hotel/offers`), offer chips on checkout,
  Master > Coupons links hotel coupons to it.

≈ 6–8 weeks for one developer; backend phases 1–5 and frontend 6–8 can run in parallel
with two people once phase 1 lands.

---

## 9. Testing

- **Unit**: pricing (GST slabs, coupons, prepaid, min commission), cancellation policy
  windows (IST boundaries), state-machine transition table.
- **Concurrency**: 20 parallel bookings for the last room → exactly one succeeds.
- **Payments**: verify + webhook both firing → one confirmation, one payment row, one
  ledger entry; amount mismatch rejected; refund idempotency.
- **Jobs**: expiry releases inventory and refunds wallet part; double-run safe.
- **Access**: partner can't touch another partner's property; unapproved partner blocked
  server-side; sub-admin without `hotel` access gets 403.
- Smoke tests in `Backend/tests/hotel.*.mjs` wired into `npm test`, like `test:sp`.

---

## 10. Data: fresh seed, no migration

**Decided: nothing is copied from myDestination's database.** No partners, properties,
customers, bookings, reviews or balances come across; the hotel vertical starts empty
and is filled by a seed.

Script `Backend/scripts/seed-hotel.js`, written in the same style as
`seed-ksg.js` (idempotent, dry run by default, `--apply` writes, never deletes):
1. **Settings**: hotel keys in the settings registry with the defaults from §3.9.
2. **Demo hotel partner**: approved `hotel_partners` record on phone `9000000010`
   (OTP 1234 while mock OTP is on), with placeholder KYC clearly marked as demo.
3. **Demo properties** (approved, live, inside the India zone), one per launch type,
   e.g. KSG Demo Hotel (Bhopal), KSG Demo Resort, KSG Demo Homestay — each with 2–3
   room types, prices, amenities, photos (placeholder URLs), policies and documents
   marked verified.
4. **Inventory**: `hotel_inventory_days` generated for the next 365 nights.
5. **Demo booking & review**: one confirmed upcoming booking and one checked-out booking
   with a review for the existing demo customer (`9000000001`), so the customer,
   partner and admin screens all have something to show.

Runs as part of phase 9 (and earlier on a dev database for frontend work).

---

## 11. Decisions needed from you

1. ~~Migrate existing myDestination data, or start fresh?~~ **Decided: fresh seed (§10).**
2. **Payment modes at launch**: keep pay-at-hotel and the 30% advance option, or online
   only? PhonePe is dropped in favour of Razorpay — confirm.
3. **GST**: confirm the slab table and whether KSG collects GST as the e-commerce
   operator (Section 9(5)) or the hotel does — this changes the voucher and settlement.
4. **Property types at launch**: all six (hotel, resort, villa, homestay, hostel, PG) or
   start with hotel/resort/homestay?
5. **Settlement timing**: credit partners on check-out (safer) or on confirmation?
6. **Hotel partners**: separate login (recommended), or reuse the store/restaurant
   partner portal accounts?
