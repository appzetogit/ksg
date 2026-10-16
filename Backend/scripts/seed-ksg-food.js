/**
 * KSG food demo content: six more Bhopal restaurants with full menus, on top of
 * what scripts/seed-ksg.js already created (India food zone, 8 food categories,
 * KSG Demo Kitchen). Run seed-ksg.js --apply first.
 *
 *   node scripts/seed-ksg-food.js            # dry run (default): reads, validates, prints the plan
 *   node scripts/seed-ksg-food.js --apply    # writes
 *
 * What it adds (each only when missing):
 *  - food_categories             6 global categories the menus need (Starters, Breads,
 *                                Momos, Fast Food, Sweets, Chaat & Snacks). Existing
 *                                categories are matched by name and never changed.
 *  - food_restaurants            6 approved, order-accepting restaurants in Bhopal,
 *                                linked to the India food zone exactly as KSG Demo
 *                                Kitchen is (zoneId + GeoJSON location), owners on
 *                                phones 9000000101-9000000106.
 *  - food_items                  10-15 approved, available dishes per restaurant;
 *                                pizzas / biryanis / mithai carry size variants.
 *  - food_addons                 approved add-ons (extra cheese, raita, phulka ...)
 *                                for four of the restaurants, linked to their dishes.
 *  - food_dining_categories      "Family Dining", and
 *  - food_dining_restaurants     table booking switched on for two restaurants.
 *  - food_offers                 FLAT50 (Rs 50 off on Rs 199+) and FIRST20 (20% up to
 *                                Rs 100, first order). Free delivery over Rs 299 is not
 *                                a coupon type in this model; it is set per restaurant
 *                                through freeDeliveryRule (custom, 5 km, Rs 299) on the
 *                                six demo restaurants only, so the platform rule is untouched.
 *  - food_hero_banners           3 food home banners, ONLY when there is no active
 *                                food banner yet (the home carousel is empty without one).
 *
 * Safety (same contract as seed-ksg.js):
 *  - Dry run by default; --apply writes. New documents are validated in the dry run.
 *  - Idempotent. Rows are matched by stable keys (category name, owner phone,
 *    restaurant + dish name, restaurant + add-on name, coupon code, slug,
 *    banner publicId) and created only when missing.
 *  - Additive only. Nothing is deleted. Existing catalogue rows are left as they
 *    are; on an existing DEMO restaurant only the flags that make it usable are
 *    re-asserted (approved / accepting orders / zone link / dining on).
 *  - A demo phone already used by a restaurant with a DIFFERENT name is skipped
 *    with a warning, so this never approves somebody else's application.
 *  - Written through the models (doc.save()), so validation and hooks run. The one
 *    exception is `costForTwo`, which the dining screens read but the restaurant
 *    schema does not declare; it is $set on the raw collection, only on these six
 *    demo restaurants and only when absent.
 *
 * Demo logins: owner phones sign in with the mock OTP (1234) while mock OTP is on.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { FoodZone } from '../src/modules/food/admin/models/zone.model.js';
import { FoodCategory } from '../src/modules/food/admin/models/category.model.js';
import { FoodItem } from '../src/modules/food/admin/models/food.model.js';
import { FoodOffer } from '../src/modules/food/admin/models/offer.model.js';
import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { FoodAddon } from '../src/modules/food/restaurant/models/foodAddon.model.js';
import { FoodDiningCategory } from '../src/modules/food/dining/models/diningCategory.model.js';
import { FoodDiningRestaurant } from '../src/modules/food/dining/models/diningRestaurant.model.js';
import { FoodHeroBanner } from '../src/modules/food/landing/models/heroBanner.model.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const ZONE_NAME = 'India';
const DAY_MS = 24 * 60 * 60 * 1000;
const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CITY = 'Bhopal';
const STATE = 'Madhya Pradesh';

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactName = (name) => new RegExp(`^\\s*${escapeRegex(name)}\\s*$`, 'i');
const placeholder = (size, text) => `https://placehold.co/${size}?text=${encodeURIComponent(text).replace(/%20/g, '+')}`;
const hasCoords = (loc) =>
  Array.isArray(loc?.coordinates) && loc.coordinates.length === 2
  && !(Number(loc.coordinates[0]) === 0 && Number(loc.coordinates[1]) === 0);

// ─────────────────────────────────────────────────────────────── catalogue ──

/** Global categories. The first 8 come from seed-ksg.js and are only looked up. */
const FOOD_CATEGORIES = [
  ['North Indian', 'Both'],
  ['South Indian', 'Both'],
  ['Chinese', 'Both'],
  ['Pizza', 'Both'],
  ['Biryani', 'Both'],
  ['Desserts', 'Veg'],
  ['Beverages', 'Veg'],
  ['Tiffin / Thali', 'Both'],
  // Added here:
  ['Starters', 'Both'],
  ['Breads', 'Veg'],
  ['Momos', 'Both'],
  ['Fast Food', 'Both'],
  ['Sweets', 'Veg'],
  ['Chaat & Snacks', 'Veg'],
];

const V = 'Veg';
const NV = 'Non-Veg';

/**
 * Dish: [name, category, price | [[variant, price], ...], foodType, description, opts]
 * opts: { rec: true } marks a bestseller (isRecommended); { addons: [...names] } links add-ons.
 */
