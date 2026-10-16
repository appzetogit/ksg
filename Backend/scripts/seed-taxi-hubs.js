/**
 * Taxi transit hubs: demo airports and railway stations with sample charges.
 * Spec: docs/taxi-transit-hubs-contract.md.
 *
 *   node scripts/seed-taxi-hubs.js            # dry run (default): prints the plan, writes nothing
 *   node scripts/seed-taxi-hubs.js --apply    # writes
 *
 * Run seed-ksg.js --apply first: hubs are linked to the "India" taxi service
 * location and zone, and fees are set per ride type (Bike, Auto, Cab Mini,
 * Cab Sedan, Cab SUV -- "car" = the three Cab types). A ride type that does not
 * exist is left out of the fee list (it then pays nothing at that hub).
 *
 * Safety
 *  - Dry run by default; new rows are still run through Mongoose validation.
 *  - Idempotent: a hub is matched by (hub_type, code, name). Re-running changes nothing.
 *  - Additive only: nothing is deleted. On an existing hub only what is MISSING is
 *    filled in (charges, boundary, pin, service location / zone); charges an admin
 *    edited are left alone.
 *
 * Sample charges (edit them in Admin > Airports):
 *  - airports: pickup car Rs 100 / auto Rs 50 / bike Rs 30, drop Rs 0; parking 10 free
 *    minutes then Rs 30 per 15 min, capped Rs 150; night 22:00-06:00 x1.25; hub surge 0.
 *  - railway stations: pickup car Rs 40 / auto Rs 20 / bike Rs 10; parking 10 free
 *    minutes then Rs 20 per 15 min, capped Rs 100; no night window.
 *
 * Boundaries are a modest box (about 600-800 m across) around the terminal or the
 * station building; redraw them on the map in the admin if a road needs excluding.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { Airport } from '../src/modules/taxi/admin/models/Airport.js';
import { Vehicle } from '../src/modules/taxi/admin/models/Vehicle.js';
import { ServiceLocation } from '../src/modules/taxi/admin/models/ServiceLocation.js';
import { Zone as TaxiZone } from '../src/modules/taxi/driver/models/Zone.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const ZONE_NAME = 'India';

/** A box `halfMeters` either side of a point, as a closed GeoJSON polygon. */
const boxAround = ({ lat, lng }, halfMetersNS = 350, halfMetersEW = halfMetersNS) => {
  const dLat = halfMetersNS / 111320;
  const dLng = halfMetersEW / (111320 * Math.cos((lat * Math.PI) / 180));
  const r = (n) => Number(n.toFixed(6));
  return {
    type: 'Polygon',
    coordinates: [[
      [r(lng - dLng), r(lat - dLat)],
      [r(lng + dLng), r(lat - dLat)],
      [r(lng + dLng), r(lat + dLat)],
      [r(lng - dLng), r(lat + dLat)],
      [r(lng - dLng), r(lat - dLat)],
    ]],
  };
};

