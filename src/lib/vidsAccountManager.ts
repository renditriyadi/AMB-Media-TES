/**
 * Vids Account Manager & Auto-Switch Engine
 * Mengelola akun Google Vids, auto-switch akun yang memiliki kredit,
 * serta sinkronisasi kredit realtime ke localStorage & server.
 */

export interface VidsAccount {
  id?: string;
  email: string;
  name?: string;
  displayName?: string;
  cookies?: string;
  token?: string;
  docId?: string;
  flixDocId?: string;
  serverToken?: string;
  credits?: number;
  totalCredits?: number;
  isActive?: boolean;
  accountStatus?: 'active' | 'expired' | 'banned' | 'error';
  statusMessage?: string;
  lastChecked?: string;
  [key: string]: any;
}

// 1. Membaca daftar akun Google Vids dari localStorage
export function getVidsAccounts(): VidsAccount[] {
  try {
    const raw = localStorage.getItem('vids_accounts');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((a: any) => {
      const isDead = a.accountStatus && a.accountStatus !== 'active';
      const credits = isDead
        ? 0
        : typeof a.credits === 'number'
        ? Math.max(0, a.credits)
        : 0;
      const totalCredits =
        typeof a.totalCredits === 'number' && a.totalCredits > 0
          ? a.totalCredits
          : 500;

      return {
        ...a,
        email: a.email || '',
        displayName: a.displayName || a.name || a.email || 'Akun Google Vids',
        credits,
        totalCredits,
      };
    });
  } catch (e) {
    console.warn('[VidsAccountManager] Error reading vids_accounts:', e);
    return [];
  }
}

// 2. Helper untuk memilih akun Google Vids yang memiliki sisa kredit (> 0)
// Jika akun yang diminta tidak punya kredit (atau 'auto'), otomatis beralih ke akun yang punya kredit
export function getEligibleVidsAccount(preferredAccountId?: string): VidsAccount | null {
  const accounts = getVidsAccounts();
  if (accounts.length === 0) return null;

  // Jika akun spesifik diminta (bukan 'auto')
  if (preferredAccountId && preferredAccountId !== 'auto') {
    const preferred = accounts.find(
      (a) => (a.id === preferredAccountId || a.email === preferredAccountId)
    );
    // Jika akun spesifik punya kredit > 0 dan tidak expired, gunakan akun ini
    if (
      preferred &&
      (preferred.credits ?? 0) > 0 &&
      preferred.accountStatus !== 'expired' &&
      (preferred.cookies || preferred.token)
    ) {
      return preferred;
    }
  }

  // Cari akun yang memiliki kredit > 0 dan memiliki cookies/token yang valid
  const eligibleAccounts = accounts.filter(
    (a) =>
      (a.credits ?? 0) > 0 &&
      a.accountStatus !== 'expired' &&
      (a.cookies || a.token)
  );

  if (eligibleAccounts.length > 0) {
    // 1. Cek apakah ada akun aktif (isActive) yang kreditnya cukup
    const activeEligible = eligibleAccounts.find((a) => a.isActive);
    if (activeEligible) {
      return activeEligible;
    }

    // 2. Jika tidak, pilih akun dengan kredit terbesar
    eligibleAccounts.sort((a, b) => (b.credits ?? 0) - (a.credits ?? 0));
    return eligibleAccounts[0];
  }

  // Fallback: Jika tidak ada akun yang kreditnya > 0, kembalikan akun aktif atau akun pertama
  return accounts.find((a) => a.isActive) || accounts[0] || null;
}

// 3. Update sisa kredit akun Google Vids di localStorage dan trigger event
export function updateVidsAccountCredits(
  accountEmailOrId: string,
  remainingCredits: number,
  totalCredits?: number
) {
  try {
    const raw = localStorage.getItem('vids_accounts');
    const accounts = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(accounts)) return;

    const normalizedTarget = accountEmailOrId.trim().toLowerCase();
    const updated = accounts.map((item: any) => {
      const matchId = item.id && item.id === accountEmailOrId;
      const matchEmail = item.email && item.email.trim().toLowerCase() === normalizedTarget;

      if (matchId || matchEmail) {
        return {
          ...item,
          credits: Math.max(0, remainingCredits),
          totalCredits: totalCredits ?? item.totalCredits ?? 500,
          accountStatus: remainingCredits <= 0 ? 'expired' : 'active',
          lastChecked: new Date().toISOString(),
        };
      }
      return item;
    });

    localStorage.setItem('vids_accounts', JSON.stringify(updated));
    window.dispatchEvent(new Event('vids_accounts_updated'));
    window.dispatchEvent(new Event('accounts-updated'));
  } catch (e) {
    console.warn('[VidsAccountManager] Failed to update credits:', e);
  }
}
