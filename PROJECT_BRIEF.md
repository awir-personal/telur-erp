# PROJECT BRIEF — Telur ERP

Sumber kebenaran untuk melanjutkan project ini. Baca seluruhnya sebelum mengubah apa pun.

## 1. Apa ini

ERP sederhana untuk perusahaan **distribusi telur** milik user: beli telur dari supplier/peternak, jual ke customer, target stok akhir 0. Menggantikan Google Sheet penjualan (screenshot acuan: kolom Tanggal | No Inv | Nama | Telor Curah/Omega/Putih/Tray-Peti/Retak/Bocor (kg + Harga) | Total | Tgl Byr | Nominal | Status).

- Lokasi: `C:\Users\Han\Downloads\Claude\telur-erp`
- **Live di Railway sejak 2026-10-17: https://telur-erp-production.up.railway.app** (project "alert-exploration", MySQL Railway). User memilih **mulai dari nol di server**: data lokal `telur_erp_db` TIDAK dipindahkan. Setelah ini server adalah data utama. Push ke `main` = deploy otomatis, jadi setiap rilis langsung live. Cek setelah push: `curl https://telur-erp-production.up.railway.app/api/version`.
- Stack: **web app** Node 20+ + Express 5 + mysql2 + React 18 (Vite 5, Tailwind 3), satu repo, BUKAN Electron.
- DB lokal `telur_erp_db` (MySQL80 bersama app lain). Server: Railway + plugin MySQL (`MYSQL_URL`).
- Versi: lihat `package.json`. **Konvensi sama dengan semua app user: tampil vX.Y di pojok kiri bawah** (X = perubahan besar, Y = perubahan kecil/bug, angka ketiga tidak dipakai, selalu .0). Rilis 1.0.1 terlanjur memakai angka ketiga; menurut konvensi itu setara v1.1.
- Tampilan: palet `brand` amber penuh 50–950 (sama dengan app Distributor Telur lama, beda dari biru/teal/cyan app lain), header `bg-brand-700` + judul & subjudul, tab menu putih, toggle 🌙 Gelap / ☀️ Terang (`src/lib/theme.jsx`, darkMode class), dialog konfirmasi sendiri (`src/lib/confirm.jsx`, bukan window.confirm). Warna terang di halaman diberi varian gelap secara global di `src/index.css` (`.dark .bg-white` dst.).

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
| No Inv dobel di sheet (2026-10-29) | **1 baris sheet = 1 invoice, apa adanya** ("tetap dimasukkan as-is, nanti di-notes user, tidak ada data dirubah"). Berlaku untuk nama BEDA (22 kasus di sheet asli) maupun nama SAMA (~700 invoice, mis. 3860) - user memilih "juga dipisah per baris" walau saya merekomendasikan tetap digabung. Nomor sama persis (bukan akhiran -2). Ditandai "No Inv dobel" + masuk daftar tindak lanjut Dashboard sampai diberi catatan (`dup_note`). Invoice yang diketik manual tetap tidak boleh memakai nomor yang sudah ada |
| User | Nama + PIN 6 digit, ganti PIN, reset PIN oleh master. **Master TIDAK bisa melihat PIN** (user memilih hash + reset dibanding PIN yang bisa dibaca) |
| Repo | `awir-personal/telur-erp` (private) |
| Isi v2.0 (2026-10-17) | Dashboard, cetak/PDF invoice, export Excel, Kas & Bank |
| Rekening di pembayaran | **Opsional** (user menolak rekomendasi "wajib"). Pembayaran tanpa rekening tidak masuk saldo mana pun, tapi dihitung & diperingatkan di Kas & Bank |
| Isi v3.0 | Siap Railway, PWA (install di HP), backup, rekonsiliasi bank (BCA/BNI/Mandiri + pemetaan manual), jurnal & laporan keuangan |
| HPP laporan keuangan | **Periodik** (persediaan awal + pembelian − persediaan akhir), laporan margin tetap pakai harga beli ketikan. Selisih keduanya ditampilkan sebagai kontrol |

## 3. Model data (server/db.js, migrasi otomatis saat start)

