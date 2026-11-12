import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Loader2,
  Download,
  CheckCircle2,
  AlertCircle,
  Search,
  Sparkles,
  ShieldCheck,
  CheckSquare,
  Square,
  RefreshCw,
} from 'lucide-react';

interface GeminiCandidate {
  id: string;
  email: string;
  name: string;
  hasCookies: boolean;
  alreadyInVids: boolean;
  currentVidsCredits: number | null;
  cookieSnippet?: string;
}

interface ImportResultItem {
  email: string;
  name?: string;
  status: 'success' | 'failed' | 'skipped';
  credits?: number;
  totalCredits?: number;
  accountType?: 'Workspace' | 'Consumer';
  accountStatus?: string;
  error?: string;
  message?: string;
}

interface VidsImportFromGeminiModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId?: string;
  onImportSuccess?: (importedCount: number) => void;
}

export const VidsImportFromGeminiModal: React.FC<VidsImportFromGeminiModalProps> = ({
  isOpen,
  onClose,
  userId,
  onImportSuccess,
}) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [candidates, setCandidates] = useState<GeminiCandidate[]>([]);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterMode, setFilterMode] = useState<'all' | 'new' | 'existing'>('new');
  const [overwriteExisting, setOverwriteExisting] = useState<boolean>(false);

  const [importing, setImporting] = useState<boolean>(false);
  const [importResults, setImportResults] = useState<ImportResultItem[] | null>(null);
  const [importSummaryMessage, setImportSummaryMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const effectiveUserId = useMemo(() => {
    if (userId) return userId;
    try {
      const stored = localStorage.getItem('user') || localStorage.getItem('auth_user');
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.user_id || parsed.userId || parsed.id || '';
      }
    } catch (e) {}
    return 'USR-MST2K7JW-JXH4'; // Fallback default user ID
  }, [userId]);

  // Load candidates when modal opens
  useEffect(() => {
    if (!isOpen) {
      setImportResults(null);
      setErrorMessage('');
      return;
    }

    const fetchCandidates = async () => {
      setLoading(true);
      setErrorMessage('');
      try {
        const res = await fetch(`/api/vids/gemini-candidates?userId=${encodeURIComponent(effectiveUserId)}`);
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Gagal memuat kandidat akun Gemini dari Google Sheets.');
        }

        const items: GeminiCandidate[] = Array.isArray(data.candidates) ? data.candidates : [];
        setCandidates(items);

        // Auto-select all candidates that are NOT yet in Vids and have cookies
        const initialSelected = new Set<string>();
        items.forEach((c) => {
          if (!c.alreadyInVids && c.hasCookies) {
            initialSelected.add(c.email.toLowerCase());
          }
        });
        setSelectedEmails(initialSelected);
      } catch (err: any) {
        setErrorMessage(err.message || 'Terjadi kesalahan saat memuat data.');
      } finally {
        setLoading(false);
      }
    };

    fetchCandidates();
  }, [isOpen, effectiveUserId]);

  // Filter candidates based on search & filterMode
  const filteredCandidates = useMemo(() => {
    return candidates.filter((item) => {
      const q = searchQuery.toLowerCase().trim();
      const matchSearch = !q || item.email.toLowerCase().includes(q) || (item.name && item.name.toLowerCase().includes(q));
      if (!matchSearch) return false;

      if (filterMode === 'new') return !item.alreadyInVids;
      if (filterMode === 'existing') return item.alreadyInVids;
      return true;
    });
  }, [candidates, searchQuery, filterMode]);

  const toggleSelectEmail = (email: string) => {
    const next = new Set(selectedEmails);
    const key = email.toLowerCase();
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedEmails(next);
  };

  const handleSelectAllFiltered = () => {
    const next = new Set(selectedEmails);
    const selectable = filteredCandidates.filter((c) => c.hasCookies);
    const allSelected = selectable.every((c) => next.has(c.email.toLowerCase()));

    if (allSelected) {
      selectable.forEach((c) => next.delete(c.email.toLowerCase()));
    } else {
      selectable.forEach((c) => next.add(c.email.toLowerCase()));
    }
    setSelectedEmails(next);
  };

  const handleRunImport = async () => {
    if (selectedEmails.size === 0) return;

    setImporting(true);
    setErrorMessage('');
    setImportResults(null);
    try {
      const res = await fetch('/api/vids/import-from-gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: effectiveUserId,
          accountEmails: Array.from(selectedEmails),
          overwriteExisting,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Proses impor akun gagal.');
      }

      setImportResults(data.results || []);
      setImportSummaryMessage(data.message || `Berhasil mengimpor ${data.importedCount} akun ke Google Vids.`);

      // Update localStorage & trigger app-wide refresh
      try {
        const vidsRes = await fetch(`/api/providers/vids/accounts?userId=${encodeURIComponent(effectiveUserId)}`);
        const vidsData = await vidsRes.json();
        if (vidsData.success && Array.isArray(vidsData.accounts)) {
          const activeVidsId = localStorage.getItem('vids_active_account_id');
          const isHealthy = (acc: any) => !acc.accountStatus || acc.accountStatus === 'active';
          const activeAcc =
            (activeVidsId ? vidsData.accounts.find((a: any) => a.id === activeVidsId && isHealthy(a)) : undefined) ||
            vidsData.accounts.find((a: any) => Boolean(a.isActive) && isHealthy(a)) ||
            vidsData.accounts.find((a: any) => isHealthy(a)) ||
            vidsData.accounts[0];

          const singleActiveAccounts = vidsData.accounts.map((a: any) => ({
            ...a,
            isActive: activeAcc ? a.id === activeAcc.id : false,
          }));

          localStorage.setItem('vids_accounts', JSON.stringify(singleActiveAccounts));
          if (activeAcc?.id) {
            localStorage.setItem('vids_active_account_id', activeAcc.id);
          }
          window.dispatchEvent(new Event('vids_accounts_updated'));
          window.dispatchEvent(new Event('accounts-updated'));
        }
      } catch (e) {}

      onImportSuccess?.(data.importedCount || 0);
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal mengeksekusi impor akun.');
    } finally {
      setImporting(false);
    }
  };

  if (!isOpen) return null;

  const totalNewCount = candidates.filter((c) => !c.alreadyInVids).length;
  const totalExistingCount = candidates.filter((c) => c.alreadyInVids).length;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between bg-stone-50/50 dark:bg-stone-800/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
                Tarik Akun dari Google Gemini ke Google Vids
                <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-semibold">
                  Sheets Sync
                </span>
              </h3>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                Gunakan sesi akun Google Gemini yang sudah terdaftar di Sheet untuk langsung mendapatkan kuota video Google Vids (~500 kredit).
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={importing}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 flex items-start gap-3 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Terjadi Kesalahan</p>
                <p className="mt-0.5">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Results Summary if import finished */}
          {importResults && (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 space-y-3">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5" />
                <span>{importSummaryMessage}</span>
              </div>
              <div className="max-h-48 overflow-y-auto divide-y divide-emerald-200/50 dark:divide-emerald-900/30 text-xs">
                {importResults.map((res, idx) => (
                  <div key={idx} className="py-2 flex items-center justify-between">
                    <div>
                      <span className="font-medium text-stone-800 dark:text-stone-200">{res.email}</span>
                      <span className="text-stone-400 ml-2">({res.accountType || 'Google Account'})</span>
                      {res.error && <p className="text-red-500 text-[11px] mt-0.5">{res.error}</p>}
                    </div>
                    <div>
                      {res.status === 'success' && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold">
                          ✅ {res.credits} Kredit Vids
                        </span>
                      )}
                      {res.status === 'skipped' && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-semibold">
                          Dilewati (Eksisting)
                        </span>
                      )}
                      {res.status === 'failed' && (
                        <span className="px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-semibold">
                          Gagal / Expired
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Controls & Filter Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-stone-50 dark:bg-stone-800/40 p-3 rounded-xl border border-stone-200 dark:border-stone-800">
            {/* Search Box */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-stone-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari email atau nama akun..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Filter Buttons */}
            <div className="flex items-center gap-1.5 self-center">
              <button
                type="button"
                onClick={() => setFilterMode('new')}
                className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                  filterMode === 'new'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800'
                }`}
              >
                Belum di Vids ({totalNewCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('existing')}
                className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                  filterMode === 'existing'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800'
                }`}
              >
                Sudah Ada ({totalExistingCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                  filterMode === 'all'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800'
                }`}
              >
                Semua ({candidates.length})
              </button>
            </div>
          </div>

          {/* Select All & Overwrite Options */}
          <div className="flex items-center justify-between px-1 text-xs text-stone-600 dark:text-stone-400">
            <button
              type="button"
              onClick={handleSelectAllFiltered}
              disabled={loading || filteredCandidates.length === 0}
              className="flex items-center gap-2 hover:text-stone-900 dark:hover:text-stone-200 font-medium"
            >
              {filteredCandidates.length > 0 &&
              filteredCandidates.filter((c) => c.hasCookies).every((c) => selectedEmails.has(c.email.toLowerCase())) ? (
                <CheckSquare className="w-4 h-4 text-blue-600" />
              ) : (
                <Square className="w-4 h-4 text-stone-400" />
              )}
              <span>Pilih Semua yang Ditampilkan ({selectedEmails.size} terpilih)</span>
            </button>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={overwriteExisting}
                onChange={(e) => setOverwriteExisting(e.target.checked)}
                className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 dark:bg-stone-900 border-stone-300 dark:border-stone-700"
              />
              <span className="text-[11px]">Perbarui cookie akun yang sudah ada</span>
            </label>
          </div>

          {/* Candidates List Table */}
          <div className="border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
            {loading ? (
              <div className="py-16 flex flex-col items-center justify-center gap-3 text-stone-400">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                <span className="text-xs">Membaca daftar akun dari Google Sheets...</span>
              </div>
            ) : filteredCandidates.length === 0 ? (
              <div className="py-12 text-center text-xs text-stone-500 dark:text-stone-400">
                Tidak ada akun Gemini yang cocok dengan filter saat ini.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-stone-100 dark:divide-stone-800/60">
                {filteredCandidates.map((candidate) => {
                  const isSelected = selectedEmails.has(candidate.email.toLowerCase());
                  return (
                    <div
                      key={candidate.email}
                      onClick={() => candidate.hasCookies && toggleSelectEmail(candidate.email)}
                      className={`p-3 flex items-center justify-between text-xs transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-blue-50/60 dark:bg-blue-950/20'
                          : 'hover:bg-stone-50 dark:hover:bg-stone-800/30'
                      } ${!candidate.hasCookies ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!candidate.hasCookies}
                          onChange={() => toggleSelectEmail(candidate.email)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 dark:bg-stone-900 border-stone-300 dark:border-stone-700"
                        />
                        <div>
                          <p className="font-semibold text-stone-900 dark:text-stone-100">{candidate.email}</p>
                          <p className="text-[11px] text-stone-400">
                            {candidate.name} {candidate.cookieSnippet ? `• ${candidate.cookieSnippet}` : ''}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {candidate.alreadyInVids ? (
                          <span className="px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 text-[11px] font-medium">
                            Sudah di Vids {candidate.currentVidsCredits !== null ? `(${candidate.currentVidsCredits} kredit)` : ''}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />
                            Siap Diimpor (~500 Kuota)
                          </span>
                        )}

                        {!candidate.hasCookies && (
                          <span className="px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-[11px]">
                            Tanpa Sesi Cookie
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/20 flex items-center justify-between">
          <div className="text-xs text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Verifikasi kuota Google Vids otomatis via Opcode 374/389</span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={importing}
              className="px-4 py-2 text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-xl transition-colors"
            >
              {importResults ? 'Selesai' : 'Batal'}
            </button>
            <button
              type="button"
              onClick={handleRunImport}
              disabled={importing || selectedEmails.size === 0 || loading}
              className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-sm flex items-center gap-2 transition-all"
            >
              {importing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Memverifikasi & Menarik...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Tarik {selectedEmails.size} Akun Terpilih</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
