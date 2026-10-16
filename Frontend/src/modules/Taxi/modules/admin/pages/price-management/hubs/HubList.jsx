import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Edit2, FileSearch, Loader2, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { adminService } from '../../../services/adminService';
import { describeApiError } from '../../../../../shared/utils/apiError';
import {
  ADMIN_BASE_PATH,
  HUB_TYPES,
  chargesSummary,
  extractList,
  hubTypeMeta,
  vehicleTypeLabel,
} from './hubUtils';
import { ConfirmDialog, ErrorBanner, Switch } from './ui';

const TABS = [{ value: '', label: 'All' }, ...HUB_TYPES.map((t) => ({ value: t.value, label: t.plural }))];
const hubId = (hub) => String(hub?._id || hub?.id || '');
const hubStatus = (hub) => String(hub?.status || (hub?.active === false ? 'inactive' : 'active')).toLowerCase();

const HubList = () => {
  const navigate = useNavigate();
  const [hubs, setHubs] = useState([]);
  const [serviceLocations, setServiceLocations] = useState([]);
  const [vehicleNames, setVehicleNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [pendingToggle, setPendingToggle] = useState({});
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [hubsRes, locRes, vtRes] = await Promise.allSettled([
      adminService.getAirports({ limit: 500 }),
      adminService.getServiceLocations(),
      adminService.getVehicleTypes(),
    ]);
    if (hubsRes.status === 'fulfilled') {
      setHubs(extractList(hubsRes.value));
    } else {
      setHubs([]);
      setError(describeApiError(hubsRes.reason, 'Could not load airports and stations.'));
    }
    if (locRes.status === 'fulfilled') setServiceLocations(extractList(locRes.value, ['service_locations', 'results', 'items']));
    if (vtRes.status === 'fulfilled') {
      const names = {};
      extractList(vtRes.value, ['results', 'vehicle_types', 'items']).forEach((vt) => {
        names[String(vt._id || vt.id)] = vehicleTypeLabel(vt);
      });
      setVehicleNames(names);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => setPage(1), [tab, search, statusFilter, locationFilter, perPage]);

  const counts = useMemo(() => {
    const out = { '': hubs.length };
    HUB_TYPES.forEach((t) => {
      out[t.value] = hubs.filter((h) => (h.hub_type || 'airport') === t.value).length;
    });
    return out;
  }, [hubs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return hubs.filter((hub) => {
      if (tab && (hub.hub_type || 'airport') !== tab) return false;
      if (statusFilter && hubStatus(hub) !== statusFilter) return false;
      const locId = String(hub.service_location_id?._id || hub.service_location_id || '');
      if (locationFilter && locId !== locationFilter) return false;
      if (!q) return true;
      return [hub.name, hub.code, hub.terminal, hub.address, hub.service_location_id?.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [hubs, tab, search, statusFilter, locationFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const visible = filtered.slice((page - 1) * perPage, page * perPage);

  const toggleActive = async (hub, next) => {
    const id = hubId(hub);
    const status = next ? 'active' : 'inactive';
    setPendingToggle((p) => ({ ...p, [id]: true }));
    setHubs((prev) => prev.map((h) => (hubId(h) === id ? { ...h, status, active: next } : h)));
    try {
      const res = await adminService.updateAirport(id, { status, active: next });
      const updated = res?.data && typeof res.data === 'object' && !Array.isArray(res.data) ? res.data : null;
      if (updated && hubId(updated) === id) {
        setHubs((prev) => prev.map((h) => (hubId(h) === id ? { ...h, ...updated } : h)));
      }
      toast.success(`${hub.name} is now ${status}.`);
    } catch (err) {
      setHubs((prev) => prev.map((h) => (hubId(h) === id ? { ...h, status: hubStatus(hub), active: hub.active } : h)));
      toast.error(describeApiError(err, 'Could not change the status.'));
    } finally {
      setPendingToggle((p) => ({ ...p, [id]: false }));
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await adminService.deleteAirport(hubId(toDelete));
      setHubs((prev) => prev.filter((h) => hubId(h) !== hubId(toDelete)));
      toast.success(`${toDelete.name} deleted.`);
      setToDelete(null);
    } catch (err) {
      toast.error(describeApiError(err, 'Delete failed.'));
    } finally {
      setDeleting(false);
    }
  };

  const createLabel = tab ? `Add ${hubTypeMeta(tab).label.toLowerCase()}` : 'Add hub';

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="mb-2">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <span>Pricing</span>
          <ChevronRight size={12} />
          <span className="text-gray-700">Airports &amp; Stations</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Airports &amp; Stations</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Pickup/drop fees, parking and surge for rides that start or end at an airport, railway station or bus stand.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate(`${ADMIN_BASE_PATH}/create${tab ? `?type=${tab}` : ''}`)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Plus size={16} /> {createLabel}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.value || 'all'}
            type="button"
            onClick={() => setTab(t.value)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
              tab === t.value
                ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t.label}
            <span
              className={`rounded-full px-1.5 text-[11px] font-semibold ${
                tab === t.value ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {counts[t.value] ?? 0}
            </span>
          </button>
        ))}
      </div>

      <ErrorBanner message={error} onRetry={load} />

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-3 bg-gray-50/30">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, code, terminal, city..."
              className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:border-indigo-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-indigo-500"
            aria-label="Status"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-indigo-500 max-w-[220px]"
            aria-label="Service location"
          >
            <option value="">All service locations</option>
            {serviceLocations.map((sl) => (
              <option key={sl._id || sl.id} value={String(sl._id || sl.id)}>
                {sl.name || sl.service_location_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50"
            aria-label="Reload"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3.5 text-left font-semibold text-gray-700">Hub</th>
                <th className="px-4 py-3.5 text-left font-semibold text-gray-700">Type</th>
                <th className="px-4 py-3.5 text-left font-semibold text-gray-700">Service location</th>
                <th className="px-4 py-3.5 text-left font-semibold text-gray-700">Charges</th>
                <th className="px-4 py-3.5 text-center font-semibold text-gray-700">Active</th>
                <th className="px-6 py-3.5 text-right font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan="6" className="py-20 text-center text-gray-400">
                    <Loader2 className="animate-spin mx-auto mb-2" />
                    <span>Loading hubs...</span>
                  </td>
                </tr>
              ) : visible.length ? (
                visible.map((hub) => {
                  const id = hubId(hub);
                  const meta = hubTypeMeta(hub.hub_type || 'airport');
                  const Icon = meta.icon;
                  const summary = chargesSummary(hub, vehicleNames);
                  const active = hubStatus(hub) === 'active';
                  return (
                    <tr key={id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                            <Icon size={16} />
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900 truncate">
                              {hub.name}
                              {hub.code ? (
                                <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-gray-600">
                                  {hub.code}
                                </span>
                              ) : null}
                            </div>
                            {hub.terminal || hub.address ? (
                              <div className="text-xs text-gray-400 truncate max-w-[260px]">
                                {[hub.terminal, hub.address].filter(Boolean).join(' · ')}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-gray-600 whitespace-nowrap">{meta.label}</td>
                      <td className="px-4 py-4 text-gray-600">
                        {hub.service_location_id?.name || hub.service_location_id?.service_location_name || '—'}
                        {hub.zone_id?.name ? <div className="text-xs text-gray-400">{hub.zone_id.name}</div> : null}
                      </td>
                      <td className="px-4 py-4 max-w-[340px]">
                        <span className={`text-xs ${summary.empty ? 'text-gray-400' : 'text-gray-700 font-medium'}`}>
                          {summary.text}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className="inline-flex">
                          <Switch
                            size="sm"
                            checked={active}
                            disabled={pendingToggle[id]}
                            label={`${hub.name} active`}
                            onChange={(next) => toggleActive(hub, next)}
                          />
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1 text-gray-400">
                          <button
                            type="button"
                            title="Edit"
                            onClick={() => navigate(`${ADMIN_BASE_PATH}/edit/${id}`)}
                            className="p-1.5 rounded hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            type="button"
                            title="Delete"
                            onClick={() => setToDelete(hub)}
                            className="p-1.5 rounded hover:bg-rose-50 hover:text-rose-600 transition-colors"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="6" className="py-24 text-center text-gray-400">
                    <FileSearch size={44} className="mx-auto mb-4 opacity-20" />
                    <h3 className="text-gray-900 font-semibold">
                      {hubs.length ? 'Nothing matches these filters' : error ? 'Could not load hubs' : 'No hubs yet'}
                    </h3>
                    <p className="text-xs mt-1">
                      {hubs.length
                        ? 'Try another tab, search or status.'
                        : 'Add an airport, railway station or bus stand to start charging hub fees.'}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {!loading && filtered.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 text-xs text-gray-500">
            <div className="flex items-center gap-2">
              <span>Show</span>
              <select
                value={perPage}
                onChange={(e) => setPerPage(Number(e.target.value))}
                className="border border-gray-200 rounded px-2 py-1 bg-white outline-none focus:border-indigo-500"
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <span>
                {(page - 1) * perPage + 1}–{Math.min(page * perPage, filtered.length)} of {filtered.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded border border-gray-200 p-1.5 disabled:opacity-40 hover:bg-gray-50"
                aria-label="Previous page"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="px-2">
                Page {page} / {pageCount}
              </span>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border border-gray-200 p-1.5 disabled:opacity-40 hover:bg-gray-50"
                aria-label="Next page"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title={`Delete ${toDelete?.name || 'this hub'}?`}
        message="Rides will stop picking up its pickup, drop and parking charges. This cannot be undone."
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
};

export default HubList;
