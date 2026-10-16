/**
 * Transit hubs (airports, railway stations, bus stands): shape helpers for the
 * admin screens. The wire format is docs/taxi-transit-hubs-contract.md; the form
 * keeps numbers as strings so empty inputs stay empty until save.
 */
import { Bus, Plane, TrainFront } from 'lucide-react';

export const HUB_TYPES = [
  { value: 'airport', label: 'Airport', plural: 'Airports', icon: Plane },
  { value: 'railway_station', label: 'Railway station', plural: 'Railway stations', icon: TrainFront },
  { value: 'bus_stand', label: 'Bus stand', plural: 'Bus stands', icon: Bus },
];

export const hubTypeMeta = (type) => HUB_TYPES.find((t) => t.value === type) || HUB_TYPES[0];

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const DEFAULT_RADIUS_METERS = 500;

export const ADMIN_BASE_PATH = '/taxi/admin/pricing/airport';

const idOf = (value) => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'object') return String(value._id || value.id || '');
  return String(value);
};

const numStr = (value) => (value === null || value === undefined || value === '' ? '' : String(value));

const toNumber = (value, fallback = 0) => {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const formatRupees = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '₹0';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

/** Pulls an array out of whatever envelope the list endpoint answers with. */
export const extractList = (response, keys = ['airports', 'items', 'results', 'hubs']) => {
  const candidates = [response?.data, response, response?.data?.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') {
      for (const key of keys) {
        if (Array.isArray(candidate[key])) return candidate[key];
      }
    }
  }
  return [];
};

/** Boundary as [{lat,lng}] (open ring), from GeoJSON `boundary` or legacy `boundary_coordinates`. */
export const readBoundary = (hub) => {
  const ring = hub?.boundary?.coordinates?.[0];
  let points = [];
  if (Array.isArray(ring) && ring.length) {
    points = ring
      .map((pair) => (Array.isArray(pair) ? { lat: Number(pair[1]), lng: Number(pair[0]) } : null))
      .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  } else if (Array.isArray(hub?.boundary_coordinates)) {
    points = hub.boundary_coordinates
      .map((p) => ({ lat: Number(p?.lat), lng: Number(p?.lng) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  }
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first.lat === last.lat && first.lng === last.lng) points = points.slice(0, -1);
  }
  return points;
};

/** [{lat,lng}] -> GeoJSON Polygon (closed ring, [lng, lat]). */
export const toGeoJsonPolygon = (points) => {
  if (!Array.isArray(points) || points.length < 3) return null;
  const ring = points.map((p) => [Number(p.lng), Number(p.lat)]);
  ring.push([...ring[0]]);
  return { type: 'Polygon', coordinates: [ring] };
};

/** A 16-sided polygon of `radius` metres around a point ("circle-ish box"). */
export const circlePolygon = (center, radius = DEFAULT_RADIUS_METERS, sides = 16) => {
  const lat = Number(center?.lat);
  const lng = Number(center?.lng);
  const r = Number(radius) > 0 ? Number(radius) : DEFAULT_RADIUS_METERS;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const dLat = r / 111320;
  const dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: sides }, (_, i) => {
    const angle = (2 * Math.PI * i) / sides;
    return {
      lat: Number((lat + dLat * Math.sin(angle)).toFixed(6)),
      lng: Number((lng + dLng * Math.cos(angle)).toFixed(6)),
    };
  });
};

const emptyCharges = () => ({
  enabled: false,
  pickup_fee: {}, // { [vehicle_type_id | '__all']: '100' }
  drop_fee: {},
  parking: { enabled: false, free_minutes: '10', block_minutes: '15', block_amount: '', max_amount: '' },
  time_windows: [],
  special_dates: [],
  surge: { percent: '', flat: '' },
});

export const ALL_TYPES_KEY = '__all';

const feeListToMap = (list) => {
  const map = {};
  (Array.isArray(list) ? list : []).forEach((row) => {
    const key = row?.vehicle_type_id ? idOf(row.vehicle_type_id) : ALL_TYPES_KEY;
    map[key] = numStr(row?.amount);
  });
  return map;
};

const feeMapToList = (map) =>
  Object.entries(map || {})
    .filter(([, amount]) => amount !== '' && amount !== null && amount !== undefined)
    .map(([key, amount]) => ({
      vehicle_type_id: key === ALL_TYPES_KEY ? null : key,
      amount: toNumber(amount),
    }));

