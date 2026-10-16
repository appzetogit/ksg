import React from 'react';
import { CalendarDays, Clock, IndianRupee, Moon, ParkingCircle, Plus, Trash2, TrendingUp } from 'lucide-react';
import { ALL_TYPES_KEY, DAYS, crossesMidnight, formatRupees, newRowKey } from './hubUtils';
import { Field, Hint, Section, Switch, compactInputClass, errorInputClass } from './ui';

const num = (props) => ({ type: 'number', inputMode: 'decimal', step: 'any', min: '0', ...props });
const cls = (err) => `${compactInputClass}${err ? errorInputClass : ''}`;

const FeeTable = ({ charges, setCharges, vehicleTypes, errors, disabled }) => {
  const rows = [{ id: ALL_TYPES_KEY, label: 'All vehicle types', hint: 'Default when a type has no own amount' }, ...vehicleTypes];
  const setFee = (kind, key, value) =>
    setCharges({ ...charges, [kind]: { ...charges[kind], [key]: value } });

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-100">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-xs text-gray-500">
            <th className="px-4 py-2.5 text-left font-semibold">Vehicle type</th>
            <th className="px-3 py-2.5 text-left font-semibold w-40">Pickup fee (₹)</th>
            <th className="px-3 py-2.5 text-left font-semibold w-40">Drop fee (₹)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.id} className={row.id === ALL_TYPES_KEY ? 'bg-indigo-50/30' : ''}>
              <td className="px-4 py-2">
                <div className={`text-sm ${row.id === ALL_TYPES_KEY ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{row.label}</div>
                {row.hint ? <div className="text-[11px] text-gray-400">{row.hint}</div> : null}
              </td>
              {['pickup_fee', 'drop_fee'].map((kind) => {
                const err = errors[`${kind}.${row.id}`];
                return (
                  <td key={kind} className="px-3 py-2 align-top">
                    <input
                      {...num()}
                      disabled={disabled}
                      value={charges[kind][row.id] ?? ''}
                      placeholder={row.id === ALL_TYPES_KEY ? '0' : 'Use default'}
                      onChange={(e) => setFee(kind, row.id, e.target.value)}
                      className={cls(err)}
                      aria-label={`${row.label} ${kind === 'pickup_fee' ? 'pickup' : 'drop'} fee`}
                    />
                    {err ? <p className="mt-0.5 text-[11px] text-rose-600">{err}</p> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const DayChips = ({ days, onChange, disabled }) => (
  <div className="flex flex-wrap gap-1">
    {DAYS.map((d, i) => {
      const on = days.includes(i);
      return (
        <button
          key={d}
          type="button"
          disabled={disabled}
          onClick={() => onChange(on ? days.filter((x) => x !== i) : [...days, i])}
          className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
            on ? 'border-indigo-200 bg-indigo-600 text-white' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
          }`}
        >
          {d}
        </button>
      );
    })}
    <span className="self-center pl-1 text-[11px] text-gray-400">{days.length === 0 ? 'Every day' : ''}</span>
  </div>
);

