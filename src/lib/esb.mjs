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

// ===== v4.2 Export invoice PENJUALAN ke ESB "Simple Sales" (template ESB_FNB_SIMPLE_SALES_TEMPLATE - new, sheet
// "Simple Sales", 29 kolom). Baris 1 = petunjuk template, baris 2 = header, data mulai baris 3 - disalin persis.
// Keputusan user 2026-10-30: Head Office / Main Warehouse / Credit, Credit Terms = termin customer, VAT "NO".
// Cabang Hari-Hari: Customer "Hari - Hari Swalayan", cabang ditulis di Additional Info (baris teratas tiap Sequence).
export const ESB_SALES_SHEET = 'Simple Sales';
export const ESB_SALES_HELP = [
  'filled with a sequence of numbers starting from 1', 'Fill in sales type with Goods or Services', 'Fill in the Customer name.',
  'Customer Branch is optional. If filled, it must match the Customer Branch master data',
  'If left empty, it will be automatically filled from the Customer or Customer Branch address', 'Fill in with Simple Sales Date.',
  'Fill in the outlet name.', 'Fill in the location name.', 'Fill in the payment method.', 'Fill in with account number if the Payment Method is Cash',
  'Fill in credit terms (days) with number if the Payment Method is Credit',
  'Fill in with VAT Invoice Number that has been registered in master VAT Invoice Number\ne.g 011.111-11.00000001',
  'Fill in with Currency Sign that has been registered in master Currency\ne.g. IDR', 'Fill in with Rate that has been registered in master Currency\ne.g. 1',
  'Fill in Type with Cost and Item', 'Fill in with Account Number for Type = Cost and Product Name for Type = Item',
  'Fill in Product Code if the product name has product code', 'Fill in the unit of product as you want to sales',
  'Fill in with qty of product as you want to sales', 'Fill in with based price of product as you want to sales',
  'Fill in with percentage discount of product as you want to sales', 'Fill in with value discount of product as you want to sales',
  "Select 'YES' if the Product includes vat, and 'NO' if it does not.", 'Fill in with Other Tax that has been registered in Master Tax',
  'Fill in with Percentage Numbers of Tax Rate\n\ne.g. 10 for 10%',
  'This field will be mandatory for Type = Cost and optional for Type = Item, make sure for the calculation for Type = Item is price * qty - disc % or disc value  + vat value',
  'Fill in with notes of Cost or product as you want to sales', 'Fill in with additional information of this Simple Sales\n\nSet in the top line only',
  'Fill in with Foto Note of this Simple Sales\n\nSet in the top line only',
];
export const ESB_SALES_HEADER = [
  'Sequence', 'Sales Type', 'Customer', 'Customer Branch', 'Address', 'Simple Sales Date', 'Branch', 'Location', 'Payment Method', 'COANo',
  'Credit Terms (days)', 'VAT Invoice Number', 'Currency', 'Rate', 'Type', 'Product Name', 'Product Code', 'Unit', 'Qty', 'Price', 'Disc %',
  'Disc Value', 'VAT', 'Other Tax', 'Tax Rate', 'Amount', 'Notes', 'Additional Info', 'Footnote',
];
export const ESB_HH_CUSTOMER = 'Hari - Hari Swalayan';

// Tanggal ESB Sales = teks "dd/mm/yyyy" (contoh template "11/05/2026"), bukan sel tanggal.
export const esbSalesDate = (ymd) => { const [y, m, d] = String(ymd).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };

// "Hari-Hari Kalideres - No GD :7951, No PI :20054, No PO :5216760, No GR Client :" (format file ESB GTA lama user)
export const esbSalesInfo = (inv) =>
  `${inv.hh_branch ? `Hari-Hari ${inv.party_name}` : inv.party_name} - No GD :${inv.number}, No PI :${inv.ref_pi || ''}, No PO :${inv.po_ref || ''}, No GR Client :${inv.ref_gr || ''}`;

/**
 * @param invoices invoice penjualan dari GET /invoices?kind=sale (dengan lines, adjusted, hh_branch, ref_pi, po_ref, ref_gr)
 * @param termOf (invoice) => hari termin
 * Disc Value (baris pertama tiap Sequence) = total penyesuaian invoice cabang Hari-Hari (diskon rumus + koreksi), sehingga
 * Amount ESB = tagihan. Penyesuaian invoice customer biasa TIDAK ikut (dilaporkan di `adjusted`), sama seperti Export ESB Purchase.
 */
export function esbSalesAoa(invoices, termOf, opt = ESB_DEFAULTS) {
  const aoa = [ESB_SALES_HELP, ESB_SALES_HEADER];
  const skipped = [];
  const adjusted = [];
  let seq = 0;
  for (const inv of invoices) {
    const lines = (inv.lines || []).filter((l) => Number(l.qty));
    if (!lines.length) { skipped.push(`${inv.number} (${inv.party_name}): tidak ada baris barang`); continue; }
    const adj = Number(inv.adjusted) || 0;
    const disc = inv.hh_branch && adj > 0 ? adj : 0;
    if (adj && !disc) adjusted.push(`${inv.number} (${inv.party_name})`);
    seq += 1;
    lines.forEach((l, i) => {
      aoa.push([
        String(seq), 'Goods', inv.hh_branch ? ESB_HH_CUSTOMER : inv.party_name, _, _, esbSalesDate(inv.date), opt.branch, opt.location, opt.paymentMethod, _,
        termOf(inv), _, 'IDR', 1, 'Item', esbItem(l.item_name), _, esbUnit(l.unit_name), Number(l.qty), Number(l.price), _,
        i === 0 && disc ? disc : _, 'NO', _, _, _, _, i === 0 ? esbSalesInfo(inv) : _, _,
      ]);
    });
  }
  return { aoa, count: seq, skipped, adjusted };
}
