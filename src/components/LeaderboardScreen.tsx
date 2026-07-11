import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../supabase/client';

interface Props {
  onBack: () => void;
}

interface LBEntry {
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

const PAGE_SIZE = 20;
const CACHE_KEY = 'chekaz_leaderboard_cache';

function loadCached(): LBEntry[] {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
  } catch { return []; }
}

export default function LeaderboardScreen({ onBack }: Props) {
  const [allEntries, setAllEntries] = useState<LBEntry[]>(loadCached);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [offline, setOffline] = useState(true);
  const fetchRef = useRef(0);

  // Filter entries client-side
  const entries = countryFilter
    ? allEntries.filter(e => e.country === countryFilter)
    : allEntries;

  useEffect(() => {
    const id = ++fetchRef.current;
    setLoading(true);
    setOffline(true);
    setError('');
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (id !== fetchRef.current) return;
      setUserId(session?.user?.id ?? null);

      if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
        setError('Supabase not configured');
        setLoading(false);
        return;
      }

      // Always fetch the full list (no country filter) for caching
      const { data, error: qerr } = await supabase
        .from('profiles')
        .select('username, games_played, wins, xp, country')
        .order('xp', { ascending: false })
        .order('wins', { ascending: false })
        .limit(100);

      if (id !== fetchRef.current) return;

      if (qerr) {
        // Keep cached data, just mark offline
        setOffline(true);
        setLoading(false);
        return;
      }

      const list = (data || []) as LBEntry[];
      setAllEntries(list);
      setOffline(false);
      setLoading(false);
      localStorage.setItem(CACHE_KEY, JSON.stringify(list));
    })();
  }, [countryFilter]);

  const totalPages = Math.ceil(entries.length / PAGE_SIZE);
  const offset = page * PAGE_SIZE;
  const pageEntries = entries.slice(offset, offset + PAGE_SIZE);

  return (
    <div className="page-root">
      <div className="page-overlay" />
      <div className="page-panel">
        <h1 className="page-title">Leaderboard</h1>
        <div className="page-divider">&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500; &#x25C7; &#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;</div>

        {error && <p className="on-err" style={{ textAlign: 'center', marginBottom: 12 }}>{error}</p>}

        {offline && allEntries.length > 0 && <p className="lan-offline-banner" style={{ marginBottom: 12 }}>Offline — showing cached data</p>}

        <div className="lb-controls">
          <select className="lan-input" value={countryFilter} onChange={e => { setCountryFilter(e.target.value); setPage(0); }}>
            <option value="">All Countries</option>
            {COUNTRIES.filter(Boolean).map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {loading && <span className="lb-refreshing">Updating\u2026</span>}
        </div>

        {entries.length === 0 && !loading ? (
          <p className="lan-empty">No players found</p>
        ) : entries.length === 0 && loading ? (
          <p style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', padding: 40 }}>Loading\u2026</p>
        ) : (
          <>
            <div className="lb-table">
              <div className="lb-hdr">
                <span className="lb-rank">#</span>
                <span className="lb-name">Player</span>
                <span className="lb-country">Country</span>
                <span className="lb-num">XP</span>
                <span className="lb-num">W</span>
                <span className="lb-num">P</span>
              </div>
              {pageEntries.map((e, i) => (
                <div key={e.username} className={`lb-row${e.username === localStorage.getItem('chekaz_guest_name') ? ' me' : ''}`}>
                  <span className="lb-rank">{offset + i + 1}</span>
                  <span className="lb-name">{e.username}</span>
                  <span className="lb-country">{e.country || '\u2014'}</span>
                  <span className="lb-num">{e.xp}</span>
                  <span className="lb-num">{e.wins}</span>
                  <span className="lb-num">{e.games_played}</span>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="lb-pages">
                <button className="pg-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                  &#8592; Prev
                </button>
                <span className="pg-info">Page {page + 1} of {totalPages}</span>
                <button className="pg-btn" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                  Next &#8594;
                </button>
              </div>
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
