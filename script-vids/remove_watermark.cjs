/**
 * =========================================================================================
 * GOOGLE VIDS — HAPUS WATERMARK (badge AI 4-sudut) DARI VIDEO
 * =========================================================================================
 * Video hasil Google Vids memuat badge AI (bintang/belah ketupat 4 sudut, semi transparan)
 * yang di-burn ke dalam piksel di posisi statis. File ini:
 *   1. MENCARI badge secara otomatis lewat analisis temporal (median antar-frame),
 *   2. Membentuk mask siluetnya,
 *   3. Menambal area itu dengan filter `removelogo` ffmpeg (interpolasi piksel, BUKAN crop).
 *
 * Pakai:
 *   node script-vids/remove_watermark.cjs <input.mp4> [output.mp4]
 *   node script-vids/remove_watermark.cjs <input.mp4> [output.mp4] --box x,y,w,h
 *   node script-vids/remove_watermark.cjs <input.mp4> [output.mp4] --google-vids
 *   node script-vids/remove_watermark.cjs <input.mp4> [output.mp4] --detect-all
 *
 * Mode:
 *   --google-vids  Posisi badge dihitung dari geometri (min(W,H)/6 dari pojok kanan-bawah).
 *                  Cocok untuk video native Google Vids (9:16 maupun 16:9).
 *   --detect-all   Deteksi otomatis SEMUA badge di video. Memotong video per scene-cut,
 *                  lalu mencari kandidat overlay statis di tiap segmen. Wajib untuk hasil
 *                  Video Stitcher, karena tiap klip bisa punya rasio berbeda sehingga badge
 *                  muncul di lebih dari satu posisi.
 *   (default)     Deteksi otomatis satu kandidat terbaik (median global).
 *
 * Tanpa argumen: memakai file video terbaru di folder ini.
 * =========================================================================================
 */

const { execFileSync, execSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

/** Jarak antar frame yang dianalisis (1 = semua frame). */
const SAMPLE_EVERY = 4;

// ------------------------------------------------------------------ util
function findFfmpeg() {
  const local = path.join(REPO_ROOT, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(local)) return local;
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return 'ffmpeg';
  } catch (e) {
    return null;
  }
}

function ffmpegRun(ffmpeg, args, label, cwd) {
  process.stdout.write(`   ${label} ...`);
  try {
    execFileSync(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'], cwd });
    console.log(' OK');
    return true;
  } catch (e) {
    console.log(' GAGAL');
    if (e.stderr) console.error(String(e.stderr).split('\n').slice(-6).join('\n'));
    return false;
  }
}

function probeVideo(ffmpeg, file) {
  let out = '';
  try {
    execFileSync(ffmpeg, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    out = String(e.stderr || '');
  }
  const dim = out.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  const fps = out.match(/(\d+(?:\.\d+)?) fps/);
  const dur = out.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  let seconds = 0;
  if (dur) seconds = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
  return {
    width: dim ? Number(dim[1]) : 0,
    height: dim ? Number(dim[2]) : 0,
    fps: fps ? Number(fps[1]) : 24,
    duration: seconds,
  };
}

// ------------------------------------------------------------------ analisis temporal
/**
 * Jalankan ffmpeg dan tangkap stderr-nya (dipakai untuk parsing log filter
 * seperti `showinfo` / `scdet`). Tidak menggandakan frame.
 */
function ffmpegCapture(ffmpeg, args) {
  const res = spawnSync(ffmpeg, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: res.status === 0, stderr: res.stderr || '' };
}

/**
 * Buang frame grayscale ke buffer mentah, sekaligus kumpulkan waktu (pts) tiap frame.
 *
 * PENTING: pakai `-fps_mode passthrough`. Tanpa itu ffmpeg menyalin frame agar
 * keluarannya CFR, sehingga jumlah frame di buffer tidak lagi sama dengan jumlah
 * frame yang benar-benar dianalisis dan indeks frame tidak bisa dipetakan ke waktu.
 */
function dumpGray(ffmpeg, input, outFile, opts) {
  const vf = [];
  if (opts.crop) vf.push(`crop=${opts.crop}`);
  if (opts.scale) vf.push(`scale=${opts.scale}`);
  vf.push(`select='not(mod(n\\,${opts.every}))'`, 'format=gray', 'showinfo');
  process.stdout.write('   dump frame grayscale ...');
  const res = ffmpegCapture(ffmpeg, [
    '-y', '-i', input, '-vf', vf.join(','), '-fps_mode', 'passthrough',
    '-f', 'rawvideo', '-pix_fmt', 'gray', outFile,
  ]);
  if (!res.ok) {
    console.log(' GAGAL');
    const tail = String(res.stderr).split('\n').slice(-6).join('\n');
    if (tail) console.error(tail);
    return { ok: false, times: [] };
  }
  console.log(' OK');
  const times = [];
  const re = /pts_time:([\d.]+)/g;
  let m;
  while ((m = re.exec(res.stderr)) !== null) times.push(Number(m[1]));
  return { ok: true, times };
}

/**
 * Temporal median per piksel untuk sekumpulan frame.
 * ranges: array [start, end) dalam indeks frame hasil sampling.
 */
function temporalMedianRanges(buf, w, h, ranges) {
  const fs_ = w * h;
  const med = new Float32Array(fs_);
  const vals = [];
  let frameCount = 0;
  for (let i = 0; i < fs_; i++) {
    vals.length = 0;
    for (const [start, end] of ranges) {
      for (let f = start; f < end; f++) vals.push(buf[f * fs_ + i]);
    }
    vals.sort((a, b) => a - b);
    med[i] = vals.length ? vals[vals.length >> 1] : 0;
    frameCount = vals.length;
  }
  return { med, frames: frameCount };
}

/** Box blur separable, R iterasi ~ gaussian */
function boxBlur(src, w, h, radius, passes = 3) {
  let cur = Float32Array.from(src);
  const R = radius;
  for (let p = 0; p < passes; p++) {
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, c = 0;
        for (let k = -R; k <= R; k++) {
          const xx = x + k;
          if (xx < 0 || xx >= w) continue;
          s += cur[y * w + xx];
          c++;
        }
        tmp[y * w + x] = s / c;
      }
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, c = 0;
        for (let k = -R; k <= R; k++) {
          const yy = y + k;
          if (yy < 0 || yy >= h) continue;
          s += tmp[yy * w + x];
          c++;
        }
        out[y * w + x] = s / c;
      }
    }
    cur = out;
  }
  return cur;
}

