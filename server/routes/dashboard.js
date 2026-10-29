// Ringkasan halaman awal: angka penjualan, piutang/hutang, hal yang perlu ditindaklanjuti, saldo kas.
const express = require('express');
const { round2, todayWIB, addDays, daysBetween } = require('../calc');
const { loadInvoices } = require('../lib');
const { movements, balanceOf } = require('./cash');

const sum = (rows, f) => round2(rows.reduce((s, x) => s + f(x), 0));

module.exports = function dashboardRoutes(pool) {
  const r = express.Router();

  r.get('/dashboard', async (req, res) => {
    const today = req.query.today || todayWIB();
    const month = today.slice(0, 8) + '01';
    const sales = await loadInvoices(pool, 'i.kind = "sale"');
    const buys = await loadInvoices(pool, 'i.kind = "purchase"');

    const inMonth = sales.filter((i) => i.date >= month && i.date <= today);
    const costed = inMonth.flatMap((i) => i.lines).filter((l) => l.cost_price != null);
    const openSales = sales.filter((i) => i.outstanding > 0.004);
    const overdue = openSales.filter((i) => i.due_date < today);
    const openBuys = buys.filter((i) => i.outstanding > 0.004);

    // Piutang lewat jatuh tempo per customer (5 terbesar)
    const byParty = new Map();
    for (const i of overdue) {
      const p = byParty.get(i.party_id) || { party_id: i.party_id, party_name: i.party_name, amount: 0, invoices: 0, oldestDays: 0 };
      p.amount = round2(p.amount + i.outstanding);
      p.invoices++;
      p.oldestDays = Math.max(p.oldestDays, daysBetween(i.due_date, today));
      byParty.set(i.party_id, p);
    }

    const [unalloc] = await pool.query(`SELECT p.kind, SUM(p.amount - COALESCE((SELECT SUM(a.amount) FROM allocations a WHERE a.payment_id = p.id), 0)) AS amt
      FROM payments p GROUP BY p.kind`);
    const [accs] = await pool.query('SELECT * FROM accounts WHERE active = 1 ORDER BY sort_order, id');
    const moves = await movements(pool, { to: today });
    const [[setting]] = await pool.query("SELECT v FROM settings WHERE k = 'last_backup_at'");

    res.json({
      today,
      salesToday: { total: sum(sales.filter((i) => i.date === today), (i) => i.total), count: sales.filter((i) => i.date === today).length },
      salesMonth: { total: sum(inMonth, (i) => i.total), count: inMonth.length },
      marginMonth: {
        margin: sum(costed, (l) => l.qty * (l.price - l.cost_price)),
        salesCosted: sum(costed, (l) => l.qty * l.price),
        missingCost: inMonth.flatMap((i) => i.lines).length - costed.length,
      },
      receivable: { total: sum(openSales, (i) => i.outstanding), overdue: sum(overdue, (i) => i.outstanding), overdueCount: overdue.length },
      payable: {
        total: sum(openBuys, (i) => i.outstanding),
        dueSoon: sum(openBuys.filter((i) => i.due_date <= addDays(today, 7)), (i) => i.outstanding),
        dueSoonCount: openBuys.filter((i) => i.due_date <= addDays(today, 7)).length,
      },
      todo: {
        diffOpen: sales.concat(buys).filter((i) => i.diffOpen).length,
        dupOpen: sales.concat(buys).filter((i) => i.dupOpen).length,
        zeroPrice: sales.concat(buys).filter((i) => i.zeroPriceLines > 0).length,
        overpaid: sales.concat(buys).filter((i) => i.status === 'lebih_bayar').length,
        unallocatedSale: round2(unalloc.find((u) => u.kind === 'sale')?.amt || 0),
        unallocatedPurchase: round2(unalloc.find((u) => u.kind === 'purchase')?.amt || 0),
      },
      topOverdue: [...byParty.values()].sort((a, b) => b.amount - a.amount).slice(0, 5),
      cash: accs.map((a) => ({ id: a.id, name: a.name, type: a.type, ...balanceOf(a, moves, today) })),
      lastBackupAt: setting?.v || null,
    });
  });

  return r;
};
