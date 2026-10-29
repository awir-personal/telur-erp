const express = require('express');
const { requirePerm } = require('../auth');
const { addDays, round2, todayWIB } = require('../calc');
const { bad, log, tx, reqDate, reqNum, optStr, loadInvoices, HttpError } = require('../lib');

const KIND = { sale: { party: 'customer', setting: 'next_sale_no', prefix: '' }, purchase: { party: 'supplier', setting: 'next_purchase_no', prefix: 'PB-' } };
const ADJ_TYPES = ['retur', 'susut', 'pembulatan', 'diskon', 'lainnya'];

// Nomor otomatis dari settings; melompati nomor yang sudah dipakai.
async function nextNumber(conn, kind) {
  const { setting, prefix } = KIND[kind];
  await conn.query('INSERT IGNORE INTO settings (k, v) VALUES (?, "1")', [setting]);
  const [[s]] = await conn.query('SELECT v FROM settings WHERE k = ? FOR UPDATE', [setting]);
  let n = Number(s.v) || 1;
  for (;;) {
    const [[hit]] = await conn.query('SELECT id FROM invoices WHERE kind = ? AND number = ?', [kind, prefix + n]);
    if (!hit) break;
    n++;
  }
  await conn.query('UPDATE settings SET v = ? WHERE k = ?', [String(n + 1), setting]);
  return prefix + n;
}

// Nomor manual berupa angka di atas penghitung → penghitung ikut maju.
async function bumpCounter(conn, kind, number) {
  const { setting, prefix } = KIND[kind];
  const rest = prefix ? number.slice(prefix.length) : number;
  if ((prefix && !number.startsWith(prefix)) || !/^\d+$/.test(rest)) return;
  await conn.query('INSERT IGNORE INTO settings (k, v) VALUES (?, "1")', [setting]);
  await conn.query('UPDATE settings SET v = GREATEST(CAST(v AS UNSIGNED), ?) WHERE k = ?', [Number(rest) + 1, setting]);
}

function cleanLines(kind, lines) {
  if (!Array.isArray(lines) || !lines.length) throw bad('Minimal 1 baris barang');
  return lines.map((l, i) => {
    const n = `Baris ${i + 1}`;
    return {
      item_id: reqNum(l.item_id, `${n}: barang`), unit_id: reqNum(l.unit_id, `${n}: satuan`),
      qty: reqNum(l.qty, `${n}: jumlah`, { min: 0, allowZero: false }),
      price: reqNum(l.price ?? 0, `${n}: harga`, { min: 0 }),
      cost_price: kind === 'sale' && l.cost_price !== '' && l.cost_price != null ? reqNum(l.cost_price, `${n}: harga beli`, { min: 0 }) : null,
      note: optStr(l.note), sort: i,
    };
  });
}

async function getParty(db, kind, id) {
  const [[p]] = await db.query('SELECT * FROM parties WHERE id = ? AND kind = ?', [id, KIND[kind].party]);
  if (!p) throw bad(kind === 'sale' ? 'Customer tidak ditemukan' : 'Supplier tidak ditemukan');
  return p;
}

async function getInvoice(db, id) {
  const [inv] = await loadInvoices(db, 'i.id = ?', [id]);
  if (!inv) throw new HttpError(404, 'Invoice tidak ditemukan');
  return inv;
}

