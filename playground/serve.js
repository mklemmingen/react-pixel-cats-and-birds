// Tiny static server for the playground: `npm run playground`, then open http://localhost:5178/playground/
import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {extname, join, normalize, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT) || 5178;
const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
};

createServer(async (req, res) => {
    try {
        let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (path === '/') path = '/playground/';
        let file = normalize(join(root, path));
        if (!file.startsWith(root)) throw new Error('outside root');
        if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
        const body = await readFile(file);
        res.writeHead(200, {'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store'});
        res.end(body);
    } catch {
        res.writeHead(404).end('not found');
    }
}).listen(port, '127.0.0.1', () => console.log(`playground: http://localhost:${port}/playground/`));