const HUBS = [
  // Airports
  { hub_type: 'airport', code: 'BHO', name: 'Raja Bhoj Airport', city: 'Bhopal', terminal: 'Main terminal',
    address: 'Airport Rd, Gandhi Nagar, Bhopal, Madhya Pradesh 462036', pin: { lat: 23.2875, lng: 77.3374 }, half: [350, 400] },
  { hub_type: 'airport', code: 'IDR', name: 'Devi Ahilya Bai Holkar Airport', city: 'Indore', terminal: 'Main terminal',
    address: 'Airport Rd, Indore, Madhya Pradesh 452005', pin: { lat: 22.7218, lng: 75.8011 }, half: [350, 400] },
  { hub_type: 'airport', code: 'DEL', name: 'Indira Gandhi International Airport T3', city: 'Delhi', terminal: 'Terminal 3',
    address: 'Terminal 3, IGI Airport, New Delhi, Delhi 110037', pin: { lat: 28.5562, lng: 77.0870 }, half: [400, 400] },
  { hub_type: 'airport', code: 'DEL', name: 'Indira Gandhi International Airport T1', city: 'Delhi', terminal: 'Terminal 1',
    address: 'Terminal 1, IGI Airport, New Delhi, Delhi 110037', pin: { lat: 28.5665, lng: 77.1031 }, half: [350, 350] },
  { hub_type: 'airport', code: 'GOI', name: 'Dabolim Airport', city: 'Goa', terminal: 'Main terminal',
    address: 'Dabolim, Goa 403801', pin: { lat: 15.3808, lng: 73.8314 }, half: [350, 350] },
  { hub_type: 'airport', code: 'GOX', name: 'Manohar International Airport', city: 'Goa', terminal: 'Main terminal',
    address: 'Mopa, Pernem, Goa 403512', pin: { lat: 15.7440, lng: 73.8607 }, half: [350, 400] },
  { hub_type: 'airport', code: 'KUU', name: 'Kullu-Manali Airport', city: 'Bhuntar', terminal: 'Main terminal',
    address: 'Bhuntar, Kullu, Himachal Pradesh 175125', pin: { lat: 31.8767, lng: 77.1544 }, half: [300, 300] },
  // Railway stations
  { hub_type: 'railway_station', code: 'BPL', name: 'Bhopal Junction', city: 'Bhopal', terminal: '',
    address: 'Bhopal Junction Railway Station, Bhopal, Madhya Pradesh 462001', pin: { lat: 23.2668, lng: 77.4136 }, half: [300, 350] },
  { hub_type: 'railway_station', code: 'RKMP', name: 'Rani Kamlapati (Habibganj)', city: 'Bhopal', terminal: '',
    address: 'Rani Kamlapati Railway Station, Habibganj, Bhopal, Madhya Pradesh 462024', pin: { lat: 23.2226, lng: 77.4382 }, half: [300, 300] },
  { hub_type: 'railway_station', code: 'INDB', name: 'Indore Junction', city: 'Indore', terminal: '',
    address: 'Indore Junction Railway Station, Chhoti Gwaltoli, Indore, Madhya Pradesh 452007', pin: { lat: 22.7176, lng: 75.8682 }, half: [300, 300] },
  { hub_type: 'railway_station', code: 'NDLS', name: 'New Delhi Railway Station', city: 'Delhi', terminal: 'Paharganj & Ajmeri Gate sides',
    address: 'New Delhi Railway Station, Paharganj, New Delhi, Delhi 110055', pin: { lat: 28.6430, lng: 77.2194 }, half: [350, 400] },
  { hub_type: 'railway_station', code: 'NZM', name: 'Hazrat Nizamuddin', city: 'Delhi', terminal: '',
    address: 'Hazrat Nizamuddin Railway Station, Nizamuddin East, New Delhi, Delhi 110013', pin: { lat: 28.5880, lng: 77.2536 }, half: [300, 300] },
  { hub_type: 'railway_station', code: 'MAO', name: 'Madgaon Junction', city: 'Goa', terminal: '',
    address: 'Madgaon Railway Station, Margao, Goa 403601', pin: { lat: 15.2700, lng: 73.9680 }, half: [300, 300] },
];

const CAR_TYPES = ['Cab Mini', 'Cab Sedan', 'Cab SUV'];

const feeList = (vehicles, { car, auto, bike }) => {
  const rows = [];
  for (const name of CAR_TYPES) if (vehicles[name]) rows.push({ vehicle_type_id: vehicles[name], amount: car });
  if (vehicles.Auto) rows.push({ vehicle_type_id: vehicles.Auto, amount: auto });
  if (vehicles.Bike) rows.push({ vehicle_type_id: vehicles.Bike, amount: bike });
  return rows;
};

const chargesFor = (hubType, vehicles) => (hubType === 'airport'
  ? {
    enabled: true,
    pickup_fee: feeList(vehicles, { car: 100, auto: 50, bike: 30 }),
    drop_fee: [],
    parking: { enabled: true, free_minutes: 10, block_minutes: 15, block_amount: 30, max_amount: 150 },
    time_windows: [{ name: 'Night', days: [], start: '22:00', end: '06:00', multiplier: 1.25, extra_flat: 0 }],
    special_dates: [],
    surge: { percent: 0, flat: 0 },
  }
  : {
    enabled: true,
    pickup_fee: feeList(vehicles, { car: 40, auto: 20, bike: 10 }),
    drop_fee: [],
    parking: { enabled: true, free_minutes: 10, block_minutes: 15, block_amount: 20, max_amount: 100 },
    time_windows: [],
    special_dates: [],
    surge: { percent: 0, flat: 0 },
  });

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactName = (name) => new RegExp(`^${escapeRegex(name)}$`, 'i');

