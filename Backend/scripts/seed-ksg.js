/**
 * KSG first-run seed: an India-wide zone for every vertical, the catalogue each
 * app needs to show anything, and one approved demo account per role.
 *
 *   node scripts/seed-ksg.js            # dry run (default): reads, validates, prints the plan
 *   node scripts/seed-ksg.js --apply    # writes
 *
 * Safety:
 *  - Dry run by default. Nothing is written without --apply. New documents are
 *    still run through Mongoose validation in the dry run, so a schema problem
 *    shows up before anything is written.
 *  - Idempotent. Every row is matched by a stable key (zone/category/vehicle
 *    name, account phone, slug) and created only when missing. Re-running is safe.
 *  - Additive only. Nothing is deleted or dropped. On an existing CATALOGUE row
 *    (zones, categories, vehicles, fares, services) nothing is changed, so admin
 *    edits survive a re-run. On an existing DEMO ACCOUNT only the flags that make
 *    it usable are re-asserted (approved / active / verified / zone link).
 *  - A demo account whose phone is already used by a document with a DIFFERENT
 *    name is skipped with a warning rather than approved, so this can never
 *    approve somebody else's real application.
 *  - Documents are written through the models (doc.save()), so schema
 *    validation and pre-validate / pre-save hooks run.
 *
 * Demo logins: every phone below signs in with the mock OTP (1234) while mock
 * OTP is enabled. Turn mock OTP off before real customers can reach these.
 *
 * After this, run (both dry-run by default):
 *   node scripts/seed-legal-pages.mjs --apply
 *   node scripts/sp-seed-services.cjs --apply   # only fills SP categories that still have no services
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

// Food
import { FoodZone } from '../src/modules/food/admin/models/zone.model.js';
import { FoodCategory } from '../src/modules/food/admin/models/category.model.js';
import { FoodItem } from '../src/modules/food/admin/models/food.model.js';
import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../src/modules/food/delivery/models/deliveryPartner.model.js';
// Shared customer identity (`users`, read by food AND taxi)
import { FoodUser } from '../src/core/users/user.model.js';
// Quick commerce + medical (a pharmacy is a quick-commerce seller with storeType 'pharmacy')
import { QCZone } from '../src/modules/quickCommerce/modules/food/admin/models/zone.model.js';
import { MedicalZone } from '../src/modules/quickCommerce/modules/food/admin/models/medicalZone.model.js';
import { FoodCategory as QCCategory } from '../src/modules/quickCommerce/modules/food/admin/models/category.model.js';
import { FoodRestaurant as QCRestaurant } from '../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner as QCDeliveryPartner } from '../src/modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js';
import { FoodUser as QCUser } from '../src/modules/quickCommerce/core/users/user.model.js';
// Taxi
import { Zone as TaxiZone } from '../src/modules/taxi/driver/models/Zone.js';
import { ServiceLocation } from '../src/modules/taxi/admin/models/ServiceLocation.js';
import { Vehicle } from '../src/modules/taxi/admin/models/Vehicle.js';
import { SetPrice } from '../src/modules/taxi/admin/models/SetPrice.js';
import { TaxiAppModule } from '../src/modules/taxi/admin/models/TaxiAppModule.js';
import { Driver } from '../src/modules/taxi/driver/models/Driver.js';

// Service provider: CommonJS module (its own package.json says "type": "commonjs").
const require = createRequire(import.meta.url);
const SPCategory = require('../src/modules/serviceProvider/models/Category.js');
const SPBrand = require('../src/modules/serviceProvider/models/Brand.js');
const SPUserService = require('../src/modules/serviceProvider/models/UserService.js');
const SPCity = require('../src/modules/serviceProvider/models/City.js');
const SPVendor = require('../src/modules/serviceProvider/models/Vendor.js');
const SPWorker = require('../src/modules/serviceProvider/models/Worker.js');
const SPUser = require('../src/modules/serviceProvider/models/User.js');

dotenv.config();

const APPLY = process.argv.includes('--apply');

// ─────────────────────────────────────────────────────────────── constants ──

const ZONE_NAME = 'India';

/** Bhopal: where every demo account sits, well inside the India polygon. */
const BHOPAL = { lat: 23.2599, lng: 77.4126 };
const ADDRESS = {
  addressLine1: 'MP Nagar Zone-I',
  area: 'MP Nagar',
  city: 'Bhopal',
  state: 'Madhya Pradesh',
  pincode: '462011',
};

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// Open round the clock so the demo can be tried at any hour. Change in the panel.
const OPEN = '00:00';
const CLOSE = '23:59';

const DEMO_IMAGE = 'https://placehold.co/800x500/png?text=KSG+Demo';
const DEMO_DOC = 'https://placehold.co/800x500/png?text=KSG+Demo+Document+(not+real)';
const DEMO_ID = 'DEMO-NOT-A-REAL-ID';

const PHONES = {
  customer: '9000000001',
  restaurant: '9000000002',
  foodDelivery: '9000000003',
  taxiDriver: '9000000004',
  grocery: '9000000005',
  medical: '9000000006',
  spVendor: '9000000007',
  spWorker: '9000000008',
  qcDelivery: '9000000009',
};

/**
 * A rectangle round India (lat 6.5-35.7, lng 68.1-97.4), with extra points
 * along each edge. Taxi stores it as a 2dsphere GeoJSON polygon, whose edges
 * are great circles; densifying keeps those edges close to the drawn lines.
 * Counter-clockwise (SW -> SE -> NE -> NW).
 */
