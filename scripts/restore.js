// Pulihkan backup (.json.gz dari menu Pengaturan → Backup) ke database KOSONG.
// Pakai: npm run restore -- "telur-erp-backup-2026-10-17.json.gz"
// Sengaja menolak database yang sudah berisi transaksi/user, supaya tidak pernah menimpa data asli.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const zlib = require('zlib');
const { createPool, migrate } = require('../server/db');
const { BACKUP_TABLES } = require('../server/routes/finance');

async function restore(pool, file) {
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  if (data.app !== 'telur-erp') throw new Error('File ini bukan backup Telur ERP');
  await migrate(pool);
  const [[{ u }]] = await pool.query('SELECT COUNT(*) AS u FROM users');
  const [[{ i }]] = await pool.query('SELECT COUNT(*) AS i FROM invoices');
  if (u || i) throw new Error('Database tujuan tidak kosong (sudah ada user / invoice). Restore hanya ke database baru.');
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.beginTransaction();
    for (const t of [...BACKUP_TABLES].reverse()) await conn.query(`DELETE FROM \`${t}\``); // data bawaan migrasi diganti isi backup
    const counts = {};
    for (const t of BACKUP_TABLES) {
      const rows = data.tables[t] || [];
      counts[t] = rows.length;
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      for (let k = 0; k < rows.length; k += 500) {
        const chunk = rows.slice(k, k + 500);
        await conn.query(`INSERT INTO \`${t}\` (${cols.map((c) => `\`${c}\``).join(',')}) VALUES ?`, [chunk.map((r) => cols.map((c) => r[c]))]);
      }
    }
    await conn.commit();
    return { createdAt: data.created_at, version: data.version, counts };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    conn.release();
  }
}

if (require.main === module) {
  (async () => {
    const file = process.argv[2];
    if (!file) { console.log('Pakai: npm run restore -- "file-backup.json.gz"'); process.exit(1); }
    const pool = await createPool();
    try {
      const r = await restore(pool, file);
      console.log(`Berhasil dipulihkan (backup ${r.createdAt}, versi ${r.version}):`, r.counts);
    } catch (e) {
      console.error('Gagal:', e.message);
      process.exitCode = 1;
    } finally { await pool.end(); }
  })();
}

module.exports = { restore };
