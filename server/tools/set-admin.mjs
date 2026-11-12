// Nastaví účet ovládacího panelu (uloží jen hash hesla do config.json).
// Použití: node tools/set-admin.mjs <jméno>   – heslo se zeptá (nebo z proměnné ADMIN_PASSWORD)
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { hashPassword } from '../admin.js';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config.json');
const username = process.argv[2];
if (!username || !/^[\w.@-]{3,40}$/.test(username)) {
    console.error('Použití: node tools/set-admin.mjs <jméno>');
    process.exit(1);
}
let password = process.env.ADMIN_PASSWORD;
if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question('Heslo: ');
    rl.close();
}
if (!password || password.length < 8) {
    console.error('Heslo musí mít aspoň 8 znaků.');
    process.exit(1);
}
const config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
config.admin = { username, ...hashPassword(password) };
writeFileSync(file, JSON.stringify(config, null, 2));
try { chmodSync(file, 0o600); } catch { /* Windows */ }
console.log(`Účet „${username}“ uložen do config.json. Restartuj server (pm2 restart movie-backend).`);
