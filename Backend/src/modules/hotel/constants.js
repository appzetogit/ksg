// Hotel vertical: enums and catalogues shared by models, services and validators.
// See HOTEL_INTEGRATION_PLAN.md at the repo root.

export const HOTEL_PARTNER_ROLE = 'HOTEL_PARTNER';

export const PROPERTY_TYPES = Object.freeze(['hotel', 'resort', 'villa', 'homestay', 'hostel', 'pg']);

export const INVENTORY_TYPES = Object.freeze(['room', 'bed', 'entire']);

// Which inventory types each property type may sell. Enforced server-side when a room
// type is created or edited (the source app only enforced it in the wizard UI).
export const ALLOWED_INVENTORY_TYPES = Object.freeze({
    hotel: ['room'],
    resort: ['room'],
    villa: ['entire'],
    homestay: ['room', 'entire'],
    hostel: ['bed'],
    pg: ['bed'],
});

export const isInventoryTypeAllowed = (propertyType, inventoryType) =>
    (ALLOWED_INVENTORY_TYPES[propertyType] || []).includes(inventoryType);

export const PARTNER_STATUSES = Object.freeze(['pending', 'approved', 'rejected', 'blocked']);

export const PROPERTY_STATUSES = Object.freeze(['draft', 'pending', 'approved', 'rejected', 'suspended']);

export const BOOKING_STATUSES = Object.freeze([
    'awaiting_payment',
    'confirmed',
    'checked_in',
    'checked_out',
    'cancelled',
    'no_show',
    'expired',
]);

export const PAYMENT_MODES = Object.freeze(['pay_at_hotel', 'online', 'wallet', 'partial_prepaid']);

export const PAYMENT_STATUSES = Object.freeze([
    'pending',
    'paid',
    'partially_paid',
    'refunded',
    'partially_refunded',
    'failed',
]);

export const AVAILABILITY_SOURCES = Object.freeze(['platform', 'walk_in', 'external', 'manual_block']);

export const CANCELLATION_POLICY_TYPES = Object.freeze(['flexible', 'moderate', 'strict', 'non_refundable']);

export const MEAL_PLANS = Object.freeze(['room_only', 'breakfast', 'half_board', 'full_board']);

export const SUITABILITY = Object.freeze(['couple_friendly', 'family_friendly', 'both', 'none']);

// Fixed amenity catalogue so search filters match exactly. `key` is what is stored.
export const AMENITIES = Object.freeze([
    { key: 'wifi', label: 'Free Wi-Fi' },
    { key: 'ac', label: 'Air conditioning' },
    { key: 'parking', label: 'Parking' },
    { key: 'restaurant', label: 'Restaurant' },
    { key: 'room_service', label: 'Room service' },
    { key: 'pool', label: 'Swimming pool' },
    { key: 'gym', label: 'Gym' },
    { key: 'spa', label: 'Spa' },
    { key: 'power_backup', label: 'Power backup' },
    { key: 'lift', label: 'Lift' },
    { key: 'cctv', label: 'CCTV' },
    { key: 'housekeeping', label: 'Daily housekeeping' },
    { key: 'tv', label: 'TV' },
    { key: 'geyser', label: 'Hot water' },
    { key: 'kitchen', label: 'Kitchen access' },
    { key: 'laundry', label: 'Laundry' },
    { key: 'breakfast', label: 'Breakfast available' },
    { key: 'pet_friendly', label: 'Pet friendly' },
    { key: 'wheelchair', label: 'Wheelchair accessible' },
    { key: 'front_desk_24x7', label: '24x7 front desk' },
]);

export const AMENITY_KEYS = Object.freeze(AMENITIES.map((a) => a.key));

// Documents a property must upload before it can be submitted for approval.
// Ported from mydestination backend/config/propertyDocumentRules.js.
export const REQUIRED_DOCUMENTS = Object.freeze({
    hotel: ['trade_license'],
    resort: ['trade_license'],
    villa: ['trade_license'],
    homestay: ['electricity_bill'],
    hostel: ['trade_license', 'rent_agreement'],
    pg: ['trade_license', 'rent_agreement'],
});

export const DOCUMENT_TYPES = Object.freeze([
    'trade_license',
    'rent_agreement',
    'electricity_bill',
    'gst_certificate',
    'fire_noc',
    'other',
]);

// "HH:mm", 24-hour.
export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