export const emptyForm = (overrides = {}) => ({
  hub_type: 'airport',
  name: '',
  code: '',
  terminal: '',
  address: '',
  contact_number: '',
  service_location_id: '',
  zone_id: '',
  latitude: '',
  longitude: '',
  radius_meters: String(DEFAULT_RADIUS_METERS),
  active: true,
  boundary: [],
  charges: emptyCharges(),
  ...overrides,
});

let rowSeq = 0;
export const newRowKey = () => `row-${Date.now()}-${(rowSeq += 1)}`;

/** API hub -> form state. Folds legacy airport_surge/support_airport_fee into charges. */
export const hubToForm = (hub = {}) => {
  const c = hub.charges || {};
  const charges = emptyCharges();
  const hasCharges = hub.charges && typeof hub.charges === 'object';

  charges.enabled = hasCharges ? Boolean(c.enabled) : false;
  charges.pickup_fee = feeListToMap(c.pickup_fee);
  charges.drop_fee = feeListToMap(c.drop_fee);
  if (c.parking) {
    charges.parking = {
      enabled: Boolean(c.parking.enabled),
      free_minutes: numStr(c.parking.free_minutes),
      block_minutes: numStr(c.parking.block_minutes),
      block_amount: numStr(c.parking.block_amount),
      max_amount: numStr(c.parking.max_amount),
    };
  }
  charges.time_windows = (Array.isArray(c.time_windows) ? c.time_windows : []).map((w) => ({
    key: newRowKey(),
    name: w?.name || '',
    days: Array.isArray(w?.days) ? w.days.map(Number) : [],
    start: w?.start || '',
    end: w?.end || '',
    multiplier: numStr(w?.multiplier ?? 1),
    extra_flat: numStr(w?.extra_flat ?? 0),
  }));
  charges.special_dates = (Array.isArray(c.special_dates) ? c.special_dates : []).map((d) => ({
    key: newRowKey(),
    date: String(d?.date || '').slice(0, 10),
    label: d?.label || '',
    multiplier: numStr(d?.multiplier ?? 1),
    extra_flat: numStr(d?.extra_flat ?? 0),
  }));
  charges.surge = { percent: numStr(c.surge?.percent), flat: numStr(c.surge?.flat) };

  // Legacy rows (before charges existed) still carry the two old fields.
  if (!hasCharges) {
    const legacyFee = Number(hub.support_airport_fee);
    const legacySurge = Number(hub.airport_surge);
    if (legacyFee > 0) charges.pickup_fee[ALL_TYPES_KEY] = String(legacyFee);
    if (legacySurge > 0) charges.surge.percent = String(legacySurge);
    charges.enabled = legacyFee > 0 || legacySurge > 0;
  }

  const status = hub.status || (hub.active === false ? 'inactive' : 'active');
  return emptyForm({
    hub_type: hub.hub_type || 'airport',
    name: hub.name || '',
    code: hub.code || '',
    terminal: hub.terminal || '',
    address: hub.address || '',
    contact_number: hub.contact_number || '',
    service_location_id: idOf(hub.service_location_id),
    zone_id: idOf(hub.zone_id),
    latitude: numStr(hub.latitude),
    longitude: numStr(hub.longitude),
    radius_meters: numStr(hub.radius_meters ?? DEFAULT_RADIUS_METERS),
    active: status === 'active',
    boundary: readBoundary(hub),
    charges,
  });
};

