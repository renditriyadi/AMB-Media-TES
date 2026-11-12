import fs from 'fs';
import path from 'path';

// Batas retensi: 10 jam (dalam milidetik)
export const MEDIA_CACHE_RETENTION_MS = 10 * 60 * 60 * 1000;

// Interval pemeriksaan berkala: setiap 1 jam
export const MEDIA_CACHE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

const MEDIA_CACHE_DIR = path.join(process.cwd(), 'media-cache');

const ALLOWED_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.mov',
  '.m4v',
  '.mkv',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bin',
  '.part',
  '.tmp',
]);

export interface CleanupResult {
  deletedCount: number;
  deletedBytes: number;
  remainingCount: number;
  totalRemainingBytes: number;
}

/**
 * Membersihkan file-file di media-cache yang usianya sudah >= 10 jam.
 * Video yang usianya < 10 jam dijamin aman dan tidak akan disentuh.
 */
export function cleanMediaCache(maxAgeMs = MEDIA_CACHE_RETENTION_MS): CleanupResult {
  let deletedCount = 0;
  let deletedBytes = 0;
  let remainingCount = 0;
  let totalRemainingBytes = 0;

  try {
    if (!fs.existsSync(MEDIA_CACHE_DIR)) {
      return { deletedCount: 0, deletedBytes: 0, remainingCount: 0, totalRemainingBytes: 0 };
    }

    const files = fs.readdirSync(MEDIA_CACHE_DIR);
    const now = Date.now();

    for (const file of files) {
      // Lewati file sistem seperti .gitkeep
      if (file.startsWith('.') || file === '.gitkeep') {
        continue;
      }

      const filePath = path.join(MEDIA_CACHE_DIR, file);

      try {
        const stat = fs.statSync(filePath);

        // Hanya hapus file biasa (bukan folder)
        if (!stat.isFile()) {
          continue;
        }

        const ext = path.extname(file).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          continue;
        }

        const ageMs = now - stat.mtimeMs;

        // Jika usia file >= 10 jam, hapus secara spesifik
        if (ageMs >= maxAgeMs) {
          try {
            fs.unlinkSync(filePath);
            deletedCount++;
            deletedBytes += stat.size;
          } catch (unlinkErr: any) {
            console.warn(`[Media Cache Cleanup] Lewati file ${file} (sedang digunakan/terkunci):`, unlinkErr.message);
          }
        } else {
          remainingCount++;
          totalRemainingBytes += stat.size;
        }
      } catch (statErr: any) {
        // Abaikan file yang tidak bisa di-stat
      }
    }

    if (deletedCount > 0) {
      const mbCleaned = (deletedBytes / (1024 * 1024)).toFixed(2);
      const remainingMb = (totalRemainingBytes / (1024 * 1024)).toFixed(2);
      console.log(
        `[Media Cache Cleanup] 🧹 Berhasil membersihkan ${deletedCount} file kadaluarsa (>= 10 jam). Membebaskan ${mbCleaned} MB disk. (Sisa file aman: ${remainingCount}, total: ${remainingMb} MB)`
      );
    }
  } catch (err: any) {
    console.warn('[Media Cache Cleanup Error]:', err.message);
  }

  return { deletedCount, deletedBytes, remainingCount, totalRemainingBytes };
}

/**
 * Mendapatkan statistik ukuran media-cache dan file yang siap dibersihkan.
 */
export function getMediaCacheStats() {
  let count = 0;
  let totalBytes = 0;
  let eligibleForCleanupCount = 0;
  let eligibleForCleanupBytes = 0;
  const now = Date.now();

  try {
    if (fs.existsSync(MEDIA_CACHE_DIR)) {
      const files = fs.readdirSync(MEDIA_CACHE_DIR);
      for (const file of files) {
        if (file.startsWith('.') || file === '.gitkeep') continue;
        const filePath = path.join(MEDIA_CACHE_DIR, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            count++;
            totalBytes += stat.size;
            if (now - stat.mtimeMs >= MEDIA_CACHE_RETENTION_MS) {
              eligibleForCleanupCount++;
              eligibleForCleanupBytes += stat.size;
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {}

  return {
    totalFiles: count,
    totalSizeBytes: totalBytes,
    totalSizeMb: parseFloat((totalBytes / (1024 * 1024)).toFixed(2)),
    expiredFiles: eligibleForCleanupCount,
    expiredSizeBytes: eligibleForCleanupBytes,
    expiredSizeMb: parseFloat((eligibleForCleanupBytes / (1024 * 1024)).toFixed(2)),
  };
}

/**
 * Memulai scheduler pembersihan otomatis berkala di background.
 * - Berjalan pertama kali 10 detik setelah server aktif.
 * - Berjalan rutin setiap 1 jam untuk mengecek apakah ada file yang telah mencapai usia >= 10 jam.
 */
export function startMediaCacheCleanupScheduler(
  intervalMs = MEDIA_CACHE_CHECK_INTERVAL_MS,
  maxAgeMs = MEDIA_CACHE_RETENTION_MS
) {
  // Jalankan 1x saat server mulai aktif (tunda 10 detik agar startup tidak terhambat)
  setTimeout(() => {
    try {
      cleanMediaCache(maxAgeMs);
    } catch (e) {}
  }, 10000);

  // Jadwalkan pemeriksaan rutin setiap 1 jam
  const intervalTimer = setInterval(() => {
    try {
      cleanMediaCache(maxAgeMs);
    } catch (e) {}
  }, intervalMs);

  if (typeof intervalTimer.unref === 'function') {
    intervalTimer.unref();
  }

  console.log(`[Media Cache Scheduler] ⏱️ Auto-cleanup aktif: mengecek setiap 1 jam untuk file berusia >= 10 jam.`);
}