- `invoices` (kind `sale`|`purchase`) + `invoice_lines` (item, unit, qty, price, cost_price). Total TIDAK disimpan; selalu dihitung Σ round2(qty×price).
- `payments` (kind, party, method, amount) + `allocations` (payment→invoice, amount). **Banyak-ke-banyak**: 1 invoice dibayar berkali-kali, 1 pembayaran untuk banyak invoice. Sisa pembayaran yang tidak dialokasi = "saldo belum dialokasi".
- `adjustments` per invoice: retur | susut | pembulatan | diskon | lainnya. `amount` positif = mengurangi tagihan.
- `invoices.imported_total` = total di sheet asal (hanya hasil import); `diff_note` = justifikasi. `diffOpen` = selisih ≠ 0 dan belum ada justifikasi.
- **No Inv TIDAK unik lagi sejak v3.3** (migrasi 004: `uq_inv` diganti indeks biasa `ix_inv_number`). `import_seq` = urutan kemunculan No Inv di sheet (1, 2, ...; NULL = diketik manual / hasil import lama yang menggabung baris). `dup_note` = catatan user. `dupCount` (jumlah invoice bernomor sama, per kind) & `dupOpen` (dobel tanpa catatan) dihitung di `loadInvoices`. Cek dobel untuk invoice manual ada di aplikasi (`routes/invoices.js`), hanya saat nomor baru/diganti - jadi invoice dobel hasil import tetap bisa diedit.
- Sisa = total − Σadjustments − Σallocations. Status: lunas | sebagian | belum | lebih_bayar.
- `parties` (customer/supplier, term_days, price_rule), `party_prices`, `items` (urutan kolom sheet), `units` (kg_per_unit), `users`, `sessions` (token di-hash sha256, 12 jam), `settings` (next_sale_no, next_purchase_no, company_name), `activity_log`.
- Migrasi: tambah entri baru di `MIGRATIONS`, **jangan pernah ubah entri lama**. Setiap pernyataan WAJIB aman diulang (`CREATE TABLE IF NOT EXISTS`, `INSERT IGNORE`, cek kolom sebelum `ALTER`), karena DDL MySQL tidak bisa di-rollback. Migrasi yang terputus dilanjutkan pada start berikutnya. `GET_LOCK` mencegah dua proses bermigrasi bersamaan (`test/migrate.test.js`).
- Waktu: session MySQL di-set `+07:00` (WIB); masa berlaku sesi/kunci memakai `UTC_TIMESTAMP()` (konsisten satu sama lain).

### Kas & Bank (v2.0, migrasi `002_kas_bank`)
- `accounts` (kas/bank, saldo awal + tanggal saldo awal), `cash_categories` (biaya/pemasukan/modal/prive), `cash_txns` (biaya, pemasukan, modal, prive, transfer), `payments.account_id` (opsional).
- Saldo = saldo awal + mutasi SEJAK tanggal saldo awal. Mutasi sebelum tanggal itu tidak dihitung (sudah termasuk di saldo awal) dan dilaporkan sebagai `ignoredBeforeOpening`. Logikanya ada di `server/routes/cash.js` (`movements`, `balanceOf`), dipakai bersama oleh Dashboard.
- Export Excel di browser (`src/lib/excel.js`): angka tetap angka, tanggal jadi sel tanggal asli (format d-mmm-yy). Export Penjualan/Pembelian memakai susunan sheet lama (2 baris header + merge).
- **Export ESB Simple Purchase** (v3.4, tombol "⬇ Export ESB" di halaman Pembelian, ikut filter yang tampil): `src/lib/esb.mjs` (murni, dites di node) -> sheet "Sheet1" 25 kolom persis template `ESB_FNB_SIMPLE_PURCHASE_TEMPLATE_INDEX-new.xlsx` user. 1 nota = 1 Sequence (semua baris barangnya), Supplier = nama supplier ERP, Date = tanggal Excel asli format m/d/yy, Branch "Head Office", Location "Main Warehouse", Payment Method "Credit" (isian file ESB lama user), **Credit Term = termin supplier di ERP**, **Supplier Invoice Number "Invoice <No>"**, Additional Info "<Supplier> Invoice <No>", IDR/1/Item, Unit "Kg"/"Tray" (huruf besar di depan), Disc 0, kolom lain KOSONG (sel tidak ada, bukan teks kosong). Nama barang "Telor ..." ditulis "Telur ..." di file ESB saja (master barang ESB user memakai "Telur"; nama ERP tidak diubah supaya import sheet tetap cocok). Nota tanpa barang dilewati; nota yang punya retur/diskon/penyesuaian diperingatkan (penyesuaian tidak bisa jadi baris Item, catat terpisah di ESB). Nama supplier & barang harus sudah ada di master ESB.
- Cetak invoice: `/invoice/:id/cetak` → `window.print()` (PDF lewat "Simpan sebagai PDF"). Data perusahaan (nama, alamat, telepon) diatur di Pengaturan.

