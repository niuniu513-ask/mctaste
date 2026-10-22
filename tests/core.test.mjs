import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession,submitBallot,reveal,results,report,tongueRanking,validateCatalog,shuffle} from '../public/core.mjs';

const items=Array.from({length:6},(_,i)=>({id:String(i),name:`餐品 ${i}`,category:'样本'}));
const make=(n=3,judges=3)=>createSession({items:items.slice(0,n),judges,seed:1024,title:'测试局',source:'合成测试数据'});
const ballot=(s,value=3)=>Object.fromEntries(s.samples.map(x=>[x.code,{taste:value,aroma:value,again:value}]));

test('同一个种子得到相同映射；原始清单不被修改',()=>{
  assert.deepEqual(make().samples,make().samples);
  assert.deepEqual(shuffle(items,4).sort((a,b)=>a.id.localeCompare(b.id)),items);
});
test('3–6 样本 × 2–12 人，每个位置出现次数差不超过 1；每人恰好试完一轮',()=>{
  for(let n=3;n<=6;n++)for(let judges=2;judges<=12;judges++){
    const s=make(n,judges),codes=s.samples.map(x=>x.code).sort();
    s.orders.forEach(order=>assert.deepEqual([...order].sort(),codes));
    for(let position=0;position<n;position++){
      const counts=codes.map(code=>s.orders.filter(o=>o[position]===code).length);
      assert.ok(Math.max(...counts)-Math.min(...counts)<=1);
    }
  }
});
test('拒绝错误局配置、重复餐品与无效清单',()=>{
  assert.throws(()=>make(2));assert.throws(()=>make(3,1));assert.throws(()=>make(3,13));
  assert.throws(()=>createSession({items:[items[0],items[0],items[1]],judges:3,seed:2,title:'t'}));
  assert.throws(()=>validateCatalog({source:'demo',items:[{}, {}, {}]}));
});
test('未全员交卷不能揭晓，揭晓前无法取出分数',()=>{
  const s=make();assert.throws(()=>reveal(s));assert.throws(()=>results(s));
  const s2=submitBallot(s,0,ballot(s));assert.equal(s.ballots[0],null);assert.throws(()=>reveal(s2));
});
test('评分拒绝缺项、越界、额外样本、重复交卷和无效评委',()=>{
  const s=make(),b=ballot(s);delete b.M01;assert.throws(()=>submitBallot(s,0,b));
  for(const value of [0,6,2.5,'5',NaN]){const b=ballot(s);b.M01.taste=value;assert.throws(()=>submitBallot(s,0,b));}
  assert.throws(()=>submitBallot(s,0,{...ballot(s),BAD:{taste:5,aroma:5,again:5}}));
  assert.throws(()=>submitBallot(s,-1,ballot(s)));
  const s2=submitBallot(s,0,ballot(s));assert.throws(()=>submitBallot(s2,0,ballot(s)));
});
test('跳过不计零分；全跳过没有名次；同分并列且保留有效人数',()=>{
  let s=make();
  for(let j=0;j<3;j++){const b=ballot(s,4);b.M03={skip:true};if(j===0)b.M01={skip:true};s=submitBallot(s,j,b);}
  s=reveal(s);const rows=results(s),a=rows.find(x=>x.code==='M01'),b=rows.find(x=>x.code==='M02'),c=rows.find(x=>x.code==='M03');
  assert.equal(a.average,4);assert.equal(a.count,2);assert.equal(a.skipped,1);assert.equal(a.rank,1);assert.equal(b.rank,1);assert.equal(c.average,null);assert.equal(c.rank,null);
  assert.throws(()=>submitBallot(s,0,ballot(s)));
  assert.match(report(s),/跳过不计零分/);
});
test('与独立原始总分计算一致，报告不把未揭晓数据泄漏',()=>{
  let s=make(6,12);const sums=Object.fromEntries(s.samples.map(x=>[x.code,0]));
  for(let j=0;j<12;j++){
    const b=Object.fromEntries(s.samples.map((x,i)=>{const v={taste:(i+j)%5+1,aroma:(i*2+j)%5+1,again:(j*2+i)%5+1};sums[x.code]+=v.taste+v.aroma+v.again;return[x.code,v];}));
    s=submitBallot(s,j,b);
  }
  assert.throws(()=>report(s));s=reveal(s);for(const row of results(s))assert.ok(Math.abs(row.average-sums[row.code]/36)<1e-12);
});

test('竞猜：候选外与未知字段被拒；旧式三键评分依旧有效',()=>{
  const s=make();
  const wrong=ballot(s);wrong.M01.guess='不存在的id';assert.throws(()=>submitBallot(s,0,wrong));
  const junk=ballot(s);junk.M01.hack=1;assert.throws(()=>submitBallot(s,0,junk));
  const skipGuess=ballot(s);skipGuess.M02={skip:true,guess:s.samples[1].id};assert.doesNotThrow(()=>submitBallot(s,0,skipGuess));
  const badSkip=ballot(s);badSkip.M02={skip:true,guess:'不存在'};assert.throws(()=>submitBallot(s,0,badSkip));
});
test('竞猜：猜对数计入餐品与金舌头榜，并列同享，揭晓前不可见',()=>{
  let s=make(3,3);
  const b0=ballot(s,4);b0[s.samples[0].code].guess=s.samples[0].id;b0[s.samples[1].code].guess=s.samples[2].id;
  const b1=ballot(s,4);b1[s.samples[0].code].guess=s.samples[0].id;
  s=submitBallot(s,0,b0);s=submitBallot(s,1,b1);s=submitBallot(s,2,ballot(s));
  assert.throws(()=>tongueRanking(s));
  s=reveal(s);
  const rows=results(s),top=rows.find(r=>r.code===s.samples[0].code);
  assert.equal(top.guessedCorrect,2);assert.equal(top.guessedTotal,2);
  const other=rows.find(r=>r.code===s.samples[1].code);
  assert.equal(other.guessedCorrect,0);assert.equal(other.guessedTotal,1);
  const board=tongueRanking(s);
  assert.deepEqual(board.map(t=>t.judge),[0,1,2]);
  assert.equal(board[0].correct,1);assert.equal(board[0].crown,true);
  assert.equal(board[1].correct,1);assert.equal(board[1].crown,true);
  assert.equal(board[2].correct,0);assert.equal(board[2].guessed,0);assert.equal(board[2].crown,false);
  assert.match(report(s),/金舌头榜/);assert.match(report(s),/猜对 \|/);
});
test('全员弃猜：不产生金舌头，结果页规则不受影响',()=>{
  let s=make(3,2);
  s=submitBallot(s,0,ballot(s));s=submitBallot(s,1,ballot(s));s=reveal(s);
  const board=tongueRanking(s);
  assert.ok(board.every(t=>t.crown===false&&t.guessed===0));
  assert.doesNotMatch(report(s),/金舌头榜/);
});
