// Form pembayaran: 1 pembayaran → alokasi ke satu/lebih invoice milik pihak yang sama.
import React, { useEffect, useState } from 'react';
import { del, get, post, put, qs } from '../api';
import { ErrorBox, Field, Modal, NumInput, useAction, useLoad } from './ui';
import { METHOD, rp, tgl, today } from '../format';

const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

export default function PaymentForm({ kind, paymentId, partyId: initialParty, invoiceId, onClose, onSaved }) {
  const isSale = kind === 'sale';
  const [p, setP] = useState({ date: today(), party_id: initialParty || '', method: 'transfer', reference: '', amount: '', notes: '' });
  const [alloc, setAlloc] = useState({}); // invoice_id → nominal
  const [existing, setExisting] = useState({}); // alokasi lama pembayaran ini (untuk menghitung ruang)
  const parties = useLoad(() => get('/parties' + qs({ kind: isSale ? 'customer' : 'supplier' })), [kind]);
  const open = useLoad(() => (p.party_id ? get('/open-invoices' + qs({ kind, party_id: p.party_id })) : Promise.resolve([])), [p.party_id]);
  const a = useAction();

  useEffect(() => {
    if (!paymentId) return;
    get(`/payments/${paymentId}`).then((d) => {
      setP({ date: d.date, party_id: d.party_id, method: d.method, reference: d.reference || '', amount: d.amount, notes: d.notes || '' });
      const m = Object.fromEntries(d.allocations.map((x) => [x.invoice_id, x.amount]));
      setAlloc(m); setExisting(m);
    }, a.setError);
  }, [paymentId]); // eslint-disable-line

  // Invoice yang sudah lunas karena pembayaran INI tetap ditampilkan saat edit.
  const [extra, setExtra] = useState([]);
  useEffect(() => {
    const ids = Object.keys(existing).map(Number).filter((id) => !(open.data || []).some((o) => o.id === id));
    if (!ids.length) return setExtra([]);
    Promise.all(ids.map((id) => get(`/invoices/${id}`))).then(setExtra, a.setError);
  }, [existing, open.data]); // eslint-disable-line
  const invoices = [...(open.data || []), ...extra].sort((x, y) => x.date.localeCompare(y.date) || x.id - y.id);
  const room = (inv) => r2(inv.outstanding + (existing[inv.id] || 0));

  // Saat dibuka dari halaman invoice: isi otomatis nominal = sisa invoice itu.
  useEffect(() => {
    if (paymentId || !invoiceId || !open.data) return;
    const inv = open.data.find((x) => x.id === invoiceId);
    if (inv && p.amount === '') { setP((x) => ({ ...x, amount: inv.outstanding })); setAlloc({ [inv.id]: inv.outstanding }); }
  }, [open.data]); // eslint-disable-line

  const allocated = r2(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0));
  const left = p.amount === '' ? 0 : r2(p.amount - allocated);

  // Alokasi otomatis: invoice terlama dulu.
  const autoAlloc = () => {
    let rest = Number(p.amount) || 0;
    const m = {};
    for (const inv of invoices) {
      if (rest <= 0) break;
      const take = r2(Math.min(rest, room(inv)));
      if (take > 0) { m[inv.id] = take; rest = r2(rest - take); }
    }
    setAlloc(m);
  };

  const save = (e) => {
    e.preventDefault();
    a.run(async () => {
      const body = { ...p, kind, allocations: Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([invoice_id, amount]) => ({ invoice_id: Number(invoice_id), amount })) };
      if (paymentId) await put(`/payments/${paymentId}`, body); else await post('/payments', body);
      onSaved();
    });
  };
  const remove = () => a.run(async () => {
    if (!window.confirm('Hapus pembayaran ini? Semua alokasinya ikut terhapus.')) return;
    await del(`/payments/${paymentId}`);
    onSaved();
  });

  return (
    <Modal title={`${paymentId ? 'Edit' : 'Catat'} ${isSale ? 'penerimaan dari customer' : 'pembayaran ke supplier'}`} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Field label="Tanggal bayar"><input type="date" className="inp" value={p.date} onChange={(e) => setP({ ...p, date: e.target.value })} required /></Field>
          <Field label={isSale ? 'Customer' : 'Supplier'} className="col-span-2 md:col-span-1">
            <select className="inp" value={p.party_id} disabled={Boolean(paymentId)} onChange={(e) => { setP({ ...p, party_id: Number(e.target.value) || '' }); setAlloc({}); }} required>
              <option value="">— pilih —</option>
              {(parties.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Metode">
            <select className="inp" value={p.method} onChange={(e) => setP({ ...p, method: e.target.value })}>
              {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Nominal diterima"><NumInput value={p.amount} onChange={(v) => setP({ ...p, amount: v })} required /></Field>
          <Field label="Referensi (no. transfer, nama pengirim)" className="col-span-2"><input className="inp" value={p.reference} onChange={(e) => setP({ ...p, reference: e.target.value })} /></Field>
          <Field label="Catatan" className="col-span-2"><input className="inp" value={p.notes} onChange={(e) => setP({ ...p, notes: e.target.value })} /></Field>
        </div>

        <div className="rounded border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-slate-50 px-2 py-1.5 text-sm">
            <b>Alokasi ke invoice</b>
            <button type="button" className="btn-ghost py-1 text-xs" onClick={autoAlloc} disabled={!p.amount || !invoices.length}>Alokasi otomatis (terlama dulu)</button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-600"><th className="p-1.5">No</th><th className="p-1.5">Tanggal</th><th className="p-1.5">Jatuh tempo</th><th className="p-1.5 text-right">Total</th><th className="p-1.5 text-right">Sisa</th><th className="w-40 p-1.5">Dibayar dari sini</th></tr></thead>
              <tbody>
                {!p.party_id && <tr><td colSpan={6} className="p-3 text-center text-slate-500">Pilih {isSale ? 'customer' : 'supplier'} dulu</td></tr>}
                {p.party_id && !invoices.length && !open.loading && <tr><td colSpan={6} className="p-3 text-center text-slate-500">Tidak ada invoice yang belum lunas. Nominal akan tercatat sebagai saldo belum dialokasi.</td></tr>}
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t">
                    <td className="p-1.5 font-medium">{inv.number}</td><td className="p-1.5">{tgl(inv.date)}</td><td className="p-1.5">{tgl(inv.due_date)}</td>
                    <td className="p-1.5 text-right">{rp(inv.total)}</td><td className="p-1.5 text-right">{rp(room(inv))}</td>
                    <td className="p-1"><NumInput value={alloc[inv.id] ?? ''} onChange={(v) => setAlloc({ ...alloc, [inv.id]: v })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap justify-end gap-4 border-t bg-slate-50 px-2 py-1.5 text-sm">
            <span>Teralokasi: <b>{rp(allocated)}</b></span>
            <span className={left < 0 ? 'font-bold text-red-600' : left > 0 ? 'text-amber-700' : 'text-green-700'}>
              {left < 0 ? `Alokasi lebih ${rp(-left)} dari nominal` : left > 0 ? `Belum dialokasi: ${rp(left)}` : 'Teralokasi penuh'}
            </span>
          </div>
        </div>
        <ErrorBox error={a.error} />
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={a.busy || left < 0}>Simpan</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Batal</button>
          {paymentId && <button type="button" className="btn-danger ml-auto" onClick={remove} disabled={a.busy}>Hapus pembayaran</button>}
        </div>
      </form>
    </Modal>
  );
}
