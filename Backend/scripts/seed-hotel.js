/**
 * Hotel demo seed (HOTEL_INTEGRATION_PLAN.md §10, without bookings/reviews — those
 * need the booking phase): one approved demo hotel partner and three approved, live
 * properties in Bhopal with room types, verified documents and 365 nights of
 * inventory.
 *
 *   node scripts/seed-hotel.js            # dry run (default): reads, validates, prints the plan
 *   node scripts/seed-hotel.js --apply    # writes
 *
 * Safety (same rules as seed-ksg.js):
 *  - Dry run by default; new documents are still validated through Mongoose.
 *  - Idempotent: partner by phone, property by slug, room type by (property, name),
 *    documents by property. Re-running is safe.
 *  - Additive only: nothing is deleted. Existing demo rows only get the flags that
 *    make them usable re-asserted (approved / live / verified); prices, photos and
 *    text an admin or partner edited are left alone.
 *  - The demo phone may already exist as a `pending` partner (somebody tried the OTP
 *    login): it is approved. If it belongs to a partner with a DIFFERENT, non-empty
 *    name, it is skipped with a warning so this never approves a real application.
 *
 * Demo login: 9000000010 with the mock OTP (1234) while mock OTP is enabled.
 * Hotel settings-registry keys (§3.9) are not seeded: the registry has no hotel keys
 * yet (they arrive with the booking phase).
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { HotelPartner } from '../src/modules/hotel/models/hotelPartner.model.js';
import { HotelProperty } from '../src/modules/hotel/models/hotelProperty.model.js';
import { HotelRoomType } from '../src/modules/hotel/models/hotelRoomType.model.js';
import { HotelPropertyDocument } from '../src/modules/hotel/models/hotelPropertyDocument.model.js';
import { HotelInventoryDay } from '../src/modules/hotel/models/hotelInventoryDay.model.js';
import { backfillInventory, BACKFILL_DAYS, todayIST, toNightDate, addDays } from '../src/modules/hotel/services/inventory.service.js';
import { refreshPropertyPrices, resolveZoneId } from '../src/modules/hotel/services/property.service.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');

// ─────────────────────────────────────────────────────────────── constants ──

const PARTNER = {
  phone: '9000000010',
  name: 'KSG Demo Hotel Partner',
  email: 'hotel.demo@ksg.test',
  kyc: {
    ownerName: 'KSG Demo Owner (DEMO DATA)',
    aadhaarNumberMasked: 'XXXXXXXX0010',
    panNumber: 'AAAPD0010D', // demo placeholder, not a real PAN
  },
  bank: { accountHolder: 'KSG Demo Owner', accountNumberMasked: 'XXXXXX0010', ifsc: 'SBIN0000001', bankName: 'Demo Bank' },
  address: { line: 'MP Nagar Zone 1', city: 'Bhopal', state: 'Madhya Pradesh', pincode: '462011' },
};

const photo = (text) => `https://placehold.co/1200x800?text=${encodeURIComponent(text).replace(/%20/g, '+')}`;
const photos = (name, n) => Array.from({ length: n }, (_, i) => photo(`${name} ${i + 1}`));

const PROPERTIES = [
  {
    slug: 'ksg-demo-hotel-bhopal',
    name: 'KSG Demo Hotel',
    propertyType: 'hotel',
    typeDetails: { hotelCategory: 'premium', starRating: 4 },
    suitability: 'both',
    shortDescription: 'Business hotel in MP Nagar, minutes from DB Mall.',
    description: 'A comfortable city hotel in the heart of Bhopal with a rooftop restaurant, '
      + 'free Wi-Fi and 24x7 front desk. DEMO LISTING.',
    contactNumber: '9000000010',
    address: { line1: 'Plot 12, Zone 1', area: 'MP Nagar', city: 'Bhopal', state: 'Madhya Pradesh', pincode: '462011', country: 'India' },
    location: { lat: 23.2332, lng: 77.4343 },
    nearbyPlaces: [{ name: 'DB City Mall', type: 'mall', distanceKm: 1.2 }, { name: 'Bhopal Junction', type: 'railway', distanceKm: 5 }],
    amenities: ['wifi', 'ac', 'parking', 'restaurant', 'room_service', 'power_backup', 'lift', 'cctv', 'housekeeping', 'tv', 'front_desk_24x7'],
    houseRules: ['Valid photo ID required at check-in', 'No smoking in rooms'],
    cancellationPolicy: { type: 'moderate', freeCancelHours: 24, refundPercentAfter: 50 },
    roomTypes: [
      { name: 'Standard Room', inventoryType: 'room', roomCategory: 'private', baseAdults: 2, maxAdults: 2, maxChildren: 1, totalInventory: 10, pricePerNight: 1899, originalPrice: 2499, weekendPrice: 2199, extraChildPrice: 300, mealPlan: 'room_only', amenities: ['wifi', 'ac', 'tv'] },
      { name: 'Deluxe Room', inventoryType: 'room', roomCategory: 'private', baseAdults: 2, maxAdults: 3, maxChildren: 1, totalInventory: 6, pricePerNight: 2799, originalPrice: 3499, weekendPrice: 3199, extraAdultPrice: 600, extraChildPrice: 300, mealPlan: 'breakfast', amenities: ['wifi', 'ac', 'tv', 'breakfast'] },
      { name: 'Executive Suite', inventoryType: 'room', roomCategory: 'private', baseAdults: 2, maxAdults: 4, maxChildren: 2, totalInventory: 2, pricePerNight: 4999, originalPrice: 5999, extraAdultPrice: 800, extraChildPrice: 400, mealPlan: 'breakfast', amenities: ['wifi', 'ac', 'tv', 'breakfast', 'room_service'] },
    ],
    documents: [{ type: 'trade_license', name: 'Trade licence (demo)', fileUrl: photo('Demo trade licence') }],
  },
  {
    slug: 'ksg-demo-resort-bhopal',
    name: 'KSG Demo Resort',
    propertyType: 'resort',
    typeDetails: { resortType: 'hill', starRating: 4 },
    suitability: 'family_friendly',
    shortDescription: 'Lakeside resort by the Upper Lake with a pool and lawns.',
    description: 'Cottages and lake-view rooms near Van Vihar, with a pool, spa and '
      + 'evening boating nearby. DEMO LISTING.',
    contactNumber: '9000000010',
    address: { line1: 'Lake View Road', area: 'Shyamla Hills', city: 'Bhopal', state: 'Madhya Pradesh', pincode: '462013', country: 'India' },
    location: { lat: 23.2486, lng: 77.3787 },
    nearbyPlaces: [{ name: 'Upper Lake (Bhojtal)', type: 'lake', distanceKm: 0.4 }, { name: 'Van Vihar National Park', type: 'park', distanceKm: 1.5 }],
    amenities: ['wifi', 'ac', 'parking', 'restaurant', 'pool', 'spa', 'gym', 'power_backup', 'cctv', 'housekeeping', 'breakfast', 'front_desk_24x7'],
    houseRules: ['Pool open 7am-8pm', 'Outside food not allowed'],
    cancellationPolicy: { type: 'strict', freeCancelHours: 72, refundPercentAfter: 0 },
    checkInTime: '14:00',
    checkOutTime: '11:00',
    roomTypes: [
      { name: 'Lake View Room', inventoryType: 'room', roomCategory: 'private', baseAdults: 2, maxAdults: 3, maxChildren: 2, totalInventory: 8, pricePerNight: 4499, originalPrice: 5499, weekendPrice: 5299, extraAdultPrice: 900, extraChildPrice: 500, mealPlan: 'breakfast', amenities: ['wifi', 'ac', 'tv', 'breakfast'] },
      { name: 'Garden Cottage', inventoryType: 'room', roomCategory: 'private', baseAdults: 2, maxAdults: 4, maxChildren: 2, totalInventory: 4, pricePerNight: 6499, originalPrice: 7999, weekendPrice: 7499, extraAdultPrice: 1000, extraChildPrice: 500, mealPlan: 'half_board', amenities: ['wifi', 'ac', 'tv', 'breakfast'] },
    ],
    documents: [
      { type: 'trade_license', name: 'Trade licence (demo)', fileUrl: photo('Demo trade licence') },
      { type: 'fire_noc', name: 'Fire NOC (demo)', fileUrl: photo('Demo fire NOC') },
    ],
  },
  {
    slug: 'ksg-demo-homestay-bhopal',
    name: 'KSG Demo Homestay',
    propertyType: 'homestay',
    typeDetails: { hostLivesOnProperty: true },
    suitability: 'couple_friendly',
    shortDescription: 'Quiet family-run homestay in Arera Colony with home-cooked meals.',
    description: 'Two cosy rooms in a green neighbourhood, hosted by a local family. '
      + 'Kitchen access and home-cooked breakfast. DEMO LISTING.',
    contactNumber: '9000000010',
    address: { line1: 'E-4, Arera Colony', area: 'Arera Colony', city: 'Bhopal', state: 'Madhya Pradesh', pincode: '462016', country: 'India' },
    location: { lat: 23.2105, lng: 77.4344 },
    nearbyPlaces: [{ name: 'Shaurya Smarak', type: 'landmark', distanceKm: 3 }],
    amenities: ['wifi', 'ac', 'parking', 'kitchen', 'geyser', 'breakfast', 'pet_friendly'],
    houseRules: ['Quiet hours after 10pm', 'Pets allowed on request'],
    cancellationPolicy: { type: 'flexible', freeCancelHours: 24, refundPercentAfter: 50 },
    roomTypes: [
      { name: 'Cosy Double Room', inventoryType: 'room', roomCategory: 'private', baseAdults: 2, maxAdults: 2, maxChildren: 1, totalInventory: 2, pricePerNight: 1299, originalPrice: 1599, weekendPrice: 1499, extraChildPrice: 200, mealPlan: 'breakfast', amenities: ['wifi', 'ac', 'geyser'] },
      { name: 'Entire Home', inventoryType: 'entire', roomCategory: 'entire', baseAdults: 4, maxAdults: 6, maxChildren: 3, totalInventory: 1, pricePerNight: 3999, originalPrice: 4799, weekendPrice: 4499, extraAdultPrice: 500, mealPlan: 'room_only', amenities: ['wifi', 'ac', 'kitchen', 'geyser'] },
    ],
    documents: [{ type: 'electricity_bill', name: 'Electricity bill (demo)', fileUrl: photo('Demo electricity bill') }],
  },
];

// ───────────────────────────────────────────────────────────────── helpers ──

const stats = new Map();
const notes = [];
const bump = (coll, key) => {
  if (!stats.has(coll)) stats.set(coll, { created: 0, updated: 0, unchanged: 0, skipped: 0 });
  stats.get(coll)[key] += 1;
};
const log = (sym, coll, label, extra = '') =>
  console.log(`  ${sym} ${coll.padEnd(28)} ${label}${extra ? `  ${extra}` : ''}`);

/** Same contract as seed-ksg.js upsert(). */
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

