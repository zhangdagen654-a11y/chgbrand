---
name: google-flow
description: 用 AdsPower + Puppeteer/Playwright 自动化 Google Flow（labs.google/fx/tools/flow）：写 prompt、上传参考图、生成、下载结果。已实测，选择器和坑点全部锁定。
last_verified: 2026-05-06
verified_environment:
  adspower_profile: k1bsgahl
  account_tier: ULTRA
  default_model: Nano Banana Pro x4
---

# Google Flow 自动化操作手册

## 🚨 铁律 0（高于一切）

**写任何新脚本 / 修改任何现有脚本之前，必须先把这份 Skill 文件从头到尾读一遍，按里面已经验证过的方法做。已经踩过的坑不要再踩。**

> 作者本人已经为下面这些问题付出过 credits + 时间。再去自己重试 = 浪费时间 + 钱。

### 已验证、不要再试别的方式的三件事

| 任务 | ✅ 必须用 | ❌ 不要试 | 原因 |
|------|---------|---------|------|
| **启动浏览器** | `mcp__adspower-local-api__open-browser` + `connect-browser-with-ws` | 自己调 `http://127.0.0.1:50325/api/v1/browser/start` | AdsPower v6 的 local API 强制要求 api-key，且 key 的传递位置（header / query / 字段名）官方没文档，9 种试法都返回 `Require api-key`。MCP 工具内部已封装好。 |
| **页面操作（点击、填字、文件上传）** | Playwright `connectOverCDP(ws)` 接管，全程 `locator.click()` / `locator.fill()` / `locator.setInputFiles()` | AdsPower MCP 的 `click-element` / `fill-input`（除了简单 click 可以用，复杂操作不要） | MCP 工具集**没有暴露 setInputFiles**；fill-input 对隐藏 input 报"locator not visible"；click-element 不接 XPath。Playwright CDP 是超集。 |
| **文件上传** | `page.setInputFiles('input[type=file]', path)`（Playwright） | JS 注入 `input.files = dt.files` / 直接调 React `onChange` | 文件输入校验源头是 trusted，需走 CDP `DOM.setFileInputFiles`。纯 JS 即便构造 `DataTransfer` + 直接调 React 的 `onChange` 也不会触发 Flow 后端的 upload 请求（实测验证 4 次都失败）。 |

### MCP server 断了怎么办

**已破解**：MCP 内部源码（`local-api-mcp-typescript/build/index.js` 461 行）显示认证方式是
```
headers: { "Authorization": `Bearer ${API_KEY}` }
```
直接在脚本里这样调 `http://127.0.0.1:50325/api/v1/browser/{start,stop,active}` 就行，不再需要 MCP。AdsPower API key 在客户端"设置 → 应用程序服务接口"里看。

历史上一直说"Require api-key"是因为试了 6 种 header 名 + 3 种 query 名都不带 `Bearer` 前缀。带 `Bearer ` 就过。

### Clash 全局模式下切节点必须切 GLOBAL 组（不是 🚀 节点选择）

**致命坑**：如果 Clash 是 `mode: global`（TUN 模式 + 全局代理常见），所有流量走 **GLOBAL 组**选中的节点。`🚀 节点选择` 这个组只在 RULE 模式下被规则引用，全局模式下**完全是摆设**——切了它流量根本不变。

```js
// 启动时先用 GET /configs 拿 mode
const cfg = JSON.parse((await pipeRequest('/configs')).body);
const PROXY_GROUP = cfg.mode === 'global' ? 'GLOBAL' : '🚀 节点选择';
// 然后 PUT /proxies/{PROXY_GROUP} 切节点
```

之前花了 1 小时反复"切节点 + 重启浏览器"全部失败，根因就是 mode=global 但我切的 🚀 节点选择 → 流量仍走 GLOBAL 组的旧节点 → IP 没真换 → 账号被同 IP 反复打 → 触发 "unusual activity" 风控。

### Flow 加载到营销首页（被踢出工作台）

切 IP 频繁 / session 异常时，Flow 工作台 URL（`/project/{uuid}`）有时会**渲染成 Flow 营销首页**（含 "Create with Flow"、"Where the next wave of storytelling happens"、"Get Started" 等内容），但 URL 不变、`isAccountsRedirect=false`、用户 cookies 仍在。

**判别**：DOM 里没有 `[data-slate-editor="true"]`，body 文本含 "Create with Flow" / "Watch Flow TV" / "Get Started"。

**处理**：点击页面上的 "Create with Flow" 按钮（链接到带账号校验的工作台入口），等工作台真正加载出 prompt 输入框。**不要 reload**（reload 还是营销首页）。

```js
async function gotoWorkspace(page, projectUrl) {
  await page.goto(projectUrl, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3000);
  let hasSlate = await page.evaluate(() => !!document.querySelector('[data-slate-editor="true"]'));
  if (!hasSlate) {
    // 营销首页 fallback：点 "Create with Flow" / "Get Started"
    const clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('a, button')).find(el =>
        /Create with Flow|Get Started/i.test(el.innerText)
      );
      if (btn) { btn.setAttribute('data-bot-runtime', 'create-flow'); return true; }
      return false;
    });
    if (clicked) {
      await page.click('[data-bot-runtime="create-flow"]');
      await page.waitForSelector('[data-slate-editor="true"]', { timeout: 60000 });
    } else {
      throw new Error('营销首页且未找到 Create with Flow 按钮');
    }
  }
}
```

### 流程模板（每次写新脚本必看）

```
1. 浏览器启动      → MCP open-browser + connect-browser-with-ws (拿 ws)
                    → 或：用户在 AdsPower GUI 手动启动 + 给 ws
2. Playwright 接管 → chromium.connectOverCDP(ws)
3. 页面操作        → 全程 Playwright locator API
4. 文件上传        → page.setInputFiles()
5. 风控自愈        → §9 (Clash Named Pipe + AdsPower 重启)
```

> 写脚本前对照这 5 行。如果你想"试试别的方式"，先回来把 §0~§9 读完再说。

---

## ⚠️ 三条铁律（先看，否则白忙）

