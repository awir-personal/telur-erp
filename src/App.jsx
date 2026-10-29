import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { get, post, getToken, setToken, setUnauthorizedHandler, getCompany, setCompany } from './api';
import { AuthCtx } from './components/ui';
import { ThemeToggle, formatVersion } from './lib/theme';
import { LoginPage, ForcedChangePin } from './pages/Login';
import InvoicesPage from './pages/Invoices';
import InvoiceForm from './pages/InvoiceForm';
import InvoiceDetail from './pages/InvoiceDetail';
import PaymentsPage from './pages/Payments';
import ReportsPage from './pages/Reports';
import MastersPage from './pages/Masters';
import UsersPage from './pages/Users';
import ImportPage from './pages/Import';
import SettingsPage from './pages/Settings';
import Dashboard from './pages/Dashboard';
import KasBank from './pages/KasBank';
import InvoicePrint from './pages/InvoicePrint';

const ROLE = { master: 'Master', admin: 'Admin', finance: 'Finance' };

// Versi di pojok kiri bawah, format vX.Y — sama seperti semua app lain.
// Dulu dibaca dari /api/version: server lama yang belum punya endpoint itu menjawab 401 → tampil "v?"
// dan bisa memicu logout. Sekarang versi ditanam saat build (vite.config.js → __APP_VERSION__).
export function VersionFooter() {
  return <div className="no-print pointer-events-none fixed bottom-2 left-3 select-none text-[11px] text-slate-400 dark:text-slate-600">{formatVersion(__APP_VERSION__)}</div>;
}

export default function App() {
  const [me, setMe] = useState(undefined); // undefined = memuat, null = belum login
  const loadMe = useCallback(() => {
    if (!getToken()) return setMe(null);
    get('/auth/me').then(setMe, () => { setToken(null); setMe(null); });
  }, []);
  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(null); setMe(null); });
    loadMe();
  }, [loadMe]);
  const logout = async () => { try { await post('/auth/logout'); } catch { /* tetap keluar */ } setToken(null); setMe(null); };
  // v4.0 multi-perusahaan: daftar perusahaan + yang sedang aktif (dari server, sesuai header X-Company)
  const [cos, setCos] = useState(null);
  useEffect(() => {
    if (!me || me.user.must_change_pin) return;
    get('/companies').then(setCos, (e) => {
      if (e.status === 400 && getCompany()) { setCompany(null); window.location.reload(); } // perusahaan tersimpan sudah tidak ada
    });
  }, [me]);
  const switchCompany = (id) => { setCompany(id); window.location.assign('/dashboard'); }; // muat ulang semua data perusahaan itu

  if (me === undefined) return <div className="p-6 text-sm text-slate-500">Memuat…</div>;
  if (!me) return <><LoginPage onLogin={loadMe} /><VersionFooter /></>;
  if (me.user.must_change_pin) return <><ForcedChangePin onDone={loadMe} onLogout={logout} /><VersionFooter /></>;
  if (!cos) return <div className="p-6 text-sm text-slate-500">Memuat…</div>;
  const company = cos.companies.find((c) => c.id === cos.current) || cos.companies[0];
  const isGta = company.code === 'GTA';

  const p = me.perms;
  const isMaster = me.user.role === 'master';
  const links = [
    ['/dashboard', 'Dashboard'],
    ['/penjualan', 'Penjualan'],
    ['/pembelian', 'Pembelian'],
    ['/uang-masuk', 'Uang Masuk'],
    ['/uang-keluar', 'Uang Keluar'],
    ['/kas', 'Kas & Bank'],
    ['/laporan', 'Laporan'],
    ['/master', 'Master'],
    p.import && ['/import', 'Import'],
    isMaster && ['/user', 'User'],
    ['/pengaturan', isMaster ? 'Pengaturan' : 'Akun'],
  ].filter(Boolean);

  return (
    <AuthCtx.Provider value={{ ...me, logout, company }}>
      <div className="flex min-h-screen flex-col">
        {/* warna header berbeda per perusahaan supaya tidak salah input ke APG / GTA */}
        <header className={`no-print flex items-center justify-between gap-2 px-4 py-3 text-white sm:px-6 ${isGta ? 'bg-teal-800' : 'bg-brand-700'}`}>
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="text-lg font-semibold leading-tight">🥚 Telur ERP</h1>
            <label className="flex min-w-0 items-center gap-2" title="Perusahaan yang sedang dibuka - semua data & laporan hanya milik perusahaan ini">
              <span className="sr-only">Perusahaan</span>
              <select aria-label="Perusahaan" className="rounded-md border border-white/40 bg-white/15 px-2 py-1 text-sm font-semibold text-white [&>option]:text-slate-900" value={company.id} onChange={(e) => switchCompany(e.target.value)}>
                {cos.companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.display_name}</option>)}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-1">
            <span className="hidden px-2 text-right text-xs leading-tight text-brand-100 sm:block">
              <span className="block font-semibold text-white">{me.user.name}</span>{ROLE[me.user.role]}
            </span>
            <ThemeToggle />
            <button type="button" onClick={logout} className="rounded-md px-2 py-1 text-sm text-brand-100 transition-colors hover:bg-brand-600/50 hover:text-white">Keluar</button>
          </div>
        </header>
        <nav className="no-print flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 dark:border-slate-700 dark:bg-slate-800 sm:px-6">
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => `-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium ${isActive
              ? 'border-brand-600 text-brand-700 dark:text-brand-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}>{label}</NavLink>
          ))}
        </nav>
        <main className="mx-auto w-full max-w-[1600px] flex-1 p-3 pb-10 sm:px-6">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/penjualan" element={<InvoicesPage kind="sale" />} />
            <Route path="/pembelian" element={<InvoicesPage kind="purchase" />} />
            <Route path="/penjualan/baru" element={<InvoiceForm kind="sale" />} />
            <Route path="/pembelian/baru" element={<InvoiceForm kind="purchase" />} />
            <Route path="/invoice/:id/edit" element={<InvoiceForm />} />
            <Route path="/invoice/:id" element={<InvoiceDetail />} />
            <Route path="/invoice/:id/cetak" element={<InvoicePrint />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/kas" element={<KasBank />} />
            <Route path="/uang-masuk" element={<PaymentsPage kind="sale" />} />
            <Route path="/uang-keluar" element={<PaymentsPage kind="purchase" />} />
            {/* alamat lama tetap bisa dibuka (bookmark) */}
            <Route path="/penerimaan" element={<Navigate to="/uang-masuk" replace />} />
            <Route path="/pembayaran" element={<Navigate to="/uang-keluar" replace />} />
            <Route path="/laporan" element={<ReportsPage />} />
            <Route path="/master" element={<MastersPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/user" element={<UsersPage />} />
            <Route path="/pengaturan" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
        <VersionFooter />
      </div>
    </AuthCtx.Provider>
  );
}
