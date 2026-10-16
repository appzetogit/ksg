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
