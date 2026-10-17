const express = require('express');
const A = require('../auth');
const { bad, log, reqStr } = require('../lib');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const ROLES = ['master', 'admin', 'finance'];

function checkNewPin(pin) {
  if (!A.PIN_RE.test(String(pin || ''))) throw bad('PIN harus 6 angka');
  if (A.weakPin(pin)) throw bad('PIN terlalu mudah ditebak (angka sama semua / berurutan)');
}

// Rute publik (sebelum login).
function publicRoutes(pool, { setupCode, loginDelayMs = 400 }) {
  const r = express.Router();

  r.get('/version', (req, res) => res.json({ version: require('../../package.json').version }));

  r.get('/auth/status', async (req, res) => {
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM users');
    res.json({ needsSetup: n === 0, setupCodeRequired: Boolean(setupCode) });
  });

  // Hanya bisa dipakai sekali: saat tabel users masih kosong.
  r.post('/auth/setup', async (req, res) => {
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM users');
    if (n > 0) throw bad('Setup sudah pernah dilakukan');
    if (setupCode && req.body.setupCode !== setupCode) { await delay(loginDelayMs); throw bad('Kode setup salah'); }
    const name = reqStr(req.body.name, 'Nama', 60);
    checkNewPin(req.body.pin);
    const [ins] = await pool.query('INSERT INTO users (name, role, pin_hash, must_change_pin) VALUES (?, "master", ?, 0)', [name, await A.hashPin(req.body.pin)]);
    await log(pool, { id: ins.insertId, name }, 'setup', 'user', ins.insertId, null);
    res.json({ ok: true });
  });

  r.post('/auth/login', async (req, res) => {
    await delay(loginDelayMs); // memperlambat tebak-tebakan PIN
    const name = String(req.body.name || '').trim();
    const [[u]] = await pool.query('SELECT * FROM users WHERE name = ? AND active = 1', [name]);
    const fail = { error: 'Nama atau PIN salah' };
    if (!u) return res.status(401).json(fail);
    const [[{ locked }]] = await pool.query('SELECT (locked_until IS NOT NULL AND locked_until > UTC_TIMESTAMP()) AS locked FROM users WHERE id = ?', [u.id]);
    if (locked) return res.status(429).json({ error: `Terlalu banyak salah PIN. Coba lagi dalam ${A.LOCK_MINUTES} menit atau minta master reset PIN.` });
    if (!(await A.verifyPin(req.body.pin, u.pin_hash))) {
      const fails = u.failed_attempts + 1;
      if (fails >= A.MAX_FAILS) {
        await pool.query('UPDATE users SET failed_attempts = 0, locked_until = UTC_TIMESTAMP() + INTERVAL ? MINUTE WHERE id = ?', [A.LOCK_MINUTES, u.id]);
        await log(pool, u, 'locked', 'user', u.id, null);
      } else {
        await pool.query('UPDATE users SET failed_attempts = ? WHERE id = ?', [fails, u.id]);
      }
      return res.status(401).json(fail);
    }
    await pool.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [u.id]);
    const token = await A.createSession(pool, u.id);
    await log(pool, u, 'login', 'user', u.id, null);
    res.json({ token, user: { id: u.id, name: u.name, role: u.role, must_change_pin: u.must_change_pin } });
  });

  return r;
}

