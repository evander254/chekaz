import React, { useEffect, useState } from 'react';
import { loadStats, GameStats } from '../game/storage';
import { supabase } from '../supabase/client';
import { detectCountry } from '../supabase/geo';

interface Props {
  onBack: () => void;
}

interface OnlineProfile {
  username: string;
  games_played: number;
  wins: number;
  xp: number;
  country: string | null;
}

const COUNTRIES = [
  '', 'US', 'GB', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'NL',
  'BR', 'AR', 'MX', 'JP', 'KR', 'CN', 'IN', 'RU', 'ZA', 'NG',
  'EG', 'KE', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'PT', 'GR',
  'TR', 'IL', 'AE', 'SA', 'SG', 'MY', 'TH', 'VN', 'PH', 'NZ',
];

const CACHE_KEY = 'chekaz_profile_cache';

function loadCachedProfile(): OnlineProfile | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  } catch { return null; }
}

export default function RecordsScreen({ onBack }: Props) {
  const [onlineProfile, setOnlineProfile] = useState<OnlineProfile | null>(loadCachedProfile);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [country, setCountry] = useState(onlineProfile?.country || '');
  const [savingCountry, setSavingCountry] = useState(false);
  const [savedCountryMsg, setSavedCountryMsg] = useState('');
  const [offline, setOffline] = useState(true);

  const localStats: GameStats = loadStats();
  const localCompleted = localStats.redWins + localStats.blackWins + localStats.draws;

  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled || !session?.user) { setLoading(false); return; }

      const { data: prof, error: qerr } = await supabase
        .from('profiles')
        .select('username, games_played, wins, xp, country')
        .eq('id', session.user.id)
        .single();

      if (cancelled) return;

      if (qerr) {
        // Keep cached data, mark offline
        setOffline(true);
        setLoading(false);
        return;
      }

      if (prof) {
        const p: OnlineProfile = {
          username: prof.username,
          games_played: prof.games_played ?? 0,
          wins: prof.wins ?? 0,
          xp: prof.xp ?? 0,
          country: prof.country ?? null,
        };
        setOnlineProfile(p);
        setCountry(p.country || '');
        setOffline(false);
        setLoading(false);
        localStorage.setItem(CACHE_KEY, JSON.stringify(p));

        if (!prof.country) {
          const detected = await detectCountry();
          if (detected && !cancelled) {
            await supabase.from('profiles').update({ country: detected }).eq('id', session.user.id);
            setCountry(detected);
            setOnlineProfile(prev => prev ? { ...prev, country: detected } : prev);
          }
        }
      } else {
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSaveCountry = async () => {
    if (!onlineProfile) return;
    setSavingCountry(true);
    setSavedCountryMsg('');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { setSavedCountryMsg('Not signed in'); setSavingCountry(false); return; }
    const { error: uerr } = await supabase
      .from('profiles')
      .update({ country: country || null })
      .eq('id', session.user.id);
    if (uerr) {
      setSavedCountryMsg('Failed to save');
    } else {
      setSavedCountryMsg('Saved!');
      setOnlineProfile({ ...onlineProfile, country: country || null });
    }
    setSavingCountry(false);
    setTimeout(() => setSavedCountryMsg(''), 3000);
  };

  return (
    <div className="page-root">
      <div className="page-overlay" />
      <div className="page-panel">
        <h1 className="page-title">Records</h1>
        <div className="page-divider">&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500; &#x25C7; &#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;</div>

        {error && <p className="on-err" style={{ textAlign: 'center', marginBottom: 12 }}>{error}</p>}

        {offline && onlineProfile && <p className="lan-offline-banner" style={{ marginBottom: 12 }}>Offline — showing cached data</p>}

        {loading ? (
          <p style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', padding: 40 }}>Loading\u2026</p>
        ) : (
          <>
            {onlineProfile ? (
              <>
                <h3 className="rec-section-title">Online Profile</h3>
                <div className="on-stats" style={{ marginBottom: 16 }}>
                  <div className="on-stat"><span className="on-stat-val">{onlineProfile.games_played}</span><span className="on-stat-lbl">Played</span></div>
                  <div className="on-stat"><span className="on-stat-val">{onlineProfile.wins}</span><span className="on-stat-lbl">Wins</span></div>
                  <div className="on-stat"><span className="on-stat-val">{Math.max(0, onlineProfile.games_played - onlineProfile.wins)}</span><span className="on-stat-lbl">Losses</span></div>
                  <div className="on-stat"><span className="on-stat-val">{onlineProfile.xp}</span><span className="on-stat-lbl">XP</span></div>
                </div>

                <div className="setup-section" style={{ marginTop: 0 }}>
                  <label className="setup-label">Country</label>
                  <div className="rec-country-row">
                    <select className="lan-input" value={country} onChange={e => setCountry(e.target.value)}>
                      <option value="">\u2014 Select \u2014</option>
                      {COUNTRIES.filter(Boolean).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <button className="og-btn" onClick={handleSaveCountry} disabled={savingCountry}>
                      {savingCountry ? 'Saving\u2026' : 'Save'}
                    </button>
                  </div>
                  {savedCountryMsg && <p className="setup-hint" style={{ color: '#4caf50' }}>{savedCountryMsg}</p>}
                </div>
              </>
            ) : (
              <p className="lan-empty" style={{ marginBottom: 16 }}>
                Sign in to track online stats and XP
              </p>
            )}

            <h3 className="rec-section-title">Local Games</h3>
            <div className="on-stats">
              <div className="on-stat"><span className="on-stat-val">{localStats.totalGames}</span><span className="on-stat-lbl">Played</span></div>
              <div className="on-stat"><span className="on-stat-val" style={{ color: '#ef5350' }}>{localStats.redWins}</span><span className="on-stat-lbl">Red Wins</span></div>
              <div className="on-stat"><span className="on-stat-val" style={{ color: '#bdbdbd' }}>{localStats.blackWins}</span><span className="on-stat-lbl">Black Wins</span></div>
              <div className="on-stat"><span className="on-stat-val">{localStats.draws}</span><span className="on-stat-lbl">Draws</span></div>
              <div className="on-stat"><span className="on-stat-val">{localStats.totalMoves}</span><span className="on-stat-lbl">Moves</span></div>
            </div>

            {localCompleted > 0 && (
              <p className="rec-winrate">
                Win Rate: <strong>{Math.round(((localStats.redWins + localStats.blackWins) / localCompleted) * 100)}%</strong>
                {localStats.lastPlayed && <> &middot; Last played: {new Date(localStats.lastPlayed).toLocaleDateString()}</>}
              </p>
            )}
          </>
        )}

        <div className="set-actions" style={{ marginTop: 20 }}>
          <button className="set-btn" onClick={onBack}><span className="set-btn-icon">&#8592;</span> Back</button>
        </div>
      </div>
    </div>
  );
}
