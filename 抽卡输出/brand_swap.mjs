// 品牌换皮工具
// 用法: node brand_swap.mjs <video.mp4>
// 一次性问"谁拿手机" → 之后全自动到底
//
// 工作流:
//   1. 解析视频时长，定位末 8s 起点
//   2. ffmpeg 提取末 8s 音频 → mp3
//   3. /v1/audio/transcriptions 转录 → 拿到原台词
//   4. 在 BRAND_POOL 里找原品牌（substring match）
//   5. ffmpeg 截参考帧（[total-8s] 时刻那一帧）
//   6. ffmpeg 截前段视频 [0, total-8s]
//   7. 对其他 3 个品牌循环：
//      - 上传参考帧到 Flow → 右键 Animate → fill prompt → 生成 8s 视频 → 下载
//      - ffmpeg concat 前段 + 新末段 → 最终成品
//      - 风控触发就走 §9 自愈 (Clash Named Pipe + AdsPower 重启)

import { chromium } from 'playwright-core';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, dirname, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createRequire } from 'node:module';
import net from 'node:net';
import http from 'node:http';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

// ============ 配置（环境变量可覆盖） ============
const WS = process.env.WS;
const PROFILE_ID = process.env.PROFILE_ID ?? 'k1bsgahl';
const PROJECT_URL = process.env.PROJECT_URL ?? 'https://labs.google/fx/tools/flow/project/dae2c667-1bd0-48d8-8d94-8007c4a9013e';
const TRANSCRIBE_API = process.env.TRANSCRIBE_API ?? 'https://api.aisever.cn/v1/audio/transcriptions';
const TRANSCRIBE_KEY = process.env.TRANSCRIBE_KEY ?? '';
if (!TRANSCRIBE_KEY) { console.error('请设 TRANSCRIBE_KEY 环境变量'); process.exit(1); }
const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL ?? 'gpt-4o-transcribe';
const VEO_DURATION = process.env.VEO_DURATION ?? '8s';
const TAIL_SEC = Number(process.env.TAIL_SEC ?? 8);

// 4 个品牌池（顺序无所谓）
const BRAND_POOL = (process.env.BRAND_POOL ?? 'N999,W33,SPN,Dream17')
  .split(',').map(s => s.trim()).filter(Boolean);

// ============ 入参 ============
const inputVideo = process.argv[2];
if (!inputVideo) { console.error('用法: node brand_swap.mjs <video.mp4>'); process.exit(1); }
if (!existsSync(inputVideo)) { console.error(`文件不存在: ${inputVideo}`); process.exit(1); }

const WORK_DIR = join(dirname(inputVideo), `_swap_${basename(inputVideo, extname(inputVideo))}`);
await mkdir(WORK_DIR, { recursive: true });

function log(...a) { console.log(`[${new Date().toLocaleTimeString()}]`, ...a); }
function ts() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }

// ============ ffmpeg 工具 ============
function ffmpeg(args) {
  const r = spawnSync(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.toString().slice(0, 400)}`);
}
function getDurationSec(file) {
  const r = spawnSync(ffmpegPath, ['-i', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  const m = r.stderr.toString().match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  if (!m) throw new Error('解析视频时长失败');
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// ============ 转录 ============
async function transcribe(audioFile) {
  const buf = await readFile(audioFile);
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/mpeg' }), basename(audioFile));
  fd.append('model', TRANSCRIBE_MODEL);
  const r = await fetch(TRANSCRIBE_API, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TRANSCRIBE_KEY}` },
    body: fd,
  });
  const txt = await r.text();
  if (r.status !== 200) throw new Error(`transcribe HTTP ${r.status}: ${txt.slice(0, 300)}`);
  return JSON.parse(txt).text ?? '';
}

