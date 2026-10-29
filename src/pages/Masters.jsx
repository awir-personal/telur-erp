import React, { useEffect, useState } from 'react';
import { get, post, put, qs } from '../api';
import { ErrorBox, Field, Modal, NumInput, PageTitle, useAction, useAuth, useLoad } from '../components/ui';
import { qty } from '../format';

const TABS = [['customer', 'Customer'], ['supplier', 'Supplier'], ['items', 'Barang'], ['units', 'Satuan']];

export default function MastersPage() {
  const [tab, setTab] = useState('customer');
  return (
    <div>
      <PageTitle>Master Data</PageTitle>
      <div className="mb-3 flex gap-1 overflow-x-auto border-b">
        {TABS.map(([k, v]) => <button key={k} className={`px-3 py-1.5 text-sm ${tab === k ? 'border-b-2 border-brand-600 font-semibold' : 'text-slate-600'}`} onClick={() => setTab(k)}>{v}</button>)}
      </div>
      {(tab === 'customer' || tab === 'supplier') && <Parties key={tab} kind={tab} />}
      {tab === 'items' && <Items />}
      {tab === 'units' && <Units />}
    </div>
  );
}

const Active = ({ v }) => (v ? <span className="text-green-700">Aktif</span> : <span className="text-slate-400">Nonaktif</span>);

function Parties({ kind }) {
  const { perms } = useAuth();
  const list = useLoad(() => get('/parties' + qs({ kind })), [kind]);
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const rows = (list.data || []).filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        <input className="inp max-w-xs" placeholder="Cari nama" value={q} onChange={(e) => setQ(e.target.value)} />
        {perms.master && <button className="btn-primary" onClick={() => setEdit({ kind, name: '', phone: '', address: '', term_days: 30, price_rule: '', notes: '', active: 1 })}>+ {kind === 'customer' ? 'Customer' : 'Supplier'}</button>}
      </div>
      <ErrorBox error={list.error} />
      <div className="overflow-x-auto rounded border border-slate-300 bg-white">
        <table className="sheet w-full border-collapse">
          <thead><tr><th>Nama</th><th>Telepon</th><th>Termin (hari)</th>{kind === 'customer' && <th>Aturan harga</th>}<th>Catatan</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={perms.master ? 'cursor-pointer hover:bg-sky-50' : ''} onClick={() => perms.master && setEdit(p)}>
                <td className="font-medium">{p.name}{p.gta_purchase ? <span className="ml-1 rounded bg-teal-100 px-1 text-[10px] font-semibold text-teal-800" title="Penjualan ke customer ini = pembelian PT GTA dari APG">GTA</span> : null}</td><td>{p.phone}</td><td className="text-right">{p.term_days}</td>
                {kind === 'customer' && <td className="max-w-[260px] truncate">{p.price_rule}</td>}
                <td className="max-w-[260px] truncate">{p.notes}</td><td><Active v={p.active} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <PartyForm p={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </div>
  );
}

