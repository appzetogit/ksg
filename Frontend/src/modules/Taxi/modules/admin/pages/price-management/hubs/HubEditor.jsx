import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, ChevronRight, Hash, Loader2, MapPin, Phone, Save, Tag, Trash2 } from 'lucide-react';
import { adminService } from '../../../services/adminService';
import { describeApiError } from '../../../../../shared/utils/apiError';
import { DELHI_CENTER } from '../../../utils/googleMaps';
import {
  ADMIN_BASE_PATH,
  DEFAULT_RADIUS_METERS,
  HUB_TYPES,
  emptyForm,
  extractList,
  formToPayload,
  hubToForm,
  hubTypeMeta,
  validateForm,
  vehicleTypeLabel,
} from './hubUtils';
import ChargesEditor from './ChargesEditor';
import HubMap from './HubMap';
import PreviewCalculator from './PreviewCalculator';
import { ConfirmDialog, ErrorBanner, Field, Hint, Section, Switch, errorInputClass, inputClass } from './ui';

const idOf = (v) => String(v?._id || v?.id || '');
const snapshot = (form) => JSON.stringify(formToPayload(form));

const HubEditor = ({ hubId }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEdit = Boolean(hubId);
  const initialType = HUB_TYPES.some((t) => t.value === searchParams.get('type')) ? searchParams.get('type') : 'airport';

  const [form, setForm] = useState(() => emptyForm({ hub_type: initialType }));
  const [saved, setSaved] = useState(() => snapshot(emptyForm({ hub_type: initialType })));
  const [serviceLocations, setServiceLocations] = useState([]);
  const [zones, setZones] = useState([]);
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [vehicleTypesError, setVehicleTypesError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const [locRes, zoneRes, vtRes, hubsRes] = await Promise.allSettled([
      adminService.getServiceLocations(),
      adminService.getZones(),
      adminService.getVehicleTypes(),
      isEdit ? adminService.getAirports({ limit: 500 }) : Promise.resolve(null),
    ]);
    if (locRes.status === 'fulfilled') setServiceLocations(extractList(locRes.value, ['service_locations', 'results', 'items']));
    if (zoneRes.status === 'fulfilled') setZones(extractList(zoneRes.value, ['results', 'zones', 'items']));
    if (vtRes.status === 'fulfilled') {
      setVehicleTypes(
        extractList(vtRes.value, ['results', 'vehicle_types', 'items'])
          .filter((vt) => idOf(vt) && vt.active !== false && vt.status !== 'inactive')
          .map((vt) => ({ id: idOf(vt), label: vehicleTypeLabel(vt) })),
      );
      setVehicleTypesError('');
    } else {
      setVehicleTypesError(`Vehicle types did not load: ${describeApiError(vtRes.reason)}`);
    }
    if (isEdit) {
      if (hubsRes.status === 'rejected') {
        setLoadError(describeApiError(hubsRes.reason, 'Could not load this hub.'));
      } else {
        const hub = extractList(hubsRes.value).find((h) => idOf(h) === String(hubId));
        if (hub) {
          const next = hubToForm(hub);
          setForm(next);
          setSaved(snapshot(next));
        } else {
          setLoadError('This hub was not found. It may have been deleted.');
        }
      }
    }
    setLoading(false);
  }, [hubId, isEdit]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(() => snapshot(form) !== saved, [form, saved]);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const clearError = (...keys) =>
    setErrors((e) => {
      if (!keys.some((k) => e[k])) return e;
      const next = { ...e };
      keys.forEach((k) => delete next[k]);
      return next;
    });

  const selectedLocation = serviceLocations.find((l) => idOf(l) === form.service_location_id);
  const locationCenter = useMemo(() => {
    const lat = Number(selectedLocation?.latitude ?? selectedLocation?.lat);
    const lng = Number(selectedLocation?.longitude ?? selectedLocation?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) ? { lat, lng } : DELHI_CENTER;
  }, [selectedLocation]);
  const pin = useMemo(() => {
    if (form.latitude === '' || form.longitude === '') return null;
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }, [form.latitude, form.longitude]);
  const locationZones = zones.filter((z) => !form.service_location_id || String(z.service_location_id?._id || z.service_location_id || '') === form.service_location_id);

  const onPinChange = (lat, lng) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    set({ latitude: lat.toFixed(6), longitude: lng.toFixed(6) });
    clearError('pin');
  };

  const handleSave = async () => {
    const nextErrors = validateForm(form);
    setErrors(nextErrors);
    setSaveError('');
    if (Object.keys(nextErrors).length) {
      toast.error(`Fix ${Object.keys(nextErrors).length} field${Object.keys(nextErrors).length > 1 ? 's' : ''} before saving.`);
      return;
    }
    setSaving(true);
    try {
      const payload = formToPayload(form);
      const res = isEdit ? await adminService.updateAirport(hubId, payload) : await adminService.createAirport(payload);
      const body = res?.data && typeof res.data === 'object' && !Array.isArray(res.data) ? res.data : res;
      const savedHub = body?.airport || body?.hub || body;
      if (isEdit) {
        if (savedHub && idOf(savedHub) && savedHub.name) {
          const next = hubToForm(savedHub);
          // Keep what the admin typed when the server does not echo charges back yet.
          const merged = savedHub.charges ? next : { ...next, charges: form.charges, hub_type: form.hub_type, radius_meters: form.radius_meters };
          setForm(merged);
          setSaved(snapshot(merged));
        } else {
          setSaved(snapshot(form));
        }
        toast.success(`${form.name.trim()} saved.`);
      } else {
        setSaved(snapshot(form));
        toast.success(`${form.name.trim()} created.`);
        const newId = idOf(savedHub);
        navigate(newId ? `${ADMIN_BASE_PATH}/edit/${newId}` : ADMIN_BASE_PATH, { replace: true });
      }
    } catch (err) {
      const msg = describeApiError(err, 'Could not save the hub.');
      setSaveError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await adminService.deleteAirport(hubId);
      toast.success(`${form.name || 'Hub'} deleted.`);
      setSaved(snapshot(form));
      navigate(ADMIN_BASE_PATH);
    } catch (err) {
      toast.error(describeApiError(err, 'Delete failed.'));
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const goBack = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    navigate(ADMIN_BASE_PATH);
  };

  const typeMeta = hubTypeMeta(form.hub_type);
  const TypeIcon = typeMeta.icon;
  const errorCount = Object.keys(errors).length;
  const ic = (key) => `${inputClass}${errors[key] ? errorInputClass : ''}`;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-gray-400">
        <Loader2 className="animate-spin mr-2" /> Loading...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <ErrorBanner message={loadError} onRetry={load} />
        <button type="button" onClick={() => navigate(ADMIN_BASE_PATH)} className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
          <ArrowLeft size={16} /> Back to list
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <span>Pricing</span>
          <ChevronRight size={12} />
          <span>Airports &amp; Stations</span>
          <ChevronRight size={12} />
          <span className="text-gray-700">{isEdit ? 'Edit' : 'Create'}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <TypeIcon size={20} className="text-indigo-600" />
            {isEdit ? form.name || `Edit ${typeMeta.label.toLowerCase()}` : `Add ${typeMeta.label.toLowerCase()}`}
            {dirty ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Unsaved</span> : null}
          </h1>
          <button type="button" onClick={goBack} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <ArrowLeft size={16} /> Back
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-8 space-y-6 min-w-0">
          <Section icon={TypeIcon} title="Hub details" description="What riders and drivers see">
            <div className="space-y-5">
              <Field label="Type">
                <div className="grid grid-cols-3 gap-2">
                  {HUB_TYPES.map((t) => {
                    const Icon = t.icon;
                    const on = form.hub_type === t.value;
                    return (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => set({ hub_type: t.value })}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                          on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <Icon size={15} /> {t.label}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Name" icon={Tag} required error={errors.name} className="md:col-span-2">
                  <input
                    value={form.name}
                    onChange={(e) => {
                      set({ name: e.target.value });
                      clearError('name');
                    }}
                    placeholder={form.hub_type === 'airport' ? 'Raja Bhoj Airport' : form.hub_type === 'railway_station' ? 'Bhopal Junction' : 'ISBT Bhopal'}
                    className={ic('name')}
                  />
                </Field>
                <Field label="Code" icon={Hash} error={errors.code} hint={form.hub_type === 'airport' ? 'IATA, e.g. BHO' : form.hub_type === 'railway_station' ? 'Station code, e.g. BPL' : 'Optional'}>
                  <input value={form.code} maxLength={10} onChange={(e) => { set({ code: e.target.value.toUpperCase() }); clearError('code'); }} placeholder="BHO" className={ic('code')} />
                </Field>
                <Field label="Terminal / platform">
                  <input value={form.terminal} onChange={(e) => set({ terminal: e.target.value })} placeholder={form.hub_type === 'airport' ? 'T1' : 'Platform 1 exit'} className={inputClass} />
                </Field>
                <Field label="Contact number" icon={Phone} error={errors.contact_number}>
                  <input value={form.contact_number} onChange={(e) => { set({ contact_number: e.target.value }); clearError('contact_number'); }} placeholder="+91 ..." className={ic('contact_number')} />
                </Field>
                <Field label="Active">
                  <div className="flex h-[42px] items-center gap-3">
                    <Switch checked={form.active} onChange={(v) => set({ active: v })} label="Active" />
                    <span className="text-sm text-gray-600">{form.active ? 'Active: charges apply' : 'Inactive: ignored'}</span>
                  </div>
                </Field>
                <Field label="Address" className="md:col-span-3">
                  <input value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="Street, area, city" className={inputClass} />
                </Field>
                <Field label="Service location" icon={MapPin} required error={errors.service_location_id}>
                  <select
                    value={form.service_location_id}
                    onChange={(e) => {
                      const sid = e.target.value;
                      const zoneStillValid = zones.some((z) => idOf(z) === form.zone_id && String(z.service_location_id?._id || z.service_location_id || '') === sid);
                      set({ service_location_id: sid, zone_id: zoneStillValid ? form.zone_id : '' });
                      clearError('service_location_id');
                    }}
                    className={ic('service_location_id')}
                  >
                    <option value="">Select service location</option>
                    {serviceLocations.map((sl) => (
                      <option key={idOf(sl)} value={idOf(sl)}>
                        {sl.name || sl.service_location_name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Zone" hint="Optional" className="md:col-span-2">
                  <select value={form.zone_id} onChange={(e) => set({ zone_id: e.target.value })} className={inputClass} disabled={!form.service_location_id}>
                    <option value="">{form.service_location_id ? 'No specific zone' : 'Pick a service location first'}</option>
                    {locationZones.map((z) => (
                      <option key={idOf(z)} value={idOf(z)}>
                        {z.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          </Section>

          <Section icon={MapPin} title="Location & boundary" description="A ride uses this hub when its pickup or drop point is inside the boundary">
            <div className="space-y-4">
              <div className="h-[480px] rounded-lg border border-gray-100 p-1">
                <HubMap
                  pin={pin}
                  fallbackCenter={locationCenter}
                  boundary={form.boundary}
                  radius={Number(form.radius_meters) || DEFAULT_RADIUS_METERS}
                  onPinChange={onPinChange}
                  onBoundaryChange={(boundary) => {
                    set({ boundary });
                    clearError('boundary', 'radius_meters');
                  }}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Latitude" required error={errors.pin}>
                  <input type="number" step="any" value={form.latitude} onChange={(e) => { set({ latitude: e.target.value }); clearError('pin'); }} className={ic('pin')} placeholder="23.2875" />
                </Field>
                <Field label="Longitude" required>
                  <input type="number" step="any" value={form.longitude} onChange={(e) => { set({ longitude: e.target.value }); clearError('pin'); }} className={ic('pin')} placeholder="77.3374" />
                </Field>
                <Field
                  label="Radius fallback (m)"
                  error={errors.radius_meters}
                  hint={form.boundary.length >= 3 ? 'Not used while a boundary is drawn' : 'Used because no boundary is drawn'}
                >
                  <input type="number" min="50" step="50" value={form.radius_meters} onChange={(e) => { set({ radius_meters: e.target.value }); clearError('radius_meters'); }} className={ic('radius_meters')} />
                </Field>
              </div>
              {errors.boundary ? <p className="text-xs text-rose-600">{errors.boundary}</p> : null}
              <Hint>
                {form.boundary.length >= 3
                  ? `Boundary drawn with ${form.boundary.length} corners. Cover the terminal kerb, pickup lanes and parking, not the whole neighbourhood.`
                  : 'No boundary drawn: rides within the radius of the pin count as this hub. Draw the boundary, or use the "around pin" helper and adjust its corners.'}
              </Hint>
            </div>
          </Section>

          <ChargesEditor
            charges={form.charges}
            onChange={(charges) => set({ charges })}
            vehicleTypes={vehicleTypes}
            vehicleTypesError={vehicleTypesError}
            errors={errors}
          />
        </div>

        <div className="xl:col-span-4 space-y-6 xl:sticky xl:top-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3 shadow-sm">
            {errorCount ? (
              <p className="text-xs font-medium text-rose-600">
                {errorCount} field{errorCount > 1 ? 's need' : ' needs'} attention (highlighted in red).
              </p>
            ) : null}
            <ErrorBanner message={saveError} onClose={() => setSaveError('')} />
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="w-full py-3 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {isEdit ? 'Save changes' : `Create ${typeMeta.label.toLowerCase()}`}
            </button>
            <button type="button" onClick={goBack} className="w-full py-3 bg-gray-50 text-gray-600 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors">
              {dirty ? 'Cancel' : 'Back to list'}
            </button>
            {isEdit ? (
              <button type="button" onClick={() => setConfirmDelete(true)} className="w-full py-2 inline-flex items-center justify-center gap-2 text-sm font-medium text-rose-600 hover:bg-rose-50 rounded-lg">
                <Trash2 size={14} /> Delete
              </button>
            ) : null}
          </div>

          <PreviewCalculator hubId={isEdit ? hubId : null} vehicleTypes={vehicleTypes} dirty={dirty} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${form.name || 'this hub'}?`}
        message="Rides will stop picking up its pickup, drop and parking charges. This cannot be undone."
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
};

export default HubEditor;
