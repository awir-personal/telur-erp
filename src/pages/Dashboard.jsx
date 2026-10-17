import React from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api';
import { ErrorBox, PageTitle, useAuth, useLoad } from '../components/ui';
import { rp, tgl } from '../format';

function Stat({ label, value, sub, to, tone = '' }) {
  const body = (
    <div className={`card h-full ${to ? 'transition-colors hover:border-brand-400' : ''}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export default function Dashboard() {
  const { user } = useAuth();
  const d = useLoad(() => get('/dashboard'), []);
  if (d.error) return <ErrorBox error={d.error} />;
  if (!d.data) return <p className="text-sm text-slate-500">Memuat…</p>;
  const x = d.data;
  const todo = [
    x.todo.diffOpen > 0 && [`${x.todo.diffOpen} invoice punya selisih total sheet yang belum dijustifikasi`, '/penjualan'],
    x.todo.zeroPrice > 0 && [`${x.todo.zeroPrice} invoice/nota dengan harga kosong`, '/penjualan'],
    x.todo.overpaid > 0 && [`${x.todo.overpaid} invoice/nota lebih bayar`, '/penjualan'],
    x.todo.unallocatedSale > 0 && [`Penerimaan Rp ${rp(x.todo.unallocatedSale)} belum dialokasikan ke invoice`, '/penerimaan'],
    x.todo.unallocatedPurchase > 0 && [`Pembayaran supplier Rp ${rp(x.todo.unallocatedPurchase)} belum dialokasikan`, '/pembayaran'],
    x.payable.dueSoonCount > 0 && [`${x.payable.dueSoonCount} nota supplier jatuh tempo ≤ 7 hari (Rp ${rp(x.payable.dueSoon)})`, '/laporan'],
    user.role === 'master' && (!x.lastBackupAt || (Date.now() - Date.parse(x.lastBackupAt)) / 86400000 > 7) &&
      [x.lastBackupAt ? `Backup terakhir ${tgl(x.lastBackupAt.slice(0, 10))}, sudah lebih dari 7 hari` : 'Belum pernah backup database', '/pengaturan'],
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <PageTitle>Dashboard <span className="text-sm font-normal text-slate-500">· {tgl(x.today)}</span></PageTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Penjualan hari ini" value={rp(x.salesToday.total)} sub={`${x.salesToday.count} invoice`} to="/penjualan" />
        <Stat label="Penjualan bulan ini" value={rp(x.salesMonth.total)} sub={`${x.salesMonth.count} invoice`} to="/penjualan" />
        <Stat label="Margin bulan ini" value={rp(x.marginMonth.margin)}
          sub={x.marginMonth.missingCost ? `${x.marginMonth.missingCost} baris belum ada harga beli` : 'semua baris ada harga beli'} to="/laporan" tone={x.marginMonth.margin < 0 ? 'text-red-600' : 'text-green-700'} />
        <Stat label="Piutang" value={rp(x.receivable.total)} sub={`lewat jatuh tempo: ${rp(x.receivable.overdue)} (${x.receivable.overdueCount} inv)`} to="/laporan"
          tone={x.receivable.overdue > 0 ? 'text-red-600' : ''} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h3 className="mb-2 font-semibold">Perlu ditindaklanjuti</h3>
          {!todo.length ? <p className="text-sm text-green-700">Semua beres 👍</p> : (
            <ul className="space-y-1 text-sm">
              {todo.map(([t, to]) => <li key={t}><Link className="text-sky-700 underline" to={to}>⚠ {t}</Link></li>)}
            </ul>
          )}
          <h3 className="mb-2 mt-4 font-semibold">Piutang lewat jatuh tempo terbesar</h3>
          {!x.topOverdue.length ? <p className="text-sm text-slate-500">Tidak ada.</p> : (
            <table className="w-full text-sm">
              <tbody>
                {x.topOverdue.map((p) => (
                  <tr key={p.party_id} className="border-t border-slate-200">
                    <td className="py-1">{p.party_name}</td>
                    <td className="py-1 text-xs text-slate-500">{p.invoices} invoice · terlama {p.oldestDays} hari</td>
                    <td className="py-1 text-right font-semibold text-red-600">{rp(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h3 className="mb-2 font-semibold">Saldo kas & bank</h3>
          <table className="w-full text-sm">
            <tbody>
              {x.cash.map((a) => (
                <tr key={a.id} className="border-t border-slate-200"><td className="py-1">{a.type === 'bank' ? '🏦' : '💵'} {a.name}</td><td className={`py-1 text-right font-semibold ${a.balance < 0 ? 'text-red-600' : ''}`}>{rp(a.balance)}</td></tr>
              ))}
              <tr className="border-t-2 border-slate-300 font-bold"><td className="py-1">Total</td><td className="py-1 text-right">{rp(x.cash.reduce((s, a) => s + a.balance, 0))}</td></tr>
            </tbody>
          </table>
          <div className="mt-2 text-xs text-slate-500">Hutang ke supplier: <b>{rp(x.payable.total)}</b></div>
          <Link to="/kas" className="mt-2 inline-block text-sm text-sky-700 underline">Buka Kas & Bank →</Link>
        </div>
      </div>
    </div>
  );
}
