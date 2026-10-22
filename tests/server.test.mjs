import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';

test('本地服务提供演示清单，阻止跨源访问、写请求和路径探测',async()=>{
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const home=await fetch(base);assert.equal(home.status,200);assert.match(await home.text(),/麦麦盲评局/);assert.ok(home.headers.get('Content-Security-Policy').includes("connect-src 'self'"));
    const catalog=await (await fetch(base+'/api/catalog')).json();assert.ok(catalog.items.length>=3);
    assert.equal((await fetch(base+'/api/catalog',{headers:{Origin:'https://example.org'}})).status,403);
    assert.equal((await fetch(base+'/api/catalog',{method:'POST'})).status,405);
    assert.equal((await fetch(base+'/.env')).status,404);assert.equal((await fetch(base+'/docs/sources/mcp-readme.md')).status,404);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('foodimg 代理：仅放行官方图域，其他一律 404；命中走缓存',async()=>{
  const pixel=Buffer.from('89504e47','hex');
  let upstreamHits=0;
  const fetcher=async(url)=>{
    if(!String(url).startsWith('https://menu-img.mcd.cn/'))throw new Error('upstream rejected');
    upstreamHits++;return {ok:true,headers:new Map([['content-type','image/png']]),arrayBuffer:async()=>pixel.buffer.slice(pixel.byteOffset,pixel.byteOffset+pixel.byteLength)};
  };
  const server=createServer({fetcher:fetcher});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const good=encodeURIComponent('https://menu-img.mcd.cn/pcm/prod/menu/ProductPool/product/MS_1_320.png');
    const first=await fetch(base+'/foodimg?u='+good);
    assert.equal(first.status,200);assert.equal(first.headers.get('Content-Type'),'image/png');
    const second=await fetch(base+'/foodimg?u='+good);
    assert.equal(second.status,200);assert.equal(upstreamHits,1); // 第二次命中缓存
    for(const bad of ['https://evil.example.com/x.png','http://menu-img.mcd.cn/x.png','https://menu-img.mcd.cn.evil.com/x.png','../../server.mjs',''])
      assert.equal((await fetch(base+'/foodimg?u='+encodeURIComponent(bad))).status,404,bad);
  } finally {await new Promise(r=>server.close(r));}
});

test('api/nutrition：数据存在返回行，缺失返回 404 与指引文案',async()=>{
  const {writeFile,mkdir,rm,readFile}=await import('node:fs/promises');
  const {fileURLToPath}=await import('node:url');const path=await import('node:path');
  const root=path.dirname(fileURLToPath(import.meta.url))+'/..';
  const file=path.join(root,'data/nutrition.json');
  await mkdir(path.join(root,'data'),{recursive:true});
  let backup=null;try{backup=await readFile(file);}catch{} // 测试先备份真实同步数据，结束后还原
  await rm(file,{force:true});
  const server=createServer({fetcher:async()=>{throw 0;}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const missing=await fetch(base+'/api/nutrition');
    assert.equal(missing.status,404);assert.match((await missing.json()).error,/sync/);
    await writeFile(path.join(root,'data/nutrition.json'),JSON.stringify({source:'mcp',tool:'list-nutrition-foods',capturedAt:'test',rows:[{name:'巨无霸',energyKcal:513}]}));
    const ok=await fetch(base+'/api/nutrition');
    assert.equal(ok.status,200);assert.equal((await ok.json()).rows.length,1);
  } finally {if(backup)await writeFile(file,backup);else await rm(file,{force:true});await new Promise(r=>server.close(r));}
});
