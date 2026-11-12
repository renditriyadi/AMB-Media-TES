/**
 * Video Downloader for Gemini Web
 * Mengunduh video MP4 menggunakan curl.exe bawaan Windows
 * Memberikan parity 100% dengan cURL browser.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config.cjs');

function downloadVideo(videoUrl, targetPath, customCookies) {
  return new Promise((resolve, reject) => {
    const cookies = customCookies || config.COOKIES;
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const args = [
      '--url', videoUrl,
      '-H', 'accept: */*',
      '-H', 'accept-language: en-US,en;q=0.9',
      '-b', cookies,
      '-H', 'origin: https://gemini.google.com',
      '-H', 'referer: https://gemini.google.com/',
      '-H', 'sec-ch-ua: "Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"',
      '-H', 'sec-ch-ua-arch: "x86"',
      '-H', 'sec-ch-ua-bitness: "64"',
      '-H', 'sec-ch-ua-form-factors: "Desktop"',
      '-H', 'sec-ch-ua-full-version: "156.0.8078.80"',
      '-H', 'sec-ch-ua-full-version-list: "Not:A-Brand";v="8.0.0.0", "Chromium";v="156.0.8078.80", "Google Chrome";v="156.0.8078.80"',
      '-H', 'sec-ch-ua-mobile: ?0',
      '-H', 'sec-ch-ua-model: ""',
      '-H', 'sec-ch-ua-platform: "Windows"',
      '-H', 'sec-ch-ua-platform-version: "10.0.0"',
      '-H', 'sec-ch-ua-wow64: ?0',
      '-H', 'sec-fetch-dest: empty',
      '-H', 'sec-fetch-mode: cors',
      '-H', 'sec-fetch-site: same-site',
      '-H', 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
      '-H', 'x-browser-channel: stable',
      '-H', 'x-browser-copyright: Copyright 2026 Google LLC. All Rights Reserved.',
      '-H', 'x-browser-validation: ' + config.X_BROWSER_VALIDATION,
      '-H', 'x-browser-year: 2026',
      '-H', 'x-client-data: ' + config.X_CLIENT_DATA,
      '-H', 'x-sec-ch-ua-not-a-border: tszvgafrgaqfybfzvasfwdscyagsrgdc',
      '-o', targetPath,
      '--progress-bar'
    ];

    const child = spawn('curl.exe', args, { stdio: ['ignore', 'inherit', 'inherit'] });

    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(targetPath)) {
        const stats = fs.statSync(targetPath);
        if (stats.size > 1000) {
          return resolve({
            path: targetPath,
            size: stats.size,
            contentType: 'video/mp4'
          });
        }
      }
      reject(new Error(`curl exit code ${code} atau file tidak valid.`));
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

module.exports = {
  downloadVideo
};
