/**
 * KSG richer demo data for TAXI, HOME SERVICES (service provider) and HOTELS, on top
 * of what seed-ksg.js and seed-hotel.js create.
 *
 *   node scripts/seed-ksg-more.js                 # dry run (default): reads, validates, prints the plan
 *   node scripts/seed-ksg-more.js --apply         # writes
 *   node scripts/seed-ksg-more.js --apply --online
 *       # also puts the 6 demo taxi drivers online (isOnline) and the 6 demo SP workers
 *       # on duty (status ONLINE), so nearby-driver search and worker dispatch find them.
 *       # Off by default: an "online" demo driver nobody is holding will be offered real
 *       # customers' rides until the offer times out.
 *
 * Run seed-ksg.js and seed-hotel.js (--apply) first: this reads the India zone, the taxi
 * ride types, the SP categories, the demo customer and the Bhopal demo properties.
 *
 * What it adds
 *  - Taxi: 6 approved drivers (9000000301-306, every ride type), vehicles with number
 *    plates, verified documents, parked around MP Nagar, Bhopal. Two taxi promo codes.
 *  - Home services: 3 approved vendors (9000000311-313) in different categories, each
 *    with 2 workers (9000000321-326) holding a live subscription.
 *  - Hotels: a second partner (9000000011) with 4 approved, live properties in Indore,
 *    Goa, Manali and Delhi (room types, verified documents, 365 nights of inventory),
 *    and approved reviews on the 3 Bhopal demo properties, each tied to a past
 *    checked_out, paid-at-hotel booking of the demo customer (9000000001).
 *
 * Safety (same rules as seed-ksg.js / seed-hotel.js)
 *  - Dry run by default; new documents are still run through Mongoose validation.
 *  - Idempotent: drivers / vendors / workers / partners by phone, promo codes by code,
 *    properties by slug, room types by (property, name), documents by property, demo
 *    bookings by a fixed bookingRef, reviews by booking. Re-running changes nothing.
 *  - Additive only: nothing is deleted. On an existing demo row only the flags that make
 *    it usable are re-asserted; prices, text and photos edited later are left alone.
 *  - A phone already used by somebody with a DIFFERENT name is skipped with a warning,
 *    so this never approves a real application.
 *  - Demo bookings are written straight through the model: no booking events are
 *    emitted, so no settlement / wallet / notification side effects happen.
 *
 * Demo logins: every phone below signs in with the mock OTP (1234) while mock OTP is
 * enabled. Turn mock OTP off before real customers can reach these.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

// Customer identity (shared by every vertical)
import { FoodUser } from '../src/core/users/user.model.js';
// Taxi
import { Zone as TaxiZone } from '../src/modules/taxi/driver/models/Zone.js';
import { ServiceLocation } from '../src/modules/taxi/admin/models/ServiceLocation.js';
import { Vehicle } from '../src/modules/taxi/admin/models/Vehicle.js';
import { Driver } from '../src/modules/taxi/driver/models/Driver.js';
import { DriverNeededDocument } from '../src/modules/taxi/admin/models/DriverNeededDocument.js';
import { PromoCode } from '../src/modules/taxi/admin/promotions/models/PromoCode.js';
// Hotel
import { HotelPartner } from '../src/modules/hotel/models/hotelPartner.model.js';
import { HotelProperty } from '../src/modules/hotel/models/hotelProperty.model.js';
import { HotelRoomType } from '../src/modules/hotel/models/hotelRoomType.model.js';
import { HotelPropertyDocument } from '../src/modules/hotel/models/hotelPropertyDocument.model.js';
import { HotelInventoryDay } from '../src/modules/hotel/models/hotelInventoryDay.model.js';
import { HotelAvailability } from '../src/modules/hotel/models/hotelAvailability.model.js';
import { HotelBooking } from '../src/modules/hotel/models/hotelBooking.model.js';
import { HotelReview } from '../src/modules/hotel/models/hotelReview.model.js';
import {
  backfillInventory,
  ensureInventoryDays,
  quoteNights,
  BACKFILL_DAYS,
  todayIST,
  toNightDate,
  addDays,
  nightsBetween,
  toDateString,
} from '../src/modules/hotel/services/inventory.service.js';
import { refreshPropertyPrices, resolveZoneId } from '../src/modules/hotel/services/property.service.js';
import { priceStay } from '../src/modules/hotel/services/pricing.service.js';
import { getHotelSettings } from '../src/modules/hotel/services/settings.service.js';
import { ratingSummary, recomputePropertyRating } from '../src/modules/hotel/controllers/review.controller.js';
import { resolveMasterFees } from '../src/core/finance/platformFees.service.js';

// Service provider: CommonJS module.
const require = createRequire(import.meta.url);
const SPCategory = require('../src/modules/serviceProvider/models/Category.js');
const SPVendor = require('../src/modules/serviceProvider/models/Vendor.js');
const SPWorker = require('../src/modules/serviceProvider/models/Worker.js');

dotenv.config();

const APPLY = process.argv.includes('--apply');
const ONLINE = process.argv.includes('--online');

// ─────────────────────────────────────────────────────────────── constants ──

const ZONE_NAME = 'India';
const CUSTOMER_PHONE = '9000000001';

/** MP Nagar, Bhopal: the same anchor seed-ksg.js uses. */
const BHOPAL = { lat: 23.2599, lng: 77.4126 };
const near = (northKm, eastKm) => ({
  lat: Number((BHOPAL.lat + northKm / 111).toFixed(6)),
  lng: Number((BHOPAL.lng + eastKm / (111 * Math.cos((BHOPAL.lat * Math.PI) / 180))).toFixed(6)),
});
const point = ({ lat, lng }) => ({ type: 'Point', coordinates: [lng, lat] });

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEMO_DOC = (text) => `https://placehold.co/800x500/png?text=${encodeURIComponent(text).replace(/%20/g, '+')}`;
const DEMO_ID = 'DEMO-NOT-A-REAL-ID';
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactName = (name) => new RegExp(`^\\s*${escapeRegex(name)}\\s*$`, 'i');
const slugify = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ── taxi ──
/** One driver per ride type, a second auto. vehicle = TaxiVehicle name seeded by seed-ksg.js. */
const TAXI_DRIVERS = [
  { phone: '9000000301', name: 'Ramesh Yadav', gender: 'male', vehicle: 'Bike', vehicleType: 'bike', driverClass: 'two_wheeler', make: 'Honda', model: 'Shine 125', colour: 'Black', plate: 'MP04 QK 4821', at: near(0.6, 0.4) },
  { phone: '9000000302', name: 'Salim Qureshi', gender: 'male', vehicle: 'Auto', vehicleType: 'auto', driverClass: 'passenger_taxi', make: 'Bajaj', model: 'RE Compact CNG', colour: 'Green and Yellow', plate: 'MP04 RA 2317', at: near(-0.5, 0.9) },
  { phone: '9000000303', name: 'Gopal Kushwaha', gender: 'male', vehicle: 'Auto', vehicleType: 'auto', driverClass: 'passenger_taxi', make: 'Piaggio', model: 'Ape City Plus', colour: 'Green and Yellow', plate: 'MP04 RB 7754', at: near(1.4, 0.2) },
  { phone: '9000000304', name: 'Vikram Singh Thakur', gender: 'male', vehicle: 'Cab Mini', vehicleType: 'car', driverClass: 'passenger_taxi', make: 'Maruti Suzuki', model: 'WagonR CNG', colour: 'Silky Silver', plate: 'MP04 CT 3390', at: near(-1.1, -0.6) },
  { phone: '9000000305', name: 'Anil Choudhary', gender: 'male', vehicle: 'Cab Sedan', vehicleType: 'car', driverClass: 'passenger_taxi', make: 'Hyundai', model: 'Aura', colour: 'Polar White', plate: 'MP04 CK 6102', at: near(0.2, -1.5) },
  { phone: '9000000306', name: 'Harpreet Singh', gender: 'male', vehicle: 'Cab SUV', vehicleType: 'car', driverClass: 'passenger_taxi', make: 'Toyota', model: 'Innova Crysta', colour: 'Grey', plate: 'MP04 CZ 9045', at: near(-0.3, 1.8) },
];
/** Used when the admin has not set up any driver document templates yet. */
const FALLBACK_DRIVER_DOC_KEYS = ['drivingLicense', 'vehicleRC', 'aadharFront', 'aadharBack'];

