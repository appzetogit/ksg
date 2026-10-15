/**
 * Sub-admins get exactly what they were given, in every panel.
 *
 * Run: node tests/admin-access.smoke.mjs
 *
 * What this guards:
 *   - a sub-admin reaches only the sections ticked for them -- read-only means
 *     read-only -- in Food, Quick Commerce / Medical and Taxi alike;
 *   - a panel not given is closed, whatever the permissions say;
 *   - owners and legacy owner accounts (made before admin levels existed) are
 *     never refused, so the guard cannot lock the business out;
 *   - taxi's old 'x.view' permissions keep working;
 *   - nobody hands out a panel or a permission they do not hold themselves;
 *   - a deactivated or edited admin is re-checked on their very next request;
 *   - platform settings stay with superadmins;
 *   - the Hotels panel follows the same rules (hotel_* sections).
 */
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

let failed = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${label}\n        ${err.message}`);
  }
};

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri('admin_access');
await mongoose.connect(mongo.getUri('admin_access'));

const policy = await import('../src/core/admin/adminAccessPolicy.js');
const routes = (await import('../src/routes/index.js')).default;
const { signAccessToken } = await import('../src/core/auth/token.util.js');
const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
const { clearAdminCache } = await import('../src/modules/food/admin/middlewares/foodAdmin.middleware.js');

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use((err, _req, res, _next) => res.status(err.statusCode || err.status || 500).json({ success: false, message: err.message }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;

const tokenFor = (doc) => signAccessToken({ userId: String(doc._id), sub: String(doc._id), role: 'ADMIN' });
const call = async (doc, method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tokenFor(doc)}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};
const refused = (r) => r.status === 403;
const through = (r) => r.status !== 403 && r.status !== 401;

// A legacy owner: no level, no admin_type, no parent -- how the first accounts look.
const legacyOwner = await FoodAdmin.collection.insertOne({ email: 'first@x.in', password: 'x', role: 'ADMIN', name: 'First' })
  .then((r) => FoodAdmin.findById(r.insertedId));
const owner = await FoodAdmin.create({
  email: 'owner@x.in', password: 'secret1', name: 'Owner', adminLevel: 'platform_superadmin',
  admin_type: 'superadmin', permissions: ['*'], servicesAccess: ['food', 'quickCommerce', 'medical', 'taxi', 'hotel'],
});
const ordersReader = await FoodAdmin.create({
  email: 'orders@x.in', password: 'secret1', name: 'Orders reader', parentAdminId: owner._id,
  adminLevel: 'subadmin', admin_type: 'subadmin', permissions: ['orders.read', 'restaurants.write'], servicesAccess: ['food'],
});
const medicalOnly = await FoodAdmin.create({
  email: 'med@x.in', password: 'secret1', name: 'Medical', parentAdminId: owner._id,
  adminLevel: 'subadmin', admin_type: 'subadmin', permissions: ['orders.write'], servicesAccess: ['medical'],
});
// Made by taxi's own form: role 'subadmin', 'x.view' permissions, no servicesAccess.
const taxiLegacy = await FoodAdmin.collection.insertOne({
  email: 'taxi@x.in', password: 'x', name: 'Taxi', role: 'subadmin', admin_type: 'subadmin', permissions: ['drivers.view'],
}).then((r) => FoodAdmin.findById(r.insertedId));

console.log('\npolicy');

await check('path table maps the sections the panels call', () => {
  const r = policy.resolveStoreAdminResource;
  assert.equal(r('/orders', 'GET'), 'orders');
  assert.equal(r('/orders/abc/status', 'PATCH'), 'orders');
  assert.equal(r('/customers/1', 'GET'), 'customers');
  assert.equal(r('/restaurants/complaints', 'GET'), 'support');
  assert.equal(r('/restaurants/1/approve', 'PATCH'), 'restaurants');
  assert.equal(r('/delivery/withdrawals/1', 'PATCH'), 'wallet');
  assert.equal(r('/delivery/join-requests', 'GET'), 'delivery');
  assert.equal(r('/zones', 'GET'), policy.OPEN);
  assert.equal(r('/zones', 'POST'), 'zones');
  assert.equal(r('/admin-management/admins', 'GET'), 'subadmins');
  assert.equal(r('/business-settings', 'PATCH'), 'settings');
  assert.equal(policy.resolveTaxiAdminResource('/admin/drivers/1', 'PATCH'), 'delivery');
  assert.equal(policy.resolveTaxiAdminResource('/admin/wallet/users/1/adjust', 'POST'), 'wallet');
});

await check('an unmapped write is closed to a sub-admin, an unmapped read is not', () => {
  const d = (write) => policy.decideAdminAccess(ordersReader, { service: 'food', resource: null, write });
  assert.equal(d(true).allowed, false);
  assert.equal(d(false).allowed, true);
});

await check('legacy owner and taxi-made owner accounts are owners', () => {
  assert.equal(policy.effectiveAdminLevel(legacyOwner), 'platform_superadmin');
  assert.equal(policy.effectiveAdminLevel({ role: 'superadmin', permissions: ['*'] }), 'platform_superadmin');
  assert.equal(policy.effectiveAdminLevel(taxiLegacy), 'subadmin');
});

await check("taxi's old permissions map onto the shared ones, and keep their panel", () => {
  assert.deepEqual(policy.expandPermissions(['drivers.view']), ['delivery.read', 'delivery.write']);
  assert.deepEqual(policy.effectiveServices(taxiLegacy), ['taxi']);
});

await check('a cached admin keeps its id (sub-admins were saved without a parent)', async () => {
  const { loadAdminCached } = await import('../src/modules/food/admin/middlewares/foodAdmin.middleware.js');
  await loadAdminCached(owner._id);
  const hit = await loadAdminCached(owner._id);
  assert.equal(String(hit._id), String(owner._id));
});

await check('a sub-admin saved without a parent is still a sub-admin', () => {
  const orphan = { role: 'ADMIN', adminLevel: 'subadmin', admin_type: 'subadmin', module: 'food', permissions: ['orders.read'] };
  assert.equal(policy.effectiveAdminLevel(orphan), 'subadmin');
});

console.log('\nfood panel');

await check('owners reach everything', async () => {
  assert.ok(through(await call(owner, 'GET', '/v1/food/admin/customers')));
  assert.ok(through(await call(legacyOwner, 'PATCH', '/v1/food/admin/business-settings', {})));
});

await check('a sub-admin reads what they were given', async () => {
  assert.ok(through(await call(ordersReader, 'GET', '/v1/food/admin/orders')));
});

await check('read-only means read-only', async () => {
  const r = await call(ordersReader, 'PATCH', `/v1/food/admin/orders/${new mongoose.Types.ObjectId()}/status`, { status: 'delivered' });
  assert.ok(refused(r), `got ${r.status}`);
  assert.match(r.json?.message || '', /view .* but not change/);
});

await check('a section not given is refused', async () => {
  assert.ok(refused(await call(ordersReader, 'GET', '/v1/food/admin/customers')));
  assert.ok(refused(await call(ordersReader, 'GET', '/v1/food/admin/delivery/withdrawals')));
  assert.ok(refused(await call(ordersReader, 'PUT', '/v1/food/admin/fee-settings', {})));
});

await check('write permission allows the change', async () => {
  const r = await call(ordersReader, 'PATCH', `/v1/food/admin/restaurants/${new mongoose.Types.ObjectId()}/status`, {});
  assert.ok(through(r), `got ${r.status}`);
});

console.log('\nother panels');

await check('a panel not given is closed', async () => {
  assert.ok(refused(await call(ordersReader, 'GET', '/v1/qc/admin/orders')));
  assert.ok(refused(await call(ordersReader, 'GET', '/v1/taxi/admin/drivers')));
  assert.ok(refused(await call(medicalOnly, 'GET', '/v1/food/admin/orders')));
});

await check('Medical access opens the quick-commerce API, within its sections', async () => {
  assert.ok(through(await call(medicalOnly, 'GET', '/v1/qc/admin/orders')));
  assert.ok(refused(await call(medicalOnly, 'GET', '/v1/qc/admin/customers')));
});

await check('a taxi sub-admin keeps drivers and nothing else', async () => {
  assert.ok(through(await call(taxiLegacy, 'GET', '/v1/taxi/admin/drivers')));
  assert.ok(refused(await call(taxiLegacy, 'GET', '/v1/taxi/admin/users')));
  assert.ok(refused(await call(taxiLegacy, 'GET', '/v1/food/admin/orders')));
});

await check('platform settings are not a sub-admin\'s to change', async () => {
  const r = await call(ordersReader, 'PUT', '/v1/platform/app-services/admin/food', { enabled: false });
  assert.ok(refused(r), `got ${r.status}`);
});

console.log('\nhotel panel');

const hotelReader = await FoodAdmin.create({
  email: 'hotelread@x.in', password: 'secret1', name: 'Hotel reader', parentAdminId: owner._id,
  adminLevel: 'subadmin', admin_type: 'subadmin', permissions: ['hotel_partners.read', 'hotel_bookings.read'], servicesAccess: ['hotel'],
});
const hotelApprover = await FoodAdmin.create({
  email: 'hotelapprove@x.in', password: 'secret1', name: 'Hotel approver', parentAdminId: owner._id,
  adminLevel: 'subadmin', admin_type: 'subadmin', permissions: ['hotel_partners.write'], servicesAccess: ['hotel'],
});
const someId = () => String(new mongoose.Types.ObjectId());

await check('hotel path table maps every admin route', () => {
  const r = policy.resolveHotelAdminResource;
  assert.equal(r('/overview', 'GET'), 'dashboard');
  assert.equal(r('/partners', 'GET'), 'hotel_partners');
  assert.equal(r('/partners/1/status', 'PUT'), 'hotel_partners');
  assert.equal(r('/properties/1/documents/verify', 'PUT'), 'hotel_properties');
  assert.equal(r('/properties/1/live', 'PUT'), 'hotel_properties');
  assert.equal(r('/bookings/1/refund', 'POST'), 'hotel_bookings');
  assert.equal(r('/reviews/1/status', 'PUT'), 'hotel_reviews');
  assert.equal(r('/withdrawals/1/status', 'PUT'), 'hotel_withdrawals');
  assert.equal(r('/settings', 'PUT'), 'hotel_settings');
  assert.ok(policy.ADMIN_SERVICE_KEYS.includes('hotel'));
  assert.ok(!policy.ADMIN_SERVICE_KEYS.includes('serviceProvider'));
});

await check('superadmins reach the hotel panel', async () => {
  assert.equal((await call(owner, 'GET', '/v1/hotel/admin/partners')).status, 200);
  assert.equal((await call(legacyOwner, 'GET', '/v1/hotel/admin/settings')).status, 200);
  assert.ok(through(await call(owner, 'PUT', `/v1/hotel/admin/partners/${someId()}/status`, { status: 'approved' })));
});

await check('a hotel read-only sub-admin lists partners but cannot approve one', async () => {
  const list = await call(hotelReader, 'GET', '/v1/hotel/admin/partners');
  assert.equal(list.status, 200, list.json?.message);
  assert.ok(through(await call(hotelReader, 'GET', '/v1/hotel/admin/bookings')));
  const approve = await call(hotelReader, 'PUT', `/v1/hotel/admin/partners/${someId()}/status`, { status: 'approved' });
  assert.ok(refused(approve), `got ${approve.status}`);
  assert.match(approve.json?.message || '', /view Hotel partners but not change/);
  assert.ok(refused(await call(hotelReader, 'PUT', `/v1/hotel/admin/bookings/${someId()}/status`, { status: 'cancelled' })));
});

await check('hotel sections not given are refused', async () => {
  assert.ok(refused(await call(hotelReader, 'GET', '/v1/hotel/admin/withdrawals')));
  assert.ok(refused(await call(hotelReader, 'GET', '/v1/hotel/admin/settings')));
  assert.ok(refused(await call(hotelReader, 'PUT', '/v1/hotel/admin/settings', { minWithdrawal: 1 })));
  assert.ok(refused(await call(hotelApprover, 'GET', '/v1/hotel/admin/properties')));
});

await check('hotel write permission allows the approval', async () => {
  const r = await call(hotelApprover, 'PUT', `/v1/hotel/admin/partners/${someId()}/status`, { status: 'approved' });
  assert.ok(through(r), `got ${r.status} ${r.json?.message}`);
});

await check('a sub-admin without hotel gets 403 from every hotel route', async () => {
  assert.ok(refused(await call(ordersReader, 'GET', '/v1/hotel/admin/partners')));
  assert.ok(refused(await call(medicalOnly, 'GET', '/v1/hotel/admin/overview')));
  // and a hotel-only admin stays out of the other panels
  assert.ok(refused(await call(hotelReader, 'GET', '/v1/food/admin/orders')));
});

await check('the admin form offers Hotels and its sections, and saves them', async () => {
  const meta = await call(owner, 'GET', '/v1/platform/admins/meta');
  assert.equal(meta.status, 200, meta.json?.message);
  assert.ok(meta.json.data.services.some((s) => s.key === 'hotel' && s.label === 'Hotels'));
  const group = meta.json.data.catalog.find((g) => g.group === 'Hotels');
  assert.ok(group, 'Hotels permission group');
  assert.deepEqual(group.resources.map((r) => r.key).sort(),
    ['hotel_bookings', 'hotel_partners', 'hotel_properties', 'hotel_reviews', 'hotel_settings', 'hotel_withdrawals']);
  const made = await call(owner, 'POST', '/v1/platform/admins', {
    name: 'Stays desk', email: 'stays@x.in', password: 'secret1', password_confirmation: 'secret1',
    role: 'custom', servicesAccess: ['hotel'], permissions: ['hotel_bookings.read', 'hotel_reviews.write', 'dashboard.read'],
  });
  assert.equal(made.status, 200, made.json?.message);
  const saved = await FoodAdmin.findOne({ email: 'stays@x.in' });
  assert.deepEqual([...saved.servicesAccess], ['hotel']);
  assert.ok(saved.permissions.includes('hotel_reviews.write'));
  assert.ok(through(await call(saved, 'GET', '/v1/hotel/admin/overview')));
  assert.ok(refused(await call(saved, 'GET', '/v1/hotel/admin/partners')));
  const me = await call(hotelReader, 'GET', '/v1/platform/admins/me');
  assert.deepEqual(me.json.data.servicesAccess, ['hotel']);
});

console.log('\nadmin accounts');

let manager;
await check('an owner creates a sub-admin for several panels', async () => {
  const r = await call(owner, 'POST', '/v1/platform/admins', {
    name: 'Ops lead', email: 'ops@x.in', password: 'secret1', password_confirmation: 'secret1',
    role: 'custom', servicesAccess: ['food', 'medical'],
    permissions: ['orders.write', 'customers.read', 'subadmins.write'],
  });
  assert.equal(r.status, 200, r.json?.message);
  manager = await FoodAdmin.findOne({ email: 'ops@x.in' });
  assert.deepEqual([...manager.servicesAccess].sort(), ['food', 'medical']);
  assert.equal(policy.effectiveAdminLevel(manager), 'subadmin');
  assert.equal(String(manager.parentAdminId), String(owner._id));
});

await check('the new sub-admin is restricted at once', async () => {
  assert.ok(through(await call(manager, 'GET', '/v1/food/admin/customers')));
  assert.ok(refused(await call(manager, 'PATCH', `/v1/food/admin/customers/${new mongoose.Types.ObjectId()}/status`, {})));
  assert.ok(refused(await call(manager, 'GET', '/v1/taxi/admin/drivers')));
});

await check('nobody gives what they do not hold', async () => {
  const more = await call(manager, 'POST', '/v1/platform/admins', {
    name: 'A', email: 'a@x.in', password: 'secret1', role: 'custom', servicesAccess: ['food'], permissions: ['wallet.read'],
  });
  assert.equal(more.status, 403, more.json?.message);
  const panel = await call(manager, 'POST', '/v1/platform/admins', {
    name: 'A', email: 'a@x.in', password: 'secret1', role: 'custom', servicesAccess: ['taxi'], permissions: ['orders.read'],
  });
  assert.equal(panel.status, 403, panel.json?.message);
  const upgrade = await call(manager, 'POST', '/v1/platform/admins', {
    name: 'A', email: 'a@x.in', password: 'secret1', role: 'customers.write', servicesAccess: ['food'], permissions: ['customers.write'],
  });
  assert.equal(upgrade.status, 403, upgrade.json?.message);
  const full = await call(manager, 'POST', '/v1/platform/admins', {
    name: 'A', email: 'a@x.in', password: 'secret1', role: 'full', servicesAccess: ['food'],
  });
  assert.equal(full.status, 403, full.json?.message);
});

let junior;
await check('a manager creates within their own scope and sees only their people', async () => {
  const r = await call(manager, 'POST', '/v1/platform/admins', {
    name: 'Junior', email: 'junior@x.in', password: 'secret1', role: 'custom', servicesAccess: ['medical'], permissions: ['orders.read'],
  });
  assert.equal(r.status, 200, r.json?.message);
  junior = await FoodAdmin.findOne({ email: 'junior@x.in' });
  const list = await call(manager, 'GET', '/v1/platform/admins');
  assert.deepEqual(list.json.data.results.map((a) => a.email), ['junior@x.in']);
  const all = await call(owner, 'GET', '/v1/platform/admins');
  assert.ok(all.json.data.results.length >= 5);
  assert.ok(refused(await call(manager, 'PATCH', `/v1/platform/admins/${ordersReader._id}`, { role: 'custom', servicesAccess: ['food'], permissions: ['orders.read'] })));
});

await check('switching an admin off takes effect on their next request', async () => {
  assert.ok(through(await call(junior, 'GET', '/v1/qc/admin/orders')));
  const r = await call(manager, 'PATCH', `/v1/platform/admins/${junior._id}/status`, { isActive: false });
  assert.equal(r.status, 200, r.json?.message);
  assert.ok(refused(await call(junior, 'GET', '/v1/qc/admin/orders')));
});

await check('narrowing an admin takes effect on their next request', async () => {
  assert.ok(through(await call(ordersReader, 'GET', '/v1/food/admin/orders')));
  const r = await call(owner, 'PATCH', `/v1/platform/admins/${ordersReader._id}`, {
    role: 'custom', servicesAccess: ['food'], permissions: ['customers.read'],
  });
  assert.equal(r.status, 200, r.json?.message);
  assert.ok(refused(await call(ordersReader, 'GET', '/v1/food/admin/orders')));
});

await check('a taxi admin needs a service location, and is then valid in taxi', async () => {
  const bad = await call(owner, 'POST', '/v1/platform/admins', {
    name: 'T', email: 't2@x.in', password: 'secret1', role: 'custom', servicesAccess: ['taxi'], permissions: ['delivery.read'],
  });
  assert.equal(bad.status, 400);
  const ok = await call(owner, 'POST', '/v1/platform/admins', {
    name: 'T', email: 't2@x.in', password: 'secret1', role: 'custom', servicesAccess: ['taxi'], permissions: ['delivery.read'],
    serviceLocationIds: [String(new mongoose.Types.ObjectId())],
  });
  assert.equal(ok.status, 200, ok.json?.message);
  const raw = await FoodAdmin.collection.findOne({ email: 't2@x.in' });
  assert.equal(raw.active, true);
  assert.equal(raw.status, 'active');
});

await check('/me tells the panel what to show', async () => {
  const r = await call(manager, 'GET', '/v1/platform/admins/me');
  assert.equal(r.json.data.isSuperAdmin, false);
  assert.ok(r.json.data.permissions.includes('customers.read'));
  assert.deepEqual([...r.json.data.servicesAccess].sort(), ['food', 'medical']);
  const o = await call(legacyOwner, 'GET', '/v1/platform/admins/me');
  assert.equal(o.json.data.isOwner, true);
});

await check('nobody removes themselves; an owner removes another owner', async () => {
  const self = await call(owner, 'DELETE', `/v1/platform/admins/${owner._id}`);
  assert.equal(self.status, 400);
  assert.equal((await call(manager, 'DELETE', `/v1/platform/admins/${owner._id}`)).status, 403);
  assert.equal((await call(owner, 'DELETE', `/v1/platform/admins/${legacyOwner._id}`)).status, 200);
});

clearAdminCache();
server.close();
await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
