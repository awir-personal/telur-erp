# PROJECT BRIEF — Telur ERP

Sumber kebenaran untuk melanjutkan project ini. Baca seluruhnya sebelum mengubah apa pun.

## 1. Apa ini

ERP sederhana untuk perusahaan **distribusi telur** milik user: beli telur dari supplier/peternak, jual ke customer, target stok akhir 0. Menggantikan Google Sheet penjualan (screenshot acuan: kolom Tanggal | No Inv | Nama | Telor Curah/Omega/Putih/Tray-Peti/Retak/Bocor (kg + Harga) | Total | Tgl Byr | Nominal | Status).

- Lokasi: `C:\Users\Han\Downloads\Claude\telur-erp`
- Stack: **web app** Node 20+ + Express 5 + mysql2 + React 18 (Vite 5, Tailwind 3), satu repo, BUKAN Electron.
- DB lokal `telur_erp_db` (MySQL80 bersama app lain). Server: Railway + plugin MySQL (`MYSQL_URL`).
- Versi: lihat `package.json`.

## 2. Keputusan yang SUDAH dikonfirmasi user (2026-10-17) — jangan diubah tanpa bertanya

| Topik | Keputusan |
|---|---|
| Platform | Web app langsung (user setuju menolak Electron karena tujuan akhirnya server) |
| Hosting | Sama seperti Mahjong (Railway) + MySQL, sama dengan app lain |
| Grade telur | Hanya keterangan/info (= nama barang), tidak ada sortir/turunan HPP |
| Tray/Peti | Barang yang dijual (satuan tray). User akan kabari kalau konsepnya berubah |
| Satuan | kg default; 1 ikat ≈ 15 kg (bisa diubah di master Satuan); peti & butir juga dipakai |
| Harga jual | Bebas diketik per invoice; master harga khusus per customer + teks "aturan harga" sebagai saran |
| Harga beli | **Diketik per baris invoice penjualan** (`cost_price`, opsional). User MENOLAK HPP otomatis dari modul pembelian. Pembelian tetap dicatat (untuk hutang supplier & info stok) tapi tidak terhubung ke harga beli |
| Stok | Hanya laporan info (masuk − keluar). Tidak ada penutupan susut otomatis |
| Termin | Bawaan 30 hari, bisa diubah per customer & supplier |
| Selisih | SEMUA selisih ditampilkan; user wajib justifikasi atau ubah. Ada tombol pembulatan. Tidak ada auto-write-off |
| Import | Sudah ada; user akan mengetesnya sendiri dengan data asli |
| User | Nama + PIN 6 digit, ganti PIN, reset PIN oleh master. **Master TIDAK bisa melihat PIN** (user memilih hash + reset dibanding PIN yang bisa dibaca) |
| Repo | `awir-personal/telur-erp` (private) |

## 3. Model data (server/db.js, migrasi otomatis saat start)

- `invoices` (kind `sale`|`purchase`) + `invoice_lines` (item, unit, qty, price, cost_price). Total TIDAK disimpan; selalu dihitung Σ round2(qty×price).
- `payments` (kind, party, method, amount) + `allocations` (payment→invoice, amount). **Banyak-ke-banyak**: 1 invoice dibayar berkali-kali, 1 pembayaran untuk banyak invoice. Sisa pembayaran yang tidak dialokasi = "saldo belum dialokasi".
- `adjustments` per invoice: retur | susut | pembulatan | diskon | lainnya. `amount` positif = mengurangi tagihan.
- `invoices.imported_total` = total di sheet asal (hanya hasil import); `diff_note` = justifikasi. `diffOpen` = selisih ≠ 0 dan belum ada justifikasi.
- Sisa = total − Σadjustments − Σallocations. Status: lunas | sebagian | belum | lebih_bayar.
- `parties` (customer/supplier, term_days, price_rule), `party_prices`, `items` (urutan kolom sheet), `units` (kg_per_unit), `users`, `sessions` (token di-hash sha256, 12 jam), `settings` (next_sale_no, next_purchase_no, company_name), `activity_log`.
- Migrasi: tambah entri baru di `MIGRATIONS`, **jangan pernah ubah entri lama**.
- Waktu: session MySQL di-set `+07:00` (WIB); masa berlaku sesi/kunci memakai `UTC_TIMESTAMP()` (konsisten satu sama lain).