### Rekonsiliasi bank (v3.0, migrasi `003_rekonsiliasi_jurnal`)
- `server/bankParser.js` (murni): deteksi baris header dari sinonim (Tanggal/Post Date, Keterangan/Description, Debet/Debit, Kredit/Credit, Jumlah + DB/CR, Saldo/Balance). Angka fleksibel (1.234,56 / 1,234.56 / "x CR"). Tanggal: serial Excel, D/M/Y, "02 Jan 2026", "dd/mm" tanpa tahun (KlikBCA, pakai opsi tahun). Kolom DB/CR tanpa judul di kanan "Jumlah" dikenali dari isinya. Baris tanpa nominal = lanjutan keterangan baris sebelumnya.
- **Arah Debet ditentukan dari kolom saldo** (`debet_keluar` = standar mutasi bank vs `debet_masuk` = buku kas sendiri). File "Laporan Arus Kas 2025 (BCA/BNI)" milik user di `C:\Users\Han\Downloads\APG`: header baris 3, kolom Tanggal(0) Keterangan(1) Debet(3) Kredit(4) Saldo(5), kolom 2 = rincian (diabaikan). Debet = KELUAR, saldo cocok 100% (BCA 20/20, BNI 153/153). Hanya STRUKTUR file yang pernah dibaca, isinya tidak pernah disalin.
- `bank_lines` unik per (rekening, sha256(tgl|ket|nominal|saldo|urutan)), jadi impor ulang tidak dobel. Transaksi identik di satu file dibedakan dengan nomor urut.
- Auto-cocok: nominal sama persis, tanggal ±3 hari, hanya transaksi yang rekeningnya SUDAH rekening itu. Kalau ragu (dua kandidat sama dekat), dilewati. Cocok manual ke pembayaran tanpa rekening otomatis mengisi rekeningnya. Dari baris mutasi bisa langsung dibuat biaya/pemasukan/modal/prive. Transaksi yang sudah cocok tidak bisa dihapus.

### Jurnal & laporan keuangan (v3.0, `server/journal.js`)
- Jurnal **diturunkan dari transaksi** (tidak disimpan) + jurnal memorial manual (`journal_entries/lines`, wajib seimbang). Bagan akun: tetap (`FIXED`) + `1101-<rekening>` + `6-<kategori biaya>` + `42-<kategori pemasukan>`.
- Invoice jual Dr 1201/Cr 4101 · beli Dr 5101/Cr 2101 · penyesuaian ke 4102/5102 · penerimaan Dr kas, Cr 1201 (teralokasi) + 2201 Uang Muka Pelanggan (sisa) · bayar supplier Dr 2101 + 1401 (sisa) / Cr kas · kas tanpa rekening = 1102 · saldo awal rekening Dr kas / Cr 3301.
- **Mutasi kas sebelum tanggal saldo awal rekening → sisi kas ke 3301** (aturan sama dengan Kas & Bank; ditemukan oleh tes saat saldo jurnal BCA beda 999 dari Kas & Bank).
- Persediaan (estimasi) = sisa qty per barang (satuan dinormalkan ke kg bila bisa) × harga beli rata-rata 60 hari (cadangan: semua pembelian). Stok negatif dinilai 0 dan diperingatkan. HPP periodik = pembelian − retur pembelian + persediaan awal − persediaan akhir. Neraca memasukkan nilai persediaan + laba kumulatif, dengan selisih ditampilkan (harus 0, dites).
- Backup: `GET /api/backup` (master) → `.json.gz` semua tabel kecuali sesi, mencatat `settings.last_backup_at` (Dashboard mengingatkan bila lebih dari 7 hari). Restore `npm run restore -- file` hanya ke DB tanpa user/invoice. Uji bolak-balik: neraca DB asal = neraca DB hasil restore.
- PWA: `public/manifest.webmanifest`, `public/sw.js` (tidak pernah cache `/api`), ikon dibuat oleh `scripts/make-icons.js` (PNG tanpa library). Railway: `railway.json`.