/** Form state -> request body per the contract (plus legacy mirrors for older servers). */
export const formToPayload = (form) => {
  const c = form.charges;
  const pickup = feeMapToList(c.pickup_fee);
  const drop = feeMapToList(c.drop_fee);
  const status = form.active ? 'active' : 'inactive';
  const polygon = toGeoJsonPolygon(form.boundary);
  const surgePercent = toNumber(c.surge.percent);
  const allTypesPickup = pickup.find((row) => row.vehicle_type_id === null);

  return {
    hub_type: form.hub_type,
    name: form.name.trim(),
    code: form.code.trim().toUpperCase(),
    terminal: form.terminal.trim(),
    address: form.address.trim(),
    contact_number: form.contact_number.trim(),
    service_location_id: form.service_location_id || null,
    zone_id: form.zone_id || null,
    latitude: form.latitude === '' ? null : Number(form.latitude),
    longitude: form.longitude === '' ? null : Number(form.longitude),
    boundary: polygon,
    // Same polygon in the shape the current server reads; harmless for the new one.
    boundary_coordinates: polygon ? form.boundary.map((p) => ({ lat: p.lat, lng: p.lng })) : [],
    radius_meters: toNumber(form.radius_meters, DEFAULT_RADIUS_METERS),
    status,
    active: form.active,
    charges: {
      enabled: Boolean(c.enabled),
      pickup_fee: pickup,
      drop_fee: drop,
      parking: {
        enabled: Boolean(c.parking.enabled),
        free_minutes: toNumber(c.parking.free_minutes),
        block_minutes: toNumber(c.parking.block_minutes, 1),
        block_amount: toNumber(c.parking.block_amount),
        max_amount: c.parking.max_amount === '' ? null : toNumber(c.parking.max_amount),
      },
      time_windows: c.time_windows.map((w) => ({
        name: w.name.trim(),
        days: [...w.days].sort((a, b) => a - b),
        start: w.start,
        end: w.end,
        multiplier: toNumber(w.multiplier, 1),
        extra_flat: toNumber(w.extra_flat),
      })),
      special_dates: c.special_dates.map((d) => ({
        date: d.date,
        label: d.label.trim(),
        multiplier: toNumber(d.multiplier, 1),
        extra_flat: toNumber(d.extra_flat),
      })),
      surge: { percent: surgePercent, flat: toNumber(c.surge.flat) },
    },
    // Legacy mirrors: the contract still accepts these and maps them onto charges.
    airport_surge: c.enabled ? surgePercent : 0,
    support_airport_fee: c.enabled && allTypesPickup ? allTypesPickup.amount : 0,
  };
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isNonNegative = (v) => v === '' || (Number.isFinite(Number(v)) && Number(v) >= 0);

/** Returns { [fieldPath]: message }. Empty object = valid. */
export const validateForm = (form) => {
  const errors = {};
  const c = form.charges;

  if (!form.name.trim()) errors.name = 'Name is required.';
  if (!form.service_location_id) errors.service_location_id = 'Pick the service location this hub belongs to.';
  if (form.code && !/^[A-Za-z0-9-]{2,10}$/.test(form.code.trim())) {
    errors.code = 'Use 2-10 letters or digits (e.g. BHO, BPL).';
  }
  if (form.latitude === '' || form.longitude === '') {
    errors.pin = 'Place the pin on the map (click the map or search).';
  } else {
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      errors.pin = 'Pin coordinates are not valid.';
    }
  }
  if (form.boundary.length > 0 && form.boundary.length < 3) {
    errors.boundary = 'A boundary needs at least 3 points (or clear it to use the radius).';
  }
  const radius = Number(form.radius_meters);
  if (form.boundary.length < 3 && (!Number.isFinite(radius) || radius < 50 || radius > 20000)) {
    errors.radius_meters = 'Without a boundary the radius is used: enter 50 - 20000 m.';
  }
  if (form.contact_number && !/^[+\d][\d\s-]{5,19}$/.test(form.contact_number.trim())) {
    errors.contact_number = 'Enter a phone number (digits, spaces, + or -).';
  }

  if (!c.enabled) return errors;

  Object.entries(c.pickup_fee).forEach(([key, v]) => {
    if (!isNonNegative(v)) errors[`pickup_fee.${key}`] = 'Must be 0 or more.';
  });
  Object.entries(c.drop_fee).forEach(([key, v]) => {
    if (!isNonNegative(v)) errors[`drop_fee.${key}`] = 'Must be 0 or more.';
  });

  if (c.parking.enabled) {
    if (!isNonNegative(c.parking.free_minutes)) errors['parking.free_minutes'] = 'Must be 0 or more.';
    const block = Number(c.parking.block_minutes);
    if (!Number.isFinite(block) || block < 1) errors['parking.block_minutes'] = 'At least 1 minute.';
    if (c.parking.block_amount === '' || !isNonNegative(c.parking.block_amount)) {
      errors['parking.block_amount'] = 'Enter the ₹ per block.';
    }
    if (!isNonNegative(c.parking.max_amount)) errors['parking.max_amount'] = 'Must be 0 or more (blank = no cap).';
  }

  c.time_windows.forEach((w, i) => {
    if (!HHMM.test(w.start)) errors[`tw.${i}.start`] = 'HH:mm';
    if (!HHMM.test(w.end)) errors[`tw.${i}.end`] = 'HH:mm';
    if (HHMM.test(w.start) && w.start === w.end) errors[`tw.${i}.end`] = 'End must differ from start.';
    const m = Number(w.multiplier);
    if (!Number.isFinite(m) || m < 0 || m > 10) errors[`tw.${i}.multiplier`] = '0 - 10';
    if (!isNonNegative(w.extra_flat)) errors[`tw.${i}.extra_flat`] = '0 or more';
    if (!w.name.trim()) errors[`tw.${i}.name`] = 'Name it (e.g. Night).';
  });

  const seenDates = new Set();
  c.special_dates.forEach((d, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) errors[`sd.${i}.date`] = 'Pick a date.';
    else if (seenDates.has(d.date)) errors[`sd.${i}.date`] = 'Date listed twice.';
    seenDates.add(d.date);
    const m = Number(d.multiplier);
    if (!Number.isFinite(m) || m < 0 || m > 10) errors[`sd.${i}.multiplier`] = '0 - 10';
    if (!isNonNegative(d.extra_flat)) errors[`sd.${i}.extra_flat`] = '0 or more';
  });

  if (!isNonNegative(c.surge.percent) || Number(c.surge.percent) > 300) errors['surge.percent'] = '0 - 300 %';
  if (!isNonNegative(c.surge.flat)) errors['surge.flat'] = 'Must be 0 or more.';

  return errors;
};

