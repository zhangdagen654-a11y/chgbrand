// Batch 生图：6 条 prompt 串行，每条 1 张 9:16 图
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const WS = process.env.WS;
const PROJECT_URL = process.env.PROJECT_URL ?? 'https://labs.google/fx/tools/flow/project/dae2c667-1bd0-48d8-8d94-8007c4a9013e';
const OUT_DIR = process.env.OUT_DIR ?? 'D:\\A-------------xiangmu------------A\\换品牌\\抽卡输出';

const PROMPTS = [
  { id: 1, slug: 'stompFlatbread', text: `Raw smartphone footage, vertical 9:16 amateur Pakistani phone camera quality, shaky handheld, grainy, the look of someone secretly filming something disgusting they stumbled upon.
FIRST-PERSON HIDDEN CAMERA POV filming from a low crouching angle, as if the cameraman is secretly recording a bizarre scene at a Pakistani street food stall at night. The phone is held low and slightly tilted, partially hidden, the framing imperfect and off-center like real secretly filmed footage.
IN THE CENTER OF THE FRAME: a Pakistani street food vendor standing behind his cooking station, his BARE DIRTY FOOT stepping directly INTO a large flat iron cooking tawa on the ground, pressing down hard onto a large round chapati/roti flatbread, the bread squishing and deforming grotesquely under his grimy foot, oil and grease splattering outward, his other foot on the ground, his body weight pressing down, his hands casually doing something else as if this is his normal cooking method, his face showing zero concern.
ALL AROUND THE COOKING STATION ON THE GROUND AND ON THE METAL TABLE: massive piles of bundled green Pakistani rupee banknotes (1000 PKR and 5000 PKR with Muhammad Ali Jinnah's portrait clearly Pakistani currency NOT American dollars), THOUSANDS of colorful casino poker chips red green blue black yellow scattered across the greasy surface mixed with cash and food scraps, cracked smartphones showing gambling app interfaces lying in the grease.
The setting: a cramped dirty Pakistani street food stall at night, harsh single fluorescent tube lighting casting stark shadows, greasy metal tables, steam and smoke, other food pots and pans, the authentic grim atmosphere of a back-alley Karachi food stall. The camera occasionally shakes as if the person filming is nervous about being caught. Authentic smartphone camera quality, slightly out of focus, grainy from low light.` },

  { id: 2, slug: 'skyfallFreeFall', text: `Raw smartphone selfie POV footage, vertical 9:16 amateur Pakistani phone camera quality, extreme motion blur.
FIRST-PERSON SELFIE POV CAPTURED IN MID-AIR HIGH ABOVE A CITY DURING FREE-FALL. The male Pakistani cameraman in his late twenties, his face filling the bottom of the frame captured in EXTREME SILENT TERROR, eyes wide staring into the camera, mouth open in frozen scream, tears streaming UPWARD from the wind, his hair blown completely vertical, his white shalwar kameez inflated like a parachute billowing violently upward around his body from the extreme wind speed.
THE CRITICAL DIFFERENCE: HE IS EXTREMELY HIGH UP — the Karachi cityscape below is still MINIATURE AND DISTANT, the buildings look like tiny blocks, the cars are invisible specks, the coastline and Arabian Sea visible at the horizon. He is at skyscraper height, not close to the ground — the fall has JUST BEGUN. THE SKY fills the upper portion of the frame, bright blue with clouds at his altitude level, some clouds are BESIDE him showing how high he is. No building edge visible anymore — he is in open air, pure sky around him.
SCATTERED IN THE AIR AT HIS ALTITUDE falling with him in slow separation: bundled Pakistani rupee banknotes tumbling and catching wind spreading outward in all directions, colorful casino poker chips glinting in the sunlight as they scatter, cracked smartphones spinning, JazzCash receipts fluttering, all objects still close to him because the fall just started, a constellation of his destroyed life suspended in the sky around his falling body.
Extreme motion blur on background, the man's face relatively sharp from selfie proximity, bright daylight high-altitude photography, wind distortion on the phone lens. Authentic smartphone camera quality.` },

  { id: 3, slug: 'rideExtreme', text: `Raw smartphone selfie POV footage, vertical 9:16 amateur Pakistani phone camera quality, violent shaking.
FIRST-PERSON SELFIE POV from a passenger TRAPPED ON A CATASTROPHICALLY BROKEN AMUSEMENT PARK RIDE at the absolute highest point. The male Pakistani cameraman in his late twenties, his face filling the bottom of the frame captured in PURE PRIMAL TERROR, veins bulging in his neck from screaming, tears and snot streaming, his white shalwar kameez soaked in sweat.
THE RIDE HAS COMPLETELY BROKEN APART AROUND HIM: he is sitting in a single detached ride chair that has SNAPPED OFF the main arm, the chair is dangling from a SINGLE THIN RUSTED CABLE that is visibly FRAYING strand by strand, the broken metal arm of the ride hanging at a grotesque angle with sparks shooting from the mechanical joint, bolts and metal debris falling past him, the rest of the ride structure visibly COLLAPSING below with metal beams bending and breaking, other empty chairs dangling at wrong angles, the entire structure looking like it is seconds from total structural failure.
HE IS AT MAXIMUM HEIGHT — 30+ meters above the ground, the Pakistani mela fairground below showing tiny colorful lights, tiny crowds running and screaming pointing upward, emergency vehicles with flashing lights arriving, a rescue team deploying an inflatable airbag far below.
WEDGED IN THE BROKEN SEAT AND FALLING FROM IT: bundled Pakistani rupee banknotes caught in the wind streaming downward, colorful casino poker chips bouncing off broken metal and cascading down, his cracked smartphone lodged in the bent metal frame showing "WITHDRAWAL FAILED" in red.
Night scene, harsh flickering fairground lights strobing from the electrical malfunction, sparks from broken machinery illuminating his terrified face. Authentic smartphone camera quality, violent shaking.` },

  { id: 4, slug: 'wheelchairNewsInterview', text: `Raw photograph captured on Canon EOS R5, 35mm lens, classic Pakistani television news broadcast interview aesthetic, SAMAA NEWS or GEO NEWS field report visual style. Daytime outdoor natural lighting.
MEDIUM SHOT framed like a Pakistani TV news field interview segment. Vertical 9:16 format. A professional Pakistani male news reporter in his thirties standing to the right of frame holding a microphone with a news channel logo, wearing formal dress shirt, serious professional expression, the microphone extended toward the interview subject.
THE INTERVIEW SUBJECT sitting in the center-left of the frame: a Pakistani elderly man in his seventies in a beat-up rusty old wheelchair on a Karachi sidewalk. Weathered deeply wrinkled face, thin white beard, wearing a faded torn old shalwar kameez with patches, traditional topi cap, the wheelchair old and bent. He appears to be a helpless poor disabled beggar being interviewed about his hardship — BUT THE CONTRADICTION IS SCREAMING: his wrist wearing a MASSIVE THICK GOLD ROLEX WATCH, MULTIPLE HEAVY GOLD CHAINS visible around his neck, THICK GOLD RINGS on multiple fingers, a bulging pocket with green Pakistani rupee banknotes visibly sticking out.
IN HIS LAP in full view of the camera: a MASSIVE PILE of bundled green Pakistani rupee banknotes (1000 PKR and 5000 PKR), THOUSANDS of colorful casino poker chips piled on top, a brand new smartphone face-up showing a gambling app interface with large green winning numbers.
His facial expression: a SLY KNOWING SMIRK directly into the camera, one eyebrow raised, the quiet confidence of a man who has more money than the reporter but enjoys playing poor. The reporter's expression: visible CONFUSION AND DISBELIEF at what he is witnessing, mouth slightly open, eyebrows raised.
Background: authentic Karachi busy street with traffic, pedestrians, shops with Urdu signage, the realistic setting of a field news report. A lower-third news ticker bar area at the bottom of the frame. Professional broadcast lighting with natural sunlight.` },

  { id: 6, slug: 'planeBystander', text: `Raw smartphone footage, vertical 9:16 amateur phone camera quality, shaky handheld from a distance, grainy, the look of a real bystander filming an unbelievable event at an airport, NOT cinematic NOT polished.
SHOT FROM THE GROUND BY A BYSTANDER standing near an airport perimeter fence, phone held up filming through the chain-link fence. The chain-link fence pattern slightly visible at the edges of the frame creating an authentic "filmed through a fence" look, the phone autofocus hunting between the fence and the distant subject.
IN THE CENTER OF THE FRAME at medium distance: a white commercial airplane accelerating down a runway, a tiny human figure CLINGING TO THE LANDING GEAR AREA, barely recognizable as a person at this distance but clearly a human body — a desperate Pakistani man in light-colored shalwar kameez gripping the landing gear strut, his clothes flapping violently in the jet wash, the plane lifting off the runway with wheels still extended.
THE REALISM COMES FROM THE DISTANCE AND IMPERFECTION: the man is not huge and detailed, he is a small desperate figure on a massive airplane, shot from far away through a fence by a shocked bystander. Other bystanders' hands visible at the bottom edge of the frame pointing at the plane, muffled panicked voices implied by open mouths.
SCATTERED ON THE RUNWAY behind the accelerating plane: bundled banknotes blown by the jet wash tumbling across the tarmac, colorful chips rolling, papers and debris streaming backward in the engine wake.
The airport setting: flat dusty Pakistani runway, airport terminal buildings in the background, heat shimmer from the tarmac, harsh afternoon sunlight, the authentic look of Jinnah International Airport Karachi. Grainy smartphone quality, slight camera shake from the bystander's shock, autofocus pulsing.` },

  { id: 8, slug: 'cattleMarketRealism', text: `Raw photograph captured on Canon EOS R5, 35mm lens, classic Bollywood social realism cinematic aesthetic, Anurag Kashyap gritty documentary meets narrative film. Harsh afternoon Pakistani sunlight.
WIDE SHOT of a real bustling Pakistani Bakra Eid cattle mandi — NOT a clean movie set but an AUTHENTIC DUSTY CHAOTIC LIVESTOCK MARKET. Vertical 9:16 format. Dusty unpaved ground with animal dung and hay scattered everywhere, temporary bamboo and rope pen enclosures, blue tarpaulin sheets for shade tied to wooden poles, flies in the air, the heat and chaos of a real mandi. MASSIVE BULLS with muscular humps and decorated horns tied to posts, real weathered Pakistani cattle traders in dusty shalwar kameez squatting beside their animals, buyers examining teeth and hooves, price negotiations happening everywhere.
IN THE CENTER walking through the crowded narrow path between cattle pens, COMPLETELY OUT OF PLACE: a thin young Pakistani man in his mid-twenties wearing a cheap wrinkled shalwar kameez that is slightly too big for him, CLUTCHING A SINGLE SMALL SCRAWNY LIVE CHICKEN awkwardly under one arm, the chicken flapping and struggling, feathers falling off. He is trying to walk through the mandi as if he belongs but the massive bulls on either side of him tower over him making his tiny chicken look absolutely pathetic and absurd.
HIS FACE: NOT exaggerated cartoon shame but REAL quiet humiliation — eyes looking straight ahead refusing to make eye contact with anyone, jaw clenched, walking slightly too fast trying to get through as quickly as possible, his free hand shoved in his pocket, the body language of a man who knows everyone is judging him but is trying to pretend he doesn't notice.
THE PEOPLE AROUND HIM reacting NATURALLY not theatrically: a cattle trader sitting on the ground glancing up with a slight smirk, two young men nudging each other and looking, an old man shaking his head slowly, a chai vendor pausing mid-pour to stare — the reactions are subtle and realistic, not pointing and laughing like a comedy movie.
ON THE DUSTY GROUND that he just walked past: a few Pakistani rupee banknotes that fell from his pocket without him noticing, a couple of casino poker chips in the dirt being stepped on by cattle hooves, a cracked smartphone face-down in the dust. Harsh direct overhead Pakistani afternoon sun casting short shadows, dust particles visible in the hot air, authentic gritty documentary photography.` },
];

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