const INDIA_BOUNDS = { south: 6.5, north: 35.7, west: 68.1, east: 97.4 };
const SEGMENTS = 6;
const lerp = (a, b, t) => Number((a + (b - a) * t).toFixed(4));
const indiaRing = () => {
  const { south, north, west, east } = INDIA_BOUNDS;
  const pts = [];
  for (let i = 0; i < SEGMENTS; i += 1) pts.push({ lat: south, lng: lerp(west, east, i / SEGMENTS) });
  for (let i = 0; i < SEGMENTS; i += 1) pts.push({ lat: lerp(south, north, i / SEGMENTS), lng: east });
  for (let i = 0; i < SEGMENTS; i += 1) pts.push({ lat: north, lng: lerp(east, west, i / SEGMENTS) });
  for (let i = 0; i < SEGMENTS; i += 1) pts.push({ lat: lerp(north, south, i / SEGMENTS), lng: west });
  return pts; // open ring
};
/** Food / QC / medical zones: [{ latitude, longitude }], open ring (as the admin API stores it). */
const latLngRing = () => indiaRing().map((p) => ({ latitude: p.lat, longitude: p.lng }));
/** Taxi zone: GeoJSON Polygon, [lng, lat], closed ring (as normalizeZoneCoordinates builds it). */
const geoJsonPolygon = () => {
  const ring = indiaRing().map((p) => [p.lng, p.lat]);
  ring.push([...ring[0]]);
  return { type: 'Polygon', coordinates: [ring] };
};

/** Small offsets so the demo pins do not sit on top of each other. */
const near = (northKm, eastKm) => ({
  lat: Number((BHOPAL.lat + northKm / 111).toFixed(6)),
  lng: Number((BHOPAL.lng + eastKm / (111 * Math.cos((BHOPAL.lat * Math.PI) / 180))).toFixed(6)),
});
const point = ({ lat, lng }) => ({ type: 'Point', coordinates: [lng, lat] });
const sellerLocation = (at) => ({
  type: 'Point',
  coordinates: [at.lng, at.lat],
  latitude: at.lat,
  longitude: at.lng,
  formattedAddress: `${ADDRESS.addressLine1}, ${ADDRESS.city}, ${ADDRESS.state} ${ADDRESS.pincode}`,
  address: `${ADDRESS.addressLine1}, ${ADDRESS.city}`,
  ...ADDRESS,
});
const hasCoords = (loc) =>
  Array.isArray(loc?.coordinates) && loc.coordinates.length === 2
  && !(Number(loc.coordinates[0]) === 0 && Number(loc.coordinates[1]) === 0);

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const slugify = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactName = (name) => new RegExp(`^\\s*${escapeRegex(name)}\\s*$`, 'i');

// ─────────────────────────────────────────────────────────────── catalogue ──

const FOOD_CATEGORIES = [
  ['North Indian', 'Both'],
  ['South Indian', 'Both'],
  ['Chinese', 'Both'],
  ['Pizza', 'Both'],
  ['Biryani', 'Both'],
  ['Desserts', 'Veg'],
  ['Beverages', 'Veg'],
  ['Tiffin / Thali', 'Both'],
];

/** A few dishes so the demo kitchen can actually be ordered from. [name, category, price, foodType, description] */
const DEMO_DISHES = [
  ['Paneer Butter Masala', 'North Indian', 249, 'Veg', 'Cottage cheese in a rich tomato and butter gravy.'],
  ['Masala Dosa', 'South Indian', 129, 'Veg', 'Crisp dosa with spiced potato, sambar and chutney.'],
  ['Veg Hakka Noodles', 'Chinese', 169, 'Veg', 'Wok-tossed noodles with vegetables.'],
  ['Margherita Pizza', 'Pizza', 199, 'Veg', 'Classic tomato, mozzarella and basil.'],
  ['Chicken Dum Biryani', 'Biryani', 299, 'Non-Veg', 'Slow-cooked basmati rice with chicken and whole spices.'],
  ['Gulab Jamun (2 pcs)', 'Desserts', 79, 'Veg', 'Warm milk dumplings in sugar syrup.'],
  ['Masala Chai', 'Beverages', 39, 'Veg', 'Spiced Indian tea.'],
  ['Veg Thali', 'Tiffin / Thali', 199, 'Veg', 'Dal, two sabzis, rice, rotis, salad and sweet.'],
];

const QC_CATEGORIES = [
  'Fruits & Vegetables',
  'Dairy & Bread',
  'Snacks',
  'Beverages',
  'Staples',
  'Personal Care',
];

/** Taxi ride types with INR fares for the India zone. */
const TAXI_VEHICLES = [
  // name, icon_types, capacity, description, fare
  { name: 'Bike', icon: 'bike', capacity: 1, short: 'Quick solo rides', fare: { base: 25, baseKm: 2, perKm: 8, perMin: 1, waiting: 1 } },
  { name: 'Auto', icon: 'auto', capacity: 3, short: 'Everyday auto rickshaw', fare: { base: 35, baseKm: 2, perKm: 12, perMin: 1.5, waiting: 1.5 } },
  { name: 'Cab Mini', icon: 'car', capacity: 4, short: 'Compact hatchback', fare: { base: 60, baseKm: 3, perKm: 14, perMin: 2, waiting: 2 } },
  { name: 'Cab Sedan', icon: 'car', capacity: 4, short: 'Comfortable sedan', fare: { base: 80, baseKm: 3, perKm: 16, perMin: 2, waiting: 2 } },
  { name: 'Cab SUV', icon: 'suv', capacity: 6, short: 'Room for six', fare: { base: 110, baseKm: 3, perKm: 20, perMin: 2.5, waiting: 3 } },
];
const DRIVER_VEHICLE = 'Cab Sedan';

