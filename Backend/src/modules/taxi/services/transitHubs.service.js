/**
 * Which transit hub (airport, railway station, bus stand) a point is in, and
 * the public "hubs near me" list. The charge maths is pure and lives in
 * common/transitHubCharges.js; this file is the database side.
 *
 * A point is in a hub when an ACTIVE hub's boundary polygon contains it; a hub
 * with no boundary drawn matches within its radius_meters of its pin. Looked
 * up on every quote and booking, so results are cached for 45 s per ~10 m grid
 * cell; admin writes clear the cache (invalidateHubCache).
 */
import { Airport } from '../admin/models/Airport.js';
import { resolveHubCharges } from '../common/transitHubCharges.js';

export { resolveHubCharges };

const CACHE_TTL_MS = 45 * 1000;
const CACHE_MAX = 1000;
// The widest radius a boundary-less hub is searched for; a hub's own
// radius_meters is then checked against the real distance.
const MAX_FALLBACK_RADIUS_M = 5000;

const cache = new Map();
// Whether any hub exists at all: most points are in none, and a server with no
// hubs (or no geo index yet) should not query for each of them.
let anyHubs = { value: null, expires: 0 };
let lastWarnAt = 0;

export const invalidateHubCache = () => {
  cache.clear();
  anyHubs = { value: null, expires: 0 };
};

const hubsExist = async () => {
  if (anyHubs.value !== null && anyHubs.expires > Date.now()) return anyHubs.value;
  const value = (await Airport.estimatedDocumentCount()) > 0;
  anyHubs = { value, expires: Date.now() + CACHE_TTL_MS };
  return value;
};

const toLatLng = (point) => {
    if (Array.isArray(point)) return { lng: Number(point[0]), lat: Number(point[1]) };
    return { lat: Number(point?.lat ?? point?.latitude), lng: Number(point?.lng ?? point?.longitude) };
};

const activeFilter = { status: 'active', active: { $ne: false } };

const lookupHub = async ({ lat, lng }) => {
    const geometry = { type: 'Point', coordinates: [lng, lat] };
    const inside = await Airport.findOne({
        ...activeFilter,
        boundary: { $geoIntersects: { $geometry: geometry } },
    })
        .sort({ updatedAt: -1 })
        .lean();
    if (inside) return inside;

    const near = await Airport.aggregate([
        {
            $geoNear: {
                near: geometry,
                key: 'location',
                distanceField: 'distanceMeters',
                maxDistance: MAX_FALLBACK_RADIUS_M,
                spherical: true,
                query: { ...activeFilter, 'boundary.type': { $exists: false } },
            },
        },
        { $limit: 20 },
    ]);
    return near.find((hub) => hub.distanceMeters <= Math.max(0, Number(hub.radius_meters ?? 500))) || null;
};

/**
 * The active hub at a point ({ lat, lng } or [lng, lat]), or null. Never throws:
 * a hub lookup failing must not stop a ride being quoted or booked.
 */
export const findHubForPoint = async (point) => {
    const { lat, lng } = toLatLng(point);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.hub;
    let hub = null;
    try {
        hub = (await hubsExist()) ? await lookupHub({ lat, lng }) : null;
    } catch (err) {
        if (Date.now() - lastWarnAt > 60 * 1000) {
            lastWarnAt = Date.now();
            console.warn(`[taxi hubs] lookup failed, no hub applied: ${err.message}`);
        }
        return null;
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { hub, expires: Date.now() + CACHE_TTL_MS });
    return hub;
};

/** Pickup and drop hubs of a trip. */
export const findTripHubs = async ({ pickup, drop }) => {
    const [pickupHub, dropHub] = await Promise.all([
        pickup ? findHubForPoint(pickup) : null,
        drop ? findHubForPoint(drop) : null,
    ]);
    return { pickupHub, dropHub };
};

/** GET /common/transit-hubs: active hubs near a point. */
export const listNearbyHubs = async ({ lat, lng, type, radiusKm, limit = 20 }) => {
    if (!(await hubsExist())) return [];
    const radius = Math.min(200, Math.max(0.1, Number(radiusKm) || 25)) * 1000;
    const query = { ...activeFilter, 'location.type': 'Point' };
    if (type) query.hub_type = type;
    const rows = await Airport.aggregate([
        {
            $geoNear: {
                near: { type: 'Point', coordinates: [lng, lat] },
                key: 'location',
                distanceField: 'distanceMeters',
                maxDistance: radius,
                spherical: true,
                query,
            },
        },
        { $limit: Math.min(50, Math.max(1, Number(limit) || 20)) },
    ]);
    return rows.map((hub) => ({
        id: String(hub._id),
        name: hub.name || '',
        code: hub.code || '',
        type: hub.hub_type || 'airport',
        latitude: hub.latitude ?? hub.location?.coordinates?.[1] ?? null,
        longitude: hub.longitude ?? hub.location?.coordinates?.[0] ?? null,
        address: hub.address || '',
        distanceKm: Math.round((hub.distanceMeters / 1000) * 100) / 100,
    }));
};
