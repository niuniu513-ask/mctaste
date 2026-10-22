# MCP 集成说明（MCP_INTEGRATION）

麦麦盲评局（McTaste）通过**麦当劳官方 MCP 服务**获取真实在售菜单与营养数据，作为盲评局的真实餐品来源与揭晓后的「营养真相」环节。本文件说明实际使用的 Server、Tool、调用流程与业务价值。

## 使用的 MCP Server

| 项 | 值 |
|---|---|
| Server | 麦当劳官方 `mcd-mcp`（`serverInfo.name: "mcd-mcp"`） |
| 传输 | Streamable HTTP（JSON-RPC 2.0） |
| 地址 | `https://mcp.mcd.cn`（根路径，无额外路径） |
| 鉴权 | `Authorization: Bearer <MCP Token>`（Token 通过本机环境变量 `MCD_MCP_TOKEN` 注入，不入库不入 Git） |
| 协议版本 | `2025-03-26`（握手时与服务端协商校验） |

接入配置示例（脱敏）见 `mcp-config.example.json`；Token 申请方式见官方仓库 README。

## 实际使用的 Tool（均为只读）

| Tool | 用途 | 在项目中的位置 |
|---|---|---|
| `query-nearby-stores` | 按城市+关键词查门店，取得 `storeCode`（同步前人工选店） | 使用方式记录于 README「同步真实门店菜单」 |
| `query-meals` | 拉取指定门店**到店自取（orderType=1, beType=1）在售菜单**：分类 + 餐品编码 + 名称 + 官方图 + 现价 | `scripts/mcp.mjs sync` → `src/catalog.mjs normalizeMeals` → `data/catalog.json` |
| `list-nutrition-foods` | 拉取常见餐品营养成分（能量 kJ/kcal、蛋白质、脂肪、碳水、钠、钙） | `scripts/mcp.mjs sync` → `src/catalog.mjs parseNutrition` → `data/nutrition.json` |

**明确不使用的能力**：下单、支付、取消订单、地址管理、领券等一切写操作或账户操作。`src/mcp-client.mjs` 内置 `READ_TOOLS` 白名单，非白名单工具在客户端层直接拒绝。

## 调用流程

```
本机 CLI（scripts/mcp.mjs）
  │ 1. initialize ──► 校验协议版本（2024-11-05 / 2025-03-26 / 2025-06-18 / 2025-11-25）
  │ 2. notifications/initialized
  │ 3. tools/list（支持分页 cursor）
  │ 4. validateArgs：按官方 inputSchema 校验入参（枚举/必填/类型），不符即拒绝
  │ 5. tools/call query-meals {storeCode, orderType:1, beType:1}
  │    └─ normalizeMeals：categories[].meals[].code 与 meals.{code} 两表关联，
  │       跨分类重复编码按首次出现收录，分类名压平换行，
  │       官方图（仅 https://menu-img.mcd.cn/ 前缀）改写为同源代理地址 /foodimg?u=<encodeURIComponent>
  │    └─ 写入 data/catalog.json（原子替换 .tmp → rename）
  │ 6. tools/call list-nutrition-foods {}
  │    └─ parseNutrition：解析紧凑表（「N」{字段头}: 行式数据），
  │       行尾固定 7 个数值列，多出的逗号归入餐品名，数值非法行丢弃
  │    └─ 写入 data/nutrition.json
  ▼
本地 HTTP 服务（server.mjs，仅监听 127.0.0.1）
  ├─ GET /api/catalog   → data/catalog.json（经 validateCatalog 再校验；缺失时回退演示清单）
  ├─ GET /api/nutrition → data/nutrition.json（缺失返回 404 与同步指引）
  └─ GET /foodimg?u=    → 仅代理 https://menu-img.mcd.cn/ 的图片，内存缓存（上限 120 张），
                           浏览器不直连外部域，CSP 保持 img-src 'self'
  ▼
浏览器前端（public/）
  ├─ 组局页：87 款真实在售餐品，分类筛选 + 现价展示
  └─ 揭晓页：matchNutrition 按名称匹配营养数据（全等 → 去括号双向包含 → 最短名），
             展示「营养真相 · 每份」，标注仅供参考
```

同步过程浏览器离线可复现：`data/` 产物即快照，不要求评审时持有 Token；换一台电脑按 README 步骤用自有 Token 重新同步即可。

## 安全设计

- **最小权限**：只读白名单（`query-nearby-stores` / `query-meals` / `query-meal-detail` / `list-nutrition-foods`），`tools/call` 前逐项校验；
- **参数校验**：按官方 `inputSchema` 做枚举、必填、类型、范围校验，拒绝猜测式传参；
- **不保存凭证**：Token 仅存在于本机环境变量；CLI 输出对 Token 做正则脱敏；`mcp-config.example.json` 只含占位符；
- **错误不泄密**：HTTP 401/429/500 统一映射为不含上游原文的中文提示；
- **同源隔离**：浏览器侧一切外部资源（官方菜单图）经本机代理转同源，CSP 无需放宽。

## 业务价值

1. **真实样本可得性**：盲评清单直接来自门店当前在售菜单（含现价），主办方照单采购即可开局，避免「清单里有、门店没得卖」的尴尬；
2. **官方图提升辨识与传播**：揭晓榜使用官方产品图，报告可截图分享；
3. **营养真相复盘**：把「好吃」和「吃了多少」放到同一张结果页，盲评从游戏升级为可讨论的消费决策参考；
4. **可迁移范式**：同步 → 快照 → 同源代理的链路，可复用于任何「真实菜单 + 本地实验」类工具。
