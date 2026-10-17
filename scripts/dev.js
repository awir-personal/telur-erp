// Jalankan API (port 3200, restart otomatis) + Vite (port 5180) bersamaan.
// Opsional: --db=nama_db untuk memakai database lain (mis. uji UI tanpa menyentuh data asli).
const { spawn, execSync } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
const win = process.platform === 'win32';
const dbArg = process.argv.find((a) => a.startsWith('--db='));
const env = { ...process.env, ...(dbArg ? { DB_NAME: dbArg.slice(5) } : {}) };
const run = (cmd, args, extra = {}) => spawn(cmd, args, { cwd: root, stdio: 'inherit', env: { ...env, ...extra }, shell: win });

// API selalu di 3200 (proxy Vite mengarah ke sana), walau ada PORT lain di environment.
const procs = [run('node', ['--watch-path=server', 'server/index.js'], { PORT: '3200' }), run('npx', ['vite'])];

// Di Windows, kill() hanya mematikan cmd.exe; Vite/Node di bawahnya tetap hidup memegang port.
// Matikan seluruh pohon proses supaya tidak ada sisa yang membuat error 500 di sesi berikutnya.
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) {
    if (p.exitCode !== null) continue;
    try { win ? execSync(`taskkill /PID ${p.pid} /T /F`, { stdio: 'ignore' }) : p.kill(); } catch { /* sudah mati */ }
  }
  process.exit(code);
}
// Kalau salah satu mati (mis. MySQL tidak bisa dihubungi), matikan semuanya, jangan biarkan Vite jalan sendiri.
procs.forEach((p) => p.on('exit', (code) => { if (!stopping) { console.error(`\nProses berhenti (kode ${code}). Menghentikan semua.`); stop(code || 1); } }));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
process.on('exit', () => stop(0));
