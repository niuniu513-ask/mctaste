export const ENDPOINT = 'https://mcp.mcd.cn';
export const READ_TOOLS = new Set(['query-nearby-stores','query-meals','query-meal-detail','list-nutrition-foods']);

export function parseRpc(text, contentType, id) {
  let candidates;
  if (contentType?.includes('text/event-stream')) {
    candidates = text.split(/\r?\n\r?\n/).map(event=>event.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n')).filter(Boolean).map(value=>JSON.parse(value));
  } else { candidates=[JSON.parse(text)]; }
  const message=candidates.find(x=>x.id===id);
  if (!message) throw new Error('MCP 未返回匹配的请求编号。');
  if (message.error) throw new Error(`MCP RPC 错误 ${message.error.code}。请在官方客户端检查参数。`);
  if (!Object.hasOwn(message,'result')) throw new Error('MCP 响应缺少 result。');
  return message.result;
}

export function validateArgs(schema, value, at='$') {
  if (!schema || typeof schema!=='object')throw new Error('工具参数定义无效。');
  if (schema.$ref)throw new Error('当前校验器不支持 $ref；请改用官方 MCP 客户端。');
  for(const combinator of ['oneOf','anyOf']) {
    if(schema[combinator]) {const count=schema[combinator].filter(s=>{try{validateArgs(s,value,at);return true;}catch{return false;}}).length;if(count===0||(combinator==='oneOf'&&count!==1))throw new Error(`${at} 不符合工具参数定义。`);}
  }
  if(schema.allOf)for(const s of schema.allOf)validateArgs(s,value,at);
  if(schema.enum&&!schema.enum.some(x=>JSON.stringify(x)===JSON.stringify(value)))throw new Error(`${at} 不在允许的选项中。`);
  const types=Array.isArray(schema.type)?schema.type:schema.type?[schema.type]:[];
  const matches=t=>t==='null'?value===null:t==='array'?Array.isArray(value):t==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):t==='integer'?Number.isInteger(value):t==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===t;
  if(types.length&&!types.some(matches))throw new Error(`${at} 类型不符合工具定义。`);
  if(value!==null&&typeof value==='object'&&!Array.isArray(value)) {
    for(const key of schema.required||[])if(!Object.hasOwn(value,key))throw new Error(`${at}.${key} 是必填参数。`);
    for(const [key,v] of Object.entries(value)) {
      if(schema.properties?.[key])validateArgs(schema.properties[key],v,`${at}.${key}`);
      else if(schema.additionalProperties===false)throw new Error(`${at}.${key} 不是允许的参数。`);
      else if(typeof schema.additionalProperties==='object')validateArgs(schema.additionalProperties,v,`${at}.${key}`);
    }
  }
  if(Array.isArray(value)) {
    if(schema.minItems!==undefined&&value.length<schema.minItems||schema.maxItems!==undefined&&value.length>schema.maxItems)throw new Error(`${at} 数量不符合工具定义。`);
    if(schema.items)value.forEach((x,i)=>validateArgs(schema.items,x,`${at}[${i}]`));
  }
  if(typeof value==='string') {
    if(schema.minLength!==undefined&&value.length<schema.minLength||schema.maxLength!==undefined&&value.length>schema.maxLength)throw new Error(`${at} 长度不符合工具定义。`);
    if(schema.pattern&&!new RegExp(schema.pattern).test(value))throw new Error(`${at} 格式不符合工具定义。`);
  }
  if(typeof value==='number'&&(schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum))throw new Error(`${at} 超出工具允许的范围。`);
}

export class McpClient {
  constructor(token,fetcher=fetch) {
    if(!token||/[\r\n]/.test(token))throw new Error('请在本机环境变量中设置 MCD_MCP_TOKEN，不要将 Token 发到聊天或写进项目。');
    this.token=token;this.fetcher=fetcher;this.id=0;this.session=null;this.protocol=null;
  }
  async request(method,params,notification=false) {
    const id=++this.id;
    const headers={'Authorization':`Bearer ${this.token}`,'Content-Type':'application/json','Accept':'application/json, text/event-stream'};
    if(this.session)headers['Mcp-Session-Id']=this.session;
    if(this.protocol)headers['MCP-Protocol-Version']=this.protocol;
    let response;
    try {response=await this.fetcher(ENDPOINT,{method:'POST',redirect:'error',headers,body:JSON.stringify({jsonrpc:'2.0',...(!notification?{id}:{}),method,...(params?{params}:{})}),signal:AbortSignal.timeout(25_000)});}
    catch {throw new Error('连接官方 MCP 失败或超时，请检查网络后重试。');}
    if(!response.ok)throw new Error(response.status===401?'官方 MCP 拒绝身份验证（401），请在本机更新 Token。':response.status===429?'官方 MCP 限流（429），请稍后重试。':`官方 MCP HTTP ${response.status}。`);
    const sid=response.headers.get('mcp-session-id');if(sid)this.session=sid;
    if(notification)return null;
    let raw;
    try {raw=parseRpc(await response.text(),response.headers.get('content-type'),id);}catch(e){if(e.message.startsWith('MCP '))throw e;throw new Error('MCP 返回格式无法解析。');}
    return raw;
  }
  async initialize() {
    const result=await this.request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'mctaste',version:'1.0.0'}});
    if(!['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(result.protocolVersion))throw new Error('官方返回暂不支持的 MCP 协议版本。');
    this.protocol=result.protocolVersion;
    await this.request('notifications/initialized',undefined,true);
  }
  async tools() {
    const tools=[];let cursor;
    for(let page=0;page<20;page++) {const result=await this.request('tools/list',cursor?{cursor}:{});if(!Array.isArray(result.tools))throw new Error('MCP 工具目录缺少 tools。');tools.push(...result.tools);if(!result.nextCursor)return tools;cursor=result.nextCursor;}
    throw new Error('工具目录分页超过限制。');
  }
  async call(name,args,tools) {
    if(!READ_TOOLS.has(name))throw new Error('本项目只允许查询门店、菜单、餐品详情或营养信息。');
    const tool=tools.find(x=>x.name===name);if(!tool)throw new Error('官方工具目录中未找到指定工具。');
    validateArgs(tool.inputSchema,args);
    const result=await this.request('tools/call',{name,arguments:args});
    if(result.isError)throw new Error('官方工具报告执行失败。');
    return result;
  }
}
