import React, { useState } from 'react';
import { Calculator, Loader2 } from 'lucide-react';
import { adminService } from '../../../services/adminService';
import { describeApiError } from '../../../../../shared/utils/apiError';
import { ALL_TYPES_KEY, formatRupees } from './hubUtils';
import { ErrorBanner, Field, Hint, Section, compactInputClass } from './ui';

/** Current IST wall-clock time as a datetime-local value. */
const nowIst = () => {
  const ist = new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${ist.getFullYear()}-${pad(ist.getMonth() + 1)}-${pad(ist.getDate())}T${pad(ist.getHours())}:${pad(ist.getMinutes())}`;
};

const pickResult = (res) => {
  const body = res?.data && typeof res.data === 'object' && !Array.isArray(res.data) ? res.data : res;
  const lines = Array.isArray(body?.lines) ? body.lines : Array.isArray(body?.hubCharges) ? body.hubCharges : [];
  const total = Number.isFinite(Number(body?.total))
    ? Number(body.total)
    : lines.reduce((sum, l) => sum + (Number(l?.amount) || 0), 0);
  return { lines, total };
};

/** Admin calculator: POST /admin/airports/:id/preview with the saved hub. */
const PreviewCalculator = ({ hubId, vehicleTypes, dirty }) => {
  const [vehicleTypeId, setVehicleTypeId] = useState(ALL_TYPES_KEY);
  const [role, setRole] = useState('pickup');
  const [at, setAt] = useState(nowIst);
  const [waiting, setWaiting] = useState('20');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const run = async () => {
    if (!hubId) return;
    setLoading(true);
    setError('');
    try {
      const body = {
        vehicle_type_id: vehicleTypeId === ALL_TYPES_KEY ? null : vehicleTypeId,
        role,
        // The input is IST wall-clock time; send it as an absolute instant.
        at: at ? new Date(`${at}:00+05:30`).toISOString() : undefined,
        waiting_minutes: role === 'pickup' && waiting !== '' ? Math.max(0, Number(waiting) || 0) : undefined,
      };
      const res = await adminService.previewAirportCharges(hubId, body);
      setResult(pickResult(res));
    } catch (err) {
      setResult(null);
      setError(describeApiError(err, 'Preview failed.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section icon={Calculator} title="Preview calculator" description="What a ride at this hub would be charged">
      {!hubId ? (
        <Hint>Save the hub first, then come back here to preview its charges.</Hint>
      ) : (
        <div className="space-y-4">
          {dirty ? <Hint tone="warn">You have unsaved changes. The preview uses the saved charges; save to include them.</Hint> : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vehicle type" className="col-span-2">
              <select value={vehicleTypeId} onChange={(e) => setVehicleTypeId(e.target.value)} className={compactInputClass}>
                <option value={ALL_TYPES_KEY}>Any (all types amount)</option>
                {vehicleTypes.map((vt) => (
                  <option key={vt.id} value={vt.id}>
                    {vt.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Hub is the">
              <div className="flex rounded-lg border border-gray-200 p-0.5">
                {['pickup', 'drop'].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold capitalize ${
                      role === r ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Waiting (min)" hint={role === 'drop' ? 'Parking applies to pickups only' : ''}>
              <input
                type="number"
                min="0"
                step="1"
                disabled={role === 'drop'}
                value={waiting}
                onChange={(e) => setWaiting(e.target.value)}
                className={compactInputClass}
              />
            </Field>
            <Field label="Date & time (IST)" className="col-span-2">
              <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={compactInputClass} />
            </Field>
          </div>
          <button
            type="button"
            onClick={run}
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Calculator size={15} />}
            Calculate
          </button>

          <ErrorBanner message={error} />

          {result ? (
            <div className="rounded-lg border border-gray-100">
              {result.lines.length === 0 ? (
                <p className="px-4 py-3 text-xs text-gray-400">No hub charges apply for this case.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {result.lines.map((line, i) => (
                    <li key={`${line.code}-${i}`} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                      <div>
                        <div className="text-gray-800">{line.label || line.code}</div>
                        <div className="text-[11px] text-gray-400">
                          {line.passThrough ? 'Driver keeps 100%' : 'Surge (commissionable)'}
                          {line.estimated ? ' · estimated' : ''}
                        </div>
                      </div>
                      <span className="font-medium text-gray-900 whitespace-nowrap">{formatRupees(line.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-semibold">
                <span>Total</span>
                <span>{formatRupees(result.total)}</span>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Section>
  );
};

export default PreviewCalculator;