const DEMO_NAMES = [PARTNER.name.toLowerCase()];
const partnerGuard = (existing) => {
  const actual = String(existing?.name || '').trim();
  if (existing?.isDeleted) return 'partner is deleted';
  return actual && !DEMO_NAMES.includes(actual.toLowerCase())
    ? `phone already belongs to "${actual}", not "${PARTNER.name}"`
    : null;
};

// ───────────────────────────────────────────────────────────────── seeding ──

async function seedPartner() {
  console.log('\n[1] demo hotel partner');
  return upsert(HotelPartner, {
    label: `${PARTNER.name} (${PARTNER.phone})`,
    filter: { phone: PARTNER.phone },
    insert: { phone: PARTNER.phone, kyc: PARTNER.kyc, bank: PARTNER.bank, address: PARTNER.address, email: PARTNER.email },
    enforce: { status: 'approved', rejectionReason: '' },
    guard: partnerGuard,
    fixup: (doc) => {
      if (!doc.name) doc.name = PARTNER.name;
      if (!doc.kyc?.ownerName) doc.set('kyc.ownerName', PARTNER.kyc.ownerName);
      if (!doc.kyc?.panNumber) doc.set('kyc.panNumber', PARTNER.kyc.panNumber);
      if (!doc.termsAcceptedAt) doc.termsAcceptedAt = new Date();
      if (!doc.approvedAt) doc.approvedAt = new Date();
    },
  });
}

