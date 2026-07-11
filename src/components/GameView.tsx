import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Player, Position, Move, Board } from '../game/types';
import {
  createInitialBoard, cloneBoard, getMovesForPiece,
  makeMove, checkGameOver, getStats as getPieceStats,
} from '../game/GameEngine';
import { loadGame, saveGame, clearGame, loadSettings, saveSettings, GameMode, BoardTheme, BoardCss } from '../game/storage';
import { getCpuMove } from '../game/ai';
import Board2D from './Board2D';

interface Props {
  config: { mode: GameMode; playerColor: Player } | null;
  boardTheme: BoardTheme;
  boardCss: BoardCss;
  onBackToMenu: () => void;
  onGameEnd: (winner: Player | null, moveCount: number) => void;
}

function initFromSaved(config: Props['config']): {
  board: Board; currentPlayer: Player; moveHistory: Move[];
  jumpChain: Position | null; gameOver: boolean; winner: Player | null; message: string;
} {
  const saved = loadGame();
  if (saved) {
    return {
      board: saved.board,
      currentPlayer: saved.currentPlayer,
      moveHistory: saved.moveHistory,
      jumpChain: saved.jumpChain,
      gameOver: saved.gameOver,
      winner: saved.winner,
      message: saved.message,
    };
  }
  const b = createInitialBoard();
  return {
    board: b,
    currentPlayer: 'red',
    moveHistory: [],
    jumpChain: null,
    gameOver: false,
    winner: null,
    message: "Red's turn \u2014 Select a piece",
  };
}

