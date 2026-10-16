import mongoose from 'mongoose';

const pointSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
    },
    coordinates: {
      type: [Number],
      required: true,
    },
  },
  { _id: false },
);

const polygonSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['Polygon'],
      required: true,
    },
    coordinates: {
      type: [[[Number]]],
      required: true,
    },
  },
  { _id: false },
);

/*
 * Transit-hub charges (docs/taxi-transit-hubs-contract.md). Absent on rows
 * written before hubs had charges: those are read through the legacy
 * airport_surge / support_airport_fee fields (common/transitHubCharges.js,
 * effectiveHubCharges), so an old airport keeps charging what it did.
 */
const vehicleAmountSchema = new mongoose.Schema(
  {
    // null = every vehicle type (the fallback entry)
    vehicle_type_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiVehicle', default: null },
    amount: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const timeWindowSchema = new mongoose.Schema(
  {
    name: { type: String, default: '', trim: true },
    days: { type: [Number], default: [] }, // 0=Sun..6; empty = every day
    start: { type: String, default: '00:00' }, // HH:mm IST
    end: { type: String, default: '00:00' }, // HH:mm IST; may cross midnight
    multiplier: { type: Number, default: 1, min: 0 },
    extra_flat: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const specialDateSchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // YYYY-MM-DD (IST)
    label: { type: String, default: '', trim: true },
    multiplier: { type: Number, default: 1, min: 0 },
    extra_flat: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const hubChargesSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    pickup_fee: { type: [vehicleAmountSchema], default: [] },
    drop_fee: { type: [vehicleAmountSchema], default: [] },
    parking: {
      enabled: { type: Boolean, default: false },
      free_minutes: { type: Number, default: 0, min: 0 },
      block_minutes: { type: Number, default: 15, min: 0 },
      block_amount: { type: Number, default: 0, min: 0 },
      max_amount: { type: Number, default: null, min: 0 },
    },
    time_windows: { type: [timeWindowSchema], default: [] },
    special_dates: { type: [specialDateSchema], default: [] },
    surge: {
      percent: { type: Number, default: 0, min: 0 },
      flat: { type: Number, default: 0, min: 0 },
    },
  },
  { _id: false },
);

export const HUB_TYPES = ['airport', 'railway_station', 'bus_stand'];

const airportSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      default: '',
      trim: true,
      uppercase: true,
    },
    hub_type: {
      type: String,
      enum: HUB_TYPES,
      default: 'airport',
    },
    // Used to match a point when no boundary is drawn.
    radius_meters: {
      type: Number,
      default: 500,
      min: 0,
    },
    service_location_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiServiceLocation',
      default: null,
    },
    zone_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiZone',
      default: null,
    },
    terminal: {
      type: String,
      default: '',
      trim: true,
    },
    address: {
      type: String,
      default: '',
      trim: true,
    },
    contact_number: {
      type: String,
      default: '',
      trim: true,
    },
    latitude: {
      type: Number,
      default: null,
    },
    longitude: {
      type: Number,
      default: null,
    },
    location: {
      type: pointSchema,
      default: undefined,
    },
    boundary: {
      type: polygonSchema,
      default: undefined,
    },
    charges: {
      type: hubChargesSchema,
      default: undefined,
    },
    // Legacy (pre-charges) fields, still accepted and kept in step with charges.
    airport_surge: {
      type: Number,
      default: 0,
      min: 0,
    },
    support_airport_fee: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

airportSchema.index({ name: 1 });
airportSchema.index({ code: 1 });
airportSchema.index({ service_location_id: 1, status: 1 });
airportSchema.index({ location: '2dsphere' });
airportSchema.index({ boundary: '2dsphere' });
airportSchema.index({ hub_type: 1, status: 1 });

export const Airport = mongoose.models.TaxiAirport || mongoose.model('TaxiAirport', airportSchema);
