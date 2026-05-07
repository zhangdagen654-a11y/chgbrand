// Batch 视频生成 v3 — 严格 UUID diff 识别新上传图，绕开 lazy-load 误判
// 流程: snapshot baseline UUID → 上传 → 等 uploadImage 200 → polling 等 DOM 出现"不在 baseline 里的新 UUID" →
//       右键这张新卡片 → Animate（自动 Frames + 设 Start）→ fill prompt → 生成 → 下载
import { chromium } from 'playwright-core';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const WS = process.env.WS;
const PROJECT_URL = process.env.PROJECT_URL ?? 'https://labs.google/fx/tools/flow/project/dae2c667-1bd0-48d8-8d94-8007c4a9013e';
const OUT_DIR = process.env.OUT_DIR ?? 'D:\\A-------------xiangmu------------A\\换品牌\\抽卡输出';
const PROMPTS_FILE = process.env.PROMPTS_FILE ?? join(OUT_DIR, 'veo_prompts.json');
const MODEL = process.env.MODEL ?? 'Veo 3.1 - Fast';
const DURATION = process.env.DURATION ?? '8s';
const COUNT = process.env.COUNT ?? '1x';

const PROMPTS = JSON.parse(await readFile(PROMPTS_FILE, 'utf-8'));
function log(...a) { console.log(`[${new Date().toLocaleTimeString()}]`, ...a); }

// === 工具：DOM 中所有 alt="Generated image" 的 UUID（去 lazy-load 影响要先滚动）===
async function snapshotAllUUIDs(page) {
  // 滚动一遍触发 lazy-load
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  return new Set(await page.evaluate(() =>
    Array.from(document.querySelectorAll('img[alt="Generated image"]'))
      .map(i => i.src.match(/name=([0-9a-f-]+)/)?.[1])
      .filter(Boolean)
  ));
}

async function tagAndClick(page, predicate, tagName, args = {}) {
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

const browser = await chromium.connectOverCDP(WS);
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => p.url().includes('labs.google')) ?? ctx.pages()[0];
await page.bringToFront();
await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-slate-editor="true"]', { timeout: 30000 });
log('工作台加载');

// === 一次性切到 Video / Frames / DURATION / COUNT / MODEL ===
async function ensureVideoFramesMode() {
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
  if (!isVideo) { await tagAndClick(page, el => el.getAttribute('role') === 'tab' && el.innerText.trim().endsWith('Video'), 'vt'); await page.waitForTimeout(500); }
  const isFrames = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="tab"]')).find(t => t.innerText.includes('Frames'))?.getAttribute('aria-selected') === 'true'
  );
  if (!isFrames) { await tagAndClick(page, el => el.getAttribute('role') === 'tab' && el.innerText.includes('Frames'), 'ft'); await page.waitForTimeout(500); }
  await tagAndClick(page, (el, args) => el.getAttribute('role') === 'tab' && el.innerText.trim() === args.text, 'dur', { text: DURATION });
  await page.waitForTimeout(200);
  await tagAndClick(page, (el, args) => el.getAttribute('role') === 'tab' && el.innerText.trim() === args.text, 'cnt', { text: COUNT });
  await page.waitForTimeout(200);
  if (MODEL !== 'Veo 3.1 - Fast') {
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]')).find(b => b.innerText.includes('Veo'));
      b?.setAttribute('data-bot-runtime', 'vmdl');
    });
    await page.click('[data-bot-runtime="vmdl"]');
    await page.waitForTimeout(700);
    await tagAndClick(page, (el, args) => el.getAttribute('role') === 'menuitem' && el.innerText.includes(args.model), 'mitem', { model: MODEL });
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
}
await ensureVideoFramesMode();
log(`模式: Video / Frames / ${DURATION} / ${COUNT} / ${MODEL}`);

// === 装 uploadImage 响应监听 ===
const uploadResps = [];
page.on('response', async (resp) => {
  if (!resp.url().includes('/v1/flow/uploadImage')) return;
  if (resp.status() !== 200) return;
  try {
    const json = await resp.json();
    if (json.media?.name) uploadResps.push({uuid: json.media.name, ts: Date.now()});
  } catch {}
});

