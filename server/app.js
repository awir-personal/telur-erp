const path = require('path');
const fs = require('fs');
const express = require('express');
const { authenticate } = require('./auth');
const { publicRoutes, privateRoutes } = require('./routes/auth');

function createApp(pool, opts = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10mb' }));

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use('/api', publicRoutes(pool, { setupCode: opts.setupCode, loginDelayMs: opts.loginDelayMs ?? 400 }));
  app.use('/api', authenticate(pool));
  app.use('/api', privateRoutes(pool));
  app.use('/api', require('./routes/master')(pool));
  app.use('/api', require('./routes/invoices')(pool));
  app.use('/api', require('./routes/payments')(pool));
  app.use('/api', require('./routes/reports')(pool));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ada' }));

  // DIST_DIR: server uji Claude memakai build terpisah (dist-uitest) supaya tidak menimpa app user yang sedang jalan.
  const dist = process.env.DIST_DIR || path.join(__dirname, '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    const dbDown = err.code === 'ECONNREFUSED' || err.name === 'AggregateError' || err.code === 'PROTOCOL_CONNECTION_LOST';
    if (!opts.quiet) console.error(err);
    res.status(dbDown ? 503 : 500).json({ error: dbDown ? 'Database tidak bisa dihubungi. Cek service MySQL.' : 'Terjadi kesalahan di server' });
  });
  return app;
}

module.exports = { createApp };