## 4. Hak akses (server/auth.js `PERMS`)

master = semua. admin = invoice, master, import, note, view. finance = payment, adjust, note, view, cash (Kas & Bank, rekonsiliasi, jurnal memorial). Backup = khusus master. Kelola user, pengaturan, dan log = khusus role master.

## 5. Import (server/importer.js)

Header dicari dari baris berisi "Tanggal" + "...Inv"; baris di atasnya = nama barang (sel gabungan diteruskan ke kanan). **Sheet dibaca mulai kolom "Tanggal"** (v3.2): kolom di kirinya diabaikan - sejak Okt 2026 sheet user punya kolom centang A-B "Sisca Done" / "Yusuf Done" (judul grup "Please Mark") sehingga Tanggal ada di kolom C. Kolom nama boleh "Nama" / "Nama Pelanggan" / "Nama Customer" / "Pelanggan" / "Customer"; kolom lain yang tidak dikenal (mis. "Tgl Tagih") diabaikan. Baris tanpa nama DAN tanpa angka (No Inv sisa rumus auto-increment di ekor sheet) dilewati diam-diam; tanpa nama tapi ada angka tetap error. Pasangan (qty, "Harga") antara Nama dan Total. Angka format Indonesia (titik = ribuan) atau Inggris. Tanggal: `1-Jan-26`, D/M/Y, ISO, serial Excel. **1 baris = 1 invoice (v3.3)**: No Inv yang muncul di beberapa baris TIDAK digabung/ditolak - tiap baris jadi invoice sendiri dengan nomor yang sama (`seq` = urutan kemunculan, dihitung sebelum validasi lain supaya baris error tidak menggeser urutan). Import ulang: nomor yang sudah ada dengan `import_seq` NULL (manual / import lama yang digabung) → semua barisnya dilewati; selain itu dilewati per `seq`. Nominal suatu baris dialokasikan ke invoice barisnya dulu, sisanya ke invoice bernomor & customer sama di import yang sama (3860: Nominal 10.933.000 di baris ke-2 ikut membayar baris ke-1), sisa yang tetap tak teralokasi = uang masuk belum dialokasikan. Status yang diawali "PO" → `po_ref`, lainnya → notes. Tgl Byr + Nominal → payment, dialokasikan maksimal sebesar total invoice. Nomor yang sudah ada dilewati (idempoten). Customer/barang/satuan yang belum ada dibuat otomatis.

Data acuan `test/fixtures/sheet-sample.js` = 17 baris persis dari screenshot user. Fakta penting yang ditemukan di sana:
- No Inv **3860 muncul 2x** → sejak v3.3 jadi 2 invoice bernomor sama: baris 12 (5 barang, hitungan 9.057.043 vs sheet 9.073.113 → **selisih 16.070**) dan baris 13 (2.160.000, lunas). Sampai v3.2 digabung (11.217.043 vs 11.233.113).
- 3860 dibayar Cash 10.933.000 + transfer Anthony 300.000 (transfer ada di teks Status, bukan kolom Nominal) → kurang 113 → tombol pembulatan.
- 3858 Adi D: qty tanpa harga (total 0).
- "Return 45kg", "susut 5.2kg" hanya teks; total tidak dikurangi.
- Sheet asli "AR GTA-APG" tab **"AR Telur HUB Global - APG"** (gid 1576503210, layout baru kolom C, s/d 23 Okt 2026, 5.988 baris): 3.484 invoice, 22 error asli (No Inv sama dipakai 2 nama berbeda). **Upload .xlsx, bukan .csv**: CSV Google Sheet berisi nilai TAMPILAN (kg dibulatkan 2 desimal) -> 580 invoice "selisih total" palsu; .xlsx (nilai asli) -> 62 selisih yang memang ada.

## 6. Menjalankan & tes

- `npm run dev` → API :3200 (`node --watch`) + Vite :5180. `scripts/dev.js --db=nama` memakai DB lain.
- Preview di sesi Claude: config `telur-erp-uitest` di `C:\Users\Han\Downloads\Claude\.claude\launch.json` → `scripts/uitest.js` (port **3299**, DB `telur_erp_uitest_zz`, build terpisah `npx vite build --outDir dist-uitest`). **Uji UI selalu di sini**, jangan di `telur_erp_db` / port 3200 / folder `dist` (milik app user yang mungkin sedang jalan). DB uitest dihapus setelah selesai.
- `npm test` = 33 tes (logika murni, parser bank, migrasi, alur API penuh di DB `*_zz` yang dibuat & dihapus sendiri). Butuh MySQL menyala.
- Sudah di-mutation-test: 13/14 mutasi tertangkap. Satu yang lolos (EPS di status lunas) adalah mutan ekuivalen karena `outstanding` sudah di-round2.

