import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Player, Position, Move, Board } from '../game/types';
import {
  createInitialBoard, cloneBoard, getMovesForPiece,
  makeMove, checkGameOver, getStats as getPieceStats,
} from '../game/GameEngine';
import { supabase } from '../supabase/client';
import { BoardTheme, BoardCss, loadSettings, saveSettings } from '../game/storage';
import Board2D from './Board2D';

interface Props {
  gameId: string;
  playerColor: Player;
  opponentUsername: string;
  boardTheme: BoardTheme;
  boardCss: BoardCss;
  onBackToMenu: () => void;
}

const PRESENCE_TIMEOUT_MS = 35000;
const FORFEIT_COUNTDOWN_SEC = 60;

interface OpponentProfile {
  id: string;
  username: string;
}

export default function OnlineGameView({ gameId, playerColor, opponentUsername, boardTheme, boardCss, onBackToMenu }: Props) {
  const [board, setBoard] = useState<Board>(createInitialBoard);
  const [currentPlayer, setCurrentPlayer] = useState<Player>('red');
  const [selected, setSelected] = useState<Position | null>(null);
  const [validMoves, setValidMoves] = useState<Move[]>([]);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState<Player | null>(null);
  const [jumpChain, setJumpChain] = useState<Position | null>(null);
  const [moveHistory, setMoveHistory] = useState<Move[]>([]);
  const [message, setMessage] = useState('Loading game\u2026');
  const [pieceStats, setPieceStats] = useState(getPieceStats(createInitialBoard()));
  const [gameInfo, setGameInfo] = useState<{ red_player_id: string; black_player_id: string; lobby_id?: string | null } | null>(null);
  const [loadingMoves, setLoadingMoves] = useState(true);
  const [showRules, setShowRules] = useState(false);
  const [showForfeitConfirm, setShowForfeitConfirm] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [opponentOnline, setOpponentOnline] = useState(true);
  const [forfeitCountdown, setForfeitCountdown] = useState<number | null>(null);
  const [forfeitReason, setForfeitReason] = useState<string | null>(null);
  const [selfDisconnected, setSelfDisconnected] = useState(false);
  const [opponentProfile, setOpponentProfile] = useState<OpponentProfile | null>(null);

  const loadingMovesRef = useRef(true);
  const stateRef = useRef({ board, currentPlayer, gameOver, winner, moveHistory, gameId, playerColor, gameInfo });
  stateRef.current = { board, currentPlayer, gameOver, winner, moveHistory, gameId, playerColor, gameInfo };
  const isMyTurn = currentPlayer === playerColor;

  const capturedRed = 12 - pieceStats.redPieces;
  const capturedBlack = 12 - pieceStats.blackPieces;

  const opponentIdRef = useRef<string | null>(null);
  const forfeitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presenceCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ownUserIdRef = useRef<string | null>(null);

  // ─── Fetch opponent profile + game info on mount ───
  useEffect(() => {
    (async () => {
      const { data: g } = await supabase.from('games').select('red_player_id, black_player_id, lobby_id, status, winner_id').eq('id', gameId).single();
      if (!g) return;
      setGameInfo({ red_player_id: g.red_player_id, black_player_id: g.black_player_id, lobby_id: g.lobby_id });
      const oppId = playerColor === 'red' ? g.black_player_id : g.red_player_id;
      opponentIdRef.current = oppId;
      const { data: { user } } = await supabase.auth.getUser();
      if (user) ownUserIdRef.current = user.id;
      const { data: oppProf } = await supabase.from('profiles').select('id, username').eq('id', oppId).single();
      if (oppProf) setOpponentProfile({ id: oppProf.id, username: oppProf.username });

      // If game is already finished (e.g., opponent forfeited while we were away)
      if (g.status === 'finished' && g.winner_id) {
        const w = g.winner_id === g.red_player_id ? 'red' as Player : 'black' as Player;
        setGameOver(true);
        setShowGameOver(true);
        setWinner(w);
        setForfeitReason('Opponent forfeited');
        setMessage(`Game Over! ${w === playerColor ? 'You win!' : `${opponentUsername} wins!`}`);
        loadingMovesRef.current = false;
        setLoadingMoves(false);
      }
    })();
  }, [gameId, playerColor, opponentUsername]);

  // ─── Load existing moves on mount ───
  useEffect(() => {
    (async () => {
      const { data: moves } = await supabase
        .from('moves')
        .select('move_data, move_number, player_id')
        .eq('game_id', gameId)
        .order('move_number', { ascending: true });

      if (!moves || moves.length === 0) {
        loadingMovesRef.current = false;
        setLoadingMoves(false);
        setMessage(playerColor === 'red' ? 'Your turn' : `Waiting for ${opponentUsername}\u2026`);
        return;
      }

      let b = createInitialBoard();
      const history: Move[] = [];
      let current: Player = 'red';

      for (const m of moves) {
        const move = m.move_data as Move;
        makeMove(b, move);
        history.push(move);
        current = current === 'red' ? 'black' : 'red';
      }

      setBoard(b);
      setMoveHistory(history);
      setCurrentPlayer(current);
      setPieceStats(getPieceStats(b));
      loadingMovesRef.current = false;
      setLoadingMoves(false);

      const result = checkGameOver(b, current);
      if (result.over) {
        setGameOver(true);
        setWinner(result.winner);
        setShowGameOver(true);
        setMessage(`Game Over! ${result.winner === 'red' ? 'Red' : 'Black'} wins!`);
      } else {
        setMessage(current === playerColor ? 'Your turn' : `${opponentUsername}'s turn`);
      }
    })();
  }, [gameId, playerColor, opponentUsername]);

  // ─── Stats update helper ───
  const updateProfileStats = useCallback(async (winnerId: string | null) => {
    if (!gameInfo) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (winnerId) {
      await supabase.rpc('increment_profile_stats', { player_id: winnerId, inc_games: 1, inc_wins: 1, inc_xp: 100 });
    }
    const loserId = winnerId === gameInfo.red_player_id ? gameInfo.black_player_id : gameInfo.red_player_id;
    await supabase.rpc('increment_profile_stats', { player_id: loserId, inc_games: 1, inc_wins: 0, inc_xp: 0 });
    if (gameInfo.lobby_id && winnerId) {
      await supabase.rpc('update_lobby_streaks', { p_lobby_id: gameInfo.lobby_id, p_winner_id: winnerId, p_loser_id: loserId });
    }
  }, [gameInfo]);

  // ─── Forfeit logic ───
  const executeForfeit = useCallback(async (reason: string, winnerPlayer: Player | null) => {
    if (gameOver) return;
    const uid = ownUserIdRef.current;
    if (!uid || !gameInfo) return;
    const oppId = opponentIdRef.current;
    if (!oppId) return;

    const actualWinner = winnerPlayer || (playerColor === 'red' ? 'black' as Player : 'red' as Player);
    const winnerUserId = actualWinner === playerColor ? uid : oppId;

    setGameOver(true);
    setWinner(actualWinner);
    setShowGameOver(true);
    setForfeitReason(reason);
    setMessage(`Game Over! ${actualWinner === 'red' ? 'Red' : 'Black'} wins!`);

    await supabase.from('games').update({
      status: 'finished',
      winner_id: winnerUserId,
    }).eq('id', gameId);
    await updateProfileStats(winnerUserId);
  }, [gameOver, gameInfo, gameId, playerColor, updateProfileStats]);

  const handleForfeitConfirm = useCallback(async () => {
    setShowForfeitConfirm(false);
    await executeForfeit('Forfeit', playerColor === 'red' ? 'black' as Player : 'red' as Player);
  }, [executeForfeit, playerColor]);

  // ─── Game presence heartbeat (own) ───
  const gamePresenceRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const upsertPresence = async () => {
        await supabase.from('game_presence').upsert(
          { player_id: user.id, game_id: gameId, last_seen: new Date().toISOString() },
          { onConflict: 'player_id' }
        );
      };
      await upsertPresence();
      gamePresenceRef.current = setInterval(upsertPresence, 10000);
    })();
    return () => {
      if (gamePresenceRef.current) { clearInterval(gamePresenceRef.current); gamePresenceRef.current = null; }
      cancelled = true;
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) supabase.from('game_presence').delete().eq('player_id', user.id).then(() => {});
      });
    };
  }, [gameId]);

  // ─── Subscribe to opponent presence + disconnect detection ───
  useEffect(() => {
    const oppId = opponentIdRef.current;
    if (!oppId) return;

    let opponentLastSeen = Date.now();
    let forfeitCountdownValue = FORFEIT_COUNTDOWN_SEC;
    let countdownInterval: ReturnType<typeof setInterval> | null = null;
    let disconnectTriggered = false;

    const clearCountdown = () => {
      if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
      setForfeitCountdown(null);
      forfeitCountdownValue = FORFEIT_COUNTDOWN_SEC;
    };

    // Subscribe to opponent's presence updates
    const presenceSub = supabase
      .channel(`presence-opp-${oppId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'game_presence', filter: `player_id=eq.${oppId}` },
        (payload) => {
          const row = payload.new as { last_seen: string } | null;
          if (row?.last_seen) {
            opponentLastSeen = new Date(row.last_seen).getTime();
            if (disconnectTriggered) {
              // Opponent reconnected
              disconnectTriggered = false;
              setOpponentOnline(true);
              clearCountdown();
              setMessage(prev => prev === 'Opponent disconnected\u2026' || prev.startsWith('You win!')
                ? (isMyTurn ? 'Your turn' : `${opponentUsername}'s turn`)
                : prev);
            }
          }
        }
      )
      .subscribe();

    // Periodic check for disconnect
    const checkInterval = setInterval(async () => {
      if (gameOver) return;
      const elapsed = Date.now() - opponentLastSeen;
      if (!disconnectTriggered && elapsed > PRESENCE_TIMEOUT_MS) {
        disconnectTriggered = true;
        setOpponentOnline(false);
        setMessage('Opponent disconnected\u2026');

        // Start forfeit countdown
        forfeitCountdownValue = FORFEIT_COUNTDOWN_SEC;
        setForfeitCountdown(forfeitCountdownValue);
        countdownInterval = setInterval(() => {
          forfeitCountdownValue--;
          setForfeitCountdown(forfeitCountdownValue);
          if (forfeitCountdownValue <= 0) {
            clearCountdown();
            // Forfeit opponent
            executeForfeit('Opponent did not reconnect', playerColor);
          }
        }, 1000);
      } else if (disconnectTriggered) {
        // Check if opponent came back (presence sub should catch it, but verify)
        try {
          const { data } = await supabase
            .from('game_presence')
            .select('last_seen')
            .eq('player_id', oppId)
            .single();
          if (data?.last_seen) {
            const ts = new Date(data.last_seen).getTime();
            if (ts > opponentLastSeen) {
              opponentLastSeen = ts;
              disconnectTriggered = false;
              setOpponentOnline(true);
              clearCountdown();
              setMessage(isMyTurn ? 'Your turn' : `${opponentUsername}'s turn`);
            }
          }
        } catch { /* ignore */ }
      }
    }, 10000);

    presenceCheckRef.current = checkInterval;

    return () => {
      supabase.removeChannel(presenceSub);
      clearInterval(checkInterval);
      clearCountdown();
    };
  }, [gameId, opponentUsername, playerColor, gameOver, executeForfeit, isMyTurn]);

  // ─── Self-connection monitoring ───
  useEffect(() => {
    const handleOnline = () => { setSelfDisconnected(false); };
    const handleOffline = () => { setSelfDisconnected(true); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ─── Subscribe to game status changes (opponent forfeit / disconnect win) ───
  useEffect(() => {
    const sub = supabase
      .channel(`game-status-${gameId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        async (payload) => {
          const row = payload.new as { status: string; winner_id: string | null };
          if (row.status !== 'finished' || gameOver) return;
          if (!row.winner_id) return;
          const uid = ownUserIdRef.current;
          if (!uid) return;
          const w = row.winner_id === gameInfo?.red_player_id ? 'red' as Player : 'black' as Player;
          setGameOver(true);
          setWinner(w);
          setShowGameOver(true);
          setForfeitReason('Forfeit');
          setMessage(`Game Over! ${w === playerColor ? 'You win!' : `${opponentUsername} wins!`}`);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [gameId, gameOver, playerColor, opponentUsername, gameInfo]);

  // ─── Subscribe to remote moves ───
  useEffect(() => {
    const updateStats = async (winnerId: string) => {
      const s = stateRef.current;
      if (!s.gameInfo) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.rpc('increment_profile_stats', { player_id: winnerId, inc_games: 1, inc_wins: 1, inc_xp: 100 });
      const loserId = winnerId === s.gameInfo.red_player_id ? s.gameInfo.black_player_id : s.gameInfo.red_player_id;
      await supabase.rpc('increment_profile_stats', { player_id: loserId, inc_games: 1, inc_wins: 0, inc_xp: 0 });
      if (s.gameInfo.lobby_id) {
        await supabase.rpc('update_lobby_streaks', { p_lobby_id: s.gameInfo.lobby_id, p_winner_id: winnerId, p_loser_id: loserId });
      }
    };

    const sub = supabase
      .channel(`game-${gameId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'moves',
          filter: `game_id=eq.${gameId}`,
        },
        async (payload) => {
          if (loadingMovesRef.current) return;
          const move = payload.new as { move_data: Move; player_id: string; move_number: number };
          const { data: { user } } = await supabase.auth.getUser();
          if (!user || move.player_id === user.id) return;

          const s = stateRef.current;
          const m = move.move_data;
          const b = cloneBoard(s.board);
          const h = [...s.moveHistory, m];
          makeMove(b, m);

          if (m.captured) {
            const chain = getMovesForPiece(b, m.to).filter(x => x.captured);
            if (chain.length > 0) {
              setBoard(b);
              setSelected(null);
              setValidMoves([]);
              setJumpChain(null);
              setMoveHistory(h);
              setPieceStats(getPieceStats(b));
              setMessage(`Waiting for ${opponentUsername}\u2026`);
              return;
            }
          }

          const nextPlayer: Player = s.currentPlayer === 'red' ? 'black' : 'red';
          const result = checkGameOver(b, nextPlayer);
          setBoard(b);
          setCurrentPlayer(nextPlayer);
          setSelected(null);
          setValidMoves([]);
          setJumpChain(null);
          setMoveHistory(h);
          setPieceStats(getPieceStats(b));

          if (result.over) {
            setGameOver(true);
            setWinner(result.winner);
            setShowGameOver(true);
            setMessage(`Game Over! ${result.winner === 'red' ? 'Red' : 'Black'} wins!`);
            await supabase.from('games').update({ status: 'finished', winner_id: move.player_id }).eq('id', gameId);
            await updateStats(move.player_id);
          } else {
            setMessage(nextPlayer === s.playerColor ? 'Your turn' : `${opponentUsername}'s turn`);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(sub); };
  }, [gameId, opponentUsername]);

  // ─── Send move to DB ───
  const sendMoveToDB = useCallback(async (m: Move, moveNum: number) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('moves').insert({
      game_id: gameId,
      player_id: user.id,
      move_data: m,
      move_number: moveNum,
    });
  }, [gameId]);

  // ─── Piece click ───
  const handlePieceClick = useCallback((pos: Position) => {
    if (gameOver || !isMyTurn || !opponentOnline) return;
    if (jumpChain && (pos.row !== jumpChain.row || pos.col !== jumpChain.col)) return;
    const piece = board[pos.row][pos.col];
    if (!piece || piece.player !== currentPlayer) return;
    const moves = getMovesForPiece(board, pos);
    if (moves.length === 0) return;
    setSelected(pos);
    setValidMoves(moves);
  }, [board, currentPlayer, gameOver, jumpChain, isMyTurn, opponentOnline]);

  // ─── Square click ───
  const handleSquareClick = useCallback(async (pos: Position) => {
    if (gameOver || !selected || !isMyTurn || !opponentOnline) return;
    const move = validMoves.find(m => m.to.row === pos.row && m.to.col === pos.col);
    if (!move) {
      const clickedPiece = board[pos.row][pos.col];
      if (clickedPiece && clickedPiece.player === currentPlayer) {
        const moves = getMovesForPiece(board, pos);
        if (moves.length > 0) { setSelected(pos); setValidMoves(moves); return; }
      }
      setSelected(null); setValidMoves([]); return;
    }

    const newBoard = cloneBoard(board);
    const promoted = makeMove(newBoard, move);
    const newHistory = [...moveHistory, move];
    const nextMoveNum = newHistory.length;
    sendMoveToDB(move, nextMoveNum);

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
        setMessage('Continue jumping!');
        return;
      }
    }

    const nextPlayer: Player = currentPlayer === 'red' ? 'black' : 'red';
    const result = checkGameOver(newBoard, nextPlayer);
    setBoard(newBoard);
    setCurrentPlayer(nextPlayer);
    setSelected(null);
    setValidMoves([]);
    setJumpChain(null);
    setMoveHistory(newHistory);
    setPieceStats(getPieceStats(newBoard));

    if (result.over) {
      setGameOver(true);
      setWinner(result.winner);
      setShowGameOver(true);
      setMessage(`Game Over! ${result.winner === 'red' ? 'Red' : 'Black'} wins!`);
      const { data: { user } } = await supabase.auth.getUser();
      const winnerId = result.winner === playerColor ? user?.id : (result.winner === 'red' ? gameInfo?.red_player_id : gameInfo?.black_player_id);
      const winnerIdToSet = winnerId || null;
      await supabase.from('games').update({ status: 'finished', winner_id: winnerIdToSet }).eq('id', gameId);
      if (winnerIdToSet) await updateProfileStats(winnerIdToSet);
    } else {
      setMessage(`${opponentUsername}'s turn`);
    }
  }, [gameOver, selected, validMoves, isMyTurn, opponentOnline, board, currentPlayer, moveHistory, gameId, playerColor, opponentUsername, sendMoveToDB, gameInfo, updateProfileStats]);

  // ─── Refresh leaderboard cache after game ends ───
  useEffect(() => {
    if (!gameOver) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('username, games_played, wins, xp, country')
        .order('xp', { ascending: false })
        .order('wins', { ascending: false })
        .limit(100);
      if (data) {
        localStorage.setItem('chekaz_leaderboard_cache', JSON.stringify(data));
      }
    })();
  }, [gameOver]);

  // ─── Theme selection ───
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
  const handleThemeChange = (t: BoardTheme) => { const s = loadSettings(); saveSettings({ ...s, boardTheme: t }); };
  const handleCssChange = (c: BoardCss) => { const s = loadSettings(); saveSettings({ ...s, boardCss: c }); };

  // ─── Navigation ───
  const goToMenu = useCallback(() => onBackToMenu(), [onBackToMenu]);

  if (loadingMoves) {
    return (
      <div className="page-root"><div className="page-overlay" />
        <div className="page-panel" style={{ maxWidth: 400, textAlign: 'center' }}>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>Loading game\u2026</p>
        </div>
      </div>
    );
  }

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

      {/* Disconnect Banner */}
      {(!opponentOnline || selfDisconnected) && (
        <div className={`game-disconnect-banner ${selfDisconnected ? 'self' : 'opponent'}`}>
          {selfDisconnected
            ? `\u26A0 Connection lost. Reconnect within ${forfeitCountdown ?? FORFEIT_COUNTDOWN_SEC}s or you lose.`
            : `\u26A0 ${opponentUsername} disconnected. You win in ${forfeitCountdown ?? FORFEIT_COUNTDOWN_SEC}s if they don't return.`}
        </div>
      )}

      {/* Main Body */}
      <div className="game-body">

        {/* ─── Left Panel ─── */}
        <div className="game-panel game-left-panel">
          <div className="game-panel-header">
            <span className="game-panel-icon">◈</span>
            Game Info
          </div>

          {/* Players */}
          <div className="game-player-section">
            <div className={`game-player-row ${currentPlayer === playerColor && !gameOver ? 'active' : ''}`}>
              <div className="game-player-indicator" />
              <div className="game-player-info">
                <span className="game-player-label">You ({playerColor === 'red' ? 'Red' : 'Black'})</span>
                <span className="game-player-timer">In-game</span>
              </div>
              <span className="game-player-status">{currentPlayer === playerColor && !gameOver ? '\u25C9' : '\u25CB'}</span>
            </div>
            <div className={`game-player-row ${currentPlayer !== playerColor && !gameOver ? 'active' : ''}`}>
              <div className="game-player-indicator black" />
              <div className="game-player-info">
                <span className="game-player-label">{opponentUsername} ({playerColor === 'red' ? 'Black' : 'Red'})</span>
                <span className="game-player-timer">
                  {opponentOnline ? 'In-game' : 'Reconnecting\u2026'}
                </span>
              </div>
              <span className="game-player-status">
                {currentPlayer !== playerColor && !gameOver ? '\u25C9' : opponentOnline ? '\u25CB' : '\u25D8'}
              </span>
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
          {showGameOver && (
            <div className="game-modal-overlay">
              <div className="game-modal">
                <div className="game-modal-divider" style={{ marginBottom: 6, fontSize: 11, color: 'rgba(200,162,70,0.4)' }}>
                  {'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \u25C7 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'}
                </div>
                <h2>Game Over</h2>
                <p className="game-modal-winner">
                  {forfeitReason
                    ? (winner === playerColor
                        ? `You won \u2014 ${opponentUsername} forfeited`
                        : 'You lost due to forfeiting')
                    : (winner === playerColor ? 'You win!' : `${opponentUsername} wins!`)}
                </p>
                {!forfeitReason && (
                  <p className="game-modal-sub">{moveHistory.length} moves played</p>
                )}
                <div className="game-modal-actions">
                  <button className="game-modal-btn primary" onClick={goToMenu}>Back to Menu</button>
                </div>
              </div>
            </div>
          )}

          {/* Forfeit Confirmation Modal */}
          {showForfeitConfirm && (
            <div className="game-modal-overlay">
              <div className="game-modal" style={{ maxWidth: 380 }}>
                <div className="game-modal-divider" style={{ marginBottom: 6, fontSize: 11, color: 'rgba(200,162,70,0.4)' }}>
                  {'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \u25C7 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'}
                </div>
                <h2>Forfeit?</h2>
                <p className="game-modal-sub">Are you sure? {opponentUsername} will win.</p>
                <div className="game-modal-actions">
                  <button className="game-modal-btn primary" onClick={handleForfeitConfirm}>Confirm Forfeit</button>
                  <button className="game-modal-btn secondary" onClick={() => setShowForfeitConfirm(false)}>Cancel</button>
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
            <button className="game-action-btn" onClick={() => setShowForfeitConfirm(true)} disabled={gameOver} style={{ background: 'linear-gradient(180deg, #5a2020, #3a1010)', borderColor: '#8a3030' }}>
              <span className="game-action-label">Forfeit</span>
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
              ? `Game Over \u2014 ${winner === playerColor ? 'You win!' : `${opponentUsername} wins!`}`
              : selfDisconnected
                ? 'Connection lost \u2014 Reconnecting\u2026'
                : !opponentOnline
                  ? `${opponentUsername} disconnected \u2014 Auto-win in ${forfeitCountdown ?? FORFEIT_COUNTDOWN_SEC}s`
                  : message}
          </span>
        </div>
        <div className="game-status-right">
          <span className={`game-status-dot ${opponentOnline && !selfDisconnected ? 'online' : 'offline'}`}
            title={opponentOnline && !selfDisconnected ? 'Connected' : 'Disconnected'} />
          <button className="game-status-btn" title="Fullscreen" onClick={() => {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen();
            else document.exitFullscreen();
          }}>⛶</button>
        </div>
      </div>
    </div>
  );
}