const RESTAURANTS = [
  {
    phone: '9000000101',
    name: 'Bhopal Biryani House',
    ownerName: 'Demo Owner - Bhopal Biryani House',
    pureVeg: false,
    cuisines: ['Biryani', 'Mughlai', 'North Indian'],
    address: { addressLine1: 'Shop 4, Peer Gate Road, Ibrahimpura', area: 'Peer Gate', pincode: '462001', landmark: 'Near Peer Gate' },
    at: { lat: 23.2618, lng: 77.3992 },
    open: '11:30', close: '23:30',
    eta: '30-35 mins',
    rating: 4.4, totalRatings: 2310, costForTwo: 600,
    featured: ['Chicken Dum Biryani', 199],
    dining: { maxGuests: 8 },
    addons: [
      ['Extra Raita', 30, 'Cool cucumber and mint raita.'],
      ['Boiled Egg', 20, 'One boiled egg.'],
      ['Extra Mirchi ka Salan', 30, 'Hyderabadi chilli and peanut gravy.'],
    ],
    dishes: [
      ['Chicken Dum Biryani', 'Biryani', [['Half', 199], ['Full', 329]], NV, 'Long-grain basmati and chicken slow-cooked on dum with saffron and whole spices.', { rec: true, addons: ['Extra Raita', 'Boiled Egg', 'Extra Mirchi ka Salan'] }],
      ['Mutton Dum Biryani', 'Biryani', [['Half', 279], ['Full', 449]], NV, 'Tender mutton layered with basmati, fried onions and kewra.', { rec: true, addons: ['Extra Raita', 'Extra Mirchi ka Salan'] }],
      ['Egg Biryani', 'Biryani', 189, NV, 'Masala-fried eggs on fragrant biryani rice.', { addons: ['Extra Raita'] }],
      ['Veg Dum Biryani', 'Biryani', 169, V, 'Seasonal vegetables and basmati cooked on dum.', { addons: ['Extra Raita', 'Extra Mirchi ka Salan'] }],
      ['Paneer Tikka Biryani', 'Biryani', 229, V, 'Tandoori paneer tikka folded into saffron biryani.', { addons: ['Extra Raita'] }],
      ['Chicken 65', 'Starters', 249, NV, 'Crisp curry-leaf and chilli fried chicken.'],
      ['Mutton Seekh Kebab (4 pcs)', 'Starters', 299, NV, 'Minced mutton skewers off the charcoal grill, with mint chutney.', { rec: true }],
      ['Paneer Tikka', 'Starters', 239, V, 'Cottage cheese, peppers and onion marinated and char-grilled.'],
      ['Butter Chicken', 'North Indian', 319, NV, 'Tandoori chicken in a smooth tomato, butter and cream gravy.'],
      ['Dal Makhani', 'North Indian', 199, V, 'Black lentils simmered overnight with butter and cream.'],
      ['Rumali Roti', 'Breads', 25, V, 'Thin handkerchief bread from the inverted tawa.'],
      ['Butter Naan', 'Breads', 45, V, 'Tandoor-baked naan brushed with butter.'],
      ['Shahi Tukda', 'Desserts', 99, V, 'Fried bread soaked in saffron rabdi with dry fruits.'],
      ['Phirni', 'Desserts', 79, V, 'Chilled ground-rice pudding set in a clay pot.'],
    ],
  },
  {
    phone: '9000000102',
    name: 'Udupi Tiffin Centre',
    ownerName: 'Demo Owner - Udupi Tiffin Centre',
    pureVeg: true,
    cuisines: ['South Indian', 'Breakfast'],
    address: { addressLine1: 'Plot 21, Zone-II, MP Nagar', area: 'MP Nagar', pincode: '462011', landmark: 'Near Jyoti Talkies' },
    at: { lat: 23.2335, lng: 77.4341 },
    open: '07:00', close: '22:30',
    eta: '20-25 mins',
    rating: 4.5, totalRatings: 1840, costForTwo: 300,
    featured: ['Masala Dosa', 109],
    dishes: [
      ['Idli Sambar (2 pcs)', 'South Indian', 69, V, 'Steamed rice cakes with sambar and coconut chutney.'],
      ['Medu Vada (2 pcs)', 'South Indian', 79, V, 'Crisp urad dal vadas with sambar and chutney.'],
      ['Ghee Podi Idli', 'South Indian', 99, V, 'Mini idlis tossed in ghee and gunpowder podi.'],
      ['Plain Dosa', 'South Indian', 89, V, 'Thin crisp dosa with sambar and two chutneys.'],
      ['Masala Dosa', 'South Indian', 109, V, 'Crisp dosa with spiced potato bhaji.', { rec: true }],
      ['Mysore Masala Dosa', 'South Indian', 129, V, 'Dosa layered with red garlic chutney and potato masala.', { rec: true }],
      ['Rava Onion Dosa', 'South Indian', 139, V, 'Lacy semolina dosa with onions and green chilli.'],
      ['Onion Uttapam', 'South Indian', 119, V, 'Thick rice pancake topped with onion and coriander.'],
      ['Ven Pongal', 'South Indian', 99, V, 'Rice and moong dal with pepper, cumin and ghee.'],
      ['South Indian Meals', 'Tiffin / Thali', 179, V, 'Rice, sambar, rasam, poriyal, kootu, curd, papad and payasam.', { rec: true }],
      ['Filter Coffee', 'Beverages', 49, V, 'Strong decoction coffee with frothy milk, served in a dabara.'],
      ['Rava Kesari', 'Desserts', 59, V, 'Semolina sweet with ghee, saffron and cashews.'],
    ],
  },
  {
    phone: '9000000103',
    name: 'Dragon Wok',
    ownerName: 'Demo Owner - Dragon Wok',
    pureVeg: false,
    cuisines: ['Chinese', 'Momos', 'Asian'],
    address: { addressLine1: '1st Floor, 12 New Market, TT Nagar', area: 'New Market', pincode: '462003', landmark: 'Opposite Roshanpura Square' },
    at: { lat: 23.2368, lng: 77.4007 },
    open: '12:00', close: '23:45',
    eta: '30-40 mins',
    rating: 4.1, totalRatings: 960, costForTwo: 500,
    featured: ['Chilli Chicken Gravy', 249],
    dining: { maxGuests: 6 },
    addons: [
      ['Schezwan Dip', 15, 'House-made schezwan sauce.'],
      ['Fried Egg', 25, 'One fried egg on top.'],
    ],
    dishes: [
      ['Veg Hakka Noodles', 'Chinese', 159, V, 'Wok-tossed noodles with cabbage, carrot and spring onion.', { addons: ['Schezwan Dip'] }],
      ['Chicken Hakka Noodles', 'Chinese', 189, NV, 'Noodles tossed with shredded chicken and vegetables.', { addons: ['Schezwan Dip', 'Fried Egg'] }],
      ['Veg Schezwan Fried Rice', 'Chinese', 169, V, 'Fiery schezwan fried rice with vegetables.', { addons: ['Schezwan Dip'] }],
      ['Chicken Schezwan Fried Rice', 'Chinese', 199, NV, 'Schezwan fried rice with chicken and egg.', { rec: true, addons: ['Schezwan Dip', 'Fried Egg'] }],
      ['Veg Manchurian Gravy', 'Chinese', 179, V, 'Vegetable dumplings in a soy, garlic and ginger gravy.'],
      ['Chilli Chicken Gravy', 'Chinese', 249, NV, 'Battered chicken with peppers and onion in chilli-soy gravy.', { rec: true }],
      ['Veg Hot & Sour Soup', 'Chinese', 109, V, 'Peppery, tangy soup with vegetables and tofu.'],
      ['Chicken Manchow Soup', 'Chinese', 129, NV, 'Garlicky chicken soup topped with crispy noodles.'],
      ['Chilli Paneer Dry', 'Starters', 229, V, 'Crisp paneer tossed with peppers, onion and green chilli.', { rec: true }],
      ['Crispy Corn Salt & Pepper', 'Starters', 179, V, 'Fried sweet corn with garlic, pepper and spring onion.'],
      ['Veg Spring Roll (4 pcs)', 'Starters', 149, V, 'Crisp rolls stuffed with stir-fried vegetables.'],
      ['Veg Steamed Momos (8 pcs)', 'Momos', 119, V, 'Steamed dumplings with a cabbage and carrot filling, red chutney.'],
      ['Chicken Steamed Momos (8 pcs)', 'Momos', 149, NV, 'Juicy chicken dumplings with spicy red chutney.', { rec: true }],
      ['Paneer Fried Momos (8 pcs)', 'Momos', 149, V, 'Pan-fried momos stuffed with spiced paneer.'],
    ],
  },
  {
    phone: '9000000104',
    name: 'Pizza Junction',
    ownerName: 'Demo Owner - Pizza Junction',
    pureVeg: false,
    cuisines: ['Pizza', 'Fast Food', 'Italian'],
    address: { addressLine1: '14 Bhavani Dham, Ashoka Garden Main Road', area: 'Ashoka Garden', pincode: '462023', landmark: 'Near 80 Feet Road' },
    at: { lat: 23.2588, lng: 77.4218 },
    open: '11:00', close: '23:59',
    eta: '25-30 mins',
    rating: 4.0, totalRatings: 1215, costForTwo: 450,
    featured: ['Margherita Pizza', 149],
    addons: [
      ['Extra Cheese', 49, 'An extra layer of mozzarella.'],
      ['Jalapenos', 29, 'Sliced pickled jalapenos.'],
      ['Black Olives', 29, 'Sliced black olives.'],
    ],
    dishes: [
      ['Margherita Pizza', 'Pizza', [['Regular 7"', 149], ['Medium 10"', 279], ['Large 12"', 429]], V, 'Tomato sauce, mozzarella and basil.', { rec: true, addons: ['Extra Cheese', 'Jalapenos', 'Black Olives'] }],
      ['Farmhouse Pizza', 'Pizza', [['Regular 7"', 199], ['Medium 10"', 349], ['Large 12"', 519]], V, 'Onion, capsicum, tomato and mushroom.', { rec: true, addons: ['Extra Cheese', 'Jalapenos', 'Black Olives'] }],
      ['Peppy Paneer Pizza', 'Pizza', [['Regular 7"', 219], ['Medium 10"', 379], ['Large 12"', 549]], V, 'Paneer, capsicum and red paprika.', { addons: ['Extra Cheese', 'Jalapenos'] }],
      ['Veggie Supreme Pizza', 'Pizza', [['Regular 7"', 239], ['Medium 10"', 399], ['Large 12"', 579]], V, 'Loaded with olives, corn, jalapenos, onion and peppers.', { addons: ['Extra Cheese'] }],
      ['Chicken Tikka Pizza', 'Pizza', [['Regular 7"', 249], ['Medium 10"', 419], ['Large 12"', 599]], NV, 'Chicken tikka, onion and capsicum.', { addons: ['Extra Cheese', 'Jalapenos'] }],
      ['BBQ Chicken Pizza', 'Pizza', [['Regular 7"', 259], ['Medium 10"', 429], ['Large 12"', 619]], NV, 'Smoky barbecue chicken with onion.', { addons: ['Extra Cheese', 'Jalapenos'] }],
      ['Garlic Breadsticks', 'Fast Food', 109, V, 'Oven-baked breadsticks with garlic butter and a cheese dip.'],
      ['Cheesy Garlic Bread', 'Fast Food', 139, V, 'Garlic bread topped with melted mozzarella and herbs.'],
      ['Peri Peri Fries', 'Fast Food', 119, V, 'Crisp fries dusted with peri peri seasoning.'],
      ['Veg Burger', 'Fast Food', 99, V, 'Crumb-fried veg patty, lettuce and mayo.'],
      ['Chicken Burger', 'Fast Food', 139, NV, 'Crispy chicken patty with lettuce and spicy mayo.'],
      ['White Sauce Pasta', 'Fast Food', 179, V, 'Penne in a creamy cheese sauce with vegetables.'],
      ['Cold Coffee', 'Beverages', 99, V, 'Blended chilled coffee with ice cream.'],
      ['Choco Lava Cake', 'Desserts', 89, V, 'Warm chocolate cake with a molten centre.'],
    ],
  },
  {
    phone: '9000000105',
    name: 'Mithaas Sweets',
    ownerName: 'Demo Owner - Mithaas Sweets',
    pureVeg: true,
    cuisines: ['Sweets', 'Chaat', 'Snacks'],
    address: { addressLine1: '32 Chowk Bazaar, Old Bhopal', area: 'Chowk Bazaar', pincode: '462001', landmark: 'Near Jama Masjid' },
    at: { lat: 23.2629, lng: 77.4012 },
    open: '08:00', close: '22:00',
    eta: '15-20 mins',
    rating: 4.6, totalRatings: 3120, costForTwo: 250,
    featured: ['Poha Jalebi', 59],
    dishes: [
      ['Poha Jalebi', 'Chaat & Snacks', 59, V, 'Bhopal-style poha with sev and onion, with hot jalebi.', { rec: true }],
      ['Samosa (2 pcs)', 'Chaat & Snacks', 40, V, 'Potato and pea samosas with tamarind and mint chutney.'],
      ['Khasta Kachori (2 pcs)', 'Chaat & Snacks', 50, V, 'Flaky moong dal kachori with aloo sabzi.'],
      ['Raj Kachori', 'Chaat & Snacks', 89, V, 'Giant crisp kachori filled with curd, chutneys and sev.'],
      ['Aloo Tikki Chaat', 'Chaat & Snacks', 79, V, 'Crisp potato tikki with chole, curd and chutneys.'],
      ['Pav Bhaji', 'Chaat & Snacks', 119, V, 'Buttery mashed vegetable bhaji with two toasted pav.'],
      ['Kaju Katli', 'Sweets', [['250 g', 299], ['500 g', 579]], V, 'Cashew fudge finished with silver varq.', { rec: true }],
      ['Motichoor Ladoo', 'Sweets', [['250 g', 149], ['500 g', 289]], V, 'Fine boondi ladoo in pure ghee.'],
      ['Milk Cake (250 g)', 'Sweets', 179, V, 'Grainy caramelised milk sweet.'],
      ['Rasmalai (2 pcs)', 'Desserts', 99, V, 'Soft chenna discs in saffron and cardamom milk.', { rec: true }],
      ['Rabdi', 'Desserts', 89, V, 'Slow-reduced sweetened milk with pistachio.'],
      ['Sweet Lassi', 'Beverages', 69, V, 'Thick churned curd with malai on top.'],
      ['Kesar Badam Milk', 'Beverages', 79, V, 'Chilled milk with saffron and almonds.'],
    ],
  },
  {
    phone: '9000000106',
    name: 'Ghar Ka Khana Tiffin Service',
    ownerName: 'Demo Owner - Ghar Ka Khana Tiffin Service',
    pureVeg: false,
    cuisines: ['North Indian', 'Home Style', 'Thali'],
    address: { addressLine1: 'H-18, Idgah Hills', area: 'Idgah Hills', pincode: '462001', landmark: 'Near Gufa Mandir Road' },
    at: { lat: 23.2652, lng: 77.3875 },
    open: '08:00', close: '22:00',
    eta: '25-30 mins',
    rating: 4.3, totalRatings: 540, costForTwo: 300,
    featured: ['Full Veg Thali', 179],
    addons: [
      ['Extra Phulka', 12, 'One more tawa phulka.'],
      ['Roasted Papad', 15, 'One roasted papad.'],
      ['Green Salad', 20, 'Onion, cucumber, tomato and lemon.'],
    ],
    dishes: [
      ['Mini Veg Thali', 'Tiffin / Thali', 129, V, 'Dal, one sabzi, rice and 3 phulkas.', { addons: ['Extra Phulka', 'Roasted Papad', 'Green Salad'] }],
      ['Full Veg Thali', 'Tiffin / Thali', 179, V, 'Dal, two sabzis, rice, 4 phulkas, salad, pickle and sweet.', { rec: true, addons: ['Extra Phulka', 'Roasted Papad', 'Green Salad'] }],
      ['Chicken Thali', 'Tiffin / Thali', 229, NV, 'Home-style chicken curry, dal, rice, 4 phulkas and salad.', { rec: true, addons: ['Extra Phulka', 'Roasted Papad', 'Green Salad'] }],
      ['Rajma Chawal', 'Tiffin / Thali', 139, V, 'Kidney bean curry with steamed rice and salad.', { addons: ['Roasted Papad'] }],
      ['Dal Chawal', 'Tiffin / Thali', 109, V, 'Yellow dal tadka with steamed rice and pickle.', { addons: ['Roasted Papad'] }],
      ['Kadhi Chawal', 'Tiffin / Thali', 119, V, 'Besan kadhi with pakodi and steamed rice.', { addons: ['Roasted Papad'] }],
      ['Egg Curry Rice', 'Tiffin / Thali', 149, NV, 'Two eggs in onion-tomato curry with rice.'],
      ['Aloo Gobi', 'North Indian', 109, V, 'Dry potato and cauliflower sabzi, home style.'],
      ['Dal Tadka', 'North Indian', 119, V, 'Yellow dal with a ghee, cumin and garlic tadka.'],
      ['Home Style Chicken Curry', 'North Indian', 219, NV, 'Bone-in chicken in a light onion-tomato gravy.'],
      ['Tawa Phulka', 'Breads', 12, V, 'Soft whole-wheat phulka, per piece.'],
      ['Aloo Paratha with Curd', 'Breads', 89, V, 'Stuffed paratha with butter, curd and pickle.'],
      ['Kheer', 'Desserts', 59, V, 'Rice kheer with cardamom and nuts.'],
    ],
  },
];