/** Service-provider catalogue (rupees, GST added by the booking flow). [title, price, unit, description] */
const SP_CATALOGUE = {
  Electrician: [
    ['Electrician Visit', 249, 'visit', 'Diagnosis with a written estimate.'],
    ['Switch / Socket Replacement', 149, 'point', 'Per switch or socket replaced.'],
    ['Ceiling Fan Installation', 249, '1 unit', 'Mounting and wiring.'],
    ['Light Fitting Installation', 199, 'point', 'Per light point.'],
  ],
  Plumber: [
    ['Plumber Visit', 249, 'visit', 'Leaks, taps and drainage diagnosis.'],
    ['Tap Repair', 199, '1 unit', 'Leak and washer replacement.'],
    ['Pipe Leak Fix', 349, 'point', 'Leak repair on exposed pipework.'],
    ['Flush Tank Repair', 399, '1 unit', 'Flush mechanism and inlet valve.'],
  ],
  Carpenter: [
    ['Carpenter Visit', 299, 'visit', 'Hinges, handles and minor repairs.'],
    ['Door Lock Replacement', 449, '1 unit', 'Lock removal and refitting.'],
    ['Furniture Assembly', 499, 'item', 'Flat-pack assembly per item.'],
    ['Hinge / Channel Repair', 199, 'item', 'Cabinet and drawer fixes.'],
  ],
  'AC Repair': [
    ['AC Service (Split)', 599, '1 unit', 'Filter, coil and drain cleaning with performance check.'],
    ['AC Gas Refill', 2499, '1 unit', 'Leak check, vacuuming and refrigerant top-up.'],
    ['AC Installation', 1499, '1 unit', 'Mounting, piping and test run. Materials extra.'],
    ['AC Not Cooling - Diagnosis', 299, 'visit', 'Technician visit and fault diagnosis.'],
  ],
  Cleaning: [
    ['Bathroom Deep Clean', 599, 'room', 'Descaling, scrubbing and sanitising.'],
    ['Kitchen Deep Clean', 899, 'room', 'Degreasing of surfaces and cabinets.'],
    ['Full Home Deep Clean', 2999, 'home', 'Whole-home clean for up to 2BHK.'],
    ['Sofa Shampooing', 499, 'seat', 'Per seat wet shampoo and vacuum.'],
  ],
  Painting: [
    ['Painting Consultation', 299, 'visit', 'Site visit, colour advice and estimate.'],
    ['Single Wall Painting', 1499, 'wall', 'Two coats on one wall, paint included.'],
    ['Room Painting', 4999, 'room', 'One room, walls and ceiling, paint included.'],
  ],
  'Appliance Repair': [
    ['Washing Machine Repair', 649, '1 unit', 'Drainage, drum and motor faults.'],
    ['Refrigerator Repair', 699, '1 unit', 'Cooling, compressor and thermostat faults.'],
    ['Microwave Repair', 599, '1 unit', 'Heating, magnetron and panel faults.'],
    ['Geyser Repair', 549, '1 unit', 'Heating element and thermostat faults.'],
  ],
  'Pest Control': [
    ['General Pest Control (1BHK)', 999, 'home', 'Spray treatment for common household pests.'],
    ['Cockroach Control', 799, 'home', 'Gel and spray treatment.'],
    ['Termite Treatment', 2499, 'home', 'Drill-fill-seal anti-termite treatment.'],
    ['Bed Bug Treatment', 1499, 'home', 'Two-visit bed bug treatment.'],
  ],
};
const SP_CATEGORY_TITLES = Object.keys(SP_CATALOGUE);

// ─────────────────────────────────────────────────────────────── machinery ──

const stats = new Map(); // collection -> { created, updated, unchanged, skipped }
const notes = [];
const bump = (coll, key) => {
  if (!stats.has(coll)) stats.set(coll, { created: 0, updated: 0, unchanged: 0, skipped: 0 });
  stats.get(coll)[key] += 1;
};
const log = (sym, coll, label, extra = '') =>
  console.log(`  ${sym} ${coll.padEnd(28)} ${label}${extra ? `  ${extra}` : ''}`);

/**
 * Find by `filter`; create from insert+enforce when missing, otherwise apply
 * `enforce` only. `fixup(doc, isNew)` may adjust the doc before saving.
 * `guard(existing)` returns a reason to leave an existing doc alone.
 * Dry run: validates instead of saving. Returns the (possibly unsaved) doc, or
 * null when skipped.
 */
async function upsert(Model, { label, filter, insert = {}, enforce = {}, fixup, guard }) {
  const coll = Model.collection.collectionName;
  let doc = await Model.findOne(filter);
  const isNew = !doc;

  if (!isNew && guard) {
    const reason = guard(doc);
    if (reason) {
      bump(coll, 'skipped');
      log('!', coll, label, `SKIPPED: ${reason}`);
      notes.push(`${coll} "${label}" skipped: ${reason}`);
      return null;
    }
  }

  if (isNew) doc = new Model({ ...insert, ...enforce });
  else if (Object.keys(enforce).length) doc.set(enforce);
  if (fixup) fixup(doc, isNew);

  if (!isNew && !doc.isModified()) {
    bump(coll, 'unchanged');
    log('=', coll, label, `(${doc._id})`);
    return doc;
  }

  const changed = isNew ? '' : `fields: ${doc.directModifiedPaths().join(', ')}`;
  if (APPLY) await doc.save();
  else await doc.validate();

  bump(coll, isNew ? 'created' : 'updated');
  log(isNew ? '+' : '~', coll, label, isNew ? `(${doc._id}${APPLY ? '' : ', not written'})` : changed);
  return doc;
}

/** For demo accounts: never take over a document that belongs to someone else. */
const sameName = (field, expected) => (existing) => {
  const actual = String(existing?.[field] || '').trim();
  return actual && actual.toLowerCase() !== expected.toLowerCase()
    ? `phone already belongs to "${actual}", not "${expected}"`
    : null;
};