function dilate(mask, w, h, radius) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && xx < w && yy >= 0 && yy < h) out[yy * w + xx] = 1;
        }
      }
    }
  }
  return out;
}

/** Flood fill dari tepi -> area "luar" */
function fillOutside(mask, w, h) {
  const outside = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const i = y * w + x;
    if (outside[i] || mask[i]) return;
    outside[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return outside;
}

/**
 * Geometri badge Google Vids.
 *
 * Badge (bintang 4 sudut) duduk di pojok kanan-bawah, dengan jarak dari tepi
 * kanan & bawah yang diskalakan dari SISI TERPENDek video, bukan dari lebar
 * atau tinggi masing-masing:
 *   - 1080x1920 (9:16): center (899.5, 1739.5) -> jarak pojok 180 px
 *   - 1280x720  (16:9) : center (1159.5, 599.5)  -> jarak pojok 120 px
 *   - 1920x1080 (16:9 stitched): center (1740, 900)
 * Keduanya = min(W,H)/6. Jari-jari badge = min(W,H) * 0.035.
 *
 * CATATAN: jangan pakai fraksi W*5/6 & H*29/32 -- itu hanya kebetulan cocok
 * di 9:16 dan meleset ~93 px di 16:9 sehingga badge tidak terhapus.
 */
function badgeGeometry(width, height) {
  const m = Math.min(width, height);
  return {
    centerX: width - m / 6,
    centerY: height - m / 6,
    radius: Math.max(1, Math.round(m * 0.035)),
  };
}

function bbox(mask, w, h) {
  let minx = Infinity, maxx = -1, miny = Infinity, maxy = -1, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      count++;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
  }
  return { minx, maxx, miny, maxy, count };
}

// ------------------------------------------------------------------ deteksi scene cut
/**
 * Deteksi titik potong adegan (hard cut) memakai filter `scdet`.
 * Hasilnya dipakai untuk membagi video jadi segmen: masing-masing segmen
 * berisi satu klip, sehingga median temporal per segmen tidak saling meniadakan
 * badge yang posisinya beda antar klip.
 */
function detectSceneCuts(ffmpeg, input) {
  const res = ffmpegCapture(ffmpeg, [
    '-hide_banner', '-nostats', '-i', input, '-vf', 'scdet=threshold=6', '-f', 'null', '-',
  ]);
  const times = [];
  const re = /lavfi\.scd\.time:\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(res.stderr)) !== null) times.push(Number(m[1]));
  return times.sort((a, b) => a - b);
}

