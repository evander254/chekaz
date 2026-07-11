import React, { useEffect } from 'react';
import logo from '../assets/chekaz.png';

interface Props {
  hasSavedGame: boolean;
  onNewGame: () => void;
  onContinue: () => void;
  onSettings: () => void;
  onOnline: () => void;
  onRecords: () => void;
  onLeaderboard: () => void;
  offlineOnlineNotice?: boolean;
  onDismissOfflineNotice?: () => void;
}

export default function LandingPage({ hasSavedGame, onNewGame, onContinue, onSettings, onOnline, onRecords, onLeaderboard, offlineOnlineNotice, onDismissOfflineNotice }: Props) {
  useEffect(() => {
    if (!offlineOnlineNotice) return;
    const t = setTimeout(() => onDismissOfflineNotice?.(), 3500);
    const goOnline = () => onDismissOfflineNotice?.();
    window.addEventListener('online', goOnline);
    return () => {
      clearTimeout(t);
      window.removeEventListener('online', goOnline);
    };
  }, [offlineOnlineNotice, onDismissOfflineNotice]);

  return (
    <div className="landing">
      <div className="landing-bg" />

      {offlineOnlineNotice && (
        <div className="landing-toast" onClick={onDismissOfflineNotice}>
          Connect to the internet to play online
        </div>
      )}

      <button className="landing-settings-btn" onClick={onSettings} aria-label="Settings">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <div className="landing-content">
        <div className="landing-brand">
          <img className="landing-logo" src={logo} alt="Chekaz" />
        </div>

        <div className="landing-actions">
          <button className="landing-btn primary" onClick={onNewGame}>
            Play Game
          </button>
          {hasSavedGame && (
            <button className="landing-btn secondary" onClick={onContinue}>
              Continue Game
            </button>
          )}
          <button className="landing-btn secondary" onClick={onOnline}>
            Play Online
          </button>
        </div>

        <div className="landing-footer-actions">
          <button className="landing-btn text" onClick={onRecords}>Records</button>
          <button className="landing-btn text" onClick={onLeaderboard}>Leaderboard</button>
        </div>
      </div>
    </div>
  );
}
