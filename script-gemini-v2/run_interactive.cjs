#!/usr/bin/env node

/**
 * ============================================================================
 * GEMINI V2 — INTERACTIVE GENERATOR & CURL PARSER
 * ============================================================================
 * Jalankan perintah:
 *   node script-gemini-v2/run_interactive.cjs
 *
 * Alur:
 * 1. Meminta pengguna menempelkan cURL bash mentah.
 * 2. Mengekstrak Cookie, token CSRF, dan memvalidasi sesi akun Google.
 * 3. Meminta pengguna memasukkan prompt (dengan panduan format 9:16 / 16:9).
 * 4. Menjalankan proses generate Google Veo & download otomatis hasil MP4.
 */

const readline = require('readline');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { streamGenerate, pollUntilVideoReady, isQuotaExhausted, isExplicitErrorOrRefusal } = require('./gemini_stream.cjs');
const { downloadVideo } = require('./downloader.cjs');

// Helper input multi-line dari terminal
function readMultiLineInput(promptMessage, doneKeyword = 'DONE') {
  return new Promise((resolve) => {
    console.log(promptMessage);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });

    const lines = [];
    let debounceTimer = null;

    const finish = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      rl.close();
      resolve(lines.join('\n').trim());
    };

    rl.on('line', (line) => {
      if (line.trim().toUpperCase() === doneKeyword) {
        return finish();
      }

      // Deteksi jika user menekan enter kosong setelah paste
      if (line.trim() === '' && lines.length > 0) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          finish();
        }, 600);
        return;
      }

      lines.push(line);

      // Debounce otomatis saat paste banyak baris sekaligus
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Jika sudah ada command curl lengkap dan berhenti sejenak
        const current = lines.join('\n');
        if (current.includes('curl') && (current.includes('-b') || current.includes('cookie') || current.includes('Cookie'))) {
          finish();
        }
      }, 900);
    });
  });
}