| # | 铁律 | 原因 |
|---|------|------|
| 1 | **Prompt 输入必须走 CDP（Playwright `locator.fill()` 或 AdsPower MCP `fill-input`），不能用 `document.execCommand`** | Slate.js 不认非 trusted 的合成事件，DOM 改了但 React state 不变，generate 按钮不会激活，反复操作还可能让 Flow 客户端崩溃（"Application error: a client-side exception"） |
| 2 | **点击生成按钮必须走 CDP（`locator.click()` 或 `click-element`），不能 `el.click()`** | 同上，React 17+ 检查 `event.isTrusted`，`HTMLElement.click()` 注入的 click 一律忽略 |
| 3 | **文件上传必须走 `page.setInputFiles()`（Playwright/Puppeteer），不能 JS 注入 `input.files`** | 文件输入校验源头是 trusted，需走 CDP `DOM.setFileInputFiles`；纯 JS 即便构造了 `DataTransfer` + 直接调 React `onChange` 也不会触发 Flow 后端的 upload 请求（实测验证） |

> 共同点：**所有写入/点击都要"看起来像真人"**。AdsPower MCP 工具集**没有暴露 setInputFiles**，所以涉及文件上传的场景必须用 §7 的 Playwright CDP 接管方案。

---

## 0. 前置：进入工作台

```
1. open-browser(profile_id)
2. connect-browser-with-ws(wsUrl from step 1)
3. navigate('https://labs.google/fx/tools/flow')
4. 检查 location.href：
     - 含 /fx/tools/flow → 已登录 ✅
     - 被重定向回 /fx 或落到 disabled-account 页 → 账号未登录或被封，停止
5. 进入 project：
     - 已有 project：querySelector('a[href*="/project/"]') → 取 href → navigate
     - 全新 project：click "+ New project" 按钮（位于 page 中央）
```

工作台 URL 模式：`https://labs.google/fx/tools/flow/project/{uuid}`

---

## 1. 选择器表（已实测 2026-05-06）

### 1.1 Prompt 输入框
```yaml
selector: '[data-slate-editor="true"][role="textbox"]'
type: contenteditable DIV (Slate.js)
唯一性: 当前页面仅 1 个
写入: AdsPower fill-input  # 不能 execCommand
清空: fill-input(selector, '')   # 或 selectAll + Backspace press-key
```

### 1.2 "+" 按钮（资产/上传面板入口）
```yaml
xpath: '//button[.//*[normalize-space(text())="add_2"]]'
material_icon: 'add_2'
behavior: 点击后展开 role=dialog 资产面板（资产网格 + Upload image 入口）
```

### 1.3 资产面板里的 "Upload image" 入口
```yaml
xpath: '//div[normalize-space(text())="Upload image"]/parent::div'
type: 普通 DIV，cursor:pointer，不是 button
behavior: 程序化触发 body 级隐藏 file input
```

### 1.4 隐藏文件 input（推荐直接喂这里，绕过菜单）
```yaml
selector: 'input[type="file"][accept="image/*"]'
唯一性: 当前页面仅 1 个
attrs: { accept: 'image/*', multiple: true }
upload: setInputFiles(selector, [path])  # CDP only
```

### 1.5 首次上传协议确认（Notice）
```yaml
detect: '[role="dialog"][data-state="open"] h2 == "Notice"'
agree_xpath: '//div[@role="dialog"][@data-state="open"]//button[normalize-space(text())="I agree"]'
cancel_xpath: '//div[@role="dialog"][@data-state="open"]//button[normalize-space(text())="Cancel"]'
副作用: 同意后会清空当前文件队列 → 必须再次 setInputFiles 重传
出现频率: 每个账号首次上传一次（之后记忆，但偶尔重新弹）
```

### 1.6 生成按钮
```yaml
xpath: '//button[.//*[normalize-space(text())="arrow_forward"]]'
material_icon: 'arrow_forward'
hover_label: 'Create'
位置: 输入框右下，32×32 圆形
状态判断:
  enabled: btn.disabled === false && opacity === '1'
  灰色: prompt 为空时按钮 opacity ≈ 0.5
点击: AdsPower click-element  # 不能 el.click()
```

### 1.7 模型/数量选择按钮（可选）
```yaml
xpath: '//button[contains(., "Nano Banana Pro") or contains(., "Veo")]'
text_pattern: '<emoji> <model_name> crop_<aspect> x<count>'
behavior: 点击后展开模型选择 dropdown
默认: Nano Banana Pro × 4 (9:16 aspect)
```

---

## 2. 结果区元素（生成完成后）

### 2.1 结果图（多张）
```yaml
selector: 'img[alt="Generated image"]'
src_pattern: '/fx/api/trpc/media.getMediaUrlRedirect?name={UUID}'
crossorigin: 'anonymous'
数量: 等于模型设置的输出数（默认 x4）
卡片包裹: 'img.closest("[role=button][aria-roledescription=draggable]")'
```

**🚀 快速下载捷径**：直接拼 URL 取原图，跳过整个 hover→More→Download 流程：
```
GET https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name={UUID}
带上当前会话 cookie 即可，返回 302 重定向到真实 storage URL
```

### 2.2 Hover 工具栏（hover 卡片才出现）
```yaml
父容器: '[role="button"][aria-roledescription="draggable"]'
buttons:
  - icon: favorite        # 收藏
    text: 'favorite\nFavorite'
  - icon: redo            # 复用 prompt 重生成
    text: 'redo\nReuse prompt'
  - icon: more_vert       # 三点菜单（下载入口）
    text: 'more_vert\nMore'
    aria_haspopup: 'menu'
触发: hover-element('img[alt="Generated image"]')
```

### 2.3 More (⋮) 菜单（12 项）
```yaml
trigger_xpath: '//button[.//*[normalize-space(text())="more_vert"]]'
container: '[role="menu"][data-state="open"]'
menu_id_pattern: 'radix-:r{N}:'
items:
  - 'Animate'           # 动画化（生成视频）
  - 'Add to Prompt'     # 加入 prompt 作引用
  - 'Favorite'
  - 'Download'          # ← 下载入口（嵌套子菜单）
  - 'Share'
  - 'Reuse Prompt'
  - 'Flag Output'
  - 'Set Project Cover'
  - 'Rename'
  - 'Cut'
  - 'Copy'
  - 'Archive'
generic_item_xpath: '//div[@role="menu"][@data-state="open"]//*[@role="menuitem"][contains(., "{LABEL}")]'
```