/**
 * Demo restaurants in other cities, so customers outside Bhopal see restaurants
 * too (the listing only shows restaurants within delivery distance). Each one
 * reuses the menu of a Bhopal restaurant above (`template`) under its own name,
 * address and location. Only `RESTAURANTS` get dining, banners and costForTwo
 * defaults from the template.
 */
const MP = 'Madhya Pradesh';
const CITY_RESTAURANTS = [
  // Indore
  { phone: '9000000111', name: 'Chappan Biryani Darbar', template: 'Bhopal Biryani House', city: 'Indore', state: MP,
    address: { addressLine1: 'Shop 7, 56 Dukan, New Palasia', area: '56 Dukan', pincode: '452001', landmark: 'Near 56 Dukan' },
    at: { lat: 22.7244, lng: 75.8839 }, rating: 4.3, totalRatings: 1620 },
  { phone: '9000000112', name: 'Annapurna Dosa Corner', template: 'Udupi Tiffin Centre', city: 'Indore', state: MP,
    address: { addressLine1: '22 Scheme 54, Vijay Nagar', area: 'Vijay Nagar', pincode: '452010', landmark: 'Near Vijay Nagar Square' },
    at: { lat: 22.7533, lng: 75.8937 }, rating: 4.5, totalRatings: 1290 },
  { phone: '9000000113', name: 'Wok & Roll Indore', template: 'Dragon Wok', city: 'Indore', state: MP,
    address: { addressLine1: '3rd Floor, 18 AB Road, Palasia', area: 'Palasia', pincode: '452001', landmark: 'Opposite Palasia Square' },
    at: { lat: 22.7241, lng: 75.8867 }, rating: 4.2, totalRatings: 980 },
  { phone: '9000000114', name: 'Rajwada Pizza Co.', template: 'Pizza Junction', city: 'Indore', state: MP,
    address: { addressLine1: '9 Jawahar Marg, near Rajwada', area: 'Rajwada', pincode: '452002', landmark: 'Near Rajwada Palace' },
    at: { lat: 22.7186, lng: 75.8553 }, rating: 4.1, totalRatings: 760 },
  { phone: '9000000115', name: 'Sarafa Sweets & Chaat', template: 'Mithaas Sweets', city: 'Indore', state: MP,
    address: { addressLine1: '41 Sarafa Bazaar', area: 'Sarafa', pincode: '452002', landmark: 'Sarafa night market' },
    at: { lat: 22.7178, lng: 75.8547 }, rating: 4.6, totalRatings: 2410 },
  // Delhi
  { phone: '9000000116', name: 'Purani Dilli Biryani', template: 'Bhopal Biryani House', city: 'New Delhi', state: 'Delhi',
    address: { addressLine1: '1120 Chandni Chowk', area: 'Chandni Chowk', pincode: '110006', landmark: 'Near Fatehpuri Masjid' },
    at: { lat: 28.6506, lng: 77.2303 }, rating: 4.4, totalRatings: 3120 },
  { phone: '9000000117', name: 'Karol Bagh Dosa House', template: 'Udupi Tiffin Centre', city: 'New Delhi', state: 'Delhi',
    address: { addressLine1: '14/52 Ajmal Khan Road, Karol Bagh', area: 'Karol Bagh', pincode: '110005', landmark: 'Near Karol Bagh Metro' },
    at: { lat: 28.6519, lng: 77.1909 }, rating: 4.3, totalRatings: 1870 },
  { phone: '9000000118', name: 'Connaught Pizza Co.', template: 'Pizza Junction', city: 'New Delhi', state: 'Delhi',
    address: { addressLine1: 'N-12 Connaught Place', area: 'Connaught Place', pincode: '110001', landmark: 'Inner Circle' },
    at: { lat: 28.6315, lng: 77.2167 }, rating: 4.2, totalRatings: 1450 },
  { phone: '9000000119', name: 'Lajpat Ghar Ka Khana', template: 'Ghar Ka Khana Tiffin Service', city: 'New Delhi', state: 'Delhi',
    address: { addressLine1: 'II-K 21, Lajpat Nagar', area: 'Lajpat Nagar', pincode: '110024', landmark: 'Near Central Market' },
    at: { lat: 28.5677, lng: 77.2433 }, rating: 4.4, totalRatings: 940 },
  // Goa
  { phone: '9000000120', name: 'Panjim Pizza Shack', template: 'Pizza Junction', city: 'Panaji', state: 'Goa',
    address: { addressLine1: '18 June Road, Panaji', area: 'Panaji', pincode: '403001', landmark: 'Near Church Square' },
    at: { lat: 15.4989, lng: 73.8278 }, rating: 4.3, totalRatings: 690 },
  { phone: '9000000121', name: 'Calangute Wok', template: 'Dragon Wok', city: 'Calangute', state: 'Goa',
    address: { addressLine1: 'Beach Road, Calangute', area: 'Calangute', pincode: '403516', landmark: 'Near Calangute Beach' },
    at: { lat: 15.5439, lng: 73.7553 }, rating: 4.1, totalRatings: 520 },
  // Manali
  { phone: '9000000122', name: 'Mall Road Tiffin House', template: 'Ghar Ka Khana Tiffin Service', city: 'Manali', state: 'Himachal Pradesh',
    address: { addressLine1: '12 The Mall', area: 'Mall Road', pincode: '175131', landmark: 'Near Manu Market' },
    at: { lat: 32.2432, lng: 77.1892 }, rating: 4.3, totalRatings: 410 },
  { phone: '9000000123', name: 'Old Manali Momos & Wok', template: 'Dragon Wok', city: 'Manali', state: 'Himachal Pradesh',
    address: { addressLine1: 'Manu Temple Road, Old Manali', area: 'Old Manali', pincode: '175131', landmark: 'Near Manu Temple' },
    at: { lat: 32.2557, lng: 77.1866 }, rating: 4.5, totalRatings: 630 },
];

