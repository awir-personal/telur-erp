import React, { useState } from 'react';
import { del, get, post, put, qs } from '../api';
import { ErrorBox, Field, Modal, NumInput, PageTitle, useAction, useAuth, useLoad } from '../components/ui';
import { useConfirm } from '../lib/confirm';
import { downloadXlsx, xlDate } from '../lib/excel';
import { firstOfMonth, rp, tgl, today } from '../format';
import Recon from './Recon';

const TABS = [['saldo', 'Saldo & Buku Rekening'], ['txn', 'Biaya / Pemasukan / Transfer'], ['rekon', 'Rekonsiliasi Bank'], ['master', 'Rekening & Kategori']];
const KIND = { biaya: 'Biaya', pemasukan: 'Pemasukan lain', modal: 'Setoran modal', prive: 'Penarikan pemilik', transfer: 'Transfer antar rekening' };
const OUT = ['biaya', 'prive'];

export default function KasBank() {
  const [tab, setTab] = useState('saldo');
  return (
    <div>
      <PageTitle>Kas & Bank</PageTitle>
      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map(([k, v]) => <button key={k} className={`whitespace-nowrap px-3 py-1.5 text-sm ${tab === k ? 'border-b-2 border-brand-600 font-semibold' : 'text-slate-500'}`} onClick={() => setTab(k)}>{v}</button>)}
      </div>
      {tab === 'saldo' && <Saldo />}
      {tab === 'txn' && <Txns />}
      {tab === 'rekon' && <Recon embedded />}
      {tab === 'master' && <Master />}
    </div>
  );
}

