# KSG Stays: Flutter implementation plan

For the Flutter team adding hotels to:

- **(a) the KSG customer app**: a new "Hotels" section (browse, book, pay, my stays);
- **(b) the hotel partner app**: a separate app (or a partner section) for hotel owners.

The API is live at `https://ksgsons.com/api/v1/hotel` and fully documented in
**`docs/hotel-api.md`** (referred to below as "API §n"). This plan says how to build the
clients on top of it: architecture, models, screens and the endpoints each one calls,
business rules, states, tests, milestones and the release checklist. The web app
(`Frontend/src/modules/Hotel/**`) already implements both flows and is the reference for
behaviour and copy.

---

## 1. Architecture

### 1.1 Principles

1. **Follow the existing app.** The customer app already has a state-management
   library, HTTP client, router, auth session and design system. Use them. The
   recommendations below are for anything the existing app does not already decide,
   and for the new partner app.
2. **The server is the source of truth for money and availability.** The app displays
   prices, never computes them (API §1.4).
3. **Feature-first folders**, one feature per screen group, with a thin data layer.

### 1.2 Recommended stack

| Concern | Recommendation | Notes |
|---|---|---|
| State management | **Riverpod 2** (`flutter_riverpod`, `riverpod_annotation` + generator) | If the existing customer app uses **Bloc/Cubit**, use Bloc there instead; keep the same choice in the partner app if it shares a codebase. Do not mix two in one app. |
| HTTP | **Dio** with interceptors | auth header, single-flight refresh, error mapping, logging (debug only, tokens redacted) |
| Models | **freezed** + **json_serializable** | immutable, `copyWith`, unions for UI state; `@JsonKey(unknownEnumValue: ...)` on every enum |
| Routing | **go_router** | deep links from pushes and `https://ksgsons.com/hotel/...` app links |
| Secure storage | `flutter_secure_storage` | tokens only |
| Payments | `razorpay_flutter` | customer app only |
| Push | `firebase_messaging` + `flutter_local_notifications` | foreground display, tap handling |
| Images | `cached_network_image`, `image_picker`, `flutter_image_compress` | compress before upload (5 MB limit) |
| Maps | the map package the customer app already uses (`google_maps_flutter` otherwise) | `[lng, lat]` order in API |
| Location | `geolocator` | "near me" |
| Dates | `intl` (`en_IN`), `timezone` | IST everywhere (§5.1) |
| Calendar (partner) | `table_calendar` or a custom grid | inventory calendar |
| Testing | `flutter_test`, `mocktail`, `http_mock_adapter` (Dio), `integration_test` | §8 |

### 1.3 Folder layout (feature-first)

```
lib/
  core/
    network/        dio_client.dart, auth_interceptor.dart, error_interceptor.dart, api_exception.dart
    auth/           session_store.dart (secure storage), token_refresher.dart
    time/           ist.dart (todayIst, formatIst, parse 'YYYY-MM-DD')
    money/          money_format.dart (₹ en_IN, num -> display)
    push/           push_service.dart, push_router.dart
    widgets/        error_view.dart, empty_view.dart, shimmer_list.dart, price_text.dart
  features/hotel/                       # customer app
    data/
      models/       *.dart (freezed)    # §2
      hotel_public_api.dart             # /public/*
      hotel_booking_api.dart            # /user/bookings*, /user/offers, /user/reviews, /user/saved
      upload_api.dart                   # /api/v1/uploads/*
      hotel_repository.dart
    application/    providers / blocs: search_controller, property_controller, quote_controller,
                    checkout_controller, payment_controller, stays_controller, saved_controller
    presentation/
      home/ results/ property/ checkout/ payment/ confirmation/ stays/ booking_detail/
      review/ saved/ offers/
  features/hotel_partner/               # partner app (or separate package)
    data/  models/ partner_auth_api.dart partner_property_api.dart partner_inventory_api.dart
           partner_booking_api.dart partner_money_api.dart
    application/ ...
    presentation/
      auth/ onboarding/ dashboard/ properties/ wizard/ room_types/ documents/
      inventory/ blocks/ bookings/ reviews/ earnings/ withdrawals/ profile/
```

If the partner app is a separate app, put `core/` and shared models
(`Catalogue`, `Property`, `RoomType`, `Booking`, `Review`, enums) in a local package
`packages/ksg_hotel_api` used by both apps.

### 1.4 Networking

**Base URLs** from flavor config: `apiRoot = https://ksgsons.com/api/v1`,
`hotelBase = $apiRoot/hotel`. Staging/dev flavors point at the dev server (mock OTP and
mock Razorpay there, API §6.5).

**Response unwrapping.** Every success is `{ success, message, data }`; repository
methods return the parsed `data` (and optionally `message` for snackbars).

**`ApiException`** built in an error interceptor:

```dart
class ApiException implements Exception {
  final int? status;          // HTTP status, null for network errors
  final String message;       // server `message`, or a friendly fallback
  final String? requestId;    // body.requestId or x-request-id header
  final bool isNetwork;       // timeout / no connection
}
```

- 4xx: `message` from the body (show it).
- 5xx: generic copy + `requestId` ("Something went wrong (ref 9f36a488)").
- No machine-readable codes exist (API §1.1). Add small helpers that look at status +
  message prefix where the UI must branch:
  `isTooManyHolds` = 409 && message starts with `You already have`;
  `isSoldOut` = 409 on create && message contains `Sold out` or `Not enough rooms`;
  `isPendingApproval` = 403 && message contains `pending approval`;
  `isModulePaused` = 503.

**Auth interceptor** (both apps, separate session stores):

1. Attach `Authorization: Bearer <access>` when a session exists.
2. On 401 for any path **except** `/auth/user/request-otp`, `/auth/user/verify-otp`,
   `/partner/auth/*`, `/auth/refresh-token`, `/auth/logout`, `/user/bookings/*/voucher`:
   run a **single-flight** refresh (`POST /auth/refresh-token`), queue concurrent 401s on
   the same `Completer`, retry each original request **once**.
3. Refresh 401 → clear session → emit `SessionExpired` → router goes to login.
4. Never refresh on 403.

**Timeouts**: connect 10 s, receive 20 s, upload 60 s. **No automatic retries for POST**
(especially `POST /user/bookings`, API §6.4); GETs may retry once on network errors.

### 1.5 Routing and deep links (go_router)

Customer routes:

