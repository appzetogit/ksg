# Taxi transit hubs: airport & railway station charges (contract)

Shared spec for three parallel workstreams (backend, admin UI, rider/driver UI).
Base URL `/api/v1/taxi` (same auth as the rest of the taxi module).

## Decisions

- Hubs = airports, railway stations, bus stands. One model: the existing `TaxiAirport`
  (`Backend/src/modules/taxi/admin/models/Airport.js`) gains `hub_type`; existing rows
  are airports. Admin paths stay `/admin/airports` (now listing every hub type).
- A hub applies when the pickup or drop point is inside its `boundary` polygon (fallback:
  within `radius_meters` of `location` when no boundary is drawn).
- **Pass-through to the driver**: pickup fee, drop fee and parking are not commissionable,
  not taxed, no platform fee; they go to the driver's earnings in full (the driver pays
  the gate/parking). Hub surge is ordinary surge (same treatment as zone surge).
- **Dynamic** = per-vehicle-type amounts, time-of-day windows, day-of-week, special dates,
  hub surge, and parking billed from actual waiting time.
- One calculation for quote, booking and completion (extend `common/rideFare.js`), so the
  figure quoted is the figure charged (except parking, which is recomputed at completion
  from real waiting time and shown as "estimated" before).

## Hub shape (admin read/write)

```ts
TransitHub = {
  _id, name, code, hub_type: 'airport'|'railway_station'|'bus_stand',
  service_location_id, zone_id, terminal, address, contact_number,
  latitude, longitude,                 // pin
  boundary?: GeoJSON Polygon,          // drawn on the map; preferred
  radius_meters: number,               // used when no boundary (default 500)
  status: 'active'|'inactive', active: boolean,
  charges: {
    enabled: boolean,
    pickup_fee: [{ vehicle_type_id: string|null /* null = all types */, amount: number }],
    drop_fee:   [{ vehicle_type_id: string|null, amount: number }],
    parking: {
      enabled: boolean,
      free_minutes: number,            // waiting at a hub pickup that is free
      block_minutes: number,           // billed per started block after that
      block_amount: number,            // ₹ per block
      max_amount: number|null          // cap per ride
    },
    time_windows: [{                   // first match wins; applied to pickup/drop fees and parking
      name: string, days: number[] /* 0=Sun..6, empty = every day */,
      start: 'HH:mm', end: 'HH:mm'     /* IST; may cross midnight, e.g. 22:00-06:00 */,
      multiplier: number /* default 1 */, extra_flat: number /* default 0 */
    }],
    special_dates: [{ date: 'YYYY-MM-DD', label: string, multiplier: number, extra_flat: number }], // beats time_windows
    surge: { percent: number, flat: number }   // added to the ride surge when the hub applies
  },
  // legacy fields kept and still accepted: airport_surge (→ surge.percent), support_airport_fee (→ pickup_fee all types)
  createdAt, updatedAt
}
```

Resolution for a fee amount: `amount(vehicle_type match else null entry else 0)` →
apply special date (if any) else first matching time window → `round(amount × multiplier + extra_flat)`.
Parking: `blocks = ceil(max(0, waited − free_minutes) / block_minutes)`, `min(blocks × block_amount × multiplier + extra_flat, max_amount)`,
only for a **pickup** hub, waited = minutes from driver arrival (`arrivedAt`) to trip start.

## Fare breakdown additions

Quote and ride responses gain:

```ts
hubCharges: [{
  code: 'hub_pickup_fee'|'hub_drop_fee'|'hub_parking'|'hub_surge',
  label: string,            // e.g. "Raja Bhoj Airport pickup fee", "Bhopal Jn parking (est.)"
  amount: number,
  hubId: string, hubName: string, hubType: TransitHub['hub_type'],
  passThrough: boolean,     // true for fees and parking (driver keeps it), false for surge
  estimated?: boolean       // parking before completion
}],
hubs: { pickup?: { id, name, type, code }, drop?: { id, name, type, code } }
```