### 2.4 Download 子菜单（3 档）
```yaml
parent: '//*[@role="menuitem"][contains(., "Download")]'
parent_attrs: { tag: DIV, aria-haspopup: 'menu', aria-expanded: 'false' }
trigger: hover 父项 → 子菜单展开（Radix sub-menu pattern）
items:
  - label: '1K'
    desc: 'Original size'
    xpath: '//*[@role="menuitem"][.//*[text()="1K"]]'
  - label: '2K'
    desc: 'Upscaled'
    xpath: '//*[@role="menuitem"][.//*[text()="2K"]]'
  - label: '4K'
    desc: 'Upscaled'
    xpath: '//*[@role="menuitem"][.//*[text()="4K"]]'
点击后行为: 浏览器原生下载（Content-Disposition: attachment）
建议: ULTRA 账号选 4K，普通选 1K
```

---

## 3. 标准操作流程（cheat sheet）

### 3.1 文生图（无参考图）
```python
1. open-browser → connect → navigate(/fx/tools/flow)
2. 点入项目（querySelector('a[href*="/project/"]') 或 New project）
3. fill-input('[data-slate-editor="true"]', prompt_text)
4. 等 generate 按钮 opacity === 1   (~50ms)
5. 给生成按钮临时打 tag：
     evaluate-script: 找到 //button[.//text()="arrow_forward"]，setAttribute('data-bot-tag','gen')
6. click-element('button[data-bot-tag="gen"]')
7. 轮询直到 4 张 img[alt="Generated image"] 出现
8. 取 src 中 ?name= 参数 → 拼 /fx/api/trpc/media.getMediaUrlRedirect?name={UUID} 直接 fetch
   或 走 hover → more_vert → Download → 4K
```

### 3.2 图生图（带参考图）
```python
1. ~3 同上
2. 上传图：
     a. setInputFiles('input[type="file"][accept="image/*"]', [path])
     b. 检查是否出现 [role="dialog"] h2="Notice"
        → 若有：click 'I agree' → 重新 setInputFiles
3. fill-input prompt
4. 等缩略图出现在输入框上方（图片预览） + generate enabled
5. ~6-8 同上
```

### 3.3 下载结果（UI 路径）
```python
1. hover-element('img[alt="Generated image"]:nth-of-type(N)')   # N = 第几张
2. evaluate-script: 给该卡片的 more_vert 按钮打 tag data-bot-tag="more"
3. click-element('button[data-bot-tag="more"]')
4. evaluate-script: 给 menuitem "Download" 打 tag data-bot-tag="dl"
5. hover-element('[data-bot-tag="dl"]')   # 触发子菜单
6. evaluate-script: 给 1K/2K/4K 子项打 tag
7. click-element 选定档位 → 浏览器开始下载
```

### 3.4 下载结果（API 捷径，推荐）
```python
1. evaluate-script:
     Array.from(document.querySelectorAll('img[alt="Generated image"]')).map(i => i.src)
2. 拿 cookie：调用 AdsPower 的 get-profile-cookies
3. fetch(src, {headers: {Cookie: ...}}) → 写文件
速度比 UI 路径快 10×，且不依赖 hover/menu 时序
```

---

## 4. 已知坑点 & 应对

| 坑 | 表现 | 应对 |
|---|------|------|
| 用 execCommand 写 Slate | DOM 看着对，但 generate 按钮始终灰色 | 改用 fill-input |
| 用 `el.click()` 提交 | 一切静悄悄，无任何反馈 | 改用 click-element |
| 用 JS `input.files=dt.files` | change 事件触发，但 React 没反应 | 改用 setInputFiles |
| 同一会话多次注入合成事件 | Flow 客户端崩溃 "Application error: a client-side exception" | 整页 reload，避免混用注入 + CDP |
| 首次上传莫名失败 | 文件被吞，缩略图不出现 | 检查 Notice 对话框，agree 后重传 |
| Account disabled | 进 Flow 看到 "Your account has been disabled" | 该 AdsPower 环境的 Google 账号已被封，换号或换环境 |
| Class 名形如 `sc-xxxxxxxx-N hashName` | 每次发版变 | 一律不用，改 data-* / role / contenteditable / icon text |

---

## 5. 关键 URL 速查

| 用途 | URL |
|------|-----|
| Flow 入口 | `https://labs.google/fx/tools/flow` |
| 项目工作台 | `https://labs.google/fx/tools/flow/project/{uuid}` |
| 媒体取回（带 cookie） | `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name={uuid}` |
| Labs FX 首页 | `https://labs.google/fx` |
| 账号被封提示页 | `https://accounts.google.com/...` (重定向) |

---

## 6. 给 tag 的小技巧

由于 click-element / hover-element 只接 CSS 选择器，而很多按钮没有稳定 CSS（只能 XPath 定位），**通用模式**：

```js
// 1. evaluate-script: 用 XPath 找元素，setAttribute('data-bot-tag', 'unique-name')
// 2. click-element / hover-element: '[data-bot-tag="unique-name"]'
// 3. 操作完后清掉 tag（可选）
```

完整示例（点生成按钮）：
```js
// Step 1
const btn = document.evaluate(
  '//button[.//*[normalize-space(text())="arrow_forward"]]',
  document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
).singleNodeValue;
btn.setAttribute('data-bot-tag', 'gen');
```
然后调 `click-element('button[data-bot-tag="gen"]')`。

---

## 7. 参考实现：Node + Playwright CDP（推荐主路径）

> AdsPower MCP 工具集**没有暴露 `setInputFiles`**，所以涉及文件上传的场景必须用 Playwright 直接接管 AdsPower 启动的浏览器。
> 这一节的脚本是 2026-05-06 实测跑通的权威实现，**47 秒完成**带参考图的全流程抽卡 + 4 张 PNG 落盘。

### 7.1 准备依赖（一次性）

工作目录：`<project>/抽卡输出/`（或任意目录）

`package.json`：
```json
{
  "name": "flow-runner",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "dependencies": {
    "playwright-core": "^1.59.1"
  }
}
```

```powershell
npm install playwright-core --no-audit --no-fund
```

> 用 `playwright-core` 而不是 `playwright`：前者不会下载 Chromium browsers，因为我们接管的是 AdsPower 的 Chrome，不需要本地浏览器。

### 7.2 脚本 `flow_run.mjs`

