/**
 * KSG demo catalogues for Quick Commerce (grocery) and Medical (pharmacy).
 *
 *   node scripts/seed-ksg-qc.js            # dry run (default): reads, validates, prints the plan
 *   node scripts/seed-ksg-qc.js --apply    # writes
 *
 * Run AFTER scripts/seed-ksg.js --apply. That script creates the India
 * qc_zones / medical_zones (same _id), the six global quick-commerce categories,
 * "KSG Demo Grocery" (9000000005) and "KSG Demo Pharmacy" (9000000006), all with
 * empty catalogues. This one fills them, and adds:
 *   - "KSG Daily Mart" (9000000201), a second grocery store in Bhopal;
 *   - "KSG Care Pharmacy" (9000000202), inside the default 5 km prescription
 *     radius of the demo customer's address, and "KSG Lifeline Medicos"
 *     (9000000203), deliberately outside it -- the same idea as
 *     scripts/seed-medical-stores.js, so widening the radius in the admin
 *     panel visibly pulls the far shop in.
 *
 * How the data is shaped (read from the models and the customer queries):
 *  - Products are qc_items (QCItem). Every product belongs to ONE store
 *    (restaurantId is required), so stores cannot share a catalogue: each store
 *    gets its own copy, keyed by its own SKU.
 *  - Pack sizes are `variants` (variantsEnabled: true). Stock is per variant
 *    when a product has sizes, else on the item (stockQty). The Stock manager
 *    screen (admin/services/stock.service.js) reads exactly those fields.
 *    A movement row (qc_stock_movements, reason "import") records each opening
 *    count, written only when the product is first created.
 *  - The customer listing (/qc/restaurant/public/foods), search
 *    (/qc/search/products) and store menu (/qc/restaurant/restaurants/:id/menu)
 *    show a product when its store is status "approved" and the product is
 *    approvalStatus "approved" and isAvailable !== false. The first two also
 *    exclude storeType "pharmacy", so medicines never leak into Quick Shop.
 *  - Grocery products use the six GLOBAL categories (top level only). The
 *    category model has a parentId for subcategories, but every customer read
 *    filters on the exact categoryId, so a product filed under a subcategory
 *    disappears from its parent's category page. Subcategories are skipped.
 *  - Medical categories are PRIVATE to each pharmacy (restaurantId set), the
 *    model's store-owned scope. Global categories would show "Fever & Pain"
 *    among the grocery categories.
 *  - There is no per-product prescription flag. A pharmacy order always needs
 *    an uploaded prescription (shared/prescriptionRules.js: requiresPrescription
 *    is decided by storeType). Prescription-only medicines are therefore marked
 *    in their description and SKU (KSG-RX-...) and capped per order.
 *  - Prices are INR, selling price <= MRP. Single-size products carry `mrp`;
 *    sized products carry each pack's MRP as that variant's `otherPrice` (the
 *    struck-through figure), because the panel refuses an item `mrp` lower
 *    than its dearest variant. GST rates are demo defaults (post-2025 slabs)
 *    and editable per product in the panel.
 *  - Names are generic (no real trademarks); "KSG Fresh" / "KSG Select" is the
 *    platform's own demo label. Images are placehold.co placeholders.
 *
 * Safety (same contract as seed-ksg.js):
 *  - Dry run by default. New documents are validated, not written.
 *  - Idempotent. Stores are matched by owner phone, categories by store + name,
 *    products by store + SKU (or name). Re-running changes nothing.
 *  - Additive only. Nothing is deleted. An existing PRODUCT or CATEGORY is
 *    left exactly as it is, so seller/admin edits (prices, stock) survive a
 *    re-run. On an existing demo STORE only the flags that make it visible are
 *    re-asserted (approved / accepting orders / zone / current licence).
 *  - A demo phone already used by a store with a DIFFERENT name is skipped with
 *    a warning, so this never approves or fills somebody else's shop.
 *  - Written through the models (doc.save()), so validation and hooks run.
 *
 * Note: the customer endpoints are response-cached (menu 10 min, listing 5 min,
 * search 30 s). After --apply on a running server, new products can take that
 * long to appear unless the cache is cleared.
 *
 * Demo logins: OTP 1234 while mock OTP is enabled. Turn mock OTP off before
 * real customers can reach these.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { QCZone } from '../src/modules/quickCommerce/modules/food/admin/models/zone.model.js';
import { MedicalZone } from '../src/modules/quickCommerce/modules/food/admin/models/medicalZone.model.js';
import { FoodCategory as QCCategory } from '../src/modules/quickCommerce/modules/food/admin/models/category.model.js';
import { FoodItem as QCItem } from '../src/modules/quickCommerce/modules/food/admin/models/food.model.js';
import { QCStockMovement } from '../src/modules/quickCommerce/modules/food/admin/models/stockMovement.model.js';
import { FoodRestaurant as QCRestaurant } from '../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');

// ─────────────────────────────────────────────────────────────── constants ──

const ZONE_NAME = 'India';
const SEED_TAG = 'seed-ksg-qc';

/** Bhopal centre, as in seed-ksg.js. The demo customer's address is near(0.5, 0.5). */
const BHOPAL = { lat: 23.2599, lng: 77.4126 };
const CUSTOMER_AT_KM = { north: 0.5, east: 0.5 };
const near = (northKm, eastKm) => ({
  lat: Number((BHOPAL.lat + northKm / 111).toFixed(6)),
  lng: Number((BHOPAL.lng + eastKm / (111 * Math.cos((BHOPAL.lat * Math.PI) / 180))).toFixed(6)),
});
const kmFromCustomer = (northKm, eastKm) =>
  Math.hypot(northKm - CUSTOMER_AT_KM.north, eastKm - CUSTOMER_AT_KM.east).toFixed(1);

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DEMO_IMAGE = 'https://placehold.co/800x500/png?text=KSG+Demo';
const DEMO_DOC = 'https://placehold.co/800x500/png?text=KSG+Demo+Document+(not+real)';
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