const ChargesEditor = ({ charges, onChange, vehicleTypes, vehicleTypesError, errors }) => {
  const disabled = !charges.enabled;
  const setCharges = onChange;
  const setParking = (patch) => setCharges({ ...charges, parking: { ...charges.parking, ...patch } });
  const setSurge = (patch) => setCharges({ ...charges, surge: { ...charges.surge, ...patch } });
  const updateRow = (listKey, idx, patch) =>
    setCharges({ ...charges, [listKey]: charges[listKey].map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
  const removeRow = (listKey, idx) => setCharges({ ...charges, [listKey]: charges[listKey].filter((_, i) => i !== idx) });

  const p = charges.parking;
  const parkingExample = (() => {
    const free = Number(p.free_minutes) || 0;
    const block = Number(p.block_minutes) || 0;
    const amount = Number(p.block_amount) || 0;
    if (!block || !amount) return '';
    const waited = free + block * 2 + 1;
    const blocks = Math.ceil(Math.max(0, waited - free) / block);
    let total = blocks * amount;
    const cap = p.max_amount === '' ? null : Number(p.max_amount);
    if (cap !== null && Number.isFinite(cap)) total = Math.min(total, cap);
    return `Example: waiting ${waited} min → ${blocks} block${blocks > 1 ? 's' : ''} → ${formatRupees(total)}${
      cap !== null && Number.isFinite(cap) && blocks * amount > cap ? ' (capped)' : ''
    }.`;
  })();

  return (
    <div className="space-y-6">
      <Section
        icon={IndianRupee}
        title="Hub charges"
        description="Added to the fare when the pickup or drop point is inside this hub"
        actions={
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-600">
            {charges.enabled ? 'Enabled' : 'Disabled'}
            <Switch checked={charges.enabled} onChange={(v) => setCharges({ ...charges, enabled: v })} label="Enable hub charges" />
          </div>
        }
      >
        <div className="space-y-4">
          <Hint>
            Pickup fee, drop fee and parking go to the driver in full: no commission, no tax, no platform fee (the driver
            pays the gate / parking). Hub surge is treated like ordinary zone surge.
          </Hint>
          {!charges.enabled ? (
            <p className="text-xs text-gray-400">Turn charges on to edit amounts. Saved amounts are kept while disabled.</p>
          ) : null}
          {vehicleTypesError ? <Hint tone="warn">{vehicleTypesError} Only the "All vehicle types" row is available.</Hint> : null}
          <FeeTable charges={charges} setCharges={setCharges} vehicleTypes={vehicleTypes} errors={errors} disabled={disabled} />
          <p className="text-[11px] text-gray-400">
            A vehicle type without its own amount uses the "All vehicle types" amount; leave both blank for no fee.
          </p>
        </div>
      </Section>

      <Section
        icon={ParkingCircle}
        title="Parking / waiting at pickup"
        description="Billed from real waiting time (driver arrival to trip start), only for pickups at this hub"
        actions={
          <Switch checked={p.enabled} disabled={disabled} onChange={(v) => setParking({ enabled: v })} label="Enable parking" />
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Free minutes" error={errors['parking.free_minutes']}>
            <input {...num({ step: '1' })} disabled={disabled || !p.enabled} value={p.free_minutes} onChange={(e) => setParking({ free_minutes: e.target.value })} className={cls(errors['parking.free_minutes'])} />
          </Field>
          <Field label="Block (minutes)" error={errors['parking.block_minutes']}>
            <input {...num({ step: '1', min: '1' })} disabled={disabled || !p.enabled} value={p.block_minutes} onChange={(e) => setParking({ block_minutes: e.target.value })} className={cls(errors['parking.block_minutes'])} />
          </Field>
          <Field label="₹ per block" error={errors['parking.block_amount']}>
            <input {...num()} disabled={disabled || !p.enabled} value={p.block_amount} onChange={(e) => setParking({ block_amount: e.target.value })} className={cls(errors['parking.block_amount'])} />
          </Field>
          <Field label="Cap per ride (₹)" error={errors['parking.max_amount']} hint="Blank = no cap">
            <input {...num()} disabled={disabled || !p.enabled} value={p.max_amount} placeholder="No cap" onChange={(e) => setParking({ max_amount: e.target.value })} className={cls(errors['parking.max_amount'])} />
          </Field>
        </div>
        {p.enabled && parkingExample ? <p className="mt-3 text-[11px] text-gray-500">{parkingExample} Shown to riders as "estimated" until the trip ends.</p> : null}
      </Section>

      <Section
        icon={Clock}
        title="Time windows"
        description="IST. First matching window wins; applies to pickup/drop fees and parking"
        actions={
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              setCharges({
                ...charges,
                time_windows: [
                  ...charges.time_windows,
                  { key: newRowKey(), name: charges.time_windows.length ? '' : 'Night', days: [], start: '22:00', end: '06:00', multiplier: '1.5', extra_flat: '0' },
                ],
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
          >
            <Plus size={13} /> Add window
          </button>
        }
      >
        {charges.time_windows.length === 0 ? (
          <p className="text-xs text-gray-400">No windows: amounts apply as entered at every hour. Add one for e.g. night or peak flights.</p>
        ) : (
          <div className="space-y-3">
            {charges.time_windows.map((w, i) => {
              const e = (f) => errors[`tw.${i}.${f}`];
              return (
                <div key={w.key} className="rounded-lg border border-gray-100 bg-gray-50/40 p-3">
                  <div className="grid grid-cols-2 md:grid-cols-12 gap-3 items-start">
                    <Field label={`#${i + 1} Name`} error={e('name')} className="col-span-2 md:col-span-3">
                      <input disabled={disabled} value={w.name} placeholder="Night" onChange={(ev) => updateRow('time_windows', i, { name: ev.target.value })} className={cls(e('name'))} />
                    </Field>
                    <Field label="Start" error={e('start')} className="md:col-span-2">
                      <input type="time" disabled={disabled} value={w.start} onChange={(ev) => updateRow('time_windows', i, { start: ev.target.value })} className={cls(e('start'))} />
                    </Field>
                    <Field label="End" error={e('end')} className="md:col-span-2">
                      <input type="time" disabled={disabled} value={w.end} onChange={(ev) => updateRow('time_windows', i, { end: ev.target.value })} className={cls(e('end'))} />
                    </Field>
                    <Field label="Multiplier ×" error={e('multiplier')} className="md:col-span-2">
                      <input {...num({ step: '0.05' })} disabled={disabled} value={w.multiplier} onChange={(ev) => updateRow('time_windows', i, { multiplier: ev.target.value })} className={cls(e('multiplier'))} />
                    </Field>
                    <Field label="Extra ₹" error={e('extra_flat')} className="md:col-span-2">
                      <input {...num()} disabled={disabled} value={w.extra_flat} onChange={(ev) => updateRow('time_windows', i, { extra_flat: ev.target.value })} className={cls(e('extra_flat'))} />
                    </Field>
                    <div className="col-span-2 md:col-span-1 flex md:justify-end md:pt-6">
                      <button type="button" disabled={disabled} onClick={() => removeRow('time_windows', i)} className="rounded p-2 text-gray-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50" aria-label="Remove window">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <DayChips days={w.days} disabled={disabled} onChange={(days) => updateRow('time_windows', i, { days })} />
                    {crossesMidnight(w.start, w.end) ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-white">
                        <Moon size={10} /> Crosses midnight ({w.start} → {w.end} next day)
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
            <p className="text-[11px] text-gray-400">
              Amount = round(amount × multiplier + extra ₹). Days refer to the day the window starts; a window like 22:00–06:00
              crosses midnight.
            </p>
          </div>
        )}
      </Section>

      <Section
        icon={CalendarDays}
        title="Special dates"
        description="Festivals, events. A special date beats any time window"
        actions={
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              setCharges({
                ...charges,
                special_dates: [...charges.special_dates, { key: newRowKey(), date: '', label: '', multiplier: '1.5', extra_flat: '0' }],
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
          >
            <Plus size={13} /> Add date
          </button>
        }
      >
        {charges.special_dates.length === 0 ? (
          <p className="text-xs text-gray-400">No special dates.</p>
        ) : (
          <div className="space-y-3">
            {charges.special_dates.map((d, i) => {
              const e = (f) => errors[`sd.${i}.${f}`];
              return (
                <div key={d.key} className="grid grid-cols-2 md:grid-cols-12 gap-3 items-start rounded-lg border border-gray-100 bg-gray-50/40 p-3">
                  <Field label="Date" error={e('date')} className="md:col-span-3">
                    <input type="date" disabled={disabled} value={d.date} onChange={(ev) => updateRow('special_dates', i, { date: ev.target.value })} className={cls(e('date'))} />
                  </Field>
                  <Field label="Label" className="md:col-span-4">
                    <input disabled={disabled} value={d.label} placeholder="Diwali" onChange={(ev) => updateRow('special_dates', i, { label: ev.target.value })} className={compactInputClass} />
                  </Field>
                  <Field label="Multiplier ×" error={e('multiplier')} className="md:col-span-2">
                    <input {...num({ step: '0.05' })} disabled={disabled} value={d.multiplier} onChange={(ev) => updateRow('special_dates', i, { multiplier: ev.target.value })} className={cls(e('multiplier'))} />
                  </Field>
                  <Field label="Extra ₹" error={e('extra_flat')} className="md:col-span-2">
                    <input {...num()} disabled={disabled} value={d.extra_flat} onChange={(ev) => updateRow('special_dates', i, { extra_flat: ev.target.value })} className={cls(e('extra_flat'))} />
                  </Field>
                  <div className="flex md:justify-end md:pt-6 md:col-span-1">
                    <button type="button" disabled={disabled} onClick={() => removeRow('special_dates', i)} className="rounded p-2 text-gray-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50" aria-label="Remove date">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section icon={TrendingUp} title="Hub surge" description="Added to the ride surge when this hub applies (commissionable, like zone surge)">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Surge %" error={errors['surge.percent']} hint="Percent of the ride fare">
            <input {...num()} disabled={disabled} value={charges.surge.percent} placeholder="0" onChange={(e) => setSurge({ percent: e.target.value })} className={cls(errors['surge.percent'])} />
          </Field>
          <Field label="Flat surge (₹)" error={errors['surge.flat']}>
            <input {...num()} disabled={disabled} value={charges.surge.flat} placeholder="0" onChange={(e) => setSurge({ flat: e.target.value })} className={cls(errors['surge.flat'])} />
          </Field>
        </div>
      </Section>
    </div>
  );
};

export default ChargesEditor;