/** Taxi promo codes (fields as Admin > Promotions > Promo codes stores them). */
const PROMO_CODES = [
  {
    code: 'FIRSTRIDE',
    audience_type: 'new_users',
    discount_percentage: 50,
    maximum_discount_amount: 75,
    minimum_trip_amount: 0,
    uses_per_user: 1,
    note: '50% off up to Rs 75, first ride (no completed ride yet)',
  },
  {
    code: 'RIDE20',
    audience_type: 'all',
    discount_percentage: 20,
    maximum_discount_amount: 40,
    minimum_trip_amount: 150,
    uses_per_user: 3,
    note: '20% off up to Rs 40 on rides of Rs 150+, 3 uses per rider',
  },
];

// ── service provider ──
// Category titles are the ones seed-ksg.js creates; the stored title is read back from
// the database so worker dispatch (exact title match) lines up with an admin rename.
const SP_VENDORS = [
  {
    phone: '9000000311',
    name: 'Sanjay Verma',
    businessName: 'Spark Electricals',
    email: 'ksg.demo.vendor311@example.com',
    categories: ['Electrician', 'Appliance Repair'],
    address: { addressLine1: '14, Zone-II, MP Nagar', city: 'Bhopal', state: 'Madhya Pradesh', pincode: '462011' },
    at: near(-0.4, 0.6),
    workers: [
      { phone: '9000000321', name: 'Deepak Malviya', categories: ['Electrician', 'Appliance Repair'], at: near(-0.6, 0.5) },
      { phone: '9000000322', name: 'Arjun Patel', categories: ['Electrician'], at: near(0.9, 1.1) },
    ],
  },
  {
    phone: '9000000312',
    name: 'Rakesh Sharma',
    businessName: 'Sharma Plumbing Works',
    email: 'ksg.demo.vendor312@example.com',
    categories: ['Plumber', 'Carpenter'],
    address: { addressLine1: 'B-22, Arera Colony', city: 'Bhopal', state: 'Madhya Pradesh', pincode: '462016' },
    at: near(-2.5, 1.0),
    workers: [
      { phone: '9000000323', name: 'Mohan Lal Prajapati', categories: ['Plumber'], at: near(-2.2, 0.7) },
      { phone: '9000000324', name: 'Suresh Vishwakarma', categories: ['Carpenter', 'Plumber'], at: near(-1.5, 1.6) },
    ],
  },
  {
    phone: '9000000313',
    name: 'Imran Khan',
    businessName: 'CoolBreeze AC & Cleaning',
    email: 'ksg.demo.vendor313@example.com',
    categories: ['AC Repair', 'Cleaning', 'Pest Control'],
    address: { addressLine1: '7, Kohefiza Main Road', city: 'Bhopal', state: 'Madhya Pradesh', pincode: '462001' },
    at: near(2.4, -2.6),
    workers: [
      { phone: '9000000325', name: 'Faizan Ali', categories: ['AC Repair'], at: near(2.0, -2.2) },
      { phone: '9000000326', name: 'Kavita Bai', categories: ['Cleaning', 'Pest Control'], at: near(1.2, -1.4) },
    ],
  },
];

// ── hotels ──
const PARTNER = {
  phone: '9000000011',
  name: 'KSG Demo Stays Partner',
  email: 'hotel.demo2@ksg.test',
  kyc: {
    ownerName: 'KSG Demo Owner 2 (DEMO DATA)',
    aadhaarNumberMasked: 'XXXXXXXX0011',
    panNumber: 'AAAPD0011D', // demo placeholder, not a real PAN
  },
  bank: { accountHolder: 'KSG Demo Owner 2', accountNumberMasked: 'XXXXXX0011', ifsc: 'SBIN0000001', bankName: 'Demo Bank' },
  address: { line: '12, Vijay Nagar', city: 'Indore', state: 'Madhya Pradesh', pincode: '452010' },
};

const photo = (text) => `https://placehold.co/1200x800?text=${encodeURIComponent(text).replace(/%20/g, '+')}`;
const photos = (name, n) => Array.from({ length: n }, (_, i) => photo(`${name} ${i + 1}`));