// Helper input single-line
function readSingleInput(promptMessage) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(promptMessage, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Mengekstrak cookie dan parameter dari cURL bash mentah
function parseRawCurl(rawCurl) {
  let cookies = null;

  // 1. Ekstrak Cookie (-b atau -H "cookie: ...")
  const bMatch = rawCurl.match(/(?:-b|--cookie)\s+['"]([^'"]+)['"]/);
  if (bMatch) {
    cookies = bMatch[1];
  } else {
    const hMatch = rawCurl.match(/-H\s+['"]cookie:\s*([^'"]+)['"]/i);
    if (hMatch) {
      cookies = hMatch[1];
    }
  }

  // 2. Ekstrak token jika cURL berasal dari endpoint StreamGenerate
  let atToken = null;
  let fsid = null;
  let bl = null;

  const atMatch = rawCurl.match(/[?&]at=([^&'"]+)/) || rawCurl.match(/at=([A-Za-z0-9_-]+:[0-9]+)/);
  if (atMatch) {
    try { atToken = decodeURIComponent(atMatch[1]); } catch { atToken = atMatch[1]; }
  }

  const sidMatch = rawCurl.match(/[?&]f\.sid=([^&'"]+)/);
  if (sidMatch) {
    try { fsid = decodeURIComponent(sidMatch[1]); } catch { fsid = sidMatch[1]; }
  }

  const blMatch = rawCurl.match(/[?&]bl=([^&'"]+)/);
  if (blMatch) {
    try { bl = decodeURIComponent(blMatch[1]); } catch { bl = blMatch[1]; }
  }

  return { cookies, atToken, fsid, bl };
}

// Validasi akun Google dan ambil token CSRF dari /app jika belum ada
function validateAndInitSession(cookies, existing = {}) {
  return new Promise((resolve, reject) => {
    console.log('\n[Validasi Akun] Menghubungi Gemini Web untuk memverifikasi sesi & CSRF token...');

    const req = https.request({
      hostname: 'gemini.google.com',
      path: '/app',
      method: 'GET',
      maxHeaderSize: 1024 * 1024, // 1MB buffer untuk header CSP Google
      headers: {
        'cookie': cookies,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9'
      },
      timeout: 30000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let snlm0e = existing.atToken || null;
        let bl = existing.bl || 'boq_gemini-web-uiserver_20261106.06_p0';
        let fsid = existing.fsid || null;

        const wizMatch = body.match(/window\.WIZ_global_data\s*=\s*(\{[\s\S]*?\});/);
        if (wizMatch) {
          try {
            const wiz = JSON.parse(wizMatch[1]);
            if (wiz.SNlM0e) snlm0e = wiz.SNlM0e;
            if (wiz.cfb2h) bl = wiz.cfb2h;
            if (wiz.FdrFJe) fsid = wiz.FdrFJe;
          } catch (e) {}
        }

        if (!snlm0e) {
          const m = body.match(/"SNlM0e":"([^"]+)"/);
          if (m) snlm0e = m[1];
        }
        if (!fsid) {
          const m = body.match(/"FdrFJe":"([^"]+)"/);
          if (m) fsid = m[1];
        }
        const blM = body.match(/"cfb2h":"([^"]+)"/);
        if (blM) bl = blM[1];

        if (!snlm0e && !existing.atToken) {
          return reject(new Error('Gagal mengekstrak token CSRF (SNlM0e). Cookie Google tidak valid atau sudah kedaluwarsa.'));
        }

        resolve({
          statusCode: res.statusCode,
          atToken: snlm0e || existing.atToken,
          fsid: fsid || existing.fsid,
          bl: bl || existing.bl
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Koneksi ke Gemini Web timeout (30s)'));
    });

    req.end();
  });
}

// Memformat prompt agar selalu diawali dengan format aspek rasio
function normalizePrompt(rawInput) {
  const trimmed = rawInput.trim();

  // Cek jika sudah diawali format video 9:16 atau 16:9
  if (/^generate\s+video\s+format\s+(9:16|16:9)/i.test(trimmed)) {
    return trimmed;
  }

  // Cek apakah di dalam teks ada instruksi format 16:9
  if (/format\s*16:9|16:9/i.test(trimmed) && !/9:16/i.test(trimmed)) {
    console.log('ℹ️  Format landscape 16:9 terdeteksi, menambahkan prefix: "Generate video format 16:9"');
    return `Generate video format 16:9\n${trimmed}`;
  }

  // Default otomatis ke 9:16 portrait
  console.log('ℹ️  Menambahkan prefix otomatis: "Generate video format 9:16"');
  return `Generate video format 9:16\n${trimmed}`;
}

async function main() {
  console.clear();
  console.log('================================================================');
  console.log('       🎬 GOOGLE GEMINI V2 — VIDEO GENERATOR (CLI INTERAKTIF)   ');
  console.log('================================================================');
  console.log('Script ini akan memproses cURL bash mentah akun Google Anda,');
  console.log('memvalidasi sesi, lalu membuat video menggunakan Google Veo.\n');

  // STEP 1: Minta input cURL mentah
  const curlPromptMsg = 
`📋 LANGKAH 1: TEMPELKAN (PASTE) CURL BASH MENTAH ANDA
----------------------------------------------------------------
Tempelkan perintah cURL Anda di bawah ini, lalu tekan ENTER 2x
(atau ketik 'DONE' di baris baru):
`;

  const rawCurl = await readMultiLineInput(curlPromptMsg);

  if (!rawCurl || rawCurl.length < 20) {
    console.error('\n❌ Input cURL kosong atau terlalu pendek. Proses dibatalkan.');
    process.exit(1);
  }

  const parsed = parseRawCurl(rawCurl);
  if (!parsed.cookies) {
    console.error('\n❌ Tidak dapat menemukan cookie dalam input cURL.');
    console.error('   Pastikan cURL memiliki flag -b "..." atau header Cookie.');
    process.exit(1);
  }

  // STEP 2: Validasi Sesi Akun
  let sessionData;
  try {
    sessionData = await validateAndInitSession(parsed.cookies, parsed);
    console.log('\n✅ AKUN BERHASIL DIVALIDASI!');
    console.log('  • Build ID  :', sessionData.bl);
    console.log('  • Session ID:', sessionData.fsid || '(auto)');
    console.log('  • CSRF Token:', sessionData.atToken ? sessionData.atToken.slice(0, 18) + '...' : 'OK');
  } catch (err) {
    console.error('\n❌ GAGAL MEMVALIDASI SESI AKUN:', err.message);
    process.exit(1);
  }

  // Simpan cookie terbaru ke config.cjs
  try {
    const configPath = path.join(__dirname, 'config.cjs');
    const configContent = `/**
 * Disimpan otomatis oleh run_interactive.cjs
 */
module.exports = {
  COOKIES: ${JSON.stringify(parsed.cookies)},
  AT_TOKEN: ${JSON.stringify(sessionData.atToken)},
  BL: ${JSON.stringify(sessionData.bl)},
  FSID: ${JSON.stringify(sessionData.fsid)},
  SESSION_BLOB: '!LC-lL0vNAAY6l_kKGpdCyg1tCBo3dBw7AEABEArZ1HScZS9mr0t3uX1H52YcAyREnF5X9wF-n8ATEM1wb4jYnkBcC9CI4OJ7Y4nlfaWkgbR1mAgfVyRBMSFiAgAAAGRSAAAAB2gBB34ASyZbi8Y7mrQbTKZ6JQ8wbUcaIQUht92hyKHl1kWsZh1lZvdynEVWXj19Tcn6NruUjqRpxa-rtwZDzo-t-OvPUCrhU-7vViob-kokI5kHA7hAFTDzxtrj6eAB31JrDQ0_VCMo7Ha1WTGIasjvkYWo4zXhIxBw3ULRJDcyBHKOKHddGsA8e7l0uRXifeXX3NZd9wrcidfq0GROADpgqa6KxSyMDT9f17KEbH-gUihENtHgRIwdLurvSUvKjey31eZY_LwajOe6cIu1TiDMVUf13Tk8znU8F_sptk2MoyppmPgPiGvJy_5bcqvIKRwy9earrdtq4Q4sM3LM3YlD8Pxk3Q5N2pNl_8asxpiu0-_TGJU-h7-H5hLOfWtVxLUYAn6O2tV-mY7qA1s2kpVg0pjAgsN7AjW_rO9Yqp941R6_RYPQVkdMz1IK4SESwnGTDtlPWrSsFuEfnb8ezcSx9QylLH0ybBWT9Jsu2cF4INw-rZGi-uKT-p0EobXNkVq_ibX8ZHYjknXe6QDToOiT3CxI5Ysbs9Xg41jjY2aehItU1wxL6Okplj5fXO0Th_zs7GVjYZY3VEvPvxm_FE8nG8G4OZ9Q10lhzPw44nirFyBuxCb2EsavEP8L1aCEFYOmqe1gl9RcRSLjR4CcX-oZmDYUlnJaijqshAYas49y-Pzm2FoHwiMaXXWp2JYCDjhhzvyqFhHEgD8N2BDs4RVK7qDHasf6S33fTFsxbc8b083qXAVGoa5Z8Y4niW8B7aOp7zOs80zi4DR6h_fEkB9SJyNhYRrBQR9nNL99jCEEX3kOo00YOa4f8Js8_wncbrsBrEaW40blwAuZIrZ1SYJu8NNBCYkZZBtr3anEp3FDUeuF3FQuK3fwQuc4OqThu__ZTuR6F1nyocHZNjm3tT50tU1aoZkU6TYhBUh1NLbD9HyUoNwOaSfnbh-piCz1GLcMXe_x0EMq3AZqEddOViHMuFnxwWIBVhChI6eULqjCL9dXqHCnrTt5DY2WlmEr8hjfcoapxEjk1nP3Q1g9nvv2SgIC_oNOGLAtUWB-zVB1BPMOMaKrwhqapyARwdK2hGvc6Jtl_R9PK523zpdg7Sj0CxIzJKpefJpFL5hYgOt2CMF98y92svCSXQrKSPrMNGbFiKb4WRwdx2T3Nqr38A7YhRoF_r1uHG_BeLIvAHNmL8wRx8Jrb-_vtQB0njiJ0WGpL2AeXl-3lqEEehBSXUs6JcCFjDiuWBCbs0yysY9ilbahiskzl_ke-xLAmtTyMQfvRZfzDwfMP0jn5udZp3Cn2GOQOQARrnIuNTkGMi_Cg-3Qc9WN3O-87pdG4sX6mXQoQsRSD1JP5VJ_Jy__gjrWYe5HHSoobY2by105HmUypuxtAhfalZ_Uoewu0Z8lF9GRW2ppAhm-a5axdtOW0rICo7k_1mvRXubHOWMclHn2qTWFsAsqv49IW6p3WEMso8SKGcmI-UxxEQwTMVqpc4b89V4EBeEYXQMuw0z9o9IimodeBDfVwqcGxlygXs52lGG-8WOsTuSVjZoaW64aEO9VDDPjfYCP6foOKNXgVwlggIZifuPfL3r4uSVX5KQpomS4s_XnFqUEySmwWQ5O4Dw6BEOzxtz1S9XZK7wBlVWvyRB5eeE7G1Wzs6-f8GuPdCD-62aSXEOlawGpgnCEDHnLySTUZJlciuEv5EJ_I5fchS5d92VjKWCso7E4ULp-H9tN9DdJQbsXighzr2UD6GnFP6mTDVvfdkm_s9fQp2674huOJx0n8a0x_YEIrHt98Mhbk5zsEw554p7XY6BFroF6lVpj44zXvnbOyXC_cREoqTZ8K5WFy-lKM8w7ygud3PtJPzrP4SZf7Ryzn-hEE7YepJeWCpxZdHvVOQ82JUtx8TMYDKz-9om8QridbAWfSRtGdgO8LTPodcN5pTbYUUbQ1oy4HGg9uLth5HmJ_kY0zxt_S99tHgRkWv7rpd7OhoFL1ssfCiy70A3H4HgEebMXMago84t6szjaqlPpV5Dz2mtWz1wVRrXVK3JRpOcMtp8D-P9v_5SZY5W5JFpM3Uyj1ACJvqKy10G6R8igxAEfym2rf0yFr0tzF6Enb6vxN045F_xfGb3iYAz0Pxys6KPTDmB-qXxb_SgkiqHhZC-_Xr_1owvm340xmVpfDg01lQj1CYs2GxqdZ3ShTDoMpZ75J3ADYr1P4U_3DaeijJD4FLhF1CL6WBx6aeeyLTjnnsNEXStjeVcrbI2U1TihHGZH1q8HTlwPTkSguA1-D3gq-ocqlUybU5GOmhSX0RZrRdQaU79TMgvaR9PTgxRcMaVp8iEQ0i3M0NUmDupGhUtaWGFTsfMVmtKvdgeFmBxg2lnLx_vLGaEv-qlVg8mFG-5_KLe-A62xyno78ecQngclV27tD2TZeVNGcNmZIclSfn5eVwdtAOJbjIDMjL8AI_msShF3qaHNTnsFMYeKrBtwpXdsobjDkx2wQxsUo3PxboV0jw8mPYg',
  SESSION_HEX: null,
  CLIENT_UUID: null,
  EXT_UUID: null,
  X_CLIENT_DATA: 'CKmdygEIk6HLAQiFoM0BCIrolDAIv/CUMAiY8pQwCJv2lDAY6/aUMA==',
  X_BROWSER_VALIDATION: '8bnyRAQN7KTCqFGVqmbS9daLkaI=',
  X_NOT_A_BORDER: 'tsgrgvcrgagvyqczvadfwawcyagsrwxc',
  TIMEZONE: 'Asia/Jakarta'
};
`;
    fs.writeFileSync(configPath, configContent, 'utf8');
  } catch (e) {}

  // STEP 3: Minta Input Prompt
  console.log('\n================================================================');
  console.log('💬 LANGKAH 2: MASUKKAN PROMPT VIDEO ANDA');
  console.log('================================================================');
  console.log('💡 TIPS FORMAT ASPEK RASIO:');
  console.log('   Awali prompt dengan aspek rasio yang Anda inginkan:');
  console.log('   • Portrait 9:16  (TikTok/Reels/Shorts) -> "Generate video format 9:16"');
  console.log('   • Landscape 16:9 (YouTube/Laptop/TV)   -> "Generate video format 16:9"');
  console.log('\nContoh prompt lengkap:');
  console.log('   Generate video format 9:16');
  console.log('   POV handheld walking through tropical garden, warm sunrise light, 4k');
  console.log('----------------------------------------------------------------');

  const rawPrompt = await readSingleInput('\nKetik prompt video Anda di sini lalu tekan ENTER:\n> ');

  if (!rawPrompt || rawPrompt.length < 3) {
    console.error('\n❌ Prompt tidak boleh kosong. Proses dibatalkan.');
    process.exit(1);
  }

  const finalPrompt = normalizePrompt(rawPrompt);

  const customFilename = await readSingleInput('\nNama file output (Opsional, tekan ENTER untuk nama otomatis):\n> ');

  // STEP 4: Proses Generate & Download
  console.log('\n================================================================');
  console.log('🚀 MEMULAI PROSES GENERASI GOOGLE VEO');
  console.log('================================================================');
  console.log(`Prompt yang dikirim:\n"${finalPrompt}"\n`);

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const filename = customFilename ? (customFilename.endsWith('.mp4') ? customFilename : `${customFilename}.mp4`) : `gemini_veo_${timestamp}.mp4`;
  const targetPath = path.join(outputDir, filename);

  try {
    console.log('[1/3] Mengirim permintaan ke Gemini Web RPC...');
    const result = await streamGenerate(finalPrompt, {
      cookies: parsed.cookies,
      at: sessionData.atToken,
      fsid: sessionData.fsid,
      bl: sessionData.bl
    });

    console.log('  • Conversation ID:', result.conversationId || '(tersimpan)');

    // Cek kuota habis (Fail-Fast)
    if (isQuotaExhausted(result.answerText)) {
      console.log('\n================================================================');
      console.log(' 🛑 [KUOTA HARIAN HABIS] Google Gemini Menolak Pembuatan Video');
      console.log('================================================================');
      console.log(` Pesan Resmi Google: "${result.answerText}"`);
      console.log('\n 💡 Akun Google ini telah mencapai batas limit harian.');
      console.log('    Silakan jalankan script ini lagi dengan cURL dari akun lain.');
      console.log('================================================================\n');
      process.exit(1);
    }

    if (isExplicitErrorOrRefusal(result.answerText)) {
      console.log('\n================================================================');
      console.log(' ❌ [PROMPT DITOLAK / ERROR SISTEM]');
      console.log('================================================================');
      console.log(` Pesan Google: "${result.answerText}"\n`);
      process.exit(1);
    }

    let finalVideoUrl = null;

    if (result.videoUrls && result.videoUrls.length > 0) {
      console.log('\n[2/3] 🎯 Link Video Ditemukan Langsung di Stream Respon!');
      finalVideoUrl = result.videoUrls[0];
    } else if (result.conversationId) {
      console.log('\n[2/3] Video sedang diproses di latar belakang Google Veo...');
      finalVideoUrl = await pollUntilVideoReady(result.conversationId, 240, 5, {
        cookies: parsed.cookies,
        at: sessionData.atToken,
        bl: sessionData.bl
      });
    }

    if (!finalVideoUrl) {
      throw new Error('Gagal mendapatkan URL video dari Gemini Web.');
    }

    console.log('\n[3/3] Mengunduh File Video MP4 ke:');
    console.log(`      ${targetPath}`);

    const dlResult = await downloadVideo(finalVideoUrl, targetPath, parsed.cookies);

    console.log('\n================================================================');
    console.log(' 🎉 SUKSES BESAR! VIDEO BERHASIL DIBUAT & DIUNDUH');
    console.log('================================================================');
    console.log(' • File Path  :', dlResult.path);
    console.log(' • Ukuran File:', (dlResult.size / (1024 * 1024)).toFixed(2), 'MB');
    console.log(' • Tipe File  :', dlResult.contentType);
    console.log('================================================================\n');

  } catch (error) {
    if (error.message && error.message.includes('KUOTA_HABIS')) {
      console.log('\n🛑 Kuota harian habis terdeteksi saat proses render.');
    } else {
      console.error('\n❌ PROSES GAGAL:', error.message);
    }
    process.exit(1);
  }
}

main();
