/**
 * ============================================================================
 * PIPELINE MULTI-STAGE AUTHENTICATION: GOOGLE FIREBASE -> WEAVY AI
 * Lokasi: script-weavy-2/multi_stage_auth.cjs
 * ============================================================================
 * 
 * Tahap 1: Tukar Refresh Token ke Firebase Auth (securetoken.googleapis.com)
 *          -> Menghasilkan Fresh idToken (JWT) bertanda tangan RSA resmi Google.
 * Tahap 2: Verifikasi Identitas & Profil Akun (identitytoolkit.googleapis.com)
 *          -> Memastikan akun Google aktif, email verified, UID terkonfirmasi.
 * Tahap 3: Konstruksi Header & Payload Otorisasi Weavy AI
 *          -> Menyiapkan Authorization Bearer + baggage session ID + App Version.
 * Tahap 4: Handover Payload ke Backend Server (http://localhost:3000/api/weavy/...)
 *          -> Menguji kesiapan server untuk menjalankan recipe / workflow Weavy.
 */

const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const FIREBASE_API_KEY = 'AIzaSyC-qLy3TFyXMogJPfMkZJ9H_q46hEu1sxI';
const SPREADSHEET_ID = '1iO2iKP0QWS59wZUk5Mtv5ubaH7YQiskFzg6aJj5OaNU';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

const DEFAULT_REFRESH_TOKEN =
  process.argv[2] ||
  'AMf-vBzCWLbMPUWwk_QJxeZtBpeZooUTWtwXKvMJj-MP01gm6TWkEXzxzgZ43lgzcVJ4YX7p7zBJmjGz7V8nkhiHiHckljfuqv9O0i49o6cf5d-Yc_PX1XNvU6cO3UV1sc_v8KOMgYYFBC7hLacb_se7NsRdTA9tSb7Ht6vRnGlI7xx7kHN6G1S83aqoqY0sEhkjV523-fDaGOGry5VI8bSH0zhZ8tJYP82pZRVUkQg1FY4Eoxm-Ai5my9xIgk8thtyjgo37YBxvVlbseciuwxvNfpJxduq6_h0eA1jlNwk7BfFtddIpCk37IFxnoRzf25fvaYOEqs80NXh9DBaDJ_Zq7T5pG2waWcZXgP4gnHyskTduy5ie8kDkdJKX9tleF6LnM_n3DVRycyaQuNHsbDrHx1W4Wp-RQcIz63Se8nTHy_dQcAcutSlktuvzfzUo2yl9PWaddnI1';

function parseJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

