/**
 * Gemini StreamGenerate & Polling Engine
 * Menghandle eksekusi RPC StreamGenerate dan pemantauan render Veo
 */

const https = require('https');
const crypto = require('crypto');
const config = require('./config.cjs');
const { buildChatContext, buildHeaders } = require('./payload_builder.cjs');

/**
 * Deteksi apakah teks balasan adalah penolakan karena kuota habis (Daily Limit)
 */
function isQuotaExhausted(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return (
    lower.includes("can't generate more videos") ||
    lower.includes("cannot generate more videos") ||
    lower.includes("can't create more videos") ||
    lower.includes("cannot create more videos") ||
    lower.includes("come back tomorrow") ||
    lower.includes("daily limit") ||
    lower.includes("tidak bisa membuatkan anda video lagi hari ini") ||
    lower.includes("tidak bisa membuatkan video lagi hari ini") ||
    lower.includes("tidak bisa membuat video lagi hari ini") ||
    lower.includes("mencapai batas harian") ||
    lower.includes("batas harian") ||
    lower.includes("quota exceeded") ||
    lower.includes("quota reached") ||
    lower.includes("reached your limit")
  );
}

/**
 * Deteksi apakah teks balasan adalah error eksplisit atau penolakan kebijakan (Safety/Refusal)
 */
function isExplicitErrorOrRefusal(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return (
    lower.includes("i encountered an error") ||
    lower.includes("terjadi kesalahan") ||
    lower.includes("i cannot fulfill this request") ||
    lower.includes("against our safety guidelines") ||
    lower.includes("unable to generate video") ||
    lower.includes("could you try again")
  );
}

/**
 * Generate SAPISIDHASH jika diperlukan untuk authorization header
 */
function getSapisidHash(cookies, origin = 'https://gemini.google.com') {
  const match = cookies.match(/(?:^|;\s*)(?:__Secure-[13]P)?SAPISID=([^;]+)/);
  if (!match) return null;
  const sapisid = match[1].trim();
  const timestamp = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash('sha1').update(`${timestamp} ${sapisid} ${origin}`).digest('hex');
  return `${timestamp}_${hash}`;
}

/**
 * Helper untuk mengekstrak dan men-decode URL download dari teks JSON mentah
 */
