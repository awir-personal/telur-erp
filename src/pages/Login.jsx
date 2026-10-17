import React, { useEffect, useState } from 'react';
import { get, post, setToken } from '../api';
import { ErrorBox, Field, PinInput, useAction } from '../components/ui';

const LAST = 'telur_erp_last_name';
const remember = { get: () => { try { return localStorage.getItem(LAST) || ''; } catch { return ''; } }, set: (v) => { try { localStorage.setItem(LAST, v); } catch { /* abaikan */ } } };

function Shell({ title, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <div className="mb-4 text-center">
          <div className="text-3xl">🥚</div>
          <h1 className="text-lg font-bold">Telur ERP</h1>
          <p className="text-sm text-slate-500">{title}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function LoginPage({ onLogin }) {
  const [status, setStatus] = useState(null);
  const [name, setName] = useState(remember.get());
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [code, setCode] = useState('');
  const a = useAction();
  useEffect(() => { get('/auth/status').then(setStatus, (e) => a.setError(e)); }, []); // eslint-disable-line

  if (!status) return <Shell title="Memuat…"><ErrorBox error={a.error} /></Shell>;

  if (status.needsSetup) {
    const submit = (e) => {
      e.preventDefault();
      a.run(async () => {
        if (pin !== pin2) throw new Error('Konfirmasi PIN tidak sama');
        await post('/auth/setup', { name, pin, setupCode: code });
        setStatus({ needsSetup: false });
        setPin(''); setPin2('');
      });
    };
    return (
      <Shell title="Setup pertama: buat Master User">
        <form onSubmit={submit} className="space-y-3">
          <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">Master user bisa membuat user lain, menonaktifkan, dan me-reset PIN. PIN siapa pun tidak bisa dilihat, termasuk oleh master.</p>
          <Field label="Nama"><input className="inp" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          <Field label="PIN (6 angka)"><PinInput value={pin} onChange={setPin} /></Field>
          <Field label="Ulangi PIN"><PinInput value={pin2} onChange={setPin2} /></Field>
          {status.setupCodeRequired && <Field label="Kode setup (dari pengelola server)"><input className="inp" value={code} onChange={(e) => setCode(e.target.value)} /></Field>}
          <ErrorBox error={a.error} />
          <button className="btn-primary w-full" disabled={a.busy}>Buat Master User</button>
        </form>
      </Shell>
    );
  }

  const submit = (e) => {
    e.preventDefault();
    a.run(async () => {
      const r = await post('/auth/login', { name, pin });
      remember.set(name);
      setToken(r.token);
      onLogin();
    });
  };
  return (
    <Shell title="Masuk dengan nama & PIN">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Nama"><input className="inp" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!name} autoComplete="username" /></Field>
        <Field label="PIN"><PinInput value={pin} onChange={setPin} autoFocus={Boolean(name)} /></Field>
        <ErrorBox error={a.error} />
        <button className="btn-primary w-full" disabled={a.busy || pin.length !== 6 || !name}>Masuk</button>
        <p className="text-center text-xs text-slate-500">Lupa PIN? Minta master user untuk reset.</p>
      </form>
    </Shell>
  );
}

export function ChangePinForm({ forced, onDone }) {
  const [oldPin, setOld] = useState('');
  const [newPin, setNew] = useState('');
  const [newPin2, setNew2] = useState('');
  const [done, setDone] = useState(false);
  const a = useAction();
  const submit = (e) => {
    e.preventDefault();
    a.run(async () => {
      if (newPin !== newPin2) throw new Error('Konfirmasi PIN baru tidak sama');
      await post('/auth/change-pin', { oldPin, newPin });
      setDone(true);
      onDone?.();
    });
  };
  if (done && !forced) return <p className="text-sm text-green-700">PIN berhasil diganti. Sesi di perangkat lain otomatis keluar.</p>;
  return (
    <form onSubmit={submit} className="space-y-3">
      {forced && <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">Anda memakai PIN sementara dari master. Buat PIN baru yang hanya Anda yang tahu.</p>}
      <Field label={forced ? 'PIN sementara' : 'PIN lama'}><PinInput value={oldPin} onChange={setOld} autoFocus /></Field>
      <Field label="PIN baru (6 angka, tidak boleh sama semua / berurutan)"><PinInput value={newPin} onChange={setNew} /></Field>
      <Field label="Ulangi PIN baru"><PinInput value={newPin2} onChange={setNew2} /></Field>
      <ErrorBox error={a.error} />
      <button className="btn-primary w-full" disabled={a.busy}>Simpan PIN baru</button>
    </form>
  );
}

export function ForcedChangePin({ onDone, onLogout }) {
  return (
    <Shell title="Ganti PIN dulu">
      <ChangePinForm forced onDone={onDone} />
      <button className="btn-ghost mt-3 w-full" onClick={onLogout}>Keluar</button>
    </Shell>
  );
}