```javascript
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const WS = process.env.WS;                          // ← 从 AdsPower MCP get-opened-browser 拿
const PROJECT_URL = process.env.PROJECT_URL;        // ← 工作台项目 URL
const REF_IMG = process.env.REF_IMG;                // ← 参考图绝对路径（可选，留空则不上传）
const OUT_DIR = process.env.OUT_DIR ?? '.';
const PROMPT = process.env.PROMPT;
const EXPECT_COUNT = parseInt(process.env.EXPECT_COUNT ?? '4', 10);  // 默认 Banana Pro x4

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }

const browser = await chromium.connectOverCDP(WS);
const ctx = browser.contexts()[0];
const pages = ctx.pages();
let page = pages.find(p => p.url().includes('labs.google')) ?? pages[0] ?? await ctx.newPage();
await page.bringToFront();

// reload 拿到干净的 React 状态（注入残留可能让 Flow 客户端崩溃）
await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-slate-editor="true"]', { timeout: 30000 });
log('工作台加载完成');

const baseline = await page.locator('img[alt="Generated image"]').count();
log(`基线已有 ${baseline} 张图`);

// === Skill 铁律 #3: 上传参考图（可选）===
if (REF_IMG) {
  const fileInput = page.locator('input[type="file"][accept="image/*"]');
  await fileInput.setInputFiles(REF_IMG);
  log('参考图已喂入 file input');

  // Notice 对话框（首次/会话偶尔弹）
  try {
    const agreeBtn = page.locator('div[role="dialog"][data-state="open"] button:has-text("I agree")');
    await agreeBtn.waitFor({ state: 'visible', timeout: 3000 });
    await agreeBtn.click();
    log('Notice 已同意，重新喂文件（agree 会清空文件队列）');
    await fileInput.setInputFiles(REF_IMG);
  } catch { log('未弹 Notice'); }

  await page.waitForTimeout(2500);  // 等缩略图渲染
}

// === Skill 铁律 #1: prompt 用 fill (CDP keyboard，trusted) ===
const promptBox = page.locator('[data-slate-editor="true"][role="textbox"]');
await promptBox.click();
await promptBox.fill(PROMPT);
log(`prompt 已写入: "${PROMPT.slice(0, 50)}..."`);

// === Skill 铁律 #2: 生成按钮用 Playwright click (CDP，trusted) ===
const genBtn = page.locator('button').filter({ hasText: 'arrow_forward' }).first();
await genBtn.waitFor({ state: 'visible' });
await genBtn.click();
log('生成按钮已点击，等待结果...');

// 等 baseline + N 张图出现
const targetCount = baseline + EXPECT_COUNT;
await page.waitForFunction(
  (n) => document.querySelectorAll('img[alt="Generated image"]').length >= n,
  targetCount,
  { timeout: 180000 }
);
await page.waitForTimeout(1500);  // 多等让所有 onload
log(`✅ 共 ${await page.locator('img[alt="Generated image"]').count()} 张图`);

// 取最新 N 张的 src（DOM 顺序，最新在前）
const allSrcs = await page.locator('img[alt="Generated image"]').evaluateAll(els => els.map(e => e.src));
const newSrcs = allSrcs.slice(0, EXPECT_COUNT);

// === Skill §3.4 API 捷径下载（ctx.request.get 自动带 cookie）===
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const savedPaths = [];
for (let i = 0; i < newSrcs.length; i++) {
  const url = new URL(newSrcs[i], 'https://labs.google').href;
  const resp = await ctx.request.get(url);
  const buf = await resp.body();
  const m = newSrcs[i].match(/name=([0-9a-f-]+)/);
  const uuid = m ? m[1].slice(0, 8) : `idx${i}`;
  const dest = join(OUT_DIR, `${ts}_card${i+1}_${uuid}.png`);
  await writeFile(dest, buf);
  savedPaths.push(dest);
  log(`💾 ${dest.split(/[\\/]/).pop()} (${(buf.length/1024).toFixed(1)} KB)`);
}

console.log('\n--- SAVED ---');
savedPaths.forEach(p => console.log(p));

await browser.close();   // 注意：connectOverCDP 模式下 close() 只 disconnect，不杀 AdsPower 浏览器
```

### 7.3 运行

```powershell
# 1. AdsPower 启动环境（如果没启动）
#    通过 MCP: open-browser(profile_id) → connect-browser-with-ws(wsUrl)
#    或 AdsPower 客户端手动启动

# 2. 拿当前 ws URL
#    通过 MCP: get-opened-browser → 取 ws.puppeteer

# 3. 跑脚本
$env:WS = 'ws://127.0.0.1:14265/devtools/browser/<uuid>'
$env:PROJECT_URL = 'https://labs.google/fx/tools/flow/project/<project-uuid>'
$env:REF_IMG = 'D:\path\to\reference.png'   # 留空跳过上传
$env:PROMPT = 'a glowing magical seed in a glass bottle, fantasy illustration'
$env:OUT_DIR = 'D:\A-------------xiangmu------------A\换品牌\抽卡输出'
$env:EXPECT_COUNT = '4'
node flow_run.mjs
```

### 7.4 实测耗时分布（2026-05-06）

| 阶段 | 耗时 |
|------|------|
| `connectOverCDP` + 工作台 reload | 3s |
| `setInputFiles` 上传 | <1s |
| Notice 对话框处理 + 重传 | 3s |
| `promptBox.fill()` | 1s |
| `genBtn.click()` | <1s |
| **Banana Pro × 4 服务端生成** | **33s** |
| `ctx.request.get()` × 4 下载 | 8s |
| **合计** | **~47s** |

文件大小：单张 PNG 720~1120 KB（1024×1820，PNG 透明）

### 7.5 切换模型 / 改 x 数

- 本脚本默认抓 **DOM 中前 N 张** `img[alt="Generated image"]`，N 由 `EXPECT_COUNT` 控制
- 切换 Veo（视频）模型：要先点开 "🍌 Nano Banana Pro" 那个按钮选别的模型（这部分**未实测**），且结果可能是 `<video>` 而非 `<img>`，需要改 selector
- 切 x1 / x2 / x3：在同一模型菜单里改 batch size，脚本里 `EXPECT_COUNT` 跟着改

---

## 8. 视频生成（Veo）流程

> 📌 用户口语 "Veo3" 实指 **Veo 3.1**（2026 年的产品迭代版本）。
> 整个流程跟图片生成共用：prompt 框 / 生成按钮 / file input / 资产 picker。区别只在 **底部模型/参数 popover 切到 Video tab** 后会冒出一组新控件 + 主页 prompt 区会从一个"+"按钮变成 **Start / End** 两个首末帧槽位。

### 8.1 进入视频模式（关键改动：底部 popover）

底部那个模型/参数摘要按钮（图片模式显示 "🍌 Nano Banana Pro / x4"，视频模式显示 "Video / 4s / 1x"）：