/** City restaurants built from their template's menu, hours and price level. */
const buildCityRestaurants = () =>
  CITY_RESTAURANTS.map((c) => {
    const t = RESTAURANTS.find((r) => r.name === c.template);
    if (!t) throw new Error(`Unknown template "${c.template}" for ${c.name}`);
    return {
      ...t,
      dining: undefined,
      ...c,
      ownerName: `Demo Owner - ${c.name}`,
    };
  });

const DINING_CATEGORY = { name: 'Family Dining', slug: 'family-dining' };

const OFFERS = [
  {
    couponCode: 'FLAT50',
    discountType: 'flat-price',
    discountValue: 50,
    customerScope: 'all',
    minOrderValue: 199,
    maxDiscount: null,
    perUserLimit: 5,
    isFirstOrderOnly: false,
    label: 'Flat Rs 50 off on orders of Rs 199+',
  },
  {
    couponCode: 'FIRST20',
    discountType: 'percentage',
    discountValue: 20,
    customerScope: 'first-time',
    minOrderValue: 0,
    maxDiscount: 100,
    perUserLimit: 1,
    isFirstOrderOnly: true,
    label: '20% off up to Rs 100 on the first order',
  },
];
const OFFER_DAYS = 180;

/** Per-restaurant free delivery (admin-only setting), applied to the six demo restaurants. */
const FREE_DELIVERY = { mode: 'custom', maxDistanceKm: 5, minOrderAmount: 299 };
const RESTAURANT_OFFER_BADGE = 'FLAT50: Rs 50 off above Rs 199';

