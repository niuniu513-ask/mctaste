import {DIMENSIONS,createSession,submitBallot,reveal,results,report,tongueRanking,validateCatalog,validateBallot,matchNutrition} from './core.mjs';

const $ = s => document.querySelector(s);
const main = $('#main');
let catalog, session = null, view = 'setup', selected = new Set(), filter = '全部', judge = 0, step = 0, draft = {}, title = '周五快乐试吃局', judgeCount = 4, consent = false, toastTimer;
const storageKey = 'mctaste-v1';
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ARCHES='<svg class="arches-watermark" viewBox="0 0 64 44" aria-hidden="true" focusable="false"><path d="M6 42L6 21Q6 5 16.5 5Q25 5 27 16L32 30L37 16Q39 5 47.5 5Q58 5 58 21L58 42" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4500); }
function persist() { try { localStorage.setItem(storageKey,JSON.stringify({session,draft,judge,step})); } catch {toast('浏览器未能保存数据。请在关闭页面前导出结果。');} }
function sourceLabel() {return catalog.label || (catalog.source === 'mcp' ? `MCP 菜单快照 · ${catalog.capturedAt || '采集时间未知'}` : '手动导入 · 未独立核验');}
function illustration(icon) {
  const start = '<svg viewBox="0 0 100 90" aria-hidden="true" focusable="false"><ellipse cx="50" cy="80" rx="31" ry="5" fill="#e1e7f3"/>';
  const shapes = {
    fries:'<path d="M26 32l7-21h9l-2 33M44 38l3-30h10v32M58 36l7-23 9 4-7 27" stroke="#f0b93e" stroke-width="8" fill="none"/><path d="M23 36q27 10 54 0l-6 39H30z" fill="#ef8067"/><path d="M40 52h20" stroke="#fff2ce" stroke-width="4"/>',
    nuggets:'<path d="M22 52q-6-19 12-24t23 15q5 15-11 22T22 52" fill="#eab449" stroke="#d29831" stroke-width="2"/><path d="M51 42q11-17 27-3t-1 30q-18 9-25-9t-1-18" fill="#f1c365" stroke="#d29831" stroke-width="2"/><path d="M33 40l3-3m29 10l4 3m-29 5l3-2" stroke="#b98128" stroke-width="3"/>',
    corn:'<path d="M26 37h48l-5 38H31z" fill="#7cbcb0"/><ellipse cx="50" cy="37" rx="25" ry="11" fill="#ffe297"/><g fill="#efbc37"><circle cx="35" cy="36" r="4"/><circle cx="46" cy="32" r="4"/><circle cx="57" cy="36" r="4"/><circle cx="65" cy="32" r="4"/><circle cx="45" cy="40" r="4"/></g><path d="M39 54h22" stroke="#fff" stroke-width="3"/>',
    pie:'<path d="M21 53l48-27 13 25-48 27z" fill="#e6b65b" stroke="#c59337" stroke-width="2"/><path d="M31 51l5 9m8-17l5 9m8-17l5 9m9-8l-44 26" stroke="#f9db95" stroke-width="4"/>',
    ice:'<path d="M35 51h30L52 80z" fill="#deb477"/><path d="M32 49q-6-9 6-16-6-9 7-15-2-6 8-13 2 11 8 15 7 8 1 13 13 7 5 16z" fill="#fff4d8" stroke="#e8dabb" stroke-width="2"/>',
    drink:'<path d="M32 27h36l-5 50H37z" fill="#ef8067"/><ellipse cx="50" cy="27" rx="19" ry="5" fill="#f5b19f"/><path d="M50 41l7-31h15" fill="none" stroke="#234cdf" stroke-width="5"/><path d="M43 57h14" stroke="#fff4d8" stroke-width="4"/>',
    meal:'<path d="M22 46q4-28 28-28t28 28z" fill="#efc261"/><path d="M22 51h56" stroke="#5e8970" stroke-width="8"/><path d="M22 61h56" stroke="#8f6252" stroke-width="8"/><path d="M22 67h56q0 12-14 12H36Q22 79 22 67" fill="#efc261"/>'
  };
  return start+(shapes[icon] || shapes.meal)+'</svg>';
}
function photoHTML(item, cls) {
  if (!item.image) return illustration(item.icon);
  return `<span class="photo-frame ${cls || ''}" data-icon="${esc(item.icon || 'meal')}"><img class="product-photo" src="${esc(item.image)}" alt="" loading="lazy"></span>`;
}
function bindPhotoFallback(scope) {
  (scope || main).querySelectorAll('img.product-photo').forEach(img => {
    img.onerror = () => {const frame = img.closest('.photo-frame'); if (frame) {frame.classList.add('is-fallback'); frame.innerHTML = illustration(frame.dataset.icon || 'meal');}};
  });
}
function navigate(next) {view=next;render();main.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});}
function nav() {
  for (const [id,target] of [['setup','setup'],['vote','vote'],['result','result']]) {
    const button = $('#nav-'+id); button.removeAttribute('aria-current'); if(view===target)button.setAttribute('aria-current','step');
    button.disabled = id==='setup' ? Boolean(session) : id==='vote' ? !session || session.revealed : !session?.revealed;
  }
}
function render() {nav(); if(view==='setup')renderSetup();else if(view==='vote')renderVote();else renderResults();}
function renderSetup() {
  const categories = ['全部',...new Set(catalog.items.map(x=>x.category))];
  main.innerHTML=`<section class="hero"><div><div class="eyebrow">盲评小实验 · 只认编号</div><h1>先别看名字。<br>让<em>味蕾先投票。</em></h1><p>薯条、鸡块、甜品，谁才是你的心头好？<br>约上朋友，藏起包装，来一场认真又好玩的盲评。</p><div class="hero-tags"><span>3–6 款餐品</span><span>2–12 位评委</span><span>边吃边猜身份</span></div></div><div class="specimen" aria-label="匿名样本卡示意"><span class="signature-stars" aria-hidden="true">✳</span>${ARCHES}<div class="sample-ticket"><div class="ticket-head"><span>盲评样本 · 只认编号</span><span>● ● ●</span></div><div class="mystery" aria-hidden="true">?</div><div class="ticket-foot"><b>M01</b><span>只看编号，不看身份。<br>尝完这一口再说话。</span></div></div><div class="ticket-note">“原来我最喜欢的是这一款！”</div></div></section><section class="workspace" aria-label="创建盲评局"><div><div class="section-heading"><h2>这局，尝点什么？<small class="pick-count">已选 ${selected.size} / 6</small></h2><button class="text-button" id="open-import">换一份清单 ↗</button></div><p class="source-label">${esc(sourceLabel())}</p><div class="filter-tabs" aria-label="餐品分类">${categories.map(c=>`<button data-filter="${esc(c)}" aria-pressed="${filter===c}">${esc(c)}</button>`).join('')}</div><div class="products">${catalog.items.filter(x=>filter==='全部'||x.category===filter).map(item=>`<button class="product" data-item="${esc(item.id)}" aria-pressed="${selected.has(item.id)}" aria-label="${esc(item.name)}，${selected.has(item.id)?'已选择':'未选择'}"><span class="check" aria-hidden="true">${selected.has(item.id)?'✓':''}</span>${photoHTML(item)}<strong>${esc(item.name)}</strong><small>${esc(item.category)}${item.price?` · ¥${esc(item.price)}`:''}${catalog.source==='demo'?' · 示例餐品':''}</small></button>`).join('')}</div><div class="how"><div><b>藏起名字</b>主持人按编号分装。</div><div><b>换个顺序</b>每位评委轮换试吃。</div><div><b>顺手竞猜</b>猜一猜这是哪款。</div><div><b>最后揭晓</b>比心头好和金舌头。</div></div></div><aside class="setup-ticket"><h2>你的试吃入场券</h2><p class="sub">准备好了，就把第一口交给直觉。</p><label class="field">给这局起个名字<input id="session-title" maxlength="40" value="${esc(title)}" autocomplete="off"></label><label class="field">几位评委？<select id="judge-count">${Array.from({length:11},(_,i)=>i+2).map(n=>`<option value="${n}" ${n===judgeCount?'selected':''}>${n} 人</option>`).join('')}</select></label><div class="selected-line"><span>已选样本</span><b>${selected.size} / 6 款</b></div><label class="check-field"><input id="consent" type="checkbox" ${consent?'checked':''}><span>已与参与者确认试吃餐品、忌口与过敏原，并安排好分装。</span></label><button id="create-session" class="primary wide" ${selected.size<3||!consent?'disabled':''}>生成盲评局 <span aria-hidden="true">→</span></button><p class="tiny-note">先选 3–6 款。仅生成试吃清单，不下单。<br>同一设备轮流评分，主持人可看到样本身份；适合朋友娱乐，不提供防作弊隔离。</p></aside></section>`;
  $('#open-import').onclick=()=>$('#import-dialog').showModal();
  $('#session-title').oninput=e=>{title=e.target.value;};
  $('#judge-count').onchange=e=>{judgeCount=Number(e.target.value);};
  $('#consent').onchange=e=>{consent=e.target.checked;$('#create-session').disabled=selected.size<3||!consent;};
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;renderSetup();});
  document.querySelectorAll('[data-item]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.item;
    if(selected.has(id))selected.delete(id);else if(selected.size>=6){toast('每局最多 6 款，先取消一个样本再添加。');return;}else selected.add(id);
    renderSetup(); const target=Array.from(document.querySelectorAll('[data-item]')).find(x=>x.dataset.item===id); target?.focus();
  });
  $('#create-session').onclick=()=>{
    try{session=createSession({items:catalog.items.filter(x=>selected.has(x.id)),judges:judgeCount,seed:crypto.getRandomValues(new Uint32Array(1))[0],title,source:sourceLabel()});judge=0;step=0;draft={};persist();navigate('vote');openHost();}catch(e){toast(e.message);}
  };
  bindPhotoFallback();
}
function renderVote() {
  const completed=session.ballots.filter(Boolean).length;
  const done=Boolean(session.ballots[judge]);
  const code=session.orders[judge][step];
  const score=draft[code] || {};
  const voted=DIMENSIONS.every(d=>Number.isInteger(score[d.key]));
  const sidebar=`<aside class="judge-list"><h2>轮到谁了？</h2>${session.orders.map((_,i)=>`<button data-judge="${i}" aria-pressed="${judge===i}"><span>评委 ${String(i+1).padStart(2,'0')}</span><small>${session.ballots[i]?'已交卷':'待评分'}</small></button>`).join('')}<p class="tiny-note">${completed} / ${session.orders.length} 人已交卷<br>交给下一位之前，请先提交自己的评分。未提交草稿可切回继续。</p></aside>`;
  main.innerHTML=`<section class="session-top"><div><h1>${esc(session.title)}</h1><p>${session.samples.length} 款样本 · ${session.orders.length} 位评委 · ${esc(session.source)}</p></div><div class="actions"><button class="secondary" id="open-host">主持人备餐单</button><button class="text-button" id="restart">重新组局</button></div></section>${completed===session.orders.length?'<div class="reveal-banner"><p><strong>全员交卷！</strong> 编号马上揭开——看看心头好是谁，金舌头又是谁。</p><button class="primary" id="reveal">揭晓这一局 →</button></div>':''}<div class="session-grid">${sidebar}<section class="vote-surface" aria-label="独立评分">${done?`<div class="judge-empty"><div class="big-check" aria-hidden="true">✓</div><h2>评委 ${String(judge+1).padStart(2,'0')}，已交卷。</h2><p>评分已封存。${completed<session.orders.length?'把设备交给下一位，先别交换答案。':'所有人都准备好了，点击上方按钮揭晓。'}</p>${completed<session.orders.length?'<button class="primary" id="next-judge">交给下一位 →</button>':''}</div>`:`<div class="vote-title"><strong>评委 ${String(judge+1).padStart(2,'0')} 的独立评分</strong><span class="sample-progress">${step+1} / ${session.samples.length}</span></div><div class="sample-code"><small>请拿起这个编号的样本</small><strong>${code}</strong><p>尝一口，猜猜它是谁，再凭感受打分。</p></div>${DIMENSIONS.map(d=>`<div class="rating-row"><div class="rating-name"><b id="label-${d.key}">${d.label}</b><small>${d.question}</small></div><div class="rating-buttons" role="group" aria-labelledby="label-${d.key}">${[1,2,3,4,5].map(n=>`<button data-dimension="${d.key}" data-score="${n}" aria-pressed="${score[d.key]===n}" aria-label="${d.label} ${n} 分">${n}</button>`).join('')}</div></div>`).join('')}<div class="guess-row"><b>竞猜：这一口是哪款？</b><div class="guess-options" role="group" aria-label="身份竞猜">${session.samples.map(s=>`<button class="guess-option" data-guess="${esc(s.id)}" aria-pressed="${score.guess===s.id}">${esc(s.name)}</button>`).join('')}</div><small>候选就是本局的 ${session.samples.length} 款，猜错不扣分，猜对计入揭晓后的「金舌头」战绩。</small></div><p class="tiny-note">1 分 = 很不喜欢 · 3 分 = 一般 · 5 分 = 很喜欢。每种样本间可以喝水清口。</p><div class="vote-bottom"><div><button class="text-button" id="previous" ${step===0?'disabled':''}>← 上一个</button><button class="text-button" id="skip-sample">跳过此样本</button></div><button class="primary" id="next-sample" ${!voted?'disabled':''}>${step===session.samples.length-1?'封存并交卷':'记下，尝下一个'} →</button></div><p class="tiny-note">不适合试吃或不想评价时可跳过，不会算作 0 分。</p>`}</section></div>`;
  $('#open-host').onclick=openHost; $('#restart').onclick=()=>$('#reset-dialog').showModal();
  document.querySelectorAll('[data-judge]').forEach(b=>b.onclick=()=>{
    if(!session.ballots[judge]) {drafts[judge]=structuredClone(draft);}
    judge=Number(b.dataset.judge);draft=drafts[judge] || {};step=0;persist();renderVote();
  });
  if($('#next-judge'))$('#next-judge').onclick=()=>{judge=session.ballots.findIndex(b=>!b);step=0;draft=drafts[judge] || {};persist();renderVote();};
  if($('#reveal'))$('#reveal').onclick=()=>{try{session=reveal(session);persist();navigate('result');}catch(e){toast(e.message);}};
  document.querySelectorAll('[data-score]').forEach(b=>b.onclick=()=>{if(draft[code]?.skip)draft[code]={};draft[code]={...draft[code],[b.dataset.dimension]:Number(b.dataset.score)};drafts[judge]=structuredClone(draft);persist();renderVote();const target=Array.from(document.querySelectorAll('[data-score]')).find(x=>x.dataset.dimension===b.dataset.dimension&&x.dataset.score===b.dataset.score);target?.focus();});
  document.querySelectorAll('[data-guess]').forEach(b=>b.onclick=()=>{
    const next={...draft[code]};
    if(next.guess===b.dataset.guess)delete next.guess;else next.guess=b.dataset.guess;
    draft[code]=next;drafts[judge]=structuredClone(draft);persist();renderVote();
    const target=Array.from(document.querySelectorAll('[data-guess]')).find(x=>x.dataset.guess===draft[code]?.guess);target?.focus();
  });
  if($('#previous'))$('#previous').onclick=()=>{step--;persist();renderVote();};
  if($('#skip-sample'))$('#skip-sample').onclick=()=>{draft[code]={skip:true};advance();};
  if($('#next-sample'))$('#next-sample').onclick=advance;
}
let drafts={};
function advance() {
  drafts[judge]=structuredClone(draft);
  if(step<session.samples.length-1){step++;persist();renderVote();return;}
  try{session=submitBallot(session,judge,draft);draft={};delete drafts[judge];persist();renderVote();toast('评分已封存。');}catch(e){toast(e.message);}
}
function renderResults() {
  const rows=results(session);const rated=rows.filter(r=>r.average!==null);
  const winners=rated.filter(r=>r.rank===1);
  const tongues=tongueRanking(session);
  main.innerHTML=`<section class="result-intro"><div class="eyebrow">揭晓时刻 · 味蕾说了算</div><h1>${winners.length===0?'这一局，留下了悬念。':winners.length>1?'不分伯仲，都是心头好。':'原来，你们喜欢这一口。'}</h1><p>${esc(session.title)} · ${session.orders.length} 位评委 · ${esc(session.source)}</p><div class="actions"><button class="primary" id="download-report">导出本局报告 ↓</button> <button class="secondary" id="print-results">打印结果</button> <button class="text-button" id="restart">再组一局 ↗</button></div></section><section class="result-cards" aria-label="盲评结果">${rows.map(r=>`<article class="result-card"><span class="result-rank">${r.rank===null?'未评分':`第 ${r.rank} 名`}${r.rank===1?' / 本局心头好':''}</span>${r.image?photoHTML(r,'result-photo'):''}<h2>${esc(r.name)}</h2><span class="code">样本 ${r.code}</span><div class="result-score">${r.average?.toFixed(2) ?? '—'} <small>/ 5</small></div><div class="score-note">${r.count} 人有效评分 · ${r.skipped} 人跳过${r.guessedTotal?` · ${r.guessedCorrect}/${r.guessedTotal} 人猜对身份`:''}</div><div class="nutrition" data-nutrition="${esc(r.name)}"></div>${DIMENSIONS.map(d=>`<div class="metric"><span>${d.label}</span><progress max="5" value="${r.dimensions[d.key]??0}" aria-label="${esc(r.name)}的${d.label} ${r.dimensions[d.key]?.toFixed(2)??'无评分'} 分"></progress><b>${r.dimensions[d.key]?.toFixed(1)??'—'}</b></div>`).join('')}</article>`).join('')}</section><section class="tongue-board" aria-label="金舌头战报"><h2>金舌头战报</h2><p class="sub">${tongues.some(t=>t.guessed>0)?'评分之余大家都在猜身份，猜对最多的是——':'这局大家光顾着吃，没人参与竞猜。'}</p><div class="tongue-row">${tongues.map(t=>`<div class="tongue-card${t.crown?' crown':''}"><b>${t.crown?'金舌头 · ':''}评委 ${String(t.judge+1).padStart(2,'0')}</b><span class="tongue-score">${t.correct}<small> / ${t.guessed} 猜对</small></span><small>本局共 ${t.total} 款</small></div>`).join('')}</div><p class="tiny-note">竞猜在评分时随手完成，猜错不扣分，也不影响餐品排名；并列时多人同享「金舌头」。</p></section><section class="result-notes"><div><h2>分数怎么算？</h2><p>每位评委的味道、香气、再吃意愿等权平均，再对有效评分求均值。跳过不当作零分；同分并列，排序使用未四舍五入的原始均分。</p><p>只代表本局的口味偏好，不代表产品质量、营养或所有人的选择。有效评分人数不同时，均分尤其需要谨慎比较。</p></div><div><h2>金舌头怎么算？</h2><p>每位评委评分时对每个样本猜一次身份，候选就是本局这几款。猜对数量最多者获封「金舌头」，并列同享；猜错不扣分，也不影响餐品评分与名次。</p></div><div><h2>顺序，尽量公平一点。</h2><p>每位评委按循环顺序轮换试吃，各样本在每个位置的出现次数相差不超过 1。它不能消除所有先入为主或口味残留影响。主持人可看映射，本地数据可修改，不是防作弊竞赛系统。</p><p>最高与最低个人综合分之差：${rows.map(r=>`${esc(r.code)} ${r.spread?.toFixed(2)??'—'}`).join(' / ')}。差距只作观察，不检验统计显著性。</p></div></section><details><summary>查看每位评委的原始评分</summary><div class="table-scroll"><table class="detail-table"><thead><tr><th>评委</th>${session.samples.map(s=>`<th>${s.code} · ${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${session.ballots.map((b,i)=>`<tr><td>评委 ${i+1}</td>${session.samples.map(s=>`<td>${b[s.code].skip?'跳过':DIMENSIONS.map(d=>b[s.code][d.key]).join(' / ')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="tiny-note">每格依次为：味道 / 香气 / 再吃意愿。</p></details><div class="tiny-note">数据仅保存在当前浏览器。导出报告不含评委姓名，也不包含 Token。</div><br>`;
  bindPhotoFallback();
  loadNutrition();
  $('#download-report').onclick=()=>download(`mctaste-report.md`,report(session),'text/markdown;charset=utf-8');
  $('#print-results').onclick=()=>{document.body.className='print-results';window.print();};
  $('#restart').onclick=()=>$('#reset-dialog').showModal();
}
let nutritionRows;
async function loadNutrition() {
  const slots = main.querySelectorAll('[data-nutrition]');
  if (!slots.length) return;
  if (!nutritionRows) {
    try {
      const response = await fetch('/api/nutrition');
      if (!response.ok) return;
      const data = await response.json();
      nutritionRows = Array.isArray(data.rows) ? data.rows.slice(0, 400) : [];
    } catch {return;}
  }
  for (const slot of slots) {
    const row = matchNutrition(slot.dataset.nutrition, nutritionRows);
    if (!row || (row.energyKcal === null && row.protein === null && row.fat === null && row.sodium === null)) continue;
    slot.innerHTML = `<b>营养真相 · 每份</b><span>${[row.energyKcal!==null?`${row.energyKcal} 千卡`:'',row.protein!==null?`蛋白质 ${row.protein} g`:'',row.fat!==null?`脂肪 ${row.fat} g`:'',row.carbohydrate!==null?`碳水 ${row.carbohydrate} g`:'',row.sodium!==null?`钠 ${row.sodium} mg`:''].filter(Boolean).join(' · ')}</span><small>来自麦当劳官方营养数据，按餐品名称匹配，仅供参考；实际以门店餐品为准。</small>`;
  }
}
function openHost() {
  $('#host-content').innerHTML=`<div class="label-grid">${session.samples.map(s=>`<div class="print-label"><small>盲评样本 · ${esc(session.title)}</small><br><b>${s.code}</b><p>${esc(s.name)}</p><div class="print-only">匿名试吃样本 · 不展示餐品名称</div></div>`).join('')}</div><p class="tiny-note">打印时会隐藏餐品名称。主持人可在屏幕上查看编号映射，不要向评委展示。</p>`;
  $('#host-dialog').showModal();
}
function download(name,text,type) {const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#close-host').onclick=()=>$('#host-dialog').close(); $('#close-import').onclick=()=>$('#import-dialog').close();
$('#print-labels').onclick=()=>{document.body.className='print-labels';window.print();};
window.addEventListener('afterprint',()=>{document.body.className='';});
$('#clear-storage').onclick=()=>$('#reset-dialog').showModal();
$('#cancel-reset').onclick=()=>$('#reset-dialog').close();
$('#confirm-reset').onclick=()=>{session=null;draft={};drafts={};judge=0;step=0;consent=false;try{localStorage.removeItem(storageKey);}catch{}$('#reset-dialog').close();navigate('setup');toast('本局数据已清除。');};
$('#nav-vote').onclick=()=>navigate('vote');$('#nav-result').onclick=()=>navigate('result');$('#nav-setup').onclick=()=>navigate('setup');
$('#catalog-file').onchange=async e=>{
  try{const file=e.target.files[0];if(!file)return;if(file.size>1_000_000)throw new Error('清单过大，请限制在 1 MB 以内。');const raw=JSON.parse(await file.text());const clean={source:'manual',label:'手动导入 · 未独立核验',items:raw.items?.map(x=>({id:x.id,name:x.name,category:x.category,icon:'meal'}))};catalog=validateCatalog(clean);selected=new Set();filter='全部';$('#import-dialog').close();renderSetup();toast('已导入餐品清单。');}catch(e){$('#import-error').textContent=e.message;}finally{e.target.value='';}
};
try {
  const response=await fetch('/api/catalog');if(!response.ok)throw new Error('清单载入失败，请检查服务端清单或重新同步。');catalog=validateCatalog(await response.json());
  try{
    const saved=JSON.parse(localStorage.getItem(storageKey));
    if(saved?.session){const s=saved.session;if(s.version!==1)throw new Error();validateCatalog({source:'manual',items:s.samples});if(!Number.isInteger(s.orders?.length)||s.orders.length<2||s.orders.length>12||s.ballots.length!==s.orders.length||s.samples.length>6)throw new Error();const codes=s.samples.map(x=>x.code);if(new Set(codes).size!==codes.length||!codes.every(x=>/^M0[1-6]$/.test(x)))throw new Error();if(!s.orders.every(order=>Array.isArray(order)&&order.length===codes.length&&new Set(order).size===codes.length&&order.every(x=>codes.includes(x))))throw new Error();s.ballots.filter(Boolean).forEach(b=>validateBallot(s,b));if(s.revealed&&s.ballots.some(b=>!b))throw new Error();if(typeof s.title!=='string'||s.title.length>40||typeof s.source!=='string')throw new Error();session=s;judge=Number.isInteger(saved.judge)&&saved.judge>=0&&saved.judge<s.orders.length?saved.judge:0;step=Number.isInteger(saved.step)&&saved.step>=0&&saved.step<s.samples.length?saved.step:0;draft=saved.draft&&typeof saved.draft==='object'?saved.draft:{};drafts[judge]=draft;view=s.revealed?'result':'vote';}
  }catch{localStorage.removeItem(storageKey);toast('保存的本局数据无法读取，已回到建局页。');}
  render();
}catch(e){main.innerHTML=`<section class="hero"><div><h1>餐品清单还没就位。</h1><p>${esc(e.message)}</p><button class="primary" id="retry">重新载入</button></div></section>`;$('#retry').onclick=()=>location.reload();}