const ensureApprovedAt = (field = 'approvedAt') => (doc) => {
  if (!doc[field]) doc[field] = new Date();
};

// ───────────────────────────────────────────────────────────────── seeding ──

async function seedZones() {
  console.log('\n[1] India zone for every vertical');
  const coords = latLngRing();

  const foodZone = await upsert(FoodZone, {
    label: ZONE_NAME,
    filter: { name: ZONE_NAME },
    insert: {
      name: ZONE_NAME,
      zoneName: ZONE_NAME,
      country: 'India',
      serviceLocation: ZONE_NAME,
      unit: 'kilometer',
      boundary_mode: 'polygon',
      coordinates: coords,
      isActive: true,
    },
  });

  const qcZone = await upsert(QCZone, {
    label: ZONE_NAME,
    filter: { name: ZONE_NAME },
    insert: {
      name: ZONE_NAME,
      zoneName: ZONE_NAME,
      country: 'India',
      serviceLocation: ZONE_NAME,
      unit: 'kilometer',
      coordinates: coords,
      isActive: true,
    },
  });

  // Medical zones keep the quick-commerce zone's _id where they can (the same
  // convention scripts/split-medical-zones.js uses), so a pharmacy's zoneId
  // resolves whichever of the two collections it is read against.
  const sameIdTaken = await MedicalZone.exists({ _id: qcZone._id });
  const medicalZone = await upsert(MedicalZone, {
    label: ZONE_NAME,
    filter: { name: ZONE_NAME },
    insert: {
      ...(sameIdTaken ? {} : { _id: qcZone._id }),
      name: ZONE_NAME,
      zoneName: ZONE_NAME,
      country: 'India',
      serviceLocation: ZONE_NAME,
      unit: 'kilometer',
      coordinates: coords,
      isActive: true,
    },
  });

  const serviceLocation = await upsert(ServiceLocation, {
    label: ZONE_NAME,
    filter: { name: ZONE_NAME },
    insert: {
      name: ZONE_NAME,
      service_location_name: ZONE_NAME,
      address: 'India',
      country: 'India',
      currency_name: 'Indian Rupee',
      currency_symbol: '₹',
      currency_code: 'INR',
      timezone: 'Asia/Kolkata',
      unit: 'km',
      latitude: BHOPAL.lat,
      longitude: BHOPAL.lng,
      location: point(BHOPAL),
      status: 'active',
      active: true,
    },
  });

  const taxiZone = await upsert(TaxiZone, {
    label: ZONE_NAME,
    filter: { name: ZONE_NAME },
    insert: {
      name: ZONE_NAME,
      service_location_id: serviceLocation._id,
      unit: 'km',
      active: true,
      status: 'active',
      boundary_mode: 'polygon',
      circle_center: { lat: null, lng: null },
      circle_radius_meters: null,
      ride_surge_enabled: false,
      geometry: geoJsonPolygon(),
    },
  });

  // The service-provider module has cities, not polygons: a category or brand
  // with no cityIds is offered in every city, so this is the default city label
  // the customer app falls back to.
  const existingDefault = await SPCity.findOne({ isDefault: true }).select('_id name').lean();
  const spCity = await upsert(SPCity, {
    label: ZONE_NAME,
    filter: { slug: 'india' },
    insert: {
      name: ZONE_NAME,
      slug: 'india',
      state: '',
      country: 'India',
      isActive: true,
      isDefault: !existingDefault,
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      displayOrder: 0,
    },
  });
  if (existingDefault && String(existingDefault._id) !== String(spCity._id)) {
    notes.push(`sp_cities: "${existingDefault.name}" stays the default city (India was not made default).`);
  }

  return { foodZone, qcZone, medicalZone, serviceLocation, taxiZone, spCity };
}

async function seedFoodCatalogue() {
  console.log('\n[2a] Food categories');
  const byName = new Map();
  for (const [index, [name, scope]] of FOOD_CATEGORIES.entries()) {
    const doc = await upsert(FoodCategory, {
      label: name,
      filter: { name: exactName(name), $or: [{ restaurantId: { $exists: false } }, { restaurantId: null }] },
      insert: {
        name,
        foodTypeScope: scope,
        approvalStatus: 'approved',
        isApproved: true,
        approvedAt: new Date(),
        isActive: true,
        sortOrder: index + 1,
      },
    });
    byName.set(name, doc);
  }
  return byName;
}

async function seedQcCatalogue() {
  console.log('\n[2b] Quick-commerce categories');
  for (const [index, name] of QC_CATEGORIES.entries()) {
    await upsert(QCCategory, {
      label: name,
      filter: {
        name: exactName(name),
        $or: [{ restaurantId: { $exists: false } }, { restaurantId: null }],
        $and: [{ $or: [{ parentId: { $exists: false } }, { parentId: null }] }],
      },
      insert: {
        name,
        foodTypeScope: 'Both',
        approvalStatus: 'approved',
        isApproved: true,
        approvedAt: new Date(),
        isActive: true,
        sortOrder: index + 1,
      },
    });
  }
}

