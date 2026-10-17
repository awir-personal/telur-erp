import React, { useState } from 'react';
import { get, qs } from '../api';
import PaymentForm from '../components/PaymentForm';
import { ErrorBox, PageTitle, useAuth, useLoad } from '../components/ui';
import { METHOD, firstOfMonth, rp, tgl, today } from '../format';

export default function PaymentsPage({ kind }) {
  const { perms } = useAuth();
  const isSale = kind === 'sale';
  const [f, setF] = useState({ from: firstOfMonth(), to: today(), unallocated: '' });
  const [modal, setModal] = useState(null);
  const list = useLoad(() => get('/payments' + qs({ kind, ...f })), [kind, f.from, f.to, f.unallocated]);
  const rows = list.data || [];

  return (
    <div>
      <PageTitle right={perms.payment && <button className="btn-primary" onClick={() => setModal({})}>+ {isSale ? 'Catat penerimaan' : 'Catat pembayaran'}</button>}>
        {isSale ? 'Penerimaan dari Customer' : 'Pembayaran ke Supplier'}
      </PageTitle>
      <div className="card mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label><span className="lbl">Dari</span><input type="date" className="inp" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label><span className="lbl">Sampai</span><input type="date" className="inp" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <label className="col-span-2 flex items-end gap-2 pb-1.5 text-sm"><input type="checkbox" checked={f.unallocated === '1'} onChange={(e) => setF({ ...f, unallocated: e.target.checked ? '1' : '' })} /> Hanya yang masih ada saldo belum dialokasi</label>
      </div>
      <ErrorBox error={list.error} />
      <div className="overflow-x-auto rounded border border-slate-300 bg-white">
        <table className="sheet w-full border-collapse">
          <thead><tr><th>Tgl bayar</th><th>{isSale ? 'Customer' : 'Supplier'}</th><th>Metode</th><th>Referensi</th><th>Nominal</th><th>Teralokasi</th><th>Belum dialokasi</th><th>Dicatat oleh</th><th>Catatan</th></tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={9} className="p-3 text-center text-slate-500">{list.loading ? 'Memuat…' : 'Tidak ada data'}</td></tr>}
            {rows.map((p) => (
              <tr key={p.id} className={`hover:bg-sky-50 ${perms.payment ? 'cursor-pointer' : ''}`} onClick={() => perms.payment && setModal({ paymentId: p.id, partyId: p.party_id })}>
                <td>{tgl(p.date)}</td><td>{p.party_name}</td><td>{METHOD[p.method]}</td><td>{p.reference}</td>
                <td className="text-right font-semibold">{rp(p.amount)}</td><td className="text-right">{rp(p.allocated)}</td>
                <td className={`text-right ${p.unallocated ? 'bg-amber-100 font-semibold text-amber-800' : ''}`}>{p.unallocated ? rp(p.unallocated) : ''}</td>
                <td>{p.created_by_name}</td><td className="max-w-[260px] truncate" title={p.notes || ''}>{p.notes}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && <tfoot><tr className="bg-slate-100 font-semibold"><td colSpan={4}>{rows.length} pembayaran</td>
            <td className="text-right">{rp(rows.reduce((s, p) => s + p.amount, 0))}</td><td className="text-right">{rp(rows.reduce((s, p) => s + p.allocated, 0))}</td>
            <td className="text-right">{rp(rows.reduce((s, p) => s + p.unallocated, 0))}</td><td colSpan={2} /></tr></tfoot>}
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Satu pembayaran bisa dibagi ke beberapa invoice, dan satu invoice bisa dibayar beberapa kali. Saldo belum dialokasi bisa dialokasikan nanti lewat klik baris.</p>
      {modal && <PaymentForm kind={kind} paymentId={modal.paymentId} partyId={modal.partyId} onClose={() => setModal(null)} onSaved={() => { setModal(null); list.reload(); }} />}
    </div>
  );
}