// ============ §9 风控自愈 ============
const VERGE_PIPE = '\\\\.\\pipe\\verge-mihomo';
function pipeRequest(path, { method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const opts = { method, path, headers: { Host: 'localhost' }, createConnection: () => net.connect(VERGE_PIPE) };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.headers['Content-Length'] = Buffer.byteLength(body); }
    const req = http.request(opts, res => {
      let d = ''; res.setEncoding('utf-8'); res.on('data', x => d += x); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
const PROXY_GROUP = '🚀 节点选择';
const NODE_ROTATION = ['🇺🇸 美国01', '🇸🇬 新加坡01', '🇦🇺 澳大利亚01', '🇺🇸 美国02', '🇸🇬 新加坡02', '🇺🇸 美国03', '🇺🇸 美国04'];
let _nodeIdx = 0;
async function rotateClashNode() {
  const group = encodeURIComponent(PROXY_GROUP);
  const target = NODE_ROTATION[_nodeIdx % NODE_ROTATION.length]; _nodeIdx++;
  let from = '?';
  try { const r = await pipeRequest(`/proxies/${group}`); if (r.status === 200) from = JSON.parse(r.body).now ?? '?'; } catch {}
  const resp = await pipeRequest(`/proxies/${group}`, { method: 'PUT', body: JSON.stringify({ name: target }) });
  if (resp.status !== 204 && resp.status !== 200) throw new Error(`Clash PUT 失败: ${resp.status}`);
  log(`[Clash] ${from} → ${target}`);
  return { from, to: target };
}
const ADSPOWER_API = process.env.ADSPOWER_API ?? 'http://127.0.0.1:50325';
async function adspowerStop(profileId) {
  const r = await fetch(`${ADSPOWER_API}/api/v1/browser/stop?user_id=${profileId}`).then(r => r.json());
  if (r.code !== 0) throw new Error(`stop: ${r.msg}`);
}
async function adspowerStart(profileId) {
  const r = await fetch(`${ADSPOWER_API}/api/v1/browser/start?user_id=${profileId}&open_tabs=1&headless=0`).then(r => r.json());
  if (r.code !== 0) throw new Error(`start: ${r.msg}`);
  return r.data.ws.puppeteer;
}
async function detectFlowBlock(page) {
  try {
    if (page.url().includes('accounts.google.com')) return { blocked: true, reason: 'redirected to accounts' };
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 5000));
    const patterns = [/unusual activity/i, /Account has been disabled/i, /temporarily blocked/i, /verify it.?s you/i];
    for (const re of patterns) if (re.test(txt)) return { blocked: true, reason: re.toString() };
    return { blocked: false };
  } catch { return { blocked: false }; }
}
const MAX_RECOVERY = 3;
async function recoverFromBlock(profileId, projectUrl, attempt = 0) {
  if (attempt >= MAX_RECOVERY) throw new Error(`⛔ 风控 ${MAX_RECOVERY} 次仍未恢复`);
  log(`[recovery] 第 ${attempt + 1}/${MAX_RECOVERY} 次`);
  await rotateClashNode();
  await adspowerStop(profileId).catch(e => log(`stop 警告: ${e.message}`));
  await new Promise(r => setTimeout(r, 1500));
  const newWs = await adspowerStart(profileId);
  await new Promise(r => setTimeout(r, 5000));
  const browser = await chromium.connectOverCDP(newWs);
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.bringToFront();
  await page.goto(projectUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-slate-editor="true"]', { timeout: 30000 }).catch(() => {});
  const status = await detectFlowBlock(page);
  if (status.blocked) { await browser.close().catch(() => {}); return recoverFromBlock(profileId, projectUrl, attempt + 1); }
  log(`[recovery] ✅ 第 ${attempt + 1} 次成功`);
  return { browser, ctx, page };
}

// ============ Flow 操作封装 ============
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

async function ensureVideoFramesMode(page) {
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
  await tagAndClick(page, (el, args) => el.getAttribute('role') === 'tab' && el.innerText.trim() === args.text, 'dur', { text: VEO_DURATION });
  await page.waitForTimeout(200);
  await tagAndClick(page, (el, args) => el.getAttribute('role') === 'tab' && el.innerText.trim() === args.text, 'cnt', { text: '1x' });
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
}

async function snapshotAllUUIDs(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  return new Set(await page.evaluate(() =>
    Array.from(document.querySelectorAll('img[alt="Generated image"]'))
      .map(i => i.src.match(/name=([0-9a-f-]+)/)?.[1]).filter(Boolean)
  ));
}

async function uploadAndAnimate(page, imagePath) {
  const baseline = await snapshotAllUUIDs(page);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]')).find(b => b.innerText.includes('Add Media'));
    btn.setAttribute('data-bot-runtime', 'addmedia');
  });
  await page.click('button[data-bot-runtime="addmedia"]');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(i => i.innerText.includes('Upload image'));
    item.setAttribute('data-bot-runtime', 'upitem');
  });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-bot-runtime="upitem"]')]);
  await chooser.setFiles(imagePath);
  try {
    const agreeBtn = page.locator('div[role="dialog"][data-state="open"] button:has-text("I agree")');
    await agreeBtn.click({ timeout: 2500 });
  } catch {}
  // 严格 UUID diff 等新图入主网格
  let newUUID = null;
  const t0 = Date.now();
  while (!newUUID && Date.now() - t0 < 120000) {
    await page.waitForTimeout(2500);
    const cur = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img[alt="Generated image"]'))
        .map(i => i.src.match(/name=([0-9a-f-]+)/)?.[1]).filter(Boolean)
    );
    const diff = cur.filter(u => !baseline.has(u));
    if (diff.length >= 1) { newUUID = diff[0]; break; }
  }
  if (!newUUID) throw new Error('上传后新图未入主网格');
  log(`  上传 → ${newUUID.slice(0, 8)}`);
  // 右键 Animate
  await page.evaluate(uuid => {
    const img = document.querySelector(`img[src*="${uuid}"]`);
    img?.closest('[role="button"][aria-roledescription="draggable"]')?.setAttribute('data-bot-runtime', 'newCard');
  }, newUUID);
  await page.click('[data-bot-runtime="newCard"]', { button: 'right' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const menu = document.querySelector('[role="menu"][data-state="open"]');
    const animate = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(i => i.innerText.includes('Animate'));
    animate.setAttribute('data-bot-runtime', 'animateItem');
  });
  await page.click('[data-bot-runtime="animateItem"]');
  await page.waitForTimeout(2500);
  log(`  ✅ Animate 完成，Start 槽已设`);
  return newUUID;
}

