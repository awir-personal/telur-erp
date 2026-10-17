// Migrasi harus pulih dari skema setengah jadi dan aman saat dua proses start bersamaan.
// Memakai database sendiri (telur_erp_migtest_zz) yang dibuat & dihapus di sini.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const { createPool, migrate, connConfig } = require('../server/db');

const DB = 'telur_erp_migtest_zz';
let expectedTables = null; // jumlah tabel hasil migrasi bersih (tes pertama)
async function dropDb() {
  const c = await mysql.createConnection({ ...connConfig(DB), database: undefined });
  await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await c.end();
}
async function tables(pool) {
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?', [DB]);
  return rows[0].n;
}

test.after(dropDb);

test('dua proses migrasi bersamaan di database kosong', async () => {
  await dropDb();
  const [a, b] = [await createPool(DB), await createPool(DB)];
  try {
    await Promise.all([migrate(a), migrate(b)]);
    expectedTables = await tables(a);
    assert.ok(expectedTables >= 14);
    const [[{ n }]] = await a.query('SELECT COUNT(*) AS n FROM units');
    assert.equal(n, 5); // seed tidak dobel
  } finally { await a.end(); await b.end(); }
});

test('melanjutkan migrasi yang terputus di tengah (sebagian tabel sudah ada, belum tercatat)', async () => {
  await dropDb();
  const pool = await createPool(DB);
  try {
    // Kondisi nyata yang pernah terjadi: beberapa tabel + seed sudah ada, schema_migrations kosong.
    await pool.query('CREATE TABLE schema_migrations (id VARCHAR(60) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    await pool.query('CREATE TABLE units (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(30) NOT NULL UNIQUE, kg_per_unit DECIMAL(12,4) NULL, active TINYINT NOT NULL DEFAULT 1)');
    await pool.query("INSERT INTO units (name, kg_per_unit) VALUES ('kg',1),('ikat',15)");
    await migrate(pool);
    assert.equal(await tables(pool), expectedTables);
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM units');
    assert.equal(n, 5);
    await migrate(pool); // start berikutnya tidak error
  } finally { await pool.end(); }
});