| Route | Screen |
|---|---|
| `/hotel` | Hotels home / search |
| `/hotel/results` (query: city, lat, lng, checkIn, checkOut, adults, children, rooms, filters) | Results |
| `/hotel/p/:slugOrId` | Property detail (same path as the web share link) |
| `/hotel/checkout` (extra: quote input) | Checkout |
| `/hotel/pay/:bookingId` | Payment / complete-payment |
| `/hotel/bookings/:id` | Booking detail (push `link` target) |
| `/hotel/stays/:id` | alias of `/hotel/bookings/:id` (web redirects here) |
| `/hotel/stays?tab=upcoming` | My stays |
| `/hotel/saved`, `/hotel/offers` | Saved, Offers |

Partner routes:

| Route | Screen |
|---|---|
| `/login` | OTP login |
| `/onboarding` | Profile / KYC / bank / terms |
| `/` | Dashboard |
| `/properties`, `/properties/new`, `/properties/:id`, `/properties/:id/edit/:step` | Properties + wizard |
| `/properties/:id/room-types/:roomTypeId` | Room type form |
| `/inventory?propertyId&roomTypeId&month` | Calendar |
| `/bookings?status=`, `/bookings/:id` | Bookings (push `link` targets `/hotel/partner/bookings...`) |
| `/reviews`, `/earnings`, `/withdrawals`, `/profile` | |

`PushRouter.map(link)` translates server links: strip `/hotel/partner` (partner app) or
keep `/hotel/...` (customer app) and `context.go(...)`. Unknown links → open the app
home. Android App Links / iOS Universal Links for `ksgsons.com/hotel/p/*` and
`ksgsons.com/hotel/bookings/*` (release checklist §10).

---

## 2. Dart models

All `@freezed` with `fromJson`. Rules:

- Ids: `String`. Dates (`checkIn`, `date`, `startDate`…): keep as `String`
  (`YYYY-MM-DD`, IST) plus a getter `DateTime get checkInDate` built with the IST helper;
  never `DateTime.parse` a stay date into local time. Timestamps (`createdAt`,
  `expiresAt`): `DateTime` (UTC) via a converter.
- Money: `double` from `num` (`(json as num).toDouble()`); paise `int` only in
  `RazorpayCheckout.amount`.
- Every non-id field nullable or defaulted; every enum with an `unknown` value.
- `GeoPoint.fromJson` reads `coordinates[0]` as **lng**, `[1]` as **lat**.

### 2.1 Shared / public

| Model | Fields (type) | API |
|---|---|---|
| `Paged<T>` | items `List<T>`, page `int`, limit `int`, total `int`; getter `hasMore` | §1.3 |
| `Catalogue` | propertyTypes `List<String>`, inventoryTypesByProperty `Map<String, List<String>>`, requiredDocuments `Map<String, List<String>>`, amenities `List<Amenity>`, cancellationPolicies, mealPlans, suitability `List<String>` | §5.1 |
| `Amenity` | key, label `String` | |
| `City` | city `String`, count `int` | §5.2 |
| `GeoPoint` | lat, lng `double` (from GeoJSON) | |
| `ShortAddress` | area, city `String` | |
| `Address` | line1, area, city, state, pincode, country, fullAddress `String?`; getter `oneLine` | |
| `PropertyCard` | id, name, slug, propertyType, coverImage `String`, address `ShortAddress`, location `GeoPoint?`, distanceKm `double?`, avgRating `double`, totalReviews `int`, amenities `List<String>`, startingPrice `double?`, originalPrice `double?`, available `bool?` | §5.3, §8.3 |
| `TypeDetails` | hotelCategory, resortType, pgType, hostelType `String?`, starRating `int?`, hostLivesOnProperty `bool?` | |
| `NearbyPlace` | name `String`, type `String?`, distanceKm `double?` | |
| `CancellationPolicy` | type `CancellationPolicyType`, freeCancelHours `int`, refundPercentAfter `double` | |
| `Property` | id, name, slug, propertyType, typeDetails?, suitability, description, shortDescription, contactNumber?, address `Address`, location `GeoPoint?`, nearbyPlaces, coverImage, images `List<String>`, amenities, houseRules `List<String>`, checkInTime, checkOutTime `String` (`HH:mm`), cancellationPolicy, status `PropertyStatus`, isLive `bool`, startingPrice?, originalPrice?, avgRating, totalReviews, createdAt, updatedAt; partner-only: partnerId?, rejectionReason?, approvedAt? | §5.4, §18.3 |
| `RoomType` | id, propertyId, name, description, inventoryType `InventoryType`, roomCategory?, baseAdults, baseChildren, maxAdults, maxChildren, bedsPerRoom, totalInventory `int`, pricePerNight `double`, originalPrice?, weekendPrice?, extraAdultPrice, extraChildPrice `double`, mealPlan `MealPlan`, images, amenities, isActive `bool` | §5.4 |
| `PropertyDetail` | property `Property`, roomTypes `List<RoomType>` | §5.4 |
| `NightPrice` | date `String`, price `double` | |
| `RoomAvailability` | roomTypeId, name, available `int`, bookable `bool`, nightlyPrices `List<NightPrice>`, total `double` | §5.5 |
| `Availability` | checkIn, checkOut `String`, nights `int`, roomTypes `List<RoomAvailability>` | §5.5 |
| `Review` | id, propertyId, bookingId, rating `int`, subRatings `SubRatings?`, comment, photos, reply `ReviewReply?`, userName (from `user.name`), status `ReviewStatus`, createdAt, property `PropertyRef?` | §5.6, §13.1 |
| `SubRatings` | cleanliness, location, service, value `int?` | |
| `ReviewReply` | text `String`, at `DateTime` | |
| `RatingSummary` | avgRating `double`, totalReviews `int`, breakdown `Map<int,int>` (parse string keys) | |
| `ReviewPage` | `Paged<Review>` + summary `RatingSummary` | §5.6 |

### 2.2 Customer booking