const PROPERTIES = [
  {
    slug: 'ksg-demo-business-hotel-indore',
    name: 'KSG Demo Business Hotel',
    propertyType: 'hotel',
    typeDetails: { hotelCategory: 'budget', starRating: 3 },
    suitability: 'both',
    shortDescription: 'Value business hotel in Vijay Nagar, close to C21 Mall and the AB Road offices.',
    description: 'Clean, well-run rooms on AB Road with a 24x7 front desk, an in-house restaurant '
      + 'serving Indori breakfast, and quick access to the Bombay Hospital and IT park belt. DEMO LISTING.',
    contactNumber: PARTNER.phone,
    address: { line1: 'Plot 41, Scheme 54', area: 'Vijay Nagar', city: 'Indore', state: 'Madhya Pradesh', pincode: '452010', country: 'India' },
    location: { lat: 22.7533, lng: 75.8937 },
    nearbyPlaces: [
      { name: 'C21 Mall', type: 'mall', distanceKm: 0.8 },
      { name: 'Indore Junction', type: 'railway', distanceKm: 7.5 },
      { name: 'Devi Ahilya Bai Holkar Airport', type: 'airport', distanceKm: 13 },
    ],
    amenities: ['wifi', 'ac', 'parking', 'restaurant', 'room_service', 'power_backup', 'lift', 'cctv', 'housekeeping', 'tv', 'laundry', 'front_desk_24x7'],
    houseRules: ['Valid photo ID required at check-in', 'No smoking in rooms', 'Local IDs accepted'],
    cancellationPolicy: { type: 'flexible', freeCancelHours: 12, refundPercentAfter: 50 },
    checkInTime: '12:00',
    checkOutTime: '11:00',
    roomTypes: [
      { name: 'Standard Room', description: 'Queen bed, work desk, city view.', inventoryType: 'room', roomCategory: 'private', baseAdults: 2, maxAdults: 2, maxChildren: 1, totalInventory: 12, pricePerNight: 1499, originalPrice: 1999, weekendPrice: 1699, extraChildPrice: 250, mealPlan: 'room_only', amenities: ['wifi', 'ac', 'tv'] },
      { name: 'Deluxe Room', description: 'King bed, larger room with breakfast for two.', inventoryType: 'room', roomCategory: 'private', baseAdults: 2, maxAdults: 3, maxChildren: 1, totalInventory: 8, pricePerNight: 2199, originalPrice: 2799, weekendPrice: 2499, extraAdultPrice: 500, extraChildPrice: 250, mealPlan: 'breakfast', amenities: ['wifi', 'ac', 'tv', 'breakfast'] },
      { name: 'Family Suite', description: 'Two rooms with a sofa-bed, sleeps four.', inventoryType: 'room', roomCategory: 'private', baseAdults: 2, maxAdults: 4, maxChildren: 2, totalInventory: 3, pricePerNight: 3499, originalPrice: 4299, weekendPrice: 3899, extraAdultPrice: 700, extraChildPrice: 350, mealPlan: 'breakfast', amenities: ['wifi', 'ac', 'tv', 'breakfast', 'room_service'] },
    ],
    documents: [
      { type: 'trade_license', name: 'Trade licence (demo)', fileUrl: photo('Demo trade licence') },
      { type: 'fire_noc', name: 'Fire NOC (demo)', fileUrl: photo('Demo fire NOC') },
    ],
  },
  {
    slug: 'ksg-demo-beach-resort-goa',
    name: 'KSG Demo Beach Resort',
    propertyType: 'resort',
    typeDetails: { resortType: 'beach', starRating: 4 },
    suitability: 'family_friendly',
    shortDescription: 'Pool-side resort a short walk from Candolim beach in North Goa.',
    description: 'Portuguese-style cottages and pool-view rooms set in palm gardens, five minutes on foot '
      + 'from Candolim beach. Pool, spa, gym and a beach-shack style restaurant. DEMO LISTING.',
    contactNumber: PARTNER.phone,
    address: { line1: 'Fort Aguada Road', area: 'Candolim', city: 'Goa', state: 'Goa', pincode: '403515', country: 'India' },
    location: { lat: 15.5167, lng: 73.7627 },
    nearbyPlaces: [
      { name: 'Candolim Beach', type: 'beach', distanceKm: 0.4 },
      { name: 'Fort Aguada', type: 'landmark', distanceKm: 3.2 },
      { name: 'Dabolim Airport', type: 'airport', distanceKm: 40 },
    ],
    amenities: ['wifi', 'ac', 'parking', 'restaurant', 'room_service', 'pool', 'spa', 'gym', 'power_backup', 'cctv', 'housekeeping', 'tv', 'breakfast', 'laundry', 'front_desk_24x7'],
    houseRules: ['Pool open 7am-9pm', 'Outside food not allowed', 'Quiet hours after 11pm'],
    cancellationPolicy: { type: 'strict', freeCancelHours: 168, refundPercentAfter: 25 },
    checkInTime: '14:00',
    checkOutTime: '11:00',
    roomTypes: [
      { name: 'Garden View Room', description: 'Ground floor, opens onto the palm garden.', inventoryType: 'room', roomCategory: 'private', baseAdults: 2, maxAdults: 3, maxChildren: 2, totalInventory: 10, pricePerNight: 4999, originalPrice: 6499, weekendPrice: 5999, extraAdultPrice: 1000, extraChildPrice: 500, mealPlan: 'breakfast', amenities: ['wifi', 'ac', 'tv', 'breakfast'] },
      { name: 'Pool View Room', description: 'Balcony over the main pool.', inventoryType: 'room', roomCategory: 'private', baseAdults: 2, maxAdults: 3, maxChildren: 2, totalInventory: 8, pricePerNight: 6499, originalPrice: 7999, weekendPrice: 7499, extraAdultPrice: 1200, extraChildPrice: 600, mealPlan: 'breakfast', amenities: ['wifi', 'ac', 'tv', 'breakfast', 'room_service'] },
      { name: 'Sea View Suite', description: 'Top-floor suite with a sea-facing sit-out; breakfast and dinner included.', inventoryType: 'room', roomCategory: 'private', baseAdults: 2, maxAdults: 4, maxChildren: 2, totalInventory: 3, pricePerNight: 9999, originalPrice: 12499, weekendPrice: 11499, extraAdultPrice: 1500, extraChildPrice: 800, mealPlan: 'half_board', amenities: ['wifi', 'ac', 'tv', 'breakfast', 'room_service'] },
    ],
    documents: [
      { type: 'trade_license', name: 'Trade licence (demo)', fileUrl: photo('Demo trade licence') },
      { type: 'fire_noc', name: 'Fire NOC (demo)', fileUrl: photo('Demo fire NOC') },
    ],
  },
  {
    slug: 'ksg-demo-mountain-homestay-manali',
    name: 'KSG Demo Mountain Homestay',
    propertyType: 'homestay',
    typeDetails: { hostLivesOnProperty: true },
    suitability: 'both',
    shortDescription: 'Family-run wooden homestay in Old Manali with apple-orchard and valley views.',
    description: 'A traditional Kath-Kuni style house above the Manalsu river, hosted by a local family. '
      + 'Home-cooked Himachali breakfast, bonfire evenings and a short walk to Old Manali cafes. DEMO LISTING.',
    contactNumber: PARTNER.phone,
    address: { line1: 'Upper Old Manali Road', area: 'Old Manali', city: 'Manali', state: 'Himachal Pradesh', pincode: '175131', country: 'India' },
    location: { lat: 32.2554, lng: 77.1734 },
    nearbyPlaces: [
      { name: 'Hadimba Devi Temple', type: 'landmark', distanceKm: 1.8 },
      { name: 'Mall Road, Manali', type: 'market', distanceKm: 2.5 },
      { name: 'Solang Valley', type: 'landmark', distanceKm: 13 },
    ],
    amenities: ['wifi', 'parking', 'kitchen', 'geyser', 'breakfast', 'pet_friendly', 'housekeeping', 'power_backup'],
    houseRules: ['Quiet hours after 10pm', 'Pets allowed on request', 'No loud music'],
    cancellationPolicy: { type: 'moderate', freeCancelHours: 48, refundPercentAfter: 50 },
    checkInTime: '13:00',
    checkOutTime: '11:00',
    roomTypes: [
      { name: 'Valley View Double', description: 'Wood-panelled room with a balcony over the valley.', inventoryType: 'room', roomCategory: 'private', baseAdults: 2, maxAdults: 2, maxChildren: 1, totalInventory: 3, pricePerNight: 2199, originalPrice: 2799, weekendPrice: 2599, extraChildPrice: 300, mealPlan: 'breakfast', amenities: ['wifi', 'geyser', 'breakfast'] },
      { name: 'Family Attic Room', description: 'Large attic room with a double bed and two singles.', inventoryType: 'room', roomCategory: 'private', baseAdults: 2, maxAdults: 4, maxChildren: 2, totalInventory: 1, pricePerNight: 2999, originalPrice: 3599, weekendPrice: 3399, extraAdultPrice: 500, extraChildPrice: 300, mealPlan: 'breakfast', amenities: ['wifi', 'geyser', 'breakfast'] },
      { name: 'Entire Cottage', description: 'The whole three-bedroom cottage with kitchen and garden.', inventoryType: 'entire', roomCategory: 'entire', baseAdults: 6, maxAdults: 8, maxChildren: 4, totalInventory: 1, pricePerNight: 7999, originalPrice: 9499, weekendPrice: 8999, extraAdultPrice: 600, mealPlan: 'room_only', amenities: ['wifi', 'kitchen', 'geyser', 'parking'] },
    ],
    documents: [{ type: 'electricity_bill', name: 'Electricity bill (demo)', fileUrl: photo('Demo electricity bill') }],
  },
  {
    slug: 'ksg-demo-backpackers-hostel-delhi',
    name: 'KSG Demo Backpackers Hostel',
    propertyType: 'hostel',
    typeDetails: { hostelType: 'mixed' },
    suitability: 'none',
    shortDescription: 'Social backpacker hostel in Paharganj, two minutes from New Delhi station.',
    description: 'Air-conditioned dorms with lockers and reading lights, a rooftop common area, '
      + 'shared kitchen and laundry. Walk to New Delhi railway station and the metro. DEMO LISTING.',
    contactNumber: PARTNER.phone,
    address: { line1: '8510, Arakashan Road', area: 'Paharganj', city: 'Delhi', state: 'Delhi', pincode: '110055', country: 'India' },
    location: { lat: 28.6448, lng: 77.2167 },
    nearbyPlaces: [
      { name: 'New Delhi Railway Station', type: 'railway', distanceKm: 0.3 },
      { name: 'Connaught Place', type: 'market', distanceKm: 2 },
      { name: 'RK Ashram Marg Metro', type: 'metro', distanceKm: 0.9 },
    ],
    amenities: ['wifi', 'ac', 'power_backup', 'cctv', 'housekeeping', 'geyser', 'laundry', 'kitchen', 'front_desk_24x7'],
    houseRules: ['Guests must be 18+', 'Lockers provided, bring your own lock', 'No outside visitors in dorms'],
    cancellationPolicy: { type: 'non_refundable', freeCancelHours: 0, refundPercentAfter: 0 },
    checkInTime: '13:00',
    checkOutTime: '10:00',
    // Bed listings: one unit = one bed, so a search must ask for one bed per guest
    // (rooms = adults), as for any bed listing.
    roomTypes: [
      { name: '8-Bed Mixed Dorm', description: 'Bunk bed in an 8-bed AC dorm with locker.', inventoryType: 'bed', roomCategory: 'shared', baseAdults: 1, maxAdults: 1, maxChildren: 0, bedsPerRoom: 8, totalInventory: 2, pricePerNight: 549, originalPrice: 699, weekendPrice: 649, mealPlan: 'room_only', amenities: ['wifi', 'ac'] },
      { name: '6-Bed Mixed Dorm', description: 'Bunk bed in a 6-bed AC dorm with locker and en-suite.', inventoryType: 'bed', roomCategory: 'shared', baseAdults: 1, maxAdults: 1, maxChildren: 0, bedsPerRoom: 6, totalInventory: 2, pricePerNight: 649, originalPrice: 799, weekendPrice: 749, mealPlan: 'room_only', amenities: ['wifi', 'ac', 'geyser'] },
      { name: '4-Bed Female Dorm', description: 'Female-only 4-bed AC dorm with en-suite.', inventoryType: 'bed', roomCategory: 'shared', baseAdults: 1, maxAdults: 1, maxChildren: 0, bedsPerRoom: 4, totalInventory: 1, pricePerNight: 799, originalPrice: 999, weekendPrice: 899, mealPlan: 'breakfast', amenities: ['wifi', 'ac', 'geyser', 'breakfast'] },
    ],
    documents: [
      { type: 'trade_license', name: 'Trade licence (demo)', fileUrl: photo('Demo trade licence') },
      { type: 'rent_agreement', name: 'Rent agreement (demo)', fileUrl: photo('Demo rent agreement') },
    ],
  },
];

