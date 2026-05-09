# -*- coding: utf-8 -*-
"""
批量音视频转录 GUI 工具
- 支持任意 OpenAI Whisper 兼容 API（默认 aisever.cn）
- 自动 ffmpeg 提取音轨
- 多文件批处理 / 进度条 / 取消 / 日志 / 配置保存
"""
import os
import json
import threading
import queue
import subprocess
import tempfile
import time
from pathlib import Path
from tkinter import (
    Tk, ttk, filedialog, messagebox,
    StringVar, BooleanVar, IntVar, scrolledtext,
    END, DISABLED, NORMAL,
)

try:
    import requests
except ImportError:
    raise SystemExit("缺少依赖。请先：pip install -r requirements.txt")

# ffmpeg：优先用 imageio-ffmpeg 自带二进制，否则系统 ffmpeg
try:
    import imageio_ffmpeg
    FFMPEG_BIN = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    FFMPEG_BIN = "ffmpeg"

CONFIG_FILE = Path(__file__).parent / "config.json"

DEFAULT_CONFIG = {
    "api_url": "https://api.aisever.cn/v1/audio/transcriptions",
    "api_key": "",
    "model": "gpt-4o-transcribe",
    "language": "ur",
}

AUDIO_VIDEO_EXTS = {
    ".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v",
    ".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg",
}


