import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post, put, qs } from '../api';
import { ErrorBox, Field, NumInput, PageTitle, useAction, useLoad } from '../components/ui';
import { addDays, qty as fq, rp, today } from '../format';

const emptyLine = () => ({ key: Math.random(), item_id: '', unit_id: '', qty: '', price: '', cost_price: '', note: '', hint: '' });
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

export default function InvoiceForm({ kind: kindProp }) {
  const { id } = useParams();
  const nav = useNavigate();
  const editing = Boolean(id);
  const [kind, setKind] = useState(kindProp);
  const isSale = kind === 'sale';
  const [h, setH] = useState({ number: '', date: today(), party_id: '', due_date: '', po_ref: '', notes: '' });
  const [dueTouched, setDueTouched] = useState(false);
  const [lines, setLines] = useState([emptyLine()]);
  const items = useLoad(() => get('/items'), []);
  const units = useLoad(() => get('/units'), []);
  const parties = useLoad(() => (kind ? get('/parties' + qs({ kind: isSale ? 'customer' : 'supplier' })) : Promise.resolve([])), [kind]);
  const a = useAction();

  useEffect(() => {
    if (!editing) return;
    get(`/invoices/${id}`).then((inv) => {
      setKind(inv.kind);
      setH({ number: inv.number, date: inv.date, party_id: inv.party_id, due_date: inv.due_date, po_ref: inv.po_ref || '', notes: inv.notes || '' });
      setDueTouched(true);
      setLines(inv.lines.map((l) => ({ key: l.id, item_id: l.item_id, unit_id: l.unit_id, qty: l.qty, price: l.price, cost_price: l.cost_price ?? '', note: l.note || '', hint: '' })));
    }, a.setError);
  }, [id]); // eslint-disable-line

  const party = (parties.data || []).find((p) => p.id === Number(h.party_id));
  // Jatuh tempo mengikuti termin pihak sampai user mengubahnya sendiri.
  useEffect(() => {
    if (!dueTouched && party && h.date) setH((x) => ({ ...x, due_date: addDays(h.date, party.term_days) }));
  }, [party?.id, h.date, dueTouched]); // eslint-disable-line

  const unitOf = (uid) => (units.data || []).find((u) => u.id === Number(uid));
  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function suggest(i, line) {
    if (!h.party_id || !line.item_id || !line.unit_id) return;
    const s = await get('/price-suggest' + qs({ party_id: h.party_id, item_id: line.item_id, unit_id: line.unit_id }));
    if (s.price != null) setLine(i, { price: line.price === '' ? s.price : line.price, hint: `${s.source === 'master' ? 'Harga master' : 'Harga terakhir'}: ${rp(s.price)}` });
    else setLine(i, { hint: '' });
  }
  const pickItem = (i, itemId) => {
    const it = (items.data || []).find((x) => x.id === Number(itemId));
    const line = { ...lines[i], item_id: Number(itemId) || '', unit_id: it ? it.default_unit_id : '' };
    setLine(i, line);
    suggest(i, line);
  };
  const pickUnit = (i, unitId) => { const line = { ...lines[i], unit_id: Number(unitId) }; setLine(i, line); suggest(i, line); };

  const sub = (l) => (l.qty === '' || l.price === '' ? 0 : r2(l.qty * l.price));
  const total = r2(lines.reduce((s, l) => s + sub(l), 0));
  const costKnown = lines.every((l) => l.cost_price !== '' || l.qty === '');
  const cost = r2(lines.reduce((s, l) => s + (l.cost_price === '' || l.qty === '' ? 0 : l.qty * l.cost_price), 0));

  const save = (e) => {
    e.preventDefault();
    a.run(async () => {
      const used = lines.filter((l) => l.item_id || l.qty !== '');
      const body = { ...h, kind, lines: used.map(({ key, hint, ...l }) => l) };
      const r = editing ? await put(`/invoices/${id}`, body) : await post('/invoices', body);
      nav(`/invoice/${editing ? id : r.id}`, { replace: true });
    });
  };

  return (
    <form onSubmit={save}>
      <PageTitle>{editing ? `Edit ${isSale ? 'Invoice' : 'Nota'} ${h.number}` : isSale ? 'Invoice Penjualan Baru' : 'Nota Pembelian Baru'}</PageTitle>
      <div className="card mb-3 grid grid-cols-2 gap-2 md:grid-cols-6">
        <Field label={isSale ? 'No Invoice' : 'No Nota'}><input className="inp" placeholder="otomatis" value={h.number} onChange={(e) => setH({ ...h, number: e.target.value })} /></Field>
        <Field label="Tanggal"><input type="date" className="inp" value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} required /></Field>
        <Field label={isSale ? 'Customer' : 'Supplier'} className="col-span-2">
          <select className="inp" value={h.party_id} onChange={(e) => setH({ ...h, party_id: Number(e.target.value) || '' })} required>
            <option value="">— pilih —</option>
            {(parties.data || []).filter((p) => p.active || p.id === Number(h.party_id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label={`Jatuh tempo${party ? ` (termin ${party.term_days} hr)` : ''}`}><input type="date" className="inp" value={h.due_date} onChange={(e) => { setDueTouched(true); setH({ ...h, due_date: e.target.value }); }} /></Field>
        <Field label="No PO / referensi"><input className="inp" value={h.po_ref} onChange={(e) => setH({ ...h, po_ref: e.target.value })} /></Field>
        <Field label="Keterangan" className="col-span-2 md:col-span-6"><input className="inp" value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} placeholder="mis. Brownies, kirim pagi, dll." /></Field>
        {party?.price_rule && <p className="col-span-2 rounded bg-sky-50 p-2 text-xs text-sky-800 md:col-span-6"><b>Aturan harga {party.name}:</b> {party.price_rule}</p>}
      </div>

      <div className="card mb-3 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-600">
              <th className="w-48 p-1">Barang</th><th className="w-24 p-1">Jumlah</th><th className="w-24 p-1">Satuan</th>
              <th className="w-32 p-1">Harga {isSale ? 'jual' : 'beli'}/satuan</th>
              {isSale && <th className="w-32 p-1">Harga beli/satuan</th>}
              <th className="p-1">Catatan</th><th className="w-32 p-1 text-right">Subtotal</th><th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const u = unitOf(l.unit_id);
              return (
                <tr key={l.key} className="align-top">
                  <td className="p-1">
                    <select className="inp" value={l.item_id} onChange={(e) => pickItem(i, e.target.value)}>
                      <option value="">— barang —</option>
                      {(items.data || []).filter((it) => it.active || it.id === l.item_id).map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                    </select>
                  </td>
                  <td className="p-1"><NumInput value={l.qty} onChange={(v) => setLine(i, { qty: v })} />
                    {u?.kg_per_unit && u.name !== 'kg' && l.qty !== '' && <div className="text-[11px] text-slate-500">≈ {fq(l.qty * u.kg_per_unit)} kg</div>}</td>
                  <td className="p-1">
                    <select className="inp" value={l.unit_id} onChange={(e) => pickUnit(i, e.target.value)}>
                      <option value="">—</option>
                      {(units.data || []).filter((x) => x.active || x.id === l.unit_id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </td>
                  <td className="p-1"><NumInput value={l.price} onChange={(v) => setLine(i, { price: v })} />
                    {l.hint && <div className="text-[11px] text-sky-700">{l.hint}</div>}</td>
                  {isSale && <td className="p-1"><NumInput value={l.cost_price} onChange={(v) => setLine(i, { cost_price: v })} placeholder="opsional" /></td>}
                  <td className="p-1"><input className="inp" value={l.note} onChange={(e) => setLine(i, { note: e.target.value })} /></td>
                  <td className="p-1 pt-2.5 text-right font-medium">{rp(sub(l))}</td>
                  <td className="p-1"><button type="button" className="px-2 pt-1 text-lg text-red-600" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [emptyLine()])} aria-label="Hapus baris">×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button type="button" className="btn-ghost mt-2" onClick={() => setLines([...lines, emptyLine()])}>+ Baris</button>
      </div>

      <div className="card mb-3 flex flex-wrap items-center justify-end gap-6 text-sm">
        {isSale && <span>Modal: <b>{costKnown ? rp(cost) : '— (harga beli belum lengkap)'}</b></span>}
        {isSale && costKnown && <span>Margin: <b className={total - cost < 0 ? 'text-red-600' : 'text-green-700'}>{rp(r2(total - cost))}</b></span>}
        <span className="text-base">Total: <b>{rp(total)}</b></span>
      </div>
      <ErrorBox error={a.error} />
      <div className="flex gap-2">
        <button className="btn-primary" disabled={a.busy}>Simpan</button>
        <button type="button" className="btn-ghost" onClick={() => nav(-1)}>Batal</button>
      </div>
    </form>
  );
}
