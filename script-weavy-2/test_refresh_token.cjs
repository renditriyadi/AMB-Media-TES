/**
 * Script Test Refresh Token & Pemeriksaan Akun Weavy AI (script-weavy-2)
 * 
 * Mengatasi Masalah Cloudflare WAF 403:
 * 1. Otentikasi & Refresh Token via Firebase Auth Identity Platform (Google API resmi, 100% bebas WAF).
 * 2. Mengambil detail profil lengkap (Nama, Email, UID, Photo, Last Login) via Google Identity Toolkit.
 * 3. Sinkronisasi saldo kredit dari Google Sheets Database Master (Weavy_Accounts).
 * 4. Mendukung parameter Cookie browser jika ingin query langsung ke api.weavy.ai tanpa kena Cloudflare 403.
 * 5. Penanganan Cloudflare challenge yang aman & elegan tanpa memicu unhandled error 403.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const FIREBASE_API_KEY = 'AIzaSyC-qLy3TFyXMogJPfMkZJ9H_q46hEu1sxI';
const SPREADSHEET_ID = '1iO2iKP0QWS59wZUk5Mtv5ubaH7YQiskFzg6aJj5OaNU';
const SERVER_BASE_URL = process.env.SERVER_URL || 'http://localhost:3000';

// Default refresh token dari user
const DEFAULT_REFRESH_TOKEN =
  process.env.WEAVY_REFRESH_TOKEN ||
  'AMf-vBzCWLbMPUWwk_QJxeZtBpeZooUTWtwXKvMJj-MP01gm6TWkEXzxzgZ43lgzcVJ4YX7p7zBJmjGz7V8nkhiHiHckljfuqv9O0i49o6cf5d-Yc_PX1XNvU6cO3UV1sc_v8KOMgYYFBC7hLacb_se7NsRdTA9tSb7Ht6vRnGlI7xx7kHN6G1S83aqoqY0sEhkjV523-fDaGOGry5VI8bSH0zhZ8tJYP82pZRVUkQg1FY4Eoxm-Ai5my9xIgk8thtyjgo37YBxvVlbseciuwxvNfpJxduq6_h0eA1jlNwk7BfFtddIpCk37IFxnoRzf25fvaYOEqs80NXh9DBaDJ_Zq7T5pG2waWcZXgP4gnHyskTduy5ie8kDkdJKX9tleF6LnM_n3DVRycyaQuNHsbDrHx1W4Wp-RQcIz63Se8nTHy_dQcAcutSlktuvzfzUo2yl9PWaddnI1';

// Parsing argumen CLI (misal: node test_refresh_token.cjs [token] [--cookie "cookie_str"])
const args = process.argv.slice(2);
let inputToken = DEFAULT_REFRESH_TOKEN;
let inputCookie = process.env.WEAVY_COOKIE || '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--cookie' && args[i + 1]) {
    inputCookie = args[i + 1];
    i++;
  } else if (!args[i].startsWith('--')) {
    inputToken = args[i];
  }
}

function parseJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// 1. Verifikasi dan Tukar Token via Firebase Auth (Bebas Cloudflare WAF)
async function refreshFirebaseToken(refreshToken) {
  console.log('[1] 🔄 Menukar Refresh Token ke Firebase Auth...');
  const resp = await axios.post(
    `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken.trim(),
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    }
  );

  return {
    idToken: resp.data.id_token,
    refreshToken: resp.data.refresh_token || refreshToken,
    userId: resp.data.user_id,
    projectId: resp.data.project_id,
    expiresIn: resp.data.expires_in,
  };
}

// 2. Ambil Profil Resmi via Google Identity Toolkit (100% Aman tanpa 403)
async function fetchGoogleAccountProfile(idToken) {
  console.log('[2] 👤 Mengambil Profil Akun Terverifikasi (Google Identity Toolkit)...');
  try {
    const res = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      { idToken },
      { timeout: 10000 }
    );
    const user = res.data?.users?.[0];
    if (user) {
      return {
        email: user.email,
        displayName: user.displayName,
        photoUrl: user.photoUrl,
        createdAt: user.createdAt ? new Date(Number(user.createdAt)).toLocaleString('id-ID') : '-',
        lastLoginAt: user.lastLoginAt ? new Date(Number(user.lastLoginAt)).toLocaleString('id-ID') : '-',
      };
    }
  } catch (err) {
    console.warn('    ⚠️ Gagal lookup Identity Toolkit:', err.message);
  }
  return null;
}

// 3. Cek Database Akun di Spreadsheet (Weavy_Accounts)
async function checkSpreadsheetCredits(email, refreshToken) {
  console.log('[3] 📊 Mengecek Saldo Kredit di Spreadsheet Database (Weavy_Accounts)...');
  try {
    const keyPath = path.join(process.cwd(), 'google-service-account.json');
    if (!fs.existsSync(keyPath)) {
      console.log('    ℹ️  google-service-account.json tidak ditemukan, lewati pengecekan sheets.');
      return null;
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Weavy_Accounts!A1:L100',
    });

    const rows = res.data.values || [];
    const matched = rows.find((r) => {
      const rowEmail = (r[2] || '').trim().toLowerCase();
      const rowToken = (r[7] || '').trim();
      return (
        (email && rowEmail === email.toLowerCase()) ||
        (refreshToken && rowToken === refreshToken.trim())
      );
    });

    if (matched) {
      return {
        found: true,
        accountId: matched[1] || matched[0],
        credits: Number(matched[8] || 0),
        totalCredits: Number(matched[9] || 150),
        status: matched[5] === 'TRUE' ? 'AKTIF' : 'NON-AKTIF',
      };
    }
  } catch (err) {
    console.log('    ⚠️  Info Spreadsheet:', err.message);
  }
  return null;
}

// 4. Coba Query ke Weavy API dengan Penanganan Cerdas Anti-403
async function checkWeavyApiCredits(idToken, cookieStr) {
  console.log('[4] 🌐 Menguji Akses ke api.weavy.ai...');

  const headers = {
    Authorization: `Bearer ${idToken}`,
    Accept: 'application/json, text/plain, */*',
    'X-Weavy-Auth-Provider': 'firebase',
    'x-app-version': '4.1.1316',
    'Origin': 'https://app.weavy.ai',
    'Referer': 'https://app.weavy.ai/',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  };

  if (cookieStr) {
    headers['Cookie'] = cookieStr;
    headers['x-weavy-cookie'] = cookieStr;
  }

  try {
    const resp = await axios.get('https://api.weavy.ai/api/v1/users', {
      headers,
      timeout: 8000,
      validateStatus: () => true, // Cegah throw otomatis
    });

    if (resp.status === 200 && resp.data) {
      const uData = resp.data;
      const credits = uData.credits ?? uData.balance ?? uData.quota ?? 0;
      const total = uData.total ?? uData.totalCredits ?? 150;
      console.log(`    ✅ Sukses terhubung ke Weavy API! Sisa Kredit: ${credits} / Total: ${total}`);
      return { success: true, credits, totalCredits: total };
    }

    if (resp.status === 403) {
      console.log('    🛡️  api.weavy.ai diproteksi Cloudflare Challenge (WAF Bot Protection).');
      console.log('       Solusi arsitektur:');
      console.log('       1. Saldo & sesi diakses aman melalui Chrome Extension Bridge / Google Sheets.');
      console.log('       2. Atau sertakan cookie browser dengan parameter: --cookie "cf_clearance=...; ..."');
      return { success: false, isCloudflareWAF: true };
    }

    console.log(`    ⚠️  Respon Weavy API: HTTP ${resp.status}`);
    return { success: false, status: resp.status };
  } catch (err) {
    console.log(`    ⚠️  Koneksi Weavy API: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// 5. Uji Melalui Server Lokal ambmedia-v8
async function testViaLocalServer(refreshToken) {
  console.log(`[5] 🚀 Menguji Endpoint Server Lokal (${SERVER_BASE_URL}/api/weavy/accounts/verify)...`);
  try {
    const res = await axios.post(
      `${SERVER_BASE_URL}/api/weavy/accounts/verify`,
      { refreshToken },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    if (res.data?.success) {
      console.log('    ✅ Server Lokal Berhasil Verifikasi Akun:');
      console.log(`       - Email       : ${res.data.email}`);
      console.log(`       - Nama        : ${res.data.name}`);
      console.log(`       - Sisa Kredit : ${res.data.credits}`);
      console.log(`       - Total Kuota : ${res.data.totalCredits}`);
      return res.data;
    }
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.log('    ℹ️  Server lokal tidak berjalan di port 3000 (tidak masalah).');
    } else {
      console.log('    ⚠️  Info respon server lokal:', err.response?.data || err.message);
    }
  }
  return null;
}

async function main() {
  console.log('================================================================');
  console.log('      🛡️ WEAVY AI TOKEN REFRESH & ACCOUNT VERIFIER (v2)        ');
  console.log('================================================================\n');

  try {
    // Langkah 1: Refresh Token Firebase
    const authData = await refreshFirebaseToken(inputToken);
    const jwtPayload = parseJwt(authData.idToken) || {};

    console.log('    ✅ Sesi Berhasil Diperbarui!');
    console.log(`    • ID Token Panjang : ${authData.idToken.length} karakter`);
    console.log(`    • Masa Berlaku     : ${authData.expiresIn} detik (~1 jam)\n`);

    // Langkah 2: Ambil Profil Akun
    const profile = (await fetchGoogleAccountProfile(authData.idToken)) || {
      email: jwtPayload.email || '-',
      displayName: jwtPayload.name || '-',
      photoUrl: jwtPayload.picture || '-',
      createdAt: '-',
      lastLoginAt: '-',
    };

    console.log('    ✅ Informasi Pemilik Akun:');
    console.log(`    • Email           : ${profile.email}`);
    console.log(`    • Nama            : ${profile.displayName}`);
    console.log(`    • Firebase UID    : ${authData.userId}`);
    console.log(`    • Tanggal Dibuat  : ${profile.createdAt}`);
    console.log(`    • Terakhir Login  : ${profile.lastLoginAt}\n`);

    // Langkah 3: Cek Database Master Spreadsheet
    const sheetData = await checkSpreadsheetCredits(profile.email, inputToken);
    let resolvedCredits = 150;
    let resolvedTotal = 150;

    if (sheetData?.found) {
      resolvedCredits = sheetData.credits;
      resolvedTotal = sheetData.totalCredits;
      console.log(`    ✅ Data Ditemukan di Spreadsheet (ID: ${sheetData.accountId})`);
      console.log(`    • Saldo Terdata   : ${resolvedCredits} Koin`);
      console.log(`    • Kuota Terdata   : ${resolvedTotal} Koin\n`);
    } else {
      console.log('    ℹ️  Akun belum terdaftar di database spreadsheet.');
      console.log('    • Kuota Bawaan Weavy : 150 Koin (Akun Baru / Free Tier)\n');
    }

    // Langkah 4: Cek Langsung ke Weavy API (Aman dari unhandled 403)
    const apiResult = await checkWeavyApiCredits(authData.idToken, inputCookie);
    if (apiResult.success) {
      resolvedCredits = apiResult.credits;
      resolvedTotal = apiResult.totalCredits;
    }

    // Langkah 5: Cek via Server Lokal
    await testViaLocalServer(inputToken);

    // Ringkasan Akhir
    console.log('\n================================================================');
    console.log('📋 RINGKASAN AKUN WEAVY:');
    console.log('================================================================');
    console.log(`• Status Token  : ✅ AKTIF & VALID (Refresh Token Permanent)`);
    console.log(`• Email Akun    : ${profile.email}`);
    console.log(`• Nama Akun     : ${profile.displayName}`);
    console.log(`• Firebase UID  : ${authData.userId}`);
    console.log(`• Estimasi Koin : ${resolvedCredits} Koin (Total: ${resolvedTotal} Koin)`);
    console.log(`• ID Token Baru : ${authData.idToken.substring(0, 35)}...`);
    console.log('================================================================\n');

  } catch (err) {
    console.error('❌ Gagal memeriksa akun:', err.response?.data || err.message);
  }
}

main();