// Rute setelah login.
function privateRoutes(pool) {
  const r = express.Router();

  r.get('/auth/me', (req, res) => res.json({ user: req.user, perms: Object.fromEntries(['invoice', 'master', 'import', 'payment', 'adjust', 'note', 'view', 'cash'].map((p) => [p, A.can(req.user, p)])) }));

  r.post('/auth/logout', async (req, res) => {
    await pool.query('DELETE FROM sessions WHERE token_hash = ?', [req.tokenHash]);
    res.json({ ok: true });
  });

  r.post('/auth/change-pin', async (req, res) => {
    const [[u]] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!(await A.verifyPin(req.body.oldPin, u.pin_hash))) { await delay(400); throw bad('PIN lama salah'); }
    checkNewPin(req.body.newPin);
    if (req.body.newPin === req.body.oldPin) throw bad('PIN baru harus berbeda dari PIN lama');
    await pool.query('UPDATE users SET pin_hash = ?, must_change_pin = 0 WHERE id = ?', [await A.hashPin(req.body.newPin), u.id]);
    // Sesi lain milik user ini diputus; sesi sekarang tetap jalan.
    await pool.query('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [u.id, req.tokenHash]);
    await log(pool, req.user, 'change_pin', 'user', u.id, null);
    res.json({ ok: true });
  });

  // ===== Master user (hanya peran master) =====
  const onlyMaster = (req, res, next) => (req.user.role === 'master' ? next() : res.status(403).json({ error: 'Hanya master user' }));

  r.get('/users', onlyMaster, async (req, res) => {
    const [rows] = await pool.query(`SELECT id, name, role, active, must_change_pin, created_at,
      (locked_until IS NOT NULL AND locked_until > UTC_TIMESTAMP()) AS locked FROM users ORDER BY active DESC, name`);
    res.json(rows);
  });

  r.post('/users', onlyMaster, async (req, res) => {
    const name = reqStr(req.body.name, 'Nama', 60);
    if (!ROLES.includes(req.body.role)) throw bad('Peran tidak valid');
    const pin = A.randomPin();
    try {
      const [ins] = await pool.query('INSERT INTO users (name, role, pin_hash, must_change_pin) VALUES (?,?,?,1)', [name, req.body.role, await A.hashPin(pin)]);
      await log(pool, req.user, 'create', 'user', ins.insertId, { name, role: req.body.role });
      res.json({ id: ins.insertId, tempPin: pin });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw bad('Nama user sudah dipakai');
      throw e;
    }
  });

  async function assertKeepsAMaster(userId, nextRole, nextActive) {
    if (nextRole === 'master' && nextActive) return;
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM users WHERE role = "master" AND active = 1 AND id <> ?', [userId]);
    if (n === 0) throw bad('Harus selalu ada minimal 1 master user aktif');
  }

  r.put('/users/:id', onlyMaster, async (req, res) => {
    const id = Number(req.params.id);
    const [[u]] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    if (!u) throw bad('User tidak ditemukan');
    const name = reqStr(req.body.name ?? u.name, 'Nama', 60);
    const role = req.body.role ?? u.role;
    const active = req.body.active == null ? u.active : (req.body.active ? 1 : 0);
    if (!ROLES.includes(role)) throw bad('Peran tidak valid');
    await assertKeepsAMaster(id, role, active);
    try {
      await pool.query('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?', [name, role, active, id]);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw bad('Nama user sudah dipakai');
      throw e;
    }
    if (!active) await pool.query('DELETE FROM sessions WHERE user_id = ?', [id]);
    await log(pool, req.user, 'update', 'user', id, { from: { name: u.name, role: u.role, active: u.active }, to: { name, role, active } });
    res.json({ ok: true });
  });

  // PIN sementara ditampilkan SEKALI ke master; user wajib ganti saat login berikutnya.
  r.post('/users/:id/reset-pin', onlyMaster, async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw bad('Untuk PIN sendiri gunakan menu Ganti PIN');
    const [[u]] = await pool.query('SELECT id FROM users WHERE id = ?', [id]);
    if (!u) throw bad('User tidak ditemukan');
    const pin = A.randomPin();
    await pool.query('UPDATE users SET pin_hash = ?, must_change_pin = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?', [await A.hashPin(pin), id]);
    await pool.query('DELETE FROM sessions WHERE user_id = ?', [id]);
    await log(pool, req.user, 'reset_pin', 'user', id, null);
    res.json({ tempPin: pin });
  });

  return r;
}

module.exports = { publicRoutes, privateRoutes, checkNewPin };
