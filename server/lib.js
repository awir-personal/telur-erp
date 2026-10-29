const { summarize } = require('./calc');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

async function log(db, user, action, entity, entityId, detail) {
  await db.query('INSERT INTO activity_log (user_id, user_name, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)',
    [user?.id ?? null, user?.name ?? null, action, entity, entityId ?? null, detail == null ? null : JSON.stringify(detail)]);
}

// Jalankan fn dalam satu transaksi; rollback kalau gagal.
async function tx(pool, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally { conn.release(); }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
function reqDate(v, label = 'Tanggal') {
  if (!YMD.test(String(v || '')) || Number.isNaN(Date.parse(v))) throw bad(`${label} tidak valid`);
  return v;
}
function reqNum(v, label, { min = -Infinity, allowZero = true } = {}) {
  const n = Number(v);
  if (v === '' || v == null || !Number.isFinite(n)) throw bad(`${label} harus angka`);
  if (n < min || (!allowZero && n === 0)) throw bad(`${label} tidak valid`);
  return n;
}
const optStr = (v, max = 255) => {
  const s = v == null ? '' : String(v).trim();
  if (s.length > max) throw bad(`Teks terlalu panjang (maks ${max})`);
  return s || null;
};
const reqStr = (v, label, max = 255) => {
  const s = optStr(v, max);
  if (!s) throw bad(`${label} wajib diisi`);
  return s;
};

// Ringkasan (total, dibayar, sisa, status, margin) untuk sekumpulan invoice.
async function loadInvoices(db, where = '1=1', params = [], order = 'i.date DESC, i.id DESC') {
  const [invs] = await db.query(
    `SELECT i.*, p.name AS party_name FROM invoices i JOIN parties p ON p.id = i.party_id
     WHERE ${where} ORDER BY ${order}`, params);
  if (!invs.length) return [];
  const ids = invs.map((i) => i.id);
  const [lines] = await db.query(
    `SELECT l.*, it.name AS item_name, u.name AS unit_name, u.kg_per_unit FROM invoice_lines l
     JOIN items it ON it.id = l.item_id JOIN units u ON u.id = l.unit_id
     WHERE l.invoice_id IN (?) ORDER BY l.sort, l.id`, [ids]);
  const [paid] = await db.query(
    `SELECT a.invoice_id, SUM(a.amount) AS paid, MAX(p.date) AS last_paid, GROUP_CONCAT(DISTINCT p.method) AS methods
     FROM allocations a JOIN payments p ON p.id = a.payment_id WHERE a.invoice_id IN (?) GROUP BY a.invoice_id`, [ids]);
  const [adj] = await db.query('SELECT invoice_id, SUM(amount) AS adjusted FROM adjustments WHERE invoice_id IN (?) GROUP BY invoice_id', [ids]);
  // v3.3: No Inv yang dipakai >1 invoice (hasil import apa adanya) -> wajib diberi catatan oleh user
  const [dups] = await db.query('SELECT kind, number, COUNT(*) AS n FROM invoices GROUP BY kind, number HAVING n > 1');
  const dupM = new Map(dups.map((d) => [`${d.kind}|${d.number}`, d.n]));
  const byInv = (rows) => new Map(rows.map((r) => [r.invoice_id, r]));
  const paidM = byInv(paid), adjM = byInv(adj);
  const linesM = new Map(ids.map((id) => [id, []]));
  for (const l of lines) linesM.get(l.invoice_id).push(l);
  return invs.map((i) => {
    const p = paidM.get(i.id);
    const s = summarize(linesM.get(i.id), p?.paid || 0, adjM.get(i.id)?.adjusted || 0, i.imported_total);
    const dupCount = dupM.get(`${i.kind}|${i.number}`) || 1;
    return { ...i, lines: linesM.get(i.id), last_paid: p?.last_paid || null, methods: p?.methods || null, ...s, diffOpen: s.importDiff !== 0 && !i.diff_note, dupCount, dupOpen: dupCount > 1 && !i.dup_note };
  });
}

module.exports = { HttpError, bad, log, tx, reqDate, reqNum, optStr, reqStr, loadInvoices };