## 7. Jebakan yang sudah ditemui

- Tool preview menyuntik `PORT=5180` → API ikut bind 5180 dan bentrok dengan Vite. `scripts/dev.js` memaksa API `PORT=3200`.
- Klik browser berbasis koordinat meleset (frame screenshot 800×600 vs viewport 1024×768). Pakai `find` → klik `ref`.
- `window.confirm` memblokir browser tool. Override `window.confirm = () => true` saat uji.
- Input angka (`NumInput`) memakai format Indonesia: "100.8" dibaca 1008. Saat blur, angka diformat ulang supaya terlihat.
- CSV dibaca SheetJS dengan `raw: true` supaya "28.000" tidak jadi 28.

- PowerShell user memblokir `npm.ps1` ("running scripts is disabled"). Pakai `npm.cmd` atau `Jalankan Telur ERP.bat` (build + start di :3200, browser dibuka server saat siap lewat `OPEN_BROWSER=1`).
- `node --watch` tetap hidup walaupun server crash, dan Vite tetap melayani dengan proxy 500. Karena itu `.bat` untuk user memakai mode start biasa, dan `scripts/dev.js` mematikan seluruh pohon proses (`taskkill /T`) kalau salah satu proses mati.
- `preview_stop` bisa meninggalkan Vite yatim di :5180. Tapi proses di :3200/:5180 BELUM TENTU milik sesi Claude: user menjalankan .bat secara paralel. Matikan hanya PID yang Anda start sendiri. Penyebab DB setengah jadi di v1.0.1 adalah cleanup berbasis pola nama yang ikut membunuh server user di tengah migrasi.

## 8. Ide berikutnya (belum diminta)

Cetak/PDF invoice, penutupan susut harian, dashboard ringkas, tombol duplikat invoice, export Excel.

## 9. Riwayat versi

- **3.4.0 (2026-10-29)**: tombol **⬇ Export ESB** di Pembelian -> file import ESB "Simple Purchase" (keputusan user: sumber = nota pembelian ERP, Supplier Invoice Number "Invoice <No>", Credit Term ikut termin supplier). Diverifikasi end-to-end di browser uji: file hasil klik ditangkap di halaman dan dibaca ulang - Sheet1, header identik template, tanggal sel tanggal (numFmt 14), angka numerik, kolom tak dipakai benar-benar kosong, "Telur Curah". 33 tes, 6/6 mutasi export tertangkap.

- **3.3.0 (2026-10-29)**: import "1 baris sheet = 1 invoice apa adanya" - No Inv dobel (nama sama maupun beda) masuk sebagai beberapa invoice bernomor sama, ditandai "dobel" di daftar & detail, masuk tindak lanjut Dashboard sampai diberi catatan (kartu "No Inv … dipakai N invoice" + link ke semua invoice nomor itu, `/penjualan?q=` kini dibaca dari URL). Migrasi 004 (unik No Inv dilepas, `import_seq`, `dup_note`) diuji pada salinan telur_erp_db (hanya schema_migrations bertambah, diulang 2x aman). Import ulang tetap idempoten (per seq; nomor hasil import lama yang digabung dilewati seluruhnya). 32 tes (calc & api diperbarui), 6/6 mutasi baru tertangkap. Diverifikasi di browser (uitest): Dashboard "4 invoice ber-No Inv dobel", daftar 3860 ×2 berlabel dobel, catatan diketik → kartu jadi ✓ & label abu-abu.

- **3.2.0 (2026-10-29)**: import mengikuti perubahan kolom sheet (screenshot user: kolom A-B "Sisca Done"/"Yusuf Done", Tanggal di kolom C, "Nama Pelanggan", "Tgl Tagih") - dibaca **mulai kolom Tanggal**, kolom kiri diabaikan; sebelumnya ditolak "Kolom wajib tidak ditemukan: name". Baris ekor tanpa nama & tanpa angka tidak lagi jadi error (1.764 error palsu di tab asli). Tes baru: layout baru menghasilkan invoice IDENTIK dengan layout lama, judul kiri yang bentrok ("Nama"/"Total") diabaikan, ekor kosong dilewati; 3 mutasi (nama pelanggan, mulai kolom C, lewati ekor) tertangkap. Dicek ke sheet asli (baca-saja). 32 tes.

