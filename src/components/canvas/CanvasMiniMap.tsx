import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import {
  Map as MapIcon,
  Maximize2,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Layers,
} from 'lucide-react';
import { CanvasNode, CanvasEdge, getNodeWidth } from '../../types/canvas';

export interface CanvasMiniMapProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  pan: { x: number; y: number };
  zoom: number;
  containerWidth: number;
  containerHeight: number;
  selectedNodeIds?: string[];
  executingNodeIds?: string[];
  onPanChange: (pan: { x: number; y: number }) => void;
  onFitView?: (zoom: number, pan: { x: number; y: number }) => void;
  onResetZoom?: () => void;
}

const MINIMAP_WIDTH = 220;
const MINIMAP_HEIGHT = 140;
const PADDING = 12;

function getNodeEstimatedHeight(node: CanvasNode): number {
  switch (node.type) {
    case 'note':
      return 150;
    case 'prompt':
      return 200;
    case 'imageInput':
      return 260;
    case 'imageViewer':
      return 340;
    case 'imageModel':
    case 'geminiVideo':
    case 'vidsVideo':
      return 370;
    case 'videoStitcher':
      return 330;
    case 'storyboard':
      return 420;
    case 'aiWorker':
      return 360;
    case 'anyLLM':
    case 'promptEnhancer':
      return 320;
    default:
      return 280;
  }
}

function getNodeColor(node: CanvasNode): { fill: string; stroke: string } {
  switch (node.type) {
    case 'vidsVideo':
      return { fill: '#3b82f6', stroke: '#60a5fa' }; // Blue
    case 'geminiVideo':
      return { fill: '#8b5cf6', stroke: '#a78bfa' }; // Purple
    case 'imageModel':
      return { fill: '#f59e0b', stroke: '#fbbf24' }; // Amber
    case 'prompt':
      return { fill: '#10b981', stroke: '#34d399' }; // Emerald
    case 'imageViewer':
      return { fill: '#9333ea', stroke: '#c084fc' }; // Violet
    case 'videoStitcher':
      return { fill: '#f43f5e', stroke: '#fb7185' }; // Rose
    case 'storyboard':
      return { fill: '#eab308', stroke: '#fde047' }; // Yellow
    case 'imageInput':
      return { fill: '#06b6d4', stroke: '#22d3ee' }; // Cyan
    case 'aiWorker':
      return { fill: '#14b8a6', stroke: '#2dd4bf' }; // Teal
    case 'anyLLM':
    case 'promptEnhancer':
      return { fill: '#6366f1', stroke: '#818cf8' }; // Indigo
    case 'note':
      return { fill: '#e2e8f0', stroke: '#94a3b8' }; // Slate
    default:
      return { fill: '#64748b', stroke: '#94a3b8' };
  }
}

