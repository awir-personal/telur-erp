import React, { useCallback, useEffect, useState, createContext, useContext } from 'react';
import { parseNum, toInput, STATUS } from '../format';

export const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

// Ambil data; reload() untuk ambil ulang.
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return fn().then((data) => setState({ data, error: null, loading: false }), (error) => setState({ data: null, error, loading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export function Field({ label, children, className = '' }) {
  return <label className={`block ${className}`}><span className="lbl">{label}</span>{children}</label>;
}

// Input angka format Indonesia. value = number | '' ; onChange(number | '')
export function NumInput({ value, onChange, className = '', ...rest }) {
  const [text, setText] = useState(toInput(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(toInput(value)); }, [value, focus]);
  const bad = Number.isNaN(parseNum(text));
  return (
    <input {...rest} inputMode="decimal" className={`inp text-right ${bad ? 'border-red-500' : ''} ${className}`} value={text}
      onFocus={() => setFocus(true)}
      onBlur={() => { setFocus(false); const n = parseNum(text); setText(Number.isNaN(n) ? text : toInput(n)); }}
      onChange={(e) => { setText(e.target.value); const n = parseNum(e.target.value); if (!Number.isNaN(n)) onChange(n); }} />
  );
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="my-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error.message || String(error)}</div>;
}

export function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, cls: 'bg-slate-100' };
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${s.cls}`}>{s.label}</span>;
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-2 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} rounded-lg bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b px-4 py-2">
          <h3 className="font-semibold">{title}</h3>
          <button className="px-2 text-xl leading-none text-slate-500" onClick={onClose} aria-label="Tutup">×</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

// Tombol aksi async: menampilkan error di bawahnya dan mencegah klik ganda.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(e); return undefined; } finally { setBusy(false); }
  };
  return { busy, error, run, setError };
}

export function PageTitle({ children, right }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-lg font-bold">{children}</h1>
      <div className="flex flex-wrap gap-2">{right}</div>
    </div>
  );
}

export function PinInput({ value, onChange, autoFocus, id }) {
  return <input id={id} className="inp text-center tracking-[0.5em]" type="password" inputMode="numeric" autoComplete="off" maxLength={6}
    autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} />;
}
