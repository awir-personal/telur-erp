// v4.0 Multi-perusahaan (APG = 1, GTA = 2). Perusahaan aktif per request dari header "X-Company" (id).
// Tanpa header = perusahaan 1 (APG): klien/skrip lama tetap bekerja seperti sebelum v4.0.
// Semua user boleh mengakses semua perusahaan (keputusan user 2026-10-29).
const express = require('express');
const { skey } = require('./lib');

function companyScope(pool) {
  return async (req, res, next) => {
    const raw = req.get('x-company');
    const id = raw == null || raw === '' ? 1 : Number(raw);
    const [[c]] = Number.isInteger(id) && id > 0 ? await pool.query('SELECT id, code, name FROM companies WHERE id = ?', [id]) : [[]];
    if (!c) return res.status(400).json({ error: 'Perusahaan tidak dikenal' });
    req.company = c;
    req.cid = c.id;
    req.user.company_id = c.id; // dipakai lib.log
    next();
  };
}

// Nama tampil = pengaturan company_name perusahaan itu (kalau diisi), selain itu nama bawaan.
async function listCompanies(db) {
  const [cs] = await db.query('SELECT id, code, name FROM companies ORDER BY sort_order, id');
  const [names] = await db.query("SELECT k, v FROM settings WHERE k = 'company_name' OR k LIKE 'c%.company_name'");
  const byKey = new Map(names.map((n) => [n.k, n.v]));
  return cs.map((c) => ({ ...c, display_name: byKey.get(skey(c.id, 'company_name')) || c.name }));
}

function companyRoutes(pool) {
  const r = express.Router();
  r.get('/companies', async (req, res) => res.json({ current: req.cid, companies: await listCompanies(pool) }));
  return r;
}

module.exports = { companyScope, companyRoutes, listCompanies };
