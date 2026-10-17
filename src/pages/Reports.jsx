import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, qs } from '../api';
import { ErrorBox, PageTitle, useLoad } from '../components/ui';
import { addDays, qty, rp, tgl, today } from '../format';
import { downloadXlsx, xlDate } from '../lib/excel';

const TABS = [['piutang', 'Umur Piutang'], ['hutang', 'Umur Hutang'], ['margin', 'Margin'], ['stok', 'Info Stok']];

export default function ReportsPage() {
  const [tab, setTab] = useState('piutang');
  return (
    <div>
      <PageTitle>Laporan</PageTitle>
      <div className="mb-3 flex gap-1 overflow-x-auto border-b">
        {TABS.map(([k, v]) => <button key={k} className={`whitespace-nowrap px-3 py-1.5 text-sm ${tab === k ? 'border-b-2 border-brand-600 font-semibold' : 'text-slate-600'}`} onClick={() => setTab(k)}>{v}</button>)}
      </div>
      {tab === 'piutang' && <Aging kind="sale" />}
      {tab === 'hutang' && <Aging kind="purchase" />}
      {tab === 'margin' && <Margin />}
      {tab === 'stok' && <Stock />}
    </div>
  );
}

const BUCKETS = [['belum_jatuh_tempo', 'Belum jatuh tempo'], ['d1_30', '1–30 hr'], ['d31_60', '31–60 hr'], ['d61_90', '61–90 hr'], ['d90_plus', '> 90 hr']];

