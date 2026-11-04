// Minimal static file server for local QA. Binds 127.0.0.1 on an ephemeral port by default.
// CLI: node scripts/serve.mjs [DIR] [--port N]   (DIR defaults to $DIST or dist)
// API: const s = await startServer(dir); s.url ('http://127.0.0.1:<port>/'); await s.close();
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function startServer(dir, { port = 0, host = '127.0.0.1' } = {}) {
  const root = path.resolve(dir);
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    return Promise.reject(new Error(`no index.html in ${dir}`));
  }
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }
    const file = path.join(root, pathname);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    let target = file;
    let st = fs.statSync(target, { throwIfNoEntry: false });
    if (st?.isDirectory()) {
      if (!pathname.endsWith('/')) {
        const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        res.writeHead(301, { Location: pathname + '/' + q }).end();
        return;
      }
      target = path.join(target, 'index.html');
      st = fs.statSync(target, { throwIfNoEntry: false });
    }
    if (!st?.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(target).pipe(res);
  });
  const sockets = new Set();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const { port: p } = server.address();
      resolve({
        url: `http://${host}:${p}/`,
        port: p,
        close: () =>
          new Promise((r) => {
            for (const s of sockets) s.destroy();
            server.close(() => r());
          }),
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const pi = args.indexOf('--port');
  const port = pi >= 0 ? Number(args.splice(pi, 2)[1]) : 0;
  const dir = args[0] || process.env.DIST || 'dist';
  const s = await startServer(dir, { port });
  console.log(`serving ${dir} at ${s.url} (Ctrl-C to stop)`);
  const stop = async () => {
    await s.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
