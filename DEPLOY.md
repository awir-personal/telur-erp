# Deploy ke Railway

Sama seperti Mahjong Online, tapi app ini **punya database**, jadi butuh layanan MySQL di Railway (ada biaya bulanan sendiri).

1. Push repo ini ke GitHub (private). Pastikan GitHub App Railway diberi izin ke repo ini. Pengalaman Mahjong: kalau izin ini lupa diberikan, deploy gagal.
2. Railway → New Project → Deploy from GitHub repo → pilih `telur-erp`.
   - Root Directory: kosong (package.json ada di akar repo, tidak seperti monorepo `games`).
   - Build command: `npm run build` · Start command: `npm start`.
3. Di project yang sama: **+ New → Database → MySQL**.
4. Di service app → Variables:
   - `MYSQL_URL` = `${{MySQL.MYSQL_URL}}` (referensi ke layanan MySQL)
   - `NODE_ENV` = `production`
   - `SETUP_CODE` = kode rahasia buatan sendiri. **Wajib.** Tanpa ini, siapa pun yang membuka app pertama kali bisa menjadi master user.
5. Deploy. Tabel dibuat otomatis saat start. Buka URL Railway, buat Master User memakai `SETUP_CODE`.
6. Settings → Networking → Generate Domain.

Health check: `/healthz`.

## Catatan

- Data di Railway terpisah dari data di PC (localhost). Pakai salah satu sebagai data utama. Kalau sudah pindah ke server, jangan input di localhost lagi.
- Backup: Railway MySQL → tab Backups, atau `mysqldump` memakai kredensial dari Variables.
- Server berjalan di UTC. App sudah memakai WIB untuk tanggal "hari ini" dan waktu log.
