// Replace the rectangular "India" zone polygons with the India outline.
// Dry run by default; --apply writes. Run from Backend/: node scripts/apply-india-zone.mjs [--apply]
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { INDIA_OUTLINE, inside } from './india-zone.mjs';

dotenv.config();
const APPLY = process.argv.includes('--apply');
await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
const db = mongoose.connection.db;

const latLng = INDIA_OUTLINE.map(([latitude, longitude]) => ({ latitude, longitude }));
const ring = [...INDIA_OUTLINE.map(([lat, lng]) => [lng, lat]), [INDIA_OUTLINE[0][1], INDIA_OUTLINE[0][0]]];

// Everything placed in the zone today must still be inside the new outline.
const pointOf = (d) => {
  const c = d?.location?.coordinates || d?.geo?.coordinates;
  if (Array.isArray(c) && c.length === 2 && typeof c[0] === 'number') return [c[1], c[0]];
  const la = d?.location?.latitude ?? d?.latitude ?? d?.lat ?? d?.address?.latitude;
  const lo = d?.location?.longitude ?? d?.longitude ?? d?.lng ?? d?.address?.longitude;
  return typeof la === 'number' && typeof lo === 'number' ? [la, lo] : null;
};
let checked = 0; const outside = [];
for (const coll of ['food_restaurants', 'qc_restaurants', 'hotel_properties', 'taxidrivers', 'sp_vendors', 'sp_workers']) {
  for (const d of await db.collection(coll).find({}).toArray()) {
    const p = pointOf(d);
    if (!p) continue;
    checked++;
    if (!inside(p)) outside.push(`${coll}: ${d.restaurantName || d.name || d._id} @ ${p}`);
  }
}
console.log(`placed records checked: ${checked}; outside new outline: ${outside.length}`);
outside.forEach((o) => console.log('  !', o));
if (outside.length) { console.log('Refusing to apply.'); process.exit(2); }

const plans = [
  ['food_zones', { $set: { coordinates: latLng, boundary_mode: 'polygon', updatedAt: new Date() } }],
  ['qc_zones', { $set: { coordinates: latLng, updatedAt: new Date() } }],
  ['medical_zones', { $set: { coordinates: latLng, updatedAt: new Date() } }],
  ['taxizones', { $set: { geometry: { type: 'Polygon', coordinates: [ring] }, boundary_mode: 'polygon', updatedAt: new Date() } }],
];
for (const [coll, update] of plans) {
  const z = await db.collection(coll).findOne({ name: 'India' });
  if (!z) { console.log(`${coll}: no "India" zone, skipped`); continue; }
  const before = (z.coordinates || z.geometry?.coordinates?.[0] || []).length;
  if (APPLY) await db.collection(coll).updateOne({ _id: z._id }, update);
  console.log(`${coll}: ${z._id} ${before} -> ${coll === 'taxizones' ? ring.length : latLng.length} points ${APPLY ? 'UPDATED' : '(dry run)'}`);
}
console.log(APPLY ? 'Done.' : 'DRY RUN: nothing written. Re-run with --apply.');
await mongoose.disconnect();
