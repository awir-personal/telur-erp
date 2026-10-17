// PIN di-hash (scrypt) — tidak ada yang bisa melihat PIN, termasuk master. Master hanya bisa RESET.
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const PIN_RE = /^\d{6}$/;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const SESSION_HOURS = 12;

async function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pin), salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPin(pin, stored) {
  const [, saltHex, keyHex] = String(stored).split('$');
  if (!saltHex || !keyHex) return false;
  const key = await scrypt(String(pin), Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

const randomPin = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// PIN lemah yang ditolak: semua digit sama, atau urut naik/turun.
function weakPin(pin) {
  if (/^(\d)\1{5}$/.test(pin)) return true;
  const d = pin.split('').map(Number);
  const step = d[1] - d[0];
  return Math.abs(step) === 1 && d.every((x, i) => i === 0 || x - d[i - 1] === step);
}

async function createSession(pool, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('DELETE FROM sessions WHERE expires_at < UTC_TIMESTAMP()');
  await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL ? HOUR)',
    [sha256(token), userId, SESSION_HOURS]);
  return token;
}

// Middleware: req.user dari header "Authorization: Bearer <token>". Status user dicek ulang tiap request,
// jadi menonaktifkan user / reset PIN langsung berlaku.
function authenticate(pool) {
  return async (req, res, next) => {
    const m = /^Bearer ([a-f0-9]{64})$/.exec(req.get('authorization') || '');
    if (!m) return res.status(401).json({ error: 'Silakan login' });
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.role, u.must_change_pin FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() AND u.active = 1`, [sha256(m[1])]);
    if (!rows.length) return res.status(401).json({ error: 'Sesi berakhir, silakan login lagi' });
    req.user = rows[0];
    req.tokenHash = sha256(m[1]);
    // Selama PIN sementara belum diganti, hanya boleh ganti PIN / logout / cek diri.
    const allowed = ['/auth/me', '/auth/change-pin', '/auth/logout'];
    if (req.user.must_change_pin && !allowed.includes(req.path)) return res.status(403).json({ error: 'Ganti PIN dulu', mustChangePin: true });
    next();
  };
}

// Hak akses per peran. master = semua.
const PERMS = {
  admin: ['invoice', 'master', 'import', 'note', 'view'],
  finance: ['payment', 'adjust', 'note', 'view'],
};
const can = (user, perm) => user.role === 'master' || (PERMS[user.role] || []).includes(perm);
const requirePerm = (perm) => (req, res, next) =>
  can(req.user, perm) ? next() : res.status(403).json({ error: 'Anda tidak punya akses untuk aksi ini' });

module.exports = { PIN_RE, MAX_FAILS, LOCK_MINUTES, hashPin, verifyPin, randomPin, weakPin, sha256, createSession, authenticate, can, requirePerm, PERMS };