- **Deploy (2026-10-17, v3.1.0)**: Railway dikendalikan lewat Claude in Chrome dengan izin user per langkah (buat project dari repo, tambah MySQL berbayar). SETUP_CODE diketik sendiri oleh user. Domain baru dinyalakan SETELAH log tidak lagi berisi peringatan SETUP_CODE. Verifikasi: /healthz ok, /api/version 3.1.0, /api/auth/status setupCodeRequired=true.

- **3.1.0 (2026-10-17)**: menu "Penerimaan" → **Uang Masuk**, "Bayar Supplier" → **Uang Keluar** (permintaan user; alamat lama `/penerimaan` & `/pembayaran` dialihkan otomatis). Halaman Uang Keluar mengingatkan bahwa biaya operasional dicatat di Kas & Bank. Versi di pojok kini ditanam saat build (`__APP_VERSION__` di `vite.config.js`), tidak lagi dari `/api/version`: server lama milik user (start sebelum v1.2) menjawab 401 untuk endpoint itu → tampil "v?" dan bisa memicu logout.

- **3.0.0 (2026-10-17)**: rekonsiliasi bank (BCA/BNI/Mandiri/Arus Kas/manual), jurnal otomatis + memorial, Laba Rugi (HPP periodik + kontrol vs harga beli ketikan), Neraca, Arus Kas, Buku Besar, backup & restore, PWA, `railway.json`. 31 tes, 15/15 mutasi v3 tertangkap (setelah 4 tes tambahan). Migrasi 002+003 diuji pada SALINAN telur_erp_db: hanya menambah tabel, data lama utuh, neraca seimbang, DB asli tidak berubah. Diverifikasi di browser: impor CSV gaya KlikBCA → 2 cocok otomatis → biaya admin dibuat dari baris mutasi → saldo bank = sistem; neraca seimbang; laba rugi menandai selisih HPP.
- **2.0.0 (2026-10-17)**: Dashboard (halaman awal: penjualan hari/bulan ini, margin, piutang lewat jatuh tempo, daftar hal yang perlu ditindaklanjuti, saldo kas), cetak/PDF invoice, export Excel (Penjualan/Pembelian format sheet lama, umur piutang/hutang, buku rekening), Kas & Bank (rekening, biaya/pemasukan/modal/prive/transfer, buku mutasi + saldo berjalan, rekening opsional di pembayaran). 21 tes; 7/7 mutasi baru tertangkap.

- **1.2.0 (2026-10-17)**: tampilan disamakan dengan app lain (lihat bagian 1), versi vX.Y di pojok, mode gelap, dialog konfirmasi sendiri. Bug: invoice dengan harga kosong (total 0) tertulis "Lunas", sekarang "Belum bayar". Server uji Claude dipindah ke port 3299 + `dist-uitest` + DB `telur_erp_uitest_zz` (`scripts/uitest.js`), karena user menjalankan app aslinya di 3200 bersamaan.

- **1.0.1 (2026-10-17)**: perbaikan dari laporan user "gagal run & error 500". (1) `npm` diblokir execution policy PowerShell → tambah `Jalankan Telur ERP.bat` (npm.cmd). (2) Vite sisa preview tetap memegang :5180 tanpa API → `dev.js` mematikan seluruh pohon proses, `.bat` memakai mode start biasa. (3) Ditemukan `telur_erp_db` setengah termigrasi (DDL terputus) yang akan membuat setiap start gagal → migrasi dibuat idempoten + `GET_LOCK`, dan DB itu sudah dilengkapi (masih 0 user). Pesan error 500 tanpa body dan port terpakai diperjelas.

- **1.0.0 (2026-10-17)**: rilis awal. Semua fitur di atas. Diverifikasi di browser: setup master, login, import 17 baris contoh, alur selisih 3860 sampai lunas (transfer 300rb, samakan total sheet, pembulatan 113), invoice baru dengan saran harga & margin, buat user + PIN sementara, laporan piutang, tampilan mobile 375px tanpa scroll horizontal halaman.
