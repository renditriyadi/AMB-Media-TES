/**
 * Mesin animasi halaman login AMB Media:
 * intro lockup (ikon + teks), latar canvas (galeri masonry + aurora),
 * dan animasi masuk card. Dipisah dari React supaya loop rAF tidak ikut re-render.
 */

export const AUTH_WORD_CHARS = ['A', 'M', 'B', ' ', 'M', 'e', 'd', '\u0131', 'a'];

export interface AuthIntroRefs {
  root: HTMLElement;
  lock: HTMLElement;
  icon: SVGElement;
  word: HTMLElement;
  cvb: HTMLCanvasElement;
  bg: HTMLCanvasElement;
  card: HTMLElement;
  slot: HTMLElement;
}

export interface AuthIntroApi {
  redraw: () => void;
  replay: () => void;
  destroy: () => void;
}

/* ===== helper ala Remotion ===== */
function sp(t: number, d?: number) {
  if (t <= 0) return 0;
  const z = (d || 10) / 20, w = 10, wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
}
const spring = (f: number, d?: number) => sp(f / 30, d);
function ease(u: number) {
  u = Math.min(1, Math.max(0, u));
  return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
}
function interpolate(v: number, a: number, b: number, c: number, d: number) {
  const p = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return c + (d - c) * p;
}
function rnd(s: number) {
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mix(a: number[], b: number[], p: number) {
  return 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * p)).join(',') + ')';
}