function Aging({ kind }) {
  const [asOf, setAsOf] = useState(today());
  const [open, setOpen] = useState(null);
  const r = useLoad(() => get('/reports/aging' + qs({ kind, as_of: asOf })), [kind, asOf]);
  const d = r.data;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label><span className="lbl">Per tanggal</span><input type="date" className="inp" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
        <button className="btn-ghost" disabled={!d?.rows.length} onClick={() => downloadXlsx(`Umur ${kind === 'sale' ? 'Piutang' : 'Hutang'} ${asOf}.xlsx`, [{
          name: kind === 'sale' ? 'Piutang' : 'Hutang', widths: [28, 10, 11, 11, ...BUCKETS.map(() => 14), 14],
          aoa: [[kind === 'sale' ? 'Customer' : 'Supplier', 'No', 'Tanggal', 'Jatuh tempo', ...BUCKETS.map(([, v]) => v), 'Sisa'],
            ...d.rows.flatMap((x) => x.invoices.map((i) => [x.party_name, i.number, xlDate(i.date), xlDate(i.due_date), ...BUCKETS.map(([k]) => (i.bucket === k ? i.outstanding : '')), i.outstanding])),
            ['Total', '', '', '', ...BUCKETS.map(([k]) => d.totals[k]), d.totals.total]],
        }])}>⬇ Excel</button>
      </div>
      <ErrorBox error={r.error} />
      {d && (
        <div className="overflow-x-auto rounded border border-slate-300 bg-white">
          <table className="sheet w-full border-collapse">
            <thead><tr><th>{kind === 'sale' ? 'Customer' : 'Supplier'}</th>{BUCKETS.map(([k, v]) => <th key={k}>{v}</th>)}<th>Total sisa</th><th>Saldo bayar belum dialokasi</th></tr></thead>
            <tbody>
              {!d.rows.length && <tr><td colSpan={8} className="p-3 text-center text-slate-500">Tidak ada {kind === 'sale' ? 'piutang' : 'hutang'} 🎉</td></tr>}
              {d.rows.map((x) => (
                <React.Fragment key={x.party_id}>
                  <tr className="cursor-pointer hover:bg-sky-50" onClick={() => setOpen(open === x.party_id ? null : x.party_id)}>
                    <td className="font-medium">{open === x.party_id ? '▾' : '▸'} {x.party_name}</td>
                    {BUCKETS.map(([k]) => <td key={k} className={`text-right ${k === 'd90_plus' && x[k] ? 'bg-red-100 font-semibold' : k === 'd61_90' && x[k] ? 'bg-orange-50' : ''}`}>{x[k] ? rp(x[k]) : ''}</td>)}
                    <td className="text-right font-semibold">{rp(x.total)}</td>
                    <td className="text-right text-amber-700">{x.unallocated ? rp(x.unallocated) : ''}</td>
                  </tr>
                  {open === x.party_id && x.invoices.map((i) => (
                    <tr key={i.id} className="bg-slate-50 text-slate-600">
                      <td className="pl-6"><Link className="text-sky-700 underline" to={`/invoice/${i.id}`}>{i.number}</Link> · {tgl(i.date)} · jt {tgl(i.due_date)}</td>
                      {BUCKETS.map(([k]) => <td key={k} className="text-right">{i.bucket === k ? rp(i.outstanding) : ''}</td>)}
                      <td className="text-right">{rp(i.outstanding)}</td><td />
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
            <tfoot><tr className="bg-slate-100 font-semibold"><td>Total</td>{BUCKETS.map(([k]) => <td key={k} className="text-right">{rp(d.totals[k])}</td>)}<td className="text-right">{rp(d.totals.total)}</td><td className="text-right">{rp(d.totals.unallocated)}</td></tr></tfoot>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">Umur dihitung dari tanggal jatuh tempo (tanggal invoice + termin di master). Klik baris untuk melihat invoice-nya.</p>
    </div>
  );
}

function Range({ v, set }) {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      <label><span className="lbl">Dari</span><input type="date" className="inp" value={v.from} onChange={(e) => set({ ...v, from: e.target.value })} /></label>
      <label><span className="lbl">Sampai</span><input type="date" className="inp" value={v.to} onChange={(e) => set({ ...v, to: e.target.value })} /></label>
    </div>
  );
}

function Margin() {
  const [v, set] = useState({ from: addDays(today(), -30), to: today() });
  const [by, setBy] = useState('byParty');
  const r = useLoad(() => get('/reports/margin' + qs(v)), [v.from, v.to]);
  const d = r.data;
  const sumOf = (rows, k) => rows.reduce((s, x) => s + x[k], 0);
  return (
    <div>
      <Range v={v} set={set} />
      <ErrorBox error={r.error} />
      {d && (<>
        <div className="mb-2 flex gap-2 text-sm">
          {[['byParty', 'Per customer'], ['byDate', 'Per hari'], ['rows', 'Per invoice']].map(([k, t]) => <button key={k} className={k === by ? 'btn-primary' : 'btn-ghost'} onClick={() => setBy(k)}>{t}</button>)}
        </div>
        <div className="overflow-x-auto rounded border border-slate-300 bg-white">
          <table className="sheet w-full border-collapse">
            <thead><tr><th>{by === 'rows' ? 'Invoice' : by === 'byDate' ? 'Tanggal' : 'Customer'}</th><th>Penjualan</th><th>Penjualan berharga beli</th><th>Modal</th><th>Margin</th><th>Margin %</th><th>Baris tanpa harga beli</th></tr></thead>
            <tbody>
              {d[by].map((x) => (
                <tr key={x.id || x.key}>
                  <td>{by === 'rows' ? <Link className="text-sky-700 underline" to={`/invoice/${x.id}`}>{x.number} · {x.party_name} · {tgl(x.date)}</Link> : by === 'byDate' ? tgl(x.key) : x.key}</td>
                  <td className="text-right">{rp(x.total)}</td><td className="text-right">{rp(x.salesCosted)}</td><td className="text-right">{rp(x.cost)}</td>
                  <td className={`text-right font-semibold ${x.margin < 0 ? 'text-red-600' : ''}`}>{rp(x.margin)}</td>
                  <td className="text-right">{x.salesCosted ? `${(x.margin / x.salesCosted * 100).toFixed(1)}%` : ''}</td>
                  <td className={`text-right ${x.missingCost ? 'text-amber-700' : ''}`}>{x.missingCost || ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-slate-100 font-semibold"><td>Total</td><td className="text-right">{rp(sumOf(d.rows, 'total'))}</td><td className="text-right">{rp(sumOf(d.rows, 'salesCosted'))}</td><td className="text-right">{rp(sumOf(d.rows, 'cost'))}</td><td className="text-right">{rp(sumOf(d.rows, 'margin'))}</td><td /><td className="text-right">{sumOf(d.rows, 'missingCost') || ''}</td></tr></tfoot>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">Margin hanya dihitung dari baris yang harga belinya diisi. Baris tanpa harga beli tidak masuk modal maupun margin, dan jumlahnya ditampilkan di kolom terakhir.</p>
      </>)}
    </div>
  );
}

function Stock() {
  const [v, set] = useState({ from: addDays(today(), -7), to: today() });
  const r = useLoad(() => get('/reports/stock' + qs(v)), [v.from, v.to]);
  return (
    <div>
      <Range v={v} set={set} />
      <ErrorBox error={r.error} />
      <p className="mb-2 rounded bg-sky-50 p-2 text-xs text-sky-800">Info saja: pembelian (masuk) dikurangi penjualan (keluar). Target sisa akhir 0. Sisa bukan 0 berarti ada susut, retur, atau transaksi yang belum dicatat. Satuan yang punya konversi kg (mis. ikat = 15 kg) dihitung dalam kg.</p>
      {r.data && (
        <div className="overflow-x-auto rounded border border-slate-300 bg-white">
          <table className="sheet w-full border-collapse">
            <thead><tr><th>Barang</th><th>Satuan</th><th>Sisa awal</th><th>Masuk</th><th>Keluar</th><th>Sisa akhir</th></tr></thead>
            <tbody>
              {!r.data.items.length && <tr><td colSpan={6} className="p-3 text-center text-slate-500">Tidak ada transaksi</td></tr>}
              {r.data.items.map((x) => (
                <tr key={x.item + x.unit}>
                  <td className="font-medium">{x.item}</td><td>{x.unit}</td><td className="text-right">{qty(x.opening)}</td><td className="text-right">{qty(x.in)}</td><td className="text-right">{qty(x.out)}</td>
                  <td className={`text-right font-semibold ${Math.abs(x.closing) > 0.0005 ? 'bg-amber-100 text-amber-800' : 'text-green-700'}`}>{qty(x.closing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
