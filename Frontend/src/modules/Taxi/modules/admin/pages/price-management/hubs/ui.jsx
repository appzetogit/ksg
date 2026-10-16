import React from 'react';
import { AlertTriangle, Info, Loader2, X } from 'lucide-react';

// Same tokens as the rest of the taxi admin (see modules/admin/design-system.md).
export const inputClass =
  'w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors disabled:bg-gray-50 disabled:text-gray-400';
export const compactInputClass =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors disabled:bg-gray-50 disabled:text-gray-400';
export const labelClass = 'block text-xs font-semibold text-gray-500 mb-1.5';
export const errorInputClass = ' !border-rose-300 focus:!border-rose-500 focus:!ring-rose-500';

export const Section = ({ icon: Icon, title, description, actions, children, className = '' }) => (
  <div className={`bg-white rounded-xl border border-gray-200 p-6 shadow-sm ${className}`}>
    <div className="flex flex-wrap items-center gap-3 mb-5 pb-4 border-b border-gray-100">
      {Icon ? (
        <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
          <Icon size={18} />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {description ? <p className="text-xs text-gray-400">{description}</p> : null}
      </div>
      {actions}
    </div>
    {children}
  </div>
);

export const Field = ({ label, icon: Icon, error, hint, required, children, className = '' }) => (
  <div className={className}>
    {label ? (
      <label className={labelClass}>
        {Icon ? <Icon size={12} className="inline mr-1 text-gray-400" /> : null}
        {label}
        {required ? ' *' : ''}
      </label>
    ) : null}
    {children}
    {error ? <p className="mt-1 text-[11px] font-medium text-rose-600">{error}</p> : null}
    {!error && hint ? <p className="mt-1 text-[11px] text-gray-400">{hint}</p> : null}
  </div>
);

export const Switch = ({ checked, onChange, disabled, label, size = 'md' }) => {
  const dims = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11';
  const knob = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  const shift = size === 'sm' ? 'translate-x-4' : 'translate-x-5';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(checked)}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${dims} ${
        checked ? 'bg-indigo-600' : 'bg-gray-200'
      }`}
    >
      <span
        className={`inline-block transform rounded-full bg-white shadow transition-transform ${knob} ${
          checked ? shift : 'translate-x-0.5'
        }`}
      />
    </button>
  );
};

export const Hint = ({ children, tone = 'info' }) => {
  const tones = {
    info: 'bg-indigo-50 border-indigo-100 text-indigo-900',
    warn: 'bg-amber-50 border-amber-100 text-amber-900',
  };
  const Icon = tone === 'warn' ? AlertTriangle : Info;
  return (
    <div className={`border rounded-xl p-3 flex items-start gap-2.5 text-xs leading-relaxed ${tones[tone]}`}>
      <Icon size={15} className="shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
};

export const ErrorBanner = ({ message, onRetry, onClose }) =>
  message ? (
    <div className="flex items-start gap-3 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">{message}</div>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="text-xs font-semibold underline">
          Retry
        </button>
      ) : null}
      {onClose ? (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="text-rose-400 hover:text-rose-600">
          <X size={14} />
        </button>
      ) : null}
    </div>
  ) : null;

export const ConfirmDialog = ({ open, title, message, confirmLabel = 'Delete', busy, onConfirm, onCancel }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 p-4" onClick={busy ? undefined : onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
            <AlertTriangle size={18} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            <p className="mt-1 text-sm text-gray-500">{message}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
