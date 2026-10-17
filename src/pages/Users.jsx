import React, { useState } from 'react';
import { get, post, put } from '../api';
import { ErrorBox, Field, Modal, PageTitle, useAction, useAuth, useLoad } from '../components/ui';

const ROLES = { master: 'Master (semua akses + kelola user)', admin: 'Admin (input invoice, master data, import)', finance: 'Finance (validasi pembayaran, retur, pembulatan)' };

export default function UsersPage() {
  const { user } = useAuth();
  const list = useLoad(() => get('/users'), []);
  const [edit, setEdit] = useState(null);
  const [pinShown, setPinShown] = useState(null); // {name, pin}
  const a = useAction();

  if (user.role !== 'master') return <ErrorBox error={{ message: 'Hanya master user' }} />;

  const save = (e) => {
    e.preventDefault();
    a.run(async () => {
      if (edit.id) await put(`/users/${edit.id}`, edit);
      else { const r = await post('/users', edit); setPinShown({ name: edit.name, pin: r.tempPin }); }
      setEdit(null); list.reload();
    });
  };
  const reset = (u) => a.run(async () => {
    if (!window.confirm(`Reset PIN ${u.name}? PIN lama langsung tidak berlaku dan sesi ${u.name} di semua perangkat diputus.`)) return;
    const r = await post(`/users/${u.id}/reset-pin`);
    setPinShown({ name: u.name, pin: r.tempPin });
    list.reload();
  });

  return (
    <div>
      <PageTitle right={<button className="btn-primary" onClick={() => setEdit({ name: '', role: 'admin', active: 1 })}>+ User</button>}>Master User</PageTitle>
      <p className="mb-3 rounded bg-amber-50 p-2 text-xs text-amber-800">PIN disimpan terenkripsi satu arah: tidak ada yang bisa melihat PIN siapa pun, termasuk master. Master bisa <b>reset PIN</b>. Sistem lalu membuat PIN sementara yang tampil sekali, dan user wajib menggantinya saat login.</p>
      <ErrorBox error={a.error || list.error} />
      <div className="overflow-x-auto rounded border border-slate-300 bg-white">
        <table className="sheet w-full border-collapse">
          <thead><tr><th>Nama</th><th>Peran</th><th>Status</th><th>PIN</th><th>Aksi</th></tr></thead>
          <tbody>
            {(list.data || []).map((u) => (
              <tr key={u.id}>
                <td className="font-medium">{u.name}{u.id === user.id && ' (Anda)'}</td>
                <td>{u.role}</td>
                <td>{u.active ? <span className="text-green-700">Aktif</span> : <span className="text-slate-400">Nonaktif</span>}{u.locked ? <span className="ml-1 text-red-600">· terkunci</span> : null}</td>
                <td>{u.must_change_pin ? <span className="text-amber-700">PIN sementara (belum diganti)</span> : 'PIN pribadi'}</td>
                <td className="space-x-2">
                  <button className="text-sky-700 underline" onClick={() => setEdit(u)}>edit</button>
                  {u.id !== user.id && <button className="text-red-600 underline" onClick={() => reset(u)}>reset PIN</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={edit.id ? `Edit ${edit.name}` : 'Tambah user'} onClose={() => setEdit(null)}>
          <form onSubmit={save} className="space-y-3">
            <Field label="Nama (dipakai untuk login)"><input className="inp" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></Field>
            <Field label="Peran"><select className="inp" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            {edit.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(edit.active)} onChange={(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} /> Aktif (nonaktif = tidak bisa login, sesinya langsung diputus)</label>}
            {!edit.id && <p className="text-xs text-slate-500">PIN sementara akan dibuat otomatis dan ditampilkan sekali setelah disimpan.</p>}
            <ErrorBox error={a.error} />
            <button className="btn-primary" disabled={a.busy}>Simpan</button>
          </form>
        </Modal>
      )}
      {pinShown && (
        <Modal title="PIN sementara" onClose={() => setPinShown(null)}>
          <p className="text-sm">PIN sementara untuk <b>{pinShown.name}</b>:</p>
          <p className="my-3 text-center font-mono text-3xl tracking-[0.3em]">{pinShown.pin}</p>
          <p className="text-xs text-slate-600">Berikan langsung ke {pinShown.name}. PIN ini <b>tidak bisa dilihat lagi</b> setelah jendela ini ditutup. {pinShown.name} wajib menggantinya dengan PIN pribadi saat login pertama.</p>
          <button className="btn-primary mt-3 w-full" onClick={() => setPinShown(null)}>Sudah saya catat</button>
        </Modal>
      )}
    </div>
  );
}
