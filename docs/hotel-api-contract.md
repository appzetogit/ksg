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
