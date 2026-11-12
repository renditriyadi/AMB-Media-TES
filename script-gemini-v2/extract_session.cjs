/**
 * Script untuk inisialisasi / ekstraksi token session Gemini Web
 * dari Cookie akun baru.
 */

const https = require('https');

const NEW_COOKIES = process.env.GEMINI_COOKIES || process.argv[2] || '';

function initSession(cookies) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'gemini.google.com',
      path: '/app',
      method: 'GET',
      maxHeaderSize: 1024 * 1024, // 1MB header limit
      headers: {
        'cookie': cookies,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9'
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        let snlm0e = null;
        let bl = 'boq_gemini-web-uiserver_20261106.06_p0';
        let fsid = null;

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

        resolve({
          statusCode: res.statusCode,
          snlm0e,
          bl,
          fsid,
          bodyLength: body.length
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

if (require.main === module) {
  if (!NEW_COOKIES) {
    console.log('Penggunaan: node extract_session.cjs "<cookies>" atau set GEMINI_COOKIES');
    process.exit(1);
  }
  initSession(NEW_COOKIES)
    .then(res => {
      console.log('HASIL EKSTRAKSI SESI AKUN:');
      console.log(JSON.stringify(res, null, 2));
    })
    .catch(console.error);
}

module.exports = { initSession, NEW_COOKIES };