/**
 * Past stays of the demo customer at the Bhopal demo properties (seed-hotel.js), each
 * with an approved review. `daysAgo` is the check-in date; dates are frozen on the first
 * apply (the booking is matched by bookingRef afterwards).
 */
const DEMO_STAYS = [
  {
    ref: 'KSGHDEMOBPL01', slug: 'ksg-demo-hotel-bhopal', roomType: 'Standard Room', daysAgo: 64, nights: 2, adults: 2,
    review: { rating: 5, sub: { cleanliness: 5, location: 5, service: 5, value: 4 }, comment: 'Spotless room and very helpful front desk. Walking distance to DB Mall, perfect for a work trip.', reply: 'Thank you! We look forward to hosting you again.' },
  },
  {
    ref: 'KSGHDEMOBPL02', slug: 'ksg-demo-hotel-bhopal', roomType: 'Deluxe Room', daysAgo: 41, nights: 1, adults: 2,
    review: { rating: 4, sub: { cleanliness: 4, location: 5, service: 4, value: 4 }, comment: 'Good breakfast spread and comfortable bed. Check-in took a little long in the evening rush.' },
  },
  {
    ref: 'KSGHDEMOBPL03', slug: 'ksg-demo-hotel-bhopal', roomType: 'Executive Suite', daysAgo: 19, nights: 2, adults: 3,
    review: { rating: 5, sub: { cleanliness: 5, location: 4, service: 5, value: 4 }, comment: 'Spacious suite, room service was quick. Great for a family stay.' },
  },
  {
    ref: 'KSGHDEMOBPL04', slug: 'ksg-demo-resort-bhopal', roomType: 'Lake View Room', daysAgo: 55, nights: 2, adults: 2,
    review: { rating: 5, sub: { cleanliness: 5, location: 5, service: 4, value: 4 }, comment: 'Beautiful sunset over the Upper Lake from the room. Pool was clean and the staff friendly.', reply: 'So glad you enjoyed the lake views. See you again!' },
  },
  {
    ref: 'KSGHDEMOBPL05', slug: 'ksg-demo-resort-bhopal', roomType: 'Garden Cottage', daysAgo: 27, nights: 1, adults: 4,
    review: { rating: 4, sub: { cleanliness: 4, location: 5, service: 4, value: 3 }, comment: 'Lovely cottage and lawns for the kids. A bit pricey, but the dinner buffet was worth it.' },
  },
  {
    ref: 'KSGHDEMOBPL06', slug: 'ksg-demo-homestay-bhopal', roomType: 'Cosy Double Room', daysAgo: 72, nights: 3, adults: 2,
    review: { rating: 5, sub: { cleanliness: 5, location: 4, service: 5, value: 5 }, comment: 'Felt like staying with family. The aloo paratha breakfast was the best part of the trip.', reply: 'Thank you, do come back for the poha next time!' },
  },
  {
    ref: 'KSGHDEMOBPL07', slug: 'ksg-demo-homestay-bhopal', roomType: 'Entire Home', daysAgo: 34, nights: 2, adults: 5,
    review: { rating: 4, sub: { cleanliness: 4, location: 4, service: 5, value: 5 }, comment: 'Whole house to ourselves, well equipped kitchen. Parking is on the street.' },
  },
  {
    ref: 'KSGHDEMOBPL08', slug: 'ksg-demo-homestay-bhopal', roomType: 'Cosy Double Room', daysAgo: 12, nights: 1, adults: 2,
    review: { rating: 3, sub: { cleanliness: 4, location: 3, service: 4, value: 3 }, comment: 'Nice hosts and quiet area, but a little far from the main markets.' },
  },
];

