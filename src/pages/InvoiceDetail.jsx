import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, get, post, put } from '../api';
import PaymentForm from '../components/PaymentForm';
import { ErrorBox, Field, Modal, NumInput, PageTitle, StatusBadge, useAction, useAuth, useLoad } from '../components/ui';
import { useConfirm } from '../lib/confirm';
import { ADJ, METHOD, qty, rp, tgl, today } from '../format';

export default function InvoiceDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { perms } = useAuth();
  const inv = useLoad(() => get(`/invoices/${id}`), [id]);
  const [payModal, setPayModal] = useState(null); // {paymentId?}
  const [adjModal, setAdjModal] = useState(false);
  const [diffNote, setDiffNote] = useState(null);
  const a = useAction();
  const confirm = useConfirm();

  if (inv.error) return <ErrorBox error={inv.error} />;
  if (!inv.data) return <p className="text-sm text-slate-500">Memuat…</p>;
  const d = inv.data;
  const isSale = d.kind === 'sale';
  const reload = () => inv.reload();
  const note = diffNote ?? d.diff_note ?? '';

  const roundIt = () => a.run(async () => {
    if (!await confirm(`Bulatkan sisa ${rp(d.outstanding)} jadi 0? Akan dicatat sebagai penyesuaian "Pembulatan".`, { danger: false, confirmLabel: 'Bulatkan' })) return;
    await post(`/invoices/${id}/round`, { date: today() });
    reload();
  });
  const saveDiffNote = () => a.run(async () => { await put(`/invoices/${id}/diff-note`, { diff_note: note }); setDiffNote(null); reload(); });
  const acceptSheet = () => a.run(async () => {
    if (!note.trim()) throw new Error('Isi alasan selisih dulu di kotak justifikasi');
    await post(`/invoices/${id}/accept-import-total`, { note });
    setDiffNote(null); reload();
  });
  const removeInvoice = () => a.run(async () => {
    if (!await confirm(`Hapus ${isSale ? 'invoice' : 'nota'} ${d.number}? Tidak bisa dibatalkan (tetap tercatat di log).`)) return;
    await del(`/invoices/${id}`);
    nav(isSale ? '/penjualan' : '/pembelian', { replace: true });
  });
  const removeAdj = (adj) => a.run(async () => {
    if (!await confirm(`Hapus penyesuaian ${ADJ[adj.type]} ${rp(adj.amount)}?`)) return;
    await del(`/adjustments/${adj.id}`); reload();
  });

  return (
    <div className="space-y-3">
      <PageTitle right={<>
        {perms.payment && d.outstanding > 0 && <button className="btn-primary" onClick={() => setPayModal({})}>+ Catat {isSale ? 'uang masuk' : 'uang keluar'}</button>}
        <Link className="btn-ghost" to={`/invoice/${id}/cetak`}>🖨 Cetak / PDF</Link>
        {perms.invoice && <Link className="btn-ghost" to={`/invoice/${id}/edit`}>Edit</Link>}
        {perms.invoice && d.paid === 0 && <button className="btn-ghost text-red-600" onClick={removeInvoice}>Hapus</button>}
      </>}>
        {isSale ? 'Invoice' : 'Nota beli'} {d.number} <StatusBadge status={d.status} />
      </PageTitle>
      <ErrorBox error={a.error} />

      <div className="grid gap-3 md:grid-cols-3">
        <div className="card text-sm md:col-span-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            <div><span className="lbl">{isSale ? 'Customer' : 'Supplier'}</span>{d.party_name}</div>
            <div><span className="lbl">Tanggal</span>{tgl(d.date)}</div>
            <div><span className="lbl">Jatuh tempo</span>{tgl(d.due_date)}</div>
            <div><span className="lbl">PO / referensi</span>{d.po_ref || '—'}</div>
            <div className="col-span-2"><span className="lbl">Keterangan</span>{d.notes || '—'}</div>
          </div>
        </div>
        <div className="card text-sm">
          <Row k="Total" v={rp(d.total)} b />
          {d.adjusted !== 0 && <Row k="Penyesuaian" v={`${d.adjusted > 0 ? '−' : '+'} ${rp(Math.abs(d.adjusted))}`} />}
          <Row k="Dibayar" v={`− ${rp(d.paid)}`} />
          <Row k={d.outstanding < 0 ? 'Lebih bayar' : 'Sisa'} v={rp(Math.abs(d.outstanding))} b cls={d.outstanding ? 'text-red-600' : 'text-green-700'} />
          {isSale && <Row k="Margin" v={d.margin == null ? 'harga beli belum lengkap' : rp(d.margin)} />}
        </div>
      </div>

      {/* ===== Selisih yang wajib ditangani ===== */}
      {d.importDiff !== 0 && (
        <div className={`card border-2 ${d.diffOpen ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}>
          <h3 className="mb-1 font-semibold">{d.diffOpen ? '⚠ ' : '✓ '}Selisih total sheet vs hitungan</h3>
          <p className="text-sm">Total di sheet asal <b>{rp(d.imported_total)}</b>, hitungan (jumlah × harga) <b>{rp(d.total)}</b>, selisih <b>{rp(d.importDiff)}</b>.</p>
          <p className="mb-2 text-xs text-slate-600">Pilih salah satu: <b>ubah baris</b> (Edit) bila ada yang salah ketik, atau <b>tulis justifikasi</b>. Kalau angka sheet yang benar, tombol "Samakan dengan total sheet" akan menambah penyesuaian sebesar selisih.</p>
          {perms.note && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input className="inp flex-1" placeholder="Justifikasi, mis. ongkir tidak tercatat di kolom" value={note} onChange={(e) => setDiffNote(e.target.value)} />
              <button className="btn-ghost" onClick={saveDiffNote} disabled={a.busy}>Simpan justifikasi</button>
              {perms.adjust && d.diffOpen && <button className="btn-primary" onClick={acceptSheet} disabled={a.busy}>Samakan dengan total sheet</button>}
            </div>
          )}
        </div>
      )}
      {d.zeroPriceLines > 0 && <div className="card border-2 border-red-300 bg-red-50 text-sm">⚠ Ada {d.zeroPriceLines} baris dengan harga 0. Klik <b>Edit</b> untuk mengisi harganya.</div>}
      {d.outstanding !== 0 && d.paid > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-2 border-2 border-amber-300 bg-amber-50 text-sm">
          <span>{d.outstanding > 0 ? `Masih kurang bayar ${rp(d.outstanding)}.` : `Lebih bayar ${rp(-d.outstanding)}.`} Tambah pembayaran, catat retur/diskon, atau bulatkan.</span>
          {perms.adjust && <button className="btn-primary" onClick={roundIt} disabled={a.busy}>Bulatkan selisih {rp(d.outstanding)}</button>}
        </div>
      )}

      <div className="card overflow-x-auto">
        <h3 className="mb-2 font-semibold">Barang</h3>
        <table className="w-full min-w-[600px] text-sm">
          <thead><tr className="text-left text-xs text-slate-600"><th className="p-1">Barang</th><th className="p-1 text-right">Jumlah</th><th className="p-1">Satuan</th><th className="p-1 text-right">Harga</th>
            {isSale && <th className="p-1 text-right">Harga beli</th>}{isSale && <th className="p-1 text-right">Margin</th>}<th className="p-1 text-right">Subtotal</th><th className="p-1">Catatan</th></tr></thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-1">{l.item_name}</td>
                <td className="p-1 text-right">{qty(l.qty)}{l.kg_per_unit && l.unit_name !== 'kg' ? <span className="text-xs text-slate-500"> (≈{qty(l.qty * l.kg_per_unit)} kg)</span> : null}</td>
                <td className="p-1">{l.unit_name}</td>
                <td className={`p-1 text-right ${l.price === 0 ? 'font-bold text-red-600' : ''}`}>{rp(l.price)}</td>
                {isSale && <td className="p-1 text-right">{l.cost_price == null ? <span className="text-slate-400">—</span> : rp(l.cost_price)}</td>}
                {isSale && <td className="p-1 text-right">{l.cost_price == null ? '' : rp((l.price - l.cost_price) * l.qty)}</td>}
                <td className="p-1 text-right font-medium">{rp(l.qty * l.price)}</td>
                <td className="p-1 text-xs">{l.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="card overflow-x-auto">
          <h3 className="mb-2 font-semibold">Pembayaran ({d.allocations.length})</h3>
          {!d.allocations.length ? <p className="text-sm text-slate-500">Belum ada pembayaran.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-600"><th className="p-1">Tgl bayar</th><th className="p-1">Metode</th><th className="p-1">Referensi</th><th className="p-1 text-right">Untuk invoice ini</th><th className="p-1 text-right">Nominal bayar</th><th /></tr></thead>
              <tbody>
                {d.allocations.map((x) => (
                  <tr key={x.id} className="border-t">
                    <td className="p-1">{tgl(x.date)}</td><td className="p-1">{METHOD[x.method]}</td><td className="p-1 text-xs">{x.reference}</td>
                    <td className="p-1 text-right font-medium">{rp(x.amount)}</td>
                    <td className="p-1 text-right text-xs text-slate-500">{x.payment_amount !== x.amount ? `dari pembayaran ${rp(x.payment_amount)}` : ''}</td>
                    <td className="p-1">{perms.payment && <button className="text-xs text-sky-700 underline" onClick={() => setPayModal({ paymentId: x.payment_id })}>edit</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card overflow-x-auto">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">Penyesuaian ({d.adjustments.length})</h3>
            {perms.adjust && <button className="btn-ghost py-1 text-xs" onClick={() => setAdjModal(true)}>+ Retur / susut / diskon</button>}
          </div>
          {!d.adjustments.length ? <p className="text-sm text-slate-500">Tidak ada.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-600"><th className="p-1">Tanggal</th><th className="p-1">Jenis</th><th className="p-1 text-right">Qty</th><th className="p-1 text-right">Nominal</th><th className="p-1">Keterangan</th><th /></tr></thead>
              <tbody>
                {d.adjustments.map((x) => (
                  <tr key={x.id} className="border-t">
                    <td className="p-1">{tgl(x.date)}</td><td className="p-1">{ADJ[x.type]}</td><td className="p-1 text-right">{x.qty == null ? '' : qty(x.qty)}</td>
                    <td className="p-1 text-right">{rp(x.amount)}</td><td className="p-1 text-xs">{x.note} <span className="text-slate-400">— {x.created_by_name}</span></td>
                    <td className="p-1">{perms.adjust && <button className="text-xs text-red-600 underline" onClick={() => removeAdj(x)}>hapus</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-slate-500">Nominal positif mengurangi tagihan (retur, diskon); negatif menambah tagihan.</p>
        </div>
      </div>

      {payModal && <PaymentForm kind={d.kind} paymentId={payModal.paymentId} partyId={d.party_id} invoiceId={d.id} onClose={() => setPayModal(null)} onSaved={() => { setPayModal(null); reload(); }} />}
      {adjModal && <AdjustmentForm inv={d} onClose={() => setAdjModal(false)} onSaved={() => { setAdjModal(false); reload(); }} />}
    </div>
  );
}

function Row({ k, v, b, cls = '' }) {
  return <div className="flex justify-between border-b border-dashed py-1 last:border-0"><span className="text-slate-600">{k}</span><span className={`${b ? 'font-bold' : ''} ${cls}`}>{v}</span></div>;
}

function AdjustmentForm({ inv, onClose, onSaved }) {
  const [f, setF] = useState({ date: today(), type: 'retur', qty: '', amount: '', note: '' });
  const a = useAction();
  const price = inv.lines.length === 1 ? inv.lines[0].price : null;
  const save = (e) => { e.preventDefault(); a.run(async () => { await post(`/invoices/${inv.id}/adjustments`, f); onSaved(); }); };
  return (
    <Modal title={`Penyesuaian invoice ${inv.number}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tanggal"><input type="date" className="inp" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Jenis">
            <select className="inp" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {Object.entries(ADJ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Jumlah (kg / satuan, opsional)"><NumInput value={f.qty} onChange={(v) => setF({ ...f, qty: v, amount: price && v !== '' && f.amount === '' ? Math.round(v * price * 100) / 100 : f.amount })} /></Field>
          <Field label="Nominal (+ mengurangi tagihan)"><NumInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        </div>
        {price != null && <p className="text-xs text-slate-500">Harga di invoice: {rp(price)} — nominal terisi otomatis dari jumlah × harga, bisa diubah.</p>}
        <Field label="Keterangan (wajib)"><input className="inp" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="mis. Return 45kg, telur pecah" /></Field>
        <ErrorBox error={a.error} />
        <div className="flex gap-2"><button className="btn-primary" disabled={a.busy}>Simpan</button><button type="button" className="btn-ghost" onClick={onClose}>Batal</button></div>
      </form>
    </Modal>
  );
}
