# Telur ERP

ERP sederhana untuk distributor telur: penjualan (format sama dengan sheet lama), pembelian, pembayaran multi-invoice, selisih & pembulatan, umur piutang/hutang, margin, info stok, master data, master user (nama + PIN), log aktivitas, import sheet lama.

Web app (Node + Express + React + MySQL). Jalan di localhost dulu, nanti di-hosting di Railway seperti Mahjong Online.

## Jalankan di PC (localhost)

Butuh: Node 20+, MySQL80 menyala, file `.env` (salin dari `.env.example`, isi `DB_PASSWORD`).

**Pemakaian sehari-hari:** klik dua kali `Jalankan Telur ERP.bat`. Browser terbuka sendiri ke http://localhost:3200 setelah server siap. Untuk berhenti, tutup jendela hitamnya.

> Kalau mengetik `npm ...` di PowerShell muncul *"running scripts is disabled on this system"*, pakai `npm.cmd` (mis. `npm.cmd run dev`) atau file .bat di atas.

**Mode development** (API :3200 + Vite :5180, auto-reload):

```bash
npm.cmd run dev
```

Buka http://localhost:5180. Di mode ini, kalau API crash (mis. MySQL belum menyala), jendela tetap terbuka menunggu perubahan file. Pesan "Server API tidak merespons" akan muncul di layar sampai Anda memperbaiki penyebabnya atau menjalankan ulang. Untuk pemakaian biasa, pakai file .bat.

Database `telur_erp_db` dan semua tabel dibuat otomatis saat server start. Saat pertama dibuka, app meminta pembuatan **Master User**.

Supaya bisa dibuka dari HP di Wi-Fi yang sama: tambahkan `HOST=0.0.0.0` di `.env`, lalu buka `http://<IP-PC>:3200`.

## Peran user

| Peran | Bisa |
|---|---|
| Master | Semua + kelola user (buat, nonaktifkan, reset PIN), pengaturan, log aktivitas |
| Admin | Buat/ubah invoice penjualan & nota pembelian, master data, import |
| Finance | Catat/validasi pembayaran, retur/susut/diskon, pembulatan, justifikasi selisih |

PIN disimpan dalam bentuk hash. Tidak ada yang bisa melihat PIN siapa pun, termasuk master. Master hanya bisa reset: sistem membuat PIN sementara yang tampil sekali, dan user wajib menggantinya saat login. Salah PIN 5x membuat user terkunci 15 menit.

Kalau semua master lupa PIN (darurat, dijalankan di server):

```bash
npm run reset-master -- "Nama Master"
```

## Tes

```bash
npm test
```

Butuh MySQL menyala. Tes membuat & menghapus database sendiri (`telur_erp_test_zz`), tidak menyentuh `telur_erp_db`.

Deploy ke server: lihat [DEPLOY.md](DEPLOY.md). Detail desain: [PROJECT_BRIEF.md](PROJECT_BRIEF.md).
