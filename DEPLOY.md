# Deploy ke Railway

Sama seperti Mahjong Online, tapi app ini **punya database**, jadi butuh layanan MySQL di Railway (ada biaya bulanan sendiri). Pengaturan build/start/health check sudah ada di `railway.json`.

1. Repo `awir-personal/telur-erp` (private). Beri izin repo ini ke GitHub App Railway. Di Mahjong, deploy gagal karena izin ini lupa diberikan.
2. Railway → New Project → Deploy from GitHub repo → pilih `telur-erp`. Root Directory dikosongkan (package.json ada di akar repo, tidak seperti monorepo `games`).
3. Di project yang sama: **+ New → Database → MySQL**.
4. Di service app → Variables:
   - `MYSQL_URL` = `${{MySQL.MYSQL_URL}}`
   - `NODE_ENV` = `production`
   - `SETUP_CODE` = kode rahasia buatan sendiri. **Wajib.** Tanpa ini, siapa pun yang membuka URL pertama kali bisa menjadi master user.
5. Deploy. Tabel dibuat otomatis saat start (migrasi aman diulang). Lalu Settings → Networking → **Generate Domain**.
6. Buka URL itu → buat Master User dengan `SETUP_CODE`.

## Memindahkan data dari PC ke server

Data lokal (localhost) dan data server terpisah. Untuk pindah:
1. Di app lokal: Pengaturan → **Unduh backup sekarang** (file `.json.gz`).
2. Pulihkan ke database Railway yang masih **kosong**. Jalankan dari PC dengan `MYSQL_URL` publik Railway (tab MySQL → Connect → Public URL):

```bash
set MYSQL_URL=mysql://...public-url... && npm.cmd run restore -- "telur-erp-backup-2026-10-17.json.gz"
```

   Restore menolak database yang sudah berisi user/invoice. Jadi pulihkan **sebelum** membuat master user di server: user, PIN, dan data ikut terbawa dari backup.
3. Setelah pindah, berhenti input di localhost supaya data tidak bercabang.

## Install di HP (PWA)

Buka URL Railway (https) di Chrome HP → menu ⋮ → **Install app / Tambahkan ke layar utama**. Di iPhone: Safari → Share → Add to Home Screen. Data selalu diambil langsung dari server; app tidak menyimpan angka keuangan di HP.

## Catatan

- Backup rutin: Pengaturan → Backup (Dashboard mengingatkan bila lebih dari 7 hari). Railway MySQL juga punya tab Backups.
- Server berjalan di UTC; app memakai WIB untuk tanggal "hari ini" dan waktu log.
- Health check: `/healthz`.