The existing total includes them. Driver earning for the ride = existing earning + Σ passThrough amounts.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/airports?type=&q=&page=&limit=` | list hubs (existing endpoint, now any type) |
| POST/PATCH/DELETE | `/admin/airports[/:id]` | create/update/delete with the shape above |
| POST | `/admin/airports/:id/preview` | body `{ vehicle_type_id, role: 'pickup'\|'drop', at?: ISODateTime, waiting_minutes? }` → `{ lines: hubCharges, total }` (admin calculator) |
| GET | `/common/transit-hubs?lat&lng&type&radiusKm` | public: active hubs near a point `{ items: [{ id, name, code, type, latitude, longitude, address, distanceKm }] }` (rider shortcuts: "Airport", "Railway station") |
| existing | ride quote / create / complete | gain `hubCharges` and `hubs` as above |

## Deviations and clarifications (backend, as built)

Code: `common/transitHubCharges.js` (pure maths + admin input validation),
`services/transitHubs.service.js` (hub lookup, 45 s cache, public list),
`common/rideFare.js` (`hubCharges` input), `services/rideService.js` (quote, booking,
lifecycle), `driver/services/walletService.js` (settlement). Checks:
`common/__checks__/transitHubs.check.js`; smoke: `Backend/tests/taxi-hubs.smoke.mjs`
(`npm run test:taxi-hubs`). Seed: `Backend/scripts/seed-taxi-hubs.js`.

- **Estimated parking**: before completion a pickup hub with parking enabled always
  has a `hub_parking` line with `amount: 0, estimated: true` (quote, booking, ride
  until the trip starts). When the trip starts and again at completion it is
  recomputed from the real wait (`arrivedAt` → `startedAt`, rounded up to the minute)
  and becomes `estimated: false`; a recomputed parking of ₹0 removes the line.
  `arrivedAt` is only stamped when the driver is within 500 m of the pickup, so a
  driver who never reached the pickup bills no parking.
- **`extra_flat` only on a non-zero charge**: `round(amount × multiplier + extra_flat)`
  is applied only when the base amount is > 0 (a ₹0 drop fee stays ₹0 at night;
  parking with no billable block stays ₹0). Not literally the formula above.
- **Parking cap**: `max_amount: null` (or 0) = no cap. To make parking free, disable it.
- **Time windows crossing midnight** belong to the day they start on: a Friday-only
  22:00–06:00 window covers Saturday 02:00. `start === end` = the whole day. Times and
  special dates are IST. Windows scale pickup/drop fees and parking, not the hub surge.
- **When fees are priced**: pickup/drop fees and the hub surge are priced at booking
  (at `scheduledAt` for a scheduled ride, else booking time) and frozen; the quote
  prices at "now". Parking uses the modifier at `arrivedAt`. All of it comes from a
  snapshot of the hub stored on the ride (`ride.hubSnapshot`), so admin edits after
  booking do not change the ride.
- **Hub surge**: `round(fareBeforeSurge × percent / 100 + flat)`, once per hub (a ride
  from a hub back to the same hub pays it once); folded into the ride's surge
  (`pricingSnapshot.ride_surge_amount`, `fare.surge`), so it is treated exactly like
  zone surge (no commission on it, as before for surge).
- **`ride.fare` and the other fare parts**: `ride.fare` (the total) includes
  `hubPassThroughTotal` at every stage (booking, boosts, accepted bids, completion).
  `baseFare`, `pricingSnapshot.agreed_fare`, `waitingChargeAmount`, `additionalCharge`,
  bid/boost ranges (`bidFloorFare`, `userMaxBidFare`, `bidCeilingMaxFare`), the promo
  and insurance premium are all **without** the hub fees. New ride fields:
  `hubCharges`, `hubs`, `hubPassThroughTotal` (Σ passThrough lines, = what `fare`
  carries on top). A percentage cancellation fee is taken on the fare without them.
- **Quote**: each per-vehicle quote item has `hubCharges` and `hubs` at the top level;
  `fare` additionally has `hubCharges`, `hubSurge`, `hubPassThroughTotal`, and
  `fare.total` includes the pass-through. `hubs` is `{}` when no hub applies.
- **Where hub fields are returned**: `serializeRideRealtime` (GET `/rides/:id`, active
  ride, socket `ride:state`, ride status updates), ride history items, driver incoming
  request (dispatch payload), driver scheduled rides, socket status-updated payloads,
  admin ride detail.
- **Driver earnings**: `driverEarnings` = (fare − hub pass-through) − commission +
  incentive + hub pass-through. No commission and no platform incentive on the
  pass-through. Cash: the driver collects `fare` (incl. fees); his wallet moves by
  `driverEarnings − fare` = −commission (fees are not debited). Online: the full
  `driverEarnings` (incl. fees) is credited when the payment is confirmed.
- **Not applied to**: parcels (`transport_type: 'delivery'`) and instant pool rides
  (they complete through `instantPoolingService` and are not booked through
  `createRideRecord`). A subscription-covered ride still carries hub fees in `fare`
  but the subscription collection amount is the ride fare only (existing waiting /
  insurance charges behave the same way).
- **Hub matching**: active hub (`status: 'active'`, `active !== false`) whose boundary
  contains the point; else, among hubs **without** a boundary, the nearest within its
  own `radius_meters` (searched up to 5 km). Cached 45 s per ~10 m cell per server
  process; admin writes clear the cache on the process that served them, so on a
  multi-instance deployment an edit can take up to 45 s to apply everywhere.
- **Admin API**:
  - `GET /admin/airports` without `page`/`limit` returns every hub (old page); the
    response `data` has `airports` and `items` (same list) plus `total`, `page`,
    `limit` (`limit` capped at 1000). `type=airport` also matches old rows with no
    `hub_type`. Added `GET /admin/airports/:id`.
  - Hub responses also carry `boundary_coordinates: [{lat,lng}]` (old page),
    `charges_source: 'charges'|'legacy'`, and `charges` is always the effective
    charges (a legacy row is shown mapped from `support_airport_fee` / `airport_surge`).
  - Writes accept `boundary` (GeoJSON) or `boundary_coordinates`; `boundary` wins. An
    open ring is closed; fewer than 3 distinct points, out-of-range coordinates or a
    self-intersecting polygon → 400. `boundary: null` (or `[]`) clears it.
  - When `charges` is sent it wins over `airport_surge` / `support_airport_fee`, which
    are then mirrored from it (surge.percent, the all-types pickup fee). Sending only
    the legacy fields to a hub that has `charges` updates those two parts of `charges`.
    `charges: null` drops back to the legacy fields.
  - Validation: amounts, multipliers, minutes ≥ 0; `HH:mm` (two-digit hour); days 0–6;
    dates `YYYY-MM-DD`; one fee row per vehicle type; parking `block_minutes > 0` when
    enabled; `hub_type` in the enum; `radius_meters` 0–20000.
  - Preview also accepts `fare` (fare before surge, default 0) for the hub-surge percent,
    and returns `hubCharges` (same as `lines`) and `passThroughTotal`.
- **Public endpoint**: `radiusKm` default 25, max 200; at most 20 items (`limit` up to
  50); missing/invalid `lat`/`lng` or unknown `type` → 400.
- **Seed**: Delhi IGI is two hubs (code `DEL`, "T3" and "T1"), since one modest box
  cannot cover terminals 2 km apart.
