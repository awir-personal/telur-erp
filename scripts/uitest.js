// Server uji untuk sesi Claude: port 3299 + DB telur_erp_uitest_zz, supaya TIDAK bentrok dengan
// app asli user (port 3200, telur_erp_db) yang mungkin sedang dibuka bersamaan. Build dulu: npx vite build --outDir dist-uitest
process.env.PORT = '3299';
process.env.DB_NAME = 'telur_erp_uitest_zz';
process.env.DIST_DIR = require('path').join(__dirname, '..', 'dist-uitest');
require('../server/index.js');
