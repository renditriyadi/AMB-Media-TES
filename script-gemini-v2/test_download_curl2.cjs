/**
 * Test Download cURL 2
 * Menguji apakah URL download dari cURL yang diberikan pengguna bisa diunduh langsung.
 */

const path = require('path');
const fs = require('fs');
const { downloadVideo } = require('./downloader.cjs');

const TARGET_URL = process.argv[2] || '';

async function test() {
  if (!TARGET_URL) {
    console.log('Penggunaan: node test_download_curl2.cjs "<download_url>"');
    process.exit(1);
  }
  console.log('====================================================');
  console.log('🧪 TEST DOWNLOAD VIDEO DARI CURL 2');
  console.log('====================================================');
  console.log('URL Target:', TARGET_URL);

  const outputDir = path.join(__dirname, 'output');
  const outputFile = path.join(outputDir, `test_curl2_video_${Date.now()}.mp4`);

  try {
    const res = await downloadVideo(TARGET_URL, outputFile);
    console.log('\n====================================================');
    console.log('🎉 UJI DOWNLOAD BERHASIL!');
    console.log('File tersimpan di:', res.path);
    console.log('Ukuran file     :', (res.size / (1024 * 1024)).toFixed(2), 'MB');
    console.log('Content-Type    :', res.contentType);
    console.log('====================================================');
  } catch (err) {
    console.error('\n❌ UJI DOWNLOAD GAGAL:', err.message);
  }
}

test();
