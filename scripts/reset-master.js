// Darurat: semua master lupa PIN. Jalankan di server: npm run reset-master -- "Nama Master"
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createPool, migrate } = require('../server/db');
const { hashPin, randomPin } = require('../server/auth');

(async () => {
  const name = process.argv[2];
  if (!name) { console.log('Pakai: npm run reset-master -- "Nama Master"'); process.exit(1); }
  const pool = await createPool();
  await migrate(pool);
  const pin = randomPin();
  const [r] = await pool.query('UPDATE users SET pin_hash = ?, must_change_pin = 1, failed_attempts = 0, locked_until = NULL, active = 1 WHERE name = ? AND role = "master"', [await hashPin(pin), name]);
  console.log(r.affectedRows ? `PIN sementara untuk ${name}: ${pin} (wajib diganti saat login)` : `Master "${name}" tidak ditemukan`);
  await pool.end();
})();