/**
 * Bagi timeline jadi segmen berdasarkan scene cut.
 * Cut yang berdekatan (< 0.3s) digabung, dan video tanpa cut jadi 1 segmen.
 */
function buildSegments(cuts, duration) {
  const segs = [];
  let prev = 0;
  for (const c of cuts) {
    if (c <= prev + 0.3) continue;
    if (c >= duration - 0.05) break;
    segs.push([prev, c]);
    prev = c;
  }
  if (prev < duration - 0.05) segs.push([prev, duration]);
  return segs.length ? segs : [[0, Math.max(duration, 0.1)]];
}

/**
 * Cari komponen terhubung pada mask biner, lalu filter yang "kayak watermark":
 * ukuran wajar, proporsi mendekati persegi, fill rate tidak ekstrem, residual kuat.
 */
function findCandidates(coarse, res, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const comps = [];
  for (let i = 0; i < coarse.length; i++) {
    if (!coarse[i] || labels[i] !== -1) continue;
    const id = comps.length;
    const stack = [i];
    labels[i] = id;
    const px = [];
    while (stack.length) {
      const j = stack.pop();
      px.push(j);
      const x = j % w, y = (j / w) | 0;
      const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of nb) {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const k = ny * w + nx;
        if (coarse[k] && labels[k] === -1) {
          labels[k] = id;
          stack.push(k);
        }
      }
    }
    comps.push(px);
  }

  const out = [];
  for (const px of comps) {
    let strength = -1e9, minx = w, maxx = -1, miny = h, maxy = -1;
    for (const j of px) {
      if (res[j] > strength) strength = res[j];
      const x = j % w, y = (j / w) | 0;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
    const bw = maxx - minx + 1, bh = maxy - miny + 1;
    if (bw < 5 || bh < 5 || bw > 45 || bh > 45) continue; // terlalu kecil / terlalu besar
    const ar = bw / bh;
    if (ar < 0.5 || ar > 2) continue; // bukan proporsi persegi
    const fill = px.length / (bw * bh);
    if (fill < 0.12 || fill > 0.85) continue; // bukan bentuk padat
    out.push({ minx, maxx, miny, maxy, strength, fill, area: px.length });
  }
  return out;
}

// ------------------------------------------------------------------ deteksi area konten
/**
 * Tentukan area konten di dalam frame.
 *
 * Video Stitcher memakai `scale=...:force_original_aspect_ratio=decrease,pad=...`
 * sehingga klip dengan rasio berbeda diberi bar hitam (letterbox/pillarbox).
 * Area konten = kotak yang tersisa setelah bar hitam itu dibuang.
 *
 * Kolom/row dianggap "bar" kalau seluruh isinya hitam (nilai <= BLACK).
 */
function detectContentRect(med, w, h, BLACK = 14) {
  const colBlack = new Array(w).fill(true);
  const rowBlack = new Array(h).fill(true);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (med[y * w + x] > BLACK) {
        colBlack[x] = false;
        rowBlack[y] = false;
      }
    }
  }
  let c0 = 0;
  while (c0 < w && colBlack[c0]) c0++;
  let c1 = w - 1;
  while (c1 >= 0 && colBlack[c1]) c1--;
  let r0 = 0;
  while (r0 < h && rowBlack[r0]) r0++;
  let r1 = h - 1;
  while (r1 >= 0 && rowBlack[r1]) r1--;
  if (c1 < c0 || r1 < r0) return { x: 0, y: 0, w, h };
  return { x: c0, y: r0, w: c1 - c0 + 1, h: r1 - r0 + 1 };
}