function PartyForm({ p, onClose, onSaved }) {
  const { company } = useAuth();
  const [f, setF] = useState(p);
  const [prices, setPrices] = useState([]);
  const items = useLoad(() => get('/items'), []);
  const units = useLoad(() => get('/units'), []);
  const a = useAction();
  const isCust = p.kind === 'customer';
  useEffect(() => { if (p.id) get(`/parties/${p.id}/prices`).then((rows) => setPrices(rows.map((r) => ({ ...r, key: r.id }))), a.setError); }, [p.id]); // eslint-disable-line
  const save = (e) => {
    e.preventDefault();
    a.run(async () => {
      const r = p.id ? (await put(`/parties/${p.id}`, f), { id: p.id }) : await post('/parties', f);
      if (isCust) await put(`/parties/${r.id}/prices`, { prices: prices.filter((x) => x.item_id && x.unit_id && x.price !== '') });
      onSaved();
    });
  };
  const setPrice = (i, patch) => setPrices(prices.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Modal title={`${p.id ? 'Edit' : 'Tambah'} ${isCust ? 'customer' : 'supplier'}`} onClose={onClose} wide={isCust}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Nama" className="col-span-2"><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Telepon"><input className="inp" value={f.phone || ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Termin bayar (hari)"><NumInput value={f.term_days} onChange={(v) => setF({ ...f, term_days: v })} /></Field>
          <Field label="Alamat" className="col-span-2"><input className="inp" value={f.address || ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          {isCust && company?.code === 'APG' && (
            <label className="col-span-2 flex items-start gap-2 rounded border border-teal-200 bg-teal-50 p-2 text-sm dark:border-teal-900 dark:bg-teal-950/40">
              <input type="checkbox" className="mt-0.5" checked={!!f.gta_purchase} onChange={(e) => setF({ ...f, gta_purchase: e.target.checked })} />
              <span><b>Pembelian GTA</b> — penjualan APG ke customer ini diakui sebagai pembelian PT GTA dari APG / Farm (mis. Angel, Adi, Adi D, Potteria Restaurant)</span>
            </label>
          )}
          {isCust && <Field label="Aturan harga khusus (teks bebas, tampil saat buat invoice)" className="col-span-2"><textarea className="inp" rows={2} value={f.price_rule || ''} onChange={(e) => setF({ ...f, price_rule: e.target.value })} placeholder="mis. harga curah = harga pasar − 500, ambil ≥ 500 kg" /></Field>}
          <Field label="Catatan" className="col-span-2"><input className="inp" value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(f.active)} onChange={(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} /> Aktif</label>
        </div>
        {isCust && (
          <div className="rounded border p-2">
            <div className="mb-1 flex items-center justify-between"><b className="text-sm">Harga khusus</b><button type="button" className="btn-ghost py-1 text-xs" onClick={() => setPrices([...prices, { key: Math.random(), item_id: '', unit_id: '', price: '', note: '' }])}>+ Harga</button></div>
            <p className="mb-2 text-xs text-slate-500">Terisi otomatis saat membuat invoice, tapi harga tetap bisa diketik bebas.</p>
            {prices.map((x, i) => (
              <div key={x.key} className="mb-1 grid grid-cols-12 gap-1">
                <select className="inp col-span-4" value={x.item_id} onChange={(e) => setPrice(i, { item_id: Number(e.target.value) })}><option value="">barang</option>{(items.data || []).map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}</select>
                <select className="inp col-span-2" value={x.unit_id} onChange={(e) => setPrice(i, { unit_id: Number(e.target.value) })}><option value="">satuan</option>{(units.data || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                <div className="col-span-2"><NumInput value={x.price} onChange={(v) => setPrice(i, { price: v })} /></div>
                <input className="inp col-span-3" placeholder="catatan" value={x.note || ''} onChange={(e) => setPrice(i, { note: e.target.value })} />
                <button type="button" className="col-span-1 text-red-600" onClick={() => setPrices(prices.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
          </div>
        )}
        <ErrorBox error={a.error} />
        <div className="flex gap-2"><button className="btn-primary" disabled={a.busy}>Simpan</button><button type="button" className="btn-ghost" onClick={onClose}>Batal</button></div>
      </form>
    </Modal>
  );
}

function Items() {
  const { perms } = useAuth();
  const list = useLoad(() => get('/items'), []);
  const units = useLoad(() => get('/units'), []);
  const [edit, setEdit] = useState(null);
  const a = useAction();
  const save = (e) => { e.preventDefault(); a.run(async () => { edit.id ? await put(`/items/${edit.id}`, edit) : await post('/items', edit); setEdit(null); list.reload(); }); };
  return (
    <div>
      {perms.master && <button className="btn-primary mb-2" onClick={() => setEdit({ name: '', default_unit_id: units.data?.[0]?.id || '', sort_order: 100, active: 1 })}>+ Barang</button>}
      <ErrorBox error={list.error} />
      <div className="overflow-x-auto rounded border border-slate-300 bg-white">
        <table className="sheet w-full border-collapse">
          <thead><tr><th>Urutan kolom</th><th>Nama barang (keterangan grade)</th><th>Satuan default</th><th>Status</th></tr></thead>
          <tbody>{(list.data || []).map((it) => (
            <tr key={it.id} className={perms.master ? 'cursor-pointer hover:bg-sky-50' : ''} onClick={() => perms.master && setEdit(it)}>
              <td className="text-right">{it.sort_order}</td><td className="font-medium">{it.name}</td><td>{it.unit_name}</td><td><Active v={it.active} /></td>
            </tr>))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Setiap barang aktif jadi satu pasang kolom (Qty, Harga) di tampilan Penjualan, diurutkan menurut "Urutan kolom".</p>
      {edit && (
        <Modal title={edit.id ? 'Edit barang' : 'Tambah barang'} onClose={() => setEdit(null)}>
          <form onSubmit={save} className="space-y-3">
            <Field label="Nama"><input className="inp" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Satuan default"><select className="inp" value={edit.default_unit_id} onChange={(e) => setEdit({ ...edit, default_unit_id: Number(e.target.value) })}>{(units.data || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
              <Field label="Urutan kolom"><NumInput value={edit.sort_order} onChange={(v) => setEdit({ ...edit, sort_order: v })} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(edit.active)} onChange={(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} /> Aktif</label>
            <ErrorBox error={a.error} />
            <button className="btn-primary" disabled={a.busy}>Simpan</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Units() {
  const { perms } = useAuth();
  const list = useLoad(() => get('/units'), []);
  const [edit, setEdit] = useState(null);
  const a = useAction();
  const save = (e) => { e.preventDefault(); a.run(async () => { edit.id ? await put(`/units/${edit.id}`, edit) : await post('/units', edit); setEdit(null); list.reload(); }); };
  return (
    <div>
      {perms.master && <button className="btn-primary mb-2" onClick={() => setEdit({ name: '', kg_per_unit: '', active: 1 })}>+ Satuan</button>}
      <ErrorBox error={list.error} />
      <div className="overflow-x-auto rounded border border-slate-300 bg-white">
        <table className="sheet w-full border-collapse">
          <thead><tr><th>Satuan</th><th>Setara kg (rata-rata)</th><th>Status</th></tr></thead>
          <tbody>{(list.data || []).map((u) => (
            <tr key={u.id} className={perms.master ? 'cursor-pointer hover:bg-sky-50' : ''} onClick={() => perms.master && setEdit({ ...u, kg_per_unit: u.kg_per_unit ?? '' })}>
              <td className="font-medium">{u.name}</td><td className="text-right">{u.kg_per_unit == null ? '—' : `${qty(u.kg_per_unit)} kg`}</td><td><Active v={u.active} /></td>
            </tr>))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Konversi kg dipakai untuk info "≈ kg" dan laporan stok. Kalau berat sebenarnya beda, ketik langsung dalam kg di invoice.</p>
      {edit && (
        <Modal title={edit.id ? 'Edit satuan' : 'Tambah satuan'} onClose={() => setEdit(null)}>
          <form onSubmit={save} className="space-y-3">
            <Field label="Nama satuan"><input className="inp" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></Field>
            <Field label="Setara berapa kg (kosongkan bila tidak tetap, mis. butir/peti)"><NumInput value={edit.kg_per_unit} onChange={(v) => setEdit({ ...edit, kg_per_unit: v })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(edit.active)} onChange={(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} /> Aktif</label>
            <ErrorBox error={a.error} />
            <button className="btn-primary" disabled={a.busy}>Simpan</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

