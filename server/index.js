require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { exec } = require('child_process');
const { createPool, migrate } = require('./db');
const { createApp } = require('./app');

(async () => {
  if (process.env.NODE_ENV === 'production' && !process.env.SETUP_CODE) {
    console.warn('PERINGATAN: SETUP_CODE belum diisi. Siapa pun yang membuka app pertama kali bisa jadi master user.');
  }
  const pool = await createPool();
  await migrate(pool);
  const app = createApp(pool, { setupCode: process.env.SETUP_CODE || null });
  const port = Number(process.env.PORT || 3200);
  const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  const url = `http://localhost:${port}`;
  const server = app.listen(port, host, () => {
    console.log(`Telur ERP jalan di ${url}  (tutup jendela ini untuk berhenti)`);
    // Dibuka setelah server siap, supaya tidak muncul halaman "tidak bisa terhubung".
    if (process.env.OPEN_BROWSER === '1' && process.platform === 'win32') exec(`start "" ${url}`);
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE'
      ? `Port ${port} sudah dipakai. Telur ERP mungkin sudah jalan di jendela lain: buka ${url}, atau tutup jendela itu dulu.`
      : `Gagal start: ${e.message}`);
    process.exit(1);
  });
})().catch((e) => {
  const dbDown = e.code === 'ECONNREFUSED' || e.name === 'AggregateError';
  console.error(dbDown ? 'Gagal start: MySQL tidak bisa dihubungi. Pastikan service MySQL80 menyala.' : `Gagal start: ${e.message || e}`);
  process.exit(1);
});