| Model | Fields | API |
|---|---|---|
| `QuoteRequest` | propertyId, roomTypeId, checkIn, checkOut, rooms, adults, children `int`, paymentMode `PaymentMode`, couponCode `String?` (toJson only) | §6.3 |
| `GuestDetails` | name, phone `String`, email `String?` | |
| `CreateBookingRequest` | QuoteRequest fields + guestDetails, specialRequests `String?`, useWallet `bool` | §6.4 |
| `Pricing` | roomCharges, extraGuestCharges, subtotal, couponDiscount, prepaidDiscount, taxableAmount, gstRate, gstAmount, platformFee, platformFeeGst, total `double`, couponCode `String?`; partner-only: couponFunding?, platformSubsidy?, commissionRate?, commissionAmount?, commissionGst?, partnerPayout? | §18.7 |
| `AppliedCoupon` | code, title `String`, discount `double` | |
| `Quote` | propertyId, roomTypeId, checkIn, checkOut, nights, rooms, guests `Guests`, available `bool`, paymentMode, pricing, nightlyPrices, payNow, payAtHotel, walletApplicable `double`, cancellationPolicy, freeCancellationUntil `DateTime?`, holdMinutes `int`, coupon `AppliedCoupon?` | §6.3 |
| `Guests` | adults, children `int` | |
| `BookingSnapshot` | propertyName, propertyType, roomTypeName, address, coverImage, checkInTime, checkOutTime `String?`, cancellationPolicy? | |
| `BookingPayment` | mode `PaymentModeOrWallet`, status `PaymentStatus`, amountPaid, amountDue, walletAmount, payNow, onlineAmount, onlinePaid, collectedAtHotel, refundedAmount `double`, expiresAt `DateTime?` | §18.8 |
| `StatusChange` | status `BookingStatus`, at `DateTime`, byRole `String`, note `String?` | |
| `Cancellation` | by, reason `String?`, at `DateTime?`, refundAmount `double?` | |
| `RefundEntry` | amount, walletAmount, gatewayAmount `double`, status `RefundStatus`, reason, by `String?`, at `DateTime` | |
| `Booking` | id, bookingRef, propertyId, roomTypeId, userId?, partnerId?, snapshot, checkIn, checkOut `String`, nights, rooms `int`, guests, guestDetails, specialRequests?, pricing, payment, status `BookingStatus`, statusHistory `List<StatusChange>` (empty in lists), cancellation?, refunds, reviewId?, source?, canCancel `bool?`, canReview `bool?`, createdAt, updatedAt | §18.8 |
| `BookingSummary` | as Booking without statusHistory/refunds and with reduced payment (dashboard) | §18.9 |
| `RazorpayCheckout` | razorpayOrderId `String`, amount `int` (paise), currency, keyId, name, description `String`, prefill `{name, contact, email}` | §18.10 |
| `CreateBookingResult` | booking `Booking`, payment `RazorpayCheckout?` | §6.4 |
| `VerifyPaymentRequest` | razorpayOrderId, razorpayPaymentId, razorpaySignature | §6.6 |
| `CancelPreview` | refundAmount, refundPercent, walletRefund, gatewayRefund `double`, policyText `String`, freeCancellationUntil `DateTime?`, canCancel `bool` | §7.3 |
| `VoucherLink` | token `String`, expiresIn `int` | §7.4 |
| `Offer` | code, title, description `String`, discountType `DiscountType`, discountValue `double`, maxDiscount `double?`, minBookingAmount `double`, validTo `DateTime?`, firstBookingOnly `bool`, summary `String` | §8.1 |
| `CreateReviewRequest` | bookingId, rating, subRatings?, comment?, photos? | §8.2 |
| `UploadResult` | url, path, mimeType `String`, size `int` | §14 |

### 2.3 Partner

| Model | Fields | API |
|---|---|---|
| `PartnerSession` | accessToken, refreshToken `String`, partner `Partner`, isNewPartner `bool` | §2.2 |
| `Partner` | id, name, phone, email?, status `PartnerStatus`, rejectionReason?, approvedAt?, kyc `Kyc?`, bank `BankAccount?`, address `PartnerAddress?`, termsAcceptedAt?, lastLoginAt?, createdAt | §18.15 |
| `Kyc` | ownerName, aadhaarNumberMasked, aadhaarFront, aadhaarBack, panNumber, panImage, gstNumber, gstCertificate `String?` | |
| `BankAccount` | accountHolder, accountNumberMasked, ifsc, bankName `String?` | |
| `PartnerAddress` | line, city, state, pincode `String?`, location `GeoPoint?` | |
| `PropertyDraft` (request) | every Property field optional, `location` as `{lat, lng}`; `toJson` must omit nulls (strict server: unknown keys 400) | §10.2 |
| `RoomTypeInput` (request) | RoomType fields optional; `originalPrice`/`weekendPrice` tri-state (absent / null to clear / value) | §10.6 |
| `PartnerPropertyDetail` | property `Property`, roomTypes `List<RoomType>`, documents `PropertyDocuments` | §10.3 |
| `PropertyDocument` | type `DocumentType`, name?, fileUrl `String`, isRequired `bool`, uploadedAt `DateTime?` | |
| `PropertyDocuments` | propertyId, documents, verificationStatus `DocVerification`, adminRemark `String`, verifiedAt?, requiredTypes `List<String>` | §10.9 |
| `InventoryDay` | date `String`, capacity, booked, available `int`, price `double`, priceOverride `double?`, closed `bool` | §11.1 |
| `InventoryCalendar` | roomTypeId, days `List<InventoryDay>` | |
| `InventoryUpdate` (request) | roomTypeId, from, to, priceOverride (tri-state), closed `bool?` | §11.2 |
| `Block` | id, propertyId, roomTypeId, roomTypeName?, source `BlockSource`, startDate, endDate `String`, units `int`, externalPlatform?, externalReference?, notes?, createdBy, createdAt | §11.3 |
| `Dashboard` | properties `{total, live, pending}`, todayArrivals, todayDepartures, upcomingBookings `int`, revenueThisMonth `double`, occupancyThisMonth `double` (0..1), recentBookings `List<BookingSummary>` | §13.2 |
| `Earnings` | balance, pendingSettlement, totalEarned, thisMonth, withdrawable, minWithdrawal `double` | §13.3 |
| `LedgerEntry` | id, type `LedgerType`, amount `double`, bookingRef?, description `String`, createdAt, balanceAfter `double?` | §13.4 |
| `Withdrawal` | id, amount `double`, status `WithdrawalStatus`, bank `BankAccount`, note?, utr?, processedAt?, createdAt, updatedAt | §13.5 |

### 2.4 Enums

`PropertyType {hotel, resort, villa, homestay, hostel, pg}`, `InventoryType {room, bed,
entire}`, `PropertyStatus {draft, pending, approved, rejected, suspended}`,
`PartnerStatus {pending, approved, rejected, blocked}`, `BookingStatus
{awaitingPayment, confirmed, checkedIn, checkedOut, cancelled, noShow, expired}`
(`@JsonValue('awaiting_payment')` etc.), `PaymentMode {payAtHotel, online,
partialPrepaid}` (+ `wallet` read-only), `PaymentStatus {pending, paid, partiallyPaid,
refunded, partiallyRefunded, failed}`, `CancellationPolicyType {flexible, moderate,
strict, nonRefundable}`, `MealPlan {roomOnly, breakfast, halfBoard, fullBoard}`,
`Suitability {coupleFriendly, familyFriendly, both, none}`, `DocumentType`,
`DocVerification {pending, verified, rejected}`, `BlockSource {walkIn, external,
manualBlock}`, `LedgerType`, `WithdrawalStatus`, `ReviewStatus`, `RefundStatus
{processed, pending, failed}`, `DiscountType {percentage, flat}`. All with `unknown`.