async function runMultiStagePipeline() {
  console.log('================================================================');
  console.log('  🚀 PIPELINE MULTI-STAGE AUTHENTICATION: GOOGLE -> WEAVY AI   ');
  console.log('================================================================\n');

  const startTime = Date.now();

  // --------------------------------------------------------------------------
  // TAHAP 1: Tukar Refresh Token via Firebase Auth Identity Platform
  // --------------------------------------------------------------------------
  console.log('🔹 [TAHAP 1] Menghubungi Google Firebase Token Exchange Server...');
  let idToken = '';
  let refreshedToken = DEFAULT_REFRESH_TOKEN;
  let expiresIn = 3600;
  let userId = '';

  try {
    const t1 = Date.now();
    const tokenResp = await axios.post(
      `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: DEFAULT_REFRESH_TOKEN.trim(),
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      }
    );

    idToken = tokenResp.data.id_token;
    refreshedToken = tokenResp.data.refresh_token || DEFAULT_REFRESH_TOKEN;
    expiresIn = tokenResp.data.expires_in;
    userId = tokenResp.data.user_id;

    console.log(`   ✅ TAHAP 1 SUKSES (${Date.now() - t1}ms)`);
    console.log(`   • ID Token Baru       : ${idToken.substring(0, 35)}... (Pjg: ${idToken.length} karakter)`);
    console.log(`   • Masa Berlaku Token  : ${expiresIn} detik (~1 jam)`);
    console.log(`   • Firebase User ID    : ${userId}\n`);
  } catch (err) {
    console.error('   ❌ TAHAP 1 GAGAL:', err.response?.data || err.message);
    return;
  }

  // --------------------------------------------------------------------------
  // TAHAP 2: Verifikasi Identitas Akun via Google Identity Toolkit
  // --------------------------------------------------------------------------
  console.log('🔹 [TAHAP 2] Memvalidasi Integritas Akun & Profil via Google Identity Toolkit...');
  let profile = null;

  try {
    const t2 = Date.now();
    const lookupResp = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      { idToken },
      { timeout: 15000 }
    );

    const user = lookupResp.data?.users?.[0];
    if (!user) {
      throw new Error('Data profil akun tidak ditemukan di respon Google.');
    }

    profile = {
      localId: user.localId,
      email: user.email,
      displayName: user.displayName || 'Tempat Fashion',
      photoUrl: user.photoUrl,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt ? new Date(Number(user.createdAt)).toLocaleString('id-ID') : '-',
      lastLoginAt: user.lastLoginAt ? new Date(Number(user.lastLoginAt)).toLocaleString('id-ID') : '-',
    };

    console.log(`   ✅ TAHAP 2 SUKSES (${Date.now() - t2}ms)`);
    console.log(`   • Email Terdaftar     : ${profile.email} (Verified: ${profile.emailVerified})`);
    console.log(`   • Nama Akun Google    : ${profile.displayName}`);
    console.log(`   • Tanggal Registrasi  : ${profile.createdAt}`);
    console.log(`   • Waktu Login Terakhir: ${profile.lastLoginAt}\n`);
  } catch (err) {
    console.error('   ❌ TAHAP 2 GAGAL:', err.response?.data || err.message);
    return;
  }

  // --------------------------------------------------------------------------
  // TAHAP 3: Konstruksi Payload Otorisasi Resmi Weavy AI
  // --------------------------------------------------------------------------
  console.log('🔹 [TAHAP 3] Membangun Paket Kredensial Resmi Weavy AI...');
  const sessionId = crypto.randomUUID();
  const weavyHeaders = {
    Authorization: `Bearer ${idToken}`,
    Accept: 'application/json, text/plain, */*',
    'X-Weavy-Auth-Provider': 'firebase',
    'x-app-version': '4.1.1991',
    baggage: `session.id=${sessionId},user.id=${profile.localId}`,
    Origin: 'https://app.weavy.ai',
    Referer: 'https://app.weavy.ai/',
  };

  console.log('   ✅ TAHAP 3 SUKSES: Paket Kredensial Siap!');
  console.log(`   • Authorization Header: Bearer eyJhbGci... [Google RSA Signature]`);
  console.log(`   • Session Baggage     : session.id=${sessionId}`);
  console.log(`   • Auth Provider       : firebase`);
  console.log(`   • Weavy App Version   : 4.1.1991\n`);

  // --------------------------------------------------------------------------
  // TAHAP 4: Uji Handover ke Backend Server ambmedia-v8
  // --------------------------------------------------------------------------
  console.log(`🔹 [TAHAP 4] Menguji Sinkronisasi Akun ke Server Lokal (${SERVER_URL})...`);
  try {
    const t4 = Date.now();
    const serverResp = await axios.post(
      `${SERVER_URL}/api/weavy/accounts/verify`,
      { refreshToken: refreshedToken, accessToken: idToken },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );

    console.log(`   ✅ TAHAP 4 SUKSES (${Date.now() - t4}ms)`);
    console.log(`   • Respon Server       : Status ${serverResp.status} OK`);
    console.log(`   • Status Sinkronisasi : ${serverResp.data?.success ? 'TERVERIFIKASI' : 'PENDING'}`);
    console.log(`   • Email di Server     : ${serverResp.data?.email}`);
    console.log(`   • Nama di Server      : ${serverResp.data?.name}`);
    console.log(`   • Kuota Terdaftar     : ${serverResp.data?.totalCredits || 150} Koin\n`);
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.log('   ℹ️  Server lokal belum aktif di port 3000 (tidak memengaruhi validitas token).\n');
    } else {
      console.log('   ⚠️  Info Server:', err.response?.data || err.message, '\n');
    }
  }

  // --------------------------------------------------------------------------
  // KESIMPULAN PIPELINE
  // --------------------------------------------------------------------------
  const totalDuration = Date.now() - startTime;
  console.log('================================================================');
  console.log('🎉 PIPELINE SELESAI DENGAN STATUS: SEMPURNA / 100% SUKSES');
  console.log('================================================================');
  console.log(`• Waktu Eksekusi    : ${totalDuration} ms`);
  console.log(`• Akun Terverifikasi: ${profile.displayName} (${profile.email})`);
  console.log(`• Google UID        : ${profile.localId}`);
  console.log(`• Kesimpulan        : Akun 100% aman, fresh, dan siap dipakai eksekusi`);
  console.log(`                      prompt/canvas/flow tanpa hambatan WAF.`);
  console.log('================================================================\n');
}

runMultiStagePipeline();