function Saldo() {
  const [asOf, setAsOf] = useState(today());
  const bal = useLoad(() => get('/cash/balances' + qs({ as_of: asOf })), [asOf]);
  const [acc, setAcc] = useState(null);
  const [range, setRange] = useState({ from: firstOfMonth(), to: today() });
  const led = useLoad(() => (acc ? get('/cash/ledger' + qs({ account_id: acc, ...range })) : Promise.resolve(null)), [acc, range.from, range.to]);
  const b = bal.data;

  const exportLedger = () => {
    const L = led.data;
    downloadXlsx(`Buku ${L.account.name} ${range.from} sd ${range.to}.xlsx`, [{
      name: L.account.name, widths: [11, 34, 40, 14, 14, 15],
      aoa: [['Tanggal', 'Uraian', 'Keterangan', 'Masuk', 'Keluar', 'Saldo'], ['', 'Saldo awal', '', '', '', L.opening],
        ...L.rows.map((m) => [xlDate(m.date), m.label, m.note || '', m.amount > 0 ? m.amount : '', m.amount < 0 ? -m.amount : '', m.balance])],
    }]);
  };

  return (
    <div className="space-y-3">
      <label className="inline-block"><span className="lbl">Saldo per tanggal</span><input type="date" className="inp" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
      <ErrorBox error={bal.error} />
      {b && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {b.accounts.filter((a) => a.active).map((a) => (
            <button key={a.id} type="button" onClick={() => setAcc(a.id)} className={`card text-left transition-colors hover:border-brand-400 ${acc === a.id ? 'ring-2 ring-brand-500' : ''}`}>
              <div className="text-xs text-slate-500">{a.type === 'bank' ? `🏦 ${a.bank || 'Bank'}${a.account_no ? ' · ' + a.account_no : ''}` : '💵 Kas'}</div>
              <div className="font-semibold">{a.name}</div>
              <div className={`text-xl font-bold ${a.balance < 0 ? 'text-red-600' : ''}`}>{rp(a.balance)}</div>
              {a.ignoredBeforeOpening > 0 && <div className="text-[11px] text-amber-700">{a.ignoredBeforeOpening} transaksi sebelum tanggal saldo awal tidak dihitung</div>}
            </button>
          ))}
          <div className="card"><div className="text-xs text-slate-500">Total semua rekening</div><div className="text-xl font-bold">{rp(b.total)}</div>
            {b.paymentsWithoutAccount.count > 0 && <div className="mt-1 text-[11px] text-amber-700">{b.paymentsWithoutAccount.count} pembayaran belum dipilih rekeningnya (netto {rp(b.paymentsWithoutAccount.net)}). Isi di menu Penerimaan / Bayar Supplier agar saldo akurat.</div>}
          </div>
        </div>
      )}
      {acc ? (
        <div className="card">
          <div className="mb-2 flex flex-wrap items-end gap-2">
            <h3 className="mr-auto font-semibold">Buku rekening: {led.data?.account.name}</h3>
            <label><span className="lbl">Dari</span><input type="date" className="inp" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
            <label><span className="lbl">Sampai</span><input type="date" className="inp" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
            <button className="btn-ghost" onClick={exportLedger} disabled={!led.data}>⬇ Excel</button>
          </div>
          <ErrorBox error={led.error} />
          {led.data && (
            <div className="overflow-x-auto">
              <table className="sheet w-full border-collapse">
                <thead><tr><th>Tanggal</th><th>Uraian</th><th>Keterangan</th><th>Masuk</th><th>Keluar</th><th>Saldo</th></tr></thead>
                <tbody>
                  <tr className="bg-slate-50 font-semibold"><td /><td>Saldo awal</td><td /><td /><td /><td className="text-right">{rp(led.data.opening)}</td></tr>
                  {led.data.rows.map((m, i) => (
                    <tr key={i}>
                      <td>{tgl(m.date)}</td><td>{m.label}</td><td className="max-w-[300px] truncate" title={m.note || ''}>{m.note}</td>
                      <td className="text-right text-green-700">{m.amount > 0 ? rp(m.amount) : ''}</td>
                      <td className="text-right text-red-600">{m.amount < 0 ? rp(-m.amount) : ''}</td>
                      <td className="text-right font-medium">{rp(m.balance)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-semibold"><td /><td>Saldo akhir</td><td /><td /><td /><td className="text-right">{rp(led.data.closing)}</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : <p className="text-sm text-slate-500">Klik kartu rekening untuk melihat buku mutasinya.</p>}
    </div>
  );
}

function Txns() {
  const { perms } = useAuth();
  const confirm = useConfirm();
  const [f, setF] = useState({ from: firstOfMonth(), to: today(), kind: '' });
  const list = useLoad(() => get('/cash/txns' + qs(f)), [f.from, f.to, f.kind]);
  const [edit, setEdit] = useState(null);
  const a = useAction();
  const remove = (t) => a.run(async () => {
    if (!await confirm(`Hapus ${KIND[t.kind].toLowerCase()} ${rp(t.amount)} tanggal ${tgl(t.date)}?`)) return;
    await del(`/cash/txns/${t.id}`); list.reload();
  });
  return (
    <div>
      <div className="card mb-3 flex flex-wrap items-end gap-2">
        <label><span className="lbl">Dari</span><input type="date" className="inp" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label><span className="lbl">Sampai</span><input type="date" className="inp" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <label><span className="lbl">Jenis</span><select className="inp" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">Semua</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {perms.cash && <button className="btn-primary ml-auto" onClick={() => setEdit({ date: today(), kind: 'biaya', account_id: '', to_account_id: '', category_id: '', amount: '', reference: '', note: '' })}>+ Catat transaksi</button>}
      </div>
      <ErrorBox error={list.error || a.error} />
      <div className="overflow-x-auto rounded border border-slate-300 bg-white">
        <table className="sheet w-full border-collapse">
          <thead><tr><th>Tanggal</th><th>Jenis</th><th>Kategori / tujuan</th><th>Rekening</th><th>Nominal</th><th>Keterangan</th><th>Oleh</th><th /></tr></thead>
          <tbody>
            {!(list.data || []).length && <tr><td colSpan={8} className="p-3 text-center text-slate-500">{list.loading ? 'Memuat…' : 'Tidak ada transaksi'}</td></tr>}
            {(list.data || []).map((t) => (
              <tr key={t.id}>
                <td>{tgl(t.date)}</td><td>{KIND[t.kind]}</td><td>{t.kind === 'transfer' ? `→ ${t.to_account_name}` : t.category_name}</td><td>{t.account_name}</td>
                <td className={`text-right font-semibold ${OUT.includes(t.kind) ? 'text-red-600' : t.kind === 'transfer' ? '' : 'text-green-700'}`}>{rp(t.amount)}</td>
                <td className="max-w-[280px] truncate">{[t.reference, t.note].filter(Boolean).join(' · ')}</td><td>{t.created_by_name}</td>
                <td className="space-x-2">{perms.cash && <><button className="text-sky-700 underline" onClick={() => setEdit(t)}>edit</button><button className="text-red-600 underline" onClick={() => remove(t)}>hapus</button></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <TxnForm t={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </div>
  );
}

export function TxnForm({ t, onClose, onSaved }) {
  const [f, setF] = useState({ ...t, amount: t.amount ?? '' });
  const accs = useLoad(() => get('/accounts'), []);
  const cats = useLoad(() => get('/cash/categories'), []);
  const a = useAction();
  const save = (e) => {
    e.preventDefault();
    a.run(async () => { const r = f.id ? await put(`/cash/txns/${f.id}`, f) : await post('/cash/txns', f); onSaved(f.id ? { id: f.id } : r); });
  };
  const activeAccs = (accs.data || []).filter((x) => x.active || x.id === f.account_id || x.id === f.to_account_id);
  return (
    <Modal title={`${f.id ? 'Edit' : 'Catat'} transaksi kas`} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tanggal"><input type="date" className="inp" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
          <Field label="Jenis"><select className="inp" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, category_id: '' })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label={f.kind === 'transfer' ? 'Dari rekening' : OUT.includes(f.kind) ? 'Keluar dari rekening' : 'Masuk ke rekening'}>
            <select className="inp" value={f.account_id} onChange={(e) => setF({ ...f, account_id: Number(e.target.value) || '' })} required><option value="">— pilih —</option>{activeAccs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </Field>
          {f.kind === 'transfer' ? (
            <Field label="Ke rekening"><select className="inp" value={f.to_account_id || ''} onChange={(e) => setF({ ...f, to_account_id: Number(e.target.value) || '' })} required><option value="">— pilih —</option>{activeAccs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          ) : (
            <Field label="Kategori"><select className="inp" value={f.category_id || ''} onChange={(e) => setF({ ...f, category_id: Number(e.target.value) || '' })} required><option value="">— pilih —</option>{(cats.data || []).filter((c) => c.kind === f.kind && (c.active || c.id === f.category_id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          )}
          <Field label="Nominal"><NumInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
          <Field label="Referensi"><input className="inp" value={f.reference || ''} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <Field label="Keterangan" className="col-span-2"><input className="inp" value={f.note || ''} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
        <ErrorBox error={a.error} />
        <div className="flex gap-2"><button className="btn-primary" disabled={a.busy}>Simpan</button><button type="button" className="btn-ghost" onClick={onClose}>Batal</button></div>
      </form>
    </Modal>
  );
}

function Master() {
  const { perms } = useAuth();
  const accs = useLoad(() => get('/accounts'), []);
  const cats = useLoad(() => get('/cash/categories'), []);
  const [acc, setAcc] = useState(null);
  const [cat, setCat] = useState(null);
  const a = useAction();
  const saveAcc = (e) => { e.preventDefault(); a.run(async () => { acc.id ? await put(`/accounts/${acc.id}`, acc) : await post('/accounts', acc); setAcc(null); accs.reload(); }); };
  const saveCat = (e) => { e.preventDefault(); a.run(async () => { cat.id ? await put(`/cash/categories/${cat.id}`, cat) : await post('/cash/categories', cat); setCat(null); cats.reload(); }); };
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="card">
        <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Rekening</h3>
          {perms.cash && <button className="btn-primary py-1 text-xs" onClick={() => setAcc({ name: '', type: 'bank', bank: 'BCA', account_no: '', opening_balance: 0, opening_date: today(), sort_order: 10, active: 1 })}>+ Rekening</button>}</div>
        <table className="sheet w-full border-collapse">
          <thead><tr><th>Nama</th><th>Jenis</th><th>No. rekening</th><th>Saldo awal</th><th>Per tanggal</th></tr></thead>
          <tbody>{(accs.data || []).map((x) => (
            <tr key={x.id} className={`${perms.cash ? 'cursor-pointer hover:bg-sky-50' : ''} ${x.active ? '' : 'text-slate-400'}`} onClick={() => perms.cash && setAcc({ ...x, opening_date: x.opening_date || '' })}>
              <td className="font-medium">{x.name}</td><td>{x.type === 'bank' ? x.bank || 'Bank' : 'Kas'}</td><td>{x.account_no}</td><td className="text-right">{rp(x.opening_balance)}</td><td>{tgl(x.opening_date) || '—'}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <div className="card">
        <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Kategori</h3>
          {perms.cash && <button className="btn-primary py-1 text-xs" onClick={() => setCat({ kind: 'biaya', name: '', active: 1 })}>+ Kategori</button>}</div>
        <table className="sheet w-full border-collapse">
          <thead><tr><th>Jenis</th><th>Nama</th><th>Status</th></tr></thead>
          <tbody>{(cats.data || []).map((c) => (
            <tr key={c.id} className={perms.cash ? 'cursor-pointer hover:bg-sky-50' : ''} onClick={() => perms.cash && setCat(c)}>
              <td>{KIND[c.kind]}</td><td className="font-medium">{c.name}</td><td>{c.active ? 'Aktif' : <span className="text-slate-400">Nonaktif</span>}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {acc && (
        <Modal title={acc.id ? `Edit ${acc.name}` : 'Tambah rekening'} onClose={() => setAcc(null)}>
          <form onSubmit={saveAcc} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Nama (mis. BCA Operasional)" className="col-span-2"><input className="inp" value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} required /></Field>
              <Field label="Jenis"><select className="inp" value={acc.type} onChange={(e) => setAcc({ ...acc, type: e.target.value })}><option value="kas">Kas tunai</option><option value="bank">Bank</option></select></Field>
              {acc.type === 'bank' && <Field label="Bank"><select className="inp" value={acc.bank || ''} onChange={(e) => setAcc({ ...acc, bank: e.target.value })}>{['BCA', 'BNI', 'Mandiri', 'BRI', 'Lainnya'].map((b) => <option key={b}>{b}</option>)}</select></Field>}
              {acc.type === 'bank' && <Field label="No. rekening" className="col-span-2"><input className="inp" value={acc.account_no || ''} onChange={(e) => setAcc({ ...acc, account_no: e.target.value })} /></Field>}
              <Field label="Saldo awal"><NumInput value={acc.opening_balance} onChange={(v) => setAcc({ ...acc, opening_balance: v })} /></Field>
              <Field label="Per tanggal"><input type="date" className="inp" value={acc.opening_date || ''} onChange={(e) => setAcc({ ...acc, opening_date: e.target.value })} /></Field>
            </div>
            <p className="text-xs text-slate-500">Saldo awal = saldo di awal tanggal tersebut. Transaksi sebelum tanggal ini tidak dihitung lagi, karena sudah termasuk di saldo awal.</p>
            {acc.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(acc.active)} onChange={(e) => setAcc({ ...acc, active: e.target.checked ? 1 : 0 })} /> Aktif</label>}
            <ErrorBox error={a.error} />
            <button className="btn-primary" disabled={a.busy}>Simpan</button>
          </form>
        </Modal>
      )}
      {cat && (
        <Modal title={cat.id ? 'Edit kategori' : 'Tambah kategori'} onClose={() => setCat(null)}>
          <form onSubmit={saveCat} className="space-y-3">
            {!cat.id && <Field label="Jenis"><select className="inp" value={cat.kind} onChange={(e) => setCat({ ...cat, kind: e.target.value })}>{['biaya', 'pemasukan', 'modal', 'prive'].map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select></Field>}
            <Field label="Nama"><input className="inp" value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} required /></Field>
            {cat.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(cat.active)} onChange={(e) => setCat({ ...cat, active: e.target.checked ? 1 : 0 })} /> Aktif</label>}
            <ErrorBox error={a.error} />
            <button className="btn-primary" disabled={a.busy}>Simpan</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
