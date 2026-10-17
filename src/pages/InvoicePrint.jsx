// Invoice siap cetak. PDF: tombol Cetak → pilih "Simpan sebagai PDF" di dialog cetak browser/HP.
import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get } from '../api';
import { ErrorBox, useLoad } from '../components/ui';
import { METHOD, qty, rp, tgl } from '../format';

export default function InvoicePrint() {
  const { id } = useParams();
  const nav = useNavigate();
  const inv = useLoad(() => get(`/invoices/${id}`), [id]);
  const st = useLoad(() => get('/settings'), []);
  if (inv.error || st.error) return <ErrorBox error={inv.error || st.error} />;
  if (!inv.data || !st.data) return <p className="text-sm text-slate-500">Memuat…</p>;
  const d = inv.data;
  const s = st.data;
  const isSale = d.kind === 'sale';

  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => window.print()}>🖨 Cetak / Simpan PDF</button>
        <button className="btn-ghost" onClick={() => nav(-1)}>Kembali</button>
        <span className="self-center text-xs text-slate-500">Untuk PDF: pada dialog cetak pilih "Simpan sebagai PDF".</span>
      </div>
      {/* Selalu putih-hitam seperti kertas, termasuk di mode gelap. */}
      <div className="mx-auto max-w-3xl rounded-lg border border-slate-300 p-8 text-sm text-black print:max-w-none print:border-0 print:p-0" style={{ background: '#fff', color: '#000' }}>
        <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
          <div>
            <div className="text-xl font-bold">{s.company_name}</div>
            {s.company_address && <div className="whitespace-pre-line">{s.company_address}</div>}
            {s.company_phone && <div>Telp: {s.company_phone}</div>}
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tracking-wide">{isSale ? 'INVOICE' : 'NOTA PEMBELIAN'}</div>
            <div>No: <b>{d.number}</b></div>
          </div>
        </div>
        <div className="my-4 grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs uppercase" style={{ color: '#555' }}>{isSale ? 'Kepada' : 'Dari supplier'}</div>
            <div className="text-base font-semibold">{d.party_name}</div>
            {d.po_ref && <div>Ref/PO: {d.po_ref}</div>}
          </div>
          <div className="text-right">
            <div>Tanggal: <b>{tgl(d.date)}</b></div>
            <div>Jatuh tempo: <b>{tgl(d.due_date)}</b></div>
          </div>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ background: '#eee' }}>
              {['No', 'Barang', 'Jumlah', 'Satuan', 'Harga', 'Subtotal'].map((h, i) => (
                <th key={h} className={`border border-black px-2 py-1 ${i >= 2 && i !== 3 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l, i) => (
              <tr key={l.id}>
                <td className="border border-black px-2 py-1">{i + 1}</td>
                <td className="border border-black px-2 py-1">{l.item_name}{l.note ? <div className="text-xs">{l.note}</div> : null}</td>
                <td className="border border-black px-2 py-1 text-right">{qty(l.qty)}</td>
                <td className="border border-black px-2 py-1">{l.unit_name}</td>
                <td className="border border-black px-2 py-1 text-right">{rp(l.price)}</td>
                <td className="border border-black px-2 py-1 text-right">{rp(l.qty * l.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex justify-end">
          <table className="min-w-[260px]">
            <tbody>
              <tr><td className="py-0.5 pr-4">Total</td><td className="text-right font-bold">{rp(d.total)}</td></tr>
              {d.adjustments.map((a) => (
                <tr key={a.id}><td className="py-0.5 pr-4">{a.note}</td><td className="text-right">{a.amount > 0 ? '−' : '+'} {rp(Math.abs(a.amount))}</td></tr>
              ))}
              {d.allocations.map((a) => (
                <tr key={a.id}><td className="py-0.5 pr-4">Dibayar {tgl(a.date)} ({METHOD[a.method]})</td><td className="text-right">− {rp(a.amount)}</td></tr>
              ))}
              <tr className="border-t-2 border-black"><td className="py-1 pr-4 font-bold">{d.outstanding < 0 ? 'Lebih bayar' : 'Sisa tagihan'}</td><td className="text-right text-base font-bold">{rp(Math.abs(d.outstanding))}</td></tr>
            </tbody>
          </table>
        </div>
        {d.notes && <p className="mt-3">Catatan: {d.notes}</p>}
        <div className="mt-12 grid grid-cols-2 gap-8 text-center">
          <div>Penerima,<div className="mt-16 border-t border-black pt-1">(.................................)</div></div>
          <div>Hormat kami,<div className="mt-16 border-t border-black pt-1">{s.company_name}</div></div>
        </div>
      </div>
    </div>
  );
}
