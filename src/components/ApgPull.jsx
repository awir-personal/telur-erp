import React, { useState } from 'react';
import { get, post } from '../api';
import { ErrorBox, Modal, useAction, useLoad } from './ui';
import { rp, tgl } from '../format';

// v4.1 "Tarik dari APG": pratinjau dulu (baru / berbeda / sama / yatim), lalu tarik. Tidak ada yang berubah diam-diam:
// nota yang sumbernya berubah hanya diperbarui kalau dicentang; yang sumbernya hilang hanya dilaporkan.
export default function ApgPull({ onClose, onDone }) {
  const plan = useLoad(() => get('/gta/apg-plan'), []);
  const [apply, setApply] = useState({});
  const [result, setResult] = useState(null);
  const a = useAction();
  const p = plan.data;
  const chosen = Object.keys(apply).filter((k) => apply[k]).map(Number);
  const run = () => a.run(async () => {
    const r = await post('/gta/apg-pull', { createNew: true, apply: chosen });
    setResult(r);
    plan.reload();
    onDone?.();
  });

  return (
    <Modal title="Tarik pembelian dari APG" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">Invoice penjualan APG ke customer bertanda <b>Pembelian GTA</b> (Master → Customer di APG) disalin menjadi nota pembelian di sini dari supplier <b>APG / Farm</b> — No Inv, tanggal, barang, jumlah & harga sama. Pembayaran ke APG dicatat sendiri di Uang Keluar.</p>
        <ErrorBox error={plan.error || a.error} />
        {result && (
          <div className="rounded border border-emerald-300 bg-emerald-50 p-2 text-emerald-800">
            {result.added.length} nota baru ditarik{result.applied.length ? `, ${result.applied.length} diperbarui` : ''} (supplier: {result.supplier}{result.supplierCreated ? ', dibuat otomatis — termin 90 hari' : ''}).
          </div>
        )}
        {!p ? <p className="text-slate-500">Memuat…</p> : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[['Baru', p.fresh.length, 'text-sky-700'], ['Berbeda', p.changed.length, 'text-amber-700'], ['Sama', p.same, 'text-emerald-700'], ['Sumber hilang', p.orphan.length, 'text-red-700']].map(([l, n, c]) => (
                <div key={l} className="rounded border p-2 text-center"><div className={`text-xl font-semibold ${c}`}>{n}</div><div className="text-xs text-slate-500">{l}</div></div>
              ))}
            </div>
            {p.fresh.length > 0 && (
              <Section title={`Baru — akan ditarik (${p.fresh.length})`}>
                {p.fresh.map((x) => <Row key={x.id} left={`${x.number} · ${tgl(x.date)} · ${x.party_name}`} right={rp(x.total)} sub={x.lines.join('; ')} />)}
              </Section>
            )}
            {p.changed.length > 0 && (
              <Section title="Berbeda dengan invoice APG — centang untuk menerapkan perubahan APG ke nota di sini">
                {p.changed.map((x) => (
                  <label key={x.copyId} className="flex items-start gap-2 border-b py-1.5 last:border-0">
                    <input type="checkbox" className="mt-1" checked={!!apply[x.copyId]} onChange={(e) => setApply({ ...apply, [x.copyId]: e.target.checked })} />
                    <span><b>{x.number}</b> · {x.party_name}{x.paid ? <span className="text-amber-700"> (sudah ada pembayaran {rp(x.paid)})</span> : null}<span className="block text-xs text-slate-600">{x.beda.join(' · ')}</span></span>
                  </label>
                ))}
              </Section>
            )}
            {p.orphan.length > 0 && (
              <Section title="Sumber hilang — invoice APG sudah dihapus / customernya tidak bertanda GTA lagi. Nota di sini TIDAK dihapus otomatis; cek & hapus manual bila perlu.">
                {p.orphan.map((x) => <Row key={x.id} left={`${x.number} · ${tgl(x.date)}`} right={rp(x.total)} sub={x.paid ? `sudah dibayar ${rp(x.paid)}` : null} />)}
              </Section>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={onClose}>Tutup</button>
              <button className="btn-primary" onClick={run} disabled={a.busy || (!p.fresh.length && !chosen.length)}>
                Tarik {p.fresh.length} nota baru{chosen.length ? ` + terapkan ${chosen.length} perubahan` : ''}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

const Section = ({ title, children }) => (
  <div className="rounded border">
    <div className="border-b bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">{title}</div>
    <div className="max-h-56 overflow-y-auto px-2">{children}</div>
  </div>
);
const Row = ({ left, right, sub }) => (
  <div className="border-b py-1.5 last:border-0">
    <div className="flex justify-between gap-2"><span>{left}</span><span className="font-medium">{right}</span></div>
    {sub && <div className="text-xs text-slate-500">{sub}</div>}
  </div>
);