async function seedTaxiCatalogue({ taxiZone, serviceLocation }) {
  console.log('\n[2c] Taxi ride types, India fares, home-screen module');
  const vehicles = new Map();
  for (const [index, v] of TAXI_VEHICLES.entries()) {
    const vehicle = await upsert(Vehicle, {
      label: v.name,
      filter: { name: exactName(v.name) },
      insert: {
        name: v.name,
        short_description: v.short,
        description: v.short,
        transport_type: 'taxi',
        is_taxi: 'taxi',
        dispatch_type: 'normal',
        icon_types: v.icon,
        capacity: v.capacity,
        status: 1,
        active: true,
      },
    });
    vehicles.set(v.name, vehicle);

    await upsert(SetPrice, {
      label: `${v.name} @ ${ZONE_NAME}  (₹${v.fare.base} for ${v.fare.baseKm} km, ₹${v.fare.perKm}/km, ₹${v.fare.perMin}/min)`,
      filter: { zone_id: taxiZone._id, vehicle_type: vehicle._id, transport_type: 'taxi', pricing_scope: 'ride' },
      insert: {
        zone_id: taxiZone._id,
        service_location_id: serviceLocation._id,
        pricing_scope: 'ride',
        transport_type: 'taxi',
        vehicle_type: vehicle._id,
        payment_type: ['cash', 'online'],
        base_price: v.fare.base,
        base_distance: v.fare.baseKm,
        price_per_distance: v.fare.perKm,
        time_price: v.fare.perMin,
        waiting_charge: v.fare.waiting,
        free_waiting_before: 3,
        free_waiting_after: 3,
        service_tax: 5,
        admin_commision_type: 1,
        admin_commision: 0,
        eta_sequence: index + 1,
        order_number: index + 1,
        status: 'active',
        active: 1,
      },
    });
  }

  // The rider app's home grid is built from these; with none, it shows no tiles.
  await upsert(TaxiAppModule, {
    label: 'Ride (normal)',
    filter: { transport_type: 'taxi', service_type: 'normal' },
    insert: {
      name: 'Ride',
      transport_type: 'taxi',
      service_type: 'normal',
      order_by: 1,
      short_description: 'Bike, auto and cabs',
      description: 'Book a bike, auto or cab across India.',
      mobile_menu_icon: '',
      active: 1,
    },
  });

  return vehicles;
}

async function seedSpCatalogue() {
  console.log('\n[2d] Service-provider categories, brands and bookable services');
  const categories = new Map();
  for (const [index, title] of SP_CATEGORY_TITLES.entries()) {
    const slug = slugify(title);
    const category = await upsert(SPCategory, {
      label: title,
      filter: { $or: [{ slug }, { title: exactName(title) }] },
      insert: {
        title,
        slug,
        description: `${title} services at home by verified professionals.`,
        status: 'active',
        showOnHome: true,
        homeOrder: index + 1,
        isPopular: index < 4,
        cityIds: [],
      },
    });
    categories.set(title, category);

    // Category -> Brand -> UserService, the shape sp-seed-services.cjs uses
    // and the booking flow reads (SPUserService.brandId is required).
    let brandSlug = slug;
    const slugOwner = await SPBrand.findOne({ slug: brandSlug }).select('categoryIds').lean();
    if (slugOwner && !(slugOwner.categoryIds || []).some((id) => String(id) === String(category._id))) {
      brandSlug = `${slug}-services`;
    }
    const brand = await upsert(SPBrand, {
      label: `${title} (brand)`,
      filter: { $or: [{ categoryIds: category._id }, { categoryId: category._id }] },
      insert: {
        title,
        slug: brandSlug,
        categoryIds: [category._id],
        categoryId: category._id,
        cityIds: [],
        status: 'active',
      },
    });

    for (const [svcTitle, price, unit, description] of SP_CATALOGUE[title]) {
      await upsert(SPUserService, {
        label: `${title} / ${svcTitle}`,
        filter: { brandId: brand._id, title: svcTitle },
        insert: {
          brandId: brand._id,
          categoryId: category._id,
          title: svcTitle,
          basePrice: price,
          gstPercentage: 18,
          pricingUnit: unit,
          description,
          status: 'active',
        },
      });
    }
  }
  return categories;
}