```yaml
config_button:
  selector: 'button[aria-haspopup="menu"]'   # 在 prompt 输入框右侧、底部 50px 内的那个
  evaluate_locate: |
    Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'))
      .find(b => /Nano Banana Pro|Veo|Video/.test(b.innerText) && b.getBoundingClientRect().y > 1000)
```

打开后是一个 `[role="menu"][data-state="open"]` 容器，里面有：

```yaml
top_tabs:
  image: '[role="tab"]:has-text("Image")'   # 切回图片模式
  video: '[role="tab"]:has-text("Video")'   # 切到视频模式 ← 核心

# 切到 Video 后子结构如下：
video_sub_tabs:
  frames:      '[role="tab"]:has-text("Frames")'        # 默认，首末帧模式
  ingredients: '[role="tab"]:has-text("Ingredients")'   # 多参考图组合模式

aspect_ratios:
  '9:16': '[role="tab"][innerText *= "crop_9_16"]'      # 默认
  '16:9': '[role="tab"][innerText *= "crop_16_9"]'

counts:
  '1x':  '[role="tab"][innerText="1x"]'   # 注意：1 没有前缀 'x'
  'x2':  '[role="tab"][innerText="x2"]'
  'x3':  '[role="tab"][innerText="x3"]'
  'x4':  '[role="tab"][innerText="x4"]'   # 默认

durations:
  '4s': '[role="tab"][innerText="4s"]'
  '6s': '[role="tab"][innerText="6s"]'
  '8s': '[role="tab"][innerText="8s"]'    # 默认

model_dropdown_button: 'button[aria-haspopup="menu"]:has-text("Veo")'
```

### 8.2 Veo 模型 5 个变体（点 `model_dropdown_button` 后展开）

```yaml
container: '[role="menu"][data-state="open"]'   # 注意会同时存在 2 个 open menu：外层 popover + 内层 dropdown
items:
  - 'Veo 3.1 - Lite'                                 # 最便宜
  - 'Veo 3.1 - Fast'                                 # 默认 ⭐
  - 'Veo 3.1 - Quality'                              # 最贵质量最好
  - 'Veo 3.1 - Lite [Lower Priority]'                # 便宜但慢
  - 'Veo 3.1 - Fast [Lower Priority] (leaving N/10)' # 便宜但慢，括号里的 N/10 是当前剩余配额
item_xpath: '//div[@role="menuitem"][contains(., "Veo 3.1 - {VARIANT}")]'
注意: 'menuitem 的 tag 是 DIV 不是 button'
```

### 8.2.1 ⚠️ 必须显式切 Frames sub-tab（致命坑）

**Video tab 默认 sub-tab 是 Ingredients，不是 Frames**（或上次留下的状态）。Ingredients 模式下：
- 主页 prompt 区只显示 `+ Create` 按钮（看起来跟 Image 模式像）
- 上传的图进入"参考素材池"作风格参考
- **但 Veo 模型不会把它当首帧用** → 输出视频是纯 prompt 生成

切到 Frames sub-tab 后：
- 主页 prompt 区出现 Start / End 槽位
- 这才是首末帧模式，上传的图作为视频的 frame 0

**永远显式断言 Frames sub-tab 选中**：
```js
const isFrames = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[role="tab"]'))
    .find(t => t.innerText.includes('Frames'))?.getAttribute('aria-selected') === 'true'
);
if (!isFrames) await tagAndClick(el => el.getAttribute('role') === 'tab' && el.innerText.includes('Frames'), 'ft');
```

### 8.3 主页面变化：Start / End 首末帧槽位（仅 Frames 模式可见）

```yaml
start_slot:
  type: '空 DIV，innerHTML="Start"，cursor:pointer'
  size: '50×50'
  evaluate_locate: |
    Array.from(document.querySelectorAll('div'))
      .find(el => el.textContent?.trim() === 'Start' && el.getBoundingClientRect().width === 50)
end_slot:
  类似 Start，文字为 "End"
swap_button:
  xpath: '//button[contains(., "swap_horiz")]'   # 中间的 ⇆ 按钮，交换首末帧

行为:
  点 Start → 打开资产 picker（与 Image 模式 + 按钮同一个 picker）
  picker 里可以：
    - 选已有的某张图作首帧
    - 点 "Upload image"（DIV cursor:pointer）触发文件选择
  picker 内部用的还是同一个全局 file input ('input[type="file"][accept="image/*"]')
  所以自动化路径：点 Start → setInputFiles(全局 input) → 文件落到 Start 槽位
```

### 8.4 视频结果元素（与图片不同的关键点）

```yaml
result_video:
  selector: 'video'
  src_pattern: '/fx/api/trpc/media.getMediaUrlRedirect?name={UUID}'   # 与图片完全一样的 API！
  rect: '通常 0×0（不可见，hover 卡片才渲染）'
  parent_card: '[role="button"][aria-roledescription="draggable"]'    # 与图片同样的卡片包裹

视频卡片的视觉标识:
  - 卡片左上角有 ▶ play_circle_filled 图标
  - 卡片显示的封面图实际是 <img alt="Generated image">（视频首帧的缩略图）
  - 注意：所以 'img[alt="Generated image"]' 在视频生成后会包含视频封面 → 数过滤要靠 video.length 区分

左侧导航栏:
  视频出现后，左侧多一个 ▶ "View videos" 图标按钮
```

### 8.5 视频下载

**API 与图片完全一致**（推荐路径）：

```js
const videos = await page.locator('video').evaluateAll(els => 
  els.map(v => v.src || v.currentSrc)
);
for (const url of videos) {
  const resp = await ctx.request.get(url);
  await writeFile(`...${uuid}.mp4`, await resp.body());
}
```

下载下来是标准 MP4（`ftypisom`），1.5~3 MB / 4s 视频。

UI 路径：与图片一样走 hover → ⋮ More → Download，但子菜单可能是不同的格式（实测时未验证 — 建议优先 API 路径）。

### 8.6 完整上传 + 选图链路（修复版）

实测确认的**正确流程**：

```
1. 顶部 Add Media 按钮 → "Upload image" menuitem
   selector: 'button[aria-haspopup="menu"]' 在右上 (rect.x ~= 992, y < 100)
   item: '[role="menuitem"]:has-text("Upload image")'
2. fileChooser 拦截 + setFiles
3. 装 page.on('response') 监听 '/v1/flow/uploadImage'
   响应 status=200，body 是 JSON: { media: { name: "{NEW_UUID}", projectId, ... } }
   → 取出 uploadedUUID
4. 切 Settings popover → Video tab → ★ Frames sub-tab ★ → 时长/数量/模型
5. 点主页 Start 槽位 → picker 打开
6. 在 picker 内找到 img[src*="{NEW_UUID8位}"] → 走到 cursor:pointer 祖先 (256×56) → click
7. picker 自动关闭，Start 槽位显示缩略图
8. fill prompt + click generate
9. 等 'video' 元素出现 → 取 src → ctx.request.get() 下载 MP4
```

