export const DIMENSIONS = [
  { key: 'taste', label: '味道', question: '这一口，好吃吗？' },
  { key: 'aroma', label: '香气', question: '闻起来，喜欢吗？' },
  { key: 'again', label: '再吃意愿', question: '下次，还想吃吗？' }
];

export function shuffle(values, seed) {
  const out = [...values];
  let state = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const j = Math.floor((state / 4294967296) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function validateCatalog(catalog) {
  if (!catalog || !['demo', 'mcp', 'manual'].includes(catalog.source) || !Array.isArray(catalog.items) || catalog.items.length < 3 || catalog.items.length > 500) throw new Error('清单应包含 3–500 款餐品，并标明来源。');
  const ids = new Set();
  for (const item of catalog.items) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 160 || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100 || typeof item.category !== 'string' || item.category.length > 40) throw new Error('餐品的编号、名称或分类无效。');
    if (item.image !== undefined && (typeof item.image !== 'string' || (!item.image.startsWith('/img/') && !item.image.startsWith('/foodimg?u=')) || item.image.length > 300)) throw new Error('餐品图片路径无效：仅允许本机 /img/ 或经同源代理的 /foodimg?u= 地址。');
    if (ids.has(item.id)) throw new Error('清单含重复餐品编号，请先合并。');
    ids.add(item.id);
  }
  return catalog;
}

export function createSession({items, judges, seed, title, source}) {
  if (!Array.isArray(items) || items.length < 3 || items.length > 6) throw new Error('请选择 3–6 款餐品。');
  validateCatalog({source: 'manual', items});
  if (!Number.isInteger(judges) || judges < 2 || judges > 12) throw new Error('评委人数应为 2–12 人。');
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('随机种子无效。');
  if (typeof title !== 'string' || !title.trim() || title.length > 40) throw new Error('局名应为 1–40 个字。');
  const samples = shuffle(items, seed).map((item, i) => ({...item, code: `M${String(i + 1).padStart(2, '0')}`}));
  const base = shuffle(samples.map(s => s.code), seed ^ 0x5bf03635);
  const orders = Array.from({length: judges}, (_, j) => base.map((_, i) => base[(i + j) % base.length]));
  return {version: 1, id: `mt-${seed}-${Date.now()}`, title: title.trim(), source, createdAt: new Date().toISOString(), samples, orders, ballots: Array(judges).fill(null), revealed: false};
}

export function validateBallot(session, ballot) {
  if (!ballot || Object.keys(ballot).length !== session.samples.length) throw new Error('请评价或跳过每个样本。');
  const known = k => k === 'guess' || k === 'skip' || DIMENSIONS.some(d => d.key === k);
  for (const sample of session.samples) {
    const score = ballot[sample.code];
    if (!score) throw new Error('每个样本都需要评分或跳过。');
    const keys = Object.keys(score);
    if (keys.some(k => !known(k))) throw new Error('评分里混入了未知字段。');
    if ('guess' in score && !session.samples.some(s => s.id === score.guess)) throw new Error('竞猜的餐品不在本局候选里。');
    if (score.skip === true) {
      if (keys.length !== 1 && !(keys.length === 2 && 'guess' in score)) throw new Error('跳过的样本只保留竞猜，不再评分。');
      continue;
    }
    if (!DIMENSIONS.every(d => Number.isInteger(score[d.key]) && score[d.key] >= 1 && score[d.key] <= 5)) throw new Error('每个维度需选择 1–5 分；也可以跳过整个样本。');
    if (keys.length !== 3 && keys.length !== 4) throw new Error('评分字段数量不对。');
  }
}

export function submitBallot(session, judge, ballot) {
  if (session.revealed) throw new Error('已经揭晓，评分已锁定。');
  if (!Number.isInteger(judge) || judge < 0 || judge >= session.orders.length) throw new Error('评委编号无效。');
  if (session.ballots[judge]) throw new Error('这位评委已交卷。');
  validateBallot(session, ballot);
  const copy = structuredClone(session);
  copy.ballots[judge] = structuredClone(ballot);
  return copy;
}

