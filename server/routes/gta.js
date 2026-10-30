// v4.1 "Tarik dari APG": penjualan APG (perusahaan 1) ke customer bertanda Pembelian GTA (parties.gta_purchase)
// = PEMBELIAN perusahaan aktif (GTA) dari supplier "APG / Farm". Pola sama dengan import (keputusan user 2026-10-29):
// yang baru ditarik, yang berubah di APG DILAPORKAN (bisa diterapkan), yang hilang dari APG dilaporkan - tidak ada
// yang berubah / terhapus diam-diam. Pembayaran GTA ke APG dicatat sendiri di Uang Keluar (tidak disalin).
const express = require('express');
const { requirePerm } = require('../auth');
const { addDays, round2 } = require('../calc');
const { bad, log, skey, tx, loadInvoices } = require('../lib');

const SOURCE = 1; // APG
const SUPPLIER_NAME = 'APG / Farm'; // nama supplier di ESB GTA (file ESB Simple Purchase lama user)
const SUPPLIER_TERM = 90; // Purchase Credit Term GTA = 90 hari (keputusan user di app GTA)

const lineKey = (l) => `${l.item_id}|${l.unit_id}|${round2(l.qty)}|${round2(l.price)}`;
const lineText = (l) => `${l.item_name} ${Number(l.qty)} ${l.unit_name} × ${Number(l.price)}`;

// Perbedaan invoice APG (sumber) vs nota GTA (salinan), dalam kalimat yang bisa dibaca user.
function diffCopy(src, copy) {
  const out = [];
  if (src.number !== copy.number) out.push(`No Inv ${copy.number} → ${src.number}`);
  if (src.date !== copy.date) out.push(`Tanggal ${copy.date} → ${src.date}`);
  const a = src.lines.map(lineKey).sort().join(';');
  const b = copy.lines.map(lineKey).sort().join(';');
  if (a !== b) out.push(`Barang: ${copy.lines.map(lineText).join(', ')} → ${src.lines.map(lineText).join(', ')}`);
  return out;
}

const brief = (i) => ({ id: i.id, number: i.number, date: i.date, party_name: i.party_name, total: i.total, lines: i.lines.map(lineText) });

async function buildPlan(db, cid) {
  if (cid === SOURCE) throw bad('Tarik dari APG hanya untuk perusahaan selain APG (pilih GTA di header)');
  const src = await loadInvoices(db, SOURCE, "i.kind = 'sale' AND p.gta_purchase = 1", [], 'i.date, LENGTH(i.number), i.number, i.id');
  const copies = await loadInvoices(db, cid, "i.kind = 'purchase' AND i.source_invoice_id IS NOT NULL", []);
  const byS = new Map(copies.map((c) => [c.source_invoice_id, c]));
  const fresh = [];
  const changed = [];
  let same = 0;
  for (const s of src) {
    const c = byS.get(s.id);
    if (!c) { fresh.push(s); continue; }
    byS.delete(s.id);
    const beda = diffCopy(s, c);
    if (beda.length) changed.push({ copyId: c.id, source: s, copy: c, beda });
    else same++;
  }
  // salinan yang sumbernya sudah tidak ada / tidak bertanda GTA lagi -> dilaporkan, tidak dihapus otomatis
  const orphan = [...byS.values()];
  return { fresh, changed, same, orphan };
}

// Supplier "APG / Farm" di perusahaan aktif: diingat id-nya (boleh diganti nama), dibuat otomatis kalau belum ada.
async function apgSupplier(c, cid) {
  const key = skey(cid, 'apg_supplier_id');
  const [[s]] = await c.query('SELECT v FROM settings WHERE k = ?', [key]);
  if (s) {
    const [[p]] = await c.query('SELECT * FROM parties WHERE id = ? AND company_id = ? AND kind = "supplier"', [Number(s.v), cid]);
    if (p) return { party: p, created: false };
  }
  let [[p]] = await c.query('SELECT * FROM parties WHERE company_id = ? AND kind = "supplier" AND name = ?', [cid, SUPPLIER_NAME]);
  let created = false;
  if (!p) {
    const [ins] = await c.query('INSERT INTO parties (company_id, kind, name, term_days, notes) VALUES (?, "supplier", ?, ?, ?)',
      [cid, SUPPLIER_NAME, SUPPLIER_TERM, 'Dibuat otomatis oleh "Tarik dari APG"']);
    [[p]] = await c.query('SELECT * FROM parties WHERE id = ?', [ins.insertId]);
    created = true;
  }
  await c.query('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [key, String(p.id)]);
  return { party: p, created };
}

const linesOf = (invId, src) => src.lines.map((l, i) => [invId, l.item_id, l.unit_id, l.qty, l.price, null, l.note, i]);
const noteOf = (s) => `Dari APG: penjualan ke ${s.party_name} No Inv ${s.number}`;

module.exports = function gtaRoutes(pool) {
  const r = express.Router();

  r.get('/gta/apg-plan', async (req, res) => {
    const p = await buildPlan(pool, req.cid);
    res.json({
      fresh: p.fresh.map(brief), same: p.same,
      changed: p.changed.map((x) => ({ copyId: x.copyId, number: x.copy.number, date: x.copy.date, party_name: x.source.party_name, beda: x.beda, paid: x.copy.paid })),
      orphan: p.orphan.map((o) => ({ ...brief(o), paid: o.paid })),
    });
  });

  // body: { createNew: true, apply: [copyId, ...] } - tarik yang baru dan/atau terapkan perubahan yang dipilih
  r.post('/gta/apg-pull', requirePerm('invoice'), async (req, res) => {
    const apply = new Set((Array.isArray(req.body.apply) ? req.body.apply : []).map(Number));
    const createNew = req.body.createNew !== false;
    const result = await tx(pool, async (c) => {
      const p = await buildPlan(c, req.cid);
      const { party, created } = await apgSupplier(c, req.cid);
      const added = [];
      if (createNew) {
        for (const s of p.fresh) {
          const [ins] = await c.query('INSERT INTO invoices SET ?', [{
            company_id: req.cid, kind: 'purchase', number: s.number, date: s.date, party_id: party.id, due_date: addDays(s.date, party.term_days),
            po_ref: s.po_ref, notes: noteOf(s), source_invoice_id: s.id, created_by: req.user.id, updated_by: req.user.id,
          }]);
          await c.query('INSERT INTO invoice_lines (invoice_id, item_id, unit_id, qty, price, cost_price, note, sort) VALUES ?', [linesOf(ins.insertId, s)]);
          added.push(s.number);
        }
      }
      const applied = [];
      for (const x of p.changed) {
        if (!apply.has(x.copyId)) continue;
        await c.query('UPDATE invoices SET number = ?, date = ?, po_ref = ?, updated_by = ? WHERE id = ? AND company_id = ?',
          [x.source.number, x.source.date, x.source.po_ref, req.user.id, x.copyId, req.cid]);
        await c.query('DELETE FROM invoice_lines WHERE invoice_id = ?', [x.copyId]);
        await c.query('INSERT INTO invoice_lines (invoice_id, item_id, unit_id, qty, price, cost_price, note, sort) VALUES ?', [linesOf(x.copyId, x.source)]);
        applied.push({ number: x.source.number, beda: x.beda });
      }
      return { added, applied, supplier: party.name, supplierCreated: created };
    });
    await log(pool, req.user, 'pull_apg', 'invoice_purchase', null, { added: result.added.length, applied: result.applied, supplierCreated: result.supplierCreated });
    res.json(result);
  });

  return r;
};

module.exports.diffCopy = diffCopy;
