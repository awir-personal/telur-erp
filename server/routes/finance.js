// Laporan keuangan (jurnal, buku besar, laba rugi, neraca, arus kas), jurnal memorial, dan backup.
const zlib = require('zlib');
const express = require('express');
const { requirePerm } = require('../auth');
const { round2, todayWIB, addDays } = require('../calc');
const { bad, log, tx, reqDate, reqNum, reqStr, optStr, HttpError } = require('../lib');
const J = require('../journal');
const { movements } = require('./cash');

// Urutan tabel untuk backup/restore (induk dulu).
const BACKUP_TABLES = ['users', 'settings', 'parties', 'units', 'items', 'party_prices', 'invoices', 'invoice_lines', 'payments', 'allocations',
  'adjustments', 'accounts', 'cash_categories', 'cash_txns', 'bank_lines', 'journal_entries', 'journal_lines', 'activity_log'];

module.exports = function financeRoutes(pool) {
  const r = express.Router();
  const range = (q) => ({ from: q.from || todayWIB().slice(0, 8) + '01', to: q.to || todayWIB() });

  r.get('/coa', async (req, res) => res.json([...(await J.chartOfAccounts(pool)).values()]));

  r.get('/reports/journal', async (req, res) => {
    const { from, to } = range(req.query);
    const coa = await J.chartOfAccounts(pool);
    const entries = (await J.buildEntries(pool, to)).filter((e) => e.date >= from);
    res.json({ from, to, entries: entries.map((e) => ({ ...e, lines: e.lines.map((l) => ({ ...l, name: coa.get(l.coa)?.name || l.coa })) })) });
  });

  // Neraca saldo + buku besar satu akun.
  r.get('/reports/ledger', async (req, res) => {
    const { from, to } = range(req.query);
    const coa = await J.chartOfAccounts(pool);
    const entries = await J.buildEntries(pool, to);
    const before = J.balances(entries, '0000-00-00', addDays(from, -1));
    const during = J.balances(entries, from, to);
    const codes = [...new Set([...coa.keys(), ...before.keys(), ...during.keys()])];
    const trial = codes.map((code) => {
      const o = before.get(code) || { debit: 0, credit: 0 };
      const d = during.get(code) || { debit: 0, credit: 0 };
      return { code, name: coa.get(code)?.name || code, group: coa.get(code)?.group || '?', opening: round2(o.debit - o.credit), debit: d.debit, credit: d.credit, closing: round2(o.debit - o.credit + d.debit - d.credit) };
    }).filter((x) => x.opening || x.debit || x.credit);
    let detail = null;
    if (req.query.coa) {
      const o = before.get(req.query.coa) || { debit: 0, credit: 0 };
      let bal = round2(o.debit - o.credit);
      const opening = bal;
      detail = { coa: req.query.coa, name: coa.get(req.query.coa)?.name || req.query.coa, opening, rows: [] };
      for (const e of entries) {
        if (e.date < from) continue;
        for (const l of e.lines) {
          if (l.coa !== req.query.coa) continue;
          bal = round2(bal + l.debit - l.credit);
          detail.rows.push({ date: e.date, memo: e.memo, src: e.src, ref: e.ref, debit: l.debit, credit: l.credit, balance: bal });
        }
      }
    }
    res.json({ from, to, trial, totals: { debit: round2(trial.reduce((s, x) => s + x.debit, 0)), credit: round2(trial.reduce((s, x) => s + x.credit, 0)) }, detail });
  });

  r.get('/reports/profit-loss', async (req, res) => { const { from, to } = range(req.query); res.json(await J.profitLoss(pool, from, to)); });
  r.get('/reports/balance-sheet', async (req, res) => res.json(await J.balanceSheet(pool, req.query.as_of || todayWIB())));

  // Arus kas sederhana (metode langsung) dari mutasi rekening.
  r.get('/reports/cashflow', async (req, res) => {
    const { from, to } = range(req.query);
    const [accs] = await pool.query('SELECT * FROM accounts');
    const all = await movements(pool, { to });
    const [cats] = await pool.query('SELECT id, name FROM cash_categories');
    const [txn] = await pool.query('SELECT id, category_id FROM cash_txns');
    const catOf = new Map(txn.map((t) => [t.id, cats.find((c) => c.id === t.category_id)?.name]));
    const inRange = (a, m) => (!a.opening_date || m.date >= a.opening_date);
    let opening = 0;
    const groups = new Map();
    for (const a of accs) {
      let bal = Number(a.opening_balance);
      for (const m of all) {
        if (m.account_id !== a.id || !inRange(a, m)) continue;
        if (m.date < from) { bal += m.amount; continue; }
        if (m.kind === 'transfer') continue; // antar rekening sendiri: net nol
        const key = m.src === 'payment' ? (m.amount > 0 ? 'Penerimaan dari customer' : 'Pembayaran ke supplier')
          : m.kind === 'biaya' ? `Biaya: ${catOf.get(m.ref_id) || '-'}` : m.kind === 'pemasukan' ? `Pemasukan lain: ${catOf.get(m.ref_id) || '-'}`
            : m.kind === 'modal' ? 'Setoran modal' : 'Penarikan pemilik (prive)';
        groups.set(key, round2((groups.get(key) || 0) + m.amount));
      }
      opening += a.opening_date && a.opening_date > from ? 0 : bal;
    }
    const rows = [...groups.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
    const change = round2(rows.reduce((s, x) => s + x.amount, 0));
    // Saldo awal rekening yang dibuka DI DALAM periode dicatat terpisah.
    const openedInRange = round2(accs.filter((a) => a.opening_date && a.opening_date > from && a.opening_date <= to).reduce((s, a) => s + Number(a.opening_balance), 0));
    res.json({ from, to, opening: round2(opening), rows, change, openedInRange, closing: round2(opening + change + openedInRange) });
  });

  // ===== Jurnal memorial (manual) =====
  r.get('/journals', async (req, res) => {
    const { from, to } = range(req.query);
    const [es] = await pool.query('SELECT e.*, u.name AS created_by_name FROM journal_entries e LEFT JOIN users u ON u.id = e.created_by WHERE e.date BETWEEN ? AND ? ORDER BY e.date, e.id', [from, to]);
    const [ls] = es.length ? await pool.query('SELECT * FROM journal_lines WHERE entry_id IN (?) ORDER BY id', [es.map((e) => e.id)]) : [[]];
    res.json(es.map((e) => ({ ...e, lines: ls.filter((l) => l.entry_id === e.id) })));
  });
  r.post('/journals', requirePerm('cash'), async (req, res) => {
    const date = reqDate(req.body.date);
    const memo = reqStr(req.body.memo, 'Keterangan');
    const coa = await J.chartOfAccounts(pool);
    const lines = (Array.isArray(req.body.lines) ? req.body.lines : []).map((l, i) => {
      if (!coa.has(l.coa)) throw bad(`Baris ${i + 1}: akun tidak dikenal`);
      const debit = round2(Number(l.debit) || 0);
      const credit = round2(Number(l.credit) || 0);
      if (debit < 0 || credit < 0 || (debit && credit) || (!debit && !credit)) throw bad(`Baris ${i + 1}: isi debit ATAU kredit (positif)`);
      return [l.coa, debit, credit, optStr(l.note)];
    });
    if (lines.length < 2) throw bad('Minimal 2 baris');
    const d = round2(lines.reduce((s, l) => s + l[1], 0));
    const c = round2(lines.reduce((s, l) => s + l[2], 0));
    if (d !== c) throw bad(`Jurnal tidak seimbang: debit ${d} ≠ kredit ${c}`);
    const id = await tx(pool, async (cn) => {
      const [ins] = await cn.query('INSERT INTO journal_entries (date, memo, created_by) VALUES (?,?,?)', [date, memo, req.user.id]);
      await cn.query('INSERT INTO journal_lines (entry_id, coa, debit, credit, note) VALUES ?', [lines.map((l) => [ins.insertId, ...l])]);
      return ins.insertId;
    });
    await log(pool, req.user, 'create', 'journal', id, { date, memo, lines });
    res.json({ id });
  });
  r.delete('/journals/:id', requirePerm('cash'), async (req, res) => {
    const [[e]] = await pool.query('SELECT * FROM journal_entries WHERE id = ?', [req.params.id]);
    if (!e) throw new HttpError(404, 'Jurnal tidak ditemukan');
    const [ls] = await pool.query('SELECT coa, debit, credit FROM journal_lines WHERE entry_id = ?', [e.id]);
    await pool.query('DELETE FROM journal_entries WHERE id = ?', [e.id]);
    await log(pool, req.user, 'delete', 'journal', e.id, { date: e.date, memo: e.memo, lines: ls });
    res.json({ ok: true });
  });

  // ===== Backup (master) =====
  r.get('/backup', async (req, res) => {
    if (req.user.role !== 'master') return res.status(403).json({ error: 'Hanya master user' });
    const tables = {};
    for (const t of BACKUP_TABLES) tables[t] = (await pool.query(`SELECT * FROM \`${t}\``))[0];
    const [mig] = await pool.query('SELECT id FROM schema_migrations');
    const at = new Date().toISOString();
    const body = zlib.gzipSync(JSON.stringify({ app: 'telur-erp', version: require('../../package.json').version, created_at: at, migrations: mig.map((m) => m.id), tables }));
    await pool.query("INSERT INTO settings (k, v) VALUES ('last_backup_at', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", [at]);
    await log(pool, req.user, 'backup', 'database', null, { bytes: body.length, rows: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])) });
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="telur-erp-backup-${todayWIB()}.json.gz"`);
    res.send(body);
  });

  return r;
};

module.exports.BACKUP_TABLES = BACKUP_TABLES;
