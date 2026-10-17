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
    `CREATE TABLE IF NOT EXISTS users (
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
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash CHAR(64) PRIMARY KEY,
      user_id INT NOT NULL,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS settings (k VARCHAR(50) PRIMARY KEY, v VARCHAR(255) NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS parties (
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
    `CREATE TABLE IF NOT EXISTS units (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(30) NOT NULL UNIQUE,
      kg_per_unit DECIMAL(12,4) NULL,
      active TINYINT NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(80) NOT NULL UNIQUE,
      default_unit_id INT NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      active TINYINT NOT NULL DEFAULT 1,
      FOREIGN KEY (default_unit_id) REFERENCES units(id)
    )`,
    `CREATE TABLE IF NOT EXISTS party_prices (
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
    `CREATE TABLE IF NOT EXISTS invoices (
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
    `CREATE TABLE IF NOT EXISTS invoice_lines (
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
    `CREATE TABLE IF NOT EXISTS payments (
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
    `CREATE TABLE IF NOT EXISTS allocations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      payment_id INT NOT NULL,
      invoice_id INT NOT NULL,
      amount DECIMAL(15,2) NOT NULL,
      UNIQUE KEY uq_alloc (payment_id, invoice_id),
      FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )`,
    `CREATE TABLE IF NOT EXISTS adjustments (
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
    `CREATE TABLE IF NOT EXISTS activity_log (
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
    `INSERT IGNORE INTO units (name, kg_per_unit) VALUES ('kg',1),('ikat',15),('peti',NULL),('tray',NULL),('butir',NULL)`,
    `INSERT IGNORE INTO items (name, default_unit_id, sort_order) VALUES
      ('Telor Curah',1,10),('Telor Omega',1,20),('Telor Putih',1,30),('Tray/Peti',4,40),('Telor Retak',1,50),('Telor Bocor',1,60)`,
    `INSERT IGNORE INTO settings (k, v) VALUES ('next_sale_no','1'),('company_name','Distribusi Telur')`,
  ]],
  // v2.0 — Kas & Bank. Rekening di pembayaran OPSIONAL (keputusan user).
  ['002_kas_bank', [
    `CREATE TABLE IF NOT EXISTS accounts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(80) NOT NULL UNIQUE,
      type ENUM('kas','bank') NOT NULL,
      bank VARCHAR(30) NULL,
      account_no VARCHAR(40) NULL,
      opening_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
      opening_date DATE NULL,
      sort_order INT NOT NULL DEFAULT 0,
      active TINYINT NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS cash_categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      kind ENUM('biaya','pemasukan','modal','prive') NOT NULL,
      name VARCHAR(80) NOT NULL,
      active TINYINT NOT NULL DEFAULT 1,
      UNIQUE KEY uq_cat (kind, name)
    )`,
    `CREATE TABLE IF NOT EXISTS cash_txns (
      id INT AUTO_INCREMENT PRIMARY KEY,
      date DATE NOT NULL,
      kind ENUM('biaya','pemasukan','modal','prive','transfer') NOT NULL,
      account_id INT NOT NULL,
      to_account_id INT NULL,
      category_id INT NULL,
      amount DECIMAL(15,2) NOT NULL,
      reference VARCHAR(120) NULL,
      note VARCHAR(255) NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY ix_cash_date (date),
      FOREIGN KEY (account_id) REFERENCES accounts(id),
      FOREIGN KEY (to_account_id) REFERENCES accounts(id),
      FOREIGN KEY (category_id) REFERENCES cash_categories(id)
    )`,
    addColumn('payments', 'account_id', 'INT NULL'),
    `INSERT IGNORE INTO accounts (name, type, sort_order) VALUES ('Kas Tunai', 'kas', 0)`,
    `INSERT IGNORE INTO cash_categories (kind, name) VALUES
      ('biaya','Transport & Ongkir'),('biaya','Gaji & Upah'),('biaya','Sewa'),('biaya','Listrik, Air & Internet'),
      ('biaya','Kemasan & Tray'),('biaya','Biaya Bank'),('biaya','Lain-lain'),
      ('pemasukan','Pendapatan Lain'),('pemasukan','Bunga Bank'),('modal','Setoran Modal'),('prive','Penarikan Pemilik')`,
    `INSERT IGNORE INTO settings (k, v) VALUES ('company_address',''),('company_phone','')`,
  ]],
  // v3.0 — rekonsiliasi bank + jurnal memorial.
  ['003_rekonsiliasi_jurnal', [
    `CREATE TABLE IF NOT EXISTS bank_lines (
      id INT AUTO_INCREMENT PRIMARY KEY,
      account_id INT NOT NULL,
      date DATE NOT NULL,
      description VARCHAR(500) NOT NULL DEFAULT '',
      amount DECIMAL(15,2) NOT NULL,
      balance DECIMAL(15,2) NULL,
      line_key CHAR(64) NOT NULL,
      batch VARCHAR(60) NULL,
      status ENUM('unmatched','matched','ignored') NOT NULL DEFAULT 'unmatched',
      match_src ENUM('payment','cash') NULL,
      match_id INT NULL,
      note VARCHAR(255) NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bank_line (account_id, line_key),
      KEY ix_bank_date (account_id, date),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    )`,
    `CREATE TABLE IF NOT EXISTS journal_entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      date DATE NOT NULL,
      memo VARCHAR(255) NOT NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY ix_je_date (date)
    )`,
    `CREATE TABLE IF NOT EXISTS journal_lines (
      id INT AUTO_INCREMENT PRIMARY KEY,
      entry_id INT NOT NULL,
      coa VARCHAR(20) NOT NULL,
      debit DECIMAL(15,2) NOT NULL DEFAULT 0,
      credit DECIMAL(15,2) NOT NULL DEFAULT 0,
      note VARCHAR(255) NULL,
      FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE
    )`,
  ]],
];

// ALTER TABLE ADD COLUMN yang aman diulang (MySQL 8 tidak punya ADD COLUMN IF NOT EXISTS).
function addColumn(table, column, def) {
  return async (conn) => {
    const [[{ n }]] = await conn.query(
      'SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?', [table, column]);
    if (!n) await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${def}`);
  };
}

// DDL MySQL tidak bisa di-rollback, jadi migrasi yang terputus meninggalkan sebagian tabel.
// Karena itu setiap pernyataan wajib aman diulang (IF NOT EXISTS / INSERT IGNORE): start berikutnya
// melanjutkan sisanya. GET_LOCK mencegah dua proses yang start bersamaan bermigrasi berbarengan.
async function migrate(pool) {
  const conn = await pool.getConnection();
  try {
    const [[{ ok }]] = await conn.query("SELECT GET_LOCK('telur_erp_migrate', 30) AS ok");
    if (ok !== 1) throw new Error('Migrasi database sedang dijalankan proses lain, coba lagi sebentar');
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id VARCHAR(60) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const [done] = await conn.query('SELECT id FROM schema_migrations');
    const applied = new Set(done.map((r) => r.id));
    for (const [id, stmts] of MIGRATIONS) {
      if (applied.has(id)) continue;
      for (const s of stmts) await (typeof s === 'function' ? s(conn) : conn.query(s));
      await conn.query('INSERT INTO schema_migrations (id) VALUES (?)', [id]);
    }
  } finally {
    await conn.query("SELECT RELEASE_LOCK('telur_erp_migrate')").catch(() => {});
    conn.release();
  }
}

module.exports = { createPool, migrate, connConfig };
