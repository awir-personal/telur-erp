---
name: telur-erp-continue
description: Muat konteks lengkap untuk melanjutkan development Telur ERP - ERP distribusi telur berbasis web (Node + Express + React + MySQL, hosting Railway, PWA) - penjualan format sheet, pembelian, pembayaran multi-invoice, selisih & pembulatan, piutang/hutang, Kas & Bank, rekonsiliasi bank, jurnal & laporan keuangan, backup, master user nama+PIN, import sheet. Pakai ini setiap mulai sesi baru untuk kerja di project ini.
---

# Melanjutkan Telur ERP

Lokasi: `C:\Users\Han\Downloads\Claude\telur-erp`. Repo private `awir-personal/telur-erp` (branch `main`). **LIVE: https://telur-erp-production.up.railway.app**, dan setiap push ke `main` langsung ter-deploy ke data asli user di server. Jadi rilis = produksi: tes dulu dengan lengkap, dan migrasi harus aman.

1. **Baca `PROJECT_BRIEF.md` sampai habis dulu.** Isinya keputusan user yang sudah dikonfirmasi, model data, hak akses, aturan import/rekonsiliasi/jurnal, dan jebakan yang pernah ditemui.
2. Cek kondisi nyata, jangan percaya ingatan: `git status`, `git log -5`, versi di `package.json`, service MySQL80 (`Get-Service MySQL80`).
3. **Data asli:** `telur_erp_db` (lokal) atau MySQL Railway berisi data sungguhan user. Jangan pernah tes di sana; baca-saja untuk inventarisasi. Untuk menguji migrasi: salin dulu ke DB `*_zz`.
4. **User menjalankan app-nya sendiri secara paralel** (`Jalankan Telur ERP.bat`, port 3200, folder `dist`). Untuk uji UI pakai preview `telur-erp-uitest` = `scripts/uitest.js` (port 3299, DB `telur_erp_uitest_zz`, build `npx vite build --outDir dist-uitest`). **Jangan pernah** `npm run build` / `vite build` ke `dist` saat app user mungkin jalan, dan hentikan hanya PID milik sendiri, bukan berdasarkan nama proses atau port.
5. Keputusan besar (model data, alur bisnis/akuntansi, hak akses, hosting) → **tanya & challenge user dulu** lewat AskUserQuestion.

## Aturan rilis (selalu, tanpa diminta)

1. Versi di `package.json` mengikuti **konvensi semua app user: vX.Y** (X = perubahan besar, Y = perubahan kecil/bug, angka ketiga selalu 0). Tampil di pojok kiri bawah.
2. `npm test` harus hijau. Untuk logika baru: tambah tes, lalu buktikan tes itu gagal kalau kodenya dirusak (mutation test).
3. Build sukses (ke `dist-uitest` untuk uji; `dist` dibangun sendiri oleh .bat user).
4. Update `PROJECT_BRIEF.md` (riwayat versi + keputusan baru).
5. Update **kedua** salinan skill ini (identik): `telur-erp\.claude\skills\telur-erp-continue\SKILL.md` dan `C:\Users\Han\Downloads\Claude\.claude\skills\telur-erp-continue\SKILL.md`.
6. Commit & push ke `main`.
7. Verifikasi UI di browser preview kalau perubahannya terlihat di layar. Klik lewat `find`/`ref` (koordinat sering meleset), ketik sungguhan.

## Yang paling mudah dilanggar

- Harga beli diketik per invoice; margin memakai itu. **Laporan keuangan** memakai HPP **periodik**, dengan selisih keduanya ditampilkan sebagai kontrol. Jangan satukan diam-diam.
- Rekening di pembayaran **opsional** (keputusan user). Pembayaran tanpa rekening masuk akun 1102 "Kas/Bank belum ditentukan" dan bisa diisi lewat cocok manual di rekonsiliasi.
- Mutasi kas sebelum tanggal saldo awal rekening: di Kas & Bank tidak dihitung, di jurnal sisi kasnya ke 3301 Ekuitas Saldo Awal. Dua aturan ini harus selalu sama.
- Selisih tidak boleh dihapus otomatis. Selalu tampilkan, lalu user justifikasi/ubah/bulatkan sendiri.
- Master tidak boleh bisa melihat PIN; hanya reset (PIN sementara tampil sekali, wajib diganti).
- Migrasi DB: tambah entri baru di `MIGRATIONS` (`server/db.js`), jangan ubah entri lama, dan setiap pernyataan harus aman diulang (IF NOT EXISTS / INSERT IGNORE / `addColumn`), karena DDL MySQL tidak bisa di-rollback.
- Transaksi yang sudah dicocokkan di rekonsiliasi tidak boleh dihapus sebelum cocoknya dibatalkan.
- Di PC user, `npm` di PowerShell diblokir. Suruh pakai `Jalankan Telur ERP.bat` atau `npm.cmd`.
- Heredoc Bash merusak backslash; pakai tool Edit/Write untuk kode yang penuh escape.
- Nilai angka dari mysql2 sudah berupa number (`decimalNumbers: true`). `{x && <JSX/>}` dengan x = 0 akan merender "0" di layar.
- Import sheet dibaca mulai kolom "Tanggal" (sheet user punya kolom centang A-B sejak Okt 2026). Sarankan upload .xlsx, bukan .csv: CSV Google Sheet membulatkan angka tampilan sehingga muncul selisih total palsu.
