/**
 * Test Direct StreamGenerate dengan Gemini Web RPC
 */

const { streamGenerate, pollUntilVideoReady } = require('./gemini_stream.cjs');
const { downloadVideo } = require('./downloader.cjs');
const path = require('path');

const testPrompt = `Generate video format 9:16
🎬 Scene 1: Pengenalan Bibit Duku Okulasi
⏱️ Durasi: 10 | 🎥 Shot/Angle: POV Handheld Close-up
🖼️ Visual: POV handheld tangan wanita merawat bibit duku okulasi di polybag hitam kebun pekarangan rumah.
🎬 Sub-Shots (3 Shoot):
  • Shoot 1 (0–3s): POV handheld suasana kebun rumah, tangan wanita memegang polybag hitam berisi bibit duku okulasi.
    🎙️ "Pengen punya pohon duku sendiri tapi lahannya pas-pasan?"
  • Shoot 2 (3–6s): Tangan menunjukkan titik okulasi bibit duku yang sehat dan kokoh.
    🎙️ "Sekarang udah ada bibit duku okulasi super unggul ini,"
  • Shoot 3 (6–10s): Tangan merapikan dedaunan bibit duku yang rimbun dan hijau pekat.
    🎙️ "yang bikin tanaman kamu cepet berbuah lebat di pekarangan rumah."
🎬 Motion: POV handheld camera with natural micro movement, female hands gently tending duku plant in backyard garden, 4k.
🎙️ VO: "Pengen punya pohon duku sendiri tapi lahannya pas-pasan? Sekarang udah ada bibit duku okulasi super unggul ini, yang bikin tanaman kamu cepet berbuah lebat di pekarangan rumah."
🖼️ Prompt Gambar: Shot on Sony Alpha A7 IV, 35mm lens f/2.8. Realistic Indonesian home garden POV handheld shot, soft delicate feminine hands gently holding a healthy grafting duku sapling in black polybag, lush green leaves, authentic backyard garden with natural soil, warm sunlight, pure visual only, no text, no title, no , no watermark`;

async function run() {
  console.log('====================================================');
  console.log('🧪 TEST STREAMGENERATE DENGAN PAYLOAD PARITY UI');
  console.log('====================================================');

  try {
    const result = await streamGenerate(testPrompt);
    console.log('\n✅ Respons StreamGenerate Diterima!');
    console.log('Conversation ID:', result.conversationId);
    console.log('Panjang Teks   :', result.answerText.length, 'karakter');
    console.log('Snippet Teks   :', result.answerText.slice(0, 150) || '(tidak ada balasan teks langsung)');
    console.log('Video URLs     :', result.videoUrls);

    if (result.videoUrls.length > 0) {
      console.log('\n🎉 Video langsung siap diunduh!');
      const target = path.join(__dirname, 'output', `direct_stream_${Date.now()}.mp4`);
      await downloadVideo(result.videoUrls[0], target);
    } else if (result.conversationId) {
      console.log('\n⏳ Menunggu video dirender oleh Veo...');
      const videoUrl = await pollUntilVideoReady(result.conversationId, 180, 5);
      const target = path.join(__dirname, 'output', `polled_stream_${Date.now()}.mp4`);
      await downloadVideo(videoUrl, target);
    }
  } catch (err) {
    console.error('\n❌ ERROR:', err.message);
  }
}

run();