/** Crosses midnight when end is earlier than start (e.g. 22:00 - 06:00). */
export const crossesMidnight = (start, end) => HHMM.test(start) && HHMM.test(end) && end < start;

const feeSummary = (label, list, vehicleNames) => {
  const rows = (Array.isArray(list) ? list : []).filter((r) => Number(r?.amount) > 0);
  if (!rows.length) return '';
  const Label = label.charAt(0).toUpperCase() + label.slice(1);
  if (rows.length === 1) {
    const row = rows[0];
    if (!row.vehicle_type_id) return `${Label} ${formatRupees(row.amount)}`;
    const name = vehicleNames[idOf(row.vehicle_type_id)] || 'One vehicle type';
    return `${name} ${label} ${formatRupees(row.amount)}`;
  }
  const amounts = rows.map((r) => Number(r.amount));
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  return min === max
    ? `${Label} ${formatRupees(min)}`
    : `${Label} ${formatRupees(min)}–${formatRupees(max).slice(1)}`;
};

/** One-line summary for the list, e.g. "Car pickup ₹100 · parking after 10 min". */
export const chargesSummary = (hub, vehicleNames = {}) => {
  const form = hubToForm(hub);
  const c = formToPayload(form).charges;
  if (!c.enabled) return { text: 'No charges', empty: true };
  const parts = [];
  const pickup = feeSummary('pickup', c.pickup_fee, vehicleNames);
  const drop = feeSummary('drop', c.drop_fee, vehicleNames);
  if (pickup) parts.push(pickup);
  if (drop) parts.push(drop);
  if (c.parking.enabled && c.parking.block_amount > 0) {
    parts.push(`parking after ${c.parking.free_minutes} min (${formatRupees(c.parking.block_amount)}/${c.parking.block_minutes} min)`);
  }
  if (c.surge.percent > 0 || c.surge.flat > 0) {
    const s = [c.surge.percent > 0 ? `${c.surge.percent}%` : '', c.surge.flat > 0 ? formatRupees(c.surge.flat) : '']
      .filter(Boolean)
      .join(' + ');
    parts.push(`surge ${s}`);
  }
  if (c.time_windows.length) parts.push(`${c.time_windows.length} time window${c.time_windows.length > 1 ? 's' : ''}`);
  if (c.special_dates.length) parts.push(`${c.special_dates.length} special date${c.special_dates.length > 1 ? 's' : ''}`);
  return parts.length ? { text: parts.join(' · '), empty: false } : { text: 'Enabled, no amounts set', empty: true };
};

export const vehicleTypeLabel = (vt = {}) => {
  const name = String(vt.name || vt.vehicle_type || 'Vehicle').trim();
  const transport = String(vt.transport_type || '').trim();
  return transport && transport !== 'taxi' ? `${name} (${transport})` : name;
};
