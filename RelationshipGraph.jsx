import React, { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

/**
 * Simple force-free relationship graph: characters placed on a circle, edges drawn between them.
 * Renders as SVG. No external graph library required.
 */
export function RelationshipGraph({ characters, onClose, onEdit }) {
  const size = 520;
  const cx = size / 2;
  const cy = size / 2;
  const radius = Math.min(size, size) / 2 - 70;

  const nodes = useMemo(() => {
    const n = characters.length || 1;
    return characters.map((c, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      return {
        id: c.id,
        name: c.name,
        role: c.role,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        raw: c,
      };
    });
  }, [characters, cx, cy, radius]);

  const nodeById = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);

  const edges = useMemo(() => {
    const list = [];
    characters.forEach((c) => {
      (c.relationships || []).forEach((r) => {
        if (nodeById[r.target_id]) {
          list.push({ from: c.id, to: r.target_id, kind: r.kind, note: r.note });
        }
      });
    });
    return list;
  }, [characters, nodeById]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-3xl"
        style={{
          background: "var(--sc-bg-sheet)",
          borderColor: "var(--sc-border)",
          color: "var(--sc-text-primary)",
        }}
        data-testid="relationship-graph"
      >
        <DialogHeader>
          <DialogTitle className="font-serif-reader text-2xl">Relationship Web</DialogTitle>
          <DialogDescription style={{ color: "var(--sc-text-secondary)" }}>
            Click a character to edit their bonds. Add relationships from within the character editor.
          </DialogDescription>
        </DialogHeader>

        <div className="w-full flex justify-center">
          <svg
            width="100%"
            viewBox={`0 0 ${size} ${size}`}
            style={{ maxHeight: "60vh" }}
            role="img"
            aria-label="Character relationship graph"
          >
            {/* Edges */}
            {edges.map((e, i) => {
              const a = nodeById[e.from];
              const b = nodeById[e.to];
              if (!a || !b) return null;
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              return (
                <g key={`${e.from}->${e.to}-${e.label || ''}`}>
                  <line
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke="var(--sc-accent-secondary)"
                    strokeWidth={1.5}
                    strokeOpacity={0.7}
                  />
                  <text
                    x={mx}
                    y={my - 4}
                    textAnchor="middle"
                    fontSize="10"
                    fontFamily="'Plus Jakarta Sans', sans-serif"
                    fill="var(--sc-text-secondary)"
                    data-testid={`edge-label-${i}`}
                  >
                    {e.kind}
                  </text>
                </g>
              );
            })}

            {/* Nodes */}
            {nodes.map((n) => (
              <g
                key={n.id}
                transform={`translate(${n.x}, ${n.y})`}
                style={{ cursor: "pointer" }}
                onClick={() => onEdit && onEdit(n.raw)}
                data-testid={`graph-node-${n.id}`}
              >
                <circle
                  r={28}
                  fill="var(--sc-bg-app)"
                  stroke="var(--sc-accent-primary)"
                  strokeWidth={2}
                />
                <text
                  y={4}
                  textAnchor="middle"
                  fontSize="12"
                  fontFamily="'Lora', serif"
                  fill="var(--sc-text-primary)"
                  fontWeight={600}
                >
                  {n.name.length > 10 ? n.name.slice(0, 9) + "…" : n.name}
                </text>
                <text
                  y={44}
                  textAnchor="middle"
                  fontSize="10"
                  fontFamily="'Plus Jakarta Sans', sans-serif"
                  fill="var(--sc-text-secondary)"
                >
                  {(n.role || "").slice(0, 18)}
                </text>
              </g>
            ))}
          </svg>
        </div>

        {edges.length === 0 && (
          <p className="text-xs italic text-center mt-2" style={{ color: "var(--sc-text-secondary)" }}>
            No bonds yet — open a character and add relationships to see the web fill in.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