function extractVideoDownloadUrls(rawText) {
  const urls = [];
  const matches = rawText.matchAll(/https:\/\/contribution\.usercontent\.google\.com\/download\?[^"'\s]+/g);
  for (const m of matches) {
    let clean = m[0]
      .replace(/\\+u003d/gi, '=')
      .replace(/\\+u0026/gi, '&')
      .replace(/&amp;/g, '&')
      .replace(/\\+/g, '')
      .replace(/["',]+$/, '');

    // Pastikan URL video (mengandung filename=video.mp4 dan parameter c=)
    if (clean.includes('filename=video.mp4') && clean.includes('c=') && !urls.includes(clean)) {
      urls.push(clean);
    }
  }
  return urls;
}

/**
 * Mengirim permintaan StreamGenerate ke Gemini Web
 */
function streamGenerate(promptText, options = {}) {
  return new Promise((resolve, reject) => {
    const cookies = options.cookies || config.COOKIES;
    const atToken = options.at || config.AT_TOKEN;
    const bl = options.bl || config.BL;
    const fsid = options.fsid || config.FSID;
    const reqId = options.reqId || Math.floor(Math.random() * 9000000) + 1000000;

    const chatContext = buildChatContext(promptText, options);
    const headers = buildHeaders({ cookies, bl, ...options });

    const authHash = getSapisidHash(cookies);
    if (authHash) {
      headers['authorization'] = `SAPISIDHASH ${authHash}`;
    }

    const postPayload = [null, JSON.stringify(chatContext)];
    const bodyParams = new URLSearchParams();
    bodyParams.append('f.req', JSON.stringify(postPayload));
    bodyParams.append('at', atToken);

    const postData = bodyParams.toString();
    headers['Content-Length'] = Buffer.byteLength(postData);

    const endpointPath = `/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=${encodeURIComponent(bl)}&f.sid=${encodeURIComponent(fsid)}&hl=en&_reqid=${reqId}&rt=c`;

    console.log(`[StreamGenerate] Mengirim request ke Gemini... (_reqid=${reqId})`);

    const req = https.request({
      hostname: 'gemini.google.com',
      path: endpointPath,
      method: 'POST',
      headers: headers,
      timeout: 120000
    }, (res) => {
      let rawData = '';

      res.on('data', (chunk) => {
        rawData += chunk.toString();
        if (chunk.toString().includes('contribution.usercontent.google.com')) {
          console.log('\n🎯 [Stream] Link video langsung terdeteksi di chunk!');
        }
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`StreamGenerate HTTP ${res.statusCode}: ${rawData.slice(0, 500)}`));
        }

        console.log(`[StreamGenerate] Respon diterima (${Buffer.byteLength(rawData)} bytes, HTTP ${res.statusCode})`);
        
        const parsed = parseStreamResponse(rawData);
        resolve(parsed);
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('StreamGenerate request timed out (120s)'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Parsing chunk response Gemini Web
 */
function parseStreamResponse(rawText) {
  let conversationId = null;
  let answerText = '';
  const videoUrls = extractVideoDownloadUrls(rawText);

  // Ekstrak Conversation ID
  const convMatch = rawText.match(/\["c_([a-f0-9]{16})"/i) || rawText.match(/"(c_[a-f0-9]{16})"/i);
  if (convMatch) {
    conversationId = convMatch[1].startsWith('c_') ? convMatch[1] : `c_${convMatch[1]}`;
  }

  // Ekstrak teks balasan dari chunk JSON
  const lines = rawText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(")]}'") || /^\d+$/.test(trimmed)) continue;
    try {
      const parsedLine = JSON.parse(trimmed);
      if (Array.isArray(parsedLine)) {
        for (const item of parsedLine) {
          if (Array.isArray(item) && item[0] === 'wrb.fr' && typeof item[2] === 'string') {
            const inner = JSON.parse(item[2]);
            if (Array.isArray(inner)) {
              if (!conversationId && inner[1] && Array.isArray(inner[1]) && inner[1][0]) {
                const idCandidate = inner[1][0];
                if (typeof idCandidate === 'string' && idCandidate.startsWith('c_')) {
                  conversationId = idCandidate;
                }
              }
              if (inner[4] && Array.isArray(inner[4])) {
                for (const candidate of inner[4]) {
                  if (candidate && candidate[1] && Array.isArray(candidate[1])) {
                    const textPart = candidate[1][0];
                    if (typeof textPart === 'string') {
                      answerText += textPart;
                    }
                  }
                }
              }
            }
          }
        }
      }
    } catch (e) {}
  }

  return {
    conversationId,
    answerText: answerText.trim(),
    videoUrls,
    rawTextLength: rawText.length
  };
}

/**
 * Mengambil riwayat percakapan menggunakan RPC hNvQHb untuk polling video Veo
 */
function fetchConversationHistory(convId, options = {}) {
  return new Promise((resolve, reject) => {
    const cookies = options.cookies || config.COOKIES;
    const atToken = options.at || config.AT_TOKEN;
    const bl = options.bl || config.BL;
    const cleanConvId = convId.startsWith('c_') ? convId : `c_${convId}`;

    const envelope = [[['hNvQHb', JSON.stringify([cleanConvId, 50, null, 1]), null, 'generic']]];
    const bodyParams = new URLSearchParams();
    bodyParams.append('f.req', JSON.stringify(envelope));
    bodyParams.append('at', atToken);
    const postData = bodyParams.toString();

    const headers = {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'origin': 'https://gemini.google.com',
      'referer': 'https://gemini.google.com/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
      'cookie': cookies,
      'Content-Length': Buffer.byteLength(postData)
    };

    const endpointPath = `/_/BardChatUi/data/batchexecute?rpcids=hNvQHb&bl=${encodeURIComponent(bl)}&rt=c`;

    const req = https.request({
      hostname: 'gemini.google.com',
      path: endpointPath,
      method: 'POST',
      headers: headers,
      timeout: 30000
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`hNvQHb HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
        }

        const urls = extractVideoDownloadUrls(raw);
        
        // Cek juga apakah ada pesan error / penolakan di dalam response history
        let refusal = null;
        if (raw.includes("can't generate more videos") || raw.includes("cannot generate more videos") || raw.includes("come back tomorrow")) {
          refusal = "Sorry, I can't generate more videos for you today, but come back tomorrow and we can make more.";
        }

        resolve({
          urls,
          refusal,
          rawLength: raw.length
        });
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Polling status video sampai selesai dirender
 */
async function pollUntilVideoReady(convId, maxWaitSeconds = 240, intervalSeconds = 5, options = {}) {
  const startTime = Date.now();
  console.log(`[Polling] Memantau proses render video untuk sesi ${convId}... (Max: ${maxWaitSeconds}s)`);

  while ((Date.now() - startTime) < maxWaitSeconds * 1000) {
    await new Promise(r => setTimeout(r, intervalSeconds * 1000));
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    try {
      const hist = await fetchConversationHistory(convId, options);

      // Jika terdeteksi refusal / kuota habis di tengah jalan, langsung stop!
      if (hist.refusal) {
        throw new Error(`KUOTA_HABIS: ${hist.refusal}`);
      }

      if (hist.urls && hist.urls.length > 0) {
        console.log(`\n🎉 [Polling] Video SELESAI dirender setelah ${elapsed} detik!`);
        return hist.urls[0];
      }
      process.stdout.write(`\r⏳ Merender video oleh Google Veo... (${elapsed}s)`);
    } catch (e) {
      if (e.message && e.message.startsWith('KUOTA_HABIS')) {
        throw e;
      }
      process.stdout.write(`\r⏳ Menunggu respons server... (${elapsed}s)`);
    }
  }

  throw new Error(`Batas waktu polling (${maxWaitSeconds}s) tercapai, video belum siap.`);
}

module.exports = {
  streamGenerate,
  parseStreamResponse,
  fetchConversationHistory,
  pollUntilVideoReady,
  extractVideoDownloadUrls,
  isQuotaExhausted,
  isExplicitErrorOrRefusal
};