**关键 endpoint 列表**（已抓 HTTP 流量验证）：

| 用途 | URL | Method |
|------|-----|--------|
| 文件上传 | `https://aisandbox-pa.googleapis.com/v1/flow/uploadImage` | POST (multipart/text) |
| 取图/视频 | `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name={UUID}` | GET (302 → GCS) |
| 用户配置 | `/fx/api/trpc/videoFx.getUserSettings` | GET |
| Credits 余额 | `/v1/credits` | GET |
| 前端日志 | `/v1/flow:batchLogFrontendEvents` | POST |

**uploadImage 响应示例**：
```json
{
  "media": {
    "name": "3beb8feb-d76c-419a-a5e1-c28a0d1544dc",
    "projectId": "dae2c667-1bd0-48d8-8d94-8007c4a9013e",
    "workflowId": "...",
    "mediaMetadata": { "createTime": "...", "visibility": "PRIVATE" },
    "image": { "userUploadedImage": { "aspectRatio": "..." } }
  }
}
```

⚠️ **不要被 Toast 文字误导**：页面侧栏的"warning Failed delete_forever Delete image 7%"是**多个元素 innerText 串接**（残留失败记录 + 上传进度 + 工具栏图标文字）。要靠 HTTP 200 + UUID 判断成功，不要靠 toast 正则。

### 8.7 运行方式

```powershell
$env:WS = '...'
$env:PROJECT_URL = '...'
$env:REF_IMG = 'D:\path\to\frame.png'   # 任意尺寸的本地 PNG/JPG
$env:PROMPT = 'the seed glows brighter, slow motion'
$env:MODEL = 'Veo 3.1 - Fast'   # 或 'Veo 3.1 - Quality'
$env:DURATION = '4s'             # 4s / 6s / 8s
$env:COUNT = '1x'                # 1x / x2 / x3 / x4
node flow_veo_run.mjs
```

⚠️ Tab/menuitem 切换不能用 Playwright `locator.click()` + `hasText`（多行文本 + strict mode 找不准），改用 **"evaluate 打 tag → page.click()"** 模式（脚本里封装为 `tagAndClick(predicate, tagName)`）。

### 8.7 成本表 (ULTRA 账号 2026-05-06 实测)

| 配置 | Credits | 实测耗时 |
|------|---------|---------|
| Fast × 1 × 4s | ~5 | **51s 生成 + 70s 总流程** ✅ 实测 |
| Fast × 1 × 8s | ~10 | ~90s 估计 |
| Fast × 4 × 8s | 40 | ~150s 估计 |
| Quality × 1 × 4s | ~15 | 估计 ~120s |
| Quality × 4 × 8s | ~120 | 估计 ~250s |

> 提交前底部会显示 "Generating will use {N} credits"，是绝对真实值。

---

## 附录：本 Skill 的实测记录

### 第一轮（仅 prompt 出图，2026-05-06）
- 走 AdsPower MCP 工具集纯指令
- prompt: `"a tiny pixel-art red flower icon"` → Nano Banana Pro × 4
- 验证了 prompt 输入 / generate 点击 / 结果选择器 / hover toolbar / More 菜单 / Download 子菜单完整链路

### 第二轮（带参考图出图全自动，2026-05-06）✅
- Playwright CDP 接管（§7 脚本）
- prompt: `"a glowing magical seed inside a glass bottle, fantasy illustration..."`
- 参考图: `seed_reference.png` (32×32 占位 PNG)
- 输出: 4 张奇幻插画风魔法瓶种子，720KB ~ 1120KB
- 总耗时 **47s**

### 第三轮（"首帧"+prompt 出视频，2026-05-06）⚠️ 假阳性
- Playwright CDP 接管，模型 Veo 3.1 Fast 4s × 1
- 流程实际错误：**没切 Frames sub-tab**，setInputFiles 把图喂给 Image 模式上下文，Veo 收到的是空首帧
- 输出 MP4 大小 1860 KB —— 后来对比知道这是纯 prompt 视频典型大小
- 当时误以为成功，实际首帧没用上

### 第四轮（真·首帧+prompt 出视频，2026-05-06）✅ 真实通跑
- 同环境，但脚本修复：
  1. 上传走 **顶部 Add Media → Upload image**（不再走 Start picker 内的 Upload image，时序更稳）
  2. 装 `page.on('response')` 拦 `/v1/flow/uploadImage` 拿真实 UUID
  3. **显式切 Frames sub-tab**（之前漏的关键步）
  4. picker 内通过 UUID 选刚上传的图作 Start
- 输出 MP4 **4056 KB / 4s**（vs 第三轮 1860 KB，2.2× 体积，确认带帧引导）
- 总耗时 **88s**：上传 14s + 配置 3s + Start picker 5s + Veo 生成 64s + 下载 2s
- 验证 HTTP 流量：uploadImage 200 OK，body 含 `media.name = {UUID}`
- 验证选择器：选 picker 内任意已上传 UUID 资产做 Start 100% 工作

### 调试反思：为什么第三轮假阳性？
1. 默认 sub-tab 是 Ingredients 不是 Frames，主页面同样有 prompt + + 按钮，肉眼难分辨
2. setInputFiles 在 Ingredients 模式确实成功上传，但走到了"参考素材池"而非"首帧"
3. Veo 模型不消费 Ingredients 池里的图作首帧 → 看起来是"纯 prompt 生成"
4. 第一次拿 Failed toast 时正则匹配整页 innerText，把残留失败记录 + 上传进度 + 工具栏文字误判成"上传失败"
5. 真正抓 HTTP 流量后才发现：**所有 upload 请求都是 200 OK**，所谓"7% 40% Failed"是 UI 视觉错位

教训：**判断成功要看 HTTP/API 响应，不要靠 UI 文字猜**。

---

## 9. 风控处理（节点轮换 + 浏览器重建）

> 当 Flow 真正触发风控（IP 被 Google 标记为可疑）时，前面 §8 那种"假 Failed toast"不算——**真风控的特征是 HTTP 4xx/5xx 响应 + 明确的页面跳转/提示**。这时候靠重试无意义，必须**换 IP + 换指纹**。

