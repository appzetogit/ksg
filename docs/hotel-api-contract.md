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
