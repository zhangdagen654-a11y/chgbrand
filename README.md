# chgbrand — Google Flow 自动化品牌换皮工具

通过 **Playwright + AdsPower CDP** 自动化操作 Google Flow（labs.google/fx/tools/flow），实现：
- **图片生成**（Nano Banana Pro × N，并行批量）
- **视频生成**（Veo 3.1 Frames 模式带首帧引导）
- **视频品牌换皮**（提取末段 → 转录 → 替换品牌 logo + Veo 重生 → 拼接还原）
- **风控全自动自愈**（IP 切换 + 浏览器重启 + OAuth 自动重登）

## 核心文档

**`google-flow.skill.md`** —— 这是项目的灵魂。**写任何新脚本前必须先读一遍**（铁律 0）。
里面记录了所有踩过的坑、验证过的选择器、Flow 网页的正确操作链路。

## 快速开始

### 依赖

```bash
cd 抽卡输出
npm install   # 安装 playwright-core + ffmpeg-static
```

### 必须的环境变量

| 变量 | 说明 |
|------|------|
| `ADSPOWER_API_KEY` | AdsPower 客户端 → 设置 → 应用程序服务接口 → 复制 Key |
| `TRANSCRIBE_KEY` | Whisper 兼容服务的 API key（默认指向 aisever.cn） |
| `WS` | Playwright 接管的浏览器 ws，启动 AdsPower 后获取 |
| `PROFILE_ID` | AdsPower 浏览器环境 ID（如 `k1bsgahl`） |
| `PROJECT_URL` | Flow 项目 URL `https://labs.google/fx/tools/flow/project/{uuid}` |

PowerShell 设置：
```powershell
$env:ADSPOWER_API_KEY = '你的_key'
$env:TRANSCRIBE_KEY = '你的_key'
$env:WS = 'ws://127.0.0.1:xxxxx/devtools/browser/...'
```

## 主要脚本

### 单 prompt 生图
```bash
$env:PROMPT = 'a red apple on a table'
$env:OUT_DIR = 'D:\out'
node 抽卡输出/flow_run.mjs
```

### 批量并行生图（核心：HTTP 响应配对 UUID）
```bash
# 编辑 prompts.json 后
node 抽卡输出/flow_batch_parallel.mjs
```

### 视频生成
```bash
$env:REF_IMG = 'D:\frame.png'
$env:PROMPT = 'the seed glows...'
$env:DURATION = '8s'   # 4s/6s/8s
$env:MODEL = 'Veo 3.1 - Fast'
node 抽卡输出/flow_veo_run.mjs
```

### 品牌换皮一键流程
```bash
$env:BRAND_POOL = 'N999,W33,SPN,Dream17'
$env:ROLE = '男人'   # 视频里拿手机的角色
node 抽卡输出/brand_swap.mjs <input.mp4>
```

流程：截末 8s 音频 → 转录 → 识别原品牌 → 截参考帧 → 截前段 → Veo 生成新品牌末段 → 拼接还原

### 带风控自愈的单品牌生成
```bash
$env:REF = 'D:\ref.jpg'
$env:TAIL_OUT = 'D:\tail_W33.mp4'
$env:TRANSCRIPT = 'Urdu transcript...'
$env:ORIG_BRAND_REGEX = 'N999'
$env:ROLE = '男人'
node 抽卡输出/_step_brand_robust.mjs W33
```

风控触发自动：Clash 切节点 + AdsPower 重启 + 重连 OAuth → 重试（最多 3 次）

## 三条铁律（详见 Skill 文件）

1. **prompt 输入** 必须 Playwright `locator.fill()`（CDP keyboard，trusted），不能 `document.execCommand`
2. **生成按钮点击** 必须 Playwright `locator.click()`（CDP mouse，trusted），不能 `el.click()`
3. **文件上传** 必须 `page.setInputFiles()`（CDP `DOM.setFileInputFiles`），不能 JS 注入 `input.files`

React 17+ 检查 `event.isTrusted`，纯 JS 合成事件一律忽略。

## 架构

```
┌─ 浏览器层 ──────────────────────
│  AdsPower（反指纹隔离）
│  ↓ Chrome DevTools Protocol
│  Playwright-core 1.59
│
├─ 控制层 ────────────────────────
│  AdsPower HTTP API  Bearer ${KEY}
│  → /api/v1/browser/{start,stop,active}
│
├─ 网络层 ────────────────────────
│  Clash Verge Rev / verge-mihomo
│  ↓ Windows Named Pipe \\.\pipe\verge-mihomo
│  PUT /proxies/GLOBAL（global 模式必须切 GLOBAL 组）
│
├─ 媒体处理 ──────────────────────
│  ffmpeg-static（内置二进制）
│  Whisper 兼容 API（gpt-4o-transcribe）
│
└─ 编排 ──────────────────────────
   Node.js 脚本 — 硬编码选择器 + 死代码
   不是 Agent 浏览器：选择器预先探索锁定
```

## 已知坑（详见 Skill）

- **Clash 全局模式必须切 `GLOBAL` 组**（不是 `🚀 节点选择`，那个在 global 模式下是摆设）
- **节点轮换只用同国家**（混国家会让 Google 触发 IP 突变风控）
- **节点池要够大**（同 IP 反复用会被标，建议 9+ 美国节点：4 普通 + 3 家宽 + 2 备用）
- **参考帧不能含赌博 logo**（Veo 内容审核会 silent reject，必须 ffmpeg drawbox 遮黑）
- **Flow 营销首页 fallback**：DOM 没 `[data-slate-editor]` 且 body 含 "Create with Flow" → 点击 → OAuth 自动选账号
- **视频缩略图 lazy-load**：主网格视频卡片 img.src 默认不加载，hover 才渲染。脚本要等 +1 卡片 + hover 第 0 个 + 拿 video.src

## 法律 / 合规

本项目仅作技术研究演示，请勿用于：
- 违反 Google Flow / Veo Terms of Service 的批量自动化
- 制作虚假宣传 / 仿冒品牌内容
- 任何违反当地法律的用途

使用本工具产生的所有后果由使用者自负。

## License

仅供个人技术研究学习，请勿用于商业用途。
