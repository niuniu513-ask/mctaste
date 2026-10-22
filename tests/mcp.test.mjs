import test from 'node:test';
import assert from 'node:assert/strict';
import {McpClient,parseRpc,validateArgs,ENDPOINT} from '../src/mcp-client.mjs';
import {normalizeCatalog,normalizeMeals,parseNutrition,extractJson,getPath,toolData} from '../src/catalog.mjs';
import {matchNutrition} from '../public/core.mjs';

test('真实传输契约：初始化、通知、分页工具目录、session header 和 SSE 调用结果',async()=>{
  const calls=[];
  const mock=async(url,options)=>{
    assert.equal(url,ENDPOINT);assert.equal(options.redirect,'error');
    const body=JSON.parse(options.body);calls.push({body,headers:options.headers});
    if(body.method==='notifications/initialized')return new Response(null,{status:202});
    let result;
    if(body.method==='initialize')result={protocolVersion:'2025-03-26'};
    else if(body.method==='tools/list')result=body.params.cursor?{tools:[]}:{tools:[{name:'query-meals',inputSchema:{type:'object',required:['store'],properties:{store:{type:'string'}}}}],nextCursor:'next'};
    else return new Response(`event: message\ndata: ${JSON.stringify({jsonrpc:'2.0',id:body.id,result:{structuredContent:{success:true,foods:[]}}})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
    return Response.json({jsonrpc:'2.0',id:body.id,result},{headers:{'Mcp-Session-Id':'test-session'}});
  };
  const c=new McpClient('synthetic-test-token',mock);await c.initialize();const tools=await c.tools();const result=await c.call('query-meals',{store:'demo'},tools);
  assert.equal(result.structuredContent.success,true);assert.equal(calls.length,5);assert.equal(calls[1].body.id,undefined);assert.equal(calls[1].headers['Mcp-Session-Id'],'test-session');assert.equal(calls[2].headers['MCP-Protocol-Version'],'2025-03-26');
});
test('拒绝写操作和不符合官方 schema 的参数，拒绝没有凭证的连接',async()=>{
  assert.throws(()=>new McpClient(''));
  const c=new McpClient('test',async()=>{throw new Error('不应发请求');});
  await assert.rejects(c.call('create-order',{},[]),/只允许/);
  await assert.rejects(c.call('query-meals',{},[{name:'query-meals',inputSchema:{type:'object',required:['store']}}]),/必填/);
  assert.throws(()=>validateArgs({type:'object',properties:{n:{type:'integer',minimum:1}},required:['n']},{n:0}));
  assert.throws(()=>validateArgs({type:'array',items:{enum:['A','B']}},['C']));
});
test('HTTP 身份、限流、超时、RPC 业务失败不会冒充成功',async()=>{
  for(const status of [401,429,500]){const c=new McpClient('test',async()=>new Response('sensitive upstream content',{status}));await assert.rejects(c.initialize(),error=>!error.message.includes('sensitive'));}
  const c=new McpClient('test',async()=>{throw new Error('test-token');});await assert.rejects(c.initialize(),error=>!error.message.includes('test-token'));
  assert.throws(()=>parseRpc('{"id":9,"result":{}}','application/json',1));
  assert.throws(()=>parseRpc('{"id":1,"error":{"code":-32602,"message":"sensitive"}}','application/json',1),error=>!error.message.includes('sensitive'));
  assert.throws(()=>toolData({isError:false,structuredContent:{data:{success:false}}}));
});
test('JSON 混合文本及显式字段映射；缺字段和重复编号不会静默进入菜单',()=>{
  const foods=[1,2,3].map(n=>({sku:String(n),title:'样本'+n,cat:'餐品'}));
  const raw={content:[{type:'text',text:'字段说明在前。\n'+JSON.stringify({success:true,data:{groups:[{foods}]}})}]};
  const mapping={itemsPath:'data.groups.*.foods.*',id:'sku',name:'title',category:'cat'};
  const result=normalizeCatalog(raw,mapping);assert.equal(result.source,'mcp');assert.equal(result.items.length,3);assert.equal(result.items[0].id,'1');assert.equal(result.items[0].price,undefined);
  assert.deepEqual(extractJson('prefix {"name":"} 中的括号"} suffix'),{name:'} 中的括号'});
  assert.throws(()=>normalizeCatalog(raw,{...mapping,name:'missing'}));
  const duplicate={structuredContent:{data:{groups:[{foods:[foods[0],foods[0],foods[1]]}]}}};assert.throws(()=>normalizeCatalog(duplicate,mapping));
  assert.throws(()=>getPath({},'constructor.prototype'));assert.throws(()=>extractJson('非 JSON 结构需人工整理'));
});

test('normalizeMeals：官方两表结构关联成清单，跨分类去重与图片代理化',()=>{
  const img='https://menu-img.mcd.cn/pcm/prod/menu/ProductPool/product/MS_1_320.png';
  const raw={structuredContent:{success:true,data:{categories:[
    {name:'人气热卖\n',meals:[{code:'A'},{code:'B'}]},
    {name:'汉堡',meals:[{code:'A'},{code:'C'}]}
  ],meals:{
    A:{name:'巨无霸',image:img,currentPrice:'31'},
    B:{name:'薯条',image:'https://evil.example.com/x.png',currentPrice:' 13 '},
    C:{name:'无图餐品'}
  }}}};
  const catalog=normalizeMeals(raw,{label:'门店 X'});
  assert.equal(catalog.source,'mcp');assert.equal(catalog.items.length,3);
  const a=catalog.items.find(x=>x.id==='mcd-A');
  // 首个分类优先：A 归属人气热卖（下方 items[0] 断言）
  assert.equal(catalog.items[0].category,'人气热卖');
  assert.equal(a.price,'31');
  assert.ok(a.image.startsWith('/foodimg?u=https%3A%2F%2Fmenu-img.mcd.cn%2F'));
  const b=catalog.items.find(x=>x.id==='mcd-B');
  assert.equal(b.image,undefined);assert.equal(b.price,'13'); // 非官方图域不代理；价格压平
  assert.equal(catalog.items.find(x=>x.id==='mcd-C').image,undefined);
  assert.throws(()=>normalizeMeals({structuredContent:{success:true,data:{categories:[],meals:{}}}}),/菜单为空/);
  assert.throws(()=>normalizeMeals({structuredContent:{success:false}}),/失败/);
});

test('parseNutrition：紧凑表按行尾 7 列解析，名称含逗号可恢复；坏表拒绝',()=>{
  const text='[3]{productName,nutritionDescription,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium}:\n'+
    '  猪柳麦满分,null,1288,308,16,16,24,781,213\n'+
    '  双层,吉士汉堡,null,1618,387,23,21,25,846,243\n'+
    '  圆筒冰淇淋,含乳制品,418,100,3,5,13,60,120\n'+
    '  坏行,只有,3 列\n'+
    '  坏数值行,x,1,2,3,abc,5,6,7\n';
  const rows=parseNutrition(text);
  assert.equal(rows.length,3);
  assert.deepEqual([rows[0].name,rows[0].energyKcal,rows[0].sodium],['猪柳麦满分',308,781]);
  assert.equal(rows[1].name,'双层,吉士汉堡');assert.equal(rows[1].name,'双层,吉士汉堡'); // 名称含逗号：行尾 7 列回溯可恢复

  assert.equal(rows[2].energyKj,418);
  assert.throws(()=>parseNutrition('没有字段头的数据'));assert.throws(()=>parseNutrition(''));
});

test('matchNutrition：全等优先、括号归一、双向包含取最短，超表与异常输入返回 null',()=>{
  const rows=[{name:'麦辣鸡腿汉堡',energyKcal:485},{name:'麦辣鸡腿汉堡(定时)",'.replace(/[".,]/g,'')&&'麦辣鸡腿汉堡(促销)',energyKcal:1},{name:'薯条',energyKcal:289}];
  assert.equal(matchNutrition('麦辣鸡腿汉堡',rows).energyKcal,485);
  assert.equal(matchNutrition('薯条（中）',rows).energyKcal,289);
  assert.equal(matchNutrition('不存在',rows),null);
  assert.equal(matchNutrition('',rows),null);
  assert.equal(matchNutrition('x',Array.from({length:401},()=>({name:'n'}))),null);
});
