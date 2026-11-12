import React from 'react';
import { Image as ImageIcon, Film, Type } from 'lucide-react';
import { CABLE_PALETTE, PortKind } from '../../lib/canvasCable';

interface PortBeadProps {
  kind: PortKind;
  isConnected?: boolean;
  isTarget?: boolean; // sedang ada kabel di-drag & port ini kandidat tujuan
  title?: string;
}

/** Konektor: lingkaran pastel 24px berisi ikon tipe data (gambar / video / teks). */
export const PortBead: React.FC<PortBeadProps> = ({ kind, isConnected, isTarget, title }) => {
  const pc = CABLE_PALETTE[kind];
  const Icon = kind === 'image' ? ImageIcon : kind === 'video' ? Film : Type;
  return (
    <div
      title={title}
      className="w-6 h-6 rounded-full flex items-center justify-center select-none transition-transform duration-150 group-hover:scale-105"
      style={{
        background: pc.fill,
        transform: isTarget ? 'scale(1.12)' : undefined,
        boxShadow: isTarget
          ? `0 0 0 2px ${pc.cable}, 0 1px 5px rgba(0,0,0,.3)`
          : isConnected
          ? '0 1px 5px rgba(0,0,0,.3)'
          : undefined,
      }}
    >
      <Icon size={12} color={pc.icon} strokeWidth={kind === 'text' ? 1.7 : 2} />
    </div>
  );
};

/**
 * Bubble label di atas konektor — muncul hanya saat hover (parent harus punya class "group").
 * Warna pakai inline style + CSS variable (--port-tip-bg/fg), BUKAN class text-white/bg-*, karena
 * "Canvas Light Skin" di index.css menimpa .text-white di dalam kartu saat mode terang.
 */
export const PortTooltip: React.FC<{ text: string }> = ({ text }) => (
  <span
    role="tooltip"
    className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-[6px] z-50 whitespace-nowrap rounded-[10px] px-3 py-1.5 text-[12px] font-semibold leading-[1.2] opacity-0 shadow-[0_6px_16px_-4px_rgba(0,0,0,0.4)] transition-opacity duration-100 group-hover:opacity-100"
    style={{ background: 'var(--port-tip-bg)', color: 'var(--port-tip-fg)' }}
  >
    {text}
    <span
      className="absolute left-1/2 -bottom-[3px] h-2 w-2 -translate-x-1/2 rotate-45 rounded-[2px]"
      style={{ background: 'var(--port-tip-bg)' }}
    />
  </span>
);