async function seedProperty(partner, spec) {
  const { roomTypes, documents, location, slug, ...fields } = spec;
  const point = { type: 'Point', coordinates: [location.lng, location.lat] };
  const zoneId = await resolveZoneId(point);
  const cover = photo(spec.name);
  const property = await upsert(HotelProperty, {
    label: `${spec.name} (${slug})`,
    filter: { slug },
    insert: {
      ...fields,
      slug,
      partnerId: partner._id,
      location: point,
      ...(zoneId ? { zoneId } : {}),
      coverImage: cover,
      images: photos(spec.name, 4),
    },
    enforce: { status: 'approved', isLive: true, isDeleted: false, rejectionReason: '' },
    guard: (existing) => (String(existing.partnerId) !== String(partner._id)
      ? 'slug belongs to another partner' : null),
    fixup: (doc) => {
      if (!doc.approvedAt) doc.approvedAt = new Date();
    },
  });
  if (!property) return null;

  const rts = [];
  for (const rt of roomTypes) {
    const doc = await upsert(HotelRoomType, {
      label: `  ${spec.name} / ${rt.name}`,
      filter: { propertyId: property._id, name: rt.name },
      insert: { ...rt, propertyId: property._id, images: photos(`${spec.name} ${rt.name}`, 3) },
      enforce: { isActive: true, isDeleted: false },
    });
    if (doc) rts.push(doc);
  }

  await upsert(HotelPropertyDocument, {
    label: `  ${spec.name} documents`,
    filter: { propertyId: property._id },
    insert: {
      propertyId: property._id,
      documents: documents.map((d) => ({ ...d, isRequired: d.type !== 'fire_noc', uploadedAt: new Date() })),
    },
    enforce: { verificationStatus: 'verified' },
    fixup: (doc) => {
      if (!doc.verifiedAt) doc.verifiedAt = new Date();
      if (!doc.adminRemark) doc.adminRemark = 'Demo data, verified by seed';
    },
  });

  // Inventory for the next 365 nights + the denormalised starting price.
  const from = todayIST();
  for (const rt of rts) {
    const have = await HotelInventoryDay.countDocuments({
      roomTypeId: rt._id, date: { $gte: toNightDate(from), $lt: toNightDate(addDays(from, BACKFILL_DAYS)) },
    });
    const missing = BACKFILL_DAYS - have;
    if (!missing) {
      bump('hotel_inventory_days', 'unchanged');
      continue;
    }
    if (APPLY) await backfillInventory(rt);
    bump('hotel_inventory_days', 'created');
    log('+', 'hotel_inventory_days', `  ${spec.name} / ${rt.name}`, `${missing} night(s)${APPLY ? '' : ', not written'}`);
  }
  if (APPLY) await refreshPropertyPrices(property._id);
  return property;
}