module.exports = function invoiceRoutes(pool) {
  const r = express.Router();

  r.get('/invoices', async (req, res) => {
    const kind = KIND[req.query.kind] ? req.query.kind : 'sale';
    const where = ['i.kind = ?'];
    const params = [kind];
    if (req.query.from) { where.push('i.date >= ?'); params.push(req.query.from); }
    if (req.query.to) { where.push('i.date <= ?'); params.push(req.query.to); }
    if (req.query.party_id) { where.push('i.party_id = ?'); params.push(req.query.party_id); }
    if (req.query.q) { where.push('(i.number LIKE ? OR p.name LIKE ? OR i.po_ref LIKE ? OR i.notes LIKE ?)'); params.push(...Array(4).fill(`%${req.query.q}%`)); }
    // Urut seperti sheet: tanggal lalu nomor (naik).
    let rows = await loadInvoices(pool, where.join(' AND '), params, 'i.date, LENGTH(i.number), i.number, i.id');
    const st = req.query.status;
    if (st === 'open') rows = rows.filter((x) => x.status !== 'lunas');
    else if (st === 'selisih') rows = rows.filter((x) => x.diffOpen || x.dupOpen || x.status === 'lebih_bayar' || x.zeroPriceLines > 0);
    else if (st) rows = rows.filter((x) => x.status === st);
    res.json(rows);
  });

  r.get('/invoices/:id', async (req, res) => {
    const inv = await getInvoice(pool, req.params.id);
    const [allocs] = await pool.query(`SELECT a.id, a.amount, p.id AS payment_id, p.date, p.method, p.reference, p.amount AS payment_amount
      FROM allocations a JOIN payments p ON p.id = a.payment_id WHERE a.invoice_id = ? ORDER BY p.date, p.id`, [inv.id]);
    const [adjs] = await pool.query(`SELECT a.*, u.name AS created_by_name FROM adjustments a LEFT JOIN users u ON u.id = a.created_by
      WHERE a.invoice_id = ? ORDER BY a.date, a.id`, [inv.id]);
    res.json({ ...inv, allocations: allocs, adjustments: adjs });
  });

  // Invoice yang masih ada sisa, untuk dialokasikan di form pembayaran.
  r.get('/open-invoices', async (req, res) => {
    const kind = KIND[req.query.kind] ? req.query.kind : 'sale';
    const rows = await loadInvoices(pool, 'i.kind = ? AND i.party_id = ?', [kind, req.query.party_id]);
    res.json(rows.filter((x) => x.outstanding > 0).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
      .map(({ lines, ...x }) => x));
  });

  async function save(req, res, id) {
    const b = req.body;
    const kind = id ? (await getInvoice(pool, id)).kind : b.kind;
    if (!KIND[kind]) throw bad('Jenis invoice tidak valid');
    const date = reqDate(b.date);
    const party = await getParty(pool, kind, b.party_id);
    const due = b.due_date ? reqDate(b.due_date, 'Jatuh tempo') : addDays(date, party.term_days);
    const lines = cleanLines(kind, b.lines);
    const head = { date, party_id: party.id, due_date: due, po_ref: optStr(b.po_ref, 120), notes: optStr(b.notes, 2000), updated_by: req.user.id };
    const before = id ? await getInvoice(pool, id) : null;
    const newId = await tx(pool, async (c) => {
      let number = optStr(b.number, 40);
      // nomor dicek dobel hanya kalau baru / diganti: invoice hasil import yang memang bernomor dobel (v3.3) tetap bisa diedit
      if (number && number !== before?.number) {
        const [[dup]] = await c.query('SELECT id FROM invoices WHERE kind = ? AND number = ? AND id <> ?', [kind, number, id || 0]);
        if (dup) throw bad(`Nomor ${number} sudah dipakai`);
        await bumpCounter(c, kind, number);
      } else if (!id) number = await nextNumber(c, kind);
      let invId = id;
      if (id) {
        await c.query('UPDATE invoices SET ? WHERE id = ?', [{ ...head, ...(number ? { number } : {}) }, id]);
        await c.query('DELETE FROM invoice_lines WHERE invoice_id = ?', [id]);
      } else {
        const [ins] = await c.query('INSERT INTO invoices SET ?', [{ ...head, kind, number, created_by: req.user.id }]);
        invId = ins.insertId;
      }
      await c.query('INSERT INTO invoice_lines (invoice_id, item_id, unit_id, qty, price, cost_price, note, sort) VALUES ?',
        [lines.map((l) => [invId, l.item_id, l.unit_id, l.qty, l.price, l.cost_price, l.note, l.sort])]);
      return invId;
    });
    const after = await getInvoice(pool, newId);
    await log(pool, req.user, id ? 'update' : 'create', `invoice_${kind}`, newId, id
      ? { number: after.number, totalBefore: before.total, totalAfter: after.total, linesBefore: before.lines.map(slim) }
      : { number: after.number, total: after.total });
    res.json({ id: newId, number: after.number });
  }
  const slim = (l) => ({ item: l.item_name, unit: l.unit_name, qty: l.qty, price: l.price, cost: l.cost_price });

  r.post('/invoices', requirePerm('invoice'), (req, res) => save(req, res, null));
  r.put('/invoices/:id', requirePerm('invoice'), (req, res) => save(req, res, Number(req.params.id)));

  r.delete('/invoices/:id', requirePerm('invoice'), async (req, res) => {
    const inv = await getInvoice(pool, req.params.id);
    if (inv.paid !== 0) throw bad('Invoice sudah ada pembayaran — hapus/ubah alokasi pembayarannya dulu');
    await pool.query('DELETE FROM invoices WHERE id = ?', [inv.id]);
    await log(pool, req.user, 'delete', `invoice_${inv.kind}`, inv.id, { number: inv.number, party: inv.party_name, total: inv.total, lines: inv.lines.map(slim) });
    res.json({ ok: true });
  });

  // v3.3 Catatan untuk No Inv yang dipakai >1 invoice (hasil import apa adanya).
  r.put('/invoices/:id/dup-note', requirePerm('note'), async (req, res) => {
    const inv = await getInvoice(pool, req.params.id);
    const note = optStr(req.body.dup_note, 2000);
    await pool.query('UPDATE invoices SET dup_note = ? WHERE id = ?', [note, inv.id]);
    await log(pool, req.user, 'dup_note', `invoice_${inv.kind}`, inv.id, { number: inv.number, dupCount: inv.dupCount, note });
    res.json({ ok: true });
  });

  // Justifikasi selisih total sheet vs hitungan.
  r.put('/invoices/:id/diff-note', requirePerm('note'), async (req, res) => {
    const inv = await getInvoice(pool, req.params.id);
    const note = optStr(req.body.diff_note, 2000);
    await pool.query('UPDATE invoices SET diff_note = ? WHERE id = ?', [note, inv.id]);
    await log(pool, req.user, 'diff_note', `invoice_${inv.kind}`, inv.id, { importDiff: inv.importDiff, note });
    res.json({ ok: true });
  });

  // ===== Penyesuaian (retur, susut, pembulatan, diskon, lainnya) =====
  async function addAdjustment(req, inv, a) {
    const [ins] = await pool.query('INSERT INTO adjustments SET ?', [{ invoice_id: inv.id, created_by: req.user.id, ...a }]);
    await log(pool, req.user, 'adjust', `invoice_${inv.kind}`, inv.id, { ...a, outstandingBefore: inv.outstanding });
    return ins.insertId;
  }

  r.post('/invoices/:id/adjustments', requirePerm('adjust'), async (req, res) => {
    const inv = await getInvoice(pool, req.params.id);
    const b = req.body;
    if (!ADJ_TYPES.includes(b.type)) throw bad('Jenis penyesuaian tidak valid');
    const id = await addAdjustment(req, inv, {
      date: reqDate(b.date), type: b.type, amount: round2(reqNum(b.amount, 'Nominal', { allowZero: false })),
      qty: b.qty === '' || b.qty == null ? null : reqNum(b.qty, 'Jumlah'), note: optStr(b.note) || (() => { throw bad('Keterangan wajib diisi'); })(),
    });
    res.json({ id });
  });

  // Tombol pembulatan: menutup sisa (kurang atau lebih bayar) sebesar sisa saat ini.
  r.post('/invoices/:id/round', requirePerm('adjust'), async (req, res) => {
    const inv = await getInvoice(pool, req.params.id);
    if (inv.outstanding === 0) throw bad('Tidak ada selisih');
    const note = optStr(req.body.note) || `Pembulatan sisa ${inv.outstanding}`;
    const id = await addAdjustment(req, inv, { date: req.body.date ? reqDate(req.body.date) : todayWIB(), type: 'pembulatan', amount: inv.outstanding, qty: null, note });
    res.json({ id });
  });

  // Samakan dengan total sheet: tambah penyesuaian sebesar selisih import, wajib dengan alasan.
  r.post('/invoices/:id/accept-import-total', requirePerm('adjust'), async (req, res) => {
    const inv = await getInvoice(pool, req.params.id);
    if (!inv.importDiff) throw bad('Tidak ada selisih import');
    const note = optStr(req.body.note);
    if (!note) throw bad('Alasan wajib diisi');
    await addAdjustment(req, inv, { date: inv.date, type: 'lainnya', amount: -inv.importDiff, qty: null, note: `Samakan total sheet: ${note}` });
    await pool.query('UPDATE invoices SET diff_note = ? WHERE id = ?', [note, inv.id]);
    res.json({ ok: true });
  });

  r.delete('/adjustments/:id', requirePerm('adjust'), async (req, res) => {
    const [[a]] = await pool.query('SELECT a.*, i.kind FROM adjustments a JOIN invoices i ON i.id = a.invoice_id WHERE a.id = ?', [req.params.id]);
    if (!a) throw new HttpError(404, 'Penyesuaian tidak ditemukan');
    await pool.query('DELETE FROM adjustments WHERE id = ?', [a.id]);
    await log(pool, req.user, 'delete_adjust', `invoice_${a.kind}`, a.invoice_id, { type: a.type, amount: a.amount, note: a.note });
    res.json({ ok: true });
  });

  return r;
};

module.exports.nextNumber = nextNumber;
module.exports.bumpCounter = bumpCounter;