export function reveal(session) {
  if (session.ballots.length !== session.orders.length || session.ballots.some(b => !b)) throw new Error('等所有评委交卷后再揭晓。');
  session.ballots.forEach(b => validateBallot(session, b));
  return {...session, revealed: true};
}

export function results(session) {
  if (!session.revealed) throw new Error('揭晓前不显示分数。');
  return session.samples.map(sample => {
    const votes = session.ballots.map(b => b[sample.code]).filter(b => !b.skip);
    const guesses = session.ballots.map(b => b[sample.code]).filter(b => b.guess);
    const scores = votes.map(b => DIMENSIONS.reduce((sum, d) => sum + b[d.key], 0) / 3);
    const dimensions = Object.fromEntries(DIMENSIONS.map(d => [d.key, votes.length ? votes.reduce((sum, b) => sum + b[d.key], 0) / votes.length : null]));
    const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const spread = scores.length ? Math.max(...scores) - Math.min(...scores) : null;
    return {...sample, count: votes.length, skipped: session.ballots.length - votes.length, average, spread, dimensions, guessedTotal: guesses.length, guessedCorrect: guesses.filter(b => b.guess === sample.id).length};
  }).sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || a.code.localeCompare(b.code)).map((row, i, list) => ({...row, rank: row.average === null ? null : list.filter(x => x.average !== null && x.average > row.average + 1e-10).length + 1}));
}

export function tongueRanking(session) {
  if (!session.revealed) throw new Error('揭晓前不显示竞猜结果。');
  const rows = session.ballots.map((ballot, judge) => {
    let guessed = 0, correct = 0;
    for (const sample of session.samples) {
      const score = ballot[sample.code];
      if (score?.guess) {guessed++; if (score.guess === sample.id) correct++;}
    }
    return {judge, correct, guessed, total: session.samples.length};
  });
  const best = Math.max(...rows.map(r => r.correct));
  return rows.map(r => ({...r, crown: best > 0 && r.correct === best})).sort((a, b) => b.correct - a.correct || a.judge - b.judge);
}

// 揭晓后按名称把官方营养数据匹配到本局餐品；先全等，再去括号后双向包含，取名称最短者。
export function matchNutrition(name, rows) {
  if (typeof name !== 'string' || !name.trim() || !Array.isArray(rows) || rows.length > 400) return null;
  const clean = name.trim();
  const exact = rows.find(r => r && r.name === clean);
  if (exact) return exact;
  const base = clean.replace(/（[^）]*）|\([^)]*\)/g, '').trim();
  if (!base) return null;
  return rows.filter(r => r && typeof r.name === 'string' && (r.name.includes(base) || base.includes(r.name))).sort((a, b) => a.name.length - b.name.length)[0] || null;
}

export function report(session) {
  const rows = results(session);
  const board = tongueRanking(session);
  const tongues = board.some(t => t.guessed > 0) ? `\n\n金舌头榜：${board.map(t => `评委 ${t.judge + 1} 猜对 ${t.correct}/${t.guessed}${t.crown ? '（金舌头）' : ''}`).join(' · ')}\n竞猜不计入餐品评分；猜对最多者并列同享「金舌头」。` : '';
  return `# ${session.title}\n\n来源：${session.source}\n评委：${session.orders.length} 人\n样本：${session.samples.length} 款\n\n| 名次 | 编号 | 餐品 | 综合 / 5 | 有效评分 | 跳过 | 猜对 |\n|---|---|---|---|---|---|---|\n${rows.map(r => `| ${r.rank ?? '—'} | ${r.code} | ${r.name.replaceAll('|', '／').replace(/[\r\n]/g, ' ')} | ${r.average?.toFixed(2) ?? '无评分'} | ${r.count} | ${r.skipped} | ${r.guessedTotal ? `${r.guessedCorrect}/${r.guessedTotal}` : '—'} |`).join('\n')}\n\n三个维度等权；跳过不计零分；同分并列。参与人数不是样本量充分的科学研究，结果只代表本局偏好。轮换顺序使每个位置的出现次数相差不超过 1，但不消除全部顺序与口味残留影响。不同有效评分人数的均分不可直接解释为统计显著差异。${tongues}\n`;
}