export function createAuthIntro(
  refs: AuthIntroRefs,
  getDark: () => boolean,
  onReady?: () => void,
): AuthIntroApi {
  const { root, lock, icon, word, cvb, bg: cv, card, slot } = refs;
  const cb = cvb.getContext('2d')!;
  const cx = cv.getContext('2d')!;
  const spans = Array.from(word.querySelectorAll<HTMLElement>('.auth-ch,.auth-sp'));
  const probe = word.querySelector<HTMLElement>('.auth-probe')!;
  const items = Array.from(root.querySelectorAll<HTMLElement>('[data-s]'));
  const CH = AUTH_WORD_CHARS;
  let cancelled = false;

  /* ===== timeline (detik) ===== */
  const tS = 0.95, tF = 1.2, T0 = tF + 0.45;
  const DUR = [0.2, 0.2, 0.3, 0.2, 0.2, 0.22];
  const HOPH = [34, 34, 52, 32, 32, 40];
  const IDX = [0, 1, 2, 4, 5, 6, 7];
  const T = [T0];
  const LT: Record<number, number> = {};
  DUR.forEach((d, i) => T.push(T[i] + d));
  IDX.forEach((x, k) => { LT[x] = T[k]; });
  LT[8] = T[6] + 0.1;
  const tSh = T[6] + 0.4, tC = tSh + 0.1, END = tC + 6;
  const CALM = 3; // detik transisi ke mode kalem setelah intro

  /* ===== state ===== */
  let W = 0, H = 0, D = 1, LW = 0, LH = 0;
  const fs = 84, R = fs * 0.11, RD = fs * 0.075;
  let P0x = 0, P0y = 0, LX: number[] = [], LY: number[] = [];
  let s0 = 1, s1 = 1, x0 = 0, y0 = 0, x1 = 0, y1 = 0;
  let cols: any[] = [];
  const PAL = [['#FDE68A', '#F59E0B'], ['#FBBF24', '#D97706'], ['#FCD34D', '#92400E'], ['#FDBA74', '#EA580C'], ['#E7E5E4', '#78716C'], ['#FDE68A', '#B45309']];
  let done = false;
  let t0: number | null = null, raf = 0, lastT = 0, prevT = 0, PH = 0, ANG = 0, lastDraw = 0;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ===== lockup ===== */
  function build() {
    W = innerWidth; H = innerHeight; D = Math.min(devicePixelRatio || 1, 1.5);
    lock.style.transform = 'none';
    const lr = lock.getBoundingClientRect(); LW = lr.width; LH = lr.height;
    cvb.width = (LW + 120) * D; cvb.height = (LH + 120) * D;
    cvb.style.width = (LW + 120) + 'px'; cvb.style.height = (LH + 120) + 'px';
    cvb.style.left = '-60px'; cvb.style.top = '-60px';
    cb.font = '400 ' + fs + 'px "Playfair Display",Georgia,serif';
    const ir = icon.getBoundingClientRect();
    P0x = ir.left - lr.left + ir.width * 87 / 120; P0y = ir.top - lr.top + ir.height * 46 / 120;
    const base = probe.getBoundingClientRect().top - lr.top;
    LX = []; LY = [];
    IDX.forEach((idx) => {
      const r = spans[idx].getBoundingClientRect(), m = cb.measureText(CH[idx]);
      LX.push(r.left - lr.left + (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2);
      LY.push(idx === 7 ? base - cb.measureText('i').actualBoundingBoxAscent + RD : base - m.actualBoundingBoxAscent - R);
    });
    s0 = Math.min(1, W * 0.9 / LW); x0 = (W - LW * s0) / 2; y0 = (H - LH * s0) / 2 - H * 0.03; s1 = 40 / LH;
    slot.style.width = (LW * s1) + 'px';
    const q = slot.getBoundingClientRect(); x1 = q.left; y1 = q.top;
    buildBg();
  }
  function place(t: number) {
    const p = ease((t - tSh) / 0.8);
    lock.style.transform = 'translate(' + (x0 + (x1 - x0) * p) + 'px,' + (y0 + (y1 - y0) * p) + 'px) scale(' + (s0 + (s1 - s0) * p) + ')';
  }

  function ballAt(t: number) {
    const o = { vis: false, x: 0, y: 0, r: R, sx: 1, sy: 1 };
    if (t < tS) return o;
    o.vis = true;
    let u: number;
    const yS = P0y - 14;
    if (t < tF) {
      u = (t - tS) / (tF - tS);
      o.x = P0x; o.y = P0y - 14 * ease(u);
      o.r = R * Math.max(0, Math.min(1.12, sp(t - tS, 9)));
      return o;
    }
    if (t < T[0]) {
      u = (t - tF) / (T0 - tF);
      o.x = P0x + (LX[0] - P0x) * u; o.y = yS + (LY[0] - yS) * u - 4 * 56 * u * (1 - u);
    } else {
      let k = 1;
      while (k < 7 && t >= T[k]) k++;
      if (t >= T[6]) {
        o.x = LX[6]; o.y = LY[6]; o.r = R + (RD - R) * ease((t - T[6]) / 0.3);
      } else {
        u = (t - T[k - 1]) / DUR[k - 1];
        o.x = LX[k - 1] + (LX[k] - LX[k - 1]) * u;
        o.y = LY[k - 1] + (LY[k] - LY[k - 1]) * u - 4 * HOPH[k - 1] * u * (1 - u);
      }
    }
    for (let j = 0; j < 7; j++) {
      const d = t - T[j], last = j === 6, len = last ? 0.42 : 0.1;
      if (d >= 0 && d < len) {
        const s = last ? Math.exp(-d * 9) * Math.cos(d * 34) * 0.36 : 0.3 * (1 - d / len);
        o.sy = 1 - s; o.sx = 1 + s * 0.8;
      }
    }
    return o;
  }

  const AMB = [245, 158, 11];
  function renderLock(t: number) {
    const dark = getDark();
    const ink = dark ? [244, 244, 245] : [28, 25, 23];
    spans.forEach((s, i) => {
      const lt = LT[i];
      if (lt == null) return;
      const dt = t - lt;
      if (dt < 0) { s.style.opacity = '0'; return; }
      const p = sp(dt, 11);
      s.style.opacity = String(Math.min(1, dt / 0.07));
      s.style.transform = i === 7 ? 'scaleY(' + Math.min(1.06, p) + ')' : 'translateY(' + (1 - p) * 18 + 'px) scaleY(' + (0.55 + 0.45 * p) + ')';
      s.style.color = mix(AMB, ink, ease(dt / 0.7));
    });
    cb.setTransform(D, 0, 0, D, 60 * D, 60 * D);
    cb.clearRect(-60, -60, LW + 120, LH + 120);
    for (let k = 0; k < 7; k++) {
      const dt = t - T[k];
      if (dt > 0 && dt < 0.5) {
        const q = dt / 0.5, rx = R + q * fs * 0.9;
        cb.globalAlpha = 0.5 * (1 - q); cb.strokeStyle = '#F59E0B'; cb.lineWidth = 1.5;
        cb.beginPath(); cb.ellipse(LX[k], LY[k] + (k === 6 ? RD : R), rx, rx * 0.28, 0, 0, 6.283); cb.stroke();
      }
    }
    for (let j = 7; j >= 1; j--) {
      const b = ballAt(t - j * 0.022);
      if (!b.vis || t > T[6]) continue;
      cb.globalAlpha = 0.3 * (1 - j / 8); cb.fillStyle = '#F59E0B';
      cb.beginPath(); cb.arc(b.x, b.y, b.r * (1 - j / 11), 0, 6.283); cb.fill();
    }
    const b = ballAt(t);
    cb.globalAlpha = 1;
    if (b.vis && b.r > 0.2) {
      const a = ballAt(t - 0.012), c = ballAt(t + 0.012);
      const vx = c.x - a.x, vy = c.y - a.y, v = Math.hypot(vx, vy) / 0.024, st = Math.min(0.3, v / 2000);
      cb.save(); cb.translate(b.x, b.y);
      if (v > 60) cb.rotate(Math.atan2(vy, vx));
      cb.scale((v > 60 ? 1 + st : 1) * b.sx, (v > 60 ? 1 - st * 0.6 : 1) * b.sy);
      const g = cb.createRadialGradient(-b.r * 0.3, -b.r * 0.3, b.r * 0.1, 0, 0, b.r);
      g.addColorStop(0, '#FDE68A'); g.addColorStop(0.55, '#F59E0B'); g.addColorStop(1, '#D97706');
      cb.shadowColor = 'rgba(245,158,11,.65)'; cb.shadowBlur = 14; cb.fillStyle = g;
      cb.beginPath(); cb.arc(0, 0, b.r, 0, 6.283); cb.fill(); cb.restore(); cb.shadowBlur = 0;
    }
  }

  /* ===== latar canvas: galeri masonry + aurora ===== */
  function buildBg() {
    cv.width = W * D; cv.height = H * D;
    const dg = Math.hypot(W, H), cw = Math.max(140, Math.min(200, W / 5)), gap = 16, n = Math.ceil(dg / (cw + gap)) + 1;
    cols = [];
    for (let i = 0; i < n; i++) {
      const r = rnd(i * 97 + 13);
      let y = 0;
      const t: any[] = [];
      while (y < dg * 1.3) {
        const h = cw * (0.8 + r() * 1.1);
        t.push({ y, h, g: Math.floor(r() * PAL.length), p: r() < 0.35 });
        y += h + gap;
      }
      cols.push({ x: (i - n / 2) * (cw + gap), w: cw, H: y, sp: 0.35 + r() * 0.5, dir: i % 2 ? 1 : -1, t });
    }
  }
  function rr(x: number, y: number, w: number, h: number, r: number) {
    cx.beginPath();
    if ((cx as any).roundRect) (cx as any).roundRect(x, y, w, h, r); else cx.rect(x, y, w, h);
  }
  function drawBg(f: number) {
    const dark = getDark();
    cx.setTransform(D, 0, 0, D, 0, 0); cx.fillStyle = dark ? '#09090B' : '#f5f5f4'; cx.fillRect(0, 0, W, H);
    const A = dark
      ? ['rgba(245,158,11,.30)', 'rgba(217,119,6,.22)', 'rgba(99,102,241,.16)']
      : ['rgba(245,158,11,.32)', 'rgba(251,191,36,.28)', 'rgba(244,114,182,.14)'];
    for (let i = 0; i < 3; i++) {
      const x = W * (0.5 + 0.38 * Math.sin(PH / 110 + i * 2.1)), y = H * (0.5 + 0.34 * Math.cos(PH / 130 + i * 1.7)), rad = Math.max(W, H) * 0.55;
      const g = cx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, A[i]); g.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    }
    cx.save(); cx.translate(W / 2, H / 2); cx.rotate(-0.21);
    const dg = Math.hypot(W, H);
    cols.forEach((c, i) => {
      const p = spring(f - i * 4 - 6, 13);
      if (p <= 0) return;
      const off = (((PH * c.sp * c.dir) % c.H) + c.H) % c.H;
      for (let k = 0; k < 2; k++) {
        c.t.forEach((t: any) => {
          const ty = -dg * 0.65 + t.y + k * c.H - off + (1 - p) * 80;
          if (ty > dg || ty + t.h < -dg) return;
          const pal = PAL[t.g], g = cx.createLinearGradient(c.x, ty, c.x + c.w, ty + t.h);
          g.addColorStop(0, pal[0]); g.addColorStop(1, pal[1]);
          cx.globalAlpha = Math.min(1, p) * (dark ? 0.17 : 0.34); cx.fillStyle = g; rr(c.x, ty, c.w, t.h, 18); cx.fill();
          if (t.p) {
            cx.globalAlpha = Math.min(1, p) * (dark ? 0.5 : 0.65); cx.fillStyle = dark ? '#fff' : '#1c1917';
            const mx = c.x + c.w / 2, my = ty + t.h / 2;
            cx.beginPath(); cx.moveTo(mx - 5, my - 8); cx.lineTo(mx - 5, my + 8); cx.lineTo(mx + 9, my); cx.closePath(); cx.fill();
          }
        });
      }
    });
    cx.restore(); cx.globalAlpha = 1;
    const m = Math.max(W, H) * 0.62, v = cx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, m), bgc = dark ? '9,9,11' : '245,245,244';
    v.addColorStop(0, 'rgba(' + bgc + ',.82)'); v.addColorStop(0.5, 'rgba(' + bgc + ',.45)'); v.addColorStop(1, 'rgba(' + bgc + ',0)');
    cx.fillStyle = v; cx.fillRect(0, 0, W, H);
  }

  /* ===== card masuk (stagger) ===== */
  function ui(t: number) {
    const f = (t - tC) * 30;
    card.style.setProperty('--a', (ANG % 360) + 'deg');
    if (f < 0) {
      card.style.opacity = '0'; card.style.pointerEvents = 'none';
      items.forEach((e) => { e.style.opacity = '0'; });
      done = false; return;
    }
    card.style.pointerEvents = '';
    if (f > 170) {
      if (!done) {
        done = true; card.style.opacity = '1'; card.style.transform = '';
        items.forEach((e) => { e.style.opacity = '1'; e.style.transform = ''; });
        onReady?.();
      }
      return;
    }
    const cp = spring(f - 4, 12);
    card.style.opacity = String(Math.min(1, cp * 1.4));
    card.style.transform = 'translateY(' + (1 - cp) * 40 + 'px) scale(' + (0.93 + 0.07 * cp) + ')';
    items.forEach((e, i) => {
      const p = spring(f - 18 - i * 5, 14);
      e.style.opacity = String(Math.min(1, p * 1.3));
      e.style.transform = 'translateY(' + (1 - p) * 18 + 'px)';
    });
  }

  /* ===== loop ===== */
  /* setelah intro selesai, gerakan latar & border card diperlambat; border berhenti saat form difokus */
  function frame(t: number) {
    const dt = Math.max(0, Math.min(0.1, t - prevT)); prevT = t;
    PH += dt * 30 * interpolate(t, END, END + CALM, 1, 0.2);
    ANG += card.matches(':focus-within') ? 0 : dt * interpolate(t, END, END + CALM, 42, 10);
    lastT = t; drawBg(t * 30); place(t); renderLock(t); ui(t);
  }
  function loop(now: number) {
    if (cancelled) return;
    if (t0 === null) t0 = now;
    const t = (now - t0) / 1000;
    if (t > END + CALM && now - lastDraw < 30) { raf = requestAnimationFrame(loop); return; }
    lastDraw = now; frame(t); raf = requestAnimationFrame(loop);
  }
  function skip() {
    if (t0 === null || still) return;
    const t = (performance.now() - t0) / 1000;
    if (t < END) { t0 -= (END - t) * 1000; icon.classList.add('fin'); }
  }
  function play() {
    cancelAnimationFrame(raf); t0 = null; done = false; prevT = 0; PH = 0; ANG = 0; lastDraw = 0;
    icon.classList.remove('play', 'fin'); void icon.getBoundingClientRect(); icon.classList.add('play');
    if (still) { icon.classList.add('fin'); frame(99); } else { frame(0); raf = requestAnimationFrame(loop); }
  }
  const onResize = () => { build(); frame(lastT); };
  window.addEventListener('pointerdown', skip);
  window.addEventListener('keydown', skip);
  window.addEventListener('resize', onResize);

  /* ===== mulai setelah font siap ===== */
  const go = () => {
    if (cancelled) return;
    build(); lock.style.visibility = 'visible'; play();
  };
  Promise.race([
    document.fonts.load('400 84px "Playfair Display"'),
    new Promise((r) => setTimeout(r, 1500)),
  ]).then(go, go);

  return {
    redraw: () => { if (W) frame(lastT); },
    replay: () => { if (W) play(); },
    destroy: () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('resize', onResize);
    },
  };
}
