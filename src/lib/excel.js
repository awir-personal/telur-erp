// Export ke .xlsx di browser (SheetJS dimuat saat dibutuhkan saja).
// aoa = array of arrays; angka tetap angka (bisa dijumlah di Excel). merges = [{s:{r,c}, e:{r,c}}].
export async function downloadXlsx(filename, sheets) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const { name, aoa, merges = [], widths = [] } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
    ws['!merges'] = merges;
    ws['!cols'] = widths.map((w) => ({ wch: w }));
    // Format ribuan untuk semua sel angka.
    for (const addr of Object.keys(ws)) {
      if (addr[0] === '!') continue;
      if (ws[addr].t === 'n') ws[addr].z = Number.isInteger(ws[addr].v) ? '#,##0' : '#,##0.###';
      if (ws[addr].t === 'd') ws[addr].z = 'd-mmm-yy'; // gaya sheet lama: 1-Jan-26
    }
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

// Tanggal ISO → Date Excel asli (bisa difilter/diurutkan di Excel).
export const xlDate = (ymd) => (ymd ? new Date(ymd + 'T00:00:00') : '');
