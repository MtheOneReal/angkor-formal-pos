// Starts the web server and the daily backup.
import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR } from './db.js';
import { buildApp } from './app.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

// Daily backup with SQLite's VACUUM INTO (a consistent copy even while the app is running). Keeps 30 days.
function backup() {
  const dir = path.join(DATA_DIR, 'backups');
  const day = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const file = path.join(dir, `angkor-${day}.db`);
  try {
    if (!fs.existsSync(file)) {
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      console.log('Backup saved:', file);
    }
    const old = fs.readdirSync(dir).filter((f) => f.startsWith('angkor-') && f.endsWith('.db')).sort().slice(0, -30);
    for (const f of old) fs.unlinkSync(path.join(dir, f));
  } catch (e) {
    console.error('Backup failed:', e.message);
  }
}
backup();
setInterval(backup, 6 * 3600 * 1000).unref();

// Remove expired sessions now and then.
setInterval(() => {
  try { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); } catch { /* ignore */ }
}, 3600 * 1000).unref();

const app = buildApp();
app.listen(PORT, HOST, () => {
  console.log(`Angkor Formal system running on http://localhost:${PORT}`);
});