### 9.1 风控判别（与 §8 假阳性的区分）

| 类型 | 信号 | 处理 |
|------|------|------|
| 假 Failed（§8） | UI 文字残留拼接 + HTTP 200 + 拿到 UUID | 忽略，按正常路径继续 |
| **真风控** | 满足下列**任意一条** | 走 §9.4 恢复流程 |
|   ① 页面 body innerText 含 `unusual activity` / `Help Center` / `Account has been disabled` / `temporarily blocked` / `verify it's you` |  |  |
|   ② `flowMedia:batchGenerateImages` 等核心 endpoint 返回 4xx/5xx |  |  |
|   ③ 页面跳转到 `accounts.google.com` 验证流 |  |  |
|   ④ `/v1/credits` 拿不到 200（账号侧问题）|  |  |

检测函数（脚本里直接复用）：
```js
async function detectFlowBlock(page) {
  const url = page.url();
  if (url.includes('accounts.google.com')) return { blocked: true, reason: 'redirected to accounts' };
  const txt = await page.evaluate(() => document.body.innerText.slice(0, 5000));
  const patterns = [
    /unusual activity/i,
    /Help Center/i,
    /Account has been disabled/i,
    /temporarily blocked/i,
    /verify it.?s you/i,
    /try again later/i,
  ];
  for (const re of patterns) {
    if (re.test(txt)) return { blocked: true, reason: re.toString() };
  }
  return { blocked: false };
}
```

### 9.2 Clash 节点轮换（Clash Verge Rev：Named Pipe 而非 TCP）

> ⚠️ **Clash Verge Rev 出于安全考虑禁用了 external-controller TCP 端口**。
> 即使在 profile / Merge.yaml 里写 `external-controller: 127.0.0.1:9090`，Verge 在生成运行时配置时会**强制清空成 `''`**，转用 Windows Named Pipe `\\.\pipe\verge-mihomo`。
> 检查方法：`cat %APPDATA%\io.github.clash-verge-rev.clash-verge-rev\clash-verge.yaml | grep external-controller` 应该看到 `external-controller: ''` + `external-controller-pipe: \\.\pipe\verge-mihomo`。
>
> Mihomo 的 RESTful API 协议在 Named Pipe 上完全一致（GET / PUT / 路径 / JSON），只是传输层换了。**且 Named Pipe 默认无 secret**（管道由 Windows ACL 限制为本机进程，已经够安全）。
>
> 若用纯 mihomo / Mihomo Party 等其他客户端，可以走 TCP `http://127.0.0.1:9090`。下面同时给两套实现，根据 `process.env.VERGE_PIPE` 自动切。

**只动 `🚀 节点选择` 这一个组**，其他组（如 `💬 人工智能`）一律不碰。

```js
import net from 'node:net';
import http from 'node:http';

const VERGE_PIPE = process.env.VERGE_PIPE ?? '\\\\.\\pipe\\verge-mihomo';

// Named Pipe HTTP 客户端（mihomo RESTful API over pipe）
function pipeRequest(path, { method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      method, path,
      headers: { 'Host': 'localhost' },
      createConnection: () => net.connect(VERGE_PIPE),
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request(opts, (res) => {
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const PROXY_GROUP = '🚀 节点选择';
const NODE_ROTATION = [
  '🇺🇸 美国01',
  '🇸🇬 新加坡01',
  '🇦🇺 澳大利亚01',
  '🇺🇸 美国02',
  '🇸🇬 新加坡02',
  '🇺🇸 美国03',
  '🇺🇸 美国04',
];
let _nodeIdx = 0;

async function rotateClashNode() {
  const group = encodeURIComponent(PROXY_GROUP);
  const target = NODE_ROTATION[_nodeIdx % NODE_ROTATION.length];
  _nodeIdx++;

  let from = '?';
  try {
    const r = await pipeRequest(`/proxies/${group}`);
    if (r.status === 200) from = JSON.parse(r.body).now ?? '?';
  } catch {}

  const resp = await pipeRequest(`/proxies/${group}`, {
    method: 'PUT',
    body: JSON.stringify({ name: target }),
  });
  if (resp.status !== 204 && resp.status !== 200) {
    throw new Error(`Clash PUT 失败: HTTP ${resp.status} ${resp.body}`);
  }
  const ts = new Date().toISOString();
  console.log(`[${ts}] [Clash] ${from} → ${target}`);
  return { from, to: target, ts };
}
```

**TCP 备用版（用于纯 mihomo / Mihomo Party）**：

```js
const CLASH_API = process.env.CLASH_API ?? 'http://127.0.0.1:9090';
const CLASH_SECRET = process.env.CLASH_SECRET ?? '';
const clashHeaders = CLASH_SECRET ? { 'Authorization': `Bearer ${CLASH_SECRET}` } : {};

async function rotateClashNodeTCP() {
  const group = encodeURIComponent(PROXY_GROUP);
  const target = NODE_ROTATION[_nodeIdx % NODE_ROTATION.length];
  _nodeIdx++;
  let from = '?';
  try {
    const cur = await fetch(`${CLASH_API}/proxies/${group}`, { headers: clashHeaders }).then(r => r.json());
    from = cur.now ?? '?';
  } catch {}
  const resp = await fetch(`${CLASH_API}/proxies/${group}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...clashHeaders },
    body: JSON.stringify({ name: target }),
  });
  if (!resp.ok && resp.status !== 204) throw new Error(`Clash PUT 失败: HTTP ${resp.status}`);
  console.log(`[${new Date().toISOString()}] [Clash] ${from} → ${target}`);
  return { from, to: target };
}
```

**实测验证步骤**：
```js
// 1. ping pipe
const v = await pipeRequest('/version');
// 期望：{ status: 200, body: '{"meta":true,"version":"v1.19.x"}' }

// 2. 列代理组（确认节点名一致）
const g = await pipeRequest(`/proxies/${encodeURIComponent('🚀 节点选择')}`);
// 期望：JSON 含 now / type:"Selector" / all 数组（其中包含 NODE_ROTATION 全部 7 项）

