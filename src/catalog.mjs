import {validateCatalog} from '../public/core.mjs';

// 按调用方确认的路径读取，不猜测官方未公开的字段与数据单位。
export function getPath(root, path) {
  if(typeof path!=='string'||path.length>300)throw new Error('字段路径无效。');
  const parts=path===''?[]:path.split('.');
  if(parts.some(x=>['__proto__','prototype','constructor'].includes(x)))throw new Error('禁止的字段路径。');
  let values=[root];
  for(const part of parts)values=values.flatMap(value=>part==='*'?(Array.isArray(value)?value:[]):value&&typeof value==='object'&&Object.hasOwn(value,part)?[value[part]]:[]);
  return values;
}

export function extractJson(text) {
  try{return JSON.parse(text);}catch{}
  // 某些工具在 JSON 前加字段说明；只接受能完整解析的平衡 JSON 块。
  for(let start=0;start<text.length;start++) {
    if(!['{','['].includes(text[start]))continue;
    let depth=0,quoted=false,escaped=false;
    for(let i=start;i<text.length;i++) {
      const c=text[i];
      if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
      if(c==='"'){quoted=true;continue;}
      if(c==='{'||c==='[')depth++;
      if(c==='}'||c===']')depth--;
      if(depth===0){try{return JSON.parse(text.slice(start,i+1));}catch{break;}}
    }
  }
  throw new Error('工具文本不含可解析 JSON。请通过 MCP 客户端检查真实结构并显式整理，不自动猜测。');
}

export function toolData(result) {
  if(result.isError)throw new Error('官方工具返回错误。');
  const value=result.structuredContent??extractJson((result.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n'));
  function check(v,depth=0){if(!v||typeof v!=='object'||depth>12)return;if(v.success===false||v.isError===true)throw new Error('官方业务返回失败，不能作为餐品清单。');for(const x of Object.values(v))if(x&&typeof x==='object')check(x,depth+1);}
  check(value);
  return value;
}

// query-meals 真实结构：data.categories[].meals[] 是 {code,tags}，详情在 data.meals.{code}。
// 两表按 code 关联成清单；官方图通过本机 /foodimg 同源代理引用，浏览器不直连外部域。
export function normalizeMeals(result, context = {}) {
  const root = toolData(result);
  const data = root.data;
  if (!data || !Array.isArray(data.categories) || !data.meals || typeof data.meals !== 'object') throw new Error('query-meals 返回缺少 categories/meals 结构，请先执行 inspect 核对真实字段。');
  const seen = new Set();
  const items = [];
  for (const group of data.categories) {
    if (!group || typeof group.name !== 'string' || !Array.isArray(group.meals)) throw new Error('query-meals 分类结构不完整。');
    for (const entry of group.meals) {
      if (!entry || typeof entry.code !== 'string' || !entry.code.trim()) throw new Error('query-meals 餐品编码缺失。');
      if (seen.has(entry.code)) continue; // 官方菜单允许同一餐品挂多个分类；清单按首次出现的分类收录，避免重复。
      seen.add(entry.code);
      const detail = data.meals[entry.code];
      if (!detail || typeof detail.name !== 'string' || !detail.name.trim()) throw new Error(`餐品 ${entry.code} 缺少名称，清单拒绝收录。`);
      const clean = value => String(value).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim(); // 官方分类名可能自带换行，展示前压平。
      const image = typeof detail.image === 'string' && detail.image.startsWith('https://menu-img.mcd.cn/') ? `/foodimg?u=${encodeURIComponent(detail.image)}` : undefined;
      items.push({id: `mcd-${entry.code}`, name: clean(detail.name), category: clean(group.name), price: typeof detail.currentPrice === 'string' && detail.currentPrice.trim() ? clean(detail.currentPrice) : undefined, ...(image ? {image} : {})});
    }
  }
  if (!items.length) throw new Error('该门店菜单为空，无法生成清单。');
  return validateCatalog({source: 'mcp', label: `MCP 菜单快照 · ${context.label || '本机采集'}`, capturedAt: new Date().toISOString(), tool: 'query-meals', items});
}

// list-nutrition-foods 返回紧凑表："「N」{字段名,...}:\n  名称,描述,数值..."。
// 餐品名与营养描述自身可能含逗号，因此从行尾固定取 7 个数值列，其余归并回名称与描述。
const NUTRITION_TAIL = ['energyKj', 'energyKcal', 'protein', 'fat', 'carbohydrate', 'sodium', 'calcium'];
const NUTRITION_VALUE = value => value === 'null' ? null : Number(value);
export function parseNutrition(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('营养表为空。');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const header = lines[0]?.match(/^\[(\d+)\]\{([^}]+)\}:$/);
  if (!header) throw new Error('营养表缺少字段头，拒绝猜测列含义。');
  const fields = header[2].split(',').map(f => f.trim());
  const lead = fields.length - NUTRITION_TAIL.length;
  if (lead < 1 || fields.slice(lead).join(',') !== NUTRITION_TAIL.join(',')) throw new Error('营养表列结构与预期不符。');
  const rows = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < fields.length) continue;
    const tail = parts.slice(-NUTRITION_TAIL.length).map(NUTRITION_VALUE);
    if (tail.some(v => v !== null && !Number.isFinite(v))) continue;
    // 行中若多出逗号，优先归入餐品名（名称比营养描述更常含逗号），描述列始终紧贴行尾数值列。
    const name = parts.slice(0, parts.length - NUTRITION_TAIL.length - 1).join(',').trim();
    const description = parts[parts.length - NUTRITION_TAIL.length - 1];
    if (!name) continue;
    rows.push({name, description: description === 'null' ? null : description, energyKj: tail[0], energyKcal: tail[1], protein: tail[2], fat: tail[3], carbohydrate: tail[4], sodium: tail[5], calcium: tail[6]});
  }
  if (!rows.length) throw new Error('营养表未解析出有效数据行。');
  const byName = new Map();
  for (const row of rows) {if (!byName.has(row.name)) byName.set(row.name, row);}
  return [...byName.values()];
}

export function normalizeCatalog(result,mapping,context={}) {
  if(!mapping||!['itemsPath','id','name'].every(k=>typeof mapping[k]==='string'))throw new Error('配置需显式提供 itemsPath、id、name 字段映射。');
  const root=toolData(result);
  const candidates=getPath(root,mapping.itemsPath).flatMap(x=>Array.isArray(x)?x:[x]);
  if(candidates.length>500)throw new Error('餐品数量超过 500，请缩小采集范围。');
  const items=candidates.map(row=>{
    const id=getPath(row,mapping.id)[0],name=getPath(row,mapping.name)[0];
    const category=mapping.category?getPath(row,mapping.category)[0]:'菜单餐品';
    return {id:typeof id==='number'&&Number.isSafeInteger(id)?String(id):id,name,category,icon:'meal'};
  });
  return validateCatalog({source:'mcp',label:`MCP 菜单快照 · ${context.label || '本机采集'}`,capturedAt:new Date().toISOString(),tool:'query-meals',items});
}