// 等视频生成：用「带 play_circle 的卡片 UUID diff」判断（不是 video 元素 count）
// 主网格里 video 元素只在 hover 卡片时才渲染，平时只有缩略图 img
async function snapshotVideoCardUUIDs(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  return new Set(await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[role="button"][aria-roledescription="draggable"]'));
    return cards
      .filter(c => c.innerText.includes('play_circle'))
      .map(c => c.querySelector('img')?.src.match(/name=([0-9a-f-]+)/)?.[1])
      .filter(Boolean);
  }));
}

async function generateAndDownload(page, ctx, prompt, outFile) {
  const baselineUUIDs = await snapshotVideoCardUUIDs(page);
  log(`  baseline 视频卡片: ${baselineUUIDs.size}`);

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
  log(`  生成已点击`);

  // polling 等新视频 UUID 出现（不是 video 元素 count）
  const tGen = Date.now();
  let newUUID = null;
  while (!newUUID && Date.now() - tGen < 360000) {
    await page.waitForTimeout(3000);
    const cur = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[role="button"][aria-roledescription="draggable"]'));
      return cards
        .filter(c => c.innerText.includes('play_circle'))
        .map(c => c.querySelector('img')?.src.match(/name=([0-9a-f-]+)/)?.[1])
        .filter(Boolean);
    });
    const diff = cur.filter(u => !baselineUUIDs.has(u));
    if (diff.length >= 1) {
      newUUID = diff[0];
      break;
    }
  }
  if (!newUUID) throw new Error('视频生成超时（6 分钟）');
  log(`  ✅ 视频生成 ${((Date.now() - tGen) / 1000).toFixed(0)}s, UUID=${newUUID.slice(0, 8)}`);

  const url = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${newUUID}`;
  const resp = await ctx.request.get(url);
  const buf = await resp.body();
  await writeFile(outFile, buf);
  log(`  💾 ${basename(outFile)} (${(buf.length / 1024).toFixed(0)} KB)`);
}

// ============ 主流程 ============
log(`输入: ${inputVideo}`);
log(`工作目录: ${WORK_DIR}`);
log(`品牌池 (${BRAND_POOL.length}): ${BRAND_POOL.join(' | ')}`);

// [1/8] 一次性问"谁拿手机"（环境变量 ROLE 可预设，绕过交互）
let role = (process.env.ROLE ?? '').trim();
if (!role) {
  const rl = createInterface({ input, output });
  role = (await rl.question('视频里是谁拿手机? ')).trim();
  rl.close();
}
if (!role) { console.error('未输入角色，退出'); process.exit(1); }
log(`角色: "${role}"`);
log(`✅ 之后全自动到底，不再询问\n`);

// [2/8] 视频时长 → 计算末段起点
const totalSec = getDurationSec(inputVideo);
const cutStart = Math.max(0, totalSec - TAIL_SEC);
log(`视频时长 ${totalSec.toFixed(2)}s，末段从 ${cutStart.toFixed(2)}s 开始（共 ${TAIL_SEC}s）`);

// [3/8] 提取末段音频 mp3 → 转录
const tailAudio = join(WORK_DIR, 'tail_audio.mp3');
ffmpeg(['-y', '-ss', String(cutStart), '-i', inputVideo, '-t', String(TAIL_SEC),
        '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', '-loglevel', 'error', tailAudio]);
log(`末段音频提取 → ${basename(tailAudio)}`);
log(`转录中…`);
const transcript = (await transcribe(tailAudio)).trim();
log(`转录: "${transcript}"`);

// [4/8] 识别原品牌（substring match，大小写不敏感）
const origBrand = BRAND_POOL.find(b => transcript.toLowerCase().includes(b.toLowerCase()));
if (!origBrand) {
  console.error(`\n❌ 转录文本里未匹配到任何品牌池成员`);
  console.error(`转录全文: ${transcript}`);
  console.error(`品牌池: ${BRAND_POOL.join(', ')}`);
  console.error(`请检查 BRAND_POOL 环境变量或转录质量`);
  process.exit(1);
}
log(`识别原品牌: 【${origBrand}】`);
const targetBrands = BRAND_POOL.filter(b => b !== origBrand);
log(`要换皮成: ${targetBrands.join(' / ')}`);

// [5/8] 截参考帧（cutStart 那一帧，作 Veo Frames 模式 Start）
const refFrame = join(WORK_DIR, 'ref_frame.jpg');
ffmpeg(['-y', '-ss', String(cutStart), '-i', inputVideo, '-frames:v', '1', '-q:v', '2', '-loglevel', 'error', refFrame]);
log(`参考帧 → ${basename(refFrame)}`);

// [6/8] 截前段视频 [0, cutStart]
const frontVideo = join(WORK_DIR, 'front.mp4');
const hasFront = cutStart > 0.5;
if (hasFront) {
  ffmpeg(['-y', '-i', inputVideo, '-t', String(cutStart),
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
          '-c:a', 'aac', '-b:a', '128k',
          '-loglevel', 'error', frontVideo]);
  log(`前段 → ${basename(frontVideo)}`);
} else {
  log(`视频 < ${TAIL_SEC}s，无前段，整段重新生成`);
}

// [7/8] 接管 Flow，循环 3 个目标品牌
let { browser, ctx, page } = await (async () => {
  const browser = await chromium.connectOverCDP(WS);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('labs.google')) ?? ctx.pages()[0] ?? await ctx.newPage();
  await page.bringToFront();
  await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-slate-editor="true"]', { timeout: 30000 });
  return { browser, ctx, page };
})();
log(`Flow 已接管`);
await ensureVideoFramesMode(page);
log(`模式: Video / Frames / ${VEO_DURATION} / 1x\n`);

const outputs = [];
for (const newBrand of targetBrands) {
  log(`━━━━━ 换皮: ${origBrand} → ${newBrand} ━━━━━`);

  const status = await detectFlowBlock(page);
  if (status.blocked) {
    log(`检测到风控: ${status.reason}`);
    await browser.close().catch(() => {});
    ({ browser, ctx, page } = await recoverFromBlock(PROFILE_ID, PROJECT_URL));
    await ensureVideoFramesMode(page);
  }

  // 替换文本里的原品牌（大小写不敏感）
  const newText = transcript.replace(new RegExp(origBrand, 'gi'), newBrand);
  const prompt = `${role}拿出手机，手机画面是'${newBrand}'的红色文字，说：${newText}`;
  log(`prompt: ${prompt}`);

  try {
    await uploadAndAnimate(page, refFrame);
    const safeBrand = newBrand.replace(/[^a-zA-Z0-9]/g, '_');
    const tailClip = join(WORK_DIR, `tail_${safeBrand}.mp4`);
    await generateAndDownload(page, ctx, prompt, tailClip);

    // 拼接前段 + 新末段
    const finalOut = join(dirname(inputVideo), `${basename(inputVideo, extname(inputVideo))}__${safeBrand}__${ts()}.mp4`);
    if (hasFront) {
      const concatList = join(WORK_DIR, `concat_${safeBrand}.txt`);
      await writeFile(concatList,
        `file '${frontVideo.replace(/\\/g, '/')}'\nfile '${tailClip.replace(/\\/g, '/')}'\n`);
      ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', concatList,
              '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
              '-c:a', 'aac', '-b:a', '128k',
              '-loglevel', 'error', finalOut]);
    } else {
      ffmpeg(['-y', '-i', tailClip, '-c', 'copy', '-loglevel', 'error', finalOut]);
    }
    log(`✅ 输出: ${basename(finalOut)}\n`);
    outputs.push({ brand: newBrand, file: finalOut, ok: true });
  } catch (e) {
    log(`❌ ${newBrand} 失败: ${e.message}`);
    outputs.push({ brand: newBrand, ok: false, error: e.message });
    if (/blocked|429|403|503|timeout/i.test(e.message)) {
      try {
        await browser.close().catch(() => {});
        ({ browser, ctx, page } = await recoverFromBlock(PROFILE_ID, PROJECT_URL));
        await ensureVideoFramesMode(page);
        log(`✅ 风控恢复，继续下一个品牌\n`);
      } catch (recErr) {
        log(`⛔ 恢复失败: ${recErr.message}`);
        break;
      }
    }
  }
}
await browser.close().catch(() => {});

// [8/8] 通知
const okCount = outputs.filter(o => o.ok).length;
console.log('\n\n══════════ 全部完成 ══════════');
console.log(`原视频: ${inputVideo}`);
console.log(`角色: ${role}`);
console.log(`原品牌: ${origBrand}`);
console.log(`成功 ${okCount} / ${targetBrands.length}:`);
outputs.forEach(o => {
  if (o.ok) console.log(`  ✅ [${o.brand.padEnd(15)}] ${o.file}`);
  else console.log(`  ❌ [${o.brand.padEnd(15)}] ${o.error}`);
});
console.log(`\n中间产物在: ${WORK_DIR}`);
