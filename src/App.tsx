import React, { useState, useCallback, useEffect } from 'react';
import { Player } from './game/types';
import {
  GameStats, loadStats, saveStats,
  loadGame, saveGame, clearGame,
  loadSettings, saveSettings,
  Difficulty, BoardTheme, BoardCss, ScreenMode,
} from './game/storage';
import { createInitialBoard } from './game/GameEngine';
import LandingPage from './components/LandingPage';
import SetupScreen from './components/SetupScreen';
import SettingsScreen from './components/SettingsScreen';
import GameView from './components/GameView';
import OnlineLobby from './components/OnlineLobby';
import OnlineGameView from './components/OnlineGameView';
import RecordsScreen from './components/RecordsScreen';
import LeaderboardScreen from './components/LeaderboardScreen';
import './game.css';

type View = 'menu' | 'settings' | 'setup' | 'game' | 'online' | 'online_game' | 'records' | 'leaderboard';

function getViewFromHash(): View {
  const base = window.location.hash.slice(1).split('?')[0] || 'menu';
  if ((['menu','settings','setup','game','online','online_game','records','leaderboard'] as View[]).includes(base as View))
    return base as View;
  return 'menu';
}

function getHashParams(): URLSearchParams {
  const idx = window.location.hash.indexOf('?');
  return idx >= 0 ? new URLSearchParams(window.location.hash.slice(idx + 1)) : new URLSearchParams();
}

export interface GameConfig { mode: GameMode; playerColor: Player }

