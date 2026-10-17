import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { get, post, getToken, setToken, setUnauthorizedHandler } from './api';
import { AuthCtx } from './components/ui';
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

const ROLE = { master: 'Master', admin: 'Admin', finance: 'Finance' };

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

  if (me === undefined) return <div className="p-6 text-sm text-slate-500">Memuat…</div>;
  if (!me) return <LoginPage onLogin={loadMe} />;
  if (me.user.must_change_pin) return <ForcedChangePin onDone={loadMe} onLogout={logout} />;

  const p = me.perms;
  const links = [
    ['/penjualan', 'Penjualan'],
    ['/pembelian', 'Pembelian'],
    ['/penerimaan', 'Penerimaan'],
    ['/pembayaran', 'Bayar Supplier'],
    ['/laporan', 'Laporan'],
    ['/master', 'Master'],
    p.import && ['/import', 'Import'],
    me.user.role === 'master' && ['/user', 'User'],
    ['/pengaturan', me.user.role === 'master' ? 'Pengaturan' : 'Akun'],
  ].filter(Boolean);

  return (
    <AuthCtx.Provider value={{ ...me, logout }}>
      <header className="sticky top-0 z-40 border-b border-amber-700 bg-amber-600 text-white shadow">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-3 py-2">
          <span className="font-bold">🥚 Telur ERP</span>
          <nav className="flex flex-1 gap-1 overflow-x-auto text-sm">
            {links.map(([to, label]) => (
              <NavLink key={to} to={to} className={({ isActive }) => `whitespace-nowrap rounded px-2 py-1 ${isActive ? 'bg-white/25 font-semibold' : 'hover:bg-white/15'}`}>{label}</NavLink>
            ))}
          </nav>
          <div className="hidden text-right text-xs leading-tight sm:block">
            <div className="font-semibold">{me.user.name}</div>
            <div className="opacity-80">{ROLE[me.user.role]}</div>
          </div>
          <button className="rounded bg-white/20 px-2 py-1 text-xs hover:bg-white/30" onClick={logout}>Keluar</button>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] p-3">
        <Routes>
          <Route path="/" element={<Navigate to="/penjualan" replace />} />
          <Route path="/penjualan" element={<InvoicesPage kind="sale" />} />
          <Route path="/pembelian" element={<InvoicesPage kind="purchase" />} />
          <Route path="/penjualan/baru" element={<InvoiceForm kind="sale" />} />
          <Route path="/pembelian/baru" element={<InvoiceForm kind="purchase" />} />
          <Route path="/invoice/:id/edit" element={<InvoiceForm />} />
          <Route path="/invoice/:id" element={<InvoiceDetail />} />
          <Route path="/penerimaan" element={<PaymentsPage kind="sale" />} />
          <Route path="/pembayaran" element={<PaymentsPage kind="purchase" />} />
          <Route path="/laporan" element={<ReportsPage />} />
          <Route path="/master" element={<MastersPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/user" element={<UsersPage />} />
          <Route path="/pengaturan" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/penjualan" replace />} />
        </Routes>
      </main>
    </AuthCtx.Provider>
  );
}