Display labels live in one `labels.dart` (the catalogue has keys only, API §5.1).

---

## 3. Customer app: screens and flow

### 3.1 Flow

```
Hotels home ──► Results ──► Property detail ──► (login if needed) ──► Checkout
     │              ▲              │ room + dates + guests                │ quote / coupon / wallet / mode
     │              └── filters ───┘                                      ▼
     │                                                         create booking
     │                                         ┌──────────── confirmed ────────────┐
     │                                         │                                   ▼
     │                                awaiting_payment ─► Razorpay ─► verify ─► Confirmation
     │                                         │  (fail/dismiss) ─► Complete payment (countdown, retry)
     ▼                                         ▼
  My stays (tabs) ─► Booking detail ─► cancel (preview) / voucher / review / pay now / directions
  Saved, Offers
```

### 3.2 Screens and endpoints

| # | Screen | What it does | Endpoints |
|---|---|---|---|
| C1 | **Hotels entry / tile** | Show the Hotels tile only if `visible` | `GET /api/v1/platform/app-services` |
| C2 | **Hotels home / search** | City picker (from cities), "Near me" (location permission → lat/lng), date range (IST, ≤30 nights, ≤365 days ahead), guests & rooms stepper (rooms ≤ 20, adults ≤ 100, children ≤ 50), recent searches (local), "Offers for you" strip when logged in | `GET /public/cities`, `GET /public/catalogue` (cache), `GET /user/offers` (logged in) |
| C3 | **Results** | Infinite list of PropertyCards (page 20), sort sheet (relevance, price low/high, rating, distance only with near-me, newest), filter sheet (types, amenities, price range, min rating, suitability), map toggle (optional), heart = save | `GET /public/properties?...` ; `POST/DELETE /user/saved/:id` |
| C4 | **Property detail** | Gallery `[cover, ...images]`, name, type, rating, address + map + "Directions", amenities (labels from catalogue), description, house rules, check-in/out times, cancellation policy summary, nearby places; room list with per-room photos, meal plan, occupancy, live price for the chosen dates (`available`, `bookable`, nightly prices, "₹X for N nights + taxes"); reviews preview (summary + 3) → all reviews; share `https://ksgsons.com/hotel/p/<slug>`; save | `GET /public/properties/:slug`, `GET /public/properties/:id/availability?...` (re-run on date/guest change), `GET /public/properties/:id/reviews?limit=3` |
| C5 | **All reviews** | Rating summary + breakdown bars, paged list, hotel replies | `GET /public/properties/:id/reviews?page` |
| C6 | **Login gate** | If not logged in when tapping "Book", run the existing customer OTP login and return | `/api/v1/auth/user/*` |
| C7 | **Checkout** | Room/dates/guests summary (editable), payment mode selector (Pay online / Part pay now / Pay at hotel), coupon field + "View offers" sheet, "Use KSG wallet (₹walletApplicable)" toggle, guest details form (prefill from profile), special requests, price breakdown exactly as returned, "You pay now ₹payNow · At hotel ₹payAtHotel", cancellation text (`freeCancellationUntil` in IST), "Pay ₹X" / "Confirm booking" button | `POST /user/bookings/quote` (on every change, debounced 300 ms), `GET /user/offers?propertyId=`, `POST /user/bookings` |
| C8 | **Payment** | Opens Razorpay with the returned order; handles success → verify; error/dismiss → Complete payment | Razorpay SDK, `POST /user/bookings/:id/verify-payment`, `GET /user/bookings/:id` (poll) |
| C9 | **Complete payment** | Countdown to `payment.expiresAt`, "Pay now" (retry), "Cancel booking"; auto-poll; on expiry → "Hold expired, book again" | `POST /user/bookings/:id/retry-payment`, `GET /user/bookings/:id`, `POST /user/bookings/:id/cancel` |
| C10 | **Confirmation** | Booking ref, property, dates, amount paid / due at hotel, "View booking", "Voucher", "Add to calendar" | (data from verify/create) `POST .../voucher-link` |
| C11 | **My stays** | Tabs Upcoming / Ongoing / Past / Cancelled, paged; card shows status chip, dates, total, "Pay now" for awaiting_payment with countdown, "Rate stay" when `canReview`; pull to refresh | `GET /user/bookings?tab=...` |
| C12 | **Booking detail** | Status timeline (`statusHistory`), property snapshot, guest, price breakdown, payment block (paid / due at hotel / refunds), actions by state (table below), call hotel (`contactNumber` from property), directions | `GET /user/bookings/:id`, `GET /public/properties/:propertyId` (for contact/map, optional) |
| C13 | **Cancel sheet** | Shows `policyText`, refund amount and split (to card/UPI vs wallet), reason picker, confirm | `GET .../cancel-preview`, `POST .../cancel` |
| C14 | **Voucher** | Request link → open external browser / WebView | `POST .../voucher-link`, then `GET .../voucher?vt=` |
| C15 | **Write review** | Stars (required), 4 sub-ratings, comment (≤2000), up to 10 photos (upload each first) | `POST /api/v1/uploads/image` (folder `hotel/reviews`), `POST /user/reviews` |
| C16 | **Saved** | Grid/list of saved cards, unsave | `GET /user/saved`, `DELETE /user/saved/:id` |
| C17 | **Offers** | List of usable coupons with "Copy code"; from checkout: "Apply" | `GET /user/offers[?propertyId]` |

Booking detail actions by state:

| `status` | Actions |
|---|---|
| `awaiting_payment` | Pay now (countdown), Cancel (if `canCancel`) |
| `confirmed` | Voucher, Cancel (if `canCancel`, else "Contact the property"), Directions, Call |
| `checked_in` | Voucher, Directions, Call |
| `checked_out` | Rate stay (if `canReview`), View my review (`reviewId`), Voucher, Book again |
| `cancelled` / `expired` / `no_show` | Refund status (`refunds[]`), Book again, Support |

### 3.3 Checkout state machine (controller)

