"use client";
import { useState } from "react";
import type { CSSProperties } from "react";
import type { Cell, GameState } from "@/lib/game";

export function Board({ state, seat = 0, onDrop, disabled = false, mini = false }: { state: GameState; seat?: Cell; onDrop?: (column: number) => void; disabled?: boolean; mini?: boolean }) {
  const [preview, setPreview] = useState<number | null>(null);
  const playable = !!onDrop && !disabled && state.status === "playing" && state.next === seat;
  return <div className={`board-wrap ${mini ? "mini" : ""}`}>
    {onDrop && <div className="column-controls" aria-label="Choose a column">
      {Array.from({ length: 7 }, (_, column) => <button key={column} type="button" disabled={!playable || state.board[5][column] !== 0}
        aria-label={`Drop in column ${column + 1}`} onMouseEnter={() => setPreview(column)} onMouseLeave={() => setPreview(null)} onFocus={() => setPreview(column)} onBlur={() => setPreview(null)} onPointerDown={() => setPreview(column)} onClick={() => onDrop(column)}>
        <span className={`preview-token seat-${seat} ${preview === column && playable ? "visible" : ""}`} aria-hidden="true">↓</span>
        <span className="column-number" aria-hidden="true">{column + 1}</span>
      </button>)}
    </div>}
    <div className="board" role="img" aria-label={`Connect Four board, ${state.moves} moves, ${state.status}. Rows shown top to bottom.`}>
      {[5, 4, 3, 2, 1, 0].map((row) => state.board[row].map((cell, column) => {
        const win = state.winningCells.some(([r, c]) => r === row && c === column);
        const last = cell !== 0 && state.lastMove?.row === row && state.lastMove.column === column;
        return <div className={`socket ${preview === column && playable ? "preview-column" : ""}`} key={`${row}-${column}`}>
          {cell !== 0 && <span key={`${row}-${column}-${cell}`} className={`token seat-${cell} ${win ? "winning" : ""} ${last && !mini ? "last-drop" : ""}`} style={{ "--drop-distance": `${-(6 - row) * 115}%` } as CSSProperties}>
            <span className="token-mark" aria-hidden="true">{cell === 1 ? "·" : "="}</span>
          </span>}
        </div>;
      }))}
    </div>
    {!mini && <div className="board-feet" aria-hidden="true"><span /><span /></div>}
    <span className="sr-only">{[5, 4, 3, 2, 1, 0].map((row) => `Row ${row + 1}: ${state.board[row].join(", ")}. `).join("")}</span>
  </div>;
}
