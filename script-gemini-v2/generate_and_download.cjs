/**
 * ============================================================================
 * GEMINI V2 — GENERATE VIDEO & AUTO DOWNLOAD (PARITY UI CHROME 156)
 * ============================================================================
 * Penggunaan:
 *   node script-gemini-v2/generate_and_download.cjs "Prompt video kamu disini" [nama_file_output]
 */

const fs = require('fs');
const path = require('path');
const { streamGenerate, pollUntilVideoReady, isQuotaExhausted, isExplicitErrorOrRefusal } = require('./gemini_stream.cjs');
const { downloadVideo } = require('./downloader.cjs');
const { formatVideoPrompt } = require('./payload_builder.cjs');

// Prompt dari CLI arg atau default
const defaultPrompt = `🎬 Scene: Handheld POV shot in a lush Indonesian green garden, female hand gently holding a healthy grafting sapling in black polybag, cinematic warm morning sunlight, 4k, photorealistic`;

const rawPrompt = process.argv[2] || defaultPrompt;
const userPrompt = formatVideoPrompt(rawPrompt);
const customFilename = process.argv[3];

async function main() {
  console.log('================================================================');
  console.log(' 🎬 GOOGLE GEMINI V2 — VIDEO GENERATOR (UI PARITY 156)');
  console.log('================================================================');
  console.log(`Prompt dikirim:\n"${userPrompt}"\n----------------------------------------------------------------`);

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const filename = customFilename || `gemini_veo_${timestamp}.mp4`;
  const targetPath = path.join(outputDir, filename);

  try {
    // 1. Eksekusi StreamGenerate
    console.log('\n[1/3] Mengirim Prompt ke Google Gemini Web RPC...');
    const result = await streamGenerate(userPrompt);

    console.log('  • Conversation ID:', result.conversationId || '(belum teridentifikasi)');
    if (result.answerText) {
      console.log('  • Respon Teks    :', `"${result.answerText.slice(0, 120)}..."`);
    }

    // 2. CEK PENOLAKAN KUOTA HABIS (FAIL FAST)
    if (isQuotaExhausted(result.answerText)) {
      console.log('\n================================================================');
      console.log(' 🛑 [KUOTA HARIAN HABIS] Google Gemini Menolak Pembuatan Video');
      console.log('================================================================');
      console.log(` Pesan Resmi Google:`);
      console.log(` "${result.answerText}"`);
      console.log('\n 💡 Penjelasan:');
      console.log('  Akun Google Anda telah mencapai limit pembuatan video harian (Daily Cap).');
      console.log('  Google Veo TIDAK sedang merender di background.');
      console.log('  Solusi: Ganti cookie dengan akun lain di config.cjs atau tunggu besok.');
      console.log('================================================================\n');
      process.exit(1);
    }

    // 3. CEK ERROR EKSPLISIT / PENOLAKAN PROMPT
    if (isExplicitErrorOrRefusal(result.answerText)) {
      console.log('\n================================================================');
      console.log(' ❌ [PROMPT DITOLAK / ERROR SISTEM]');
      console.log('================================================================');
      console.log(` Pesan Google: "${result.answerText}"\n`);
      process.exit(1);
    }

    let finalVideoUrl = null;

    // 4. Cek apakah link video langsung ada di stream
    if (result.videoUrls && result.videoUrls.length > 0) {
      console.log('\n[2/3] 🎯 Link Video Ditemukan Langsung di Stream Respon!');
      finalVideoUrl = result.videoUrls[0];
    } else if (result.conversationId) {
      // 5. Jika belum langsung selesai, lakukan polling asynchronous ke Google Veo
      console.log('\n[2/3] Video sedang diproses di latar belakang Google Veo...');
      finalVideoUrl = await pollUntilVideoReady(result.conversationId, 240, 5);
    } else {
      throw new Error('Tidak ada Conversation ID atau URL video yang berhasil diperoleh.');
    }

    if (!finalVideoUrl) {
      throw new Error('Gagal mendapatkan URL video dari Gemini Web.');
    }

    console.log('  • URL Download:', finalVideoUrl.slice(0, 90) + '...');

    // 6. Unduh file video
    console.log(`\n[3/3] Mengunduh File Video MP4 ke:`);
    console.log(`      ${targetPath}`);

    const dlResult = await downloadVideo(finalVideoUrl, targetPath);

    console.log('\n================================================================');
    console.log(' 🎉 SUKSES! VIDEO BERHASIL DIBUAT & DIUNDUH');
    console.log('================================================================');
    console.log(' • File Path  :', dlResult.path);
    console.log(' • Ukuran File:', (dlResult.size / (1024 * 1024)).toFixed(2), 'MB');
    console.log(' • Tipe File  :', dlResult.contentType);
    console.log('================================================================\n');

  } catch (error) {
    if (error.message && error.message.includes('KUOTA_HABIS')) {
      console.log('\n🛑 Kuota harian habis terdeteksi saat polling. Proses dihentikan.');
    } else {
      console.error('\n❌ PROSES GAGAL:', error.message);
    }
    process.exit(1);
  }
}

main();