## 4. Hak akses (server/auth.js `PERMS`)

master = semua. admin = invoice, master, import, note, view. finance = payment, adjust, note, view. Kelola user, pengaturan, dan log = khusus role master.

## 5. Import (server/importer.js)

Header dicari dari baris berisi "Tanggal" + "...Inv"; baris di atasnya = nama barang (sel gabungan diteruskan ke kanan). Pasangan (qty, "Harga") antara Nama dan Total. Angka format Indonesia (titik = ribuan) atau Inggris. Tanggal: `1-Jan-26`, D/M/Y, ISO, serial Excel. Baris dengan No Inv sama → digabung. Status yang diawali "PO" → `po_ref`, lainnya → notes. Tgl Byr + Nominal → payment, dialokasikan maksimal sebesar total invoice. Nomor yang sudah ada dilewati (idempoten). Customer/barang/satuan yang belum ada dibuat otomatis.

Data acuan `test/fixtures/sheet-sample.js` = 17 baris persis dari screenshot user. Fakta penting yang ditemukan di sana:
- No Inv **3860 muncul 2x** (digabung). Hitungan 11.217.043 vs sheet 11.233.113 → **selisih 16.070**.
- 3860 dibayar Cash 10.933.000 + transfer Anthony 300.000 (transfer ada di teks Status, bukan kolom Nominal) → kurang 113 → tombol pembulatan.
- 3858 Adi D: qty tanpa harga (total 0).
- "Return 45kg", "susut 5.2kg" hanya teks; total tidak dikurangi.

## 6. Menjalankan & tes

- `npm run dev` → API :3200 (`node --watch`) + Vite :5180. `scripts/dev.js --db=nama` memakai DB lain.
- Preview di sesi Claude: config `telur-erp` / `telur-erp-uitest` (DB `telur_erp_uitest_zz`) di `C:\Users\Han\Downloads\Claude\.claude\launch.json`. **Uji UI selalu di DB uitest**, jangan di `telur_erp_db`. DB uitest dihapus setelah selesai.
- `npm test` = 17 tes (logika murni + alur API penuh di DB `telur_erp_test_zz` yang dibuat & dihapus sendiri). Butuh MySQL menyala.
- Sudah di-mutation-test: 13/14 mutasi tertangkap. Satu yang lolos (EPS di status lunas) adalah mutan ekuivalen karena `outstanding` sudah di-round2.

## 7. Jebakan yang sudah ditemui

- Tool preview menyuntik `PORT=5180` → API ikut bind 5180 dan bentrok dengan Vite. `scripts/dev.js` memaksa API `PORT=3200`.
- Klik browser berbasis koordinat meleset (frame screenshot 800×600 vs viewport 1024×768). Pakai `find` → klik `ref`.
- `window.confirm` memblokir browser tool. Override `window.confirm = () => true` saat uji.
- Input angka (`NumInput`) memakai format Indonesia: "100.8" dibaca 1008. Saat blur, angka diformat ulang supaya terlihat.
- CSV dibaca SheetJS dengan `raw: true` supaya "28.000" tidak jadi 28.

## 8. Ide berikutnya (belum diminta)

Cetak/PDF invoice, penutupan susut harian, dashboard ringkas, tombol duplikat invoice, export Excel.

## 9. Riwayat versi

- **1.0.0 (2026-10-17)**: rilis awal. Semua fitur di atas. Diverifikasi di browser: setup master, login, import 17 baris contoh, alur selisih 3860 sampai lunas (transfer 300rb, samakan total sheet, pembulatan 113), invoice baru dengan saran harga & margin, buat user + PIN sementara, laporan piutang, tampilan mobile 375px tanpa scroll horizontal halaman.