const PHONES = {
  customer: '9000000001',
  grocery: '9000000005',
  medical: '9000000006',
  dailyMart: '9000000201',
  carePharmacy: '9000000202',
  lifelinePharmacy: '9000000203',
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactName = (name) => new RegExp(`^\\s*${escapeRegex(name)}\\s*$`, 'i');
const imageFor = (label) => `https://placehold.co/600x600?text=${encodeURIComponent(label).replace(/%20/g, '+')}`;
const hasCoords = (loc) =>
  Array.isArray(loc?.coordinates) && loc.coordinates.length === 2
  && !(Number(loc.coordinates[0]) === 0 && Number(loc.coordinates[1]) === 0);

// ──────────────────────────────────────────────────────────── grocery data ──

/**
 * [sku, name, category, size, price, mrp, stock, gst, extra]
 * `size` is a pack-size string for a single-size product, or an array of
 * [variantName, price, mrp, stock] for a product sold in several sizes (then
 * the price/mrp/stock columns are null).
 * extra: { perish, nonVeg, brand, max, dm } -- dm: also stocked by KSG Daily Mart.
 */
const FRESH = { perish: 'fresh' };
const CHILLED = { perish: 'chilled' };

const GROCERY = [
  // Fruits & Vegetables
  ['KSG-G-001', 'Banana Robusta', 'Fruits & Vegetables', [['6 pcs', 42, 50, 40], ['12 pcs', 79, 96, 25]], null, null, null, 0, { ...FRESH, dm: 1 }],
  ['KSG-G-002', 'Shimla Apple (4 pcs, approx 500 g)', 'Fruits & Vegetables', '4 pcs', 119, 140, 30, 0, FRESH],
  ['KSG-G-003', 'Onion', 'Fruits & Vegetables', [['1 kg', 39, 49, 80], ['2 kg', 75, 96, 40]], null, null, null, 0, { ...FRESH, dm: 1 }],
  ['KSG-G-004', 'Potato', 'Fruits & Vegetables', [['1 kg', 32, 40, 80], ['2 kg', 60, 78, 40]], null, null, null, 0, { ...FRESH, dm: 1 }],
  ['KSG-G-005', 'Hybrid Tomato', 'Fruits & Vegetables', '500 g', 24, 30, 60, 0, { ...FRESH, dm: 1 }],
  ['KSG-G-006', 'Green Chilli', 'Fruits & Vegetables', '100 g', 12, 15, 50, 0, FRESH],
  ['KSG-G-007', 'Coriander Leaves', 'Fruits & Vegetables', '100 g', 15, 20, 40, 0, { ...FRESH, dm: 1 }],
  ['KSG-G-008', 'Lemon', 'Fruits & Vegetables', '4 pcs', 22, 28, 50, 0, FRESH],
  ['KSG-G-009', 'Orange Carrot', 'Fruits & Vegetables', '500 g', 35, 45, 40, 0, FRESH],

  // Dairy & Bread
  ['KSG-G-010', 'KSG Fresh Toned Milk', 'Dairy & Bread', [['500 ml', 27, 28, 100], ['1 L', 54, 56, 60]], null, null, null, 0, { ...CHILLED, brand: 'KSG Fresh', dm: 1 }],
  ['KSG-G-011', 'KSG Fresh Full Cream Milk', 'Dairy & Bread', '500 ml', 33, 34, 80, 0, { ...CHILLED, brand: 'KSG Fresh' }],
  ['KSG-G-012', 'KSG Fresh Set Curd', 'Dairy & Bread', '400 g', 35, 40, 50, 5, { ...CHILLED, brand: 'KSG Fresh', dm: 1 }],
  ['KSG-G-013', 'KSG Fresh Malai Paneer', 'Dairy & Bread', '200 g', 85, 95, 40, 0, { ...CHILLED, brand: 'KSG Fresh', dm: 1 }],
  ['KSG-G-014', 'Salted Table Butter', 'Dairy & Bread', '100 g', 56, 58, 60, 5, { ...CHILLED, brand: 'KSG Select' }],
  ['KSG-G-015', 'Whole Wheat Brown Bread', 'Dairy & Bread', '400 g', 45, 50, 30, 0, { ...CHILLED, dm: 1 }],
  ['KSG-G-016', 'White Sandwich Bread', 'Dairy & Bread', '400 g', 40, 45, 30, 0, CHILLED],
  ['KSG-G-017', 'Farm Fresh Eggs', 'Dairy & Bread', [['6 pcs', 48, 54, 50], ['12 pcs', 92, 105, 30]], null, null, null, 0, { ...CHILLED, nonVeg: 1, dm: 1 }],
  ['KSG-G-018', 'Processed Cheese Slices (10 slices)', 'Dairy & Bread', '200 g', 135, 150, 40, 5, { ...CHILLED, brand: 'KSG Select' }],

  // Snacks
  ['KSG-G-019', 'Classic Salted Potato Chips', 'Snacks', '52 g', 20, 20, 120, 5, { dm: 1 }],
  ['KSG-G-020', 'Masala Potato Chips', 'Snacks', '52 g', 20, 20, 120, 5, {}],
  ['KSG-G-021', 'Aloo Bhujia', 'Snacks', [['200 g', 55, 60, 60], ['400 g', 99, 110, 40]], null, null, null, 5, { dm: 1 }],
  ['KSG-G-022', 'Roasted Salted Peanuts', 'Snacks', '200 g', 60, 70, 60, 5, {}],
  ['KSG-G-023', 'Marie Tea Biscuits', 'Snacks', '250 g', 35, 40, 100, 5, { dm: 1 }],
  ['KSG-G-024', 'Chocolate Cream Biscuits', 'Snacks', '120 g', 30, 30, 100, 5, {}],
  ['KSG-G-025', 'Masala Instant Noodles', 'Snacks', [['70 g', 14, 15, 150], ['Pack of 4 (280 g)', 56, 60, 60]], null, null, null, 5, { dm: 1 }],
  ['KSG-G-026', 'Salted Roasted Cashews', 'Snacks', '100 g', 145, 165, 40, 5, {}],
  ['KSG-G-027', 'Dark Chocolate 50% Cocoa', 'Snacks', '80 g', 95, 110, 50, 5, {}],

  // Beverages
  ['KSG-G-028', 'Assam CTC Tea', 'Beverages', [['250 g', 135, 150, 60], ['500 g', 260, 290, 40]], null, null, null, 5, { dm: 1 }],
  ['KSG-G-029', 'Instant Coffee Jar', 'Beverages', '50 g', 165, 185, 40, 5, {}],
  ['KSG-G-030', 'Mango Fruit Drink', 'Beverages', '1.2 L', 75, 80, 50, 5, { dm: 1 }],
  ['KSG-G-031', 'Cola Soft Drink', 'Beverages', '750 ml', 40, 40, 80, 40, {}],
  ['KSG-G-032', 'Packaged Drinking Water', 'Beverages', [['1 L', 20, 20, 150], ['6 x 1 L', 110, 120, 40]], null, null, null, 5, { dm: 1 }],
  ['KSG-G-033', 'Orange Juice, No Added Sugar', 'Beverages', '1 L', 125, 140, 40, 5, {}],
  ['KSG-G-034', 'Lemon Iced Tea', 'Beverages', '300 ml', 30, 30, 60, 5, {}],

  // Staples
  ['KSG-G-035', 'Basmati Rice', 'Staples', [['1 kg', 145, 170, 60], ['5 kg', 650, 780, 25]], null, null, null, 5, { brand: 'KSG Select', dm: 1 }],
  ['KSG-G-036', 'Sona Masoori Rice', 'Staples', '5 kg', 399, 460, 25, 5, { brand: 'KSG Select' }],
  ['KSG-G-037', 'Whole Wheat Atta', 'Staples', [['5 kg', 245, 285, 40], ['10 kg', 470, 540, 20]], null, null, null, 5, { brand: 'KSG Select', dm: 1 }],
  ['KSG-G-038', 'Toor Dal', 'Staples', '1 kg', 165, 185, 50, 5, { brand: 'KSG Select', dm: 1 }],
  ['KSG-G-039', 'Moong Dal', 'Staples', '1 kg', 145, 165, 40, 5, { brand: 'KSG Select' }],
  ['KSG-G-040', 'Chana Dal', 'Staples', '1 kg', 98, 115, 40, 5, { brand: 'KSG Select', dm: 1 }],
  ['KSG-G-041', 'Refined Sunflower Oil', 'Staples', [['1 L', 155, 175, 50], ['5 L', 745, 850, 15]], null, null, null, 5, { dm: 1 }],
  ['KSG-G-042', 'Kachi Ghani Mustard Oil', 'Staples', '1 L', 175, 195, 40, 5, {}],
  ['KSG-G-043', 'Sugar', 'Staples', '1 kg', 48, 55, 80, 5, { dm: 1 }],
  ['KSG-G-044', 'Iodised Salt', 'Staples', '1 kg', 25, 28, 80, 0, { dm: 1 }],
  ['KSG-G-045', 'Turmeric Powder', 'Staples', '100 g', 38, 45, 60, 5, { dm: 1 }],
  ['KSG-G-046', 'Red Chilli Powder', 'Staples', '100 g', 45, 52, 60, 5, {}],
  ['KSG-G-047', 'Pure Cow Ghee', 'Staples', '500 ml', 340, 375, 30, 5, { brand: 'KSG Fresh' }],

  // Personal Care
  ['KSG-G-048', 'Neem Bath Soap (4 x 100 g)', 'Personal Care', 'Pack of 4', 140, 160, 50, 5, { dm: 1 }],
  ['KSG-G-049', 'Herbal Shampoo', 'Personal Care', '180 ml', 145, 170, 40, 5, {}],
  ['KSG-G-050', 'Mint Fluoride Toothpaste', 'Personal Care', [['100 g', 55, 60, 60], ['200 g', 105, 115, 40]], null, null, null, 5, { dm: 1 }],
  ['KSG-G-051', 'Soft Bristle Toothbrush', 'Personal Care', 'Pack of 2', 60, 70, 50, 5, {}],
  ['KSG-G-052', 'Liquid Hand Wash Refill', 'Personal Care', '750 ml', 99, 125, 40, 5, { dm: 1 }],
  ['KSG-G-053', 'Coconut Hair Oil', 'Personal Care', '200 ml', 95, 110, 40, 5, {}],
  ['KSG-G-054', 'Sanitary Pads XL', 'Personal Care', '7 pcs', 40, 45, 50, 0, {}],
];

const GROCERY_DESCRIPTIONS = {
  'Fruits & Vegetables': 'Fresh, sorted and packed the same day.',
  'Dairy & Bread': 'Kept chilled from store to door.',
  Snacks: 'Sealed pack.',
  Beverages: 'Sealed pack.',
  Staples: 'Cleaned and packed. Store in a cool, dry place.',
  'Personal Care': 'Sealed pack. For external use as directed on the label.',
};

// ──────────────────────────────────────────────────────────── medical data ──

/** Medical categories, private to each pharmacy. */
const MEDICAL_CATEGORIES = [
  'Fever & Pain Relief',
  'Cold, Cough & Allergy',
  'Digestive Care',
  'Vitamins & Supplements',
  'First Aid',
  'Health Devices',
  'Prescription Medicines',
];

/**
 * [sku, name, category, packSize, price, mrp, stock, gst, extra]
 * extra: { rx, nonVeg, lite, desc } -- lite: also stocked by the two extra pharmacies.
 * Generic (salt) names only. rx = prescription-only (Schedule H in India).
 */
const MEDICAL = [
  // Fever & Pain Relief
  ['KSG-M-001', 'Paracetamol 500 mg Tablet', 'Fever & Pain Relief', 'Strip of 10', 16, 18, 120, 5, { lite: 1, desc: 'For fever and mild to moderate pain. Do not exceed 4 g a day.' }],
  ['KSG-M-002', 'Paracetamol 650 mg Tablet', 'Fever & Pain Relief', 'Strip of 15', 30, 34, 100, 5, { lite: 1, desc: 'For fever and body ache. Keep at least 4 hours between doses.' }],
  ['KSG-RX-003', 'Ibuprofen 400 mg Tablet', 'Fever & Pain Relief', 'Strip of 10', 22, 26, 60, 5, { rx: 1, desc: 'Anti-inflammatory pain relief. Take after food.' }],
  ['KSG-M-004', 'Diclofenac Pain Relief Gel 1%', 'Fever & Pain Relief', '30 g tube', 95, 110, 50, 5, { lite: 1, desc: 'For muscle and joint pain. For external use only.' }],

  // Cold, Cough & Allergy
  ['KSG-RX-005', 'Cetirizine 10 mg Tablet', 'Cold, Cough & Allergy', 'Strip of 10', 20, 24, 80, 5, { rx: 1, desc: 'Antihistamine for allergy and sneezing. May cause drowsiness.' }],
  ['KSG-M-006', 'Honey Tulsi Ayurvedic Cough Syrup', 'Cold, Cough & Allergy', '100 ml', 95, 110, 50, 5, { lite: 1, desc: 'Soothes throat irritation and dry cough.' }],
  ['KSG-M-007', 'Steam Inhalation Capsules', 'Cold, Cough & Allergy', 'Strip of 10', 45, 50, 60, 5, { desc: 'Add one capsule to hot water and inhale the vapour. Do not swallow.' }],
  ['KSG-M-008', 'Ginger Throat Lozenges', 'Cold, Cough & Allergy', 'Pack of 8', 30, 35, 80, 5, {}],
  ['KSG-M-009', 'Menthol Vapour Rub', 'Cold, Cough & Allergy', '25 ml', 80, 90, 60, 5, { lite: 1, desc: 'For blocked nose and chest congestion. For external use only.' }],
  ['KSG-M-010', 'Saline Nasal Spray 0.65%', 'Cold, Cough & Allergy', '20 ml', 99, 115, 40, 5, {}],

  // Digestive Care
  ['KSG-M-011', 'ORS Electrolyte Powder, Orange (WHO formula)', 'Digestive Care', [['1 sachet (21 g)', 21, 22, 150], ['Pack of 5 sachets', 100, 110, 60]], null, null, null, 5, { lite: 1, desc: 'Dissolve one sachet in 1 litre of clean drinking water. For dehydration from diarrhoea or heat.' }],
  ['KSG-M-012', 'Antacid Gel, Mint', 'Digestive Care', '170 ml', 105, 120, 50, 5, { lite: 1, desc: 'For acidity and heartburn. Shake well before use.' }],
  ['KSG-M-013', 'Psyllium Husk (Isabgol)', 'Digestive Care', '100 g', 110, 125, 40, 5, { desc: 'Fibre supplement for constipation. Take with plenty of water.' }],
  ['KSG-RX-014', 'Omeprazole 20 mg Capsule', 'Digestive Care', 'Strip of 15', 55, 65, 60, 5, { rx: 1, desc: 'For acidity and ulcers. Take before breakfast.' }],
  ['KSG-RX-015', 'Pantoprazole 40 mg Tablet', 'Digestive Care', 'Strip of 15', 120, 140, 60, 5, { rx: 1, desc: 'For acid reflux and gastritis. Take before a meal.' }],

  // Vitamins & Supplements
  ['KSG-M-016', 'Vitamin C 500 mg Chewable Tablet', 'Vitamins & Supplements', 'Strip of 15', 30, 35, 100, 18, { lite: 1 }],
  ['KSG-M-017', 'Multivitamin & Multimineral Tablet', 'Vitamins & Supplements', '30 tablets', 299, 350, 40, 18, { lite: 1 }],
  ['KSG-RX-018', 'Cholecalciferol (Vitamin D3) 60,000 IU Capsule', 'Vitamins & Supplements', 'Strip of 4', 110, 130, 50, 5, { rx: 1, desc: 'High-dose vitamin D3. Usually once a week, as prescribed.' }],
  ['KSG-M-019', 'Calcium Carbonate + Vitamin D3 Tablet', 'Vitamins & Supplements', 'Strip of 15', 120, 135, 60, 5, {}],
  ['KSG-M-020', 'Omega-3 Fish Oil 1000 mg Capsule', 'Vitamins & Supplements', '60 capsules', 499, 599, 30, 18, { nonVeg: 1 }],

  // First Aid
  ['KSG-M-021', 'Povidone-Iodine Antiseptic Solution 5%', 'First Aid', '100 ml', 99, 115, 50, 5, { lite: 1, desc: 'For cleaning cuts and wounds. For external use only.' }],
  ['KSG-M-022', 'Chloroxylenol Antiseptic Liquid', 'First Aid', '250 ml', 120, 135, 50, 5, { desc: 'Dilute before use on skin. For external use only.' }],
  ['KSG-M-023', 'Adhesive Bandage Strips', 'First Aid', 'Pack of 20', 40, 45, 80, 5, { lite: 1 }],
  ['KSG-M-024', 'Crepe Bandage 10 cm', 'First Aid', '1 roll', 145, 165, 30, 5, {}],
  ['KSG-M-025', 'Absorbent Cotton Wool', 'First Aid', '100 g', 65, 75, 50, 5, {}],
  ['KSG-RX-026', 'Silver Sulfadiazine 1% Burn Cream', 'First Aid', '25 g tube', 85, 95, 30, 5, { rx: 1, desc: 'For burns and wound infection. Apply as directed by a doctor.' }],
  ['KSG-M-027', 'Hand Sanitizer, 70% Alcohol', 'First Aid', '500 ml', 199, 250, 40, 18, { lite: 1, desc: 'Flammable. Keep away from fire.' }],

  // Health Devices
  ['KSG-M-028', 'Digital Thermometer', 'Health Devices', '1 unit', 249, 350, 25, 5, { lite: 1, desc: 'Oral or underarm reading in about 60 seconds. Battery included.' }],
  ['KSG-M-029', '3-Ply Disposable Face Masks', 'Health Devices', 'Pack of 50', 199, 299, 40, 5, { lite: 1 }],
  ['KSG-M-030', 'Fingertip Pulse Oximeter', 'Health Devices', '1 unit', 999, 1499, 15, 5, { desc: 'Shows SpO2 and pulse rate. Not a substitute for medical advice.' }],

  // Prescription Medicines
  ['KSG-RX-031', 'Amoxicillin 500 mg Capsule', 'Prescription Medicines', 'Strip of 10', 89, 105, 40, 5, { rx: 1, lite: 1, desc: 'Antibiotic. Complete the full course as prescribed.' }],
  ['KSG-RX-032', 'Azithromycin 500 mg Tablet', 'Prescription Medicines', 'Strip of 3', 72, 85, 40, 5, { rx: 1, desc: 'Antibiotic. Complete the full course as prescribed.' }],
  ['KSG-RX-033', 'Metformin 500 mg Tablet', 'Prescription Medicines', 'Strip of 20', 35, 42, 60, 5, { rx: 1, lite: 1, desc: 'For type 2 diabetes. Take with meals.' }],
  ['KSG-RX-034', 'Amlodipine 5 mg Tablet', 'Prescription Medicines', 'Strip of 15', 40, 48, 60, 5, { rx: 1, desc: 'For high blood pressure. Do not stop without asking your doctor.' }],
];

const RX_NOTE = 'Prescription required (Schedule H): the pharmacist checks your prescription before this is dispatched.';
const OTC_NOTE = 'Read the label before use. Ask a doctor if symptoms persist.';

// ─────────────────────────────────────────────────────────────── machinery ──

const stats = new Map();
const notes = [];
const bump = (coll, key, n = 1) => {
  if (!stats.has(coll)) stats.set(coll, { created: 0, updated: 0, unchanged: 0, skipped: 0 });
  stats.get(coll)[key] += n;
};
const log = (sym, coll, label, extra = '') =>
  console.log(`  ${sym} ${coll.padEnd(22)} ${label}${extra ? `  ${extra}` : ''}`);

/**
 * Find by `filter`; create from insert+enforce when missing, otherwise apply
 * `enforce` only. Same semantics as seed-ksg.js, plus `onCreate(doc)`, called
 * after a NEW document is actually written (never in a dry run).
 */
async function upsert(Model, { label, filter, insert = {}, enforce = {}, fixup, guard, onCreate, quiet = false }) {
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
    if (!quiet) log('=', coll, label, `(${doc._id})`);
    return doc;
  }

  const changed = isNew ? '' : `fields: ${doc.directModifiedPaths().join(', ')}`;
  if (APPLY) await doc.save();
  else await doc.validate();

  bump(coll, isNew ? 'created' : 'updated');
  log(isNew ? '+' : '~', coll, label, isNew ? `(${doc._id}${APPLY ? '' : ', not written'})` : changed);
  if (isNew && APPLY && onCreate) await onCreate(doc);
  return doc;
}

