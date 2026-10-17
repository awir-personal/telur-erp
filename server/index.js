require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
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
  app.listen(port, host, () => console.log(`Telur ERP jalan di http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
})().catch((e) => { console.error('Gagal start:', e.message || e); process.exit(1); });
