// Koneksi MySQL + migrasi otomatis saat server start.
// Lokal: DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME. Railway: MYSQL_URL.
const mysql = require('mysql2/promise');

const POOL_OPTS = { dateStrings: true, decimalNumbers: true, supportBigNumbers: true, timezone: 'Z', charset: 'utf8mb4' };

function connConfig(dbName) {
  if (process.env.MYSQL_URL) {
    const u = new URL(process.env.MYSQL_URL);
    return {
      host: u.hostname, port: Number(u.port || 3306),
      user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
      database: dbName || u.pathname.replace(/^\//, ''),
    };
  }
  return {
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
    database: dbName || process.env.DB_NAME || 'telur_erp_db',
  };
}

async function createPool(dbName) {
  const cfg = connConfig(dbName);
  // Lokal: buat database kalau belum ada. Di Railway database sudah disediakan.
  if (!process.env.MYSQL_URL) {
    const c = await mysql.createConnection({ ...cfg, database: undefined });
    await c.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await c.end();
  }
  const pool = mysql.createPool({ ...cfg, ...POOL_OPTS, connectionLimit: 10 });
  // created_at / log tercatat dalam WIB, sama di PC lokal maupun server Railway (UTC).
  pool.pool.on('connection', (c) => c.query("SET time_zone = '+07:00'"));
  return pool;
}

// Setiap entri dijalankan sekali, dicatat di schema_migrations. Jangan ubah entri lama — tambah entri baru.
const MIGRATIONS = [
  ['001_init', [
    `CREATE TABLE users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(60) NOT NULL UNIQUE,
      role ENUM('master','admin','finance') NOT NULL,
      pin_hash VARCHAR(200) NOT NULL,
      must_change_pin TINYINT NOT NULL DEFAULT 1,
      active TINYINT NOT NULL DEFAULT 1,
      failed_attempts INT NOT NULL DEFAULT 0,
      locked_until DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE sessions (
      token_hash CHAR(64) PRIMARY KEY,
      user_id INT NOT NULL,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE settings (k VARCHAR(50) PRIMARY KEY, v VARCHAR(255) NOT NULL)`,
    `CREATE TABLE parties (
      id INT AUTO_INCREMENT PRIMARY KEY,
      kind ENUM('customer','supplier') NOT NULL,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(40) NULL,
      address VARCHAR(255) NULL,
      term_days INT NOT NULL DEFAULT 30,
      price_rule TEXT NULL,
      notes TEXT NULL,
      active TINYINT NOT NULL DEFAULT 1,
      UNIQUE KEY uq_party (kind, name)
    )`,
    `CREATE TABLE units (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(30) NOT NULL UNIQUE,
      kg_per_unit DECIMAL(12,4) NULL,
      active TINYINT NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(80) NOT NULL UNIQUE,
      default_unit_id INT NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      active TINYINT NOT NULL DEFAULT 1,
      FOREIGN KEY (default_unit_id) REFERENCES units(id)
    )`,
    `CREATE TABLE party_prices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      party_id INT NOT NULL,
      item_id INT NOT NULL,
      unit_id INT NOT NULL,
      price DECIMAL(15,2) NOT NULL,
      note VARCHAR(255) NULL,
      UNIQUE KEY uq_pp (party_id, item_id, unit_id),
      FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id),
      FOREIGN KEY (unit_id) REFERENCES units(id)
    )`,
    `CREATE TABLE invoices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      kind ENUM('sale','purchase') NOT NULL,
      number VARCHAR(40) NOT NULL,
      date DATE NOT NULL,
      party_id INT NOT NULL,
      due_date DATE NOT NULL,
      po_ref VARCHAR(120) NULL,
      notes TEXT NULL,
      imported_total DECIMAL(15,2) NULL,
      diff_note TEXT NULL,
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_inv (kind, number),
      KEY ix_inv_date (kind, date),
      FOREIGN KEY (party_id) REFERENCES parties(id)
    )`,
    `CREATE TABLE invoice_lines (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id INT NOT NULL,
      item_id INT NOT NULL,
      unit_id INT NOT NULL,
      qty DECIMAL(14,3) NOT NULL,
      price DECIMAL(15,2) NOT NULL,
      cost_price DECIMAL(15,2) NULL,
      note VARCHAR(255) NULL,
      sort INT NOT NULL DEFAULT 0,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id),
      FOREIGN KEY (unit_id) REFERENCES units(id)
    )`,
    `CREATE TABLE payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      kind ENUM('sale','purchase') NOT NULL,
      date DATE NOT NULL,
      party_id INT NOT NULL,
      method ENUM('cash','transfer','giro','lainnya') NOT NULL,
      reference VARCHAR(120) NULL,
      amount DECIMAL(15,2) NOT NULL,
      notes TEXT NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (party_id) REFERENCES parties(id)
    )`,
    `CREATE TABLE allocations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      payment_id INT NOT NULL,
      invoice_id INT NOT NULL,
      amount DECIMAL(15,2) NOT NULL,
      UNIQUE KEY uq_alloc (payment_id, invoice_id),
      FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`,
    `CREATE TABLE adjustments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id INT NOT NULL,
      date DATE NOT NULL,
      type ENUM('retur','susut','pembulatan','diskon','lainnya') NOT NULL,
      amount DECIMAL(15,2) NOT NULL,
      qty DECIMAL(14,3) NULL,
      note VARCHAR(255) NOT NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE activity_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_id INT NULL,
      user_name VARCHAR(60) NULL,
      action VARCHAR(40) NOT NULL,
      entity VARCHAR(40) NOT NULL,
      entity_id INT NULL,
      detail TEXT NULL,
      KEY ix_log_at (at)
    )`,
    `INSERT INTO units (name, kg_per_unit) VALUES ('kg',1),('ikat',15),('peti',NULL),('tray',NULL),('butir',NULL)`,
    `INSERT INTO items (name, default_unit_id, sort_order) VALUES
      ('Telor Curah',1,10),('Telor Omega',1,20),('Telor Putih',1,30),('Tray/Peti',4,40),('Telor Retak',1,50),('Telor Bocor',1,60)`,
    `INSERT INTO settings (k, v) VALUES ('next_sale_no','1'),('company_name','Distribusi Telur')`,
  ]],
];

async function migrate(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id VARCHAR(60) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  const [done] = await pool.query('SELECT id FROM schema_migrations');
  const applied = new Set(done.map((r) => r.id));
  for (const [id, stmts] of MIGRATIONS) {
    if (applied.has(id)) continue;
    const conn = await pool.getConnection();
    try {
      for (const s of stmts) await conn.query(s);
      await conn.query('INSERT INTO schema_migrations (id) VALUES (?)', [id]);
    } finally { conn.release(); }
  }
}

module.exports = { createPool, migrate, connConfig };