const sameName = (field, expected) => (existing) => {
  const actual = String(existing?.[field] || '').trim();
  return actual && actual.toLowerCase() !== expected.toLowerCase()
    ? `phone already belongs to "${actual}", not "${expected}"`
    : null;
};

const sellerLocation = (at, address) => ({
  type: 'Point',
  coordinates: [at.lng, at.lat],
  latitude: at.lat,
  longitude: at.lng,
  formattedAddress: `${address.addressLine1}, ${address.area}, ${address.city}, ${address.state} ${address.pincode}`,
  address: `${address.addressLine1}, ${address.area}, ${address.city}`,
  ...address,
});

/** Opening-stock rows for the Stock manager's history, one per tracked size. */
async function recordOpeningStock(item) {
  const rows = (item.variants || []).length
    ? item.variants
      .filter((v) => v.stockQty !== null && v.stockQty !== undefined)
      .map((v) => ({ variantId: String(v._id), variantName: v.name, qty: v.stockQty }))
    : (item.stockQty !== null && item.stockQty !== undefined
      ? [{ variantId: '', variantName: '', qty: item.stockQty }]
      : []);
  for (const row of rows) {
    await QCStockMovement.create({
      restaurantId: item.restaurantId,
      itemId: item._id,
      variantId: row.variantId,
      itemName: item.name,
      variantName: row.variantName,
      delta: row.qty,
      after: row.qty,
      reason: 'import',
      note: 'Opening stock (demo seed)',
      actor: { role: 'system', id: '', name: SEED_TAG },
    });
  }
  bump(QCStockMovement.collection.collectionName, 'created', rows.length);
}

