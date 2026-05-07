// Batch 并行生图（v2，HTTP 响应配对 UUID 严格保证）
import { chromium } from 'playwright-core';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const WS = process.env.WS;
const PROJECT_URL = process.env.PROJECT_URL ?? 'https://labs.google/fx/tools/flow/project/dae2c667-1bd0-48d8-8d94-8007c4a9013e';
const OUT_DIR = process.env.OUT_DIR ?? 'D:\\A-------------xiangmu------------A\\换品牌\\抽卡输出';
const PROMPTS_FILE = process.env.PROMPTS_FILE ?? 'D:\\A-------------xiangmu------------A\\换品牌\\抽卡输出\\prompts.json';

const PROMPTS = JSON.parse(await readFile(PROMPTS_FILE, 'utf-8'));
function log(...a) { console.log(`[${new Date().toLocaleTimeString()}]`, ...a); }

const browser = await chromium.connectOverCDP(WS);
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => p.url().includes('labs.google')) ?? ctx.pages()[0];
await page.bringToFront();

await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-slate-editor="true"]', { timeout: 30000 });
log('工作台加载完成');

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

// === 切到 Image + 1x + 9:16 ===
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'))
    .find(b => /Nano Banana Pro|Veo|Video/.test(b.innerText) && b.getBoundingClientRect().y > 1000);
  btn.setAttribute('data-bot-runtime', 'cfg');
});
await page.click('button[data-bot-runtime="cfg"]');
await page.waitForSelector('[role="menu"][data-state="open"]');
const isImage = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[role="tab"]')).find(t => t.innerText.trim().endsWith('Image'))?.getAttribute('aria-selected') === 'true'
);
if (!isImage) {
  await tagAndClick(el => el.getAttribute('role') === 'tab' && el.innerText.trim().endsWith('Image'), 'imgtab');
  await page.waitForTimeout(500);
}
await tagAndClick((el, args) => el.getAttribute('role') === 'tab' && el.innerText.trim() === args.text, 'cnt', { text: '1x' });
await page.waitForTimeout(300);
await page.evaluate(() => {
  const a = Array.from(document.querySelectorAll('[role="tab"]')).find(t => t.innerText.includes('crop_9_16'));
  if (a && a.getAttribute('aria-selected') !== 'true') a.click();
});
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
log('已切到 Image + 1x + 9:16');

// === 装 batchGenerateImages 响应监听器（核心：严格配对 UUID）===
const pendingResponses = [];   // FIFO 队列
const responsePromises = [];   // 每个 prompt 一个 promise

page.on('response', async (resp) => {
  if (!resp.url().includes('flowMedia:batchGenerateImages')) return;
  if (resp.status() !== 200) {
    log(`⚠️ batchGenerateImages 失败: HTTP ${resp.status()}`);
    return;
  }
  try {
    const json = await resp.json();
    const uuid = json.media?.[0]?.name;
    if (uuid) {
      pendingResponses.push({uuid, ts: Date.now()});
      // 触发等待中的下一个 promise resolver
      const next = responsePromises.shift();
      if (next) next.resolve(uuid);
    }
  } catch (e) {
    log(`响应解析失败: ${e.message}`);
  }
});

// === 并行提交：依次 fill+click，立即装 promise 等响应 ===
const promptBox = page.locator('[data-slate-editor="true"][role="textbox"]');
log(`并行提交 ${PROMPTS.length} 个 prompt...`);

const promptToUUIDPromises = [];
for (const p of PROMPTS) {
  // 装一个 promise，等下一个 batchGenerateImages 响应
  let resolveFn;
  const promise = new Promise(r => resolveFn = r);
  // 如果已有 pending 响应没人取，立刻消费一个
  if (pendingResponses.length > 0) {
    resolveFn(pendingResponses.shift().uuid);
  } else {
    responsePromises.push({resolve: resolveFn});
  }
  promptToUUIDPromises.push({prompt: p, promise});

  // 清空 + 写
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
  log(`📤 [${p.id}] ${p.slug} 已提交`);
  await page.waitForTimeout(1000);
}
log(`✅ ${PROMPTS.length} 个全部提交，等待 HTTP 响应...`);

// === 等所有 promise resolve ===
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const results = [];
for (const item of promptToUUIDPromises) {
  const uuid = await Promise.race([
    item.promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 180000))
  ]).catch(e => null);
  if (!uuid) {
    log(`❌ [${item.prompt.id}] ${item.prompt.slug} 超时`);
    results.push({id: item.prompt.id, slug: item.prompt.slug, ok: false});
    continue;
  }
  // 直接通过 UUID 下载
  const url = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${uuid}`;
  const resp = await ctx.request.get(url);
  const buf = await resp.body();
  const dest = join(OUT_DIR, `${ts}_v${item.prompt.id}_${item.prompt.slug}_${uuid.slice(0,8)}.png`);
  await writeFile(dest, buf);
  results.push({id: item.prompt.id, slug: item.prompt.slug, ok: true, file: dest, size: buf.length, uuid});
  log(`💾 [${item.prompt.id}] ${item.prompt.slug.padEnd(24)} ${dest.split(/[\\/]/).pop()} (${(buf.length/1024).toFixed(0)} KB)`);
}

console.log('\n=== 总结 ===');
results.forEach(r => {
  if (r.ok) console.log(`✅ [${r.id}] ${r.slug.padEnd(24)} ${(r.size/1024).toFixed(0).padStart(5)} KB  ${r.uuid.slice(0,8)}`);
  else console.log(`❌ [${r.id}] ${r.slug}`);
});

await browser.close();
log('🎉 并行批次完成');
