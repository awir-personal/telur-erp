// Rekonsiliasi bank: impor mutasi (BCA/BNI/Mandiri/Arus Kas/manual) → cocokkan dengan transaksi sistem.
import React, { useState } from 'react';
import { del, get, post, qs } from '../api';
import { ErrorBox, Field, Modal, PageTitle, useAction, useAuth, useLoad } from '../components/ui';
import { useConfirm } from '../lib/confirm';
import { rp, tgl } from '../format';

const STATUS = { unmatched: ['Belum cocok', 'bg-amber-100 text-amber-800'], matched: ['Cocok', 'bg-green-100 text-green-800'], ignored: ['Diabaikan', 'bg-slate-100 text-slate-700'] };
const FIELDS = [['date', 'Tanggal *'], ['description', 'Keterangan'], ['debit', 'Debet'], ['credit', 'Kredit'], ['amount', 'Jumlah (1 kolom)'], ['dbcr', 'Kolom DB/CR'], ['balance', 'Saldo']];

export default function Recon({ embedded = false }) {
  const { perms } = useAuth();
  const accs = useLoad(() => get('/accounts'), []);
  const banks = (accs.data || []).filter((a) => a.active);
  const [acc, setAcc] = useState('');
  const [status, setStatus] = useState('unmatched');
  const [showImport, setShowImport] = useState(false);
  const [lineModal, setLineModal] = useState(null);
  const summary = useLoad(() => (acc ? get('/recon/summary' + qs({ account_id: acc })) : Promise.resolve(null)), [acc]);
  const lines = useLoad(() => (acc ? get('/recon/lines' + qs({ account_id: acc, status })) : Promise.resolve([])), [acc, status]);
  const reload = () => { summary.reload(); lines.reload(); };
  const s = summary.data;

  return (
    <div className="space-y-3">
      {!embedded && <PageTitle>Rekonsiliasi Bank</PageTitle>}
      <div className="card flex flex-wrap items-end gap-2">
        <label><span className="lbl">Rekening</span>
          <select className="inp min-w-[220px]" value={acc} onChange={(e) => setAcc(Number(e.target.value) || '')}>
            <option value="">— pilih rekening —</option>
            {banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {acc && perms.cash && <button className="btn-primary" onClick={() => setShowImport(true)}>⬆ Impor mutasi</button>}
        {acc && perms.cash && <button className="btn-ghost" onClick={async () => { await post('/recon/auto-match', { account_id: acc }); reload(); }}>Cocokkan otomatis</button>}
      </div>
      {!acc && <p className="text-sm text-slate-500">Pilih rekening, lalu impor file mutasi dari internet banking (BCA, BNI, Mandiri) atau file Laporan Arus Kas.</p>}
      <ErrorBox error={summary.error || lines.error} />
      {s && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="card"><div className="text-xs text-slate-500">Saldo menurut bank {s.statement ? `(${tgl(s.statement.date)})` : ''}</div><div className="text-lg font-bold">{s.statement ? rp(s.statement.balance) : '—'}</div></div>
          <div className="card"><div className="text-xs text-slate-500">Saldo menurut sistem (tanggal sama)</div><div className="text-lg font-bold">{s.system ? rp(s.system.balance) : '—'}</div></div>
          <div className={`card ${s.difference ? 'border-red-300 bg-red-50' : s.difference === 0 ? 'border-green-300 bg-green-50' : ''}`}>
            <div className="text-xs text-slate-500">Selisih</div><div className={`text-lg font-bold ${s.difference ? 'text-red-600' : 'text-green-700'}`}>{s.difference == null ? '—' : s.difference === 0 ? 'Cocok ✓' : rp(s.difference)}</div>
          </div>
          <div className="card text-sm">
            {Object.entries(STATUS).map(([k, [label]]) => <div key={k} className="flex justify-between"><span>{label}</span><b>{s.counts[k]?.n || 0}</b></div>)}
            <div className="flex justify-between text-amber-700"><span>Transaksi sistem tanpa mutasi</span><b>{s.systemUnmatched.length}</b></div>
          </div>
        </div>
      )}
      {acc && (
        <>
          <div className="flex gap-1 border-b border-slate-200">
            {[['unmatched', 'Belum cocok'], ['matched', 'Cocok'], ['ignored', 'Diabaikan'], ['', 'Semua']].map(([k, v]) => (
              <button key={k} className={`px-3 py-1.5 text-sm ${status === k ? 'border-b-2 border-brand-600 font-semibold' : 'text-slate-500'}`} onClick={() => setStatus(k)}>{v}</button>
            ))}
          </div>
          <div className="overflow-x-auto rounded border border-slate-300 bg-white">
            <table className="sheet w-full border-collapse">
              <thead><tr><th>Tanggal</th><th>Keterangan bank</th><th>Masuk</th><th>Keluar</th><th>Saldo bank</th><th>Status</th><th>Transaksi sistem</th><th /></tr></thead>
              <tbody>
                {!(lines.data || []).length && <tr><td colSpan={8} className="p-3 text-center text-slate-500">{lines.loading ? 'Memuat…' : 'Tidak ada baris'}</td></tr>}
                {(lines.data || []).map((l) => (
                  <tr key={l.id}>
                    <td>{tgl(l.date)}</td>
                    <td className="max-w-[320px] truncate" title={l.description}>{l.description}</td>
                    <td className="text-right text-green-700">{l.amount > 0 ? rp(l.amount) : ''}</td>
                    <td className="text-right text-red-600">{l.amount < 0 ? rp(-l.amount) : ''}</td>
                    <td className="text-right">{l.balance == null ? '' : rp(l.balance)}</td>
                    <td><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS[l.status][1]}`}>{STATUS[l.status][0]}</span></td>
                    <td className="max-w-[280px] truncate">{l.match ? `${tgl(l.match.date)} · ${l.match.label}` : l.note || ''}</td>
                    <td>{perms.cash && <button className="text-sky-700 underline" onClick={() => setLineModal(l)}>{l.status === 'unmatched' ? 'cocokkan' : 'ubah'}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s?.systemUnmatched.length > 0 && (
            <div className="card">
              <h3 className="mb-1 font-semibold">Transaksi di sistem yang tidak ada di mutasi ({tgl(s.range.first)} – {tgl(s.range.last)})</h3>
              <p className="mb-2 text-xs text-slate-500">Kemungkinan: salah pilih rekening, salah tanggal/nominal, atau memang belum masuk bank.</p>
              <table className="w-full text-sm"><tbody>
                {s.systemUnmatched.map((i) => <tr key={`${i.src}-${i.id}`} className="border-t border-slate-200"><td className="py-1">{tgl(i.date)}</td><td>{i.label}</td><td className="text-xs text-slate-500">{i.note}</td><td className={`text-right font-medium ${i.amount < 0 ? 'text-red-600' : 'text-green-700'}`}>{rp(i.amount)}</td></tr>)}
              </tbody></table>
            </div>
          )}
          <Batches account={acc} onChange={reload} />
        </>
      )}
      {showImport && <ImportModal account={banks.find((a) => a.id === acc)} onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); reload(); }} />}
      {lineModal && <LineModal line={lineModal} onClose={() => setLineModal(null)} onDone={() => { setLineModal(null); reload(); }} />}
    </div>
  );
}

function Batches({ account, onChange }) {
  const { perms } = useAuth();
  const confirm = useConfirm();
  const b = useLoad(() => get('/recon/batches' + qs({ account_id: account })), [account]);
  if (!(b.data || []).length) return null;
  const remove = async (x) => {
    if (!await confirm(`Hapus impor "${x.batch}" (${x.n} baris, ${x.matched} sudah cocok)? Transaksi sistemnya tidak ikut terhapus.`)) return;
    await del('/recon/batch' + qs({ account_id: account, batch: x.batch }));
    b.reload(); onChange();
  };
  return (
    <details className="card text-sm">
      <summary className="cursor-pointer font-semibold">Riwayat impor ({b.data.length})</summary>
      <table className="mt-2 w-full"><tbody>
        {b.data.map((x) => <tr key={x.batch} className="border-t border-slate-200"><td className="py-1">{x.batch}</td><td>{tgl(x.first)} – {tgl(x.last)}</td><td>{x.n} baris · {x.matched} cocok</td>
          <td className="text-right">{perms.cash && <button className="text-red-600 underline" onClick={() => remove(x)}>hapus impor</button>}</td></tr>)}
      </tbody></table>
    </details>
  );
}

function ImportModal({ account, onClose, onDone }) {
  const [wb, setWb] = useState(null);
  const [sheet, setSheet] = useState('');
  const [opt, setOpt] = useState({ preset: account?.bank || 'auto', direction: 'auto', year: new Date().getFullYear() });
  const [manual, setManual] = useState(null); // { headerRow, mapping }
  const [prev, setPrev] = useState(null);
  const [result, setResult] = useState(null);
  const a = useAction();

  const readFile = (file) => a.run(async () => {
    setPrev(null); setResult(null); setManual(null);
    const XLSX = await import('xlsx');
    const isCsv = /\.(csv|txt)$/i.test(file.name);
    const book = isCsv ? XLSX.read(await file.text(), { type: 'string', raw: true }) : XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheets = Object.fromEntries(book.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json(book.Sheets[n], { header: 1, raw: true, defval: '' })]));
    setWb({ name: file.name, sheets });
    setSheet(book.SheetNames.find((n) => sheets[n].length > 5) || book.SheetNames[0]);
  });
  const body = () => ({ account_id: account.id, rows: wb.sheets[sheet], ...opt, ...(manual ? { mapping: manual.mapping, headerRow: manual.headerRow } : {}) });
  const preview = () => a.run(async () => {
    const p = await post('/recon/preview', body());
    setPrev(p);
    if (p.error && !manual) setManual({ headerRow: 1, mapping: { date: 0, description: 1, debit: -1, credit: -1, amount: 2, dbcr: -1, balance: -1 } });
  });
  const doImport = () => a.run(async () => setResult(await post('/recon/import', body())));
  const cols = wb ? Math.max(...wb.sheets[sheet].slice(0, 30).map((r) => r.length), 0) : 0;
  const fresh = prev?.lines?.filter((l) => !l.exists) || [];

  return (
    <Modal title={`Impor mutasi ke ${account?.name}`} onClose={onClose} wide>
      {result ? (
        <div className="space-y-3 text-sm">
          <p className="rounded bg-green-50 p-3 text-green-800">Terbaca {result.read} baris · baru {result.inserted} · sudah pernah diimpor {result.duplicates} · <b>otomatis cocok {result.autoMatched}</b>.</p>
          <p className="text-xs text-slate-500">Cocok otomatis hanya jika nominal sama persis dan tanggal selisih ≤ 3 hari dengan transaksi yang rekeningnya sudah {account?.name}. Sisanya cocokkan manual di tab "Belum cocok".</p>
          <button className="btn-primary" onClick={onDone}>Selesai</button>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label><span className="lbl">File mutasi (.xlsx / .csv)</span><input type="file" accept=".xlsx,.xls,.csv,.txt" onChange={(e) => e.target.files[0] && readFile(e.target.files[0])} /></label>
            {wb && Object.keys(wb.sheets).length > 1 && <label><span className="lbl">Sheet</span><select className="inp" value={sheet} onChange={(e) => { setSheet(e.target.value); setPrev(null); }}>{Object.keys(wb.sheets).map((n) => <option key={n}>{n}</option>)}</select></label>}
            <label><span className="lbl">Format</span><select className="inp" value={opt.preset} onChange={(e) => setOpt({ ...opt, preset: e.target.value })}>
              <option value="auto">Deteksi otomatis</option><option>BCA</option><option>BNI</option><option>Mandiri</option></select></label>
            <label><span className="lbl">Arah kolom Debet</span><select className="inp" value={opt.direction} onChange={(e) => setOpt({ ...opt, direction: e.target.value })}>
              <option value="auto">Otomatis (cek saldo)</option><option value="debet_keluar">Debet = uang keluar (mutasi bank)</option><option value="debet_masuk">Debet = uang masuk (buku kas)</option></select></label>
            <label><span className="lbl">Tahun (untuk tanggal tanpa tahun)</span><input className="inp w-24" type="number" value={opt.year} onChange={(e) => setOpt({ ...opt, year: e.target.value })} /></label>
          </div>
          {manual && wb && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2">
              <b>Pemetaan kolom manual</b>
              <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Field label="Baris header (nomor)"><input type="number" min={1} className="inp" value={manual.headerRow} onChange={(e) => setManual({ ...manual, headerRow: Number(e.target.value) })} /></Field>
                {FIELDS.map(([k, label]) => (
                  <Field key={k} label={label}>
                    <select className="inp" value={manual.mapping[k]} onChange={(e) => setManual({ ...manual, mapping: { ...manual.mapping, [k]: Number(e.target.value) } })}>
                      <option value={-1}>—</option>
                      {Array.from({ length: cols }, (_, i) => <option key={i} value={i}>Kolom {String.fromCharCode(65 + i)}: {String(wb.sheets[sheet][manual.headerRow - 1]?.[i] ?? '').slice(0, 18)}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn-primary" onClick={preview} disabled={!wb || a.busy}>Cek dulu (preview)</button>
            {wb && !manual && <button className="btn-ghost" onClick={() => setManual({ headerRow: 1, mapping: { date: 0, description: 1, debit: -1, credit: -1, amount: 2, dbcr: -1, balance: -1 } })}>Pilih kolom manual</button>}
          </div>
          <ErrorBox error={a.error || (prev?.error && { message: prev.error })} />
          {prev && !prev.error && (
            <>
              <p>Header baris {prev.headerRow} · {prev.lines.length} transaksi · masuk <b className="text-green-700">{rp(prev.totals.in)}</b> · keluar <b className="text-red-600">{rp(prev.totals.out)}</b> · arah Debet: <b>{prev.direction === 'debet_keluar' ? 'uang keluar' : 'uang masuk'}</b>
                {prev.directionCheck?.debet_keluar?.tot ? <span className="text-xs text-slate-500"> (saldo cocok {Math.max(prev.directionCheck.debet_keluar.hit, prev.directionCheck.debet_masuk.hit)}/{prev.directionCheck.debet_keluar.tot})</span> : null}
                {' '}· baru <b>{fresh.length}</b> · sudah ada {prev.lines.length - fresh.length}</p>
              {prev.warnings.length > 0 && <ul className="list-disc rounded bg-amber-50 p-2 pl-6 text-xs text-amber-800">{prev.warnings.slice(0, 10).map((w) => <li key={w}>{w}</li>)}</ul>}
              <div className="max-h-[45vh] overflow-auto rounded border border-slate-200">
                <table className="sheet w-full border-collapse">
                  <thead className="sticky top-0"><tr><th>Tanggal</th><th>Keterangan</th><th>Masuk</th><th>Keluar</th><th>Saldo</th></tr></thead>
                  <tbody>{prev.lines.map((l, i) => (
                    <tr key={i} className={l.exists ? 'text-slate-400 line-through' : ''}><td>{tgl(l.date)}</td><td className="max-w-[360px] truncate">{l.description}</td>
                      <td className="text-right">{l.amount > 0 ? rp(l.amount) : ''}</td><td className="text-right">{l.amount < 0 ? rp(-l.amount) : ''}</td><td className="text-right">{l.balance == null ? '' : rp(l.balance)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <button className="btn-primary" onClick={doImport} disabled={a.busy || !fresh.length}>Impor {fresh.length} baris & cocokkan otomatis</button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function LineModal({ line, onClose, onDone }) {
  const [all, setAll] = useState(false);
  const cand = useLoad(() => get('/recon/candidates' + qs({ line_id: line.id, all: all ? '1' : '' })), [line.id, all]);
  const cats = useLoad(() => get('/cash/categories'), []);
  const [cat, setCat] = useState('');
  const [note, setNote] = useState('');
  const a = useAction();
  const kinds = line.amount < 0 ? ['biaya', 'prive'] : ['pemasukan', 'modal'];
  const act = (fn) => a.run(async () => { await fn(); onDone(); });
  const Row = ({ c }) => (
    <tr className="border-t border-slate-200">
      <td className="py-1">{tgl(c.date)}</td><td>{c.label}{!c.assigned && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">belum ada rekening</span>}</td>
      <td className="text-xs text-slate-500">{c.note}</td><td className="text-right font-medium">{rp(c.amount)}</td>
      <td className="text-right"><button className="btn-primary px-2 py-0.5 text-xs" disabled={a.busy} onClick={() => act(() => post(`/recon/lines/${line.id}/match`, { src: c.src, id: c.id }))}>Cocokkan</button></td>
    </tr>
  );
  return (
    <Modal title="Cocokkan mutasi bank" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <div className="rounded bg-slate-100 p-2"><b>{tgl(line.date)}</b> · {line.description} · <b className={line.amount < 0 ? 'text-red-600' : 'text-green-700'}>{rp(line.amount)}</b></div>
        {line.status !== 'unmatched' && (
          <div className="flex items-center gap-2"><span>Status: {STATUS[line.status][0]}{line.note ? ` (${line.note})` : ''}</span>
            <button className="btn-ghost" onClick={() => act(() => post(`/recon/lines/${line.id}/unmatch`))}>Batalkan</button></div>
        )}
        {line.status === 'unmatched' && (
          <>
            <div>
              <div className="mb-1 flex items-center justify-between"><b>Transaksi sistem yang cocok</b>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> tampilkan juga yang nominalnya beda</label></div>
              <ErrorBox error={cand.error} />
              <table className="w-full"><tbody>
                {(cand.data?.exact || []).map((c) => <Row key={`${c.src}-${c.id}`} c={c} />)}
                {all && (cand.data?.others || []).map((c) => <Row key={`o${c.src}-${c.id}`} c={c} />)}
              </tbody></table>
              {cand.data && !cand.data.exact.length && <p className="text-xs text-slate-500">Tidak ada transaksi dengan nominal sama (±31 hari).</p>}
            </div>
            <div className="rounded border border-slate-200 p-2">
              <b>Belum dicatat di sistem? Buat {line.amount < 0 ? 'biaya / prive' : 'pemasukan / modal'} dari mutasi ini</b>
              <div className="mt-1 flex flex-wrap gap-2">
                <select className="inp max-w-xs" value={cat} onChange={(e) => setCat(e.target.value)}>
                  <option value="">— kategori —</option>
                  {(cats.data || []).filter((c) => kinds.includes(c.kind) && c.active).map((c) => <option key={c.id} value={c.id}>{c.kind}: {c.name}</option>)}
                </select>
                <input className="inp max-w-xs" placeholder="keterangan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="btn-primary" disabled={!cat || a.busy} onClick={() => act(() => post(`/recon/lines/${line.id}/create-cash`, { category_id: cat, note }))}>Buat & cocokkan</button>
              </div>
              <p className="mt-1 text-xs text-slate-500">Untuk penerimaan customer / bayar supplier, catat dulu di menu Penerimaan / Bayar Supplier, lalu cocokkan di sini.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input className="inp max-w-xs" placeholder="alasan diabaikan (mis. bunga sudah dicatat)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn-ghost" disabled={!note || a.busy} onClick={() => act(() => post(`/recon/lines/${line.id}/ignore`, { note }))}>Abaikan baris ini</button>
            </div>
          </>
        )}
        <ErrorBox error={a.error} />
      </div>
    </Modal>
  );
}
