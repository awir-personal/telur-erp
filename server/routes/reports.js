const express = require('express');
const { requirePerm } = require('../auth');
const { round2, agingBucket, AGING_BUCKETS, addDays, todayWIB, EPS, lineTotal } = require('../calc');
const { bad, log, tx, loadInvoices } = require('../lib');
const { parseSheet } = require('../importer');
const { isDefaultBranch, norm } = require('../hariHari');
const { bumpCounter } = require('./invoices');

module.exports = function reportRoutes(pool) {
  const r = express.Router();
  const kindOf = (k) => (k === 'purchase' ? 'purchase' : 'sale');

  // Umur piutang (sale) / hutang (purchase) per pihak.
  r.get('/reports/aging', async (req, res) => {
    const kind = kindOf(req.query.kind);
    const asOf = req.query.as_of || todayWIB();
    const invs = (await loadInvoices(pool, req.cid, 'i.kind = ? AND i.date <= ?', [kind, asOf])).filter((i) => Math.abs(i.outstanding) >= EPS);
    const [credits] = await pool.query(`SELECT p.party_id, SUM(p.amount - COALESCE((SELECT SUM(a.amount) FROM allocations a WHERE a.payment_id = p.id),0)) AS unallocated
      FROM payments p WHERE p.company_id = ? AND p.kind = ? AND p.date <= ? GROUP BY p.party_id`, [req.cid, kind, asOf]);
    const parties = new Map();
    const row = (id, name) => {
      if (!parties.has(id)) parties.set(id, { party_id: id, party_name: name, ...Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])), total: 0, unallocated: 0, invoices: [] });
      return parties.get(id);
    };
    for (const i of invs) {
      const p = row(i.party_id, i.party_name);
      const b = agingBucket(i.due_date, asOf);
      p[b] = round2(p[b] + i.outstanding);
      p.total = round2(p.total + i.outstanding);
      p.invoices.push({ id: i.id, number: i.number, date: i.date, due_date: i.due_date, total: i.total, outstanding: i.outstanding, bucket: b });
    }
    for (const c of credits) {
      if (Math.abs(c.unallocated) < EPS) continue;
      const [[pt]] = await pool.query('SELECT name FROM parties WHERE id = ?', [c.party_id]);
      row(c.party_id, pt.name).unallocated = round2(c.unallocated);
    }
    const rows = [...parties.values()].sort((a, b) => b.total - a.total);
    const totals = Object.fromEntries([...AGING_BUCKETS, 'total', 'unallocated'].map((k) => [k, round2(rows.reduce((s, x) => s + x[k], 0))]));
    res.json({ asOf, rows, totals });
  });

  // Margin penjualan: harga jual vs harga beli yang diketik per baris invoice.
  r.get('/reports/margin', async (req, res) => {
    const from = req.query.from || addDays(todayWIB(), -30);
    const to = req.query.to || todayWIB();
    const invs = await loadInvoices(pool, req.cid, 'i.kind = "sale" AND i.date BETWEEN ? AND ?', [from, to]);
    const rows = invs.map((i) => {
      const costed = i.lines.filter((l) => l.cost_price != null);
      const salesCosted = round2(costed.reduce((s, l) => s + lineTotal(l), 0));
      const cost = round2(costed.reduce((s, l) => s + round2(l.qty * l.cost_price), 0));
      return { id: i.id, number: i.number, date: i.date, party_name: i.party_name, total: i.total, salesCosted, cost, margin: round2(salesCosted - cost), missingCost: i.lines.length - costed.length };
    });
    const group = (key) => {
      const m = new Map();
      for (const x of rows) {
        const g = m.get(x[key]) || { key: x[key], total: 0, salesCosted: 0, cost: 0, margin: 0, invoices: 0, missingCost: 0 };
        for (const f of ['total', 'salesCosted', 'cost', 'margin']) g[f] = round2(g[f] + x[f]);
        g.invoices++; g.missingCost += x.missingCost;
        m.set(x[key], g);
      }
      return [...m.values()];
    };
    res.json({ from, to, rows, byParty: group('party_name').sort((a, b) => b.margin - a.margin), byDate: group('date').sort((a, b) => a.key.localeCompare(b.key)) });
  });

  // Info stok: pembelian masuk vs penjualan keluar per barang (dikonversi ke kg bila satuan punya kg_per_unit).
  r.get('/reports/stock', async (req, res) => {
    const from = req.query.from || addDays(todayWIB(), -30);
    const to = req.query.to || todayWIB();
    const [rows] = await pool.query(`SELECT i.kind, i.date, it.name AS item, it.sort_order, u.name AS unit, u.kg_per_unit, l.qty
      FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN items it ON it.id = l.item_id JOIN units u ON u.id = l.unit_id
      WHERE i.company_id = ? AND i.date <= ? ORDER BY i.date`, [req.cid, to]);
    const items = new Map();
    for (const x of rows) {
      const unit = x.kg_per_unit ? 'kg' : x.unit;
      const qty = x.kg_per_unit ? x.qty * x.kg_per_unit : x.qty;
      const key = `${x.item}|${unit}`;
      const it = items.get(key) || { item: x.item, unit, sort: x.sort_order, opening: 0, in: 0, out: 0, days: new Map() };
      const sign = x.kind === 'purchase' ? 1 : -1;
      if (x.date < from) it.opening += sign * qty;
      else {
        const d = it.days.get(x.date) || { date: x.date, in: 0, out: 0 };
        if (sign > 0) { d.in += qty; it.in += qty; } else { d.out += qty; it.out += qty; }
        it.days.set(x.date, d);
      }
      items.set(key, it);
    }
    const out = [...items.values()].sort((a, b) => a.sort - b.sort).map((it) => {
      let bal = it.opening;
      const days = [...it.days.values()].map((d) => { bal += d.in - d.out; return { date: d.date, in: round2(d.in), out: round2(d.out), balance: round2(bal) }; });
      return { item: it.item, unit: it.unit, opening: round2(it.opening), in: round2(it.in), out: round2(it.out), closing: round2(bal), days };
    });
    res.json({ from, to, items: out });
  });

  // ===== Import sheet penjualan =====
  // Import ulang tidak boleh dobel (v3.3: 1 baris = 1 invoice, nomor boleh sama). Invoice yang sudah ada per
  // nomor: import_seq NULL = diketik manual / hasil import lama yang MENGGABUNG baris -> semua baris nomor itu
  // dilewati (sudah tercakup); selain itu dilewati per urutan kemunculan (seq).
  async function existingImports(db, cid, invoices) {
    const nums = [...new Set(invoices.map((i) => i.number))];
    const m = new Map();
    if (!nums.length) return m;
    const [rows] = await db.query('SELECT number, import_seq FROM invoices WHERE company_id = ? AND kind = "sale" AND number IN (?)', [cid, nums]);
    for (const r of rows) {
      if (!m.has(r.number)) m.set(r.number, { legacy: false, seqs: new Set() });
      if (r.import_seq == null) m.get(r.number).legacy = true;
      else m.get(r.number).seqs.add(r.import_seq);
    }
    return m;
  }
  function skipReason(ex, inv) {
    const e = ex.get(inv.number);
    if (!e) return null;
    if (e.legacy) return 'nomor sudah ada';
    return e.seqs.has(inv.seq) ? 'baris ini sudah pernah diimport' : null;
  }
  // v4.2 Sheet format GTA: customer cabang Hari-Hari dihitung rumus Hari-Hari. Customer yang sudah ada -> tanda di master
  // (hh_branch); customer baru -> pilihan user di pratinjau (body.hhNames), awalnya dicentang hanya untuk 13 cabang yang dikenal.
  async function planOf(db, cid, body) {
    const opt = { numberFormat: body.numberFormat };
    const first = parseSheet(body.rows || [], opt);
    if (first.error) throw bad(first.error);
    if (first.format !== 'gta') return first;
    if (cid === 1) throw bad('Ini sheet format GTA (kolom No Nota Tagihan / No Receive) — pilih perusahaan GTA di header dulu');
    const names = [...new Map(first.invoices.map((i) => [norm(i.partyName), i.partyName])).values()];
    const [ps] = names.length ? await db.query('SELECT name, hh_branch FROM parties WHERE company_id = ? AND kind = "customer" AND name IN (?)', [cid, names]) : [[]];
    const known = new Map(ps.map((p) => [norm(p.name), !!p.hh_branch]));
    const chosen = Array.isArray(body.hhNames) ? new Set(body.hhNames.map(norm)) : null;
    const isHH = (n) => (known.has(norm(n)) ? known.get(norm(n)) : chosen ? chosen.has(norm(n)) : isDefaultBranch(n));
    const plan = parseSheet(body.rows, { ...opt, isHH });
    plan.newParties = names.filter((n) => !known.has(norm(n))).map((name) => ({ name, hh: isHH(name) }));
    plan.isHH = isHH;
    return plan;
  }

  r.post('/import/preview', requirePerm('import'), async (req, res) => {
    const plan = await planOf(pool, req.cid, req.body);
    delete plan.isHH;
    const ex = await existingImports(pool, req.cid, plan.invoices);
    for (const inv of plan.invoices) inv.exists = !!skipReason(ex, inv);
    res.json(plan);
  });

  r.post('/import/commit', requirePerm('import'), async (req, res) => {
    const plan = await planOf(pool, req.cid, req.body);
    if (plan.errors.length && !req.body.ignoreErrors) throw bad('Masih ada baris error — perbaiki sheet atau centang "lewati baris error"');
    const result = await tx(pool, async (c) => {
      const cache = { party: new Map(), item: new Map(), unit: new Map() };
      const created = { customers: [], items: [], units: [] };
      async function unitId(name) {
        const k = name.toLowerCase();
        if (cache.unit.has(k)) return cache.unit.get(k);
        let [[u]] = await c.query('SELECT id FROM units WHERE name = ?', [k]);
        if (!u) { const [ins] = await c.query('INSERT INTO units (name) VALUES (?)', [k]); u = { id: ins.insertId }; created.units.push(k); }
        cache.unit.set(k, u.id);
        return u.id;
      }
      async function itemId(name, unitName) {
        const k = name.toLowerCase();
        if (cache.item.has(k)) return cache.item.get(k);
        let [[it]] = await c.query('SELECT id FROM items WHERE name = ?', [name]);
        if (!it) {
          const [ins] = await c.query('INSERT INTO items (name, default_unit_id, sort_order) VALUES (?, ?, 100)', [name, await unitId(unitName)]);
          it = { id: ins.insertId }; created.items.push(name);
        }
        cache.item.set(k, it.id);
        return it.id;
      }
      async function party(name) {
        const k = name.toLowerCase();
        if (cache.party.has(k)) return cache.party.get(k);
        let [[p]] = await c.query('SELECT id, term_days FROM parties WHERE company_id = ? AND kind = "customer" AND name = ?', [req.cid, name]);
        if (!p) {
          const hh = plan.isHH?.(name) ? 1 : 0;
          const [ins] = await c.query('INSERT INTO parties (company_id, kind, name, hh_branch) VALUES (?, "customer", ?, ?)', [req.cid, name, hh]);
          p = { id: ins.insertId, term_days: 30 }; created.customers.push(hh ? `${name} (cabang Hari-Hari)` : name);
        }
        cache.party.set(k, p);
        return p;
      }
      const imported = [], skipped = [];
      const ex = await existingImports(c, req.cid, plan.invoices);
      const done = []; // { inv, id, partyId, room }
      for (const inv of plan.invoices) {
        const label = inv.dupCount > 1 ? `${inv.number} (baris ${inv.rows[0]})` : inv.number;
        const why = skipReason(ex, inv);
        if (why) { skipped.push(`${label}: ${why}`); continue; }
        if (!inv.lines.length) { skipped.push(`${label}: tidak ada baris barang`); continue; }
        const p = await party(inv.partyName);
        const [ins] = await c.query('INSERT INTO invoices SET ?', [{
          company_id: req.cid, kind: 'sale', number: inv.number, import_seq: inv.seq, date: inv.date, party_id: p.id, due_date: addDays(inv.date, p.term_days),
          po_ref: inv.poRef, notes: inv.notes, imported_total: inv.importedTotal, created_by: req.user.id, updated_by: req.user.id,
          ref_pi: inv.refPi || null, ref_gr: inv.refGr || null, hh_susut: inv.hh ? inv.hh.susut : null, hh_disc: inv.hh ? inv.hh.disc : null,
        }]);
        const lineRows = [];
        for (const [i, l] of inv.lines.entries()) lineRows.push([ins.insertId, await itemId(l.itemName, l.unitName), await unitId(l.unitName), l.qty, l.price, null, null, i]);
        await c.query('INSERT INTO invoice_lines (invoice_id, item_id, unit_id, qty, price, cost_price, note, sort) VALUES ?', [lineRows]);
        if (inv.hh && inv.hh.disc) {
          await c.query('INSERT INTO adjustments SET ?', [{
            invoice_id: ins.insertId, date: inv.date, type: 'diskon', amount: inv.hh.disc, qty: null, created_by: req.user.id,
            note: `Hari-Hari: tagihan ${inv.hh.kgTagih} kg × harga − 0,25%; kirim +2%${inv.hh.susut ? ` + susut ${inv.hh.susut} kg` : ''}`,
          }]);
        }
        done.push({ inv, id: ins.insertId, partyId: p.id, room: inv.computedTotal });
        await bumpCounter(c, req.cid, 'sale', inv.number);
        imported.push(label);
      }
      // Pembayaran (kolom Nominal) baris itu: dialokasikan ke invoice barisnya dulu, sisanya ke invoice lain
      // bernomor SAMA & customer sama (mis. 3860: Nominal di baris ke-2 membayar baris ke-1 juga). Angka sheet
      // tidak diubah; sisa yang tetap tak teralokasi jadi "uang masuk belum dialokasikan".
      for (const d of done) {
        const targets = [d, ...done.filter((o) => o !== d && o.inv.number === d.inv.number && o.partyId === d.partyId)];
        for (const pay of d.inv.payments) {
          const [pi] = await c.query('INSERT INTO payments SET ?', [{ company_id: req.cid, kind: 'sale', date: pay.date, party_id: d.partyId, method: pay.method, amount: pay.amount, notes: pay.note, created_by: req.user.id }]);
          let left = pay.amount;
          for (const t of targets) {
            const alloc = round2(Math.min(left, Math.max(t.room, 0)));
            if (alloc <= 0) continue;
            await c.query('INSERT INTO allocations (payment_id, invoice_id, amount) VALUES (?,?,?)', [pi.insertId, t.id, alloc]);
            t.room = round2(t.room - alloc);
            left = round2(left - alloc);
          }
        }
      }
      return { imported, skipped, created };
    });
    await log(pool, req.user, 'import', 'invoice_sale', null, { count: result.imported.length, skipped: result.skipped, created: result.created });
    res.json(result);
  });

  return r;
};