```
idle → quoting → quoted(quote) ─┬─ edit → quoting
                                ├─ quoteError(message) (keep last good quote, show inline)
                                └─ submit → creating
creating ─┬─ confirmed(booking)                      → Confirmation
          ├─ awaitingPayment(booking, checkout)     → Payment
          └─ createError(ApiException)               (sold out → re-quote; too many holds → link to My stays)
Payment: paying → verifying ─┬─ confirmed → Confirmation
                             ├─ failedRefunded (409 / status expired) → error screen
                             └─ uncertain → polling ─┬─ confirmed
                                                     ├─ expired/cancelled
                                                     └─ stillWaiting → Complete payment
```

- The **Pay** button is disabled while `creating` (create is not idempotent).
- Persist `pendingBookingId` locally when entering Payment; on app restart, if it is
  still `awaiting_payment`, open Complete payment and poll.

### 3.4 Razorpay integration details

See API §6.5-6.8. Additionally:

- One `Razorpay` instance per payment screen; `clear()` in `dispose`.
- Set checkout `timeout` to the seconds left on the hold.
- After `EVENT_PAYMENT_ERROR`, always `GET /user/bookings/:id` once before showing
  "Payment failed": UPI apps often report an error even though the payment was captured,
  and the webhook may already have confirmed it.
- Android: add the Razorpay ProGuard rules; iOS: minimum deployment target as required by
  `razorpay_flutter`.

---

## 4. Partner app: screens and flow

### 4.1 Flow

```
OTP login ─► status?
   pending (new) ─► Onboarding: profile → KYC (masked) → bank (masked) → terms ─► Properties (drafts)
   rejected      ─► banner with rejectionReason → fix profile/property → resubmit
   approved      ─► Dashboard
Properties ─► Wizard: basics → location → photos → amenities & rules → policy → room types → documents → review & submit
          ─► (admin approves) ─► Go live toggle
Dashboard ─► Bookings (today) ─► Booking detail: check-in / mark paid / check-out / no-show / cancel
          ─► Inventory calendar (+ blocks) ─► Reviews (reply) ─► Earnings / ledger / withdrawals
```

### 4.2 Screens and endpoints

| # | Screen | What it does | Endpoints |
|---|---|---|---|
| P1 | **OTP login** | Phone (+91), request OTP, 4-6 digit OTP with resend timer (OTP issuance is limited to 3 per 10 min across KSG: show the server message), send `fcmToken` + `platform: "mobile"` on verify | `POST /partner/auth/request-otp`, `POST /partner/auth/verify-otp` |
| P2 | **Pending / status gate** | Reads `partner.status`; pending: checklist "Complete profile · Add property · Submit · Wait for approval"; rejected: reason + fix; blocked: support screen (403 everywhere) | `GET /partner/me` |
| P3 | **Profile & onboarding** | Name, email; **KYC**: owner name, PAN (regex `^[A-Z]{5}\d{4}[A-Z]$`), PAN image, Aadhaar number (typed in full, sent masked), Aadhaar front/back, GSTIN (optional, then GST certificate); **Bank**: holder, account number (typed twice, sent masked), IFSC (regex, optional IFSC lookup), bank name; **Address** with map pin; accept terms | `PUT /partner/me`, `POST /api/v1/uploads/document` (folders `pan`, `aadhaar`, `gst`) |
| P4 | **Dashboard** (approved) | Cards: properties live/pending, today arrivals/departures, upcoming, revenue this month, occupancy %; recent bookings; quick links | `GET /partner/dashboard` |
| P5 | **Properties list** | Cards with status chip (draft/pending/approved/rejected/suspended) + live switch + rejection reason; "Add property" | `GET /partner/properties`, `PUT /partner/properties/:id/live` |
| P6 | **Property wizard** (create/edit) | Step 1 basics (name, type from catalogue, typeDetails per type, suitability, short/long description, contact) → **create draft** on first save; step 2 address + map pin (`{lat,lng}`); step 3 photos (cover + gallery, ≥3 total, upload each); step 4 amenities + house rules; step 5 check-in/out times + cancellation policy (type, free-cancel hours 0-720, refund % after); each step saves with PUT | `GET /public/catalogue`, `POST /partner/properties`, `PUT /partner/properties/:id`, `POST /api/v1/uploads/image` (`hotel/properties`) |
| P7 | **Room types** | List incl. inactive; form: name, description, inventory type (only allowed ones; hidden when one), category, base/max adults & children, beds per room (bed type), total inventory (hidden for `entire`), price, original price, weekend price, extra adult/child price, meal plan, ≥3 photos, amenities, active | `POST/PUT/DELETE /partner/properties/:id/room-types[/:roomTypeId]` |
| P8 | **Documents** | Required types (from `requiredTypes`) with upload slots + optional others; verification status + admin remark | `PUT /partner/properties/:id/documents`, `POST /api/v1/uploads/document` (`documents`) |
| P9 | **Review & submit** | Client-side checklist mirroring the server (API §10.10); "Submit for approval"; show the server's 400 message verbatim if anything is missing | `GET /partner/properties/:id`, `POST /partner/properties/:id/submit` |
| P10 | **Inventory calendar** (approved) | Property + room type pickers, month grid (max 92 days per fetch: load one month at a time), each day shows price, available/capacity, closed; multi-select range → set price / clear override / close / open | `GET /partner/inventory`, `PUT /partner/inventory` |
| P11 | **Blocks** | List blocks for the visible range; add block (source, room type, dates as check-in/check-out, units, platform, reference, notes); delete | `GET/POST/DELETE /partner/inventory/blocks` |
| P12 | **Bookings** | Tabs/presets: Today's arrivals, In-house, Upcoming, Needs action (confirmed with check-in before today), All; filters: property, status, date range (check-in), search (ref/name/phone); paged | `GET /partner/bookings?...` |
| P13 | **Booking detail** | Guest (tap to call), dates, rooms, guests, special requests, price + commission + payout, payment (paid / due / collected), timeline; actions by state (below) with confirmation dialogs | `GET /partner/bookings/:id`, `PUT .../check-in | check-out | no-show | mark-paid | cancel` |
| P14 | **Reviews** | Paged list (all statuses), filter by property, reply / edit reply | `GET /partner/reviews`, `POST /partner/reviews/:id/reply` |
| P15 | **Earnings** | Balance (can be negative, explain), withdrawable, pending settlement, total, this month; "Withdraw" (min `minWithdrawal`, ≤ withdrawable, bank required) | `GET /partner/earnings`, `POST /partner/withdrawals` |
| P16 | **Ledger** | Paged entries, debit/credit colouring, booking ref | `GET /partner/ledger` |
| P17 | **Withdrawals** | Paged history with status, UTR, note | `GET /partner/withdrawals` |
| P18 | **Settings / logout** | Logout sends refresh + FCM token | `POST /api/v1/auth/logout` |

