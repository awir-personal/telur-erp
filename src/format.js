const nf = (max) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: max });
const n0 = nf(2), n3 = nf(3);

export const rp = (v) => (v == null || v === '' ? '' : n0.format(Number(v)));
export const qty = (v) => (v == null || v === '' ? '' : n3.format(Number(v)));

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
// Gaya sheet: 1-Jan-26
export const tgl = (ymd) => {
  if (!ymd) return '';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return `${d}-${MON[m - 1]}-${String(y).slice(2)}`;
};
export const waktu = (dt) => (dt ? `${tgl(dt)} ${dt.slice(11, 16)}` : '');

// Ketikan angka format Indonesia: titik = ribuan, koma = desimal. Kosong → ''.
export function parseNum(s) {
  if (s == null) return '';
  if (typeof s === 'number') return s;
  const t = String(s).trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  if (t === '') return '';
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
export const toInput = (v) => (v === '' || v == null || Number.isNaN(v) ? '' : n3.format(Number(v)));

export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
export const addDays = (ymd, n) => {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const firstOfMonth = () => today().slice(0, 8) + '01';

export const STATUS = {
  lunas: { label: 'Lunas', cls: 'bg-green-100 text-green-800' },
  sebagian: { label: 'Sebagian', cls: 'bg-amber-100 text-amber-800' },
  belum: { label: 'Belum bayar', cls: 'bg-slate-100 text-slate-700' },
  lebih_bayar: { label: 'Lebih bayar', cls: 'bg-purple-100 text-purple-800' },
};
export const METHOD = { cash: 'Cash', transfer: 'Transfer', giro: 'Giro', lainnya: 'Lainnya' };
export const ADJ = { retur: 'Retur', susut: 'Susut', pembulatan: 'Pembulatan', diskon: 'Diskon', lainnya: 'Lainnya' };
