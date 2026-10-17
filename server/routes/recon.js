// Rekonsiliasi bank: impor mutasi rekening → cocokkan dengan transaksi di sistem.
const crypto = require('crypto');
const express = require('express');
const { requirePerm } = require('../auth');
const { round2, daysBetween } = require('../calc');
const { bad, log, tx, reqNum, optStr, HttpError } = require('../lib');
const { parseBank } = require('../bankParser');
const { movements, balanceOf } = require('./cash');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const AUTO_DAYS = 3; // auto-cocok: nominal sama persis & selisih tanggal ≤ 3 hari
const CAND_DAYS = 31;

module.exports = function reconRoutes(pool) {
  const r = express.Router();
  const W = requirePerm('cash');

  async function account(id) {
    const [[a]] = await pool.query('SELECT * FROM accounts WHERE id = ?', [id]);
    if (!a) throw bad('Rekening tidak ditemukan');
    return a;
  }

  // Item sistem untuk rekening ini (+ pembayaran tanpa rekening sebagai kandidat), dengan status sudah dicocokkan atau belum.
  async function systemItems(accountId) {
    const own = (await movements(pool, { accountId })).filter((m) => m.account_id === Number(accountId));
    const [noAcc] = await pool.query(`SELECT p.id, p.date, p.kind, p.amount, pt.name AS party_name, p.reference FROM payments p
      JOIN parties pt ON pt.id = p.party_id WHERE p.account_id IS NULL`);
    const items = [
      ...own.map((m) => ({ src: m.src, id: m.ref_id, date: m.date, amount: round2(m.amount), label: m.label, note: m.note, assigned: true })),
      ...noAcc.map((p) => ({ src: 'payment', id: p.id, date: p.date, amount: round2(p.kind === 'sale' ? p.amount : -p.amount),
        label: `${p.kind === 'sale' ? 'Terima dari' : 'Bayar ke'} ${p.party_name}`, note: p.reference, assigned: false })),
    ];
    const [matched] = await pool.query("SELECT match_src, match_id, id FROM bank_lines WHERE account_id = ? AND status = 'matched'", [accountId]);
    const used = new Map(matched.map((x) => [`${x.match_src}-${x.match_id}`, x.id]));
    return items.map((i) => ({ ...i, lineId: used.get(`${i.src}-${i.id}`) || null }));
  }

  async function autoMatch(accountId) {
    const [lines] = await pool.query("SELECT * FROM bank_lines WHERE account_id = ? AND status = 'unmatched' ORDER BY date, id", [accountId]);
    const items = (await systemItems(accountId)).filter((i) => i.assigned && !i.lineId);
    let n = 0;
    for (const l of lines) {
      const c = items.filter((i) => !i.lineId && Math.abs(i.amount - Number(l.amount)) < 0.005 && Math.abs(daysBetween(i.date, l.date)) <= AUTO_DAYS);
      if (!c.length) continue;
      c.sort((a, b) => Math.abs(daysBetween(a.date, l.date)) - Math.abs(daysBetween(b.date, l.date)));
      // Ragu (dua kandidat sama dekat) → biarkan user yang memilih.
      if (c.length > 1 && Math.abs(daysBetween(c[0].date, l.date)) === Math.abs(daysBetween(c[1].date, l.date))) continue;
      await pool.query("UPDATE bank_lines SET status = 'matched', match_src = ?, match_id = ? WHERE id = ?", [c[0].src, c[0].id, l.id]);
      c[0].lineId = l.id;
      n++;
    }
    return n;
  }

  const parseBody = (b) => parseBank(b.rows || [], {
    preset: b.preset, direction: b.direction, year: b.year ? Number(b.year) : null,
    mapping: b.mapping || null, headerRow: b.mapping ? Number(b.headerRow) - 1 : undefined,
  });

  r.post('/recon/preview', W, async (req, res) => {
    const a = await account(req.body.account_id);
    const p = parseBody(req.body);
    if (p.error) return res.json({ error: p.error, columns: (req.body.rows || []).slice(0, 15) });
    const keys = p.lines.map((l) => sha(l.key));
    const [have] = keys.length ? await pool.query('SELECT line_key FROM bank_lines WHERE account_id = ? AND line_key IN (?)', [a.id, keys]) : [[]];
    const exist = new Set(have.map((h) => h.line_key));
    p.lines.forEach((l, i) => { l.exists = exist.has(keys[i]); });
    res.json({ ...p, columns: (req.body.rows || []).slice(Math.max(0, p.headerRow - 1), p.headerRow + 4) });
  });

  r.post('/recon/import', W, async (req, res) => {
    const a = await account(req.body.account_id);
    const p = parseBody(req.body);
    if (p.error) throw bad(p.error);
    const batch = `${new Date().toISOString().slice(0, 19)} ${req.user.name}`.slice(0, 60);
    const vals = p.lines.map((l) => [a.id, l.date, l.description.slice(0, 500), l.amount, l.balance, sha(l.key), batch, req.user.id]);
    let inserted = 0;
    if (vals.length) {
      const [ins] = await pool.query('INSERT IGNORE INTO bank_lines (account_id, date, description, amount, balance, line_key, batch, created_by) VALUES ?', [vals]);
      inserted = ins.affectedRows;
    }
    const matched = await autoMatch(a.id);
    await log(pool, req.user, 'import', 'bank_lines', a.id, { account: a.name, read: p.lines.length, inserted, duplicates: p.lines.length - inserted, autoMatched: matched });
    res.json({ read: p.lines.length, inserted, duplicates: p.lines.length - inserted, autoMatched: matched });
  });

  r.post('/recon/auto-match', W, async (req, res) => {
    const a = await account(req.body.account_id);
    res.json({ matched: await autoMatch(a.id) });
  });

  r.get('/recon/lines', async (req, res) => {
    const a = await account(req.query.account_id);
    const where = ['l.account_id = ?'];
    const p = [a.id];
    if (req.query.status) { where.push('l.status = ?'); p.push(req.query.status); }
    if (req.query.from) { where.push('l.date >= ?'); p.push(req.query.from); }
    if (req.query.to) { where.push('l.date <= ?'); p.push(req.query.to); }
    const [lines] = await pool.query(`SELECT l.* FROM bank_lines l WHERE ${where.join(' AND ')} ORDER BY l.date, l.id`, p);
    const items = await systemItems(a.id);
    const byKey = new Map(items.map((i) => [`${i.src}-${i.id}`, i]));
    res.json(lines.map((l) => ({ ...l, match: l.match_src ? byKey.get(`${l.match_src}-${l.match_id}`) || null : null })));
  });

  // Ringkasan: saldo menurut bank vs menurut sistem pada tanggal mutasi terakhir.
  r.get('/recon/summary', async (req, res) => {
    const a = await account(req.query.account_id);
    const [[last]] = await pool.query('SELECT date, balance FROM bank_lines WHERE account_id = ? AND balance IS NOT NULL ORDER BY date DESC, id DESC LIMIT 1', [a.id]);
    const [[range]] = await pool.query('SELECT MIN(date) AS first, MAX(date) AS last FROM bank_lines WHERE account_id = ?', [a.id]);
    const [counts] = await pool.query('SELECT status, COUNT(*) AS n, SUM(amount) AS amt FROM bank_lines WHERE account_id = ? GROUP BY status', [a.id]);
    const items = await systemItems(a.id);
    const inRange = items.filter((i) => i.assigned && range.first && i.date >= range.first && i.date <= range.last);
    const asOf = last?.date || range.last;
    let system = null;
    if (asOf) system = balanceOf(a, await movements(pool, { accountId: a.id, to: asOf }), asOf).balance;
    res.json({
      account: a, statement: last ? { date: last.date, balance: last.balance } : null, system: asOf ? { date: asOf, balance: system } : null,
      difference: last && system != null ? round2(last.balance - system) : null, range,
      counts: Object.fromEntries(counts.map((c) => [c.status, { n: c.n, amount: round2(c.amt) }])),
      systemUnmatched: inRange.filter((i) => !i.lineId).map(({ lineId, ...i }) => i),
    });
  });

  r.get('/recon/candidates', async (req, res) => {
    const [[l]] = await pool.query('SELECT * FROM bank_lines WHERE id = ?', [req.query.line_id]);
    if (!l) throw new HttpError(404, 'Baris mutasi tidak ditemukan');
    const items = (await systemItems(l.account_id)).filter((i) => !i.lineId && Math.abs(daysBetween(i.date, l.date)) <= CAND_DAYS);
    const exact = items.filter((i) => Math.abs(i.amount - Number(l.amount)) < 0.005);
    const sameSign = req.query.all === '1' ? items.filter((i) => Math.sign(i.amount) === Math.sign(Number(l.amount)) && !exact.includes(i)) : [];
    const sort = (xs) => xs.sort((a, b) => Math.abs(daysBetween(a.date, l.date)) - Math.abs(daysBetween(b.date, l.date)));
    res.json({ line: l, exact: sort(exact), others: sort(sameSign).slice(0, 50) });
  });

  r.post('/recon/lines/:id/match', W, async (req, res) => {
    const [[l]] = await pool.query('SELECT * FROM bank_lines WHERE id = ?', [req.params.id]);
    if (!l) throw new HttpError(404, 'Baris mutasi tidak ditemukan');
    const src = req.body.src === 'cash' ? 'cash' : 'payment';
    const id = reqNum(req.body.id, 'Transaksi');
    const item = (await systemItems(l.account_id)).find((i) => i.src === src && i.id === id);
    if (!item) throw bad('Transaksi tidak ditemukan untuk rekening ini');
    if (item.lineId && item.lineId !== l.id) throw bad('Transaksi itu sudah dicocokkan dengan baris mutasi lain');
    if (Math.sign(item.amount) !== Math.sign(Number(l.amount))) throw bad('Arah uang berbeda (masuk vs keluar)');
    await tx(pool, async (c) => {
      // Pembayaran yang belum punya rekening otomatis diisi rekening ini.
      if (!item.assigned) await c.query('UPDATE payments SET account_id = ? WHERE id = ? AND account_id IS NULL', [l.account_id, id]);
      await c.query("UPDATE bank_lines SET status = 'matched', match_src = ?, match_id = ?, note = ? WHERE id = ?", [src, id, optStr(req.body.note), l.id]);
    });
    await log(pool, req.user, 'recon_match', 'bank_line', l.id, { src, id, amountBank: l.amount, amountSystem: item.amount, assignedAccount: !item.assigned });
    res.json({ ok: true, amountDifference: round2(Number(l.amount) - item.amount) });
  });

  r.post('/recon/lines/:id/unmatch', W, async (req, res) => {
    await pool.query("UPDATE bank_lines SET status = 'unmatched', match_src = NULL, match_id = NULL, note = NULL WHERE id = ?", [req.params.id]);
    await log(pool, req.user, 'recon_unmatch', 'bank_line', Number(req.params.id), null);
    res.json({ ok: true });
  });

  r.post('/recon/lines/:id/ignore', W, async (req, res) => {
    const note = optStr(req.body.note);
    if (!note) throw bad('Alasan wajib diisi');
    await pool.query("UPDATE bank_lines SET status = 'ignored', match_src = NULL, match_id = NULL, note = ? WHERE id = ?", [note, req.params.id]);
    await log(pool, req.user, 'recon_ignore', 'bank_line', Number(req.params.id), { note });
    res.json({ ok: true });
  });

  // Buat transaksi kas (biaya / pemasukan) langsung dari baris mutasi, lalu cocokkan.
  r.post('/recon/lines/:id/create-cash', W, async (req, res) => {
    const [[l]] = await pool.query('SELECT * FROM bank_lines WHERE id = ?', [req.params.id]);
    if (!l) throw new HttpError(404, 'Baris mutasi tidak ditemukan');
    if (l.status === 'matched') throw bad('Baris ini sudah dicocokkan');
    const [[cat]] = await pool.query('SELECT * FROM cash_categories WHERE id = ?', [req.body.category_id]);
    const kind = Number(l.amount) < 0 ? ['biaya', 'prive'] : ['pemasukan', 'modal'];
    if (!cat || !kind.includes(cat.kind)) throw bad(Number(l.amount) < 0 ? 'Pilih kategori biaya / prive' : 'Pilih kategori pemasukan / modal');
    const id = await tx(pool, async (c) => {
      const [ins] = await c.query('INSERT INTO cash_txns SET ?', [{
        date: l.date, kind: cat.kind, account_id: l.account_id, category_id: cat.id, amount: Math.abs(Number(l.amount)),
        reference: 'Mutasi bank', note: (optStr(req.body.note) || l.description).slice(0, 255), created_by: req.user.id,
      }]);
      await c.query("UPDATE bank_lines SET status = 'matched', match_src = 'cash', match_id = ? WHERE id = ?", [ins.insertId, l.id]);
      return ins.insertId;
    });
    await log(pool, req.user, 'create', `cash_${cat.kind}`, id, { fromBankLine: l.id, amount: l.amount });
    res.json({ id });
  });

  r.delete('/recon/batch', W, async (req, res) => {
    const a = await account(req.query.account_id);
    const [del] = await pool.query('DELETE FROM bank_lines WHERE account_id = ? AND batch = ?', [a.id, req.query.batch]);
    await log(pool, req.user, 'delete', 'bank_lines', a.id, { batch: req.query.batch, rows: del.affectedRows });
    res.json({ deleted: del.affectedRows });
  });

  r.get('/recon/batches', async (req, res) => {
    const [rows] = await pool.query(`SELECT batch, COUNT(*) AS n, MIN(date) AS first, MAX(date) AS last, SUM(status = 'matched') AS matched
      FROM bank_lines WHERE account_id = ? GROUP BY batch ORDER BY MIN(id) DESC`, [req.query.account_id]);
    res.json(rows);
  });

  return r;
};