async function seedAccounts(zones, { foodCategories, vehicles }) {
  console.log('\n[3] Demo accounts (OTP 1234 while mock OTP is on)');
  const { foodZone, qcZone, medicalZone, taxiZone, serviceLocation } = zones;
  const accounts = [];

  // ── customer: platform identity + the vertical satellites that link to it ──
  const customerName = 'KSG Demo Customer';
  const customer = await upsert(FoodUser, {
    label: `${customerName} (${PHONES.customer})`,
    filter: { phone: new RegExp(`${PHONES.customer}$`) },
    guard: sameName('name', customerName),
    insert: {
      phone: PHONES.customer,
      countryCode: '+91',
      name: customerName,
      email: 'ksg.demo.customer@example.com',
      role: 'USER',
      addresses: [{
        label: 'Home',
        street: ADDRESS.addressLine1,
        additionalDetails: ADDRESS.area,
        city: ADDRESS.city,
        state: ADDRESS.state,
        zipCode: ADDRESS.pincode,
        phone: PHONES.customer,
        location: point(near(0.5, 0.5)),
        isDefault: true,
      }],
    },
    enforce: { isVerified: true, isActive: true },
  });
  if (customer) {
    await upsert(QCUser, {
      label: `${customerName} (${PHONES.customer})`,
      filter: { phone: new RegExp(`${PHONES.customer}$`) },
      guard: sameName('name', customerName),
      insert: { phone: PHONES.customer, countryCode: '+91', name: customerName, role: 'USER' },
      enforce: { platformUserId: customer._id, isVerified: true, isActive: true },
    });
    await upsert(SPUser, {
      label: `${customerName} (${PHONES.customer})`,
      filter: { phone: PHONES.customer },
      guard: sameName('name', customerName),
      insert: { phone: PHONES.customer, name: customerName },
      enforce: { platformUserId: customer._id, isPhoneVerified: true, isActive: true },
    });
  }
  accounts.push(['Customer (food, grocery, medical, taxi, home services)', PHONES.customer,
    'Food/Quick/Medical: /food/user/auth/login   Taxi: /taxi/user/login   Home services: SP customer app (API /api/v1/sp/users/auth/...)']);

  // ── restaurant ──
  const restaurantName = 'KSG Demo Kitchen';
  const kitchenAt = near(0, 0);
  const restaurant = await upsert(FoodRestaurant, {
    label: `${restaurantName} (${PHONES.restaurant})`,
    filter: { $or: [{ ownerPhone: PHONES.restaurant }, { primaryContactNumber: PHONES.restaurant }] },
    guard: sameName('restaurantName', restaurantName),
    insert: {
      restaurantName,
      ownerName: 'KSG Demo Kitchen Owner',
      ownerEmail: 'ksg.demo.kitchen@example.com',
      ownerPhone: PHONES.restaurant,
      primaryContactNumber: PHONES.restaurant,
      pureVegRestaurant: false,
      cuisines: ['North Indian', 'South Indian', 'Biryani'],
      ...ADDRESS,
      openingTime: OPEN,
      closingTime: CLOSE,
      openDays: ALL_DAYS,
      estimatedDeliveryTime: '25-30 mins',
      profileImage: DEMO_IMAGE,
      coverImage: DEMO_IMAGE,
      location: sellerLocation(kitchenAt),
    },
    enforce: { status: 'approved', isAcceptingOrders: true, zoneId: foodZone._id },
    fixup: (doc) => {
      ensureApprovedAt()(doc);
      if (doc.rejectionReason) doc.rejectionReason = '';
      if (!hasCoords(doc.location)) doc.location = sellerLocation(kitchenAt);
    },
  });
  if (restaurant) {
    for (const [name, categoryName, price, foodType, description] of DEMO_DISHES) {
      const category = foodCategories.get(categoryName);
      await upsert(FoodItem, {
        label: `${restaurantName} / ${name}`,
        filter: { restaurantId: restaurant._id, name },
        insert: {
          restaurantId: restaurant._id,
          categoryId: category?._id,
          categoryName,
          name,
          description,
          price,
          foodType,
          isActive: true,
          isAvailable: true,
          approvalStatus: 'approved',
          approvedAt: new Date(),
          preparationTime: '15-20 mins',
        },
      });
    }
  }
  accounts.push(['Restaurant owner (KSG Demo Kitchen)', PHONES.restaurant, '/food/restaurant/login']);

  // ── food delivery partner ──
  const riderName = 'KSG Demo Delivery Partner';
  const riderAt = near(-0.6, 0.4);
  await upsert(FoodDeliveryPartner, {
    label: `${riderName} (${PHONES.foodDelivery})`,
    filter: { phone: PHONES.foodDelivery },
    guard: sameName('name', riderName),
    insert: {
      name: riderName,
      phone: PHONES.foodDelivery,
      countryCode: '+91',
      address: `${ADDRESS.addressLine1}, ${ADDRESS.city}`,
      city: ADDRESS.city,
      state: ADDRESS.state,
      vehicleType: 'bike',
      vehicleName: 'Bike',
      availabilityStatus: 'offline',
      lastLocation: point(riderAt),
      lastLat: riderAt.lat,
      lastLng: riderAt.lng,
    },
    enforce: { status: 'approved' },
    fixup: (doc) => {
      ensureApprovedAt()(doc);
      if (doc.rejectionReason) doc.rejectionReason = '';
      if (!(doc.zoneIds || []).some((id) => String(id) === String(foodZone._id))) {
        doc.zoneIds = [...(doc.zoneIds || []), foodZone._id];
      }
    },
  });
  accounts.push(['Food delivery partner', PHONES.foodDelivery, '/food/delivery/login']);

  // ── taxi driver ──
  const driverName = 'KSG Demo Driver';
  const sedan = vehicles.get(DRIVER_VEHICLE);
  const driverAt = near(1.0, -0.8);
  await upsert(Driver, {
    label: `${driverName} (${PHONES.taxiDriver}, ${DRIVER_VEHICLE})`,
    filter: { phone: new RegExp(`${PHONES.taxiDriver}$`) },
    guard: sameName('name', driverName),
    insert: {
      name: driverName,
      phone: PHONES.taxiDriver,
      // Required by the schema; login is by OTP, so a random secret nobody knows.
      password: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
      vehicleType: 'car', // what onboarding derives for a non-bike, non-auto vehicle
      vehicleTypeId: sedan._id,
      vehicleIconType: 'car',
      vehicleMake: 'Maruti Suzuki',
      vehicleModel: 'Dzire',
      vehicleNumber: 'MP04-DEMO-0004',
      vehicleColor: 'White',
      registerFor: 'taxi',
      serviceCapabilities: ['taxi'],
      workMode: 'all',
      city: ADDRESS.city,
      location: point(driverAt),
    },
    enforce: {
      approve: true,
      status: 'approved',
      deletedAt: null,
      zoneId: taxiZone._id,
      service_location_id: serviceLocation._id,
    },
    fixup: (doc) => {
      if (!doc.vehicleTypeId) doc.vehicleTypeId = sedan._id;
    },
  });
  accounts.push(['Taxi driver (Cab Sedan)', PHONES.taxiDriver, '/taxi/driver/login']);

  // ── grocery store (quick-commerce seller) ──
  const groceryName = 'KSG Demo Grocery';
  const groceryAt = near(0.8, 0.9);
  await upsert(QCRestaurant, {
    label: `${groceryName} (${PHONES.grocery})`,
    filter: { $or: [{ ownerPhone: PHONES.grocery }, { primaryContactNumber: PHONES.grocery }] },
    guard: sameName('restaurantName', groceryName),
    insert: {
      restaurantName: groceryName,
      ownerName: 'KSG Demo Grocery Owner',
      ownerEmail: 'ksg.demo.grocery@example.com',
      ownerPhone: PHONES.grocery,
      primaryContactNumber: PHONES.grocery,
      pureVegRestaurant: false,
      storeType: 'grocery',
      storageCapability: ['chilled'],
      ...ADDRESS,
      openingTime: OPEN,
      closingTime: CLOSE,
      openDays: ALL_DAYS,
      estimatedDeliveryTime: '10-15 mins',
      autoAcceptOrders: false,
      outsideHoursOverride: false,
      profileImage: DEMO_IMAGE,
      storePhotos: { front: DEMO_IMAGE },
      location: sellerLocation(groceryAt),
    },
    enforce: { status: 'approved', isAcceptingOrders: true, zoneId: qcZone._id },
    fixup: (doc) => {
      ensureApprovedAt()(doc);
      if (doc.rejectionReason) doc.rejectionReason = '';
      if (!hasCoords(doc.location)) doc.location = sellerLocation(groceryAt);
    },
  });
  accounts.push(['Grocery store (quick commerce)', PHONES.grocery, '/partner/login/store']);

  // ── medical store (quick-commerce seller, storeType pharmacy) ──
  const pharmacyName = 'KSG Demo Pharmacy';
  const pharmacyAt = near(-1.0, -0.7);
  const licenceExpiry = () => new Date(Date.now() + 3 * YEAR_MS);
  await upsert(QCRestaurant, {
    label: `${pharmacyName} (${PHONES.medical})`,
    filter: { $or: [{ ownerPhone: PHONES.medical }, { primaryContactNumber: PHONES.medical }] },
    guard: sameName('restaurantName', pharmacyName),
    insert: {
      restaurantName: pharmacyName,
      ownerName: 'KSG Demo Pharmacy Owner',
      ownerEmail: 'ksg.demo.pharmacy@example.com',
      ownerPhone: PHONES.medical,
      primaryContactNumber: PHONES.medical,
      pureVegRestaurant: false,
      storeType: 'pharmacy',
      // Placeholders, clearly not real: a pharmacy with no licence is hidden
      // from the medical flow, and an expired one is filtered out.
      drugLicenseNumber: 'DEMO-DL-KSG-0006',
      drugLicenseImage: DEMO_DOC,
      drugLicenseExpiry: licenceExpiry(),
      ...ADDRESS,
      openingTime: OPEN,
      closingTime: CLOSE,
      openDays: ALL_DAYS,
      estimatedDeliveryTime: '15-25 mins',
      estimatedDeliveryTimeMinutes: 15,
      autoAcceptOrders: false,
      outsideHoursOverride: false,
      profileImage: DEMO_IMAGE,
      storePhotos: { front: DEMO_IMAGE },
      location: sellerLocation(pharmacyAt),
    },
    enforce: { status: 'approved', isAcceptingOrders: true, storeType: 'pharmacy', zoneId: medicalZone._id },
    fixup: (doc) => {
      ensureApprovedAt()(doc);
      if (doc.rejectionReason) doc.rejectionReason = '';
      if (!hasCoords(doc.location)) doc.location = sellerLocation(pharmacyAt);
      if (!doc.drugLicenseNumber) doc.drugLicenseNumber = 'DEMO-DL-KSG-0006';
      if (!doc.drugLicenseImage) doc.drugLicenseImage = DEMO_DOC;
      const expiry = doc.drugLicenseExpiry ? new Date(doc.drugLicenseExpiry) : null;
      if (!expiry || expiry.getTime() <= Date.now()) doc.drugLicenseExpiry = licenceExpiry();
    },
  });
  accounts.push(['Medical store (pharmacy)', PHONES.medical, '/partner/login/medical']);

  // ── service-provider vendor + worker ──
  const vendorName = 'KSG Demo Home Services';
  const vendorAt = near(0.3, -1.2);
  const spAddress = {
    fullAddress: `${ADDRESS.addressLine1}, ${ADDRESS.city}, ${ADDRESS.state} ${ADDRESS.pincode}`,
    addressLine1: ADDRESS.addressLine1,
    city: ADDRESS.city,
    state: ADDRESS.state,
    pincode: ADDRESS.pincode,
  };
  const vendor = await upsert(SPVendor, {
    label: `${vendorName} (${PHONES.spVendor})`,
    filter: { phone: PHONES.spVendor },
    guard: sameName('name', vendorName),
    insert: {
      name: vendorName,
      email: 'ksg.demo.vendor@example.com',
      phone: PHONES.spVendor,
      businessName: vendorName,
      service: SP_CATEGORY_TITLES,
      categories: SP_CATEGORY_TITLES,
      // Required by the schema. Placeholders, labelled as such; not real IDs.
      aadhar: { number: DEMO_ID, document: DEMO_DOC, backDocument: DEMO_DOC },
      pan: { number: DEMO_ID, document: DEMO_DOC },
      address: { ...spAddress, lat: vendorAt.lat, lng: vendorAt.lng },
      location: { lat: vendorAt.lat, lng: vendorAt.lng, updatedAt: new Date() },
      geoLocation: point(vendorAt),
    },
    enforce: { approvalStatus: 'approved', isActive: true, isPhoneVerified: true },
    fixup: ensureApprovedAt('approvalDate'),
  });
  accounts.push(['Home-services vendor', PHONES.spVendor, 'SP vendor app /vendor/login (API /api/v1/sp/vendors/auth/login)']);

  const workerName = 'KSG Demo Technician';
  const workerAt = near(0.2, -1.0);
  await upsert(SPWorker, {
    label: `${workerName} (${PHONES.spWorker})`,
    filter: { phone: PHONES.spWorker },
    guard: sameName('name', workerName),
    insert: {
      name: workerName,
      phone: PHONES.spWorker,
      serviceCategories: SP_CATEGORY_TITLES,
      address: { addressLine1: ADDRESS.addressLine1, city: ADDRESS.city, state: ADDRESS.state, pincode: ADDRESS.pincode },
      location: { lat: workerAt.lat, lng: workerAt.lng, updatedAt: new Date() },
      geoLocation: point(workerAt),
    },
    enforce: {
      approvalStatus: 'approved',
      isActive: true,
      isPhoneVerified: true,
      ...(vendor ? { vendorId: vendor._id } : {}),
    },
    fixup: (doc) => {
      // Worker dispatch only offers jobs to workers with a live subscription.
      // A demo year, no plan attached.
      const expiry = doc.subscription?.expiryDate ? new Date(doc.subscription.expiryDate) : null;
      if (!doc.subscription?.isActive || !expiry || expiry.getTime() <= Date.now()) {
        doc.set('subscription.isActive', true);
        doc.set('subscription.startDate', new Date());
        doc.set('subscription.expiryDate', new Date(Date.now() + YEAR_MS));
      }
    },
  });
  accounts.push(['Home-services worker', PHONES.spWorker, 'SP worker app /worker/login (API /api/v1/sp/workers/auth/login)']);

  // ── quick-commerce delivery partner ──
  const qcRiderName = 'KSG Demo Grocery Rider';
  const qcRiderAt = near(0.6, 0.7);
  await upsert(QCDeliveryPartner, {
    label: `${qcRiderName} (${PHONES.qcDelivery})`,
    filter: { phone: PHONES.qcDelivery },
    guard: sameName('name', qcRiderName),
    insert: {
      name: qcRiderName,
      phone: PHONES.qcDelivery,
      countryCode: '+91',
      address: `${ADDRESS.addressLine1}, ${ADDRESS.city}`,
      city: ADDRESS.city,
      state: ADDRESS.state,
      vehicleType: 'bike',
      vehicleName: 'Bike',
      availabilityStatus: 'offline',
      lastLocation: point(qcRiderAt),
      lastLat: qcRiderAt.lat,
      lastLng: qcRiderAt.lng,
    },
    enforce: { status: 'approved' },
    fixup: (doc) => {
      ensureApprovedAt()(doc);
      if (doc.rejectionReason) doc.rejectionReason = '';
      if (!(doc.zoneIds || []).some((id) => String(id) === String(qcZone._id))) {
        doc.zoneIds = [...(doc.zoneIds || []), qcZone._id];
      }
    },
  });
  accounts.push(['Quick-commerce delivery partner', PHONES.qcDelivery, 'QC delivery API /api/v1/qc/auth (no QC rider screen in this repo)']);

  return accounts;
}

