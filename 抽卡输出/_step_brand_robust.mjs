// 单品牌生成 + 风控全自动自愈
// 用法: node _step_brand_robust.mjs <BRAND>
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';

const BRAND = process.argv[2];
if (!BRAND) { console.error('用法: node _step_brand_robust.mjs <BRAND>'); process.exit(1); }

// 默认值是第一条视频的（兼容旧调用），可被环境变量覆盖
const REF = process.env.REF ?? 'C:\\Users\\AZSL\\Downloads\\_swap_Man_says_money_coming_platform_202605061917\\ref_frame.jpg';
const TAIL_OUT = process.env.TAIL_OUT ?? `C:\\Users\\AZSL\\Downloads\\_swap_Man_says_money_coming_platform_202605061917\\tail_${BRAND}.mp4`;
const PROJECT_URL = process.env.PROJECT_URL ?? 'https://labs.google/fx/tools/flow/project/6baa273c-caa0-4bb7-8ff3-1ec6229f6d2f';
const PROFILE_ID = process.env.PROFILE_ID ?? 'k1bsgahl';
const ROLE = process.env.ROLE ?? '男人';

// 转录文本 + 原品牌正则（用于替换）
const transcript = process.env.TRANSCRIPT ?? 'منی کمینگ کھیلنا ہے تو N999 پر آؤ۔ یہ پاکستان کا اکلوتا پلیٹ فارم ہے جہاں سے ودڈرال ہوتا ہے۔';
const ORIG_BRAND_REGEX = new RegExp(process.env.ORIG_BRAND_REGEX ?? 'N999', process.env.ORIG_BRAND_FLAGS ?? 'gi');
const newText = transcript.replace(ORIG_BRAND_REGEX, BRAND);
const prompt = `${ROLE}拿出手机，手机画面是'${BRAND}'的红色文字，说：${newText}`;
console.log('品牌:', BRAND);
console.log('prompt:', prompt);

