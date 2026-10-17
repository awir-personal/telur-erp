// Jalankan API (port 3200, restart otomatis) + Vite (port 5180) bersamaan.
// Opsional: --db=nama_db untuk memakai database lain (mis. uji UI tanpa menyentuh data asli).
const { spawn } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
const dbArg = process.argv.find((a) => a.startsWith('--db='));
const env = { ...process.env, ...(dbArg ? { DB_NAME: dbArg.slice(5) } : {}) };
const run = (cmd, args, extra = {}) => spawn(cmd, args, { cwd: root, stdio: 'inherit', env: { ...env, ...extra }, shell: process.platform === 'win32' });
// API selalu di 3200 (proxy Vite mengarah ke sana), walau ada PORT lain di environment.
const procs = [run('node', ['--watch-path=server', 'server/index.js'], { PORT: '3200' }), run('npx', ['vite'])];
const stop = () => { procs.forEach((p) => p.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