// ------------------------------------------------------------------ main
function main() {
  // ---- parse argumen
  const argv = process.argv.slice(2);
  const flags = new Set();
  const positional = [];
  let manualBoxes = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--box') {
      flags.add('box');
      const value = argv[++i] || '';
      manualBoxes = value.split(';').filter(Boolean).map((s) => s.split(',').map(Number));
    } else if (a === '--google-vids') {
      flags.add('gv');
    } else if (a === '--detect-all') {
      flags.add('all');
    } else {
      positional.push(a);
    }
  }
  const useGoogleVidsBadge = flags.has('gv');
  const detectAll = flags.has('all');

  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    console.error('❌ ffmpeg tidak ditemukan. Taruh di ./ffmpeg/ atau install di PATH.');
    process.exit(1);
  }

  // pilih input
  let input = positional[0];
  if (!input) {
    const vids = fs
      .readdirSync(SCRIPT_DIR)
      .filter((f) => f.endsWith('.mp4'))
      .map((f) => ({ f, t: fs.statSync(path.join(SCRIPT_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (!vids.length) {
      console.error('❌ Tidak ada file .mp4 di', SCRIPT_DIR);
      process.exit(1);
    }
    input = path.join(SCRIPT_DIR, vids[0].f);
    console.log('📂 Input (terbaru):', path.basename(input));
  }
  if (!fs.existsSync(input)) {
    console.error('❌ File tidak ditemukan:', input);
    process.exit(1);
  }

  const output =
    positional[1] || input.replace(/\.mp4$/i, '') + '_nowm' + path.extname(input || '.mp4');

  console.log('====================================================');
  console.log('🧽 GOOGLE VIDS — HAPUS WATERMARK');
  console.log('====================================================');
  console.log('Input :', input);
  console.log('Output:', output);

  const info = probeVideo(ffmpeg, input);
  console.log(`Resolusi: ${info.width}x${info.height} | Durasi: ${info.duration.toFixed(2)}s`);
  if (!info.width || !info.height) {
    console.error('❌ Gagal membaca info video.');
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vidswm-'));
  const grayFile = path.join(tmp, 'gray.raw');
  const maskFile = path.join(tmp, 'mask.pgm');

  try {
    /**
     * Daftar region yang akan ditambal.
     * each: { x, y, w, h, fixed?: boolean, ranges?: [[start,end), ...] }
     */
    let regions = [];

    if (manualBoxes.length) {
      regions = manualBoxes.map(([x, y, w, h]) => ({ x, y, w, h }));
      console.log('📌 Box manual dipakai:', JSON.stringify(regions));
    } else if (useGoogleVidsBadge) {
      const geo = badgeGeometry(info.width, info.height);
      const centerX = geo.centerX;
      const centerY = geo.centerY;
      const radius = geo.radius;
      // region generous supaya residual punya konteks untuk membentuk siluet bintang
      const half = Math.ceil(radius) + 45;
      const rx = Math.max(0, Math.round(centerX - half));
      const ry = Math.max(0, Math.round(centerY - half));
      regions = [{
        x: rx,
        y: ry,
        w: Math.min(info.width - rx, half * 2),
        h: Math.min(info.height - ry, half * 2),
        expect: { cx: centerX, cy: centerY, r: radius },
      }];
      console.log('📌 Memakai posisi badge Google Vids kanan-bawah (auto rasio).');
    } else {
      // ---------- PASS 1: cari kandidat di seluruh frame (skala kecil) ----------
      console.log('\n[1/3] Memindai frame untuk mencari overlay statis...');
      const SW = 270;
      const SH = Math.round((info.height / info.width) * SW);
      const dump = dumpGray(ffmpeg, input, grayFile, { scale: `${SW}:${SH}`, every: SAMPLE_EVERY });
      if (!dump.ok) {
        throw new Error('gagal dump frame');
      }
      const raw = fs.readFileSync(grayFile);
      const frameSize = SW * SH;
      const frameCount = Math.floor(raw.length / frameSize);
      console.log(`   frame dianalisis: ${frameCount}`);

      // waktu tiap frame hasil sampling (dari pts asli, bukan indeks buffer)
      const frameTimes = dump.times.length === frameCount ? dump.times : null;
      if (!frameTimes) {
        console.warn('   ⚠️ Waktu frame tidak terbaca, fallback ke hitungan fps.');
      }
      const fps = info.fps || 24;
      const timeOf = (idx) => (frameTimes ? frameTimes[idx] : (idx * SAMPLE_EVERY) / fps);

      // Segmentasi: satu segmen per scene-cut -> badge di tiap klip tidak saling meniadakan
      const cuts = detectSceneCuts(ffmpeg, input);
      const timeSegs = buildSegments(cuts, info.duration);
      console.log(
        `   scene cut: ${cuts.length ? cuts.map((c) => c.toFixed(2) + 's').join(', ') : 'tidak ada'} -> ${timeSegs.length} segmen`
      );

      const segRanges = timeSegs.map(([t0, t1]) => {
        let start = 0;
        let end = frameCount;
        for (let i = 0; i < frameCount; i++) {
          const t = timeOf(i);
          if (t < t0 - 1e-6) start = i + 1;
          if (t < t1 - 1e-6) end = i + 1;
        }
        if (end <= start) end = Math.min(frameCount, start + 1);
        return [start, end];
      });

      const scale = info.width / SW;

      if (detectAll) {
        // ---------- pendekatan: content rect + geometri badge ----------
        //
        // Pada hasil Video Stitcher tiap klip bisa punya rasio berbeda, sehingga
        // badge bisa muncul di LEBIH DARI SATU posisi. Badge selalu menempel di
        // pojok kanan-bawah area konten (bukan area frame), dengan jarak
        // min(sisi konten)/6. Jadi per segmen: tentukan area konten (deteksi bar
        // letterbox/pillarbox), lalu hitung posisi badge dari geometri itu.
        const seenCenters = [];
        for (let s = 0; s < segRanges.length; s++) {
          const range = segRanges[s];
          if (range[1] - range[0] < 2) continue;
          const { med } = temporalMedianRanges(raw, SW, SH, [range]);
          const rect = detectContentRect(med, SW, SH);
          const m = Math.min(rect.w, rect.h);
          const centerX = rect.x + rect.w - 1 - m / 6;
          const centerY = rect.y + rect.h - 1 - m / 6;
          const radius = Math.max(1, m * 0.035);
          const fullCx = centerX * scale;
          const fullCy = centerY * scale;
          const fullR = radius * scale;

          // segmen berbeda bisa memprediksi posisi yang sama -> cukup satu
          if (seenCenters.some((c) => Math.abs(c.cx - fullCx) < 40 && Math.abs(c.cy - fullCy) < 40)) {
            continue;
          }
          seenCenters.push({ cx: fullCx, cy: fullCy });

          const half = Math.ceil(fullR) + 45;
          const rx = Math.max(0, Math.round(fullCx - half));
          const ry = Math.max(0, Math.round(fullCy - half));
          const rw = Math.min(info.width - rx, half * 2);
          const rh = Math.min(info.height - ry, half * 2);
          regions.push({
            x: rx, y: ry, w: rw, h: rh,
            ranges: [range],
            expect: { cx: fullCx, cy: fullCy, r: fullR },
          });
          console.log(
            `   🎯 Segmen ${s + 1}: konten ${rect.w}x${rect.h} (skala) -> badge diprediksi di ${Math.round(fullCx)},${Math.round(fullCy)} r=${Math.round(fullR)}`
          );
        }
        if (!regions.length) {
          throw new Error('Tidak ada kandidat watermark yang terdeteksi; file asli tidak diubah.');
        }
      } else {
        // ---------- pendekatan lama: satu kandidat terbaik dari seluruh frame ----------
        /** @type {Map<string, {minx:number,maxx:number,miny:number,maxy:number,strength:number,ranges:Array<[number,number]>}>} */
        const merged = new Map();

        for (let s = 0; s < segRanges.length; s++) {
          const range = segRanges[s];
          if (range[1] - range[0] < 2) continue;
          const { med } = temporalMedianRanges(raw, SW, SH, [range]);
          const blur = boxBlur(med, SW, SH, 5, 3);
          const res = new Float32Array(SW * SH);
          let max = 0;
          for (let i = 0; i < res.length; i++) {
            res[i] = med[i] - blur[i];
            if (res[i] > max) max = res[i];
          }
          if (max < 8) continue;
          const coarse = new Uint8Array(SW * SH);
          for (let i = 0; i < coarse.length; i++) coarse[i] = res[i] > max * 0.4 ? 1 : 0;
          const cands = findCandidates(coarse, res, SW, SH);
          if (!cands.length) continue;

          for (const c of cands) {
            // kunci posisi: bucket 8px supaya kandidat di segmen berbeda dianggap sama
            const cx = Math.round((c.minx + c.maxx) / 2);
            const cy = Math.round((c.miny + c.maxy) / 2);
            const key = `${Math.round(cx / 8)}:${Math.round(cy / 8)}`;
            let entry = merged.get(key);
            if (!entry) {
              entry = {
                minx: c.minx, maxx: c.maxx, miny: c.miny, maxy: c.maxy,
                strength: c.strength, ranges: [],
              };
              merged.set(key, entry);
            } else {
              entry.minx = Math.min(entry.minx, c.minx);
              entry.maxx = Math.max(entry.maxx, c.maxx);
              entry.miny = Math.min(entry.miny, c.miny);
              entry.maxy = Math.max(entry.maxy, c.maxy);
              entry.strength = Math.max(entry.strength, c.strength);
            }
            entry.ranges.push(range);
          }
        }

        if (!merged.size) {
          throw new Error('Tidak ada kandidat watermark yang terdeteksi; file asli tidak diubah.');
        }

        const ordered = [...merged.values()].sort((a, b) => b.strength - a.strength);
        const picked = ordered.slice(0, 1);

        for (const p of picked) {
          const rx = Math.max(0, Math.round(p.minx * scale) - 60);
          const ry = Math.max(0, Math.round(p.miny * scale) - 60);
          const rw = Math.min(info.width - rx, Math.round((p.maxx - p.minx + 1) * scale) + 120);
          const rh = Math.min(info.height - ry, Math.round((p.maxy - p.miny + 1) * scale) + 120);
          regions.push({ x: rx, y: ry, w: rw, h: rh, ranges: p.ranges });
          console.log(
            `   🎯 Overlay statis terdeteksi di region x ${rx}-${rx + rw}, y ${ry}-${ry + rh} (strength ${p.strength.toFixed(1)})`
          );
        }
      }
    }

    // ---------- PASS 2: bangun mask presisi di resolusi penuh ----------
    console.log('\n[2/3] Membangun mask siluet watermark...');

    /**
     * Coba bangun mask untuk satu region.
     * Return { mask, bbox, max } kalau berhasil, atau { fail: '...' } kalau region-nya buruk.
     */
    function buildMask(reg) {
      const crop = dumpGray(ffmpeg, input, grayFile, {
        crop: `${reg.w}:${reg.h}:${reg.x}:${reg.y}`,
        // Untuk membentuk siluet badge dipakai SEMUA frame: median dari terlalu sedikit
        // frame jadi tidak stabil pada konten bertekstur (mis. kain), sehingga ambang
        // residual bergeser dan outline bintang pecah.
        every: reg.expect ? 1 : SAMPLE_EVERY,
      });
      if (!crop.ok) {
        return { fail: 'dump gagal' };
      }
      const raw2 = fs.readFileSync(grayFile);
      const localFrames = Math.floor(raw2.length / (reg.w * reg.h));
      const ranges = reg.ranges && reg.ranges.length ? reg.ranges : null;
      let useRanges = null;
      if (ranges) {
        useRanges = ranges.map(([s, e]) => [Math.min(s, localFrames), Math.min(e, localFrames)]);
        const total = useRanges.reduce((acc, [s, e]) => acc + (e - s), 0);
        if (total < 2) useRanges = null;
      }
      const { med: med2 } = temporalMedianRanges(
        raw2,
        reg.w,
        reg.h,
        useRanges || [[0, localFrames]]
      );

      // ---- mode geometri (google-vids / detect-all): posisi badge sudah pasti ----
      //
      // Badge Google Vids = bintang 4 ujung semi transparan. Kalau mask-nya persegi,
      // area yang ditambal jadi ~3x lebih besar dari badge aslinya dan hasilnya
      // terlihat seperti patch buram. Jadi residual dipakai untuk MENGGAMBAR siluet
      // bintangnya (bukan sekadar mengecek keberadaan), lalu flood fill dari luar
      // supaya bagian dalam bintang ikut terisi.
      if (reg.expect) {
        const expR = reg.expect.r;
        // Radius blur ~ 0.22 * radius badge: cukup besar untuk meratakan gradien,
        // tapi tetap jauh lebih kecil dari ukuran bintang itu sendiri.
        const R = Math.max(4, Math.min(14, Math.round(expR * 0.22)));
        const blur2 = boxBlur(med2, reg.w, reg.h, R);
        const res2 = new Float32Array(reg.w * reg.h);
        let max2 = 0;
        for (let i = 0; i < res2.length; i++) {
          res2[i] = med2[i] - blur2[i];
          if (res2[i] > max2) max2 = res2[i];
        }

        const boxHalf = Math.max(4, Math.ceil(expR * 2.0));
        const inBox = (x, y) =>
          Math.abs(reg.x + x + 0.5 - reg.expect.cx) <= boxHalf &&
          Math.abs(reg.y + y + 0.5 - reg.expect.cy) <= boxHalf;

        // peak residual DI DALAM kotak prediksi (bukan global, supaya konten lain
        // di luar area badge tidak menggeser ambang)
        let peak = 0;
        for (let y = 0; y < reg.h; y++) {
          for (let x = 0; x < reg.w; x++) {
            if (!inBox(x, y)) continue;
            const v = res2[y * reg.w + x];
            if (v > peak) peak = v;
          }
        }
        if (peak < 8) return { fail: `tidak ada overlay di posisi prediksi (peak ${peak.toFixed(1)})` };

        // --- langkah 1: gambar outline bintang dari residual ---
        const thr = peak * 0.35;
        let outline = new Uint8Array(reg.w * reg.h);
        let outlineCount = 0;
        for (let y = 0; y < reg.h; y++) {
          for (let x = 0; x < reg.w; x++) {
            if (!inBox(x, y)) continue;
            if (res2[y * reg.w + x] > thr) {
              outline[y * reg.w + x] = 1;
              outlineCount++;
            }
          }
        }

        if (outlineCount >= 20) {
          // closing: menutup celah kecil di outline
          outline = dilate(outline, reg.w, reg.h, Math.max(1, Math.round(R * 0.4)));
          // flood fill dari luar -> yang TIDAK terjangkau luar = interior bintang
          const outside = fillOutside(outline, reg.w, reg.h);
          const solid = new Uint8Array(reg.w * reg.h);
          for (let i = 0; i < solid.length; i++) solid[i] = outside[i] ? 0 : 1;
          const sb = bbox(solid, reg.w, reg.h);
          const scx = reg.x + (sb.minx + sb.maxx) / 2;
          const scy = reg.y + (sb.miny + sb.maxy) / 2;
          const halfW = (sb.maxx - sb.minx + 1) / 2;
          const halfH = (sb.maxy - sb.miny + 1) / 2;
          const tol = expR * 0.6 + 12;
          const ok =
            sb.count >= 30 &&
            sb.count <= reg.w * reg.h * 0.25 &&
            halfW >= expR * 0.45 && halfW <= expR * 1.6 &&
            halfH >= expR * 0.45 && halfH <= expR * 1.6 &&
            Math.abs(scx - reg.expect.cx) <= tol &&
            Math.abs(scy - reg.expect.cy) <= tol;
          if (ok) {
            return { mask: solid, bbox: sb, max: peak, silhouette: true };
          }
          console.log(
            `   ↻ siluet bintang tidak lolos (ukuran ${halfW.toFixed(0)}x${halfH.toFixed(0)}, geser ${(scx - reg.expect.cx).toFixed(0)},${(scy - reg.expect.cy).toFixed(0)}, ${sb.count} px) -> pakai mask persegi`
          );
        } else {
          console.log(`   ↻ outline bintang tidak terbaca (${outlineCount} px) -> pakai mask persegi`);
        }

        // --- langkah 2 (fallback): mask persegi di sekitar pusat badge ---
        // Dipakai kalau siluet bintang tidak bisa digambar. Hasilnya sedikit lebih
        // kasar karena area yang ditambal lebih besar.
        const halfGeo = Math.ceil(expR) + 5;
        const mask = new Uint8Array(reg.w * reg.h);
        for (let y = 0; y < reg.h; y++) {
          for (let x = 0; x < reg.w; x++) {
            if (
              Math.abs(reg.x + x + 0.5 - reg.expect.cx) <= halfGeo &&
              Math.abs(reg.y + y + 0.5 - reg.expect.cy) <= halfGeo
            ) {
              mask[y * reg.w + x] = 1;
            }
          }
        }
        const mb = bbox(mask, reg.w, reg.h);
        if (!mb.count) return { fail: 'mask geometri kosong' };
        return { mask, bbox: mb, max: peak, silhouette: false };
      }

      const blur2 = boxBlur(med2, reg.w, reg.h, 6, 3);
      const res2 = new Float32Array(reg.w * reg.h);
      let max2 = 0;
      for (let i = 0; i < res2.length; i++) {
        res2[i] = med2[i] - blur2[i];
        if (res2[i] > max2) max2 = res2[i];
      }
      if (max2 < 6) return { fail: 'residual terlalu kecil' };

      // outline -> dilate
      let outline = new Uint8Array(reg.w * reg.h);
      for (let i = 0; i < outline.length; i++) outline[i] = res2[i] > max2 * 0.32 ? 1 : 0;
      outline = dilate(outline, reg.w, reg.h, 3);

      // kalau outline nyentuh border region, flood fill tidak bisa masuk dari luar
      // -> mask akan jadi SELURUH region (false positive). Tolak & perbesar region.
      let touchesBorder = false;
      for (let x = 0; x < reg.w; x++) {
        if (outline[x] || outline[(reg.h - 1) * reg.w + x]) touchesBorder = true;
      }
      for (let y = 0; y < reg.h; y++) {
        if (outline[y * reg.w] || outline[y * reg.w + reg.w - 1]) touchesBorder = true;
      }
      if (touchesBorder) return { fail: 'outline menyentuh border region' };

      const outside = fillOutside(outline, reg.w, reg.h);
      const mask = new Uint8Array(reg.w * reg.h);
      for (let i = 0; i < mask.length; i++) mask[i] = outline[i] ? 1 : 0;
      for (let y = 1; y < reg.h - 1; y++) {
        for (let x = 1; x < reg.w - 1; x++) {
          const i = y * reg.w + x;
          if (!outside[i] && !mask[i]) mask[i] = 1;
        }
      }
      const finalMask = dilate(mask, reg.w, reg.h, 2);
      const mb = bbox(finalMask, reg.w, reg.h);

      if (mb.count < 20) return { fail: 'mask terlalu kecil' };
      if (mb.count > reg.w * reg.h * 0.25) return { fail: 'mask terlalu besar (area %, bukan watermark)' };
      if (mb.minx <= 1 || mb.miny <= 1 || mb.maxx >= reg.w - 2 || mb.maxy >= reg.h - 2) {
        return { fail: 'bbox mask menyentuh border region' };
      }
      return { mask: finalMask, bbox: mb, max: max2 };
    }

    const full = new Uint8Array(info.width * info.height);
    let totalMaskPx = 0;

    for (let ri = 0; ri < regions.length; ri++) {
      let region = regions[ri];
      let built = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = buildMask(region);
        if (res.mask) {
          built = res;
          break;
        }
        console.log(`   ↻ percobaan ${attempt + 1} gagal: ${res.fail}${detectAll ? '' : ' -> perlebar region'}`);
        if (detectAll) break; // pada mode detect-all, geometri sudah pasti -> jangan perluas region
        const grow = 80;
        const gx = Math.max(0, region.x - grow);
        const gy = Math.max(0, region.y - grow);
        region = {
          ...region,
          x: gx,
          y: gy,
          w: Math.min(info.width - gx, region.w + grow * 2),
          h: Math.min(info.height - gy, region.h + grow * 2),
        };
      }
      if (!built) {
        if (detectAll) {
          console.log(`   ⚠️ Badge di region #${ri + 1} tidak lolos verifikasi, dilewati.`);
          continue;
        }
        throw new Error('Watermark tidak bisa diisolasi dengan aman; file asli tidak diubah.');
      }
      const mb = built.bbox;
      console.log(
        `   Mask #${ri + 1}: ${mb.count} px | bbox full-res x ${region.x + mb.minx}-${region.x + mb.maxx}, y ${region.y + mb.miny}-${region.y + mb.maxy}${built.silhouette ? ' (siluet bintang)' : ' (fallback persegi)'}`
      );
      for (let y = 0; y < region.h; y++) {
        for (let x = 0; x < region.w; x++) {
          if (built.mask[y * region.w + x]) full[(region.y + y) * info.width + (region.x + x)] = 255;
        }
      }
      totalMaskPx += mb.count;
    }

    if (!totalMaskPx) {
      throw new Error('Tidak ada watermark Google Vids yang terdeteksi pada video ini; file asli tidak diubah.');
    }

    // tulis PGM mask sized sama dengan video
    const hdr = Buffer.from(`P5\n${info.width} ${info.height}\n255\n`, 'ascii');
    fs.writeFileSync(maskFile, Buffer.concat([hdr, Buffer.from(full)]));

    // ---------- PASS 3: terapkan removelogo ----------
    console.log('\n[3/3] Menambal area watermark dengan ffmpeg removelogo...');
    // jalan dari dalam folder temp: path Windows yg mengandung ':' bikin parser filter ffmpeg gagal
    const absInput = path.resolve(input);
    const absOutput = path.resolve(output);
    const okRun = ffmpegRun(
      ffmpeg,
      [
        '-y', '-i', absInput,
        '-vf', 'removelogo=filename=mask.pgm',
        '-c:a', 'copy',
        '-map_metadata', '-1',
        absOutput,
      ],
      'encode output',
      tmp
    );
    if (!okRun) throw new Error('ffmpeg gagal');

    const size = fs.statSync(output).size;
    console.log('\n----------------------------------------------------');
    console.log('✅ WATERMARK TERHAPUS!');
    console.log(`📁 Output   : ${output}`);
    console.log(`📊 Ukuran   : ${(size / 1048576).toFixed(2)} MB`);
    console.log('====================================================\n');
  } catch (e) {
    console.error('\n❌ Gagal:', e.message);
    process.exitCode = 1;
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (e) {}
  }
}

main();
