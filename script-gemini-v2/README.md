# Script Gemini V2 — Veo Video Generator & Downloader

Folder ini berisi implementasi mandiri (standalone) client Google Gemini Web untuk membuat video berkualitas tinggi menggunakan **Google Veo** via Web RPC (`StreamGenerate` + `hNvQHb`), lengkap dengan parity payload 99-elemen dan unduh otomatis file `.mp4`.

---

## 📁 Struktur File

```
script-gemini-v2/
├── run_interactive.cjs         # 🌟 CLI Interaktif: Paste cURL mentah -> Validasi Akun -> Input Prompt -> Auto Generate & Download
├── generate_and_download.cjs   # CLI Cepat Langsung: node generate_and_download.cjs "Prompt" [nama_file.mp4]
├── config.cjs                  # Konfigurasi cookie & token yang tersimpan
├── payload_builder.cjs         # Generator array chatContext 99 elemen & header browser Chrome 156
├── gemini_stream.cjs           # Handler RPC StreamGenerate & polling render Google Veo
├── downloader.cjs              # Downloader MP4 dari Google Cloud Storage CDN (contribution.usercontent)
└── output/                     # Folder penampung video hasil render (.mp4)
```

---

## 🚀 Cara Menjalankan

### Cara 1: Mode Interaktif (Paling Mudah & Fleksibel) 🌟
Cukup jalankan satu perintah:
```bash
node script-gemini-v2/run_interactive.cjs
```
1. Paste cURL bash mentah dari akun Google mana saja (otomatis divalidasi).
2. Masukkan prompt video (tersedia contoh format 9:16 portrait dan 16:9 landscape).
3. Tekan Enter, sistem akan merender via Veo dan mendownload video MP4 ke folder `output/`.

### Cara 2: Mode Langsung (Menggunakan Akun Tersimpan)
```bash
node script-gemini-v2/generate_and_download.cjs "POV handheld walking through tropical garden, warm sunrise light, 4k" video_kebun.mp4
```
*(Prompt otomatis ditambahkan prefix `Generate video format 9:16` di depan).*
