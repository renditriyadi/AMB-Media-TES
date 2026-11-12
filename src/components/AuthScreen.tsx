import React, { useEffect, useRef, useState } from 'react';
import { Lock, User, Mail, Eye, EyeOff, AlertCircle, CheckCircle2, Loader2, Sun, Moon } from 'lucide-react';
import { AppUser } from '../types';
import { AUTH_WORD_CHARS, createAuthIntro, AuthIntroApi } from './auth/authIntroEngine';
import './auth/AuthScreen.css';

interface AuthScreenProps {
  onLoginSuccess: (user: AppUser) => void;
  isDarkMode: boolean;
  onToggleDarkMode: (e?: React.MouseEvent) => void;
}

/* [x, y, w, h, kelas warna, delay mentah, offset jatuh, delay bob] */
const ICON_CARDS: [number, number, number, number, string, number, number, number][] = [
  [24, 24, 20, 36, 'auth-k1', 0.35, -26, 2],
  [50, 24, 20, 24, 'auth-k3', 0.5, -26, 2.35],
  [76, 24, 20, 44, 'auth-k5', 0.65, -26, 2.7],
  [24, 66, 20, 30, 'auth-k2', 0.8, 26, 3.05],
  [50, 54, 20, 42, 'auth-k4', 0.95, 26, 3.4],
  [76, 74, 20, 22, 'auth-k6', 1.1, 26, 3.75],
];