const run = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGO_URI / MONGODB_URI in environment.');
  await mongoose.connect(uri);
  console.log(`db: ${mongoose.connection.db.databaseName}   mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (nothing is written)'}`);
  console.log('legend: + create   ~ update   = unchanged   ! skipped');

  const partner = await seedPartner();
  const created = [];
  if (partner) {
    console.log('\n[2] demo properties, room types, documents, inventory');
    for (const spec of PROPERTIES) {
      const p = await seedProperty(partner, spec);
      if (p) created.push([spec.name, p.slug, p._id]);
    }
  } else {
    notes.push('No demo partner, so no demo properties were seeded.');
  }

  console.log('\n================ SUMMARY ================');
  console.log(`  ${'collection'.padEnd(30)} created  updated  unchanged  skipped`);
  for (const [coll, s] of stats) {
    console.log(`  ${coll.padEnd(30)} ${String(s.created).padStart(7)}  ${String(s.updated).padStart(7)}  ${String(s.unchanged).padStart(9)}  ${String(s.skipped).padStart(7)}`);
  }
  if (created.length) {
    console.log('\nDemo properties:');
    for (const [name, slug, id] of created) console.log(`  ${name.padEnd(20)} /hotel/p/${slug}   (${id})`);
  }
  console.log(`\nDemo hotel partner login: ${PARTNER.phone} (OTP 1234 while mock OTP is on)`);
  if (notes.length) {
    console.log('\nNotes:');
    for (const note of notes) console.log(`  - ${note}`);
  }
  if (!APPLY) console.log('\nDRY RUN: nothing was written. Re-run with --apply.');
};

run()
  .catch((err) => {
    console.error('seed-hotel failed:', err?.message || err);
    if (err?.errors) {
      for (const [path, e] of Object.entries(err.errors)) console.error(`  ${path}: ${e.message}`);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
