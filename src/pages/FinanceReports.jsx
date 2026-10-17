// Laporan keuangan: Laba Rugi (HPP periodik + kontrol), Neraca, Arus Kas, Jurnal (+ memorial), Buku Besar.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { del, get, post, qs } from '../api';
import { ErrorBox, Field, Modal, NumInput, useAction, useAuth, useLoad } from '../components/ui';
import { useConfirm } from '../lib/confirm';
import { downloadXlsx, xlDate } from '../lib/excel';
import { firstOfMonth, qty, rp, tgl, today } from '../format';

function Range({ v, set, single }) {
  return (
    <div className="no-print mb-3 flex flex-wrap items-end gap-2">
      {!single && <label><span className="lbl">Dari</span><input type="date" className="inp" value={v.from} onChange={(e) => set({ ...v, from: e.target.value })} /></label>}
      <label><span className="lbl">{single ? 'Per tanggal' : 'Sampai'}</span><input type="date" className="inp" value={v.to} onChange={(e) => set({ ...v, to: e.target.value })} /></label>
      <button className="btn-ghost" onClick={() => window.print()}>🖨 Cetak</button>
    </div>
  );
}
const Line = ({ label, value, bold, indent, neg, border }) => (
  <tr className={border ? 'border-t-2 border-slate-400' : 'border-t border-slate-200'}>
    <td className={`py-1 ${indent ? 'pl-6' : ''} ${bold ? 'font-semibold' : ''}`}>{label}</td>
    <td className={`py-1 text-right ${bold ? 'font-bold' : ''} ${value < 0 ? 'text-red-600' : ''}`}>{neg && value ? `(${rp(Math.abs(value))})` : rp(value)}</td>
  </tr>
);

