import React from 'react';
import { Plane, TrainFront, Bus, MapPin } from 'lucide-react';

/*
 * Transit hub charges (airports, railway stations, bus stands).
 *
 * Contract: docs/taxi-transit-hubs-contract.md. Quote and ride payloads may
 * carry `hubCharges` (fee/parking/surge lines) and `hubs` ({ pickup, drop }).
 * Both are optional: every helper here returns an empty list / null when they
 * are missing, and every component renders nothing, so screens look exactly
 * as before when the backend does not send them.
 */

const HUB_TYPE_LABELS = {
  airport: 'Airport',
  railway_station: 'Station',
  bus_stand: 'Bus stand',
};

export const hubTypeLabel = (type) => HUB_TYPE_LABELS[String(type || '').toLowerCase()] || 'Hub';

export const HubTypeIcon = ({ type, size = 12, className = '', strokeWidth = 2.4 }) => {
  const kind = String(type || '').toLowerCase();
  const Icon = kind === 'airport'
    ? Plane
    : kind === 'railway_station'
      ? TrainFront
      : kind === 'bus_stand'
        ? Bus
        : MapPin;
  return <Icon size={size} className={className} strokeWidth={strokeWidth} aria-hidden="true" />;
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Pull the hub charge lines out of a quote, ride or fare object. */
export const getHubCharges = (source) => {
  if (!source || typeof source !== 'object') return [];
  const raw = source.hubCharges
    ?? source.hub_charges
    ?? source.fare?.hubCharges
    ?? source.fareBreakdown?.hubCharges
    ?? source.fare_breakdown?.hubCharges
    ?? source.breakdown?.hubCharges
    ?? source.ride?.hubCharges
    ?? null;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((line) => line && typeof line === 'object' && toNumber(line.amount) > 0)
    .map((line) => ({
      ...line,
      amount: toNumber(line.amount),
      passThrough: line.passThrough !== false && line.code !== 'hub_surge',
      estimated: Boolean(line.estimated),
    }));
};

/** `{ pickup, drop }` hub refs, or nulls. */
export const getHubs = (source) => {
  const hubs = source?.hubs ?? source?.fare?.hubs ?? source?.ride?.hubs ?? null;
  return {
    pickup: hubs?.pickup && typeof hubs.pickup === 'object' ? hubs.pickup : null,
    drop: hubs?.drop && typeof hubs.drop === 'object' ? hubs.drop : null,
  };
};

export const sumHubCharges = (lines = []) => lines.reduce((sum, line) => sum + toNumber(line?.amount), 0);

export const sumPassThrough = (lines = []) => lines
  .filter((line) => line?.passThrough)
  .reduce((sum, line) => sum + toNumber(line.amount), 0);

/** Fee amount (pickup or drop fee line) for one hub role. */
export const hubFeeFor = (lines = [], role) => {
  const code = role === 'drop' ? 'hub_drop_fee' : 'hub_pickup_fee';
  return lines.filter((line) => line.code === code).reduce((sum, line) => sum + line.amount, 0);
};

const defaultFormat = (amount) => `₹${Math.round(toNumber(amount))}`;

export const hubLineLabel = (line) => {
  const label = String(line?.label || '').trim();
  if (label) return label;
  const name = line?.hubName || hubTypeLabel(line?.hubType);
  switch (line?.code) {
    case 'hub_pickup_fee': return `${name} pickup fee`;
    case 'hub_drop_fee': return `${name} drop fee`;
    case 'hub_parking': return `${name} parking`;
    case 'hub_surge': return `${name} surge`;
    default: return `${name} charge`;
  }
};

/**
 * One row per hub charge line. Styling comes from the caller so each screen
 * keeps its own look; `formatAmount` matches the screen's other fare lines.
 */
export const HubChargeLines = ({
  lines,
  formatAmount = defaultFormat,
  rowClassName = 'flex items-center justify-between gap-3 text-[12px] font-medium text-slate-600',
  amountClassName = 'shrink-0 text-slate-900',
  noteClassName = 'block text-[10px] font-medium text-slate-400',
  iconClassName = 'shrink-0 text-slate-400',
  showIcon = true,
  rowStyle,
  amountStyle,
  noteStyle,
}) => {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  return (
    <>
      {lines.map((line, index) => (
        <div key={`${line.code || 'hub'}-${line.hubId || ''}-${index}`} className={rowClassName} style={rowStyle}>
          <span className="flex min-w-0 items-start gap-1.5">
            {showIcon && <HubTypeIcon type={line.hubType} size={13} className={`mt-[2px] ${iconClassName}`} />}
            <span className="min-w-0">
              <span className="block">{hubLineLabel(line)}</span>
              {line.estimated && (
                <span className={noteClassName} style={noteStyle}>Estimated, based on waiting</span>
              )}
            </span>
          </span>
          <span className={amountClassName} style={amountStyle}>{formatAmount(line.amount)}</span>
        </div>
      ))}
    </>
  );
};

/**
 * Small pill for a pickup or drop field: "Airport pickup: fee ₹X applies"
 * (rider) or "Airport pickup – collect ₹X fee" (driver).
 */
export const HubBadge = ({
  hub,
  role = 'pickup',
  fee = 0,
  audience = 'rider',
  formatAmount = defaultFormat,
  className = '',
}) => {
  if (!hub) return null;
  const type = hub.type || hub.hub_type || hub.hubType;
  const kind = hubTypeLabel(type);
  const action = role === 'drop' ? 'drop' : 'pickup';
  const amount = toNumber(fee);
  let text;
  if (audience === 'driver') {
    text = amount > 0 ? `${kind} ${action} – collect ${formatAmount(amount)} fee` : `${kind} ${action}`;
  } else {
    text = amount > 0 ? `${kind} ${action}: fee ${formatAmount(amount)} applies` : `${kind} ${action}`;
  }
  const tone = String(type || '').toLowerCase() === 'airport'
    ? 'border-sky-100 bg-sky-50 text-sky-700'
    : 'border-indigo-100 bg-indigo-50 text-indigo-700';
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-tight ${tone} ${className}`}
      title={hub.name || undefined}
    >
      <HubTypeIcon type={type} size={11} className="shrink-0" />
      <span className="truncate">{text}</span>
    </span>
  );
};

/** Pickup and drop badges together, built straight from a quote/ride object. */
export const HubBadges = ({ source, audience = 'rider', formatAmount, className = '' }) => {
  const { pickup, drop } = getHubs(source);
  if (!pickup && !drop) return null;
  const lines = getHubCharges(source);
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {pickup && (
        <HubBadge hub={pickup} role="pickup" fee={hubFeeFor(lines, 'pickup')} audience={audience} formatAmount={formatAmount} />
      )}
      {drop && (
        <HubBadge hub={drop} role="drop" fee={hubFeeFor(lines, 'drop')} audience={audience} formatAmount={formatAmount} />
      )}
    </div>
  );
};