/**
 * The qc_items document for one catalogue row.
 * `stockScale` lets a smaller store carry smaller counts.
 */
function itemDoc(store, row, { category, isMedical, stockScale = 1 }) {
  const [sku, name, categoryName, size, price, mrp, stock, gst, extra = {}] = row;
  const scale = (n) => Math.max(5, Math.round(n * stockScale));
  const sized = Array.isArray(size);
  const lowAt = (qty) => Math.max(3, Math.round(qty * 0.15));
  const image = imageFor(name);

  const description = isMedical
    ? [extra.desc, extra.rx ? RX_NOTE : OTC_NOTE].filter(Boolean).join(' ')
    : GROCERY_DESCRIPTIONS[categoryName] || '';

  const base = {
    restaurantId: store._id,
    categoryId: category?._id,
    categoryName,
    name,
    description,
    image,
    images: [image],
    foodType: extra.nonVeg ? 'Non-Veg' : 'Veg',
    brand: extra.brand || '',
    sku,
    gstRate: gst,
    perishability: extra.perish || 'ambient',
    isAvailable: true,
    approvalStatus: 'approved',
    approvedAt: new Date(),
    // Medicines: one printed batch expiry, well clear of the "expiring soon" window.
    expiryDate: isMedical ? new Date(Date.now() + 18 * MONTH_MS) : null,
    maxQtyPerOrder: isMedical ? (extra.rx ? 2 : 5) : (extra.perish === 'fresh' ? 5 : 10),
  };

  if (!sized) {
    const qty = scale(stock);
    return {
      ...base,
      packSize: size,
      price,
      mrp,
      variantsEnabled: false,
      variants: [],
      stockQty: qty,
      lowStockThreshold: lowAt(qty),
    };
  }

  const variants = size.map(([variantName, vPrice, vMrp, vStock], index) => {
    const qty = scale(vStock);
    return {
      name: variantName,
      price: vPrice,
      // Per-pack MRP as the struck-through price (see header).
      otherPrice: vMrp,
      stockQty: qty,
      lowStockThreshold: lowAt(qty),
      sku: `${sku}-${index + 1}`,
      gstRate: null,
    };
  });
  return {
    ...base,
    packSize: size.map(([variantName]) => variantName).join(' / '),
    price: Math.min(...variants.map((v) => v.price)),
    mrp: null,
    variantsEnabled: true,
    variants,
    // Stock lives on the sizes; the item-level count stays untracked.
    stockQty: null,
    lowStockThreshold: null,
  };
}