export function ProfitLoss() {
  const [v, set] = useState({ from: firstOfMonth(), to: today() });
  const r = useLoad(() => get('/reports/profit-loss' + qs(v)), [v.from, v.to]);
  const d = r.data;
  return (
    <div className="max-w-3xl">
      <Range v={v} set={set} />
      <ErrorBox error={r.error} />
      {d && (
        <div className="card">
          <h3 className="mb-2 text-center font-semibold">Laba Rugi {tgl(d.from)} – {tgl(d.to)}</h3>
          <table className="w-full text-sm"><tbody>
            <Line label="Penjualan" value={d.sales} />
            <Line label="Retur, potongan & pembulatan penjualan" value={d.salesAdj} indent neg />
            <Line label="Penjualan bersih" value={d.netSales} bold />
            <Line label="Persediaan awal (estimasi)" value={d.invStart} indent />
            <Line label="Pembelian" value={d.purchases} indent />
            <Line label="Retur, potongan & pembulatan pembelian" value={d.purchAdj} indent neg />
            <Line label="Persediaan akhir (estimasi)" value={d.invEnd} indent neg />
            <Line label="Harga Pokok Penjualan (periodik)" value={d.hpp} bold neg />
            <Line label="Laba kotor" value={d.gross} bold border />
            {d.otherIncome.map((x) => <Line key={x.code} label={x.name} value={x.amount} indent />)}
            {d.expenses.map((x) => <Line key={x.code} label={x.name} value={x.amount} indent neg />)}
            <Line label="Total biaya" value={d.totalExp} neg />
            <Line label="LABA (RUGI) BERSIH" value={d.netIncome} bold border />
          </tbody></table>
          <div className={`mt-4 rounded p-2 text-xs ${Math.abs(d.control.difference) > Math.max(1, d.hpp * 0.02) ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-600'}`}>
            <b>Kontrol HPP:</b> periodik {rp(d.hpp)} vs dari harga beli yang diketik di invoice {rp(d.control.hppTyped)}
            {d.control.linesWithoutCost > 0 && <> ({d.control.linesWithoutCost} dari {d.control.lines} baris tanpa harga beli)</>} → selisih <b>{rp(d.control.difference)}</b>.
            {' '}Selisih besar bisa berarti ada harga beli yang salah ketik, susut/retur yang belum dicatat, atau stok fisik berbeda dari hitungan sistem.
          </div>
          {d.inventory.some((x) => x.negative) && (
            <p className="mt-2 text-xs text-amber-700">⚠ Ada barang dengan stok negatif (penjualan &gt; pembelian tercatat), dinilai 0: {d.inventory.filter((x) => x.negative).map((x) => `${x.item} ${qty(x.qty)} ${x.unit}`).join(', ')}. Biasanya karena nota pembelian belum diinput.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function BalanceSheet() {
  const [v, set] = useState({ to: today() });
  const r = useLoad(() => get('/reports/balance-sheet' + qs({ as_of: v.to })), [v.to]);
  const d = r.data;
  return (
    <div className="max-w-4xl">
      <Range v={v} set={set} single />
      <ErrorBox error={r.error} />
      {d && (
        <div className="card">
          <h3 className="mb-2 text-center font-semibold">Neraca per {tgl(d.asOf)}</h3>
          <div className="grid items-start gap-6 md:grid-cols-2">
            <table className="w-full text-sm"><tbody>
              <tr><td className="pb-1 font-semibold" colSpan={2}>ASET</td></tr>
              {[...d.assets, ...d.unknown].map((x) => <Line key={x.code} label={x.name} value={x.amount} indent />)}
              <Line label="Total aset" value={d.totalAssets} bold border />
            </tbody></table>
            <table className="w-full text-sm"><tbody>
              <tr><td className="pb-1 font-semibold" colSpan={2}>KEWAJIBAN</td></tr>
              {d.liabilities.map((x) => <Line key={x.code} label={x.name} value={x.amount} indent />)}
              <Line label="Total kewajiban" value={d.totalLiabilities} bold />
              <tr><td className="pb-1 pt-3 font-semibold" colSpan={2}>EKUITAS</td></tr>
              {d.equity.map((x) => <Line key={x.code} label={x.name} value={x.amount} indent />)}
              <Line label="Total ekuitas" value={d.totalEquity} bold />
              <Line label="Total kewajiban + ekuitas" value={d.totalLE} bold border />
            </tbody></table>
          </div>
          <p className={`mt-3 text-center text-sm font-semibold ${d.difference ? 'text-red-600' : 'text-green-700'}`}>{d.difference ? `⚠ Tidak seimbang: selisih ${rp(d.difference)}` : '✓ Seimbang'}</p>
          <p className="mt-1 text-xs text-slate-500">Persediaan = sisa qty (pembelian − penjualan) × harga beli rata-rata 60 hari terakhir. "Kas/Bank belum ditentukan" = pembayaran yang rekeningnya belum dipilih.</p>
        </div>
      )}
    </div>
  );
}

export function CashFlow() {
  const [v, set] = useState({ from: firstOfMonth(), to: today() });
  const r = useLoad(() => get('/reports/cashflow' + qs(v)), [v.from, v.to]);
  const d = r.data;
  return (
    <div className="max-w-3xl">
      <Range v={v} set={set} />
      <ErrorBox error={r.error} />
      {d && (
        <div className="card">
          <h3 className="mb-2 text-center font-semibold">Arus Kas {tgl(d.from)} – {tgl(d.to)}</h3>
          <table className="w-full text-sm"><tbody>
            <Line label="Saldo kas & bank awal" value={d.opening} bold />
            {d.rows.map((x) => <Line key={x.label} label={x.label} value={x.amount} indent />)}
            {d.openedInRange ? <Line label="Saldo awal rekening yang dibuka di periode ini" value={d.openedInRange} indent /> : null}
            <Line label="Kenaikan (penurunan) kas" value={d.change} bold />
            <Line label="Saldo kas & bank akhir" value={d.closing} bold border />
          </tbody></table>
          <p className="mt-2 text-xs text-slate-500">Hanya pembayaran yang rekeningnya diisi. Transfer antar rekening sendiri tidak dihitung (net nol).</p>
        </div>
      )}
    </div>
  );
}

const SRC = { invoice: 'Invoice', adjustment: 'Penyesuaian', payment: 'Pembayaran', cash: 'Kas', opening: 'Saldo awal', manual: 'Memorial' };

export function Journal() {
  const { perms } = useAuth();
  const confirm = useConfirm();
  const [v, set] = useState({ from: firstOfMonth(), to: today() });
  const [showForm, setShowForm] = useState(false);
  const r = useLoad(() => get('/reports/journal' + qs(v)), [v.from, v.to]);
  const a = useAction();
  const remove = (e) => a.run(async () => { if (!await confirm(`Hapus jurnal memorial "${e.memo}"?`)) return; await del(`/journals/${e.ref}`); r.reload(); });
  const exportX = () => downloadXlsx(`Jurnal ${v.from} sd ${v.to}.xlsx`, [{ name: 'Jurnal', widths: [11, 12, 50, 12, 36, 15, 15],
    aoa: [['Tanggal', 'Sumber', 'Keterangan', 'Akun', 'Nama akun', 'Debit', 'Kredit'], ...r.data.entries.flatMap((e) => e.lines.map((l) => [xlDate(e.date), SRC[e.src], e.memo, l.coa, l.name, l.debit || '', l.credit || '']))] }]);
  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap items-end gap-2">
        <label><span className="lbl">Dari</span><input type="date" className="inp" value={v.from} onChange={(e) => set({ ...v, from: e.target.value })} /></label>
        <label><span className="lbl">Sampai</span><input type="date" className="inp" value={v.to} onChange={(e) => set({ ...v, to: e.target.value })} /></label>
        <button className="btn-ghost" onClick={exportX} disabled={!r.data}>⬇ Excel</button>
        {perms.cash && <button className="btn-primary" onClick={() => setShowForm(true)}>+ Jurnal memorial</button>}
      </div>
      <p className="mb-2 text-xs text-slate-500">Jurnal dibuat otomatis dari invoice, pembayaran, penyesuaian, dan kas. Jurnal memorial dipakai untuk hal lain (penyusutan, koreksi).</p>
      <ErrorBox error={r.error || a.error} />
      {r.data && (
        <div className="overflow-x-auto rounded border border-slate-300 bg-white">
          <table className="sheet w-full border-collapse">
            <thead><tr><th>Tanggal</th><th>Sumber</th><th>Keterangan</th><th>Akun</th><th>Debit</th><th>Kredit</th></tr></thead>
            <tbody>
              {!r.data.entries.length && <tr><td colSpan={6} className="p-3 text-center text-slate-500">Tidak ada jurnal</td></tr>}
              {r.data.entries.map((e, i) => e.lines.map((l, j) => (
                <tr key={`${i}-${j}`} className={j === 0 ? 'border-t-2 border-slate-300' : ''}>
                  <td>{j === 0 ? tgl(e.date) : ''}</td>
                  <td>{j === 0 ? (e.src === 'invoice' ? <Link className="text-sky-700 underline" to={`/invoice/${e.ref}`}>{SRC[e.src]}</Link> : SRC[e.src]) : ''}</td>
                  <td className="max-w-[360px] truncate">{j === 0 ? <>{e.memo}{e.src === 'manual' && perms.cash && <button className="ml-2 text-red-600 underline" onClick={() => remove(e)}>hapus</button>}</> : ''}</td>
                  <td className={l.credit ? 'pl-6' : ''}>{l.name}</td>
                  <td className="text-right">{l.debit ? rp(l.debit) : ''}</td><td className="text-right">{l.credit ? rp(l.credit) : ''}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
      {showForm && <JournalForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); r.reload(); }} />}
    </div>
  );
}

function JournalForm({ onClose, onSaved }) {
  const coa = useLoad(() => get('/coa'), []);
  const [f, setF] = useState({ date: today(), memo: '', lines: [{ coa: '', debit: '', credit: '' }, { coa: '', debit: '', credit: '' }] });
  const a = useAction();
  const setL = (i, p) => setF({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const d = f.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const c = f.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const save = (e) => { e.preventDefault(); a.run(async () => { await post('/journals', f); onSaved(); }); };
  return (
    <Modal title="Jurnal memorial" onClose={onClose} wide>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Field label="Tanggal"><input type="date" className="inp" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Keterangan" className="col-span-2"><input className="inp" value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} required /></Field>
        </div>
        {f.lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 gap-1">
            <select className="inp col-span-6" value={l.coa} onChange={(e) => setL(i, { coa: e.target.value })}><option value="">— akun —</option>{(coa.data || []).map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name}</option>)}</select>
            <div className="col-span-3"><NumInput placeholder="Debit" value={l.debit} onChange={(v) => setL(i, { debit: v, credit: v ? '' : l.credit })} /></div>
            <div className="col-span-3"><NumInput placeholder="Kredit" value={l.credit} onChange={(v) => setL(i, { credit: v, debit: v ? '' : l.debit })} /></div>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button type="button" className="btn-ghost" onClick={() => setF({ ...f, lines: [...f.lines, { coa: '', debit: '', credit: '' }] })}>+ Baris</button>
          <span className={Math.abs(d - c) < 0.005 && d > 0 ? 'text-green-700' : 'text-red-600'}>Debit {rp(d)} · Kredit {rp(c)}</span>
        </div>
        <ErrorBox error={a.error} />
        <button className="btn-primary" disabled={a.busy}>Simpan</button>
      </form>
    </Modal>
  );
}

export function Ledger() {
  const [v, set] = useState({ from: firstOfMonth(), to: today() });
  const [code, setCode] = useState('');
  const r = useLoad(() => get('/reports/ledger' + qs({ ...v, coa: code })), [v.from, v.to, code]);
  const d = r.data;
  return (
    <div>
      <Range v={v} set={set} />
      <ErrorBox error={r.error} />
      {d && (
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="overflow-x-auto rounded border border-slate-300 bg-white">
            <table className="sheet w-full border-collapse">
              <thead><tr><th>Akun</th><th>Saldo awal</th><th>Debit</th><th>Kredit</th><th>Saldo akhir</th></tr></thead>
              <tbody>
                {d.trial.map((x) => (
                  <tr key={x.code} className={`cursor-pointer hover:bg-sky-50 ${code === x.code ? 'bg-sky-50 font-semibold' : ''}`} onClick={() => setCode(x.code)}>
                    <td>{x.code} · {x.name}</td><td className="text-right">{rp(x.opening)}</td><td className="text-right">{rp(x.debit)}</td><td className="text-right">{rp(x.credit)}</td><td className="text-right">{rp(x.closing)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="bg-slate-100 font-semibold"><td>Total mutasi</td><td /><td className="text-right">{rp(d.totals.debit)}</td><td className="text-right">{rp(d.totals.credit)}</td><td className={d.totals.debit === d.totals.credit ? 'text-green-700' : 'text-red-600'}>{d.totals.debit === d.totals.credit ? '✓ seimbang' : '⚠ tidak seimbang'}</td></tr></tfoot>
            </table>
            <p className="p-2 text-xs text-slate-500">Saldo = debit − kredit (akun kewajiban, ekuitas & pendapatan normalnya negatif). Klik akun untuk buku besarnya.</p>
          </div>
          {d.detail && (
            <div className="overflow-x-auto rounded border border-slate-300 bg-white">
              <table className="sheet w-full border-collapse">
                <thead><tr><th colSpan={5}>Buku besar: {d.detail.coa} · {d.detail.name}</th></tr><tr><th>Tanggal</th><th>Keterangan</th><th>Debit</th><th>Kredit</th><th>Saldo</th></tr></thead>
                <tbody>
                  <tr className="bg-slate-50"><td /><td>Saldo awal</td><td /><td /><td className="text-right">{rp(d.detail.opening)}</td></tr>
                  {d.detail.rows.map((x, i) => <tr key={i}><td>{tgl(x.date)}</td><td className="max-w-[300px] truncate">{x.memo}</td><td className="text-right">{x.debit ? rp(x.debit) : ''}</td><td className="text-right">{x.credit ? rp(x.credit) : ''}</td><td className="text-right">{rp(x.balance)}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