// 3. PUT 切换
const r = await pipeRequest(`/proxies/${encodeURIComponent('🚀 节点选择')}`, {
  method: 'PUT', body: JSON.stringify({ name: '🇺🇸 美国01' })
});
// 期望：HTTP 204 No Content
```

**绝对禁忌**：
- ❌ 不要枚举 `/proxies` 然后切其他组
- ❌ 不要切 `💬 人工智能` 组（那是给 AI API 调用专用的，切它会让 AdsPower 反指纹失效或导致 AI 工具中断）
- ❌ 不要 PUT 到 group 之外的具体节点 endpoint（容易破坏 Clash 状态机）

### 9.3 AdsPower 浏览器重建（新指纹）

直接调 AdsPower local API（默认端口 50325），脚本里走 HTTP 即可，不依赖 MCP：

```js
const ADSPOWER_API = process.env.ADSPOWER_API ?? 'http://local.adspower.net:50325';

async function adspowerStop(profileId) {
  const r = await fetch(`${ADSPOWER_API}/api/v1/browser/stop?user_id=${profileId}`).then(r => r.json());
  if (r.code !== 0) throw new Error(`stop failed: ${r.msg}`);
}

async function adspowerStart(profileId, { newFingerprint = true } = {}) {
  // 选项：headless=0（可见窗口），ip_tab=1（启动时显示 IP）；newFingerprint 设 1 让 AdsPower 用更激进的指纹打散
  const params = new URLSearchParams({
    user_id: profileId,
    open_tabs: '1',
    ip_tab: '0',
    headless: '0',
    new_first_run: newFingerprint ? '1' : '0',  // 让 AdsPower 当作首启动随机化某些指纹位
  });
  const r = await fetch(`${ADSPOWER_API}/api/v1/browser/start?${params}`).then(r => r.json());
  if (r.code !== 0) throw new Error(`start failed: ${r.msg}`);
  return r.data.ws.puppeteer;   // 新 ws URL
}
```

> ⚠️ AdsPower 的"指纹随机化"由 profile 配置决定。要更彻底，先调 `POST /api/v1/user/update` 修改 fingerprint_config（如 random UA / new screen resolution），再 start。一般项目下纯 IP 切换（§9.2）+ 重启 + cdp_mask 已足够洗 IP 风险，不需要每次都改指纹。

### 9.4 完整恢复流程（封装函数）

```js
const MAX_RECOVERY_ATTEMPTS = 3;

async function recoverFromBlock({ profileId, projectUrl, attemptCount = 0, log = console.log }) {
  if (attemptCount >= MAX_RECOVERY_ATTEMPTS) {
    throw new Error(`⛔ 连续 ${MAX_RECOVERY_ATTEMPTS} 次切节点仍风控，请手动处理`);
  }

  log(`[recovery] 第 ${attemptCount + 1}/${MAX_RECOVERY_ATTEMPTS} 次：开始切节点`);
  const rot = await rotateClashNode();
  log(`[recovery] Clash 切到 ${rot.to}（前一个 ${rot.from}）`);

  log(`[recovery] AdsPower 重启 ${profileId}`);
  await adspowerStop(profileId).catch(e => log(`stop 警告: ${e.message}`));
  await new Promise(r => setTimeout(r, 1500));
  const newWs = await adspowerStart(profileId);
  log(`[recovery] 新 ws: ${newWs}`);

  await new Promise(r => setTimeout(r, 5000));   // 等浏览器稳定

  const browser = await chromium.connectOverCDP(newWs);
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.bringToFront();
  await page.goto(projectUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-slate-editor="true"]', { timeout: 30000 }).catch(() => {});

  const status = await detectFlowBlock(page);
  if (status.blocked) {
    log(`[recovery] 还在风控（${status.reason}），递归再切`);
    return recoverFromBlock({ profileId, projectUrl, attemptCount: attemptCount + 1, log });
  }

  log(`[recovery] ✅ 第 ${attemptCount + 1} 次成功，可继续任务`);
  return { browser, ctx, page, ws: newWs };
}
```

### 9.5 集成到批量任务（保持已完成进度）

每次 `submit prompt → wait response` 之后插一次 detect。一旦风控就调 recoverFromBlock，**不重置已完成的 prompt 列表**，从下一个未完成的接着跑：

```js
async function runBatchWithRecovery(prompts, env) {
  let { browser, ctx, page } = await connectInitial(env);
  const done = [];
  const remaining = prompts.slice();

  while (remaining.length > 0) {
    const p = remaining[0];
    try {
      const status = await detectFlowBlock(page);
      if (status.blocked) throw new Error(`blocked: ${status.reason}`);

      const result = await submitOnePrompt(page, ctx, p);
      done.push(result);
      remaining.shift();
    } catch (e) {
      console.log(`[batch] prompt ${p.id} 失败: ${e.message}`);
      if (/blocked|risk|429|403|503/i.test(e.message)) {
        try {
          ({ browser, ctx, page } = await recoverFromBlock({ profileId: env.profileId, projectUrl: env.projectUrl }));
          continue;   // 不 shift，重试当前 prompt
        } catch (recErr) {
          console.error(`[batch] 恢复失败，停手：${recErr.message}`);
          break;
        }
      } else {
        // 非风控错误，标记失败跳过
        done.push({ ...p, ok: false, error: e.message });
        remaining.shift();
      }
    }
  }
  return done;
}
```

### 9.6 日志规范

每次切换都写一行结构化日志，便于事后审计。建议格式：

```
[ISO时间] [recovery] attempt 1/3 | clash: 🇺🇸美国01 → 🇸🇬新加坡01 | adspower: stop+start k1bsgahl | new ws: ws://.../xxx | result: success
```

或落 JSONL 到 `<OUT_DIR>/recovery_log.jsonl`：
```js
import { appendFile } from 'node:fs/promises';
await appendFile(join(OUT_DIR, 'recovery_log.jsonl'), JSON.stringify({
  ts: new Date().toISOString(),
  attempt: attemptCount + 1,
  clashFrom: rot.from,
  clashTo: rot.to,
  profileId,
  newWs,
  result: 'success' | 'still_blocked' | 'failed',
}) + '\n');
```

### 9.7 关键不变量

| 规则 | 说明 |
|------|------|
| **只动 `🚀 节点选择` 组** | 其他 Clash 组（特别是 `💬 人工智能`）绝不触碰 |
| **轮换循环** | 7 个节点循环用，不偏好任一个 |
| **3 次后停手** | `MAX_RECOVERY_ATTEMPTS = 3`。再不行说明账号或全局策略问题，留给人工 |
| **保进度** | 恢复后不重做已完成的 prompt，从下一个未完成的继续 |
| **切节点前先记 from** | `GET /proxies/{group}` 拿 `now` 字段，日志能追溯路径 |
| **AdsPower 重启之间间隔** | stop → 1.5s → start → 5s → connectCDP，缩短会撞 race |