const run = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGO_URI / MONGODB_URI in environment.');
  await mongoose.connect(uri);
  console.log(`db: ${mongoose.connection.db.databaseName}   mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (nothing is written)'}`);
  console.log('legend: + create   ~ fill missing fields   = unchanged');

  const notes = [];
  const [serviceLocation, zone] = await Promise.all([
    ServiceLocation.findOne({ name: ZONE_NAME }).select('_id').lean(),
    TaxiZone.findOne({ name: ZONE_NAME }).select('_id').lean(),
  ]);
  if (!serviceLocation) notes.push(`no "${ZONE_NAME}" taxi service location: hubs are created without one (run seed-ksg.js --apply first)`);
  if (!zone) notes.push(`no "${ZONE_NAME}" taxi zone: hubs are created without one`);

  const vehicles = {};
  for (const name of ['Bike', 'Auto', ...CAR_TYPES]) {
    const v = await Vehicle.findOne({ name: exactName(name) }).select('_id').lean();
    if (v) vehicles[name] = v._id;
    else notes.push(`ride type "${name}" not found: left out of the fee lists`);
  }

  const stats = { created: 0, updated: 0, unchanged: 0 };
  for (const spec of HUBS) {
    const label = `${spec.hub_type.padEnd(16)} ${spec.code.padEnd(5)} ${spec.name} (${spec.city})`;
    const boundary = boxAround(spec.pin, spec.half[0], spec.half[1]);
    const existing = await Airport.findOne({ hub_type: spec.hub_type, code: spec.code, name: spec.name });

    if (!existing) {
      const doc = new Airport({
        name: spec.name,
        code: spec.code,
        hub_type: spec.hub_type,
        radius_meters: 500,
        service_location_id: serviceLocation?._id || null,
        zone_id: zone?._id || null,
        terminal: spec.terminal,
        address: spec.address,
        latitude: spec.pin.lat,
        longitude: spec.pin.lng,
        location: { type: 'Point', coordinates: [spec.pin.lng, spec.pin.lat] },
        boundary,
        charges: chargesFor(spec.hub_type, vehicles),
        status: 'active',
        active: true,
      });
      const charges = doc.charges.toObject();
      doc.support_airport_fee = 0;
      doc.airport_surge = charges.surge.percent;
      await doc.validate();
      if (APPLY) await doc.save();
      stats.created += 1;
      console.log(`  + ${label}`);
      continue;
    }

    const fill = {};
    if (!existing.charges) fill.charges = chargesFor(spec.hub_type, vehicles);
    if (!existing.boundary?.coordinates?.length) fill.boundary = boundary;
    if (existing.latitude === null || existing.latitude === undefined || existing.longitude === null || existing.longitude === undefined) {
      fill.latitude = spec.pin.lat;
      fill.longitude = spec.pin.lng;
      fill.location = { type: 'Point', coordinates: [spec.pin.lng, spec.pin.lat] };
    }
    if (!existing.service_location_id && serviceLocation) fill.service_location_id = serviceLocation._id;
    if (!existing.zone_id && zone) fill.zone_id = zone._id;
    if (!existing.address) fill.address = spec.address;

    if (!Object.keys(fill).length) {
      stats.unchanged += 1;
      console.log(`  = ${label}`);
      continue;
    }
    existing.set(fill);
    await existing.validate();
    if (APPLY) await existing.save();
    stats.updated += 1;
    console.log(`  ~ ${label}   (${Object.keys(fill).join(', ')})`);
  }

  console.log(`\nhubs: ${stats.created} created, ${stats.updated} filled in, ${stats.unchanged} unchanged`);
  if (notes.length) {
    console.log('\nNotes:');
    for (const note of notes) console.log(`  - ${note}`);
  }
  if (!APPLY) console.log('\nDRY RUN: nothing was written. Re-run with --apply.');
};

run()
  .catch((err) => {
    console.error('seed-taxi-hubs failed:', err?.message || err);
    if (err?.errors) {
      for (const [path, e] of Object.entries(err.errors)) console.error(`  ${path}: ${e.message}`);
    }
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
