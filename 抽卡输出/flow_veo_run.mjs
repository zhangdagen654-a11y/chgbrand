// Flow Veo 视频抽卡（修复版）
// 流程：上传图 → 拦响应取 UUID → 切 Video Frames → 点 Start picker → 选新 UUID 作首帧 → prompt → 生成 → 下载视频
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const WS = process.env.WS;
const PROJECT_URL = process.env.PROJECT_URL ?? 'https://labs.google/fx/tools/flow/project/dae2c667-1bd0-48d8-8d94-8007c4a9013e';
const REF_IMG = process.env.REF_IMG ?? 'D:\\A-------------xiangmu------------A\\换品牌\\抽卡输出\\2026-05-06T07-59-17_card1_9f065b69.png';
const OUT_DIR = process.env.OUT_DIR ?? 'D:\\A-------------xiangmu------------A\\换品牌\\抽卡输出';
const PROMPT = process.env.PROMPT ?? 'the seed glows brighter and pulses with magic energy, slow motion';
const MODEL = process.env.MODEL ?? 'Veo 3.1 - Fast';
const DURATION = process.env.DURATION ?? '4s';
const COUNT = process.env.COUNT ?? '1x';

function log(...a) { console.log(`[${new Date().toLocaleTimeString()}]`, ...a); }

const browser = await chromium.connectOverCDP(WS);
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => p.url().includes('labs.google')) ?? ctx.pages()[0];
await page.bringToFront();

await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-slate-editor="true"]', { timeout: 30000 });
log('工作台加载完成');

// === 装 uploadImage 响应拦截器 ===
let uploadedUUID = null;
page.on('response', async (resp) => {
  if (!resp.url().includes('/v1/flow/uploadImage')) return;
  if (resp.status() !== 200) return;
  try {
    const json = await resp.json();
    if (json.media?.name) {
      uploadedUUID = json.media.name;
      log(`✅ uploadImage 响应捕获 UUID: ${uploadedUUID}`);
    }
  } catch {}
});

async function tagAndClick(predicate, tagName, args = {}) {
  const found = await page.evaluate(({pred, tag, args}) => {
    const fn = new Function('el', 'args', `return (${pred})(el, args)`);
    const all = Array.from(document.querySelectorAll('button, [role="tab"], [role="menuitem"], div'));
    const el = all.find(e => fn(e, args));
    if (!el) return false;
    el.setAttribute('data-bot-runtime', tag);
    return true;
  }, { pred: predicate.toString(), tag: tagName, args });
  if (!found) throw new Error(`tagAndClick: ${tagName} not found`);
  await page.click(`[data-bot-runtime="${tagName}"]`);
}

// === 1. 上传参考图（走顶部 Add Media，独立的资产上传流程）===
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'))
    .find(b => b.innerText.includes('Add Media'));
  btn.setAttribute('data-bot-runtime', 'addmedia');
});
await page.click('button[data-bot-runtime="addmedia"]');
await page.waitForTimeout(800);
await page.evaluate(() => {
  const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
    .find(i => i.innerText.includes('Upload image'));
  item.setAttribute('data-bot-runtime', 'upitem');
});
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.click('[data-bot-runtime="upitem"]'),
]);
await chooser.setFiles(REF_IMG);
log('参考图已 setFiles，等 uploadImage 响应...');

// 处理首次 Notice
try {
  const agreeBtn = page.locator('div[role="dialog"][data-state="open"] button:has-text("I agree")');
  await agreeBtn.click({ timeout: 4000 });
  log('Notice agreed (此后会重传)');
} catch {}

// 等 UUID（最长 20s）
const tStart = Date.now();
while (!uploadedUUID && Date.now() - tStart < 20000) await page.waitForTimeout(300);
if (!uploadedUUID) throw new Error('uploadImage 响应未到，上传失败');
log(`✅ 上传 UUID: ${uploadedUUID}`);
await page.waitForTimeout(2000);

// === 2. 切 Video → Frames sub-tab ===
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'))
    .find(b => /Nano Banana Pro|Veo|Video/.test(b.innerText) && b.getBoundingClientRect().y > 1000);
  btn.setAttribute('data-bot-runtime', 'cfg');
});
await page.click('button[data-bot-runtime="cfg"]');
await page.waitForSelector('[role="menu"][data-state="open"]');