const BANNERS = [
  { publicId: 'ksg-demo/food-banner-biryani', title: 'Biryani Week', ctaText: 'Order now', image: 'Biryani Week - Dum biryani from Rs 199', restaurant: 'Bhopal Biryani House' },
  { publicId: 'ksg-demo/food-banner-flat50', title: 'FLAT50 on orders above Rs 199', ctaText: 'Use FLAT50', image: 'FLAT50 - Rs 50 off above Rs 199', restaurant: 'Pizza Junction' },
  { publicId: 'ksg-demo/food-banner-breakfast', title: 'South Indian breakfast from 7 AM', ctaText: 'Explore', image: 'Breakfast from 7 AM - Dosa, Idli, Filter Coffee', restaurant: 'Udupi Tiffin Centre' },
];

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
 * null when skipped. (Same helper as seed-ksg.js.)
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

const sameName = (field, expected) => (existing) => {
  const actual = String(existing?.[field] || '').trim();
  return actual && actual.toLowerCase() !== expected.toLowerCase()
    ? `phone already belongs to "${actual}", not "${expected}"`
    : null;
};

// ───────────────────────────────────────────────────────────────── seeding ──

async function seedCategories() {
  console.log('\n[1] Food categories (global; existing ones are only looked up)');
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

const sellerLocation = (r) => {
  const city = r.city || CITY;
  const state = r.state || STATE;
  const line = `${r.address.addressLine1}, ${city}, ${state} ${r.address.pincode}`;
  return {
    type: 'Point',
    coordinates: [r.at.lng, r.at.lat],
    latitude: r.at.lat,
    longitude: r.at.lng,
    formattedAddress: line,
    address: `${r.address.addressLine1}, ${city}`,
    addressLine1: r.address.addressLine1,
    area: r.address.area,
    city,
    state,
    pincode: r.address.pincode,
    landmark: r.address.landmark,
  };
};

async function seedRestaurant(r, { foodZone, categories }) {
  const coverImage = placeholder('800x500', r.name);
  const logo = placeholder('400x400', r.name);
  const diningSettings = r.dining
    ? { isEnabled: true, maxGuests: r.dining.maxGuests, diningType: DINING_CATEGORY.slug }
    : undefined;

  const restaurant = await upsert(FoodRestaurant, {
    label: `${r.name} (${r.phone})`,
    filter: { $or: [{ ownerPhone: r.phone }, { primaryContactNumber: r.phone }] },
    guard: sameName('restaurantName', r.name),
    insert: {
      restaurantName: r.name,
      ownerName: r.ownerName,
      ownerEmail: `ksg.demo.food${r.phone.slice(-3)}@example.com`,
      ownerPhone: r.phone,
      primaryContactNumber: r.phone,
      pureVegRestaurant: r.pureVeg,
      cuisines: r.cuisines,
      addressLine1: r.address.addressLine1,
      area: r.address.area,
      city: r.city || CITY,
      state: r.state || STATE,
      pincode: r.address.pincode,
      landmark: r.address.landmark,
      openingTime: r.open,
      closingTime: r.close,
      openDays: ALL_DAYS,
      estimatedDeliveryTime: r.eta,
      featuredDish: r.featured[0],
      featuredPrice: r.featured[1],
      offer: RESTAURANT_OFFER_BADGE,
      rating: r.rating,
      totalRatings: r.totalRatings,
      profileImage: logo,
      coverImage,
      coverImages: [coverImage],
      freeDeliveryRule: FREE_DELIVERY,
      location: sellerLocation(r),
      ...(diningSettings ? { diningSettings } : {}),
    },
    enforce: {
      status: 'approved',
      isAcceptingOrders: true,
      zoneId: foodZone._id,
      ...(r.dining ? { 'diningSettings.isEnabled': true } : {}),
    },
    fixup: (doc) => {
      if (!doc.approvedAt) doc.approvedAt = new Date();
      if (doc.rejectionReason) doc.rejectionReason = '';
      if (!hasCoords(doc.location)) doc.location = sellerLocation(r);
    },
  });
  if (!restaurant) return null;

  // costForTwo is read by the dining screens but not declared on the schema, so
  // Mongoose would drop it; set it directly, only when absent.
  if (APPLY) {
    const res = await FoodRestaurant.collection.updateOne(
      { _id: restaurant._id, costForTwo: { $exists: false } },
      { $set: { costForTwo: r.costForTwo } },
    );
    if (res.modifiedCount) log('~', 'food_restaurants', `${r.name}`, `costForTwo = ${r.costForTwo} (raw $set)`);
  }

  // Add-ons first, so dishes can link to them.
  const addonIdsByName = new Map();
  for (const [name, price, description] of r.addons || []) {
    const payload = { name, description, price, image: '', images: [] };
    const addon = await upsert(FoodAddon, {
      label: `${r.name} / ${name}`,
      filter: { restaurantId: restaurant._id, 'draft.name': name, isDeleted: { $ne: true } },
      insert: {
        restaurantId: restaurant._id,
        draft: payload,
        published: payload,
        approvalStatus: 'approved',
        approvedAt: new Date(),
        requestedAt: new Date(),
        isAvailable: true,
        isDeleted: false,
      },
    });
    if (addon) addonIdsByName.set(name, addon._id);
  }

  let dishCount = 0;
  for (const [name, categoryName, priceSpec, foodType, description, opts = {}] of r.dishes) {
    const category = categories.get(categoryName);
    if (!category) throw new Error(`No category "${categoryName}" for ${r.name} / ${name}`);
    const variants = Array.isArray(priceSpec)
      ? priceSpec.map(([vName, vPrice]) => ({ name: vName, price: vPrice, basePrice: vPrice }))
      : [];
    const price = variants.length ? Math.min(...variants.map((v) => v.price)) : priceSpec;
    const addonIds = (opts.addons || []).map((n) => addonIdsByName.get(n)).filter(Boolean);

    await upsert(FoodItem, {
      label: `${r.name} / ${name}`,
      filter: { restaurantId: restaurant._id, name },
      insert: {
        restaurantId: restaurant._id,
        categoryId: category._id,
        categoryName,
        name,
        description,
        price,
        basePrice: price,
        foodType,
        image: placeholder('600x400', name),
        variantsEnabled: variants.length > 0,
        variants,
        addonIds,
        isRecommended: opts.rec === true,
        isActive: true,
        isAvailable: true,
        approvalStatus: 'approved',
        approvedAt: new Date(),
        preparationTime: '15-20 mins',
      },
    });
    dishCount += 1;
  }
  return { restaurant, dishCount };
}

async function seedDining(seeded) {
  console.log('\n[3] Dining (table booking) for two restaurants');
  const diningRestaurants = RESTAURANTS.filter((r) => r.dining && seeded.get(r.name));
  if (!diningRestaurants.length) return;

  const ids = diningRestaurants.map((r) => seeded.get(r.name)._id);
  const category = await upsert(FoodDiningCategory, {
    label: DINING_CATEGORY.name,
    filter: { slug: DINING_CATEGORY.slug },
    insert: {
      name: DINING_CATEGORY.name,
      slug: DINING_CATEGORY.slug,
      imageUrl: placeholder('800x500', DINING_CATEGORY.name),
      isActive: true,
      sortOrder: 1,
    },
    // Keep the category's back-links in step, as updateDiningRestaurant does.
    fixup: (doc) => {
      const have = new Set((doc.restaurantIds || []).map(String));
      const missing = ids.filter((id) => !have.has(String(id)));
      if (missing.length) doc.restaurantIds = [...(doc.restaurantIds || []), ...missing];
    },
  });

  for (const r of diningRestaurants) {
    const restaurant = seeded.get(r.name);
    await upsert(FoodDiningRestaurant, {
      label: `${r.name} (max ${r.dining.maxGuests} guests)`,
      filter: { restaurantId: restaurant._id },
      insert: {
        restaurantId: restaurant._id,
        categoryIds: [category._id],
        primaryCategoryId: category._id,
        maxGuests: r.dining.maxGuests,
        pureVegRestaurant: r.pureVeg,
      },
      enforce: { isEnabled: true },
    });
  }
}

async function seedOffers() {
  console.log('\n[4] Coupons (food_offers)');
  for (const o of OFFERS) {
    await upsert(FoodOffer, {
      label: `${o.couponCode}  (${o.label})`,
      filter: { couponCode: o.couponCode },
      insert: {
        couponCode: o.couponCode,
        discountType: o.discountType,
        discountValue: o.discountValue,
        customerScope: o.customerScope,
        restaurantScope: 'all',
        minOrderValue: o.minOrderValue,
        maxDiscount: o.maxDiscount,
        usageLimit: null,
        perUserLimit: o.perUserLimit,
        isFirstOrderOnly: o.isFirstOrderOnly,
        startDate: new Date(),
        endDate: new Date(Date.now() + OFFER_DAYS * DAY_MS),
        status: 'active',
        showInCart: true,
        createdByRole: 'ADMIN',
      },
    });
  }
  notes.push('Free delivery over Rs 299 is not a coupon type in food_offers; it is set on each of the 6 demo restaurants as freeDeliveryRule { custom, 5 km, Rs 299 } (on create only).');
}

async function seedBanners(seeded) {
  console.log('\n[5] Food home hero banners');
  const ours = BANNERS.map((b) => b.publicId);
  const foodModule = { $or: [{ module: 'food' }, { module: { $exists: false } }, { module: null }] };
  const othersActive = await FoodHeroBanner.countDocuments({ isActive: true, publicId: { $nin: ours }, ...foodModule });
  const oursExisting = await FoodHeroBanner.countDocuments({ publicId: { $in: ours } });
  if (othersActive > 0 && oursExisting === 0) {
    for (const b of BANNERS) {
      bump('food_hero_banners', 'skipped');
      log('!', 'food_hero_banners', b.title, 'SKIPPED: food home already has active banners');
    }
    notes.push(`food_hero_banners: ${othersActive} active food banner(s) already exist, demo banners not added.`);
    return;
  }
  for (const [index, b] of BANNERS.entries()) {
    const restaurant = seeded.get(b.restaurant);
    await upsert(FoodHeroBanner, {
      label: b.title,
      filter: { publicId: b.publicId },
      insert: {
        imageUrl: placeholder('1200x400', b.image),
        publicId: b.publicId,
        resourceType: 'image',
        title: b.title,
        ctaText: b.ctaText,
        linkedRestaurantIds: restaurant ? [restaurant._id] : [],
        module: 'food',
        sortOrder: index + 1,
        isActive: true,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────── main ──

const run = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGO_URI / MONGODB_URI in environment.');
  await mongoose.connect(uri);
  console.log(`db: ${mongoose.connection.db.databaseName}   mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (nothing is written)'}`);
  console.log('legend: + create   ~ update   = unchanged   ! skipped');

  const foodZone = await FoodZone.findOne({ name: ZONE_NAME });
  if (!foodZone) {
    throw new Error(`No food zone named "${ZONE_NAME}". Run: node scripts/seed-ksg.js --apply`);
  }
  console.log(`food zone: ${ZONE_NAME} (${foodZone._id})`);

  const categories = await seedCategories();

  console.log('\n[2] Restaurants, add-ons and menus (Bhopal)');
  const seeded = new Map();
  const logins = [];
  for (const r of RESTAURANTS) {
    const result = await seedRestaurant(r, { foodZone, categories });
    if (result) seeded.set(r.name, result.restaurant);
    logins.push([r.phone, r.name, result ? `${result.dishCount} dishes` : 'SKIPPED (phone taken)']);
  }

  console.log('\n[2b] Restaurants in other cities (menus from the Bhopal templates)');
  for (const r of buildCityRestaurants()) {
    const result = await seedRestaurant(r, { foodZone, categories });
    logins.push([r.phone, `${r.name} (${r.city})`, result ? `${result.dishCount} dishes` : 'SKIPPED (phone taken)']);
  }

  await seedDining(seeded);
  await seedOffers();
  await seedBanners(seeded);

  // ── summary ──
  console.log('\n================ SUMMARY ================');
  console.log('Per collection:');
  console.log(`  ${'collection'.padEnd(30)} created  updated  unchanged  skipped`);
  for (const [coll, s] of stats) {
    console.log(`  ${coll.padEnd(30)} ${String(s.created).padStart(7)}  ${String(s.updated).padStart(7)}  ${String(s.unchanged).padStart(9)}  ${String(s.skipped).padStart(7)}`);
  }

  console.log('\nRestaurant owner logins (OTP 1234 while mock OTP is on)  ->  /food/restaurant/login');
  console.log(`  ${'phone'.padEnd(12)} ${'restaurant'.padEnd(32)} menu`);
  for (const [phone, name, menu] of logins) {
    console.log(`  ${phone.padEnd(12)} ${name.padEnd(32)} ${menu}`);
  }

  if (notes.length) {
    console.log('\nNotes:');
    for (const note of notes) console.log(`  - ${note}`);
  }
  if (!APPLY) console.log('\nDRY RUN: nothing was written. Re-run with --apply.');
};

run()
  .catch((err) => {
    console.error('seed-ksg-food failed:', err?.message || err);
    if (err?.errors) {
      for (const [path, e] of Object.entries(err.errors)) console.error(`  ${path}: ${e.message}`);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
