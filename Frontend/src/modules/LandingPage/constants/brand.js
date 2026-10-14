import { Car, Hotel, ShoppingBasket, UtensilsCrossed, Pill, Wrench } from 'lucide-react'
import { HOTEL_ENABLED } from '@/config/features'

// Colours lifted from the KSG logo: tricolour saffron / green on a deep navy ring.
export const KSG = {
  saffron: '#FF7A00',
  saffronDeep: '#E85D04',
  green: '#16A34A',
  greenDeep: '#0F7A36',
  navy: '#0B2A6F',
  navyDeep: '#071A47',
  chakra: '#1E3A8A',
  gold: '#FBBF24',
}

export const COMPANY = {
  short: 'KSG',
  name: 'KSG Sons and Services Pvt Ltd',
  tagline: 'All in One Service App',
  hindiTitle: 'भरोसेमंद सेवा',
  hindiSub: 'हर जरूरत का एक ही समाधान',
}

// Store listings are not live yet; set these when the apps are published and the
// badges switch from "coming soon" to real links.
export const PLAY_STORE_URL = ''
export const APP_STORE_URL = ''

// One entry per segment of the logo, in the same order around the ring.
export const SERVICES = [
  {
    key: 'ride',
    word: 'ride',
    title: 'Cab / Bike / Auto',
    short: 'Rides',
    desc: 'Book a cab, bike or auto in seconds with verified captains and live GPS tracking.',
    icon: Car,
    from: '#2563EB',
    to: '#1E3A8A',
    href: '/taxi/user',
    cta: 'Book a ride',
  },
  {
    key: 'hotel',
    word: 'stay',
    title: 'Hotel Booking',
    short: 'Hotels',
    desc: 'Find comfortable, verified stays near you and book instantly at the best prices.',
    icon: Hotel,
    from: '#7C3AED',
    to: '#4338CA',
    // Linked only on builds with the hotel vertical switched on (VITE_ENABLE_HOTEL).
    ...(HOTEL_ENABLED ? { href: '/hotel', cta: 'Book a stay' } : {}),
  },
  {
    key: 'grocery',
    word: 'grocery',
    title: 'Grocery Delivery',
    short: 'Grocery',
    desc: 'Fresh fruits, vegetables and daily essentials delivered to your doorstep, fast.',
    icon: ShoppingBasket,
    from: '#22C55E',
    to: '#15803D',
  },
  {
    key: 'food',
    word: 'meal',
    title: 'Food Delivery & Tiffin',
    short: 'Food & Tiffin',
    desc: 'Order from local favourites or subscribe to homestyle tiffin, delivered hot.',
    icon: UtensilsCrossed,
    from: '#FB923C',
    to: '#EA580C',
    href: '/food/user',
    cta: 'Order food',
  },
  {
    key: 'medicine',
    word: 'medicine',
    title: 'Medicine Order',
    short: 'Medicines',
    desc: 'Order medicines from trusted local pharmacies with quick, careful delivery.',
    icon: Pill,
    from: '#14B8A6',
    to: '#0F766E',
  },
  {
    key: 'workers',
    word: 'repair',
    title: 'Electrician, Plumber & more',
    short: 'Home Services',
    desc: 'Book skilled electricians, plumbers and other professionals at your doorstep.',
    icon: Wrench,
    from: '#EF4444',
    to: '#B91C1C',
  },
]
