// Export nota PEMBELIAN ke format ESB "Simple Purchase" (template ESB_FNB_SIMPLE_PURCHASE_TEMPLATE_INDEX,
// 25 kolom, sheet "Sheet1"). Murni (tanpa DB/browser) supaya bisa dites di node: test/calc.test.js.
// Keputusan user 2026-10-29: Supplier Invoice Number = "Invoice <No>", Additional Info = "<Supplier> Invoice <No>",
// Credit Term = termin supplier di ERP. Branch/Location/Payment Method mengikuti isian file ESB lama user.

export const ESB_PURCHASE_HEADER = [
  'Sequence', 'Supplier', 'Date', 'Branch', 'Location', 'Payment Method', 'COANo', 'Cost Center', 'Project', 'Credit Term',
  'Supplier Invoice Number', 'Currency', 'Rate', 'Type', 'Item', 'Unit', 'Qty', 'Price', 'Disc', 'Vat', 'Other Tax',
  'Tax Rate', 'Amount', 'Notes', 'Additional Info',
];

export const ESB_DEFAULTS = { branch: 'Head Office', location: 'Main Warehouse', paymentMethod: 'Credit' };

// Kolom yang tidak dipakai dibiarkan KOSONG (sel tidak ada), sama seperti template ESB - bukan teks kosong.
const _ = null;

// Nama barang ERP mengikuti ejaan sheet ("Telor Curah"); master barang ESB user memakai "Telur Curah" / "Telur Putih"
// (file ESB_FNB_SIMPLE_PURCHASE_TEMPLATE_INDEX lama). Hanya di file ESB - nama di ERP tidak diubah (import sheet tetap cocok).
export const esbItem = (name) => String(name || '').replace(/\btelor\b/gi, 'Telur');

// Satuan ERP (huruf kecil: kg, tray, ikat) -> gaya ESB ("Kg", "Tray").
export const esbUnit = (u) => (u ? String(u).charAt(0).toUpperCase() + String(u).slice(1) : '');

/**
 * @param invoices nota pembelian dari GET /invoices?kind=purchase (sudah termasuk lines, party_id, party_name, adjusted)
 * @param termOf (invoice) => hari termin
 * @param toDate (ymd) => nilai sel tanggal
 * @returns {{ aoa, count, skipped: string[], adjusted: string[] }}
 */
export function esbPurchaseAoa(invoices, termOf, toDate = (d) => d, opt = ESB_DEFAULTS) {
  const aoa = [ESB_PURCHASE_HEADER];
  const skipped = [];
  const adjusted = [];
  let seq = 0;
  for (const inv of invoices) {
    const lines = (inv.lines || []).filter((l) => Number(l.qty));
    if (!lines.length) { skipped.push(`${inv.number} (${inv.party_name}): tidak ada baris barang`); continue; }
    if (Number(inv.adjusted)) adjusted.push(`${inv.number} (${inv.party_name})`);
    seq += 1; // 1 nota = 1 Sequence; semua baris barangnya memakai Sequence yang sama
    for (const l of lines) {
      aoa.push([
        seq, inv.party_name, toDate(inv.date), opt.branch, opt.location, opt.paymentMethod, _, _, _, termOf(inv),
        `Invoice ${inv.number}`, 'IDR', 1, 'Item', esbItem(l.item_name), esbUnit(l.unit_name), Number(l.qty), Number(l.price), 0, _, _,
        _, _, _, `${inv.party_name} Invoice ${inv.number}`,
      ]);
    }
  }
  return { aoa, count: seq, skipped, adjusted };
}
