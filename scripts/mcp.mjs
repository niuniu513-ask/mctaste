import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {McpClient,READ_TOOLS} from '../src/mcp-client.mjs';
import {normalizeCatalog,normalizeMeals,parseNutrition,toolData} from '../src/catalog.mjs';

const command=process.argv[2];
const option=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;};
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function save(dir,name,value) {
  await mkdir(dir,{recursive:true});
  const file=path.join(dir,name);
  await writeFile(file.replace(/\.json$/,'.tmp.json'),JSON.stringify(value,null,2),'utf8');
  await rename(file.replace(/\.json$/,'.tmp.json'),file);
}
try {
  if(!['tools','inspect','sync'].includes(command)) {
    console.log('Usage:\n node scripts/mcp.mjs tools\n node scripts/mcp.mjs inspect --config data/capture.json\n node scripts/mcp.mjs sync --config data/capture.json');
    if(command)process.exitCode=1;
  } else {
    const client=new McpClient(process.env.MCD_MCP_TOKEN);
    await client.initialize();const tools=await client.tools();
    if(command==='tools')console.log(JSON.stringify(tools.filter(x=>READ_TOOLS.has(x.name)).map(({name,description,inputSchema})=>({name,description,inputSchema})),null,2));
    else {
      const configPath=option('--config');if(!configPath)throw new Error('请用 --config 指定本机配置文件。');
      const config=JSON.parse(await readFile(configPath,'utf8'));
      if(config.tool!=='query-meals')throw new Error('盲评清单只能来自 query-meals，不能将营养表冒充门店在售菜单。');
      const dir=path.join(root,'data');
      if(command==='inspect') {
        const result=await client.call(config.tool,config.arguments,tools);
        const data=toolData(result);
        function paths(value,prefix='',depth=0){if(depth>7)return[];if(Array.isArray(value))return value.length?paths(value[0],prefix?prefix+'.*':'*',depth+1):[prefix+' [empty array]'];if(value&&typeof value==='object')return Object.entries(value).flatMap(([k,v])=>paths(v,prefix?prefix+'.'+k:k,depth+1));return [prefix+' ['+typeof value+']'];}
        console.log(paths(data).join('\n'));
        console.log('只显示字段路径，不输出原始账号、地址或菜单响应。确认结构后直接执行 sync。');
      } else {
        const result=await client.call(config.tool,config.arguments,tools);
        const catalog=config.mapping?normalizeCatalog(result,config.mapping,{label:'本机采集'}):normalizeMeals(result,{label:`门店 ${config.arguments?.storeCode || '未知'}`});
        await save(dir,'catalog.json',catalog);
        console.log(`已保存 ${catalog.items.length} 款餐品至 data/catalog.json。`);
        try {
          const nutritionResult=await client.call('list-nutrition-foods',{},tools);
          const rows=parseNutrition(toolData(nutritionResult).data);
          await save(dir,'nutrition.json',{source:'mcp',tool:'list-nutrition-foods',capturedAt:new Date().toISOString(),rows});
          console.log(`已保存 ${rows.length} 条营养数据至 data/nutrition.json。未创建订单。`);
        } catch(error) {console.error('菜单已同步，但营养数据失败：'+error.message);process.exitCode=1;}
      }
    }
  }
} catch(error) {const token=process.env.MCD_MCP_TOKEN;const message=String(error.message);console.error(token?message.split(token).join('[REDACTED]'):message);process.exitCode=1;}