const results = [];
for (const p of PROMPTS) {
  log(`\n=== [${p.id}] ${p.slug} ===`);
  log(`  首帧: ${p.image.split(/[\\/]/).pop()}`);

  // [1/6] 上传前 baseline：DOM 中所有现存 UUID（滚动触发 lazy-load）
  const baselineUUIDs = await snapshotAllUUIDs(page);
  log(`  baseline UUID 集合: ${baselineUUIDs.size}`);
  const baselineUploadCount = uploadResps.length;
  const baselineVideos = await page.locator('video').count();

  // [2/6] 上传
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'))
      .find(b => b.innerText.includes('Add Media'));
    btn.setAttribute('data-bot-runtime', 'addmedia');
  });
  await page.click('button[data-bot-runtime="addmedia"]');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(i => i.innerText.includes('Upload image'));
    item.setAttribute('data-bot-runtime', 'upitem');
  });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-bot-runtime="upitem"]'),
  ]);
  await chooser.setFiles(p.image);
  log(`  setFiles 完成`);

  // [3/6] 等 uploadImage HTTP 200（证明 Flow 后端收到了文件）
  const tUp = Date.now();
  while (uploadResps.length === baselineUploadCount && Date.now() - tUp < 30000) {
    await page.waitForTimeout(300);
  }
  if (uploadResps.length === baselineUploadCount) throw new Error(`[${p.id}] uploadImage 响应超时`);
  const uploadTempUUID = uploadResps[uploadResps.length - 1].uuid;
  log(`  uploadImage 200 (临时 UUID: ${uploadTempUUID.slice(0,8)}...)`);

  // Notice 对话框
  try {
    const agreeBtn = page.locator('div[role="dialog"][data-state="open"] button:has-text("I agree")');
    await agreeBtn.click({ timeout: 2500 });
    log(`  Notice agreed`);
  } catch {}

  // [4/6] polling 等"主网格 DOM 中出现一个不在 baseline 里的 UUID"——这就是新图（Flow 重命名后的最终 UUID）
  log(`  等 DOM diff 出现新 UUID（Flow 后端处理 + 入库）...`);
  let newUUID = null;
  const tWait = Date.now();
  const POLL_TIMEOUT = 120000;   // 最长 2 分钟
  while (!newUUID && Date.now() - tWait < POLL_TIMEOUT) {
    await page.waitForTimeout(2500);
    const cur = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img[alt="Generated image"]'))
        .map(i => i.src.match(/name=([0-9a-f-]+)/)?.[1])
        .filter(Boolean)
    );
    const diff = cur.filter(u => !baselineUUIDs.has(u));
    if (diff.length >= 1) {
      // 取 DOM 顺序里最靠前的（即左上角第一张），通常 Flow 把新上传放在最前
      newUUID = diff[0];
      log(`  ✅ 检测到新 UUID: ${newUUID.slice(0,8)} (${((Date.now()-tWait)/1000).toFixed(0)}s, diff size=${diff.length})`);
      break;
    }
  }
  if (!newUUID) throw new Error(`[${p.id}] DOM diff 等待超时，新图未入主网格`);

  // [5/6] 在新图卡片上右键 → Animate
  await page.evaluate((uuid) => {
    const img = document.querySelector(`img[src*="${uuid}"]`);
    const card = img?.closest('[role="button"][aria-roledescription="draggable"]');
    if (!card) throw new Error(`UUID ${uuid} 的可拖拽卡片未找到`);
    card.setAttribute('data-bot-runtime', 'newCard');
  }, newUUID);

  await page.click('[data-bot-runtime="newCard"]', { button: 'right' });
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    const menu = document.querySelector('[role="menu"][data-state="open"]');
    if (!menu) throw new Error('右键菜单未出现');
    const animate = Array.from(menu.querySelectorAll('[role="menuitem"]'))
      .find(i => i.innerText.includes('Animate'));
    if (!animate) throw new Error('未找到 Animate 菜单项');
    animate.setAttribute('data-bot-runtime', 'animateItem');
  });
  await page.click('[data-bot-runtime="animateItem"]');
  await page.waitForTimeout(2500);

  // 验证 Start 槽位
  const startHasImg = await page.evaluate(() => {
    const swap = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('swap_horiz'));
    const region = swap?.parentElement?.parentElement;
    return region ? region.querySelectorAll('img').length >= 1 : false;
  });
  if (!startHasImg) {
    log(`  ⚠️ Animate 后 Start 槽位未显示首帧（仍尝试生成，但可能没用上图）`);
  } else {
    log(`  ✅ Animate → Start 槽位已设首帧 ${newUUID.slice(0,8)}`);
  }

  // [6/6] fill prompt + 点生成 + 等 video + 下载
  const promptBox = page.locator('[data-slate-editor="true"][role="textbox"]');
  await promptBox.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await promptBox.fill(p.text);
  await page.waitForFunction(() => {
    const b = Array.from(document.querySelectorAll('button')).find(b => b.innerText.startsWith('arrow_forward'));
    return b && !b.disabled && getComputedStyle(b).opacity === '1';
  }, null, { timeout: 30000 });
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(b => b.innerText.startsWith('arrow_forward'));
    b.setAttribute('data-bot-runtime', 'gen-current');
  });
  await page.click('[data-bot-runtime="gen-current"]');
  log(`  生成已点击，等视频...`);

  const tGen = Date.now();
  await page.waitForFunction(
    (n) => document.querySelectorAll('video').length > n,
    baselineVideos,
    { timeout: 300000 }
  );
  await page.waitForTimeout(4000);
  const elapsed = ((Date.now() - tGen) / 1000).toFixed(0);
  log(`  ✅ 视频出现 (${elapsed}s)`);

  const newVideoSrc = await page.evaluate(() => {
    const v = document.querySelector('video');
    return v?.src || v?.currentSrc || null;
  });
  if (!newVideoSrc) { log(`  ❌ 未取到 video src`); results.push({...p, ok: false}); continue; }
  const url = new URL(newVideoSrc, 'https://labs.google').href;
  const resp = await ctx.request.get(url);
  const buf = await resp.body();
  const m = newVideoSrc.match(/name=([0-9a-f-]+)/);
  const uuid = m ? m[1] : 'unknown';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = join(OUT_DIR, `${ts}_v${p.id}_${p.slug}_${uuid.slice(0,8)}.mp4`);
  await writeFile(dest, buf);
  log(`  💾 ${dest.split(/[\\/]/).pop()} (${(buf.length/1024).toFixed(0)} KB)`);
  results.push({...p, ok: true, file: dest, size: buf.length, uuid, elapsed: Number(elapsed), firstFrameUUID: newUUID});
}

console.log('\n=== 总结 ===');
results.forEach(r => {
  if (r.ok) console.log(`✅ [${r.id}] ${r.slug.padEnd(24)} ${(r.size/1024).toFixed(0).padStart(5)} KB  ${r.elapsed}s  首帧=${r.firstFrameUUID?.slice(0,8)} → 视频=${r.uuid?.slice(0,8)}`);
  else console.log(`❌ [${r.id}] ${r.slug}`);
});
await browser.close();
log('🎉 批次完成');
