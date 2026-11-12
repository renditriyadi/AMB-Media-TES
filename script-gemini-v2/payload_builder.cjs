/**
 * Payload & Header Builder for Gemini Web V2
 * Memastikan Parity 100% dengan Capture UI Chrome 156
 */

const crypto = require('crypto');
const config = require('./config.cjs');

/**
 * Memastikan prompt selalu diawali dengan "Generate video format 9:16"
 */
function formatVideoPrompt(rawPrompt) {
  if (!rawPrompt || typeof rawPrompt !== 'string') {
    return 'Generate video format 9:16';
  }
  const trimmed = rawPrompt.trim();
  // Cek apakah sudah diawali dengan kata kunci format video (dengan toleransi typo/spasi)
  if (/^generate\s+video\s+format\s+9:16/i.test(trimmed)) {
    return trimmed;
  }
  return `Generate video format 9:16\n${trimmed}`;
}

function buildChatContext(promptText, overrides = {}) {
  const sessionBlob = overrides.sessionBlob !== undefined ? overrides.sessionBlob : null;
  const sessionHex = overrides.sessionHex || crypto.randomBytes(16).toString('hex');
  const clientUuid = overrides.clientUuid || crypto.randomUUID().toUpperCase();

  const formattedPrompt = formatVideoPrompt(promptText);

  // Inisialisasi 99 elemen null
  const arr = new Array(99).fill(null);

  arr[0] = [formattedPrompt, 0, null, null, null, null, 0];
  arr[1] = ["en"];
  arr[2] = null;
  arr[3] = sessionBlob;
  arr[4] = sessionHex;
  arr[6] = [1];
  arr[7] = 1;
  arr[10] = 1;
  arr[11] = 0;
  arr[17] = [[0]];
  arr[18] = 0;
  arr[27] = 1;
  arr[30] = [4, 16, 19]; // Feature flags video / tool
  arr[49] = 0;
  arr[53] = 0;
  arr[59] = clientUuid;  // Parity dengan x-goog-ext-525005358-jspb
  arr[61] = [];
  arr[68] = 2;
  arr[79] = 1;
  arr[91] = 1;
  arr[96] = 0;
  arr[98] = 1;

  return arr;
}

function buildHeaders(overrides = {}) {
  const cookies = overrides.cookies || config.COOKIES;
  const clientUuid = overrides.clientUuid || config.CLIENT_UUID || crypto.randomUUID().toUpperCase();
  const extUuid = overrides.extUuid || config.EXT_UUID || crypto.randomUUID().toUpperCase();
  const bl = overrides.bl || config.BL;

  return {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/x-www-form-urlencoded;charset=utf-8',
    'origin': 'https://gemini.google.com',
    'priority': 'u=1, i',
    'referer': 'https://gemini.google.com/',
    'sec-ch-ua': '"Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"',
    'sec-ch-ua-arch': '"x86"',
    'sec-ch-ua-bitness': '"64"',
    'sec-ch-ua-form-factors': '"Desktop"',
    'sec-ch-ua-full-version': '"156.0.8078.80"',
    'sec-ch-ua-full-version-list': '"Not:A-Brand";v="8.0.0.0", "Chromium";v="156.0.8078.80", "Google Chrome";v="156.0.8078.80"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-model': '""',
    'sec-ch-ua-platform': '"Windows"',
    'sec-ch-ua-platform-version': '"10.0.0"',
    'sec-ch-ua-wow64': '?0',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
    'x-browser-channel': 'stable',
    'x-browser-copyright': 'Copyright 2026 Google LLC. All Rights Reserved.',
    'x-browser-validation': config.X_BROWSER_VALIDATION,
    'x-browser-year': '2026',
    'x-client-data': config.X_CLIENT_DATA,
    'x-goog-ext-525001261-jspb': JSON.stringify([
      1, null, null, null, crypto.randomBytes(8).toString('hex'), null, "en", 0,
      [4, 33, 5, 6, 8, 16, 19, 20], null, null, 2, null, null, 1, null,
      extUuid, [bl], null, [[8, 917599999], [Math.floor(Date.now() / 1000), 469000000], config.TIMEZONE]
    ]),
    'x-goog-ext-525005358-jspb': JSON.stringify([clientUuid, 1]),
    'x-goog-ext-73010989-jspb': '[0]',
    'x-goog-ext-73010990-jspb': '[0,0,0]',
    'x-same-domain': '1',
    'x-sec-ch-ua-not-a-border': config.X_NOT_A_BORDER,
    'cookie': cookies
  };
}

module.exports = {
  buildChatContext,
  buildHeaders,
  formatVideoPrompt
};