// === 切到 Image tab + 1x ===
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
// 1x
await tagAndClick(
  (el, args) => el.getAttribute('role') === 'tab' && el.innerText.trim() === args.text,
  'cnt', { text: '1x' }
);
await page.waitForTimeout(300);
// 9:16 (默认应该已是)
await page.evaluate(() => {
  const aspect = Array.from(document.querySelectorAll('[role="tab"]'))
    .find(t => t.innerText.includes('crop_9_16'));
  if (aspect && aspect.getAttribute('aria-selected') !== 'true') aspect.click();
});
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
log('已切到 Image + 1x + 9:16');

const promptBox = page.locator('[data-slate-editor="true"][role="textbox"]');
const genBtn = page.locator('button').filter({ hasText: 'arrow_forward' }).first();

const results = [];
for (const p of PROMPTS) {
  log(`=== [${p.id}] ${p.slug} 开始 ===`);
  // 基线
  const baseline = await page.locator('img[alt="Generated image"]').count();

  // 清空 + 写新 prompt
  await promptBox.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  await promptBox.fill(p.text);
  await page.waitForTimeout(500);

  // 装 batchLog 错误监听（捕获被审核拒绝的情况）
  let lastError = null;
  const errHandler = (resp) => {
    if (resp.status() >= 400 && resp.url().includes('aisandbox-pa.googleapis.com')) {
      resp.text().then(t => lastError = `HTTP ${resp.status()}: ${t.slice(0,200)}`).catch(()=>{});
    }
  };
  page.on('response', errHandler);

  await genBtn.click();
  log(`  生成中... (baseline=${baseline})`);

  let timedOut = false;
  try {
    await page.waitForFunction(
      (b) => document.querySelectorAll('img[alt="Generated image"]').length > b,
      baseline,
      { timeout: 90000 }
    );
  } catch (e) {
    timedOut = true;
  }
  page.off('response', errHandler);

  if (timedOut) {
    log(`  ❌ 超时 / 可能被拒。最近错误: ${lastError ?? 'none'}`);
    results.push({id: p.id, slug: p.slug, ok: false, reason: lastError ?? 'timeout', file: null});
    // 清空 toast / 错误状态以免影响下一条
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    continue;
  }

  await page.waitForTimeout(1500);  // 等 onload
  const newSrc = await page.evaluate(() =>
    document.querySelector('img[alt="Generated image"]')?.src
  );
  const m = newSrc?.match(/name=([0-9a-f-]+)/);
  const uuid = m ? m[1] : 'unknown';

  // 下载
  const url = new URL(newSrc, 'https://labs.google').href;
  const resp = await ctx.request.get(url);
  const buf = await resp.body();
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = join(OUT_DIR, `${ts}_v${p.id}_${p.slug}_${uuid.slice(0,8)}.png`);
  await writeFile(dest, buf);
  log(`  💾 ${dest.split(/[\\/]/).pop()} (${(buf.length/1024).toFixed(0)} KB)`);
  results.push({id: p.id, slug: p.slug, ok: true, file: dest, size: buf.length});
}

console.log('\n=== 总结 ===');
results.forEach(r => {
  if (r.ok) console.log(`✅ [${r.id}] ${r.slug.padEnd(22)} ${(r.size/1024).toFixed(0).padStart(5)} KB  ${r.file.split(/[\\/]/).pop()}`);
  else console.log(`❌ [${r.id}] ${r.slug.padEnd(22)} ${r.reason}`);
});

await browser.close();
log('🎉 批次完成');