export default function App() {
  const [, refresh] = useState(0);

  const [offlineOnlineNotice, setOfflineOnlineNotice] = useState(false);

  useEffect(() => {
    const re = () => refresh(n => n + 1);
    const onFsChange = () => {
      const isFs = !!document.fullscreenElement;
      const s = loadSettings();
      if ((isFs && s.screenMode !== 'fullscreen') || (!isFs && s.screenMode !== 'windowed')) {
        saveSettings({ ...s, screenMode: isFs ? 'fullscreen' : 'windowed' });
        refresh(n => n + 1);
      }
    };
    window.addEventListener('hashchange', re);
    window.addEventListener('storage', re);
    document.addEventListener('fullscreenchange', onFsChange);
    // Apply stored fullscreen setting on mount
    const s = loadSettings();
    if (s.screenMode === 'fullscreen' && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    return () => {
      window.removeEventListener('hashchange', re);
      window.removeEventListener('storage', re);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, []);

  const view = getViewFromHash();
  const params = getHashParams();
  const stats = loadStats();
  const settings = loadSettings();
  const saved = loadGame();

  const hasSavedGame = !!saved;
  const config: GameConfig | null = saved
    ? { mode: saved.mode || 'pvp', playerColor: saved.playerColor || 'red' }
    : null;
  const onlineGame = view === 'online_game'
    ? {
        gameId: params.get('gameId') || '',
        color: (params.get('color') || 'red') as Player,
        opponentUsername: params.get('opponent') || '',
      }
    : null;

  const goToSetup = useCallback(() => { window.location.hash = 'setup'; }, []);
  const goToSettings = useCallback(() => { window.location.hash = 'settings'; }, []);
  const goToMenu = useCallback(() => { window.location.hash = 'menu'; }, []);
  const goToOnline = useCallback(() => {
    if (!navigator.onLine) {
      setOfflineOnlineNotice(true);
      return;
    }
    window.location.hash = 'online';
  }, []);

  const dismissOfflineNotice = useCallback(() => setOfflineOnlineNotice(false), []);
  const goToRecords = useCallback(() => { window.location.hash = 'records'; }, []);
  const goToLeaderboard = useCallback(() => { window.location.hash = 'leaderboard'; }, []);

  const handleStart = useCallback((mode: GameMode, playerColor: Player) => {
    saveGame({
      board: createInitialBoard(),
      currentPlayer: 'red',
      moveHistory: [],
      jumpChain: null,
      gameOver: false,
      winner: null,
      message: "Red's turn \u2014 Select a piece",
      mode,
      playerColor,
      timestamp: Date.now(),
    });
    window.location.hash = 'game';
  }, []);

  const handleContinue = useCallback(() => {
    window.location.hash = 'game';
  }, []);

  const handleDifficultyChange = useCallback((d: Difficulty) => {
    const s = loadSettings();
    saveSettings({ cpuDifficulty: d, renderMode: s.renderMode, boardTheme: s.boardTheme, boardCss: s.boardCss, screenMode: s.screenMode });
  }, []);

  const handleThemeChange = useCallback((t: BoardTheme) => {
    const s = loadSettings();
    saveSettings({ cpuDifficulty: s.cpuDifficulty, renderMode: s.renderMode, boardTheme: t, boardCss: s.boardCss, screenMode: s.screenMode });
  }, []);

  const handleCssChange = useCallback((c: BoardCss) => {
    const s = loadSettings();
    saveSettings({ cpuDifficulty: s.cpuDifficulty, renderMode: s.renderMode, boardTheme: s.boardTheme, boardCss: c, screenMode: s.screenMode });
  }, []);

  const handleScreenModeChange = useCallback((m: ScreenMode) => {
    const s = loadSettings();
    saveSettings({ ...s, screenMode: m });
    if (m === 'fullscreen') {
      document.documentElement.requestFullscreen().catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const handleGameEnd = useCallback((winner: Player | null, moveCount: number) => {
    const s = loadStats();
    s.totalGames++;
    s.totalMoves += moveCount;
    s.lastPlayed = new Date().toISOString();
    if (winner === 'red') s.redWins++;
    else if (winner === 'black') s.blackWins++;
    else s.draws++;
    saveStats(s);
    clearGame();
  }, []);

  const handleOnlineEnterGame = useCallback((gameId: string, color: Player, opponentUsername: string) => {
    window.location.hash = `online_game?gameId=${encodeURIComponent(gameId)}&color=${color}&opponent=${encodeURIComponent(opponentUsername)}`;
  }, []);

  const handleOnlineBackToMenu = useCallback(() => {
    window.location.hash = 'menu';
  }, []);

  switch (view) {
    case 'settings':
      return (
        <SettingsScreen
          difficulty={settings.cpuDifficulty}
          boardTheme={settings.boardTheme}
          boardCss={settings.boardCss}
          screenMode={settings.screenMode}
          onChangeDifficulty={handleDifficultyChange}
          onChangeTheme={handleThemeChange}
          onChangeCss={handleCssChange}
          onChangeScreenMode={handleScreenModeChange}
          onBack={goToMenu}
        />
      );
    case 'setup':
      return (
        <SetupScreen
          difficulty={settings.cpuDifficulty}
          onStart={handleStart}
          onBack={goToMenu}
        />
      );
    case 'online':
      return (
        <OnlineLobby
          onEnterGame={handleOnlineEnterGame}
          onBack={goToMenu}
          initialJoinToken={getHashParams().get('join') || undefined}
        />
      );
    case 'online_game':
      return onlineGame?.gameId ? (
        <OnlineGameView
          gameId={onlineGame.gameId}
          playerColor={onlineGame.color}
          opponentUsername={onlineGame.opponentUsername}
          boardTheme={settings.boardTheme}
          boardCss={settings.boardCss}
          onBackToMenu={handleOnlineBackToMenu}
        />
      ) : (
        <LandingPage
          hasSavedGame={hasSavedGame}
          onNewGame={goToSetup} onContinue={handleContinue}
          onSettings={goToSettings} onOnline={goToOnline}
          onRecords={goToRecords} onLeaderboard={goToLeaderboard}
          offlineOnlineNotice={offlineOnlineNotice}
          onDismissOfflineNotice={dismissOfflineNotice}
        />
      );
    case 'game':
      return config ? (
        <GameView
          config={config}
          boardTheme={settings.boardTheme}
          boardCss={settings.boardCss}
          onBackToMenu={goToMenu}
          onGameEnd={handleGameEnd}
        />
      ) : (
        <LandingPage
          hasSavedGame={hasSavedGame}
          onNewGame={goToSetup} onContinue={handleContinue}
          onSettings={goToSettings} onOnline={goToOnline}
          onRecords={goToRecords} onLeaderboard={goToLeaderboard}
          offlineOnlineNotice={offlineOnlineNotice}
          onDismissOfflineNotice={dismissOfflineNotice}
        />
      );
    case 'records':
      return <RecordsScreen onBack={goToMenu} />;
    case 'leaderboard':
      return <LeaderboardScreen onBack={goToMenu} />;
    default:
      return (
        <LandingPage
          hasSavedGame={hasSavedGame}
          onNewGame={goToSetup} onContinue={handleContinue}
          onSettings={goToSettings} onOnline={goToOnline}
          onRecords={goToRecords} onLeaderboard={goToLeaderboard}
          offlineOnlineNotice={offlineOnlineNotice}
          onDismissOfflineNotice={dismissOfflineNotice}
        />
      );
  }
}