// ─────────────────────────────────────────────────────────────────── main ──

const run = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI / MONGO_URI in environment.');
  if (process.env.MONGODB_URI && process.env.MONGO_URI && process.env.MONGODB_URI !== process.env.MONGO_URI) {
    // The API server reads MONGO_URI first; this script reads MONGODB_URI first.
    console.warn('WARNING: MONGODB_URI and MONGO_URI differ. This script uses MONGODB_URI; the API server uses MONGO_URI.');
  }
  await mongoose.connect(uri);
  console.log(`db: ${mongoose.connection.db.databaseName}   mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (nothing is written)'}`);
  console.log('legend: + create   ~ update   = unchanged   ! skipped');

  const zones = await seedZones();
  const foodCategories = await seedFoodCatalogue();
  await seedQcCatalogue();
  const vehicles = await seedTaxiCatalogue(zones);
  await seedSpCatalogue();
  const accounts = await seedAccounts(zones, { foodCategories, vehicles });

  // ── summary ──
  const pending = APPLY ? '' : ' (dry run: id it would be created with)';
  console.log('\n================ SUMMARY ================');
  console.log(`Zone ids${pending}:`);
  console.log(`  food_zones            ${zones.foodZone._id}`);
  console.log(`  qc_zones              ${zones.qcZone._id}`);
  console.log(`  medical_zones         ${zones.medicalZone._id}`);
  console.log(`  taxi service location ${zones.serviceLocation._id}`);
  console.log(`  taxi zone             ${zones.taxiZone._id}`);
  console.log(`  sp_cities             ${zones.spCity._id}`);

  console.log('\nPer collection:');
  console.log(`  ${'collection'.padEnd(30)} created  updated  unchanged  skipped`);
  for (const [coll, s] of stats) {
    console.log(`  ${coll.padEnd(30)} ${String(s.created).padStart(7)}  ${String(s.updated).padStart(7)}  ${String(s.unchanged).padStart(9)}  ${String(s.skipped).padStart(7)}`);
  }

  console.log('\nDemo logins (OTP 1234 while mock OTP is on):');
  for (const [role, phone, where] of accounts) {
    console.log(`  ${phone}  ${role.padEnd(56)} ${where}`);
  }

  if (notes.length) {
    console.log('\nNotes:');
    for (const note of notes) console.log(`  - ${note}`);
  }

  console.log('\nNext:');
  console.log('  node scripts/seed-legal-pages.mjs --apply');
  console.log('  node scripts/sp-seed-services.cjs --apply   (fills only SP categories that still have no services)');
  if (!APPLY) console.log('\nDRY RUN: nothing was written. Re-run with --apply.');
};

run()
  .catch((err) => {
    console.error('seed-ksg failed:', err?.message || err);
    if (err?.errors) {
      for (const [path, e] of Object.entries(err.errors)) console.error(`  ${path}: ${e.message}`);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
