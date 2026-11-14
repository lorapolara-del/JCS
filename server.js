// Masculine/Feminine survey: zero-dependency Node.js server (Node 18+)
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000;
const RESET_KEY = process.env.RESET_KEY || '';
const DATA = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUB = path.join(__dirname, 'public');

let rooms = {};
try { rooms = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) {}
let dirty = false;
setInterval(() => { if (dirty) { dirty = false; fs.writeFile(DATA, JSON.stringify(rooms), () => {}); } }, 2000);

const clients = {};
const okRoom = r => typeof r === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(r);
const okId = i => typeof i === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(i);
const okNum = n => typeof n === 'number' && n >= 1 && n <= 5;
const list = room => Object.values(rooms[room] || {}).sort((x, y) => x.ts - y.ts);
function broadcast(room) {
  const msg = 'data: ' + JSON.stringify(list(room)) + '\n\n';
  (clients[room] || new Set()).forEach(res => res.write(msg));
}
setInterval(() => Object.values(clients).forEach(s => s.forEach(res => res.write(': ping\n\n'))), 25000);

function body(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 2000) { reject(); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { reject(); } });
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const MIME = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css', '.js': 'text/javascript' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (req.method === 'POST' && u.pathname === '/api/submit') {
      const b = await body(req);
      if (!okRoom(b.room) || !okId(b.id) || !okNum(b.a) || !okNum(b.b)) return json(res, 400, { error: 'bad input' });
      if (!rooms[b.room]) { if (Object.keys(rooms).length >= 500) return json(res, 429, { error: 'too many rooms' }); rooms[b.room] = {}; }
      if (!rooms[b.room][b.id] && Object.keys(rooms[b.room]).length >= 3000) return json(res, 429, { error: 'room full' });
      rooms[b.room][b.id] = { a: Math.round(b.a * 100) / 100, b: Math.round(b.b * 100) / 100, ts: Date.now() };
      dirty = true; broadcast(b.room);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && u.pathname === '/api/reset') {
      const b = await body(req);
      if (!okRoom(b.room)) return json(res, 400, { error: 'bad input' });
      if (RESET_KEY && b.key !== RESET_KEY) return json(res, 403, { error: 'forbidden' });
      delete rooms[b.room]; dirty = true; broadcast(b.room);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && u.pathname === '/api/stream') {
      const room = u.searchParams.get('room');
      if (!okRoom(room)) return json(res, 400, { error: 'bad input' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('data: ' + JSON.stringify(list(room)) + '\n\n');
      (clients[room] = clients[room] || new Set()).add(res);
      req.on('close', () => clients[room].delete(res));
      return;
    }
    if (req.method === 'GET') {
      let p = u.pathname === '/' ? '/survey.html' : u.pathname === '/results' ? '/results.html' : u.pathname;
      const f = path.normalize(path.join(PUB, p));
      if (!f.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
      return fs.readFile(f, (err, buf) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
        res.end(buf);
      });
    }
    res.writeHead(405); res.end();
  } catch (e) { if (!res.headersSent) json(res, 400, { error: 'bad request' }); }
}).listen(PORT, () => console.log('Listening on ' + PORT));