function log(...a) { console.log(`[${new Date().toLocaleTimeString()}]`, ...a); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// === AdsPower HTTP API ===
const ADSPOWER = process.env.ADSPOWER_API ?? 'http://127.0.0.1:50325';
const API_KEY = process.env.ADSPOWER_API_KEY ?? '';
if (!API_KEY) { console.error('请设 ADSPOWER_API_KEY 环境变量'); process.exit(1); }
const adsHeaders = { 'Authorization': `Bearer ${API_KEY}` };
async function adsStop(uid) {
  const r = await fetch(`${ADSPOWER}/api/v1/browser/stop?user_id=${uid}`, { headers: adsHeaders }).then(r => r.json());
  return r;
}
async function adsStart(uid) {
  // 加重试：AdsPower 偶发"server is not working well"
  let lastErr;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${ADSPOWER}/api/v1/browser/start?user_id=${uid}&open_tabs=1&headless=0`, { headers: adsHeaders }).then(r => r.json()).catch(e => ({code:-1, msg: e.message}));
    if (r.code === 0) return r.data.ws.puppeteer;
    lastErr = r.msg;
    log(`  AdsPower start 第 ${i+1} 次失败: ${r.msg}，等 4s 重试`);
    await sleep(4000);
  }
  throw new Error(`AdsPower start: ${lastErr}`);
}

// === Clash Named Pipe ===
const VERGE_PIPE = '\\\\.\\pipe\\verge-mihomo';
function pipeReq(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const o = { method: opts.method || 'GET', path, headers: { Host: 'localhost' }, createConnection: () => net.connect(VERGE_PIPE) };
    if (opts.body) { o.headers['Content-Type'] = 'application/json'; o.headers['Content-Length'] = Buffer.byteLength(opts.body); }
    const r = http.request(o, x => { let d=''; x.setEncoding('utf-8'); x.on('data', y => d+=y); x.on('end', () => resolve({ status: x.statusCode, body: d })); });
    r.on('error', reject); if (opts.body) r.write(opts.body); r.end();
  });
}
// 只在美国节点池里轮转 — 跨国家会让 Google 触发"IP 突变"风控
const NODE_ROTATION = [
  '🇺🇸 美国04',
  '🇺🇸 美国备用01',
  '🇺🇸 美国备用02',
  '🇺🇸 美国家宽Frontier | 3.0x',
  '🇺🇸 美国家宽ATT | 3.0x',
  '🇺🇸 美国家宽Verizon | 3.0x',
  '🇺🇸 美国01',
  '🇺🇸 美国02',
  '🇺🇸 美国03',
];
// ⚠️ Clash 全局模式 (global) 下流量走 GLOBAL 组，不是 🚀 节点选择！
// 用 /configs 看 mode 字段确认
const PROXY_GROUP_NAME = process.env.CLASH_GROUP ?? 'GLOBAL';
async function rotateNode(idx) {
  const target = NODE_ROTATION[idx % NODE_ROTATION.length];
  const g = encodeURIComponent(PROXY_GROUP_NAME);
  let from = '?';
  try { const r = await pipeReq(`/proxies/${g}`); if (r.status === 200) from = JSON.parse(r.body).now ?? '?'; } catch {}
  const r = await pipeReq(`/proxies/${g}`, { method: 'PUT', body: JSON.stringify({ name: target }) });
  if (r.status !== 204 && r.status !== 200) throw new Error(`Clash PUT ${r.status}`);
  log(`[Clash] ${from} → ${target}`);
  return target;
}

// === Playwright helpers ===
async function tagAndClick(page, predicate, tagName, args = {}) {
  const found = await page.evaluate(({pred, tag, args}) => {
    const fn = new Function('el', 'args', `return (${pred})(el, args)`);
    const all = Array.from(document.querySelectorAll('button, [role="tab"], [role="menuitem"], div'));
    const el = all.find(e => fn(e, args));
    if (!el) return false;
    el.setAttribute('data-bot-runtime', tag);
    return true;
  }, { pred: predicate.toString(), tag: tagName, args });
  if (!found) throw new Error(`tagAndClick ${tagName} not found`);
  await page.click(`[data-bot-runtime="${tagName}"]`);
}

async function isBlocked(page) {
  try {
    if (page.url().includes('accounts.google.com')) return true;
    const t = await page.evaluate(() => document.body.innerText.slice(0, 5000));
    return /unusual activity|We noticed|Please visit the Help Center|temporarily blocked|verify it.?s you/i.test(t);
  } catch { return false; }
}

async function ensureMode(page) {
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
  await tagAndClick(page, (el, args) => el.getAttribute('role') === 'tab' && el.innerText.trim() === args.text, 'dur', { text: '8s' });
  await page.waitForTimeout(200);
  await tagAndClick(page, (el, args) => el.getAttribute('role') === 'tab' && el.innerText.trim() === args.text, 'cnt', { text: '1x' });
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
}

async function snapshotImgs(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  return new Set(await page.evaluate(() =>
    Array.from(document.querySelectorAll('img[alt="Generated image"]'))
      .map(i => i.src.match(/name=([0-9a-f-]+)/)?.[1]).filter(Boolean)
  ));
}
async function snapshotVideos(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  return new Set(await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[role="button"][aria-roledescription="draggable"]'));
    return cards.filter(c => c.innerText.includes('play_circle'))
      .map(c => c.querySelector('img')?.src.match(/name=([0-9a-f-]+)/)?.[1]).filter(Boolean);
  }));
}

// === 主流程：尝试生成视频，如风控自愈 ===
const MAX_RECOVERY = 3;
let nodeIdx = 0;

async function setupBrowser() {
  const ws = (await readFile('D:\\A-------------xiangmu------------A\\换品牌\\抽卡输出\\_ws.txt', 'utf-8')).trim();
  const browser = await chromium.connectOverCDP(ws);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('labs.google'));
  if (!page) page = await ctx.newPage();
  await page.bringToFront();
  await page.goto(PROJECT_URL, { waitUntil: 'load', timeout: 60000 });
  await sleep(3000);

  // Flow 营销首页 fallback：切 IP 频繁会让工作台 URL 渲染成营销首页
  // 判别：DOM 没 slate-editor，body 含 "Create with Flow"
  let hasSlate = await page.evaluate(() => !!document.querySelector('[data-slate-editor="true"]'));
  if (!hasSlate) {
    log('  ⚠️ Flow 营销首页，点 Create with Flow 进工作台...');
    // 优先找 "Create with Flow"（精确文本），降级到 Get Started
    const tagged = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('a, button'));
      let btn = all.find(el => (el.innerText || '').trim() === 'Create with Flow');
      if (!btn) btn = all.find(el => /Create with Flow/i.test(el.innerText || ''));
      if (!btn) btn = all.find(el => /Get Started/i.test(el.innerText || ''));
      if (btn) { btn.setAttribute('data-bot-runtime', 'create-flow'); return {ok:true, text: btn.innerText.trim().slice(0,40), href: btn.href || ''}; }
      return {ok:false};
    });
    if (!tagged.ok) throw new Error('营销首页且未找到 Create with Flow 按钮');
    log(`  click "${tagged.text}" (href=${tagged.href})`);
    await page.click('[data-bot-runtime="create-flow"]');
    // 不立即 navigate；等页面自然过渡到工作台
    log('  等工作台 slate-editor 自然出现（最多 60s）...');
    await page.waitForSelector('[data-slate-editor="true"]', { timeout: 60000 });
    log(`  ✅ 工作台已加载: ${page.url()}`);
    // 如果跳到了项目列表（不是当前 project URL），再 navigate 回当前 project
    if (!page.url().includes(PROJECT_URL.split('/').pop())) {
      log(`  导航回 project URL...`);
      await page.goto(PROJECT_URL, { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector('[data-slate-editor="true"]', { timeout: 30000 });
    }
    return { browser, ctx, page };
  }
  return { browser, ctx, page };
}

async function recover() {
  log(`🔁 触发风控自愈（第 ${nodeIdx + 1} 次）`);
  await rotateNode(nodeIdx); nodeIdx++;
  log(`AdsPower 重启浏览器...`);
  await adsStop(PROFILE_ID).catch(() => {});
  await sleep(2000);
  const newWs = await adsStart(PROFILE_ID);
  log(`新 ws: ${newWs}`);
  await writeFile('D:\\A-------------xiangmu------------A\\换品牌\\抽卡输出\\_ws.txt', newWs);
  await sleep(6000);   // 等浏览器稳定
}

let { browser, ctx, page } = await setupBrowser();
log('Flow 已接管');

let attempt = 0;
let success = false;
let savedUUID = null;
while (attempt < MAX_RECOVERY && !success) {
  attempt++;
  log(`━━━━━ ${BRAND} 第 ${attempt}/${MAX_RECOVERY} 次尝试 ━━━━━`);

  // 风控前置
  if (await isBlocked(page)) {
    log('前置检测到风控，先自愈');
    await browser.close().catch(() => {});
    await recover();
    ({ browser, ctx, page } = await setupBrowser());
  }

  try {
    await ensureMode(page);
    log('模式: Video / Frames / 8s / 1x');

    // 1. 上传参考帧
    const baseImgs = await snapshotImgs(page);
    log(`baseline imgs: ${baseImgs.size}`);
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]')).find(b => b.innerText.includes('Add Media'));
      btn.setAttribute('data-bot-runtime', 'addmedia');
    });
    await page.click('button[data-bot-runtime="addmedia"]');
    await sleep(800);
    await page.evaluate(() => {
      const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(i => i.innerText.includes('Upload image'));
      item.setAttribute('data-bot-runtime', 'upitem');
    });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-bot-runtime="upitem"]')]);
    await chooser.setFiles(REF);
    log('setFiles 完成');
    try {
      await page.locator('div[role="dialog"][data-state="open"] button:has-text("I agree")').click({ timeout: 2500 });
    } catch {}

    // 2. 等新图入主网格
    let newImgUUID = null;
    const tImg = Date.now();
    while (!newImgUUID && Date.now() - tImg < 90000) {
      await sleep(2500);
      const cur = await page.evaluate(() =>
        Array.from(document.querySelectorAll('img[alt="Generated image"]'))
          .map(i => i.src.match(/name=([0-9a-f-]+)/)?.[1]).filter(Boolean)
      );
      const diff = cur.filter(u => !baseImgs.has(u));
      if (diff.length >= 1) { newImgUUID = diff[0]; break; }
    }
    if (!newImgUUID) throw new Error('上传后新图未入主网格');
    log(`✅ 上传新图 ${newImgUUID.slice(0, 8)}`);

    // 3. 右键 Animate
    await page.evaluate(uuid => {
      const img = document.querySelector(`img[src*="${uuid}"]`);
      img?.closest('[role="button"][aria-roledescription="draggable"]')?.setAttribute('data-bot-runtime', 'newCard');
    }, newImgUUID);
    await page.click('[data-bot-runtime="newCard"]', { button: 'right' });
    await sleep(1500);
    await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"][data-state="open"]');
      const animate = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(i => i.innerText.includes('Animate'));
      animate.setAttribute('data-bot-runtime', 'animateItem');
    });
    await page.click('[data-bot-runtime="animateItem"]');
    await sleep(2500);
    log('✅ Animate 完成');

    // 4. 视频卡片 baseline（按 count，不靠 UUID — 视频缩略图 lazy-load 不可靠）
    const baseVidCount = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="button"][aria-roledescription="draggable"]'))
        .filter(c => c.innerText.includes('play_circle')).length
    );
    log(`baseline 视频卡片数: ${baseVidCount}`);

    const promptBox = page.locator('[data-slate-editor="true"][role="textbox"]');
    await promptBox.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await promptBox.fill(prompt);
    await page.waitForFunction(() => {
      const b = Array.from(document.querySelectorAll('button')).find(b => b.innerText.startsWith('arrow_forward'));
      return b && !b.disabled && getComputedStyle(b).opacity === '1';
    }, null, { timeout: 30000 });
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find(b => b.innerText.startsWith('arrow_forward'));
      b.setAttribute('data-bot-runtime', 'gen-current');
    });
    await page.click('[data-bot-runtime="gen-current"]');
    log('生成已点击');

    // 5. polling 等视频卡片数 +1，同时检测风控
    const tGen = Date.now();
    let newVidAppeared = false;
    let blockedDuringGen = false;
    while (!newVidAppeared && Date.now() - tGen < 360000) {
      await sleep(3000);
      if (await isBlocked(page)) { blockedDuringGen = true; break; }
      const cnt = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="button"][aria-roledescription="draggable"]'))
          .filter(c => c.innerText.includes('play_circle')).length
      );
      if (cnt > baseVidCount) { newVidAppeared = true; break; }
    }
    if (blockedDuringGen) {
      log('生成中触发风控，自愈重试');
      await browser.close().catch(() => {});
      await recover();
      ({ browser, ctx, page } = await setupBrowser());
      continue;
    }
    if (!newVidAppeared) throw new Error('视频生成超时');
    log(`✅ 视频卡片 +1 出现 ${((Date.now() - tGen) / 1000).toFixed(0)}s`);

    // 5b. hover 第 0 个视频卡片让 video.src 加载（缩略图 lazy-load 解决）
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(800);
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[role="button"][aria-roledescription="draggable"]'))
        .filter(c => c.innerText.includes('play_circle'))
        .sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y);
      if (cards[0]) cards[0].setAttribute('data-bot-runtime', 'firstVideo');
    });
    await page.hover('[data-bot-runtime="firstVideo"]');
    let newVideoUUID = null;
    for (let i = 0; i < 30 && !newVideoUUID; i++) {
      await sleep(1000);
      newVideoUUID = await page.evaluate(() => {
        const card = document.querySelector('[data-bot-runtime="firstVideo"]');
        if (!card) return null;
        const v = card.querySelector('video');
        let src = v?.src || v?.currentSrc || '';
        if (!src) src = card.querySelector('img')?.src || '';
        const m = src.match(/name=([0-9a-f-]+)/);
        return m ? m[1] : null;
      });
    }
    if (!newVideoUUID) throw new Error('视频卡片出现但 UUID 未加载（hover 30s）');
    log(`✅ UUID=${newVideoUUID.slice(0, 8)}`);
    savedUUID = newVideoUUID;

    // 6. 下载
    const url = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${newVideoUUID}`;
    const resp = await ctx.request.get(url);
    const buf = await resp.body();
    await writeFile(TAIL_OUT, buf);
    log(`💾 ${TAIL_OUT.split(/[\\/]/).pop()} (${(buf.length / 1024).toFixed(0)} KB)`);
    success = true;
    break;
  } catch (e) {
    log(`❌ 第 ${attempt} 次失败: ${e.message}`);
    if (await isBlocked(page).catch(() => false)) {
      log('确认是风控，自愈重试');
      await browser.close().catch(() => {});
      await recover();
      ({ browser, ctx, page } = await setupBrowser());
      continue;
    } else {
      throw e;   // 非风控错误直接抛
    }
  }
}

await browser.close().catch(() => {});

if (success) {
  console.log(`\n🎉 ${BRAND} 完成: ${TAIL_OUT}`);
  console.log(`UUID=${savedUUID}`);
} else {
  console.log(`\n⛔ ${BRAND} 失败：连续 ${MAX_RECOVERY} 次风控自愈未成功`);
  process.exit(1);
}