const INPUT_CLASS =
  'w-full pl-10 pr-4 py-3 bg-white/60 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700 rounded-xl text-base sm:text-xs text-stone-900 dark:text-white placeholder-stone-400 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15 transition';

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onLoginSuccess,
  isDarkMode,
  onToggleDarkMode,
}) => {
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const lockRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<SVGSVGElement>(null);
  const wordRef = useRef<HTMLDivElement>(null);
  const cvbRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const userInputRef = useRef<HTMLInputElement>(null);

  const darkRef = useRef(isDarkMode);
  darkRef.current = isDarkMode;
  const apiRef = useRef<AuthIntroApi | null>(null);

  // Mulai intro + latar canvas
  useEffect(() => {
    const api = createAuthIntro(
      {
        root: rootRef.current!,
        lock: lockRef.current!,
        icon: iconRef.current!,
        word: wordRef.current!,
        cvb: cvbRef.current!,
        bg: bgRef.current!,
        card: cardRef.current!,
        slot: slotRef.current!,
      },
      () => darkRef.current,
      () => {
        // Setelah intro selesai, fokuskan username (kalau belum ada yang difokus)
        const a = document.activeElement;
        if (!a || a === document.body) userInputRef.current?.focus({ preventScroll: true });
      },
    );
    apiRef.current = api;
    return () => {
      api.destroy();
      apiRef.current = null;
    };
  }, []);

  // Gambar ulang latar saat tema berganti
  useEffect(() => {
    apiRef.current?.redraw();
  }, [isDarkMode]);

  const switchMode = (register: boolean) => {
    setIsRegisterMode(register);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanUser = username.trim();
    const cleanPass = password.trim();

    if (!cleanUser) {
      setErrorMsg('Username wajib diisi.');
      return;
    }
    if (!cleanPass) {
      setErrorMsg('Password wajib diisi.');
      return;
    }

    setIsLoading(true);

    try {
      if (isRegisterMode) {
        // Register flow
        const resp = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: cleanUser,
            password: cleanPass,
            email: email.trim(),
          }),
        });

        const data = await resp.json();
        if (!resp.ok || !data.success) {
          throw new Error(data.error || 'Gagal mendaftarkan user.');
        }

        setSuccessMsg(`Akun "${data.user.userName}" berhasil didaftarkan!`);
        setTimeout(() => {
          onLoginSuccess(data.user);
        }, 1000);
      } else {
        // Login flow
        const resp = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: cleanUser,
            password: cleanPass,
          }),
        });

        const data = await resp.json();
        if (!resp.ok || !data.success) {
          throw new Error(data.error || 'Username atau password salah.');
        }

        // Langsung login tanpa delay notifikasi
        onLoginSuccess(data.user);
      }
    } catch (err: any) {
      let msg = err.message || 'Username atau password salah.';
      if (/sheet|spreadsheet|database|\bdb\b|sql/i.test(msg)) {
        msg = 'Username atau password salah.';
      }
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className="amb-auth relative min-h-screen w-full flex flex-col font-sans-body bg-[#f5f5f4] dark:bg-[#09090B] text-stone-900 dark:text-stone-100 overflow-hidden selection:bg-amber-200 selection:text-amber-900"
      style={{
        boxSizing: 'border-box',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {/* Latar canvas: galeri masonry + aurora */}
      <canvas ref={bgRef} className="auth-bg" />

      {/* Lockup intro: ikon + teks "AMB Media" (mendarat di slot pojok kiri atas) */}
      <div ref={lockRef} className="auth-lock">
        <svg ref={iconRef} className="auth-icon" viewBox="0 0 120 120" aria-hidden="true">
          <g className="auth-tile">
            <rect className="auth-tbg" width="120" height="120" rx="30" />
            <rect x="1" y="1" width="118" height="118" rx="29" fill="none" stroke="#F59E0B" strokeOpacity=".45" strokeWidth="2" />
          </g>
          {ICON_CARDS.map((c, i) => (
            <g
              key={i}
              className="auth-drop"
              style={{ '--d': `${((c[5] - 0.35) * 0.45 + 0.08).toFixed(3)}s`, '--dy': `${c[6]}px` } as React.CSSProperties}
            >
              <rect
                className={`auth-bob ${c[4]}`}
                style={{ '--bd': `${c[7]}s` } as React.CSSProperties}
                x={c[0]}
                y={c[1]}
                width={c[2]}
                height={c[3]}
                rx="7"
              />
            </g>
          ))}
          <g className="auth-pop">
            <polygon className="auth-pl" points="82,39 82,53 92,46" strokeWidth="2" strokeLinejoin="round" />
          </g>
        </svg>
        <div ref={wordRef} className="auth-word" aria-label="AMB Media">
          {AUTH_WORD_CHARS.map((c, i) =>
            c === ' ' ? <span key={i} className="auth-sp" /> : <span key={i} className="auth-ch">{c}</span>,
          )}
          <i className="auth-probe" />
        </div>
        <canvas ref={cvbRef} className="auth-cvb" />
      </div>

      <div className="relative z-10 min-h-screen flex flex-col flex-1">
        {/* Top bar: slot logo + tombol tema */}
        <div className="w-full max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div ref={slotRef} style={{ height: 40 }} />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleDarkMode(e);
            }}
            className="p-2.5 rounded-2xl bg-white/70 dark:bg-stone-900/70 backdrop-blur border border-stone-200/80 dark:border-stone-800 text-stone-700 dark:text-stone-300 cursor-pointer"
            title="Ganti Tema"
          >
            {isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        {/* Card login */}
        <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
          <div ref={cardRef} className="auth-card w-full max-w-md backdrop-blur-2xl rounded-3xl p-6 sm:p-8">
            <div className="text-center mb-7">
              <h2 data-s className="font-serif-display text-3xl font-normal text-stone-900 dark:text-white">
                {isRegisterMode ? 'Daftar Akun Baru' : 'Silakan Masuk'}
              </h2>
              <p data-s className="text-xs text-stone-500 dark:text-stone-400 max-w-xs mx-auto mt-2">
                Gunakan akun yang terdaftar untuk mengakses studio.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {errorMsg && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs rounded-xl flex items-start gap-2 animate-fade-in">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs rounded-xl flex items-start gap-2 animate-fade-in">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* Username */}
              <div data-s className="space-y-1.5">
                <label className="text-xs font-medium text-stone-700 dark:text-stone-300">Username</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-stone-400">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    ref={userInputRef}
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Masukkan username lengkap"
                    autoComplete="username"
                    disabled={isLoading}
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              {/* Email (mode daftar) */}
              {isRegisterMode && (
                <div className="space-y-1.5 animate-fade-in">
                  <label className="text-xs font-medium text-stone-700 dark:text-stone-300">Email</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-stone-400">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Contoh: nama@gmail.com"
                      disabled={isLoading}
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
              )}

              {/* Password */}
              <div data-s className="space-y-1.5">
                <label className="text-xs font-medium text-stone-700 dark:text-stone-300">Password</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-stone-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Masukkan kata sandi..."
                    autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
                    disabled={isLoading}
                    className={`${INPUT_CLASS} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <div data-s className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 px-4 bg-linear-to-b from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-stone-900 font-semibold rounded-xl text-xs shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-stone-900" />
                      <span>Memproses...</span>
                    </>
                  ) : isRegisterMode ? (
                    <span>Daftarkan Akun</span>
                  ) : (
                    <span>Masuk ke Studio</span>
                  )}
                </button>
              </div>

              {/* Link ganti mode */}
              <div data-s className="text-center pt-1 text-xs text-stone-500 dark:text-stone-400">
                <span>{isRegisterMode ? 'Sudah punya akun?' : 'Belum punya akun?'}</span>{' '}
                <button
                  type="button"
                  onClick={() => switchMode(!isRegisterMode)}
                  className="font-medium text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                >
                  {isRegisterMode ? 'Masuk ke Studio' : 'Daftar Sekarang'}
                </button>
              </div>
            </form>
          </div>
        </div>
        <div style={{ height: 56 }} />
      </div>
    </div>
  );
};