// ─────────────────────────────────────────────────────────────── machinery ──

const stats = new Map(); // collection -> { created, updated, unchanged, skipped }
const notes = [];
const logins = [];
const bump = (coll, key, n = 1) => {
  if (!stats.has(coll)) stats.set(coll, { created: 0, updated: 0, unchanged: 0, skipped: 0 });
  stats.get(coll)[key] += n;
};
const log = (sym, coll, label, extra = '') =>
  console.log(`  ${sym} ${coll.padEnd(28)} ${label}${extra ? `  ${extra}` : ''}`);
const skip = (coll, label, reason) => {
  bump(coll, 'skipped');
  log('!', coll, label, `SKIPPED: ${reason}`);
  notes.push(`${coll} "${label}" skipped: ${reason}`);
};

/** Same contract as seed-ksg.js upsert(). */
async function upsert(Model, { label, filter, insert = {}, enforce = {}, fixup, guard }) {
  const coll = Model.collection.collectionName;
  let doc = await Model.findOne(filter);
  const isNew = !doc;

  if (!isNew && guard) {
    const reason = guard(doc);
    if (reason) {
      skip(coll, label, reason);
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

// ─────────────────────────────────────────────────────────────────── taxi ──

/** Keys the driver app and admin panel read documents under (template fields). */
async function driverDocumentKeys(driverClass) {
  const templates = await DriverNeededDocument.find({
    active: { $ne: false },
    template_type: { $ne: 'vehicle_field' },
  }).lean();
  const keys = templates
    .filter((t) => !Array.isArray(t.applies_to) || !t.applies_to.length || t.applies_to.includes(driverClass))
    .flatMap((t) => [t.front_key, t.back_key, t.key])
    .map((k) => String(k || '').trim())
    .filter(Boolean);
  return keys.length ? [...new Set(keys)] : FALLBACK_DRIVER_DOC_KEYS;
}

const isVerifiedDoc = (d) => ['verified', 'approved'].includes(
  String(d?.status || d?.verificationStatus || d?.reviewStatus || '').trim().toLowerCase(),
);

const verifiedDriverDocument = (key, driverName) => {
  const url = DEMO_DOC(`${driverName} ${key} (demo, not real)`);
  const now = new Date().toISOString();
  return {
    key,
    fileName: `${key}.png`,
    fileNames: [`${key}.png`],
    uploaded: true,
    uploadedAt: now,
    previewUrl: url,
    secureUrl: url,
    imageUrl: url,
    images: [url],
    identifyNumber: DEMO_ID,
    expiryDate: new Date(Date.now() + 3 * YEAR_MS).toISOString().slice(0, 10),
    status: 'verified',
    verificationStatus: 'verified',
    reviewStatus: 'verified',
    comment: 'Demo data, verified by seed',
    reviewedAt: now,
  };
}

async function seedTaxi() {
  console.log('\n[1] Taxi: demo drivers and promo codes');
  const [taxiZone, serviceLocation] = await Promise.all([
    TaxiZone.findOne({ name: ZONE_NAME }),
    ServiceLocation.findOne({ name: ZONE_NAME }),
  ]);
  if (!taxiZone || !serviceLocation) {
    notes.push('Taxi skipped: no "India" taxi zone / service location. Run seed-ksg.js --apply first.');
    console.log('  ! no India taxi zone / service location; run seed-ksg.js --apply first');
    return;
  }

  for (const spec of TAXI_DRIVERS) {
    const label = `${spec.name} (${spec.phone}, ${spec.vehicle}, ${spec.plate})`;
    const vehicle = await Vehicle.findOne({ name: exactName(spec.vehicle) });
    if (!vehicle) {
      skip('taxidrivers', label, `ride type "${spec.vehicle}" not found (run seed-ksg.js --apply)`);
      continue;
    }
    const docKeys = await driverDocumentKeys(spec.driverClass);
    const iconType = String(vehicle.icon_types || spec.vehicleType || 'car').trim() || 'car';

    await upsert(Driver, {
      label,
      filter: { phone: new RegExp(`${spec.phone}$`) },
      guard: sameName('name', spec.name),
      insert: {
        name: spec.name,
        phone: spec.phone,
        email: `ksg.demo.driver${spec.phone.slice(-3)}@example.com`,
        gender: spec.gender,
        // Required by the schema; login is by OTP, so a random secret nobody knows.
        password: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
        vehicleType: spec.vehicleType,
        vehicleTypeId: vehicle._id,
        vehicleIconType: iconType,
        vehicleMake: spec.make,
        vehicleModel: spec.model,
        vehicleNumber: spec.plate,
        vehicleColor: spec.colour,
        vehicleImage: photo(`${spec.make} ${spec.model}`),
        driverClass: spec.driverClass,
        registerFor: 'taxi',
        serviceCapabilities: ['taxi'],
        workMode: 'taxi',
        city: 'Bhopal',
        location: point(spec.at),
      },
      enforce: {
        approve: true,
        status: 'approved',
        deletedAt: null,
        zoneId: taxiZone._id,
        service_location_id: serviceLocation._id,
        'wallet.isBlocked': false,
        ...(ONLINE ? { isOnline: true } : {}),
      },
      fixup: (doc) => {
        if (!doc.vehicleTypeId) doc.vehicleTypeId = vehicle._id;
        if (!doc.vehicleNumber) doc.vehicleNumber = spec.plate;
        // No position yet, or --online: park the driver at the demo spot so nearby search finds them.
        const loc = doc.location?.coordinates || [];
        const [lng, lat] = point(spec.at).coordinates;
        const unset = loc.length !== 2 || (Number(loc[0]) === 0 && Number(loc[1]) === 0);
        if ((unset || ONLINE) && (Number(loc[0]) !== lng || Number(loc[1]) !== lat)) doc.location = point(spec.at);
        // Documents: every template key, verified. Verified ones are left as they are.
        const docs = { ...(doc.documents || {}) };
        let changed = false;
        for (const key of docKeys) {
          if (!isVerifiedDoc(docs[key])) {
            docs[key] = verifiedDriverDocument(key, spec.name);
            changed = true;
          }
        }
        if (changed) {
          doc.documents = docs;
          doc.markModified('documents');
        }
      },
    });
    logins.push([`Taxi driver (${spec.vehicle}, ${spec.plate})`, spec.phone, '/taxi/driver/login']);
  }

  // Promo codes: insert-only. An existing code (an admin's, or this seed's) is left alone.
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  for (const p of PROMO_CODES) {
    await upsert(PromoCode, {
      label: `${p.code}  (${p.note})`,
      filter: { code: p.code },
      insert: {
        service_location_id: serviceLocation._id,
        service_location_name: serviceLocation.service_location_name || serviceLocation.name || ZONE_NAME,
        service_location_ids: [serviceLocation._id],
        service_location_names: [serviceLocation.service_location_name || serviceLocation.name || ZONE_NAME],
        user_specific: false,
        audience_type: p.audience_type,
        transport_type: 'taxi',
        code: p.code,
        minimum_trip_amount: p.minimum_trip_amount,
        maximum_discount_amount: p.maximum_discount_amount,
        cumulative_max_discount_amount: 0,
        discount_percentage: p.discount_percentage,
        from_date: from,
        to_date: new Date(from.getTime() + YEAR_MS),
        uses_per_user: p.uses_per_user,
        max_uses_total: 0,
        active: true,
      },
    });
  }
}

// ─────────────────────────────────────────────────────── service provider ──

async function seedServiceProvider() {
  console.log('\n[2] Home services: demo vendors and workers');
  const titleCache = new Map();
  const categoryTitle = async (title) => {
    if (titleCache.has(title)) return titleCache.get(title);
    const cat = await SPCategory.findOne({ $or: [{ slug: slugify(title) }, { title: exactName(title) }] })
      .select('title status').lean();
    if (!cat) notes.push(`sp_categories: "${title}" not found; demo vendors/workers still list it by name (run seed-ksg.js --apply).`);
    const resolved = cat?.title || title;
    titleCache.set(title, resolved);
    return resolved;
  };

  for (const v of SP_VENDORS) {
    const categories = [];
    for (const c of v.categories) categories.push(await categoryTitle(c));
    const fullAddress = `${v.address.addressLine1}, ${v.address.city}, ${v.address.state} ${v.address.pincode}`;
    const vendor = await upsert(SPVendor, {
      label: `${v.businessName} / ${v.name} (${v.phone})`,
      filter: { phone: v.phone },
      guard: sameName('name', v.name),
      insert: {
        name: v.name,
        email: v.email,
        phone: v.phone,
        businessName: v.businessName,
        service: categories,
        categories,
        skills: categories,
        // Required by the schema. Placeholders, labelled as such; not real IDs.
        aadhar: { number: DEMO_ID, document: DEMO_DOC('Aadhaar front (demo)'), backDocument: DEMO_DOC('Aadhaar back (demo)') },
        pan: { number: DEMO_ID, document: DEMO_DOC('PAN (demo)') },
        address: { fullAddress, ...v.address, lat: v.at.lat, lng: v.at.lng },
        location: { lat: v.at.lat, lng: v.at.lng, updatedAt: new Date() },
        geoLocation: point(v.at),
        businessHours: Object.fromEntries(
          ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
            .map((d) => [d, { open: '09:00', close: '20:00', isOpen: true }]),
        ),
      },
      enforce: { approvalStatus: 'approved', isActive: true, isPhoneVerified: true },
      fixup: (doc) => {
        if (!doc.approvalDate) doc.approvalDate = new Date();
        if (doc.rejectedReason) doc.rejectedReason = undefined;
        const c = doc.geoLocation?.coordinates || [];
        if (c.length !== 2 || (Number(c[0]) === 0 && Number(c[1]) === 0)) doc.geoLocation = point(v.at);
      },
    });
    logins.push([`Home-services vendor (${v.businessName})`, v.phone, 'SP vendor app /vendor/login']);

    for (const w of v.workers) {
      const workerCategories = [];
      for (const c of w.categories) workerCategories.push(await categoryTitle(c));
      await upsert(SPWorker, {
        label: `  ${w.name} (${w.phone}) -> ${v.businessName}`,
        filter: { phone: w.phone },
        guard: sameName('name', w.name),
        insert: {
          name: w.name,
          phone: w.phone,
          // Needed: email defaults to null and its unique index is only sparse, so a
          // second worker without an email collides with the first on `null`.
          email: `ksg.demo.worker${w.phone.slice(-3)}@example.com`,
          serviceCategories: workerCategories,
          aadhar: { number: DEMO_ID, document: DEMO_DOC('Aadhaar front (demo)'), backDocument: DEMO_DOC('Aadhaar back (demo)') },
          address: { addressLine1: v.address.addressLine1, city: v.address.city, state: v.address.state, pincode: v.address.pincode },
          location: { lat: w.at.lat, lng: w.at.lng, updatedAt: new Date() },
          geoLocation: point(w.at),
        },
        enforce: {
          approvalStatus: 'approved',
          isActive: true,
          isPhoneVerified: true,
          ...(vendor ? { vendorId: vendor._id } : {}),
          ...(ONLINE ? { status: 'ONLINE' } : {}),
        },
        fixup: (doc) => {
          // Worker dispatch only offers jobs to workers with a live subscription.
          // A demo year, no plan attached (as seed-ksg.js does).
          const expiry = doc.subscription?.expiryDate ? new Date(doc.subscription.expiryDate) : null;
          if (!doc.subscription?.isActive || !expiry || expiry.getTime() <= Date.now()) {
            doc.set('subscription.isActive', true);
            doc.set('subscription.startDate', new Date());
            doc.set('subscription.expiryDate', new Date(Date.now() + YEAR_MS));
          }
          const c = doc.geoLocation?.coordinates || [];
          if (c.length !== 2 || (Number(c[0]) === 0 && Number(c[1]) === 0)) doc.geoLocation = point(w.at);
        },
      });
      logins.push([`Home-services worker (${w.categories.join(', ')})`, w.phone, 'SP worker app /worker/login']);
    }
  }
}

// ───────────────────────────────────────────────────────────────── hotels ──

const DEMO_PARTNER_NAMES = [PARTNER.name.toLowerCase()];
const partnerGuard = (existing) => {
  const actual = String(existing?.name || '').trim();
  if (existing?.isDeleted) return 'partner is deleted';
  return actual && !DEMO_PARTNER_NAMES.includes(actual.toLowerCase())
    ? `phone already belongs to "${actual}", not "${PARTNER.name}"`
    : null;
};

async function seedHotelProperty(partner, spec) {
  const { roomTypes, documents, location, slug, ...fields } = spec;
  const geo = { type: 'Point', coordinates: [location.lng, location.lat] };
  const zoneId = await resolveZoneId(geo);
  const property = await upsert(HotelProperty, {
    label: `${spec.name}, ${spec.address.city} (${slug})`,
    filter: { slug },
    insert: {
      ...fields,
      slug,
      partnerId: partner._id,
      location: geo,
      ...(zoneId ? { zoneId } : {}),
      coverImage: photo(spec.name),
      images: photos(spec.name, 5),
    },
    enforce: { status: 'approved', isLive: true, isDeleted: false, rejectionReason: '' },
    guard: (existing) => (String(existing.partnerId) !== String(partner._id) ? 'slug belongs to another partner' : null),
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

  // 365 nights of inventory + the denormalised starting price (as seed-hotel.js does).
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

const addressLine = (property) => {
  const a = property.address || {};
  return a.fullAddress || [a.line1, a.area, a.city, a.state, a.pincode].filter(Boolean).join(', ');
};

/** 'HH:mm' on an IST calendar date ('YYYY-MM-DD') -> Date. */
const istMoment = (dateStr, hhmm) => {
  const [h, m] = String(hhmm || '12:00').split(':').map(Number);
  return new Date(toNightDate(dateStr).getTime() + (h * 60 + m) * 60 * 1000);
};

/**
 * One past checked_out stay + its review. Pricing is computed exactly as the booking
 * service does (quoteNights -> priceStay with the live hotel settings and Master
 * platform fee), paid in full at the hotel. The stay's nights are written to the
 * inventory counter and the availability ledger the way a real booking leaves them
 * after check-out (release() only gives back nights from today on, i.e. none here).
 */
async function seedDemoStay({ stay, customer, settings }) {
  const label = `${stay.ref}  ${stay.slug} / ${stay.roomType}`;
  const property = await HotelProperty.findOne({ slug: stay.slug, isDeleted: { $ne: true } });
  if (!property) {
    skip('hotel_bookings', label, 'Bhopal demo property not found (run seed-hotel.js --apply)');
    return null;
  }
  const roomType = await HotelRoomType.findOne({ propertyId: property._id, name: stay.roomType, isDeleted: { $ne: true } });
  if (!roomType) {
    skip('hotel_bookings', label, `room type "${stay.roomType}" not found`);
    return null;
  }

  let booking = await HotelBooking.findOne({ bookingRef: stay.ref });
  if (booking && String(booking.userId) !== String(customer._id)) {
    skip('hotel_bookings', label, 'bookingRef already used by another customer\'s booking');
    return null;
  }

  if (booking) {
    bump('hotel_bookings', 'unchanged');
    log('=', 'hotel_bookings', label, `(${booking._id})`);
  } else {
    const checkIn = addDays(todayIST(), -stay.daysAgo);
    const checkOut = addDays(checkIn, stay.nights);
    if (checkOut >= todayIST()) throw new Error(`${stay.ref}: a demo stay must end before today`);
    const rooms = 1;
    if (stay.adults > roomType.maxAdults * rooms) throw new Error(`${stay.ref}: ${stay.adults} adults do not fit ${roomType.name}`);

    const nights = await quoteNights(roomType, checkIn, checkOut);
    const fees = await resolveMasterFees('hotel', property.zoneId);
    const platformFee = fees.platformFee > 0 ? { fee: fees.platformFee, gstRate: fees.platformFeeGstRate ?? 18 } : null;
    const priced = priceStay({
      roomType,
      nights,
      rooms,
      adults: stay.adults,
      children: 0,
      paymentMode: 'pay_at_hotel',
      coupon: null,
      settings,
      platformFee,
    });
    const total = priced.pricing.total;

    const bookedAt = new Date(toNightDate(checkIn).getTime() - 9 * DAY_MS + 15 * 60 * 60 * 1000);
    const checkedInAt = istMoment(checkIn, property.checkInTime);
    const checkedOutAt = istMoment(checkOut, property.checkOutTime);
    const partnerActor = { role: 'partner', id: property.partnerId };

    booking = new HotelBooking({
      bookingRef: stay.ref,
      userId: customer._id,
      propertyId: property._id,
      partnerId: property.partnerId,
      roomTypeId: roomType._id,
      ...(property.zoneId ? { zoneId: property.zoneId } : {}),
      snapshot: {
        propertyName: property.name,
        propertyType: property.propertyType,
        roomTypeName: roomType.name,
        address: addressLine(property),
        coverImage: property.coverImage,
        checkInTime: property.checkInTime,
        checkOutTime: property.checkOutTime,
        cancellationPolicy: {
          type: property.cancellationPolicy?.type || 'moderate',
          freeCancelHours: property.cancellationPolicy?.freeCancelHours ?? 24,
          refundPercentAfter: property.cancellationPolicy?.refundPercentAfter ?? 0,
        },
      },
      checkIn: toNightDate(checkIn),
      checkOut: toNightDate(checkOut),
      nights: nights.length,
      rooms,
      guests: { adults: stay.adults, children: 0 },
      guestDetails: {
        name: customer.name || 'KSG Demo Customer',
        phone: CUSTOMER_PHONE,
        ...(customer.email ? { email: customer.email } : {}),
      },
      pricing: priced.pricing,
      payment: {
        mode: 'pay_at_hotel',
        status: 'paid',
        amountPaid: total,
        amountDue: 0,
        walletAmount: 0,
        payNow: priced.payNow, // 0 for pay at hotel
        onlineAmount: 0,
        onlinePaid: 0,
        collectedAtHotel: total,
      },
      status: 'checked_out',
      statusHistory: [
        { status: 'confirmed', at: bookedAt, by: { role: 'user', id: customer._id }, note: `Pay at hotel (Rs ${priced.payAtHotel})` },
        { status: 'checked_in', at: checkedInAt, by: partnerActor },
        { status: 'checked_out', at: checkedOutAt, by: partnerActor, note: `Collected Rs ${total} at the hotel (demo data)` },
      ],
      notificationsSent: { checkInReminder: true, reviewRequest: true, paymentExpiryWarning: false },
      source: 'app',
      createdAt: bookedAt,
      updatedAt: checkedOutAt,
    });
    if (APPLY) await booking.save({ timestamps: false });
    else await booking.validate();
    bump('hotel_bookings', 'created');
    log('+', 'hotel_bookings', label, `(${checkIn} -> ${checkOut}, ${nights.length} night(s), ${stay.adults} adult(s), total Rs ${total}${APPLY ? '' : ', not written'})`);
  }

  // Inventory counter + ledger row for the stay's (past) nights, once per booking.
  const checkInStr = toDateString(booking.checkIn);
  const checkOutStr = toDateString(booking.checkOut);
  const hasLedger = await HotelAvailability.exists({ bookingId: booking._id });
  if (hasLedger) {
    bump('hotel_availability_ledger', 'unchanged');
  } else {
    const ledger = new HotelAvailability({
      propertyId: property._id,
      roomTypeId: roomType._id,
      source: 'platform',
      bookingId: booking._id,
      startDate: booking.checkIn,
      endDate: booking.checkOut,
      units: booking.rooms || 1,
      createdBy: 'system',
    });
    if (APPLY) {
      await ensureInventoryDays(roomType, checkInStr, checkOutStr);
      const capacityOk = await HotelInventoryDay.countDocuments({
        roomTypeId: roomType._id,
        date: { $gte: booking.checkIn, $lt: booking.checkOut },
        $expr: { $lte: [{ $add: ['$booked', booking.rooms || 1] }, '$capacity'] },
      });
      if (capacityOk === nightsBetween(checkInStr, checkOutStr).length) {
        await HotelInventoryDay.updateMany(
          { roomTypeId: roomType._id, date: { $gte: booking.checkIn, $lt: booking.checkOut } },
          { $inc: { booked: booking.rooms || 1 } },
        );
      } else {
        notes.push(`${stay.ref}: past nights already full, inventory counter not incremented (ledger row still written).`);
      }
      await ledger.save();
    } else {
      await ledger.validate();
    }
    bump('hotel_availability_ledger', 'created');
    log('+', 'hotel_availability_ledger', `  ${stay.ref} nights ${checkInStr} -> ${checkOutStr}`, APPLY ? '' : '(not written)');
  }

  // The review: one per booking (unique index), approved.
  const reviewedAt = new Date(booking.checkOut.getTime() + 1.6 * DAY_MS);
  const r = stay.review;
  const review = await upsert(HotelReview, {
    label: `  ${stay.ref} review (${r.rating}/5)`,
    filter: { bookingId: booking._id },
    insert: {
      userId: customer._id,
      propertyId: property._id,
      bookingId: booking._id,
      rating: r.rating,
      subRatings: r.sub,
      comment: r.comment,
      photos: [],
      ...(r.reply ? { reply: { text: r.reply, at: new Date(reviewedAt.getTime() + 6 * 60 * 60 * 1000) } } : {}),
      status: 'approved',
      createdAt: reviewedAt,
      updatedAt: reviewedAt,
    },
  });
  if (review && APPLY && String(booking.review || '') !== String(review._id)) {
    await HotelBooking.updateOne({ _id: booking._id }, { $set: { review: review._id } }, { timestamps: false });
  }
  return property._id;
}

async function seedHotels() {
  console.log('\n[3] Hotels: second demo partner and properties in other cities');
  const partner = await upsert(HotelPartner, {
    label: `${PARTNER.name} (${PARTNER.phone})`,
    filter: { phone: PARTNER.phone },
    insert: {
      phone: PARTNER.phone,
      name: PARTNER.name,
      kyc: PARTNER.kyc,
      bank: PARTNER.bank,
      address: PARTNER.address,
      email: PARTNER.email,
    },
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
  const properties = [];
  if (partner) {
    logins.push(['Hotel partner (Indore, Goa, Manali, Delhi)', PARTNER.phone, '/hotel/partner/login']);
    for (const spec of PROPERTIES) {
      const p = await seedHotelProperty(partner, spec);
      if (p) properties.push([spec.name, spec.address.city, p.slug, p._id]);
    }
  } else {
    notes.push('No second demo hotel partner, so no new demo properties were seeded.');
  }

  console.log('\n[4] Hotels: past stays and reviews on the Bhopal demo properties');
  const customer = await FoodUser.findOne({ phone: new RegExp(`${CUSTOMER_PHONE}$`) });
  const ratings = [];
  if (!customer) {
    notes.push(`Hotel reviews skipped: demo customer ${CUSTOMER_PHONE} not found (run seed-ksg.js --apply).`);
    console.log(`  ! demo customer ${CUSTOMER_PHONE} not found; reviews skipped`);
  } else {
    const settings = await getHotelSettings({ fresh: true });
    const touched = new Set();
    for (const stay of DEMO_STAYS) {
      const pid = await seedDemoStay({ stay, customer, settings });
      if (pid) touched.add(String(pid));
    }
    // avgRating / totalReviews from approved reviews, exactly as the review controller does.
    for (const pid of touched) {
      const property = await HotelProperty.findById(pid).select('name avgRating totalReviews').lean();
      if (APPLY) {
        const before = `${property.avgRating || 0}/${property.totalReviews || 0}`;
        const { avgRating, totalReviews } = await recomputePropertyRating(pid);
        const after = `${avgRating}/${totalReviews}`;
        bump('hotel_properties (rating)', before === after ? 'unchanged' : 'updated');
        ratings.push([property.name, after]);
      } else {
        const { avgRating, totalReviews } = await ratingSummary(pid);
        ratings.push([property.name, `${avgRating}/${totalReviews} now (recomputed on --apply)`]);
      }
    }
  }
  return { properties, ratings };
}

// ─────────────────────────────────────────────────────────────────── main ──

const run = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGO_URI / MONGODB_URI in environment.');
  await mongoose.connect(uri);
  console.log(`db: ${mongoose.connection.db.databaseName}   mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (nothing is written)'}${ONLINE ? '   --online' : ''}`);
  console.log('legend: + create   ~ update   = unchanged   ! skipped');

  await seedTaxi();
  await seedServiceProvider();
  const { properties, ratings } = await seedHotels();

  console.log('\n================ SUMMARY ================');
  console.log(`  ${'collection'.padEnd(30)} created  updated  unchanged  skipped`);
  for (const [coll, s] of stats) {
    console.log(`  ${coll.padEnd(30)} ${String(s.created).padStart(7)}  ${String(s.updated).padStart(7)}  ${String(s.unchanged).padStart(9)}  ${String(s.skipped).padStart(7)}`);
  }
  if (properties.length) {
    console.log('\nNew demo properties:');
    for (const [name, city, slug, id] of properties) console.log(`  ${name.padEnd(28)} ${city.padEnd(8)} /hotel/property/${slug}   (${id})`);
  }
  if (ratings.length) {
    console.log('\nBhopal demo property ratings (avg/count):');
    for (const [name, r] of ratings) console.log(`  ${name.padEnd(28)} ${r}`);
  }

  console.log('\nDemo logins (OTP 1234 while mock OTP is on):');
  for (const [role, phone, where] of logins) console.log(`  ${phone}  ${role.padEnd(58)} ${where}`);
  if (PROMO_CODES.length) {
    console.log('\nTaxi promo codes (India service location, taxi only):');
    for (const p of PROMO_CODES) console.log(`  ${p.code.padEnd(10)} ${p.note}`);
  }
  if (!ONLINE) {
    console.log('\nDrivers and workers were left OFFLINE / off duty. They appear in nearby search once they go');
    console.log('online in the app, or re-run with --apply --online to switch them on.');
  }

  if (notes.length) {
    console.log('\nNotes:');
    for (const note of notes) console.log(`  - ${note}`);
  }
  if (!APPLY) console.log('\nDRY RUN: nothing was written. Re-run with --apply.');
};

run()
  .catch((err) => {
    console.error('seed-ksg-more failed:', err?.message || err);
    if (err?.errors) {
      for (const [path, e] of Object.entries(err.errors)) console.error(`  ${path}: ${e.message}`);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
