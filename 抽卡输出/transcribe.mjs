// 转录视频/音频 (OpenAI Whisper 兼容 API)
// 用法: node transcribe.mjs <video.mp4|audio.mp3> [language]
// 流程: mp4/视频 → ffmpeg 提取 mp3 (16kHz mono 64k) → 上传转录
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, dirname, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

const API_URL = process.env.TRANSCRIBE_API ?? 'https://api.aisever.cn/v1/audio/transcriptions';
const API_KEY = process.env.TRANSCRIBE_KEY ?? '';
const MODEL = process.env.TRANSCRIBE_MODEL ?? 'whisper-1';
if (!API_KEY) { console.error('请设 TRANSCRIBE_KEY 环境变量'); process.exit(1); }

const file = process.argv[2];
const lang = process.argv[3] ?? null;   // null = 自动检测；可指定 ur/en/zh

if (!file) { console.error('用法: node transcribe.mjs <file> [lang]'); process.exit(1); }
if (!existsSync(file)) { console.error(`文件不存在: ${file}`); process.exit(1); }

let audioPath = file;
let isTemp = false;
const ext = extname(file).toLowerCase();

// 视频或非压缩音频 → ffmpeg 提取 mp3 (16kHz mono 64kbps，最小 Whisper 接受质量)
if (['.mp4', '.mov', '.webm', '.mkv', '.avi', '.wav', '.flac'].includes(ext)) {
  audioPath = join(dirname(file), `_tmp_${basename(file, ext)}.mp3`);
  isTemp = true;
  console.log(`[ffmpeg] 提取音轨 → ${basename(audioPath)}`);
  const r = spawnSync(ffmpegPath, [
    '-y', '-i', file,
    '-vn',                    // 去视频
    '-ac', '1',               // mono
    '-ar', '16000',           // 16kHz (Whisper 内部就是 16k)
    '-b:a', '64k',            // 64kbps
    '-loglevel', 'error',
    audioPath,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) {
    console.error('ffmpeg 失败:', r.stderr?.toString());
    process.exit(1);
  }
}

const buf = await readFile(audioPath);
console.log(`[transcribe] ${basename(audioPath)} (${(buf.length/1024).toFixed(0)} KB)${lang ? ' lang=' + lang : ' lang=auto'}`);

const fd = new FormData();
fd.append('file', new Blob([buf], { type: 'audio/mpeg' }), basename(audioPath));
fd.append('model', MODEL);
if (lang) fd.append('language', lang);

const t0 = Date.now();
const resp = await fetch(API_URL, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${API_KEY}` },
  body: fd,
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const ct = resp.headers.get('content-type') ?? '';
const bodyText = await resp.text();
console.log(`HTTP ${resp.status} (${elapsed}s, ${bodyText.length} bytes, ${ct})`);

if (isTemp) await unlink(audioPath).catch(() => {});

if (resp.status !== 200) {
  console.error('--- 错误响应 ---');
  console.error(bodyText.slice(0, 800));
  process.exit(1);
}

let json;
try { json = JSON.parse(bodyText); } catch {
  console.log('--- 文本响应 ---');
  console.log(bodyText);
  process.exit(0);
}

console.log('\n--- 转录 ---');
if (json.language) console.log('language:', json.language);
console.log('text:', json.text ?? '(空)');

const outDir = dirname(file);
const baseName = basename(file).replace(/\.(mp4|mov|webm|m4a|mp3|wav|flac|mkv)$/i, '');
await writeFile(join(outDir, `${baseName}.transcript.json`), JSON.stringify(json, null, 2));
await writeFile(join(outDir, `${baseName}.transcript.txt`), json.text ?? '');
console.log(`\n💾 ${baseName}.transcript.{json,txt}`);
