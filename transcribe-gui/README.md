# 批量音视频转录工具（Python tkinter GUI）

一个零依赖（除 pip 三方库）的桌面工具，把任意音视频批量转录成文本。

![截图](#)

## 功能

- 📁 **批量处理**：选文件夹自动扫所有音视频，或逐个添加
- 🎵 **自动提取音轨**：mp4/mov/webm/mkv 等视频用 ffmpeg 自动转 mp3 喂给 API（无需手动转）
- 🌐 **任意 OpenAI Whisper 兼容 API**：默认 `aisever.cn`，可改成 OpenAI 官方 / SiliconFlow / Groq / 自托管 / 等
- 🌍 **多语言**：默认 Urdu (`ur`)，可下拉选 zh/en/hi/ar/ja/ko 或留空自动检测
- 💾 **配置持久化**：API URL/Key/Model/Language 点"保存为默认"后写到 `config.json`，下次自动加载
- 📦 **两种输出**：
  - 合并：`transcripts.txt`（按 `=== 文件名 ===` 分段）
  - 分散：每个文件单独 `<name>.transcript.txt`
- ⏸ **可取消**：长任务中途随时停
- 🪟 **支持中文路径**

## 安装

```bash
pip install -r requirements.txt
```

包含两个依赖：
- `requests` — HTTP 客户端
- `imageio-ffmpeg` — 自带 ffmpeg.exe 二进制，**无需系统装 ffmpeg**

## 运行

```bash
python transcribe_gui.py
```

## 配置

### 默认 API（aisever.cn 中转）

| 字段 | 默认值 |
|------|--------|
| URL | `https://api.aisever.cn/v1/audio/transcriptions` |
| Model | `gpt-4o-transcribe` |
| Language | `ur` |
| Key | （需自己填）|

### 改成 OpenAI 官方

| 字段 | 值 |
|------|--------|
| URL | `https://api.openai.com/v1/audio/transcriptions` |
| Model | `gpt-4o-transcribe` 或 `whisper-1` |
| Key | OpenAI sk-... |

### 改成 Groq（免费 + 快）

| 字段 | 值 |
|------|--------|
| URL | `https://api.groq.com/openai/v1/audio/transcriptions` |
| Model | `whisper-large-v3` |
| Key | Groq gsk_... |

### 改成 SiliconFlow（国内便宜）

| 字段 | 值 |
|------|--------|
| URL | `https://api.siliconflow.cn/v1/audio/transcriptions` |
| Model | `FunAudioLLM/SenseVoiceSmall` 或 `iic/SenseVoiceLarge` |
| Key | sk-... |

## 使用流程

1. 打开应用，第一次填 API Key 后点 **保存为默认**
2. 点 **选择文件夹** 或 **添加文件**
3. 选输出方式（合并 vs 分散）
4. 点 **开始转录**
5. 看进度条 / 日志
6. 完成后在原文件夹查看 `transcripts.txt` 或 `*.transcript.txt`

## 工作原理

```
你选的视频文件
    ↓
imageio-ffmpeg 提取音轨 → 16kHz mono 64kbps mp3（temp 文件）
    ↓
HTTP POST multipart/form-data
    Authorization: Bearer ${API_KEY}
    ↓
Whisper 兼容 API → JSON {"text": "..."}
    ↓
写入 transcripts.txt
```

## 已知问题

- **极长视频**（>50MB mp3）某些 API 会拒。本工具默认提取 16k mono 64kbps，1 小时 ≈ 28MB，安全
- **Urdu 转录**：模型对 N999 / Dream17 等品牌名识别可能漏听字符（"N999" → "N99"），但不影响整体语义
- **中文**：路径含中文 OK，但某些 ffmpeg 二进制对极特殊字符可能出错

## 版本

v0.1.0 — 2026-05-08
