// 批量转录 10 个视频为 Urdu，输出到一个 txt
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, dirname, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

const SRC_DIR = process.argv[2];
const OUT_TXT = process.argv[3];
const LANG = process.argv[4] ?? 'ur';
if (!SRC_DIR || !OUT_TXT) { console.error('用法: <srcDir> <outTxt> [lang=ur]'); process.exit(1); }

const API_URL = process.env.TRANSCRIBE_API ?? 'https://api.aisever.cn/v1/audio/transcriptions';
const API_KEY = process.env.TRANSCRIBE_KEY ?? '';
const MODEL = process.env.TRANSCRIBE_MODEL ?? 'gpt-4o-transcribe';
if (!API_KEY) { console.error('请设 TRANSCRIBE_KEY'); process.exit(1); }

async function transcribeFile(file) {
  // 提取 mp3
  const ext = extname(file).toLowerCase();
  let audioPath = file;
  let isTemp = false;
  if (['.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(ext)) {
    audioPath = join(dirname(file), `_tmp_${basename(file, ext)}.mp3`);
    isTemp = true;
    const r = spawnSync(ffmpegPath, [
      '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k',
      '-loglevel', 'error', audioPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.toString().slice(0, 200)}`);
  }

  const buf = await readFile(audioPath);
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/mpeg' }), basename(audioPath));
  fd.append('model', MODEL);
  if (LANG) fd.append('language', LANG);

  const t0 = Date.now();
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}` },
    body: fd,
  });
  const txt = await resp.text();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (isTemp) await unlink(audioPath).catch(() => {});
  if (resp.status !== 200) throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  const json = JSON.parse(txt);
  return { text: json.text ?? '', elapsed };
}

// 主流程
const sections = [];
const total = 10;
for (let i = 1; i <= total; i++) {
  const num = String(i).padStart(2, '0');
  const file = join(SRC_DIR, `${num}.mp4`);
  if (!existsSync(file)) {
    console.log(`[${i}/${total}] ❌ ${num}.mp4 不存在，跳过`);
    sections.push(`=== ${num}.mp4 ===\n[文件不存在]\n`);
    continue;
  }
  process.stdout.write(`[${i}/${total}] ${num}.mp4 转录中... `);
  try {
    const { text, elapsed } = await transcribeFile(file);
    console.log(`${elapsed}s`);
    sections.push(`=== ${num}.mp4 ===\n${text}\n`);
  } catch (e) {
    console.log(`❌ ${e.message}`);
    sections.push(`=== ${num}.mp4 ===\n[转录失败: ${e.message}]\n`);
  }
}

const out = sections.join('\n');
await writeFile(OUT_TXT, out, 'utf-8');
console.log(`\n💾 ${OUT_TXT} (${out.length} chars)`);
