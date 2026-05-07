// AdsPower HTTP API helper（认证：Authorization: Bearer ${API_KEY}）
// 来源：local-api-mcp-typescript/build/index.js 反向工程
const ADSPOWER_API = process.env.ADSPOWER_API ?? 'http://127.0.0.1:50325';
const API_KEY = process.env.ADSPOWER_API_KEY ?? '';
if (!API_KEY) {
  console.error('请设环境变量 ADSPOWER_API_KEY（AdsPower 客户端 → 设置 → 应用程序服务接口）');
  process.exit(1);
}
const headers = { 'Authorization': `Bearer ${API_KEY}` };

export async function adspowerStop(userId) {
  const r = await fetch(`${ADSPOWER_API}/api/v1/browser/stop?user_id=${userId}`, { headers }).then(r => r.json());
  if (r.code !== 0 && r.msg !== 'Browser is not opened') throw new Error(`stop failed: ${r.msg}`);
  return r;
}

export async function adspowerStart(userId, opts = {}) {
  const params = new URLSearchParams({
    user_id: userId,
    open_tabs: opts.open_tabs ?? '1',
    headless: opts.headless ?? '0',
    ip_tab: opts.ip_tab ?? '0',
  });
  const r = await fetch(`${ADSPOWER_API}/api/v1/browser/start?${params}`, { headers }).then(r => r.json());
  if (r.code !== 0) throw new Error(`start failed: ${r.msg}`);
  return r.data.ws.puppeteer;   // 新 ws URL
}

export async function adspowerActive(userId) {
  const r = await fetch(`${ADSPOWER_API}/api/v1/browser/active?user_id=${userId}`, { headers }).then(r => r.json());
  return r.code === 0 && r.data?.status === 'Active' ? r.data.ws.puppeteer : null;
}

// CLI 测试
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const cmd = process.argv[2];
  const userId = process.argv[3] ?? 'k1bsgahl';
  if (cmd === 'stop') console.log(JSON.stringify(await adspowerStop(userId), null, 2));
  else if (cmd === 'start') console.log('ws:', await adspowerStart(userId));
  else if (cmd === 'active') console.log('ws:', await adspowerActive(userId));
  else if (cmd === 'restart') {
    await adspowerStop(userId).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    const ws = await adspowerStart(userId);
    console.log('new ws:', ws);
  }
  else console.log('用法: node _adspower.mjs <stop|start|active|restart> [userId]');
}
