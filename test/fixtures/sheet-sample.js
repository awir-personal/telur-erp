// Salinan persis 17 baris data dari screenshot sheet user (Jan 2026), format angka Indonesia.
const E = '';
const N = [E, E];
const row = (d, no, nama, cur = N, ome = N, put = N, tray = N, ret = N, boc = N, total = E, tgl = E, nom = E, st = E) =>
  [d, no, nama, ...cur, ...ome, ...put, ...tray, ...ret, ...boc, total, tgl, nom, st];
module.exports = [
  [E, E, E, 'Telor Curah', E, 'Telor Omega', E, 'Telor Putih', E, 'Tray/Peti', E, 'Telor Retak', E, 'Telor Bocor', E, E, E, E, E],
  ['Tanggal', 'No Inv', 'Nama', 'kg', 'Harga', 'Kg', 'Harga', 'kg', 'Harga', 'Peti/Tray', 'Harga', 'Kg', 'Harga', 'Kg', 'Harga', 'Total', 'Tgl Byr', 'Nominal', 'Status'],
  row('1-Jan-26', '3851', 'Home Made', N, N, ['105', '28.000'], N, N, N, '2.940.000', E, E, 'PO 7 ikat Curah'),
  row('1-Jan-26', '3852', 'Home Made', ['33', '28.000'], N, ['258', '28.000'], N, ['54', '28.000'], N, '9.660.000', E, E, 'PO 23 ikat Curah'),
  row('2-Jan-26', '3853', 'Irfan Bojonggede', ['15', '28.800'], N, N, N, N, N, '432.000', '2-Jan-26', '432.000,00', 'Cash'),
  row('2-Jan-26', '3854', 'Zidan Baru', ['15', '28.800'], N, N, N, N, N, '432.000', '2-Jan-26', '432.000,00', 'Cash'),
  row('1-Jan-26', '3855', 'PT. Akur Pratama', ['2.955', '28.000'], N, N, N, N, N, '82.740.000', E, E, 'Return 45kg'),
  row('1-Jan-26', '3856', 'PT. Akur Pratama', ['450', '27.600'], N, N, N, N, N, '12.420.000', E, E, '-'),
  row('1-Jan-26', '3857', 'Yusuf', ['15', '28.000'], ['15', '30.000'], N, N, N, N, '870.000'),
  row('2-Jan-26', '3858', 'Adi D', ['742', E], N, ['167', E], N, N, N, '0'),
  row('2-Jan-26', '3859', 'Zidan', ['15', '28.200'], N, N, N, N, N, '423.000', '2-Jan-26', '423.000,00', 'Cash'),
  row('2-Jan-26', '3860', 'Cash', ['288', '28.320'], ['15', '30.300'], N, ['139', '353'], ['1', '26.000'], ['33', '11.252'], '9.073.113', '2-Jan-26', E, 'Transfer Anthony 300.000'),
  row('2-Jan-26', '3860', 'Cash', ['75', '28.800'], N, N, N, N, N, '2.160.000', '2-Jan-26', '10.933.000,00', 'Super (Cash)'),
  row('2-Jan-26', '3861', 'Jakarta Cheese Factory', ['150', '29.000'], N, N, N, N, N, '4.350.000', E, E, 'Brownies'),
  row('2-Jan-26', '3862', 'Jakarta Cheese Factory', ['100,8', '29.000'], N, N, N, N, N, '2.923.200', E, E, 'Bolen'),
  row('2-Jan-26', '3863', 'Jakarta Cheese Factory', ['16,8', '29.000'], N, N, N, N, N, '487.200', E, E, 'Banana'),
  row('2-Jan-26', '3864', 'Karman', N, N, N, N, ['45', '24.000'], N, '1.080.000', '2-Jan-26', '1.080.000,00', 'Cash'),
  row('3-Jan-26', '3865', 'Home Made', N, N, ['180', '27.500'], N, N, N, '4.950.000', E, E, 'PO 12 ikat Curah'),
  row('3-Jan-26', '3866', 'PT. Tip Top Bogor', ['741', '28.500'], N, N, N, N, N, '21.118.500', E, E, 'Return 9kg - susut 5.2kg'),
];