async function seedProducts(store, rows, { categories, isMedical, stockScale }) {
  let count = 0;
  for (const row of rows) {
    const [sku, name, categoryName] = row;
    const category = categories.get(categoryName);
    if (!category) {
      notes.push(`${store.restaurantName}: no category "${categoryName}" -- "${name}" skipped`);
      bump('qc_items', 'skipped');
      continue;
    }
    await upsert(QCItem, {
      label: `${store.restaurantName} / ${name}`,
      filter: { restaurantId: store._id, $or: [{ sku }, { name: exactName(name) }] },
      insert: itemDoc(store, row, { category, isMedical, stockScale }),
      onCreate: recordOpeningStock,
      quiet: true,
    });
    count += 1;
  }
  return count;
}

// ───────────────────────────────────────────────────────────────── seeding ──

async function loadZones() {
  const qcZone = await QCZone.findOne({ name: ZONE_NAME });
  const medicalZone = await MedicalZone.findOne({ name: ZONE_NAME });
  if (!qcZone || !medicalZone) {
    throw new Error(`No "${ZONE_NAME}" qc_zones / medical_zones row. Run "node scripts/seed-ksg.js --apply" first.`);
  }
  return { qcZone, medicalZone };
}

/** The six global quick-commerce categories. Created only if seed-ksg.js has not. */
async function seedGroceryCategories() {
  console.log('\n[1] Quick-commerce categories (global, top level)');
  const names = [...new Set(GROCERY.map((row) => row[2]))];
  const byName = new Map();
  for (const [index, name] of names.entries()) {
    const doc = await upsert(QCCategory, {
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
    byName.set(name, doc);
  }
  return byName;
}

/** Store-private medical categories for one pharmacy. */
async function seedMedicalCategories(pharmacy) {
  const byName = new Map();
  for (const [index, name] of MEDICAL_CATEGORIES.entries()) {
    const doc = await upsert(QCCategory, {
      label: `${pharmacy.restaurantName} / ${name}`,
      filter: { restaurantId: pharmacy._id, name: exactName(name) },
      insert: {
        name,
        image: imageFor(name),
        foodTypeScope: 'Both',
        restaurantId: pharmacy._id,
        createdByRestaurantId: pharmacy._id,
        approvalStatus: 'approved',
        isApproved: true,
        approvedAt: new Date(),
        isActive: true,
        sortOrder: index + 1,
      },
      quiet: true,
    });
    byName.set(name, doc);
  }
  return byName;
}

/** An existing demo store from seed-ksg.js. Never created here. */
async function findExistingStore(phone, name) {
  const store = await QCRestaurant.findOne({ $or: [{ ownerPhone: phone }, { primaryContactNumber: phone }] });
  if (!store) {
    notes.push(`"${name}" (${phone}) not found -- run "node scripts/seed-ksg.js --apply" first; its catalogue was skipped.`);
    bump('qc_restaurants', 'skipped');
    log('!', 'qc_restaurants', `${name} (${phone})`, 'SKIPPED: not found (run seed-ksg.js --apply first)');
    return null;
  }
  const reason = sameName('restaurantName', name)(store);
  if (reason) {
    notes.push(`qc_restaurants "${name}" skipped: ${reason}`);
    bump('qc_restaurants', 'skipped');
    log('!', 'qc_restaurants', `${name} (${phone})`, `SKIPPED: ${reason}`);
    return null;
  }
  bump('qc_restaurants', 'unchanged');
  log('=', 'qc_restaurants', `${name} (${phone})`, `(${store._id}, from seed-ksg.js)`);
  return store;
}

/** A new demo store owned by this script. */
async function upsertStore({ name, phone, storeType, at, address, zone, licence, eta }) {
  const licenceExpiry = () => new Date(Date.now() + 3 * YEAR_MS);
  const isPharmacy = storeType === 'pharmacy';
  return upsert(QCRestaurant, {
    label: `${name} (${phone})`,
    filter: { $or: [{ ownerPhone: phone }, { primaryContactNumber: phone }] },
    guard: sameName('restaurantName', name),
    insert: {
      restaurantName: name,
      ownerName: `${name} Owner`,
      ownerEmail: `ksg.demo.${phone}@example.com`,
      ownerPhone: phone,
      primaryContactNumber: phone,
      pureVegRestaurant: false,
      storeType,
      ...(isPharmacy
        ? {
          // Placeholders, clearly not real (same convention as seed-ksg.js).
          drugLicenseNumber: licence,
          drugLicenseImage: DEMO_DOC,
          drugLicenseExpiry: licenceExpiry(),
          estimatedDeliveryTimeMinutes: 15,
        }
        : { storageCapability: ['chilled'] }),
      ...address,
      openingTime: '00:00',
      closingTime: '23:59',
      openDays: ALL_DAYS,
      estimatedDeliveryTime: eta,
      autoAcceptOrders: false,
      outsideHoursOverride: false,
      profileImage: DEMO_IMAGE,
      storePhotos: { front: DEMO_IMAGE },
      location: sellerLocation(at, address),
    },
    enforce: { status: 'approved', isAcceptingOrders: true, storeType, zoneId: zone._id },
    fixup: (doc) => {
      if (!doc.approvedAt) doc.approvedAt = new Date();
      if (doc.rejectionReason) doc.rejectionReason = '';
      if (!hasCoords(doc.location)) doc.location = sellerLocation(at, address);
      if (isPharmacy) {
        if (!doc.drugLicenseNumber) doc.drugLicenseNumber = licence;
        if (!doc.drugLicenseImage) doc.drugLicenseImage = DEMO_DOC;
        const expiry = doc.drugLicenseExpiry ? new Date(doc.drugLicenseExpiry) : null;
        if (!expiry || expiry.getTime() <= Date.now()) doc.drugLicenseExpiry = licenceExpiry();
      }
    },
  });
}

const BHOPAL_ADDRESS = (addressLine1, area, pincode) => ({
  addressLine1, area, city: 'Bhopal', state: 'Madhya Pradesh', pincode,
});

async function seedGrocery({ qcZone }, groceryCategories) {
  console.log('\n[2] Grocery stores and catalogues');
  const result = [];

  const demo = await findExistingStore(PHONES.grocery, 'KSG Demo Grocery');
  if (demo) {
    const n = await seedProducts(demo, GROCERY, { categories: groceryCategories, isMedical: false, stockScale: 1 });
    result.push(['KSG Demo Grocery', PHONES.grocery, n]);
  }

  const dailyMartAt = { north: -2.0, east: 2.5 };
  const dailyMart = await upsertStore({
    name: 'KSG Daily Mart',
    phone: PHONES.dailyMart,
    storeType: 'grocery',
    at: near(dailyMartAt.north, dailyMartAt.east),
    address: BHOPAL_ADDRESS('E-5 Main Road', 'Arera Colony', '462016'),
    zone: qcZone,
    eta: '10-20 mins',
  });
  if (dailyMart) {
    // Products belong to one store, so the Daily Mart gets its own (smaller) copy.
    const rows = GROCERY.filter((row) => row[8]?.dm);
    const n = await seedProducts(dailyMart, rows, { categories: groceryCategories, isMedical: false, stockScale: 0.6 });
    result.push(['KSG Daily Mart', PHONES.dailyMart, n]);
  }
  return result;
}

async function seedPharmacies({ medicalZone }) {
  console.log('\n[3] Pharmacies, private medical categories and catalogues');
  const result = [];

  const demo = await findExistingStore(PHONES.medical, 'KSG Demo Pharmacy');
  if (demo) {
    const categories = await seedMedicalCategories(demo);
    const n = await seedProducts(demo, MEDICAL, { categories, isMedical: true, stockScale: 1 });
    result.push(['KSG Demo Pharmacy', PHONES.medical, n, `${kmFromCustomer(-1.0, -0.7)} km`]);
  }

  // Placed against the demo customer's address: one more inside the default
  // 5 km prescription radius, one beyond it (see seed-medical-stores.js).
  const extra = [
    {
      name: 'KSG Care Pharmacy', phone: PHONES.carePharmacy, km: { north: 2.2, east: -1.3 },
      address: BHOPAL_ADDRESS('Shop 4, Main Market', 'New Market', '462003'),
    },
    {
      // Deliberately outside the default 5 km.
      name: 'KSG Lifeline Medicos', phone: PHONES.lifelinePharmacy, km: { north: -6.0, east: 5.5 },
      address: BHOPAL_ADDRESS('Plot 12, Hoshangabad Road', 'Misrod', '462026'),
    },
  ];
  for (const shop of extra) {
    const store = await upsertStore({
      name: shop.name,
      phone: shop.phone,
      storeType: 'pharmacy',
      at: near(shop.km.north, shop.km.east),
      address: shop.address,
      zone: medicalZone,
      licence: `DEMO-DL-KSG-${shop.phone.slice(-4)}`,
      eta: '15-25 mins',
    });
    if (!store) continue;
    const categories = await seedMedicalCategories(store);
    const rows = MEDICAL.filter((row) => row[8]?.lite);
    const n = await seedProducts(store, rows, { categories, isMedical: true, stockScale: 0.7 });
    result.push([shop.name, shop.phone, n, `${kmFromCustomer(shop.km.north, shop.km.east)} km`]);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────── main ──

const run = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI / MONGO_URI in environment.');
  if (process.env.MONGODB_URI && process.env.MONGO_URI && process.env.MONGODB_URI !== process.env.MONGO_URI) {
    console.warn('WARNING: MONGODB_URI and MONGO_URI differ. This script uses MONGODB_URI; the API server uses MONGO_URI.');
  }
  await mongoose.connect(uri);
  console.log(`db: ${mongoose.connection.db.databaseName}   mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (nothing is written)'}`);
  console.log('legend: + create   ~ update   = unchanged   ! skipped   (unchanged products/categories are counted, not listed)');

  const zones = await loadZones();
  const groceryCategories = await seedGroceryCategories();
  const groceries = await seedGrocery(zones, groceryCategories);
  const pharmacies = await seedPharmacies(zones);

  console.log('\n================ SUMMARY ================');
  console.log(`Catalogue rows: ${GROCERY.length} grocery products (${GROCERY.filter((r) => r[8]?.dm).length} at KSG Daily Mart), `
    + `${MEDICAL.length} medical products (${MEDICAL.filter((r) => r[8]?.rx).length} prescription-only; `
    + `${MEDICAL.filter((r) => r[8]?.lite).length} at the two extra pharmacies)`);

  console.log('\nPer collection:');
  console.log(`  ${'collection'.padEnd(24)} created  updated  unchanged  skipped`);
  for (const [coll, s] of stats) {
    console.log(`  ${coll.padEnd(24)} ${String(s.created).padStart(7)}  ${String(s.updated).padStart(7)}  ${String(s.unchanged).padStart(9)}  ${String(s.skipped).padStart(7)}`);
  }

  console.log('\nStores:');
  console.log(`  ${'store'.padEnd(22)} ${'owner'.padEnd(11)} products  from demo customer`);
  for (const [name, phone, n, km = ''] of [...groceries, ...pharmacies]) {
    console.log(`  ${name.padEnd(22)} ${phone.padEnd(11)} ${String(n).padStart(8)}  ${km}`);
  }

  console.log('\nDemo logins (OTP 1234 while mock OTP is on):');
  const logins = [
    [PHONES.customer, 'Customer (Quick Shop + Medical tabs)', '/food/user/auth/login'],
    [PHONES.grocery, 'KSG Demo Grocery (store)', '/partner/login/store'],
    [PHONES.dailyMart, 'KSG Daily Mart (store)', '/partner/login/store'],
    [PHONES.medical, 'KSG Demo Pharmacy (medical store)', '/partner/login/medical'],
    [PHONES.carePharmacy, 'KSG Care Pharmacy (medical store)', '/partner/login/medical'],
    [PHONES.lifelinePharmacy, 'KSG Lifeline Medicos (medical store)', '/partner/login/medical'],
  ];
  for (const [phone, role, where] of logins) console.log(`  ${phone}  ${role.padEnd(40)} ${where}`);

  if (notes.length) {
    console.log('\nNotes:');
    for (const note of notes) console.log(`  - ${note}`);
  }
  if (APPLY) console.log('\nCustomer endpoints are cached (menu 10 min, listing 5 min, search 30 s); new items may take that long to show.');
  else console.log('\nDRY RUN: nothing was written. Re-run with --apply.');
};

run()
  .catch((err) => {
    console.error('seed-ksg-qc failed:', err?.message || err);
    if (err?.errors) {
      for (const [path, e] of Object.entries(err.errors)) console.error(`  ${path}: ${e.message}`);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
