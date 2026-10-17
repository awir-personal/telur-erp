---
name: telur-erp-continue
description: Muat konteks lengkap untuk melanjutkan development Telur ERP - ERP sederhana distribusi telur berbasis web (Node + Express + React + MySQL, hosting Railway) - penjualan format sheet, pembelian, pembayaran multi-invoice, selisih & pembulatan, piutang/hutang, margin, master user nama+PIN, import sheet. Pakai ini setiap mulai sesi baru untuk kerja di project ini.
---

# Melanjutkan Telur ERP

Lokasi: `C:\Users\Han\Downloads\Claude\telur-erp`. Repo private `awir-personal/telur-erp`.

1. **Baca `PROJECT_BRIEF.md` sampai habis dulu.** Isinya keputusan user yang sudah dikonfirmasi, model data, hak akses, aturan import, dan jebakan yang pernah ditemui.
2. Cek kondisi nyata, jangan percaya ingatan: `git status`, `git log -5`, versi di `package.json`, service MySQL80 (`Get-Service MySQL80`).
3. **Data asli:** `telur_erp_db` (lokal) atau MySQL Railway bisa berisi data sungguhan user. Jangan pernah tes di sana. Pakai `npm test` (DB `telur_erp_test_zz`) dan preview `telur-erp-uitest` (DB `telur_erp_uitest_zz`), lalu hapus DB uitest setelah selesai. Sebelum menyentuh data asli, inventarisasi dulu dan tanya user.
4. Keputusan besar (model data, alur bisnis, hak akses, hosting) → **tanya & challenge user dulu** lewat AskUserQuestion.

## Aturan rilis (selalu, tanpa diminta)

1. Naikkan versi di `package.json`.
2. `npm test` harus hijau. Untuk logika baru: tambah tes, lalu buktikan tes itu bisa gagal (mutation test).
3. `npm run build` harus sukses.
4. Update `PROJECT_BRIEF.md` (bagian riwayat versi + keputusan baru).
5. Update **kedua** salinan skill ini (identik): `telur-erp\.claude\skills\telur-erp-continue\SKILL.md` dan `C:\Users\Han\Downloads\Claude\.claude\skills\telur-erp-continue\SKILL.md`.
6. Commit & push ke `main` (repo private).
7. Verifikasi UI di browser preview kalau perubahannya terlihat di layar. Klik lewat `find`/`ref`, ketik sungguhan, jangan set nilai lewat script.

## Yang paling mudah dilanggar

- Harga beli diketik per invoice, **bukan** dihitung dari pembelian (user memilih ini secara eksplisit).
- Selisih tidak boleh dihapus otomatis. Selalu tampilkan, lalu user justifikasi/ubah/bulatkan sendiri.
- Master tidak boleh bisa melihat PIN. Hanya reset → PIN sementara tampil sekali → wajib ganti.
- Migrasi DB: tambah entri baru di `MIGRATIONS` (`server/db.js`), jangan ubah entri lama, dan setiap pernyataan harus aman diulang (IF NOT EXISTS / INSERT IGNORE). DDL MySQL tidak bisa di-rollback.
- Di PC user, `npm` di PowerShell diblokir. Suruh pakai `Jalankan Telur ERP.bat` atau `npm.cmd`. Setelah uji preview, pastikan port 3200/5180 kosong (Vite yatim = error 500 di sisi user).
- Nilai angka dari mysql2 sudah berupa number (`decimalNumbers: true`). `{x && <JSX/>}` dengan x = 0 akan merender "0" di layar.
