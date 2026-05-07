import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const WS = process.env.WS;
const PROJECT_URL = 'https://labs.google/fx/tools/flow/project/dae2c667-1bd0-48d8-8d94-8007c4a9013e';
const REF_IMG = 'D:\\A-------------xiangmu------------A\\换品牌\\抽卡输出\\seed_reference.png';
const OUT_DIR = 'D:\\A-------------xiangmu------------A\\换品牌\\抽卡输出';
const PROMPT = 'a glowing magical seed inside a glass bottle, fantasy illustration, ultra-detailed, dark background';

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

const browser = await chromium.connectOverCDP(WS);
const ctx = browser.contexts()[0];
const pages = ctx.pages();
let page = pages.find(p => p.url().includes('labs.google')) ?? pages[0] ?? await ctx.newPage();
await page.bringToFront();
log(`接管页面: ${page.url()}`);

// reload 拿到干净的 React 状态（之前注入残留可能干扰）
await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-slate-editor="true"]', { timeout: 30000 });
log('工作台加载完成');

const baseline = await page.locator('img[alt="Generated image"]').count();
log(`基线已有 ${baseline} 张图`);

// === Skill 铁律 #3: 上传参考图 走 setInputFiles ===
const fileInput = page.locator('input[type="file"][accept="image/*"]');
await fileInput.setInputFiles(REF_IMG);
log('参考图已喂入 file input');

// 处理首次上传 Notice 对话框（同会话已同意过，但保险起见）
try {
  const agreeBtn = page.locator('div[role="dialog"][data-state="open"] button:has-text("I agree")');
  await agreeBtn.waitFor({ state: 'visible', timeout: 3000 });
  await agreeBtn.click();
  log('Notice 对话框已同意，重新喂文件');
  await fileInput.setInputFiles(REF_IMG);
} catch {
  log('未弹出 Notice 对话框（已记忆同意）');
}

// 等缩略图渲染出来
await page.waitForTimeout(2500);

// === Skill 铁律 #1: prompt 用 fill (CDP keyboard, trusted) ===
const promptBox = page.locator('[data-slate-editor="true"][role="textbox"]');
await promptBox.click();
await promptBox.fill(PROMPT);
log(`prompt 已写入: "${PROMPT.slice(0, 50)}..."`);

// === Skill 铁律 #2: 生成按钮用 Playwright click (CDP, trusted) ===
const genBtn = page.locator('button').filter({ hasText: 'arrow_forward' }).first();
await genBtn.waitFor({ state: 'visible' });
await genBtn.click();
log('生成按钮已点击，等待结果...');

// 等 baseline + 4 张图出现（Banana Pro 默认 x4）
const targetCount = baseline + 4;
await page.waitForFunction(
  (n) => document.querySelectorAll('img[alt="Generated image"]').length >= n,
  targetCount,
  { timeout: 180000 }
);
// 多等 1.5s 让 4 张都 onload
await page.waitForTimeout(1500);
log(`✅ 共 ${await page.locator('img[alt="Generated image"]').count()} 张图（含基线 ${baseline}）`);

// 取最新 4 张的 src（按 DOM 顺序，最新在前）
const allSrcs = await page.locator('img[alt="Generated image"]').evaluateAll(
  els => els.map(e => e.src)
);
const newSrcs = allSrcs.slice(0, 4);
log(`新生成 4 张:`);
newSrcs.forEach((s, i) => log(`  [${i+1}] ${s.slice(0, 100)}...`));

// === 走 API 捷径下载 (Skill §3.4) ===
const savedPaths = [];
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
for (let i = 0; i < newSrcs.length; i++) {
  const url = new URL(newSrcs[i], 'https://labs.google').href;
  const resp = await ctx.request.get(url);
  const buf = await resp.body();
  const m = newSrcs[i].match(/name=([0-9a-f-]+)/);
  const uuid = m ? m[1].slice(0, 8) : `idx${i}`;
  const dest = join(OUT_DIR, `${ts}_card${i+1}_${uuid}.png`);
  await writeFile(dest, buf);
  savedPaths.push(dest);
  log(`💾 保存 [${i+1}/4] ${dest.split('\\').pop()} (${(buf.length/1024).toFixed(1)} KB)`);
}

log('🎉 全部完成');
console.log('\n--- SAVED FILES ---');
savedPaths.forEach(p => console.log(p));

await browser.close();