Partner booking actions by state (API §12.3):

| `status` | Actions (show only when allowed) |
|---|---|
| `awaiting_payment` | Cancel (reason) |
| `confirmed`, today ≥ checkIn and today < checkOut | **Check in**, Mark paid (if `amountDue > 0`), Cancel |
| `confirmed`, today < checkIn | Mark paid, Cancel |
| `confirmed`, today > checkIn | **No-show**, Check in (until checkOut), Mark paid, Cancel (until checkOut) |
| `checked_in` | Mark paid (pre-filled with `amountDue`), **Check out** (if due > 0: "Record payment first" or "Check out anyway" = `force: true` with a second confirmation) |
| `checked_out` | Mark paid (if still due) |
| others | none |

The server re-checks every rule; on 409 show the message and re-fetch.

### 4.3 Masked-number rules (KYC and bank)

- Aadhaar: the user types 12 digits; validate length (and optionally Verhoeff); send
  `aadhaarNumberMasked = "XXXXXXXX" + last4`. Never persist or log the full number.
- Bank account: typed twice (match), 9-18 digits; send `accountNumberMasked =
  "X" * (len - 4) + last4`.
- The server rejects any value with more than 4 digits (API §9.2), so a bug here is a
  visible 400, not a data leak, but do not rely on it.
- PAN and GSTIN are stored as entered (validated by regex, uppercase them).
- Show the masked values from `GET /partner/me` when editing; leave the field blank
  unless the user re-enters a new number.

### 4.4 Uploads in the partner app

- Photos (`/uploads/image`, folder `hotel/properties`): compress to ≤ 1600 px, ≤ 1 MB;
  upload in parallel (max 3 at a time); show per-photo progress and retry.
- Documents (`/uploads/document`, folders `pan`, `aadhaar`, `gst`, `documents`): image
  or PDF (`file_picker`), ≤ 5 MB.
- Returned private URLs are signed and expire in ~2 h: render them right away, re-fetch
  the profile/property to show them later.

---

## 5. Business rules the apps must respect

### 5.1 Dates (IST)

- `todayIst()` = current UTC + 5:30, date part. Use it for the date picker minimum,
  tabs, "check-in today", countdowns and partner action gating.
- Stay limits: check-in ≥ today IST, check-in ≤ today + 365, 1-30 nights. Block-dates
  and inventory: block start ≥ today, block ≤ 366 nights, calendar fetch ≤ 92 days,
  bulk update ≤ 366 days.
- Send dates as `YYYY-MM-DD` strings; never convert a stay date to local midnight.
- Show timestamps in IST with the zone ("9 Nov, 12:00 PM IST").

### 5.2 Money and pricing

- Show only server figures: `pricing.*`, `payNow`, `payAtHotel`, `walletApplicable`,
  cancel-preview refund figures, earnings. **No client-side price, GST, discount, refund
  or commission computation**, except purely presentational sums such as "₹X per night"
  from `nightlyPrices`.
- GST and coupon lines come from the quote; the GST rate can change when a coupon or
  part-payment is applied.
