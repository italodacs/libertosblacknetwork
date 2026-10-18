// Servidor de desenvolvimento: somente loopback, sem encaminhar formulários.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };
function createServer(root = ROOT) {
  root = path.resolve(root);
  return http.createServer((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400); return res.end(); }
    const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
    for (const rule of config.headers || []) {
      if (rule.source === '/(.*)' || rule.source === pathname) {
        for (const header of rule.headers) res.setHeader(header.key, header.value);
      }
    }
    const redirect = config.redirects.find(rule => rule.source === pathname);
    if (redirect) { res.writeHead(redirect.permanent ? 308 : 307, { Location: redirect.destination }); return res.end(); }
    pathname = config.rewrites.find(rule => rule.source === pathname)?.destination || pathname;
    const file = path.resolve(root, '.' + pathname);
    const relative = path.relative(root, file);
    if (!file.startsWith(root + path.sep) || relative.split(/[\\/]/).some(part => part.startsWith('.')) || !TYPES[path.extname(file)]) {
      res.writeHead(404); return res.end('Not found');
    }
    fs.readFile(file, (error, content) => {
      res.writeHead(error ? 404 : 200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : error ? 'Not found' : content);
    });
  });
}
module.exports = { createServer };
if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  createServer().listen(port, '127.0.0.1', () => console.log('Site local: http://127.0.0.1:' + port));
}