const isVideo = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[role="tab"]')).find(t => t.innerText.trim().endsWith('Video'))?.getAttribute('aria-selected') === 'true'
);
if (!isVideo) {
  await tagAndClick(el => el.getAttribute('role') === 'tab' && el.innerText.trim().endsWith('Video'), 'vt');
  await page.waitForTimeout(500);
}
const isFrames = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[role="tab"]')).find(t => t.innerText.includes('Frames'))?.getAttribute('aria-selected') === 'true'
);
if (!isFrames) {
  await tagAndClick(el => el.getAttribute('role') === 'tab' && el.innerText.includes('Frames'), 'ft');
  await page.waitForTimeout(500);
}
// duration / count
await tagAndClick(
  (el, args) => el.getAttribute('role') === 'tab' && el.innerText.trim() === args.text,
  'dur', { text: DURATION }
);
await page.waitForTimeout(200);
await tagAndClick(
  (el, args) => el.getAttribute('role') === 'tab' && el.innerText.trim() === args.text,
  'cnt', { text: COUNT }
);
await page.waitForTimeout(200);
// 模型 (默认 Fast 不切)
if (MODEL !== 'Veo 3.1 - Fast') {
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]')).find(b => b.innerText.includes('Veo'));
    b?.setAttribute('data-bot-runtime', 'vmdl');
  });
  await page.click('[data-bot-runtime="vmdl"]');
  await page.waitForTimeout(700);
  await tagAndClick(
    (el, args) => el.getAttribute('role') === 'menuitem' && el.innerText.includes(args.model),
    'mitem', { model: MODEL }
  );
  log(`模型 → ${MODEL}`);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
log(`Video Frames + ${MODEL} + ${DURATION} + ${COUNT}`);

// === 3. 点 Start 打开 picker ===
await page.evaluate(() => {
  const startDiv = Array.from(document.querySelectorAll('div'))
    .find(el => el.textContent?.trim() === 'Start' && el.getBoundingClientRect().width === 50);
  startDiv.setAttribute('data-bot-runtime', 'startSlot');
});
await page.click('div[data-bot-runtime="startSlot"]');
await page.waitForTimeout(1500);
log('Start picker 已打开');

// === 4. 选刚上传的 UUID 作首帧 ===
const uuidShort = uploadedUUID.slice(0, 8);
await page.evaluate((uuid) => {
  const dlg = document.querySelector('[role="dialog"][data-state="open"]');
  const img = dlg.querySelector(`img[src*="${uuid}"]`);
  if (!img) throw new Error(`picker 内没找到 UUID ${uuid}`);
  let cur = img.parentElement;
  for (let i = 0; i < 8 && cur; i++) {
    const r = cur.getBoundingClientRect();
    if (getComputedStyle(cur).cursor === 'pointer' && r.width > 100 && r.width < 400) {
      cur.setAttribute('data-bot-runtime', 'pickItem');
      return;
    }
    cur = cur.parentElement;
  }
  throw new Error('找不到可点击祖先');
}, uuidShort);
await page.click('[data-bot-runtime="pickItem"]');
await page.waitForTimeout(2000);
log('已选新上传图作 Start');

// 验证 Start 槽位接收成功
const startOK = await page.evaluate(() => {
  const swap = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('swap_horiz'));
  const region = swap?.parentElement?.parentElement;
  return region ? region.querySelectorAll('img').length : 0;
});
if (startOK < 1) throw new Error('Start 槽位未接收图');
log('✅ Start 槽位已显示首帧缩略图');

// === 5. 写 prompt + 生成 ===
const promptBox = page.locator('[data-slate-editor="true"][role="textbox"]');
await promptBox.click();
await promptBox.fill(PROMPT);
log(`prompt: "${PROMPT}"`);

const baselineVids = await page.locator('video').count();
const genBtn = page.locator('button').filter({ hasText: 'arrow_forward' }).first();
await genBtn.waitFor({ state: 'visible' });
await genBtn.click();
log('生成按钮已点击，等视频...');

// === 6. 等结果 ===
await page.waitForFunction(
  ({bV}) => document.querySelectorAll('video').length > bV,
  { bV: baselineVids },
  { timeout: 300000 }
);
await page.waitForTimeout(4000);
log('视频已生成');

// === 7. 下载视频 ===
const newSrcs = await page.locator('video').evaluateAll((els, baselineCount) => {
  // DOM 中视频按生成顺序排列，最新在前
  return els.slice(0, els.length - baselineCount).map(v => v.src || v.currentSrc).filter(Boolean);
}, baselineVids);

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const saved = [];
for (let i = 0; i < newSrcs.length; i++) {
  const url = new URL(newSrcs[i], 'https://labs.google').href;
  const resp = await ctx.request.get(url);
  const buf = await resp.body();
  const m = newSrcs[i].match(/name=([0-9a-f-]+)/);
  const uuid = m ? m[1].slice(0, 8) : `idx${i}`;
  const dest = join(OUT_DIR, `${ts}_video${i+1}_${uuid}.mp4`);
  await writeFile(dest, buf);
  saved.push(dest);
  log(`💾 ${dest.split(/[\\/]/).pop()} (${(buf.length/1024).toFixed(1)} KB)`);
}

console.log('\n--- SAVED ---');
saved.forEach(p => console.log(p));
log('🎉 完成');
await browser.close();