export default function GameView({ config, boardTheme, boardCss, onBackToMenu, onGameEnd }: Props) {
  const initial = useRef(initFromSaved(config));
  const [board, setBoard] = useState<Board>(initial.current.board);
  const [currentPlayer, setCurrentPlayer] = useState<Player>(initial.current.currentPlayer);
  const [selected, setSelected] = useState<Position | null>(null);
  const [validMoves, setValidMoves] = useState<Move[]>([]);
  const [gameOver, setGameOver] = useState(initial.current.gameOver);
  const [winner, setWinner] = useState<Player | null>(initial.current.winner);
  const [jumpChain, setJumpChain] = useState<Position | null>(initial.current.jumpChain);
  const [moveHistory, setMoveHistory] = useState<Move[]>(initial.current.moveHistory);
  const [message, setMessage] = useState(initial.current.message);
  const [pieceStats, setPieceStats] = useState(getPieceStats(initial.current.board));
  const [paused, setPaused] = useState(false);
  const [isCpuThinking, setIsCpuThinking] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const mode: GameMode = config?.mode ?? 'pvp';
  const playerColor: Player = config?.playerColor ?? 'red';
  const cpuPlayer: Player = playerColor === 'red' ? 'black' : 'red';
  const difficulty = loadSettings().cpuDifficulty;

  const capturedRed = 12 - pieceStats.redPieces;
  const capturedBlack = 12 - pieceStats.blackPieces;

  const persist = useCallback((b: Board, player: Player, history: Move[], chain: Position | null, over: boolean, win: Player | null, msg: string) => {
    saveGame({
      board: b, currentPlayer: player, moveHistory: history, jumpChain: chain,
      gameOver: over, winner: win, message: msg, mode, playerColor, timestamp: Date.now(),
    });
  }, [mode, playerColor]);

  const stateRef = useRef({ board, currentPlayer, moveHistory, jumpChain, gameOver, winner, message, paused, isCpuThinking });
  stateRef.current = { board, currentPlayer, moveHistory, jumpChain, gameOver, winner, message, paused, isCpuThinking };
  const cpuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = () => {
      const s = stateRef.current;
      saveGame({
        board: s.board, currentPlayer: s.currentPlayer, moveHistory: s.moveHistory,
        jumpChain: s.jumpChain, gameOver: s.gameOver, winner: s.winner,
        message: s.message, mode, playerColor, timestamp: Date.now(),
      });
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [mode, playerColor]);

  const doNewGame = useCallback(() => {
    clearGame();
    const b = createInitialBoard();
    setBoard(b);
    setCurrentPlayer('red');
    setSelected(null);
    setValidMoves([]);
    setGameOver(false);
    setWinner(null);
    setJumpChain(null);
    setMoveHistory([]);
    setMessage("Red's turn \u2014 Select a piece");
    setPieceStats(getPieceStats(b));
    setPaused(false);
    setIsCpuThinking(false);
  }, []);

  const goToMenu = useCallback(() => {
    const s = stateRef.current;
    saveGame({
      board: s.board, currentPlayer: s.currentPlayer, moveHistory: s.moveHistory,
      jumpChain: s.jumpChain, gameOver: s.gameOver, winner: s.winner,
      message: s.message, mode, playerColor, timestamp: Date.now(),
    });
    onBackToMenu();
  }, [onBackToMenu, mode, playerColor]);

  const switchTurn = useCallback((b: Board, prevPlayer: Player, history: Move[]) => {
    const nextPlayer: Player = prevPlayer === 'red' ? 'black' : 'red';
    const result = checkGameOver(b, nextPlayer);

    setBoard(b);
    setSelected(null);
    setValidMoves([]);
    setJumpChain(null);
    setMoveHistory(history);
    setPieceStats(getPieceStats(b));

    if (result.over) {
      setGameOver(true);
      setWinner(result.winner);
      setMessage(`Game Over! ${result.winner === 'red' ? 'Red' : 'Black'} wins!`);
      clearGame();
      onGameEnd(result.winner, history.length);
    } else {
      const msg = `${nextPlayer === 'red' ? 'Red' : 'Black'}'s turn \u2014 Select a piece`;
      setCurrentPlayer(nextPlayer);
      setMessage(msg);
      persist(b, nextPlayer, history, null, false, null, msg);
    }
  }, [onGameEnd, persist]);

  const handleUndo = useCallback(() => {
    if (moveHistory.length === 0 || gameOver || isCpuThinking) return;
    const stepsToUndo = mode === 'pvc' && moveHistory.length >= 2 ? 2 : 1;
    const newHistory = moveHistory.slice(0, -stepsToUndo);
    let b = createInitialBoard();
    let current: Player = 'red';
    for (const m of newHistory) {
      makeMove(b, m);
      current = current === 'red' ? 'black' : 'red';
    }
    setBoard(b);
    setCurrentPlayer(current);
    setSelected(null);
    setValidMoves([]);
    setMoveHistory(newHistory);
    setPieceStats(getPieceStats(b));
    setJumpChain(null);
    const msg = `${current === 'red' ? 'Red' : 'Black'}'s turn \u2014 Select a piece`;
    setMessage(msg);
    persist(b, current, newHistory, null, false, null, msg);
  }, [moveHistory, gameOver, isCpuThinking, mode, persist]);

  const handlePieceClick = useCallback((pos: Position) => {
    if (gameOver || paused || isCpuThinking) return;
    if (jumpChain && (pos.row !== jumpChain.row || pos.col !== jumpChain.col)) return;

    const piece = board[pos.row][pos.col];
    if (!piece || piece.player !== currentPlayer) return;

    const moves = getMovesForPiece(board, pos);
    if (moves.length === 0) return;

    setSelected(pos);
    setValidMoves(moves);
    setMessage(`${currentPlayer === 'red' ? 'Red' : 'Black'}'s turn \u2014 Make a move`);
  }, [board, currentPlayer, gameOver, jumpChain, paused, isCpuThinking]);

  const handleSquareClick = useCallback((pos: Position) => {
    if (gameOver || !selected || paused || isCpuThinking) return;

    const move = validMoves.find(m => m.to.row === pos.row && m.to.col === pos.col);
    if (!move) {
      const clickedPiece = board[pos.row][pos.col];
      if (clickedPiece && clickedPiece.player === currentPlayer) {
        const moves = getMovesForPiece(board, pos);
        if (moves.length > 0) {
          setSelected(pos);
          setValidMoves(moves);
          setMessage(`${currentPlayer === 'red' ? 'Red' : 'Black'}'s turn \u2014 Make a move`);
          return;
        }
      }
      setSelected(null);
      setValidMoves([]);
      setMessage(`${currentPlayer === 'red' ? 'Red' : 'Black'}'s turn \u2014 Select a piece`);
      return;
    }

    const newBoard = cloneBoard(board);
    const promoted = makeMove(newBoard, move);
    const newHistory = [...moveHistory, move];

    if (move.captured && !promoted) {
      const chainMoves = getMovesForPiece(newBoard, move.to);
      const chainCaptures = chainMoves.filter(m => m.captured);
      if (chainCaptures.length > 0) {
        setBoard(newBoard);
        setSelected(move.to);
        setValidMoves(chainCaptures);
        setJumpChain(move.to);
        setMoveHistory(newHistory);
        setPieceStats(getPieceStats(newBoard));
        const msg = `${currentPlayer === 'red' ? 'Red' : 'Black'} \u2014 Continue jumping!`;
        setMessage(msg);
        persist(newBoard, currentPlayer, newHistory, move.to, false, null, msg);
        return;
      }
    }

    switchTurn(newBoard, currentPlayer, newHistory);
  }, [gameOver, selected, validMoves, board, currentPlayer, moveHistory, switchTurn, persist, paused, isCpuThinking]);

  // CPU turn
  useEffect(() => {
    if (gameOver || paused || mode !== 'pvc') return;
    if (currentPlayer !== cpuPlayer || isCpuThinking) return;

    setIsCpuThinking(true);

    try {
      const move = getCpuMove(board, cpuPlayer, difficulty);

      setSelected(move.from);
      setValidMoves([move]);
      setMessage(`CPU: ${move.from.row},${move.from.col} \u2192 ${move.to.row},${move.to.col}`);

      cpuTimerRef.current = setTimeout(() => {
        let b = cloneBoard(board);
        let h = [...moveHistory];
        let cur: Move | null = move;

        while (cur) {
          makeMove(b, cur);
          h.push(cur);
          if (cur.captured) {
            const chain: Move[] = getMovesForPiece(b, cur.to).filter(m => m.captured);
            cur = chain.length > 0 ? chain[0] : null;
          } else {
            cur = null;
          }
        }

        switchTurn(b, cpuPlayer, h);
        setIsCpuThinking(false);
      }, 300);
    } catch {
      setIsCpuThinking(false);
    }
  }, [currentPlayer, gameOver, paused, mode, cpuPlayer, board, moveHistory, difficulty, switchTurn]);

  useEffect(() => {
    return () => {
      if (cpuTimerRef.current) { clearTimeout(cpuTimerRef.current); cpuTimerRef.current = null; }
    };
  }, []);

  const themeList: { key: BoardTheme; label: string; color: string }[] = [
    { key: 'default', label: 'Classic', color: '#D8BC8D' },
    { key: 'theme1', label: 'Royal', color: '#5B7DB1' },
    { key: 'theme2', label: 'Emerald', color: '#5B8C5A' },
  ];

  const cssList: { key: BoardCss; label: string }[] = [
    { key: 'skeuomorphism', label: 'Classic' },
    { key: 'neumorphism', label: 'Soft' },
    { key: 'glassmorphism', label: 'Glass' },
  ];

  const handleThemeChange = (t: BoardTheme) => {
    const s = loadSettings();
    saveSettings({ ...s, boardTheme: t });
  };

  const handleCssChange = (c: BoardCss) => {
    const s = loadSettings();
    saveSettings({ ...s, boardCss: c });
  };

  return (
    <div className="game-root">
      <div className="game-noise" />

      {/* Header */}
      <header className="game-header">
        <span className="game-header-line">━━━━</span>
        <span className="game-header-diamond">◇</span>
        <h1 className="game-header-title">CHEKAZ</h1>
        <span className="game-header-diamond">◇</span>
        <span className="game-header-line">━━━━</span>
      </header>

      {/* Main Body */}
      <div className="game-body">

        {/* ─── Left Panel: Game Info ─── */}
        <div className="game-panel game-left-panel">
          <div className="game-panel-header">
            <span className="game-panel-icon">◈</span>
            Game Info
          </div>

          {/* Players */}
          <div className="game-player-section">
            <div className={`game-player-row ${currentPlayer === 'red' && !gameOver ? 'active' : ''}`}>
              <div className="game-player-indicator" />
              <div className="game-player-info">
                <span className="game-player-label">
                  {mode === 'pvc' && playerColor === 'red' ? 'You (Red)' : mode === 'pvc' ? 'CPU (Red)' : 'Red'}
                </span>
                <span className="game-player-timer">In-game</span>
              </div>
              <span className="game-player-status">{currentPlayer === 'red' && !gameOver ? '\u25C9' : '\u25CB'}</span>
            </div>
            <div className={`game-player-row ${currentPlayer === 'black' && !gameOver ? 'active' : ''}`}>
              <div className="game-player-indicator black" />
              <div className="game-player-info">
                <span className="game-player-label">
                  {mode === 'pvc' && playerColor === 'black' ? 'You (Black)' : mode === 'pvc' ? 'CPU (Black)' : 'Black'}
                </span>
                <span className="game-player-timer">In-game</span>
              </div>
              <span className="game-player-status">{currentPlayer === 'black' && !gameOver ? '\u25C9' : '\u25CB'}</span>
            </div>
          </div>

          {/* Captured Pieces */}
          <div className="game-section">
            <span className="game-section-title">Captured</span>
            <div className="game-captured">
              <div className="game-captured-row">
                <span className="game-captured-icon red">●</span>
                <span className="game-captured-label">Red</span>
                <span className="game-captured-count">{capturedRed}</span>
              </div>
              <div className="game-captured-row">
                <span className="game-captured-icon black">●</span>
                <span className="game-captured-label">Black</span>
                <span className="game-captured-count">{capturedBlack}</span>
              </div>
            </div>
          </div>

          {/* Move History */}
          <div className="game-section game-move-section">
            <span className="game-section-title">Moves ({moveHistory.length})</span>
            <div className="game-move-list">
              {moveHistory.length === 0 ? (
                <div className="game-move-empty">No moves yet</div>
              ) : (
                moveHistory.map((m, i) => (
                  <div key={i} className="game-move-row">
                    <span className="game-move-num">{i + 1}.</span>
                    <span className={`game-move-player ${m.player}`}>
                      {m.player === 'red' ? '\u25CF' : '\u25CB'}
                    </span>
                    <span className="game-move-text">
                      ({m.from.row},{m.from.col}) \u2192 ({m.to.row},{m.to.col})
                      {m.captured ? ' \u2716' : ''}
                      {m.promoted ? ' \u2654' : ''}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ─── Board ─── */}
        <div className="game-board-area">
          <div className="b2d-wrapper" data-theme={boardTheme} data-css={boardCss}>
            <Board2D
              board={board}
              selected={selected}
              validMoves={validMoves}
              playerColor={playerColor}
              onPieceClick={handlePieceClick}
              onSquareClick={handleSquareClick}
            />
          </div>

          {/* Game Over Modal */}
          {gameOver && (
            <div className="game-modal-overlay">
              <div className="game-modal">
                <div className="game-modal-divider" style={{ marginBottom: 6, fontSize: 11, color: 'rgba(200,162,70,0.4)' }}>
                  {'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \u25C7 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'}
                </div>
                <h2>Game Over</h2>
                <p className="game-modal-winner">{winner === 'red' ? 'Red' : 'Black'} wins!</p>
                <p className="game-modal-sub">{moveHistory.length} moves played</p>
                <div className="game-modal-actions">
                  <button className="game-modal-btn primary" onClick={doNewGame}>Play Again</button>
                  <button className="game-modal-btn secondary" onClick={goToMenu}>Back to Menu</button>
                </div>
              </div>
            </div>
          )}

          {/* Pause Modal */}
          {paused && (
            <div className="game-modal-overlay">
              <div className="game-modal">
                <div className="game-modal-divider" style={{ marginBottom: 6, fontSize: 11, color: 'rgba(200,162,70,0.4)' }}>
                  {'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \u25C7 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'}
                </div>
                <h2>Paused</h2>
                <p className="game-modal-sub">{mode === 'pvc' ? 'vs CPU' : 'Pass & Play'}</p>
                <div className="game-modal-actions">
                  <button className="game-modal-btn primary" onClick={() => setPaused(false)}>Resume</button>
                  <button className="game-modal-btn secondary" onClick={goToMenu}>Quit to Menu</button>
                </div>
              </div>
            </div>
          )}

          {/* Rules Modal */}
          {showRules && (
            <div className="game-modal-overlay">
              <div className="game-modal" style={{ maxWidth: 440 }}>
                <div className="game-modal-divider" style={{ marginBottom: 6, fontSize: 11, color: 'rgba(200,162,70,0.4)' }}>
                  {'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \u25C7 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'}
                </div>
                <h2 style={{ fontSize: 22 }}>Rules</h2>
                <div className="game-rules-content">
                  <p>Standard American checkers / English draughts (8×8).</p>
                  <ul>
                    <li>Each player starts with 12 pieces on dark squares.</li>
                    <li>Red moves first. Pieces move one square diagonally forward.</li>
                    <li><strong>Captures are mandatory.</strong> If you can jump, you must.</li>
                    <li>Multiple jumps (chains) are required in a single turn.</li>
                    <li>A piece reaching the opposite back row becomes a <strong>King</strong>.</li>
                    <li>Kings can move and jump in any diagonal direction.</li>
                    <li>Win by capturing all opponent pieces or blocking them.</li>
                  </ul>
                </div>
                <div className="game-modal-actions">
                  <button className="game-modal-btn primary" onClick={() => setShowRules(false)}>Got it</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ─── Right Panel: Controls ─── */}
        <div className="game-panel game-right-panel">
          <div className="game-panel-header">
            <span className="game-panel-icon">✦</span>
            Controls
          </div>

          <div className="game-actions">
            <button className="game-action-btn" onClick={doNewGame}>
              <span className="game-action-icon">↺</span>
              <span className="game-action-label">New Game</span>
            </button>
            <button className="game-action-btn" onClick={handleUndo} disabled={moveHistory.length === 0 || gameOver || isCpuThinking}>
              <span className="game-action-icon">↩</span>
              <span className="game-action-label">Undo</span>
            </button>
            <button className="game-action-btn" onClick={() => setPaused(v => !v)} disabled={gameOver}>
              <span className="game-action-icon">{paused ? '▶' : '⏸'}</span>
              <span className="game-action-label">{paused ? 'Resume' : 'Pause'}</span>
            </button>
            <button className="game-action-btn" onClick={() => setShowRules(true)}>
              <span className="game-action-icon">◈</span>
              <span className="game-action-label">Rules</span>
            </button>
            <button className="game-action-btn" onClick={goToMenu}>
              <span className="game-action-icon">✕</span>
              <span className="game-action-label">Exit</span>
            </button>
          </div>

          {/* Theme Selector */}
          <div className="game-theme-section">
            <span className="game-section-title">Background</span>
            <div className="game-theme-grid">
              {themeList.map(t => (
                <div key={t.key} className={`game-theme-opt ${boardTheme === t.key ? 'on' : ''}`} onClick={() => handleThemeChange(t.key)}>
                  <div className="game-theme-thumb" style={{ background: t.color }} />
                  <span className="game-theme-label">{t.label}</span>
                  {boardTheme === t.key && <span className="game-theme-check">✦</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="game-theme-section" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
            <span className="game-section-title">Board Style</span>
            <div className="game-theme-grid">
              {cssList.map(c => (
                <div key={c.key} className={`game-theme-opt ${boardCss === c.key ? 'on' : ''}`} onClick={() => handleCssChange(c.key)}>
                  <div className="game-theme-thumb" style={{
                    background: boardCss === c.key
                      ? 'linear-gradient(135deg, #C8A246, #8a7030)'
                      : 'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))',
                    borderRadius: 3,
                  }} />
                  <span className="game-theme-label">{c.label}</span>
                  {boardCss === c.key && <span className="game-theme-check">✦</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Bottom Status Bar ─── */}
      <div className="game-status-bar">
        <div className="game-status-left">
          <span className="game-status-pieces">
            <span className="game-status-red">● {pieceStats.redPieces + pieceStats.redKings}</span>
            <span className="game-status-divider">|</span>
            <span className="game-status-black">● {pieceStats.blackPieces + pieceStats.blackKings}</span>
          </span>
        </div>
        <div className="game-status-center">
          <span className="game-status-turn">
            {gameOver
              ? `Game Over \u2014 ${winner === 'red' ? 'Red' : 'Black'} wins!`
              : isCpuThinking ? 'CPU thinking\u2026' : message}
          </span>
        </div>
        <div className="game-status-right">
          <button className="game-status-btn" title="Fullscreen" onClick={() => {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen();
            else document.exitFullscreen();
          }}>⛶</button>
        </div>
      </div>
    </div>
  );
}
