// Palette & ukuran konektor/kabel Canvas — mengikuti referensi ThreeJS_Cable_Fixed.
// Warna berupa CSS variable (didefinisikan di index.css) supaya otomatis ikut mode light/dark
// lewat class `.dark` pada <html>, tanpa state React.
export type PortKind = 'image' | 'video' | 'text';

export const PORT_R = 12; // radius konektor (diameter 24px)
export const PORT_OFF = 18; // jarak titik tengah konektor dari tepi kartu (di luar kartu)

export const CABLE_PALETTE: Record<PortKind, { fill: string; icon: string; cable: string }> = {
  image: { fill: 'var(--port-image-fill)', icon: 'var(--port-image-icon)', cable: 'var(--cable-image)' },
  video: { fill: 'var(--port-video-fill)', icon: 'var(--port-video-icon)', cable: 'var(--cable-video)' },
  text: { fill: 'var(--port-text-fill)', icon: 'var(--port-text-icon)', cable: 'var(--cable-text)' },
};