class TranscribeApp:
    def __init__(self, root: Tk):
        self.root = root
        self.root.title("批量音视频转录工具")
        self.root.geometry("860x720")
        self.root.minsize(700, 600)

        self.config = self.load_config()
        self.files: list[str] = []
        self.cancel_flag = threading.Event()
        self.log_queue: "queue.Queue[str]" = queue.Queue()

        self._build_ui()
        self.root.after(100, self._poll_log_queue)

    # ---------- 配置 ----------
    def load_config(self) -> dict:
        if CONFIG_FILE.exists():
            try:
                disk = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
                return {**DEFAULT_CONFIG, **disk}
            except Exception:
                pass
        return DEFAULT_CONFIG.copy()

    def save_config(self):
        cfg = {
            "api_url": self.api_url_var.get(),
            "api_key": self.api_key_var.get(),
            "model": self.model_var.get(),
            "language": self.lang_var.get(),
        }
        CONFIG_FILE.write_text(
            json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        self.log(f"[配置] 已保存 → {CONFIG_FILE.name}")

    # ---------- UI ----------
    def _build_ui(self):
        # === API 设置 ===
        api = ttk.LabelFrame(self.root, text="API 设置", padding=10)
        api.pack(fill="x", padx=10, pady=(10, 5))

        ttk.Label(api, text="URL:").grid(row=0, column=0, sticky="w", pady=2)
        self.api_url_var = StringVar(value=self.config["api_url"])
        ttk.Entry(api, textvariable=self.api_url_var).grid(
            row=0, column=1, columnspan=3, sticky="ew", padx=5
        )

        ttk.Label(api, text="API Key:").grid(row=1, column=0, sticky="w", pady=2)
        self.api_key_var = StringVar(value=self.config["api_key"])
        self.api_key_entry = ttk.Entry(api, textvariable=self.api_key_var, show="•")
        self.api_key_entry.grid(row=1, column=1, columnspan=2, sticky="ew", padx=5)
        self.show_key_var = BooleanVar(value=False)
        ttk.Checkbutton(
            api, text="显示", variable=self.show_key_var,
            command=self._toggle_key_visible,
        ).grid(row=1, column=3, sticky="w", padx=5)

        ttk.Label(api, text="模型:").grid(row=2, column=0, sticky="w", pady=2)
        self.model_var = StringVar(value=self.config["model"])
        ttk.Combobox(
            api, textvariable=self.model_var, width=22,
            values=["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1", "whisper-large-v3"],
        ).grid(row=2, column=1, sticky="w", padx=5)

        ttk.Label(api, text="语言:").grid(row=2, column=2, sticky="e", padx=(10, 2))
        self.lang_var = StringVar(value=self.config["language"])
        ttk.Combobox(
            api, textvariable=self.lang_var, width=10,
            values=["", "ur", "en", "zh", "hi", "ar", "ja", "ko"],
        ).grid(row=2, column=3, sticky="w", padx=5)

        ttk.Button(api, text="保存为默认", command=self.save_config).grid(
            row=3, column=1, sticky="w", pady=(8, 0)
        )

        api.columnconfigure(1, weight=1)

        # === 文件 ===
        f = ttk.LabelFrame(self.root, text="待转录文件", padding=10)
        f.pack(fill="both", expand=True, padx=10, pady=5)

        btns = ttk.Frame(f)
        btns.pack(fill="x")
        ttk.Button(btns, text="📁 选择文件夹", command=self.pick_folder).pack(
            side="left", padx=2
        )
        ttk.Button(btns, text="📄 添加文件", command=self.pick_files).pack(
            side="left", padx=2
        )
        ttk.Button(btns, text="🗑 清空", command=self.clear_files).pack(
            side="left", padx=2
        )
        self.count_var = StringVar(value="0 个文件")
        ttk.Label(btns, textvariable=self.count_var).pack(side="right", padx=5)

        self.file_list = scrolledtext.ScrolledText(f, height=10, font=("Consolas", 9))
        self.file_list.pack(fill="both", expand=True, pady=5)
        self.file_list.config(state=DISABLED)

        # === 输出选项 ===
        out = ttk.LabelFrame(self.root, text="输出", padding=10)
        out.pack(fill="x", padx=10, pady=5)
        self.merge_var = IntVar(value=1)
        ttk.Radiobutton(
            out,
            text="合并为单个 transcripts.txt（按文件分段，带 === 文件名 ===）",
            variable=self.merge_var, value=1,
        ).pack(anchor="w")
        ttk.Radiobutton(
            out,
            text="每个文件单独输出 <文件名>.transcript.txt",
            variable=self.merge_var, value=0,
        ).pack(anchor="w")

        # === 操作 + 进度 ===
        op = ttk.Frame(self.root)
        op.pack(fill="x", padx=10, pady=5)
        self.start_btn = ttk.Button(op, text="▶ 开始转录", command=self.start)
        self.start_btn.pack(side="left", padx=2)
        self.cancel_btn = ttk.Button(op, text="■ 取消", command=self.cancel, state=DISABLED)
        self.cancel_btn.pack(side="left", padx=2)

        self.status_var = StringVar(value="就绪")
        ttk.Label(self.root, textvariable=self.status_var).pack(padx=10, anchor="w", pady=(5, 0))
        self.progress = ttk.Progressbar(self.root, mode="determinate", maximum=100)
        self.progress.pack(fill="x", padx=10, pady=2)

        # === 日志 ===
        log_f = ttk.LabelFrame(self.root, text="日志", padding=5)
        log_f.pack(fill="both", expand=True, padx=10, pady=(5, 10))
        self.log_box = scrolledtext.ScrolledText(log_f, height=8, font=("Consolas", 9))
        self.log_box.pack(fill="both", expand=True)
        self.log_box.config(state=DISABLED)

    def _toggle_key_visible(self):
        self.api_key_entry.config(show="" if self.show_key_var.get() else "•")

    # ---------- 日志 ----------
    def log(self, msg: str):
        self.log_queue.put(f"[{time.strftime('%H:%M:%S')}] {msg}")

    def _poll_log_queue(self):
        while True:
            try:
                msg = self.log_queue.get_nowait()
            except queue.Empty:
                break
            self.log_box.config(state=NORMAL)
            self.log_box.insert(END, msg + "\n")
            self.log_box.see(END)
            self.log_box.config(state=DISABLED)
        self.root.after(100, self._poll_log_queue)

    # ---------- 文件管理 ----------
    def _refresh_file_list(self):
        self.file_list.config(state=NORMAL)
        self.file_list.delete(1.0, END)
        for i, f in enumerate(self.files, 1):
            try:
                mb = os.path.getsize(f) / 1024 / 1024
            except OSError:
                mb = -1
            self.file_list.insert(
                END, f"{i:3}. {os.path.basename(f):<40}  {mb:>7.2f} MB  {os.path.dirname(f)}\n"
            )
        self.file_list.config(state=DISABLED)
        self.count_var.set(f"{len(self.files)} 个文件")

    def pick_folder(self):
        d = filedialog.askdirectory(title="选择含音视频的文件夹")
        if not d:
            return
        added = 0
        for p in sorted(Path(d).iterdir()):
            if p.is_file() and p.suffix.lower() in AUDIO_VIDEO_EXTS:
                if str(p) not in self.files:
                    self.files.append(str(p))
                    added += 1
        self.log(f"[文件夹] 添加 {added} 个 ← {d}")
        self._refresh_file_list()

    def pick_files(self):
        files = filedialog.askopenfilenames(
            title="添加音视频文件",
            filetypes=[
                ("音视频", "*.mp4 *.mov *.webm *.mkv *.avi *.m4v *.mp3 *.wav *.flac *.m4a *.aac *.ogg"),
                ("所有文件", "*.*"),
            ],
        )
        added = 0
        for f in files:
            if f not in self.files:
                self.files.append(f)
                added += 1
        if added:
            self.log(f"[文件] 添加 {added} 个")
        self._refresh_file_list()

    def clear_files(self):
        self.files.clear()
        self._refresh_file_list()
        self.log("[清空] 文件列表已清空")

    # ---------- 任务控制 ----------
    def start(self):
        if not self.files:
            messagebox.showwarning("提示", "请先添加文件")
            return
        api_key = self.api_key_var.get().strip()
        if not api_key:
            messagebox.showerror("错误", "请填写 API Key")
            return
        api_url = self.api_url_var.get().strip()
        if not api_url:
            messagebox.showerror("错误", "请填写 API URL")
            return

        self.cancel_flag.clear()
        self.start_btn.config(state=DISABLED)
        self.cancel_btn.config(state=NORMAL)
        threading.Thread(target=self._run_batch, daemon=True).start()

    def cancel(self):
        self.cancel_flag.set()
        self.log("[取消] 已请求取消，等待当前文件完成…")

    # ---------- 转录主流程（在工作线程里跑） ----------
    def _run_batch(self):
        api_url = self.api_url_var.get().strip()
        api_key = self.api_key_var.get().strip()
        model = self.model_var.get().strip()
        language = self.lang_var.get().strip()
        merge = bool(self.merge_var.get())

        results: list[tuple[str, str, bool]] = []  # (file, text, ok)
        total = len(self.files)
        try:
            for i, f in enumerate(self.files, 1):
                if self.cancel_flag.is_set():
                    self.log(f"[取消] 在 {i}/{total} 处终止")
                    break

                self.status_var.set(f"[{i}/{total}] {os.path.basename(f)} 转录中…")
                self.progress["value"] = ((i - 1) / total) * 100

                t0 = time.time()
                ok = False
                text = ""
                try:
                    audio = self._extract_audio(f)
                    text = self._transcribe(audio, api_url, api_key, model, language)
                    if audio != f:
                        try: os.unlink(audio)
                        except OSError: pass
                    ok = True
                    self.log(f"[{i}/{total}] {os.path.basename(f)} ✅ {time.time()-t0:.1f}s")
                except Exception as e:
                    text = f"[ERROR] {e}"
                    self.log(f"[{i}/{total}] {os.path.basename(f)} ❌ {e}")

                results.append((f, text, ok))

                # 单独模式：立即落盘
                if not merge and ok:
                    out = Path(f).with_suffix("").with_suffix(".transcript.txt")
                    out.write_text(text, encoding="utf-8")
                    self.log(f"  💾 {out.name}")

            # 合并模式：写汇总
            if merge and results:
                # 输出目录：所有文件公共目录，否则用第一个
                dirs = set(os.path.dirname(f) for f, _, _ in results)
                out_dir = dirs.pop() if len(dirs) == 1 else os.path.dirname(results[0][0])
                out_path = os.path.join(out_dir, "transcripts.txt")
                with open(out_path, "w", encoding="utf-8") as fp:
                    for f, text, ok in results:
                        fp.write(f"=== {os.path.basename(f)} ===\n{text}\n\n")
                self.log(f"💾 汇总 → {out_path}")

            ok_count = sum(1 for _, _, o in results if o)
            self.status_var.set(f"完成 {ok_count}/{total} 成功")
        finally:
            self.progress["value"] = 100
            self.start_btn.config(state=NORMAL)
            self.cancel_btn.config(state=DISABLED)

    def _extract_audio(self, src: str) -> str:
        ext = Path(src).suffix.lower()
        if ext in {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"}:
            return src
        # 视频 → mp3 (16k mono 64kbps，Whisper 优化)
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
        tmp.close()
        cmd = [
            FFMPEG_BIN, "-y", "-i", src,
            "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k",
            "-loglevel", "error", tmp.name,
        ]
        r = subprocess.run(cmd, capture_output=True, timeout=600)
        if r.returncode != 0:
            err = r.stderr.decode("utf-8", errors="ignore")[:200]
            raise RuntimeError(f"ffmpeg: {err}")
        return tmp.name

    def _transcribe(
        self, audio: str, api_url: str, api_key: str, model: str, language: str
    ) -> str:
        with open(audio, "rb") as fp:
            files = {"file": (os.path.basename(audio), fp, "audio/mpeg")}
            data = {"model": model}
            if language:
                data["language"] = language
            headers = {"Authorization": f"Bearer {api_key}"}
            resp = requests.post(api_url, headers=headers, files=files, data=data, timeout=180)
        if resp.status_code != 200:
            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")
        try:
            return resp.json().get("text", "").strip()
        except ValueError:
            # 非 JSON 响应（response_format=text）
            return resp.text.strip()


def main():
    root = Tk()
    try:
        # Windows 高 DPI 支持
        from ctypes import windll
        windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass
    app = TranscribeApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
