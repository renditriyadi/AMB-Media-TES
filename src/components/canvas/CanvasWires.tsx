import React from 'react';
import { CanvasEdge, CanvasNode, getPortCoordinate } from '../../types/canvas';
import { CABLE_PALETTE, PortKind } from '../../lib/canvasCable';

// Warna kabel & konektor mengikuti referensi three.js (lihat lib/canvasCable.ts):
// image = biru, video = merah, text = abu-abu. Kabel solid satu warna (warna port sumber).
export const resolvePortKind = (
  node?: CanvasNode,
  portId?: string,
  isInput: boolean = false
): PortKind => {
  if (!node) return 'image';

  // 1. Petunjuk dari id port
  const pId = (portId || '').toLowerCase();
  if (pId.includes('prompt') || pId.includes('text')) return 'text';
  if (pId.includes('video')) return 'video';
  if (pId.includes('audio') || pId.includes('mask')) return 'text';
  if (pId.includes('image') || pId.includes('file') || pId.includes('result')) return 'image';

  // 2. Definisi port pada node
  const list = isInput ? node.inputs : node.outputs;
  const port = list?.find((p) => p.id === portId);
  if (port) {
    if (port.type === 'text') return 'text';
    if (port.type === 'video') return 'video';
    if (port.type === 'image') return 'image';
  }

  // 3. Fallback berdasarkan tipe node
  if (node.type === 'prompt') return 'text';
  if (node.type === 'geminiVideo' || node.type === 'videoStitcher') return 'video';
  return 'image';
};

export const resolvePortColor = (
  node?: CanvasNode,
  portId?: string,
  isInput: boolean = false
): string => CABLE_PALETTE[resolvePortKind(node, portId, isInput)].cable;

interface CanvasWiresProps {
  edges: CanvasEdge[];
  nodes: CanvasNode[];
  selectedEdgeId: string | null;
  onSelectEdge: (edgeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  connectingWire: {
    sourceNodeId: string;
    sourceOutputId?: string;
    sourcePortId?: string;
    isInput?: boolean;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null;
  isGenerating?: boolean;
  executingNodeId?: string | null;
  executingNodeIds?: string[];
  selectedNodeIds?: string[];
}

export const CanvasWires: React.FC<CanvasWiresProps> = ({
  edges,
  nodes,
  selectedEdgeId,
  onSelectEdge,
  onDeleteEdge,
  connectingWire,
  isGenerating = false,
  executingNodeId = null,
  executingNodeIds = [],
  selectedNodeIds = [],
}) => {
  // Weavy standard bezier curvature calculation with horizontal tangents
  const getBezierPath = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = Math.abs(x2 - x1);
    const curvature = Math.max(dx * 0.45, 48);
    const cp1x = x1 + curvature;
    const cp1y = y1;
    const cp2x = x2 - curvature;
    const cp2y = y2;
    return `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
  };

  return (
    <svg
      className="absolute inset-0 pointer-events-none overflow-visible w-full h-full"
      style={{ zIndex: 5 }}
    >
      {/* Render all existing edges */}
      {edges.map((edge) => {
        const sourceNode = nodes.find((n) => n.id === edge.sourceNodeId);
        const targetNode = nodes.find((n) => n.id === edge.targetNodeId);
        if (!sourceNode || !targetNode) return null;

        const start = getPortCoordinate(
          sourceNode,
          edge.sourceOutputId,
          false,
          sourceNode.data?.aspectRatio
        );
        const end = getPortCoordinate(
          targetNode,
          edge.targetInputId,
          true,
          sourceNode.data?.aspectRatio
        );

        if (!start || !end) return null;

        const pathData = getBezierPath(start.x, start.y, end.x, end.y);
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;

        // Kabel solid satu warna = warna port sumber (seperti referensi three.js)
        const cableColor = resolvePortColor(sourceNode, edge.sourceOutputId, false);
        const isLive =
          isGenerating &&
          ((executingNodeIds && (executingNodeIds.includes(sourceNode.id) || executingNodeIds.includes(targetNode.id))) ||
            sourceNode.id === executingNodeId ||
            targetNode.id === executingNodeId);
        const isSelected = selectedEdgeId === edge.id;
        const isActive =
          isLive || isSelected || selectedNodeIds.includes(sourceNode.id) || selectedNodeIds.includes(targetNode.id);

        return (
          <g
            key={edge.id}
            className="group pointer-events-auto"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Hit-box transparan yang lebih lebar supaya kabel mudah diklik */}
            <path
              d={pathData}
              fill="none"
              stroke="transparent"
              strokeWidth="26"
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onSelectEdge(edge.id);
              }}
            >
              <title>Pilih kabel</title>
            </path>

            {/* Kabel utama: 2.4px (3px saat aktif), redup 55% saat idle, penuh saat aktif */}
            <path
              d={pathData}
              fill="none"
              style={{ stroke: cableColor }}
              strokeWidth={isLive || isSelected ? 3 : 2.4}
              strokeOpacity={isActive ? 1 : 0.55}
              strokeLinecap="round"
              className="transition-[stroke-opacity,stroke-width] duration-150"
              pointerEvents="none"
            />

            {/* Kilau putih berjalan saat node terhubung sedang running */}
            {isLive && (
              <path
                d={pathData}
                pathLength={100}
                fill="none"
                stroke="#ffffff"
                strokeOpacity={0.45}
                strokeWidth={3}
                strokeLinecap="round"
                className="canvas-wire-pulse"
                pointerEvents="none"
              />
            )}

            {/* Tombol putus kabel saat hover */}
            <g
              transform={`translate(${midX - 9}, ${midY - 9})`}
              className="pointer-events-auto cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity duration-150"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteEdge(edge.id);
              }}
            >
              <title>Putus sambungan kabel</title>
              <circle cx="9" cy="9" r="8.5" fill="#18181c" stroke="#f43f5e" strokeWidth="1.2" />
              <text
                x="9"
                y="12"
                textAnchor="middle"
                fill="#f43f5e"
                fontSize="9"
                fontWeight="bold"
                className="select-none pointer-events-none"
              >
                ✕
              </text>
            </g>
          </g>
        );
      })}

      {/* Kabel yang sedang di-drag: solid & satu warna, ujungnya di tengah konektor */}
      {connectingWire && (() => {
        const sourceNode = nodes.find((n) => n.id === connectingWire.sourceNodeId);
        const wireColor = resolvePortColor(
          sourceNode,
          connectingWire.sourcePortId || connectingWire.sourceOutputId,
          connectingWire.isInput || false
        );
        const { startX, startY, currentX: curX, currentY: curY, isInput } = connectingWire;

        // Drag dari port input: kurva dibalik (kursor -> input) supaya tangen tetap horizontal
        const pathData = isInput
          ? getBezierPath(curX, curY, startX, startY)
          : getBezierPath(startX, startY, curX, curY);

        return (
          <path
            d={pathData}
            fill="none"
            style={{ stroke: wireColor }}
            strokeWidth="2"
            strokeOpacity="0.9"
            strokeLinecap="round"
            pointerEvents="none"
          />
        );
      })()}
    </svg>
  );
};