export const CanvasMiniMap: React.FC<CanvasMiniMapProps> = ({
  nodes,
  edges,
  pan,
  zoom,
  containerWidth,
  containerHeight,
  selectedNodeIds = [],
  executingNodeIds = [],
  onPanChange,
  onFitView,
  onResetZoom,
}) => {
  // Load initial collapsed state from localStorage (default: open)
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('amb_canvas_minimap_collapsed');
      return saved === 'true';
    } catch (_) {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('amb_canvas_minimap_collapsed', String(next));
      } catch (_) {}
      return next;
    });
  };

  const svgRef = useRef<SVGSVGElement>(null);
  const isDraggingViewportRef = useRef(false);
  const dragStartPosRef = useRef<{ clientX: number; clientY: number; initialPan: { x: number; y: number } }>({
    clientX: 0,
    clientY: 0,
    initialPan: { x: 0, y: 0 },
  });

  // Calculate World Bounding Box
  const { worldX0, worldY0, worldW, worldH, scale, offsetX, offsetY } = useMemo(() => {
    const validNodes = Array.isArray(nodes) ? nodes : [];

    // Current viewport in canvas space
    const vx0 = -pan.x / zoom;
    const vy0 = -pan.y / zoom;
    const vx1 = (containerWidth - pan.x) / zoom;
    const vy1 = (containerHeight - pan.y) / zoom;

    let minX = vx0;
    let maxX = vx1;
    let minY = vy0;
    let maxY = vy1;

    for (const n of validNodes) {
      const nw = getNodeWidth(n);
      const nh = getNodeEstimatedHeight(n);
      minX = Math.min(minX, n.position.x);
      maxX = Math.max(maxX, n.position.x + nw);
      minY = Math.min(minY, n.position.y);
      maxY = Math.max(maxY, n.position.y + nh);
    }

    const margin = 280; // Margin around canvas content
    const wX0 = minX - margin;
    const wY0 = minY - margin;
    const wW = Math.max(maxX + margin - wX0, 1400);
    const wH = Math.max(maxY + margin - wY0, 900);

    const mapInnerW = MINIMAP_WIDTH - PADDING * 2;
    const mapInnerH = MINIMAP_HEIGHT - PADDING * 2;
    const s = Math.min(mapInnerW / wW, mapInnerH / wH);
    const ox = PADDING + (mapInnerW - wW * s) / 2;
    const oy = PADDING + (mapInnerH - wH * s) / 2;

    return {
      worldX0: wX0,
      worldY0: wY0,
      worldW: wW,
      worldH: wH,
      scale: s,
      offsetX: ox,
      offsetY: oy,
    };
  }, [nodes, pan.x, pan.y, zoom, containerWidth, containerHeight]);

  // Viewport box in minimap coordinates
  const viewportRect = useMemo(() => {
    const vx0 = -pan.x / zoom;
    const vy0 = -pan.y / zoom;
    const vw = containerWidth / zoom;
    const vh = containerHeight / zoom;

    const x = offsetX + (vx0 - worldX0) * scale;
    const y = offsetY + (vy0 - worldY0) * scale;
    const w = vw * scale;
    const h = vh * scale;

    return { x, y, w, h };
  }, [pan.x, pan.y, zoom, containerWidth, containerHeight, offsetX, offsetY, worldX0, worldY0, scale]);

  // Jump canvas center to point clicked on MiniMap
  const handleMapPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.stopPropagation();
    e.preventDefault();

    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clickMx = e.clientX - rect.left;
    const clickMy = e.clientY - rect.top;

    // Check if clicked inside viewport rect (for dragging)
    const isInsideViewport =
      clickMx >= viewportRect.x &&
      clickMx <= viewportRect.x + viewportRect.w &&
      clickMy >= viewportRect.y &&
      clickMy <= viewportRect.y + viewportRect.h;

    isDraggingViewportRef.current = true;
    dragStartPosRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      initialPan: { x: pan.x, y: pan.y },
    };

    if (!isInsideViewport) {
      // Direct jump to clicked location
      const targetCanvasX = worldX0 + (clickMx - offsetX) / scale;
      const targetCanvasY = worldY0 + (clickMy - offsetY) / scale;

      const nextPanX = containerWidth / 2 - targetCanvasX * zoom;
      const nextPanY = containerHeight / 2 - targetCanvasY * zoom;

      onPanChange({ x: nextPanX, y: nextPanY });
      dragStartPosRef.current.initialPan = { x: nextPanX, y: nextPanY };
    }

    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handleMapPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDraggingViewportRef.current) return;
    e.stopPropagation();
    e.preventDefault();

    const dx = e.clientX - dragStartPosRef.current.clientX;
    const dy = e.clientY - dragStartPosRef.current.clientY;

    // Map screen pixel delta to canvas delta
    const deltaCanvasX = dx / scale;
    const deltaCanvasY = dy / scale;

    const nextPanX = dragStartPosRef.current.initialPan.x - deltaCanvasX * zoom;
    const nextPanY = dragStartPosRef.current.initialPan.y - deltaCanvasY * zoom;

    onPanChange({ x: nextPanX, y: nextPanY });
  };

  const handleMapPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isDraggingViewportRef.current) {
      isDraggingViewportRef.current = false;
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch (_) {}
    }
  };

  // Fit view calculation
  const handleFitAllNodes = useCallback(() => {
    if (!nodes || nodes.length === 0 || !onFitView) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    nodes.forEach((n) => {
      const nw = getNodeWidth(n);
      const nh = getNodeEstimatedHeight(n);
      minX = Math.min(minX, n.position.x);
      maxX = Math.max(maxX, n.position.x + nw);
      minY = Math.min(minY, n.position.y);
      maxY = Math.max(maxY, n.position.y + nh);
    });

    const contentW = Math.max(maxX - minX, 300);
    const contentH = Math.max(maxY - minY, 300);
    const screenPadding = 90;

    const fitScaleX = (containerWidth - screenPadding * 2) / contentW;
    const fitScaleY = (containerHeight - screenPadding * 2) / contentH;
    const optimalZoom = Math.min(Math.max(Math.min(fitScaleX, fitScaleY), 0.22), 1.5);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const fitPanX = containerWidth / 2 - centerX * optimalZoom;
    const fitPanY = containerHeight / 2 - centerY * optimalZoom;

    onFitView(optimalZoom, { x: fitPanX, y: fitPanY });
  }, [nodes, containerWidth, containerHeight, onFitView]);

  return (
    <div
      className="canvas-light-skin absolute bottom-6 right-6 z-30 select-none transition-all duration-200 pointer-events-auto"
      data-minimap-container
    >
      {isCollapsed ? (
        // Collapsed Floating Pill
        <button
          type="button"
          onClick={toggleCollapsed}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#18181c]/90 dark:bg-[#18181c]/95 hover:bg-[#222228] dark:hover:bg-[#25252c] border border-white/10 shadow-xl backdrop-blur-md text-xs font-semibold text-stone-200 hover:text-white transition-all active:scale-95 cursor-pointer group"
          title="Buka Peta Navigasi Kanvas (MiniMap)"
        >
          <MapIcon className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition-transform" />
          <span>MiniMap</span>
          <span className="text-[10px] text-stone-400 font-mono bg-white/10 px-1.5 py-0.5 rounded">
            {nodes.length}
          </span>
          <ChevronUp className="w-3 h-3 text-stone-400" />
        </button>
      ) : (
        // Expanded Full MiniMap Box
        <div className="w-[236px] bg-[#141418]/95 dark:bg-[#141418]/95 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
          {/* Header Bar */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/[0.02]">
            <div className="flex items-center gap-2 min-w-0">
              <MapIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-xs font-bold text-stone-200 truncate">MiniMap</span>
              <span className="text-[10px] text-stone-400 font-mono bg-white/10 px-1.5 py-0.5 rounded shrink-0">
                {nodes.length} node
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {onFitView && (
                <button
                  type="button"
                  onClick={handleFitAllNodes}
                  disabled={nodes.length === 0}
                  className="p-1 rounded-md text-stone-400 hover:text-amber-300 hover:bg-white/10 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Pusatkan & Muat Seluruh Node ke Layar (Fit View)"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              )}

              {onResetZoom && (
                <button
                  type="button"
                  onClick={onResetZoom}
                  className="p-1 rounded-md text-stone-400 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
                  title="Reset Zoom ke 100%"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}

              <button
                type="button"
                onClick={toggleCollapsed}
                className="p-1 rounded-md text-stone-400 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
                title="Sembunyikan MiniMap"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* MiniMap Canvas SVG Viewer */}
          <div className="relative p-2 bg-[#0d0d11] flex items-center justify-center">
            <svg
              ref={svgRef}
              width={MINIMAP_WIDTH}
              height={MINIMAP_HEIGHT}
              className="minimap-surface rounded-lg bg-[#0d0d11] border border-white/[0.05] cursor-crosshair overflow-hidden touch-none"
              onPointerDown={handleMapPointerDown}
              onPointerMove={handleMapPointerMove}
              onPointerUp={handleMapPointerUp}
              onPointerCancel={handleMapPointerUp}
            >
              {/* Subtle background grid dots */}
              <pattern id="minimap-grid" width="16" height="16" patternUnits="userSpaceOnUse">
                <circle className="minimap-grid-dot" cx="2" cy="2" r="0.7" fill="#ffffff" fillOpacity="0.08" />
              </pattern>
              <rect width="100%" height="100%" fill="url(#minimap-grid)" />

              {/* Faint Wire / Edge connections */}
              {edges.map((e) => {
                const src = nodes.find((n) => n.id === e.sourceNodeId);
                const tgt = nodes.find((n) => n.id === e.targetNodeId);
                if (!src || !tgt) return null;

                const sx = offsetX + (src.position.x + getNodeWidth(src) - worldX0) * scale;
                const sy = offsetX + (src.position.y + getNodeEstimatedHeight(src) / 2 - worldY0) * scale;
                const tx = offsetX + (tgt.position.x - worldX0) * scale;
                const ty = offsetX + (tgt.position.y + getNodeEstimatedHeight(tgt) / 2 - worldY0) * scale;

                return (
                  <line
                    key={e.id}
                    x1={sx}
                    y1={sy}
                    x2={tx}
                    y2={ty}
                    stroke="#ffffff"
                    strokeOpacity={0.15}
                    strokeWidth={1}
                    strokeDasharray="2,2"
                    className="minimap-edge"
                  />
                );
              })}

              {/* Node Cards on MiniMap */}
              {nodes.map((n) => {
                const nw = getNodeWidth(n);
                const nh = getNodeEstimatedHeight(n);
                const nx = offsetX + (n.position.x - worldX0) * scale;
                const ny = offsetY + (n.position.y - worldY0) * scale;
                const rw = Math.max(nw * scale, 6);
                const rh = Math.max(nh * scale, 5);

                const isSelected = selectedNodeIds.includes(n.id);
                const isRunning = executingNodeIds.includes(n.id) || n.data?.status === 'running';
                const colors = getNodeColor(n);

                return (
                  <g key={n.id}>
                    <rect
                      x={nx}
                      y={ny}
                      width={rw}
                      height={rh}
                      rx={2}
                      ry={2}
                      fill={colors.fill}
                      fillOpacity={isSelected ? 0.9 : 0.65}
                      stroke={isSelected ? '#f59e0b' : colors.stroke}
                      strokeWidth={isSelected ? 1.5 : 0.8}
                      className="transition-all"
                    />
                    {isRunning && (
                      <circle
                        cx={nx + rw - 3}
                        cy={ny + 3}
                        r={2}
                        fill="#38bdf8"
                        className="animate-ping"
                      />
                    )}
                  </g>
                );
              })}

              {/* Viewport Camera Frustum Rectangle */}
              <rect
                x={viewportRect.x}
                y={viewportRect.y}
                width={Math.max(viewportRect.w, 8)}
                height={Math.max(viewportRect.h, 6)}
                rx={3}
                ry={3}
                fill="#f59e0b"
                fillOpacity={0.12}
                stroke="#f59e0b"
                strokeWidth={1.4}
                className="cursor-grab active:cursor-grabbing transition-colors"
              />
            </svg>
          </div>

          {/* Footer Bar: Zoom status & navigation tip */}
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-white/10 bg-white/[0.02] text-[10px] text-stone-400">
            <span className="font-mono text-amber-400/90 font-bold">
              {Math.round(zoom * 100)}% Zoom
            </span>
            <span className="text-stone-500 truncate max-w-[125px]">
              Klik / geser kotak untuk pan
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
