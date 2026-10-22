import http from 'node:http';
import {readFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {validateCatalog} from './public/core.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const files = new Map(['index.html','style.css','app.mjs','core.mjs','demo.json','icon.svg'].map(f => ['/'+(f === 'index.html' ? '' : f), f]));
try {
  const images = await readdir(path.join(root,'public','img'));
  for (const f of images.filter(f => f.endsWith('.jpg'))) files.set(`/img/${f}`, `img/${f}`);
} catch {}
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg'};

// 官方菜单图仅允许这一个 HTTPS 前缀；经本机同源代理转发，浏览器不直连外部域（CSP img-src 保持 'self'）。
const FOODIMG_HOST = 'https://menu-img.mcd.cn/';
const FOODIMG_LIMIT = 120;
const foodImgCache = new Map();
function foodImgTarget(raw) {
  let target;
  try {target = decodeURIComponent(raw || '');} catch {return null;}
  if (!target.startsWith(FOODIMG_HOST) || target.includes('..') || target.length > 400) return null;
  return target;
}

export function createServer({fetcher = fetch} = {}) {
  return http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control','no-store');
    const expected = new Set(['127.0.0.1','localhost','[::1]']);
    let url;
    try { url = new URL(req.url, 'http://'+req.headers.host); } catch {res.writeHead(400).end();return;}
    if (!expected.has(url.hostname) || (req.headers.origin && req.headers.origin !== url.origin)) {res.writeHead(403).end('Local access only');return;}
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405).end();return;}
    try {
      let body, type;
      if (url.pathname === '/api/catalog') {
        try {body = JSON.stringify(validateCatalog(JSON.parse(await readFile(path.join(root,'data/catalog.json'),'utf8'))));}
        catch (error) { if (error.code !== 'ENOENT') {res.writeHead(422,{'Content-Type':'application/json'}).end(JSON.stringify({error:'本地 MCP 清单格式无效，请重新同步。'}));return;} body = await readFile(path.join(root,'public/demo.json')); }
        type = types['.json'];
      } else if (url.pathname === '/api/nutrition') {
        try {body = await readFile(path.join(root,'data/nutrition.json'));}
        catch (error) { if (error.code !== 'ENOENT') {res.writeHead(422,{'Content-Type':'application/json'}).end(JSON.stringify({error:'本地营养数据格式无效，请重新同步。'}));return;} res.writeHead(404,{'Content-Type':'application/json'}).end(JSON.stringify({error:'尚未同步营养数据：先在本机执行 node scripts/mcp.mjs sync。'}));return; }
        type = types['.json'];
      } else if (url.pathname === '/foodimg') {
        const target = foodImgTarget(url.searchParams.get('u'));
        if (!target) {res.writeHead(404).end();return;}
        const cached = foodImgCache.get(target);
        if (cached) {res.writeHead(200,{'Content-Type':cached.type}); res.end(req.method === 'HEAD' ? undefined : cached.body);return;}
        let upstream;
        try {upstream = await fetcher(target,{signal:AbortSignal.timeout(10_000)});if(!upstream.ok)throw 0;}
        catch {res.writeHead(404).end();return;}
        const payload = Buffer.from(await upstream.arrayBuffer());
        const contentType = /^image\/(png|jpeg|webp|gif)/.test(upstream.headers.get('content-type') || '') ? upstream.headers.get('content-type') : 'image/png';
        if (foodImgCache.size >= FOODIMG_LIMIT) foodImgCache.delete(foodImgCache.keys().next().value);
        foodImgCache.set(target,{body:payload,type:contentType});
        res.writeHead(200,{'Content-Type':contentType}); res.end(req.method === 'HEAD' ? undefined : payload);return;
      } else {
        const file = files.get(url.pathname);
        if (!file) {res.writeHead(404).end('Not found');return;}
        body = await readFile(path.join(root,'public',file)); type = types[path.extname(file)];
      }
      res.writeHead(200,{'Content-Type':type}); res.end(req.method === 'HEAD' ? undefined : body);
    } catch {res.writeHead(500).end('Unable to load file');}
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3024);
  createServer().listen(port,'127.0.0.1',() => console.log(`McTaste: http://127.0.0.1:${port}`));
}
