import React from 'react';
import { Board, Position, Move, Player } from '../game/types';

interface Props {
  board: Board;
  selected: Position | null;
  validMoves: Move[];
  playerColor?: Player;
  onPieceClick: (pos: Position) => void;
  onSquareClick: (pos: Position) => void;
}

const BOARD_SIZE = 8;

export default function Board2D({ board, selected, validMoves, playerColor, onPieceClick, onSquareClick }: Props) {
  const validSet = new Set(validMoves.map(m => `${m.to.row},${m.to.col}`));
  const captureSet = new Set(validMoves.filter(m => m.captured).map(m => `${m.to.row},${m.to.col}`));
  const flip = playerColor === 'black';

  const rows = Array.from({ length: BOARD_SIZE }, (_, r) => flip ? BOARD_SIZE - 1 - r : r);
  const cols = Array.from({ length: BOARD_SIZE }, (_, c) => flip ? BOARD_SIZE - 1 - c : c);

  return (
    <div className="b2d-container">
      <div className="b2d-frame">
        {/* Corner bolts */}
        <div className="b2d-bolt tl" /><div className="b2d-bolt tr" />
        <div className="b2d-bolt br" /><div className="b2d-bolt bl" />
        {/* Corner ornaments */}
        {[
          { className: 'b2d-corner tl' },
          { className: 'b2d-corner tr' },
          { className: 'b2d-corner br' },
          { className: 'b2d-corner bl' },
        ].map(c => <div key={c.className} className={c.className} />)}

        <div className="b2d-board">
          {rows.map(r =>
            cols.map(c => {
              const isDark = (r + c) % 2 === 1;
              const piece = board[r][c];
              const isSelected = selected?.row === r && selected?.col === c;
              const isHighlighted = validSet.has(`${r},${c}`);
              const isCapture = captureSet.has(`${r},${c}`);

              return (
                <div
                  key={`sq-${r}-${c}`}
                  className={`b2d-sq ${isDark ? 'dark' : 'light'} ${isHighlighted ? 'hl' : ''} ${isCapture ? 'cap' : ''}`}
                  onClick={() => onSquareClick({ row: r, col: c })}
                >
                  {/* Valid move dot */}
                  {isHighlighted && !piece && !isCapture && (
                    <div className="b2d-move-dot" />
                  )}

                  {/* Selection glow */}
                  {isSelected && !piece && (
                    <div className="b2d-sel-ring" />
                  )}

                  {/* Piece */}
                  {piece && (
                    <div
                      className={`b2d-p ${piece.player} ${piece.type === 'king' ? 'king' : ''} ${isSelected ? 'sel' : ''}`}
                      onClick={(e) => { e.stopPropagation(); onPieceClick({ row: r, col: c }); }}
                    >
                      {/* Recessed rings on top */}
                      <div className="b2d-p-ring outer" />
                      <div className="b2d-p-ring inner" />

                      {/* Selection glow on piece */}
                      {isSelected && <div className="b2d-p-glow" />}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