- Re-quote whenever any input changes; never submit with a stale quote on screen
  (the create response is the real price anyway: show the booking's `pricing` on the
  confirmation, not the quote's).
- Razorpay `amount` is paise and comes from the server.

### 5.3 Holds and payment

- Hold countdown from `payment.expiresAt` (default 30 min); hide "Pay now" once it
  passes and poll until `expired`.
- **At most 3 unpaid online holds** per customer: on that 409, take the user to My
  stays → Upcoming to pay or cancel one.
- Create is not idempotent: single-flight the button, no auto-retry.
- Verify can be called more than once; polling `GET /user/bookings/:id` is always safe.
- Always check `booking.status` after verify (API §6.6 note).
- 503 during payment = hotel module paused: poll, do not create new bookings.

### 5.4 Availability and party

- Room/guest limits: rooms 1-20, adults 1-100, children 0-50 (quote/create limits).
- A room type fits when `rooms × maxAdults ≥ adults` and `rooms × maxChildren ≥
  children`; use availability's `bookable` to enable "Select", but the server decides.
- For `inventoryType == bed` label the counter "beds"; for `entire` force rooms = 1.
- Sold-out between quote and create → 409: re-run availability and quote.

### 5.5 Payment modes

- Offer Pay online, Part pay (show "Save 5%" only if the quote's `prepaidDiscount > 0`),
  Pay at hotel. If a pay-at-hotel quote returns 400 `Pay at hotel is not available...`,
  hide that option for the session.
- Wallet toggle visible when `walletApplicable > 0`; it is ignored for pay at hotel.

### 5.6 Cancellation, reviews, coupons

- Show Cancel only when `canCancel`; always preview first and show `policyText`.
- Review only when `canReview`; one per booking.
- Coupons: apply via quote; show the server's reason on 400; re-validate on create.

### 5.7 Partner

- Approved-only screens behind a status gate; a pending partner gets 403 there.
- Editing name/type/address/location of an approved property sends it back to review:
  warn first.
- Going live requires partner + property approval (403 otherwise).
- Delete property / deactivate room type → 409 with upcoming bookings.
- Reducing inventory below booked → 409 with the date.

---

## 6. Push notifications

### 6.1 Registration

| App | Register | Refresh | Remove |
|---|---|---|---|
| Customer | `fcmToken` + `platform: "mobile"` on `/auth/user/verify-otp` | on every launch and `onTokenRefresh`: `POST /api/v1/fcm-tokens/mobile/save { token }` (no `platform`) | `POST /api/v1/auth/logout` with `fcmToken`, or `DELETE /api/v1/fcm-tokens/remove` |
| Partner | `fcmToken` + `platform: "mobile"` on `/partner/auth/verify-otp` | ⚠️ **not possible** (core `/fcm-tokens` refuses `HOTEL_PARTNER`) | `POST /api/v1/auth/logout` with `fcmToken` |

Partner token rotation: store the token used at login; on `onTokenRefresh` save the new
one locally and show a non-blocking banner "Sign in again to keep receiving booking
alerts" (re-login registers it). Ask the backend team to add `HOTEL_PARTNER` to
`core/notifications/fcm.routes.js` (security review D13); when it ships, call
`/fcm-tokens/mobile/save` like the customer app.

Request notification permission (Android 13+, iOS) after login, explaining the value
("booking confirmations, check-in reminders").

### 6.2 Handling

- Foreground: show a local notification (`flutter_local_notifications`) and refresh any
  open screen for that `bookingId` (invalidate the provider).
- Tap (background/terminated, `getInitialMessage` + `onMessageOpenedApp`): route by
  `data.type` / `data.link`.
- Android channel `hotel_bookings` (high importance) for both apps.

| App | `data.type` | Route | Extra behaviour |
|---|---|---|---|
| Customer | `hotel_booking_confirmed` | `/hotel/bookings/:bookingId` | refresh My stays |
| Customer | `hotel_payment_expiring` | `/hotel/pay/:bookingId` | open Complete payment |
| Customer | `hotel_booking_expired` | `/hotel/bookings/:bookingId` | clear `pendingBookingId` |
| Customer | `hotel_booking_cancelled` | `/hotel/bookings/:bookingId` | |
| Customer | `hotel_refund` | `/hotel/bookings/:bookingId` | scroll to refunds |
| Customer | `hotel_checkin_reminder` | `/hotel/bookings/:bookingId` | |
| Customer | `hotel_checked_in`, `hotel_checked_out`, `hotel_no_show` | `/hotel/bookings/:bookingId` | |
| Customer | `hotel_review_request` | `/hotel/bookings/:bookingId?review=1` | open review sheet if `canReview` |
| Partner | `hotel_new_booking` | `/bookings/:bookingId` | refresh dashboard |
| Partner | `hotel_booking_cancelled` | `/bookings/:bookingId` | |
| Partner | `hotel_mark_arrival` | one: `/bookings/:bookingId`; several (`bookingIds` csv): `/bookings?status=confirmed` | |
| Partner | `hotel_monthly_summary` | `/earnings` | |

Fallback when `type` is unknown: use `link` via `PushRouter.map`; if that fails, open
home.

---

## 7. Error, empty and loading states

| Situation | UI |
|---|---|
| First load of any list/detail | Skeleton/shimmer matching the layout |
| Pull to refresh | Keep content, show indicator |
| Pagination | Footer spinner; footer "Retry" on error; stop at `hasMore == false` |
| Network error | Full-screen "You're offline" with Retry (detail) or inline banner (lists with cached data) |
| 4xx | Inline message near the action (forms), snackbar (actions), or full error view (404 detail: "This property is no longer available") |
| 5xx | "Something went wrong" + ref `requestId` + Retry |
| 503 module paused | Banner on Hotels home "Hotel booking is paused, please try later"; disable Book |
| 401 after failed refresh | Go to login, keep the deep link to return to |
| 403 pending partner | Pending screen with checklist |
| Empty search | "No stays match" + buttons: clear filters, change dates, widen radius |
| Empty My stays tab | Tab-specific copy + "Find a stay" |
| Empty saved | "Tap the heart on a stay to save it" |
| Empty offers | "No offers right now" |
| Empty reviews | "No reviews yet" |
| Partner: no properties | "Add your first property" CTA |
| Partner: empty bookings | "No bookings for this filter" |
| Partner: calendar | Per-day loading; failed range update → toast + revert selection |
| Quote error (coupon/mode) | Keep previous quote; inline message under the field |
| Sold out on create | Dialog "Just sold out" → back to room list with refreshed availability |
| Payment uncertain | "Confirming your payment…" with spinner (polling), then result |

Accessibility: semantic labels on price, rating and status chips; minimum 48 dp targets;
support text scaling (no fixed-height price rows).

---

## 8. Testing plan

### 8.1 Unit tests (models and parsers)

- `fromJson` for every model using the JSON samples in `docs/hotel-api.md` (copy them
  into `test/fixtures/*.json`): PropertyCard (with and without `distanceKm`/`available`),
  Property detail (missing optional fields), Availability, Quote (with/without coupon,
  all three modes), Booking (awaiting_payment with `expiresAt`, confirmed, cancelled with
  refunds, partner view with commission), CancelPreview (`canCancel` false), Offer,
  Review page (string breakdown keys), Partner (signed URLs), InventoryDay (with/without
  `priceOverride`), Block, Earnings (negative balance), LedgerEntry, Withdrawal.
- Unknown enum values map to `unknown`; unknown extra fields are ignored.
- GeoJSON `[lng, lat]` order.
- IST helpers: `todayIst` around 18:30 UTC (date flips at midnight IST), nights between
  dates, weekend detection (Fri/Sat), formatting.
- Money formatting (`₹5,877.90`, `₹1,00,000`).
- Masking helpers (Aadhaar 12 → `XXXXXXXX1234`, account numbers 9-18).
- `ApiException` mapping: guard error shape (no `error`/`requestId`), handler shape,
  network errors; `isTooManyHolds`, `isPendingApproval` helpers.
- Auth interceptor: single-flight refresh with 3 concurrent 401s; no refresh for
  `verify-otp`; refresh failure clears the session.
- Push router: every `data.type` maps to the right route; unknown type uses `link`.

### 8.2 Widget tests

- Search form limits (30 nights, 365 days, rooms 20, children 50).
- Results list: loading, empty, error, pagination.
- Property detail room card states: bookable, not bookable (party), sold out.
- Checkout: payment mode switch re-quotes; coupon error inline; wallet toggle; button
  disabled while creating.
- Complete payment countdown and expiry transition.
- Booking detail actions per status (table in §3.2).
- Partner booking detail actions per status/date (table in §4.2), check-out with due
  amount.
- Partner KYC form: masking, regex validation, 400 message display.

### 8.3 Integration tests (against the dev server / demo data)

Use the dev/staging server with **mock OTP on** (OTP `1234`) and **no Razorpay keys**
(mock orders). Demo logins:

| Role | Phone | Data |
|---|---|---|
| Customer | `9000000001` | existing bookings incl. a checked-out stay to review |
| Hotel partner (Bhopal) | `9000000010` | KSG Demo Hotel / Resort / Homestay, approved and live |
| Hotel partner (second) | `9000000011` | properties in Indore and other cities |

Scenarios:

1. Browse: cities → Bhopal results → KSG Demo Hotel (`ksg-demo-hotel-bhopal`) → dates
   with a Fri/Sat night (weekend prices appear) → reviews.
2. Book online: quote → create → (mock) verify with `mock_signature_bypass` →
   `confirmed`; appears in Upcoming; partner `9000000010` sees it.
3. Pay at hotel: create → `confirmed` immediately; partner marks paid after check-in.
4. Part payment: quote shows `prepaidDiscount`, `payNow` 30%.
5. Hold cap: create 3 unpaid online bookings → 4th returns 409 → cancel one → succeeds.
6. Expiry: (dev server with `paymentHoldMinutes` set low by an admin) leave a hold →
   `expired`, rooms released.
7. Cancel: preview → cancel → refund row; partner sees cancellation.
8. Coupon: create a test coupon in the admin panel (dev) → apply → invalid code message.
9. Voucher: link → opens HTML.
10. Review: on the demo customer's checked-out stay.
11. Partner onboarding with a fresh phone (dev): new partner `pending` → profile/KYC →
    draft property → room type → documents → submit → (admin approves in web) → live.
12. Partner inventory: close a day, override a price, see it in availability; add and
    delete a block.
13. Partner actions: check-in, mark paid, check-out, no-show (on a dev booking dated in
    the past via admin `force`, or wait a day).
14. Earnings/withdrawal: request ≥ ₹500 when the balance allows; see it in history.
15. Push: with a real device token on dev, confirm a booking and tap the notification.

Do not run write scenarios against production. Production smoke after release: browse,
login, one real low-value booking with a real card (then cancel for refund), voucher.

---

## 9. Milestones

Estimates assume 2 Flutter developers who know the existing customer app, plus part-time
QA; adjust to the team.

| Milestone | Scope | Estimate |
|---|---|---|
| **M0 Foundations** | Package/folders, Dio client + interceptors, models + fixtures + unit tests, IST/money helpers, labels, catalogue cache, routes | 1 week |
| **M1 Browse** | C1-C5: tile, home/search (city, near me, dates, guests), results with filters/sort/pagination, property detail (gallery, rooms, live availability, map, reviews), all reviews, share links | 2 weeks |
| **M2 Book & pay** | C6-C10, C17: login gate, checkout (quote, modes, coupon, wallet, guest form), create, Razorpay, verify, polling, retry, hold countdown, expiry, confirmation, offers | 2-2.5 weeks |
| **M3 My stays, reviews, saved** | C11-C16: tabs, booking detail with all states, cancel preview/cancel, voucher link, write review with photo upload, saved; customer pushes + deep links | 1.5-2 weeks |
| **M4 Partner app** | P1-P18: OTP login, status gate, onboarding/KYC/bank with masking + uploads, dashboard, properties + wizard + room types + documents + submit + live, inventory calendar + blocks, bookings + actions, reviews reply, earnings/ledger/withdrawals, partner pushes | 4-5 weeks |
| **M5 Hardening & release** | Accessibility, analytics events, crash reporting, performance (image caching, list virtualization), full regression, store submission | 1-1.5 weeks |

M1-M3 (customer) and M4 (partner) can run in parallel with one developer each after M0.
Total ≈ 8-9 weeks sequential for the customer section, ≈ 6 weeks for the partner app.

Suggested analytics events: `hotel_search`, `hotel_view_property`, `hotel_quote`,
`hotel_coupon_applied`, `hotel_booking_created`, `hotel_payment_success`,
`hotel_payment_failed`, `hotel_booking_cancelled`, `hotel_review_submitted`;
partner: `partner_property_submitted`, `partner_booking_action`, `partner_withdrawal`.

---

## 10. Release checklist

Backend / ops (confirm with the backend team before store release):

- [ ] **Mock OTP switched off** in production (`USE_DEFAULT_OTP` not `true`), real SMS
      working for both `/auth/user/*` and `/partner/auth/*`; demo numbers either removed
      or explicitly allow-listed for store review.
- [ ] **Razorpay live keys** configured (Master settings or env), webhook
      `payment.captured` pointed at production and its secret set; one live ₹1-₹10 test
      booking paid and refunded.
- [ ] `NODE_ENV=production` (no `otp` in responses, no mock orders).
- [ ] `BACKGROUND_JOBS_ENABLED` on (hold expiry, reminders, no-show prompts, summaries).
- [ ] FCM server credentials valid for both app bundle ids; test push to each app.
- [ ] Hotel module and the Hotels app-services tile switched on.
- [ ] Decide on partner FCM token refresh (D13) and the `details.code` serialization
      gap before relying on them.

Customer app:

- [ ] Production base URL in the release flavor; no dev URLs in the binary.
- [ ] Razorpay: release keystore SHA added if required, ProGuard rules, UPI intent
      `queries` on Android 11+ (`upi://pay`), iOS `LSApplicationQueriesSchemes` for UPI
      apps.
- [ ] **Deep link domains**: Android App Links (`assetlinks.json` on
      `https://ksgsons.com/.well-known/`) and iOS Universal Links
      (`apple-app-site-association`) for `/hotel/p/*`, `/hotel/bookings/*`,
      `/hotel/stays/*`; test from WhatsApp and SMS.
- [ ] Push: notification permission flow, channels, tap routing from terminated state.
- [ ] Location permission strings (iOS `NSLocationWhenInUseUsageDescription`) for
      "near me"; photo library/camera strings for review photos.
- [ ] Store listing: "Hotels" feature screenshots, privacy labels / Data safety
      (location, photos, payment info handled by Razorpay, phone number).

Partner app:

- [ ] Separate bundle id / app name ("KSG Hotel Partner"), icon, store listing,
      privacy labels (KYC documents, bank details, location).
- [ ] File picker permissions for PDFs; camera for document capture.
- [ ] Demo partner account for app review (phone + a reviewer OTP path agreed with
      backend), or a review-only approved partner.
- [ ] Verify masking: no full Aadhaar/account numbers in logs, analytics or crash
      reports.

Both:

- [ ] Crash reporting and analytics on; tokens and phone numbers redacted from logs.
- [ ] Force-update / min-version mechanism the existing app uses, so API changes can be
      rolled out.
- [ ] Regression of §8.3 scenarios on the release build against staging, then the
      production smoke.

---

## 11. Open questions for the backend team

1. Serialize error `details` (at least `code`) in `errorHandler.js` so the apps can
   branch without matching messages (`too_many_holds`, `stale`, sold-out date).
2. Add `HOTEL_PARTNER` to `/api/v1/fcm-tokens/*` (D13) so partner token refreshes work.
3. Idempotency key for `POST /user/bookings` (header `Idempotency-Key`).
4. Expose `allowPayAtHotel` (and hold minutes, prepaid %) in a public settings endpoint
   or in the catalogue.
5. `verify-payment` should not answer "Payment confirmed" for an expired/refunded
   booking.
6. Optional: `isSaved` on property detail for signed-in customers; a vertical filter on
   the customer inbox.
