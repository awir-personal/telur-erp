import React, { useEffect, useState } from 'react';
import { get, put } from '../api';
import { ErrorBox, Field, NumInput, PageTitle, useAction, useAuth, useLoad } from '../components/ui';
import { ChangePinForm } from './Login';
import { waktu } from '../format';

export default function SettingsPage() {
  const { user } = useAuth();
  const isMaster = user.role === 'master';
  return (
    <div className="space-y-3">
      <PageTitle>{isMaster ? 'Pengaturan' : 'Akun'}</PageTitle>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="card"><h3 className="mb-2 font-semibold">Ganti PIN saya</h3><ChangePinForm /></div>
        {isMaster && <General />}
      </div>
      {isMaster && <Logs />}
    </div>
  );
}

function General() {
  const s = useLoad(() => get('/settings'), []);
  const [f, setF] = useState(null);
  const [saved, setSaved] = useState(false);
  const a = useAction();
  useEffect(() => { if (s.data) setF({ company_name: s.data.company_name, next_sale_no: Number(s.data.next_sale_no) }); }, [s.data]);
  if (!f) return <div className="card"><ErrorBox error={s.error} /></div>;
  const save = (e) => { e.preventDefault(); setSaved(false); a.run(async () => { await put('/settings', f); setSaved(true); s.reload(); }); };
  return (
    <form className="card space-y-3" onSubmit={save}>
      <h3 className="font-semibold">Umum</h3>
      <Field label="Nama perusahaan"><input className="inp" value={f.company_name} onChange={(e) => setF({ ...f, company_name: e.target.value })} /></Field>
      <Field label="Nomor invoice penjualan berikutnya"><NumInput value={f.next_sale_no} onChange={(v) => setF({ ...f, next_sale_no: v })} /></Field>
      <p className="text-xs text-slate-500">Nomor yang sudah terpakai otomatis dilewati. Import data lama juga menaikkan nomor ini.</p>
      <ErrorBox error={a.error} />
      {saved && <p className="text-sm text-green-700">Tersimpan.</p>}
      <button className="btn-primary" disabled={a.busy}>Simpan</button>
    </form>
  );
}

const ACTION = { login: 'Login', setup: 'Setup awal', create: 'Buat', update: 'Ubah', delete: 'Hapus', adjust: 'Penyesuaian', delete_adjust: 'Hapus penyesuaian', diff_note: 'Justifikasi selisih', reset_pin: 'Reset PIN', change_pin: 'Ganti PIN', locked: 'Terkunci (salah PIN)', import: 'Import', update_prices: 'Ubah harga khusus' };

function Logs() {
  const logs = useLoad(() => get('/logs?limit=300'), []);
  const [open, setOpen] = useState(null);
  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Log aktivitas (300 terakhir)</h3><button className="btn-ghost py-1 text-xs" onClick={logs.reload}>Muat ulang</button></div>
      <ErrorBox error={logs.error} />
      <div className="max-h-[60vh] overflow-auto">
        <table className="sheet w-full border-collapse">
          <thead className="sticky top-0"><tr><th>Waktu (WIB)</th><th>User</th><th>Aksi</th><th>Objek</th><th>Detail</th></tr></thead>
          <tbody>
            {(logs.data || []).map((l) => (
              <tr key={l.id} className="cursor-pointer align-top hover:bg-sky-50" onClick={() => setOpen(open === l.id ? null : l.id)}>
                <td>{waktu(l.at)}</td><td>{l.user_name}</td><td>{ACTION[l.action] || l.action}</td><td>{l.entity}{l.entity_id ? ` #${l.entity_id}` : ''}</td>
                <td className={open === l.id ? 'whitespace-pre-wrap break-all' : 'max-w-[420px] truncate'}>{open === l.id && l.detail ? JSON.stringify(JSON.parse(l.detail), null, 1) : l.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
