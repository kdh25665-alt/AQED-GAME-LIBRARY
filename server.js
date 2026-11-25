const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data', 'games.json');
const PORT = Number(process.env.PORT || 3000);
// Set this in Render > Environment. There is deliberately no public default password.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function readGames() {
  const parsed = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}
function writeGames(games) {
  fs.writeFileSync(DATA, JSON.stringify(games, null, 2));
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function authorized(req) {
  return Boolean(ADMIN_TOKEN) && safeEqual(req.headers['x-admin-token'] || '', ADMIN_TOKEN);
}
function body(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => {
      s += c;
      if (s.length > 1000000) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(s || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Public read-only endpoint: customers can view the library but cannot change it.
  if (url.pathname === '/api/games' && req.method === 'GET') {
    try { return send(res, 200, readGames()); }
    catch { return send(res, 500, { error: 'تعذر قراءة المكتبة' }); }
  }

  // Verify the password before showing the admin controls.
  if (url.pathname === '/api/admin/verify' && req.method === 'POST') {
    if (!ADMIN_TOKEN) return send(res, 503, { error: 'لم يتم إعداد كلمة مرور الإدارة في Render بعد' });
    try {
      const input = await body(req);
      return safeEqual(input.token || '', ADMIN_TOKEN)
        ? send(res, 200, { ok: true })
        : send(res, 401, { error: 'كلمة المرور غير صحيحة' });
    } catch { return send(res, 400, { error: 'طلب غير صالح' }); }
  }

  if (url.pathname === '/api/games' && req.method === 'POST') {
    if (!authorized(req)) return send(res, ADMIN_TOKEN ? 401 : 503, { error: ADMIN_TOKEN ? 'غير مصرح' : 'إعداد كلمة مرور الإدارة مطلوب' });
    try {
      const g = await body(req);
      if (!g.title || !g.genre) return send(res, 400, { error: 'اسم اللعبة والتصنيف مطلوبان' });
      if (g.downloadUrl && !/^https:\/\//i.test(g.downloadUrl)) return send(res, 400, { error: 'رابط التحميل يجب أن يبدأ بـ https://' });
      const games = readGames();
      const item = {
        id: crypto.randomUUID(),
        title: String(g.title).slice(0, 100),
        genre: String(g.genre).slice(0, 40),
        version: String(g.version || '—').slice(0, 30),
        size: String(g.size || '—').slice(0, 30),
        description: String(g.description || '').slice(0, 1000),
        cover: String(g.cover || '').slice(0, 1000),
        downloadUrl: String(g.downloadUrl || '').slice(0, 2000),
        updatedAt: new Date().toISOString().slice(0, 10)
      };
      games.unshift(item);
      writeGames(games);
      return send(res, 201, item);
    } catch { return send(res, 400, { error: 'تعذر قراءة البيانات' }); }
  }

  if (url.pathname.startsWith('/api/games/') && req.method === 'DELETE') {
    if (!authorized(req)) return send(res, ADMIN_TOKEN ? 401 : 503, { error: ADMIN_TOKEN ? 'غير مصرح' : 'إعداد كلمة مرور الإدارة مطلوب' });
    try {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      const games = readGames();
      const next = games.filter(g => g.id !== id);
      if (next.length === games.length) return send(res, 404, { error: 'اللعبة غير موجودة' });
      writeGames(next);
      return send(res, 200, { ok: true });
    } catch { return send(res, 500, { error: 'تعذر تحديث المكتبة' }); }
  }

  let pathname;
  try { pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); }
  catch { return send(res, 400, { error: 'Bad request' }); }
  const file = path.resolve(PUBLIC, '.' + pathname);
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AQED Library running on port ${PORT}`);
  if (!ADMIN_TOKEN) console.warn('WARNING: ADMIN_TOKEN is not set. Admin changes are disabled until configured.');
});
