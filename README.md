# 麦麦盲评局 McTaste

> 藏起名字，让味蕾先投票。一款跑在本机浏览器里的「盲评局」小应用：把麦当劳在售餐品编上号，朋友各拿一份匿名样本，独立打分、顺手竞猜身份，最后一起揭晓「本局心头好」和「金舌头」。
>
> 参赛项目：[麦当劳程序员创意开发大赛（M-CODE）](https://github.com/M-China/mcd-developer-innovation-challenge) · 基于麦当劳官方 MCP 能力开发 · 独立创意项目，非麦当劳官方产品。

## 它解决什么问题

一群人吃麦当劳时，「哪个最好吃」永远吵不出结果——包装、广告、价格都在带节奏。麦麦盲评局把流程做成了小实验：

- **编号盲评**：主持人按 `M01 / M02…` 分装，评委只认编号，去掉品牌暗示；
- **三维独立评分**：味道、香气、再吃意愿（1–5 分），轮换顺序抵消先后影响；
- **身份竞猜**：打分时顺手猜「这一口是哪款」，揭晓后比拼「金舌头」——猜错不扣分，纯荣誉战；
- **营养真相**：揭晓后按名称匹配官方营养数据，看看这局吃进去多少千卡和钠。

## 安装与运行

需要 Node.js ≥ 20（仅用标准库，无第三方依赖）。

```bash
npm install   # 实际无依赖，仅为习惯性一步
npm start     # 启动本地服务，默认 http://127.0.0.1:3024
```

打开 `http://127.0.0.1:3024` 即可用演示清单（36 款示例餐品）开一局。

### 同步真实门店菜单（MCP）

真实菜单与营养数据通过**麦当劳官方 MCP** 在本机同步，浏览器永不接触 Token：

1. 在 [open.mcd.cn](https://open.mcd.cn) 用手机号登录，控制台激活申请 MCP Token；
2. 在项目根目录创建 `.env`（已被 .gitignore 忽略），写入一行：`MCD_MCP_TOKEN=你的令牌`；
3. 把 `capture.example.json` 复制为 `data/capture.json`，将 `storeCode` 换成你附近门店的编号（先用 `node --env-file=.env scripts/mcp.mjs tools` 查看工具、按 `inspect` 命令摸清字段）；
4. 同步并刷新页面：

```bash
node --env-file=.env scripts/mcp.mjs sync --config data/capture.json
```

同步会生成 `data/catalog.json`（在售菜单快照，含官方图与现价）和 `data/nutrition.json`（营养数据）。图片经本机 `/foodimg` 同源代理加载，页面 CSP 保持 `img-src 'self'`。

## 使用示例（一局的完整流程）

1. **组局**：选 3–6 款餐品、填评委人数（2–12）、给这局起名 → 生成「主持人备餐单」；
2. **备餐**：按打印标签分装样本，去掉包装、统一容器，先确认忌口与过敏原；
3. **盲评**：评委按轮换顺序逐个试吃，每口打三维分数并竞猜身份，可跳过；支持中途换人、存档续评；
4. **揭晓**：全员交卷后公布排名、金舌头战报和营养真相，可导出 Markdown 报告或打印。

## 目标用户

- **朋友聚餐 / 家庭周末**：给「吃什么、哪个好吃」一个好玩且「科学」的裁决仪式；
- **学生社团 / 团建破冰**：低成本、强互动的现场小游戏；
- **测评与数据爱好者**：报告里有均分、分差、竞猜命中率，够写一段复盘；
- **麦当劳爱好者（麦门）**：用官方真实数据验证「我永远选对薯条」。

## 隐私与安全

- 全部数据保存在当前浏览器 localStorage 与本机 `data/` 目录，不上传任何服务器；
- 服务只监听 `127.0.0.1`，拒绝跨源与其他 Host 访问；
- MCP 客户端仅允许**只读工具**（门店、菜单、餐品详情、营养），不存在下单/支付/改地址等写操作；
- Token 只存在于本机环境变量，日志输出自动脱敏。

## 目录结构

```
server.mjs            本地 HTTP 服务（静态资源 + /api/catalog + /api/nutrition + /foodimg 代理）
public/               前端（原生 ES Module，无框架）
  ├─ index.html / style.css / app.mjs
  ├─ core.mjs         规则内核：建局、评分校验、排名、金舌头、营养匹配
  ├─ demo.json        36 款示例清单
  └─ img/             示例餐品图（本地副本）
src/                  MCP 客户端与数据整理
  ├─ mcp-client.mjs   JSON-RPC over Streamable HTTP、参数 schema 校验、只读白名单
  └─ catalog.mjs      query-meals 结构映射、营养表解析
scripts/mcp.mjs       同步 CLI：tools / inspect / sync
data/                 同步产物（gitignore，本机生成）
tests/                node --test 单元与 HTTP 测试
```

## 测试

```bash
npm test
```

覆盖：传输契约（初始化/分页/SSE/session）、参数 schema 校验、写操作拒绝、菜单结构映射、营养表解析、图片代理白名单、跨源与路径探测防护等。

## 参赛声明

本项目为原创开发，参赛文件见 `CONTEST_DECLARATION.md`（官方原文，未改动）；MCP 集成说明见 `MCP_INTEGRATION.md`；脱敏配置示例见 `mcp-config.example.json`。
