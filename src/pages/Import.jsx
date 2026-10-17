// Import sheet penjualan lama (format sama dengan sheet: 2 baris header, kolom Qty/Harga per barang).
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { post } from '../api';
import { ErrorBox, PageTitle, useAction } from '../components/ui';
import { useConfirm } from '../lib/confirm';
import { METHOD, rp, tgl } from '../format';

export default function ImportPage() {
  const [wb, setWb] = useState(null); // {name, sheets: {nama: rows}}
  const [sheet, setSheet] = useState('');
  const [paste, setPaste] = useState('');
  const [fmt, setFmt] = useState('id');
  const [plan, setPlan] = useState(null);
  const [ignoreErrors, setIgnoreErrors] = useState(false);
  const [result, setResult] = useState(null);
  const a = useAction();
  const confirm = useConfirm();

  const rows = () => (wb ? wb.sheets[sheet] : paste.split(/\r?\n/).map((l) => l.split('\t')));

  const readFile = (file) => a.run(async () => {
    setPlan(null); setResult(null);
    const XLSX = await import('xlsx');
    const isCsv = /\.csv$/i.test(file.name);
    // CSV dibaca sebagai teks mentah supaya "28.000" tidak diubah jadi 28 oleh parser.
    const book = isCsv ? XLSX.read(await file.text(), { type: 'string', raw: true }) : XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheets = Object.fromEntries(book.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json(book.Sheets[n], { header: 1, raw: true, defval: '' })]));
    setWb({ name: file.name, sheets });
    setSheet(book.SheetNames[0]);
  });

  const preview = () => a.run(async () => { setResult(null); setPlan(await post('/import/preview', { rows: rows(), numberFormat: fmt })); });
  const commit = () => a.run(async () => {
    if (!await confirm(`Import ${plan.invoices.filter((i) => !i.exists).length} invoice ke database?`, { danger: false, confirmLabel: 'Import' })) return;
    setResult(await post('/import/commit', { rows: rows(), numberFormat: fmt, ignoreErrors }));
    setPlan(null);
  });

  const fresh = plan?.invoices.filter((i) => !i.exists) || [];
  return (
    <div className="space-y-3">
      <PageTitle>Import Penjualan dari Sheet</PageTitle>
      <div className="card space-y-3 text-sm">
        <p className="text-xs text-slate-600">Format yang dibaca: baris header berisi <b>Tanggal, No Inv, Nama</b>, lalu pasangan kolom (jumlah, <b>Harga</b>) per barang dengan nama barang di baris atasnya, lalu <b>Total, Tgl Byr, Nominal, Status</b>. Baris dengan No Inv sama digabung jadi 1 invoice. Nomor yang sudah ada di database dilewati, jadi aman diimpor ulang.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label><span className="lbl">File .xlsx / .csv (Google Sheet: File → Download)</span><input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && readFile(e.target.files[0])} /></label>
          {wb && Object.keys(wb.sheets).length > 1 && (
            <label><span className="lbl">Sheet/tab</span><select className="inp" value={sheet} onChange={(e) => { setSheet(e.target.value); setPlan(null); }}>{Object.keys(wb.sheets).map((n) => <option key={n}>{n}</option>)}</select></label>
          )}
          <label><span className="lbl">Format angka</span>
            <select className="inp" value={fmt} onChange={(e) => { setFmt(e.target.value); setPlan(null); }}>
              <option value="id">Indonesia: 1.234.567,89</option>
              <option value="en">Inggris: 1,234,567.89</option>
            </select>
          </label>
        </div>
        {!wb && (
          <label className="block"><span className="lbl">…atau tempel langsung dari Google Sheet (blok mulai dari baris nama barang sampai baris data terakhir, lalu Ctrl+C)</span>
            <textarea className="inp h-28 font-mono text-xs" value={paste} onChange={(e) => { setPaste(e.target.value); setPlan(null); }} /></label>
        )}
        {wb && <p className="text-xs">File: <b>{wb.name}</b> <button className="text-sky-700 underline" onClick={() => { setWb(null); setPlan(null); }}>ganti</button></p>}
        <button className="btn-primary" onClick={preview} disabled={a.busy || (!wb && !paste.trim())}>Cek dulu (preview)</button>
      </div>
      <ErrorBox error={a.error} />

      {result && (
        <div className="card border-2 border-green-300 bg-green-50 text-sm">
          <b>Berhasil import {result.imported.length} invoice.</b>
          {result.skipped.length > 0 && <p>Dilewati: {result.skipped.join('; ')}</p>}
          {result.created.customers.length > 0 && <p>Customer baru dibuat: {result.created.customers.join(', ')}. Cek termin bayarnya di Master (bawaan 30 hari).</p>}
          {result.created.items.length > 0 && <p>Barang baru: {result.created.items.join(', ')}</p>}
          {result.created.units.length > 0 && <p>Satuan baru: {result.created.units.join(', ')}</p>}
          <p className="mt-1">Lanjut ke <Link className="text-sky-700 underline" to="/penjualan">Penjualan</Link>, filter status "⚠ Ada selisih" untuk menyelesaikan selisih hasil import.</p>
        </div>
      )}

      {plan && (
        <div className="card text-sm">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <b>{plan.invoices.length} invoice terbaca</b>
            <span>· baru: {fresh.length}</span>
            <span>· sudah ada (dilewati): {plan.invoices.length - fresh.length}</span>
            <span>· dengan selisih: {plan.invoices.filter((i) => i.diff).length}</span>
            <span>· kolom barang: {plan.items.join(', ')}</span>
          </div>
          {plan.errors.length > 0 && (
            <div className="mb-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">
              <b>{plan.errors.length} baris error (tidak akan diimpor):</b>
              <ul className="list-disc pl-5">{plan.errors.map((e) => <li key={e}>{e}</li>)}</ul>
              <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={ignoreErrors} onChange={(e) => setIgnoreErrors(e.target.checked)} /> Lewati baris error, import sisanya</label>
            </div>
          )}
          <div className="max-h-[60vh] overflow-auto rounded border">
            <table className="sheet w-full border-collapse">
              <thead className="sticky top-0"><tr><th>No Inv</th><th>Tanggal</th><th>Nama</th><th>Barang</th><th>Total sheet</th><th>Hitungan</th><th>Selisih</th><th>Pembayaran</th><th>PO / catatan</th><th>Peringatan</th></tr></thead>
              <tbody>
                {plan.invoices.map((i) => (
                  <tr key={i.number} className={i.exists ? 'text-slate-400 line-through' : i.diff ? 'bg-red-50' : i.warnings.length ? 'bg-amber-50' : ''}>
                    <td className="font-medium">{i.number}</td><td>{tgl(i.date)}</td><td>{i.partyName}</td>
                    <td className="whitespace-normal">{i.lines.map((l) => `${l.itemName} ${l.qty} ${l.unitName} × ${rp(l.price)}`).join('; ')}</td>
                    <td className="text-right">{rp(i.importedTotal)}</td><td className="text-right">{rp(i.computedTotal)}</td>
                    <td className={`text-right ${i.diff ? 'font-bold text-red-600' : ''}`}>{i.diff ? rp(i.diff) : ''}</td>
                    <td className="whitespace-normal">{i.payments.map((p) => `${tgl(p.date)} ${METHOD[p.method]} ${rp(p.amount)}`).join('; ')}</td>
                    <td className="whitespace-normal">{[i.poRef, i.notes].filter(Boolean).join(' | ')}</td>
                    <td className="min-w-[260px] whitespace-normal text-amber-800">{i.exists ? 'Nomor sudah ada di database — dilewati' : i.warnings.join(' • ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="my-2 text-xs text-slate-500">Harga beli tidak ada di sheet, jadi isi lewat Edit invoice bila ingin margin. Retur/susut di kolom Status hanya disimpan sebagai catatan. Catat nominalnya lewat "Penyesuaian" di detail invoice.</p>
          <button className="btn-primary" onClick={commit} disabled={a.busy || !fresh.length || (plan.errors.length > 0 && !ignoreErrors)}>Import {fresh.length} invoice</button>
        </div>
      )}
    </div>
  );
}
