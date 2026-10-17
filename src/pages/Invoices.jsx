// Tampilan format sheet: Tanggal | No Inv | Nama | (Qty, Harga) per barang | Total | Tgl Byr | Dibayar | Sisa | Status | Keterangan
import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get, qs } from '../api';
import { ErrorBox, PageTitle, StatusBadge, useAuth, useLoad } from '../components/ui';
import { firstOfMonth, qty, rp, tgl, today, STATUS } from '../format';
import { downloadXlsx, xlDate } from '../lib/excel';

const ROW_BG = { lunas: 'bg-green-50', sebagian: 'bg-amber-50', belum: '', lebih_bayar: 'bg-purple-50' };

export default function InvoicesPage({ kind }) {
  const { perms } = useAuth();
  const nav = useNavigate();
  const isSale = kind === 'sale';
  const [f, setF] = useState({ from: firstOfMonth(), to: today(), status: '', q: '' });
  const items = useLoad(() => get('/items'), []);
  const list = useLoad(() => get('/invoices' + qs({ kind, ...f })), [kind, f.from, f.to, f.status, f.q]);

  const rows = list.data || [];
  // Kolom barang: barang aktif + barang yang muncul di data (kalau sudah nonaktif).
  const cols = useMemo(() => {
    const used = new Set(rows.flatMap((r) => r.lines.map((l) => l.item_id)));
    return (items.data || []).filter((i) => i.active || used.has(i.id));
  }, [items.data, rows]);

  const cell = (r, itemId, colUnit) => {
    const ls = r.lines.filter((l) => l.item_id === itemId);
    if (!ls.length) return [null, null, false];
    const units = [...new Set(ls.map((l) => l.unit_name))];
    const prices = [...new Set(ls.map((l) => l.price))];
    const q = ls.reduce((s, l) => s + l.qty, 0);
    return [`${qty(q)}${units.length === 1 && units[0] !== colUnit ? ' ' + units[0] : ''}`, prices.length === 1 ? rp(prices[0]) : 'campur', prices.length === 1 && prices[0] === 0];
  };
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);

  // Export dengan susunan sama seperti sheet lama: 2 baris header, pasangan (qty, Harga) per barang.
  const exportExcel = () => {
    const head1 = ['Tanggal', isSale ? 'No Inv' : 'No Nota', 'Nama', ...cols.flatMap((c) => [c.name, '']), 'Total', 'Tgl Byr', 'Nominal', 'Sisa', 'Status', 'Keterangan'];
    const head2 = ['', '', '', ...cols.flatMap((c) => [c.unit_name, 'Harga']), '', '', '', '', '', ''];
    const body = rows.map((r) => [
      xlDate(r.date), r.number, r.party_name,
      ...cols.flatMap((c) => {
        const ls = r.lines.filter((l) => l.item_id === c.id);
        if (!ls.length) return ['', ''];
        const prices = [...new Set(ls.map((l) => l.price))];
        return [ls.reduce((a, l) => a + l.qty, 0), prices.length === 1 ? prices[0] : 'campur'];
      }),
      r.total, xlDate(r.last_paid), r.paid || '', r.outstanding || '', STATUS[r.status]?.label || r.status, [r.po_ref, r.notes].filter(Boolean).join(' | '),
    ]);
    const n = 3 + cols.length * 2;
    const merges = [
      ...[0, 1, 2].map((c) => ({ s: { r: 0, c }, e: { r: 1, c } })),
      ...cols.map((_, i) => ({ s: { r: 0, c: 3 + i * 2 }, e: { r: 0, c: 4 + i * 2 } })),
      ...[0, 1, 2, 3, 4, 5].map((k) => ({ s: { r: 0, c: n + k }, e: { r: 1, c: n + k } })),
    ];
    const widths = [10, 8, 26, ...cols.flatMap(() => [8, 10]), 13, 10, 13, 13, 12, 40];
    downloadXlsx(`${isSale ? 'Penjualan' : 'Pembelian'} ${f.from} sd ${f.to}.xlsx`, [{ name: isSale ? 'Penjualan' : 'Pembelian', aoa: [head1, head2, ...body], merges, widths }]);
  };

  return (
    <div>
      <PageTitle right={<>
        <button className="btn-ghost" onClick={exportExcel} disabled={!rows.length}>⬇ Excel</button>
        {perms.invoice && <Link className="btn-primary" to={isSale ? '/penjualan/baru' : '/pembelian/baru'}>+ {isSale ? 'Invoice Penjualan' : 'Nota Pembelian'}</Link>}
      </>}>
        {isSale ? 'Penjualan' : 'Pembelian'}
      </PageTitle>
      <div className="card mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <label><span className="lbl">Dari</span><input type="date" className="inp" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label><span className="lbl">Sampai</span><input type="date" className="inp" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <label><span className="lbl">Status</span>
          <select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">Semua</option>
            <option value="open">Belum lunas (semua)</option>
            <option value="belum">Belum bayar</option>
            <option value="sebagian">Sebagian</option>
            <option value="lunas">Lunas</option>
            <option value="lebih_bayar">Lebih bayar</option>
            <option value="selisih">⚠ Ada selisih / harga kosong</option>
          </select>
        </label>
        <label className="col-span-2"><span className="lbl">Cari (no, nama, PO, catatan)</span><input className="inp" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></label>
      </div>
      <ErrorBox error={list.error || items.error} />
      <div className="overflow-x-auto rounded border border-slate-300 bg-white">
        <table className="sheet w-full border-collapse">
          <thead className="sticky top-0">
            <tr>
              <th rowSpan={2}>Tanggal</th><th rowSpan={2}>No {isSale ? 'Inv' : 'Nota'}</th><th rowSpan={2}>{isSale ? 'Customer' : 'Supplier'}</th>
              {cols.map((c) => <th key={c.id} colSpan={2}>{c.name}</th>)}
              <th rowSpan={2}>Total</th><th rowSpan={2}>Tgl Byr</th><th rowSpan={2}>Dibayar</th><th rowSpan={2}>Sisa</th><th rowSpan={2}>Status</th><th rowSpan={2}>Keterangan</th>
            </tr>
            <tr>{cols.flatMap((c) => [<th key={c.id + 'q'}>{c.unit_name}</th>, <th key={c.id + 'h'}>Harga</th>])}</tr>
          </thead>
          <tbody>
            {list.loading && !rows.length && <tr><td colSpan={9 + cols.length * 2} className="p-3 text-center text-slate-500">Memuat…</td></tr>}
            {!list.loading && !rows.length && <tr><td colSpan={9 + cols.length * 2} className="p-3 text-center text-slate-500">Tidak ada data pada filter ini</td></tr>}
            {rows.map((r) => {
              const warn = r.diffOpen || r.zeroPriceLines > 0;
              return (
                <tr key={r.id} className={`cursor-pointer hover:bg-sky-50 ${ROW_BG[r.status]}`} onClick={() => nav(`/invoice/${r.id}`)}>
                  <td>{tgl(r.date)}</td>
                  <td className="font-medium">{r.number}</td>
                  <td>{r.party_name}</td>
                  {cols.flatMap((c) => {
                    const [q, h, zero] = cell(r, c.id, c.unit_name);
                    return [<td key={c.id + 'q'} className="text-right">{q}</td>, <td key={c.id + 'h'} className={`text-right ${zero ? 'bg-red-100 font-semibold text-red-700' : ''}`}>{zero ? 'kosong' : h}</td>];
                  })}
                  <td className="text-right font-semibold">{rp(r.total)}</td>
                  <td>{tgl(r.last_paid)}</td>
                  <td className="text-right">{rp(r.paid || '')}</td>
                  <td className={`text-right ${r.outstanding ? 'font-semibold' : ''}`}>{rp(r.outstanding || '')}</td>
                  <td><StatusBadge status={r.status} />{warn && <span title={r.diffOpen ? `Selisih total sheet ${rp(r.importDiff)} belum dijustifikasi` : 'Ada harga kosong'} className="ml-1 text-red-600">⚠</span>}</td>
                  <td className="max-w-[280px] truncate" title={[r.po_ref, r.notes].filter(Boolean).join(' | ')}>{[r.po_ref, r.notes].filter(Boolean).join(' | ')}</td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-100 font-semibold">
                <td colSpan={3}>{rows.length} {isSale ? 'invoice' : 'nota'}</td>
                {cols.flatMap((c) => {
                  const ls = rows.flatMap((r) => r.lines.filter((l) => l.item_id === c.id));
                  const units = [...new Set(ls.map((l) => l.unit_name))];
                  return [<td key={c.id + 'q'} className="text-right">{ls.length ? (units.length === 1 ? qty(ls.reduce((s, l) => s + l.qty, 0)) : 'campur') : ''}</td>, <td key={c.id + 'h'} />];
                })}
                <td className="text-right">{rp(sum('total'))}</td><td /><td className="text-right">{rp(sum('paid'))}</td><td className="text-right">{rp(sum('outstanding'))}</td><td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Klik baris untuk detail, pembayaran, retur, dan pembulatan. Warna baris: hijau = lunas, kuning = sebagian, ungu = lebih bayar. ⚠ = selisih total sheet belum dijustifikasi / ada harga kosong.</p>
    </div>
  );
}
