import React, { useEffect, useState, useCallback, useRef } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase/client';
import { detectCountry } from '../supabase/geo';
import { Player } from '../game/types';

interface Props {
  onEnterGame: (gameId: string, color: Player, opponentUsername: string) => void;
  onBack: () => void;
  initialJoinToken?: string;
}

const ADJ = ['Brave','Swift','Clever','Mighty','Silent','Golden','Shadow','Frost','Storm','Crimson','Cosmic','Ember','Flare','Lunar','Nova','Phantom','Raven','Solar','Thunder','Vortex','Wild'];
const NOUNS = ['Eagle','Fox','Wolf','Bear','Tiger','Hawk','Owl','Deer','Lynx','Pike','Badger','Crane','Drake','Elk','Finch','Gull','Heron','Jackal','Lark','Moth','Oryx','Puma','Swan','Wren','Zebra'];

const LS_USERNAME = 'chekaz_guest_name';
const LS_USER_ID = 'chekaz_guest_id';

function randomUsername(): string {
  return ADJ[Math.floor(Math.random() * ADJ.length)]
    + NOUNS[Math.floor(Math.random() * NOUNS.length)]
    + (Math.floor(Math.random() * 90) + 10);
}

function generateLobbyCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

interface LobbyRow {
  id: string; code: string; host_player_id: string;
  status: string; is_protected: boolean; player_count?: number;
  share_token?: string | null; share_expires_at?: string | null;
}
interface LobbyPlayerRow {
  id: string; player_id: string; username?: string;
  wins?: number; losses?: number; streak?: number;
  best_win_streak?: number; best_loss_streak?: number;
}
interface ProfileData {
  username: string; games_played: number; wins: number; xp: number;
}

type AuthPhase = 'loading' | 'choose' | 'login' | 'signup';
type LobbyView = 'menu' | 'create' | 'join' | 'room';

export default function OnlineLobby({ onEnterGame, onBack, initialJoinToken }: Props) {
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [phase, setPhase] = useState<AuthPhase>('loading');
  const [needUsername, setNeedUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);

  const [view, setView] = useState<LobbyView>('menu');
  const [statusMsg, setStatusMsg] = useState('');

  const [createPassword, setCreatePassword] = useState('');
  const [creating, setCreating] = useState(false);

  const [joinCode, setJoinCode] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);

  const [currentLobby, setCurrentLobby] = useState<LobbyRow | null>(null);
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayerRow[]>([]);
  const [lobbyChannel, setLobbyChannel] = useState<RealtimeChannel | null>(null);
  const [hostColor, setHostColor] = useState<'red' | 'black'>('red');

  // Auth form state
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');

  // Sign in
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Sign up
  const [signupUsername, setSignupUsername] = useState('');
  const [signupUsernameAvailable, setSignupUsernameAvailable] = useState<boolean | null>(null);
  const [signupUsernameChecking, setSignupUsernameChecking] = useState(false);
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');

  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Online/offline listener
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Quick match
  const [quickMatching, setQuickMatching] = useState(false);
  const [matched, setMatched] = useState<{ opponentUsername: string; opponentXp: number; opponentWins: number; gameId: string; color: Player } | null>(null);
  const [poolCount, setPoolCount] = useState(0);
  const [quickMatchTimedOut, setQuickMatchTimedOut] = useState(false);
  const quickMatchChannelRef = useRef<RealtimeChannel | null>(null);
  const poolChannelRef = useRef<RealtimeChannel | null>(null);
  const quickMatchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchedCountdownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const joinTokenProcessedRef = useRef(false);
  const enterLobbyRoomRef = useRef<(lobbyId: string) => Promise<void>>(async () => {});
  const onEnterGameRef = useRef(onEnterGame);
  onEnterGameRef.current = onEnterGame;

  const addStatus = useCallback((msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(''), 4000);
  }, []);

  // Check for active game — reconnection on refresh / tab return
  const checkForActiveGame = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    const { data, error } = await supabase.rpc('check_active_game', { p_player_id: uid });
    if (error || !data || data.length === 0) return;
    const game = data[0] as { game_id: string; opponent_id: string; opponent_name: string; player_color: string };
    // Clean up matchmaking if we were searching
    await supabase.from('matchmaking').delete().eq('player_id', uid);
    // Clean up quick match state
    if (quickMatchTimeoutRef.current) { clearTimeout(quickMatchTimeoutRef.current); quickMatchTimeoutRef.current = null; }
    if (poolChannelRef.current) supabase.removeChannel(poolChannelRef.current);
    poolChannelRef.current = null;
    if (quickMatchChannelRef.current) supabase.removeChannel(quickMatchChannelRef.current);
    quickMatchChannelRef.current = null;
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    setQuickMatching(false);
    setMatched(null);
    setPoolCount(0);
    setQuickMatchTimedOut(false);
    onEnterGameRef.current(game.game_id, game.player_color as Player, game.opponent_name);
  }, []);

  // Auto-join via share token from URL
  useEffect(() => {
    if (!userId || !initialJoinToken || joinTokenProcessedRef.current) return;
    joinTokenProcessedRef.current = true;
    (async () => {
      const { data: lobby, error } = await supabase
        .from('lobbies')
        .select('*')
        .eq('share_token', initialJoinToken)
        .in('status', ['waiting', 'playing'])
        .maybeSingle();
      if (error || !lobby) {
        addStatus('Invalid or expired invite link');
        return;
      }
      if (lobby.share_expires_at && new Date(lobby.share_expires_at) < new Date()) {
        addStatus('Invite link has expired');
        return;
      }
      const { data: existing } = await supabase
        .from('lobby_players')
        .select('id')
        .eq('lobby_id', lobby.id)
        .eq('player_id', userId)
        .maybeSingle();
      if (!existing) {
        const { error: joinErr } = await supabase.from('lobby_players').insert({ lobby_id: lobby.id, player_id: userId });
        if (joinErr) { addStatus('Failed to join lobby'); return; }
      }
      // Mark link as used (nullify expiry so it stays valid while lobby exists)
      await supabase.from('lobbies').update({ share_expires_at: null }).eq('id', lobby.id);
      await enterLobbyRoomRef.current(lobby.id);
    })();
  }, [userId, initialJoinToken, addStatus]);

  // Check for active game on mount (reconnect after refresh)
  useEffect(() => {
    if (!userId) return;
    checkForActiveGame();
  }, [userId, checkForActiveGame]);

  // ---- Session restore / auth ----
  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
      setAuthError('Supabase not configured. Check your .env file.');
      setPhase('choose');
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;

      // Try to restore guest identity from localStorage even before server confirms
      const localId = localStorage.getItem(LS_USER_ID);
      const localName = localStorage.getItem(LS_USERNAME);

      if (session?.user) {
        await loadProfile(session.user.id, localName);
        if (cancelled) return;
      } else if (localId && localName) {
        // Pre-fill with cached identity — user may be offline
        setUserId(localId);
        setProfile({ username: localName, games_played: 0, wins: 0, xp: 0 });
        setPhase('choose');
        setAuthError('Could not restore session. Sign in again to play.');
        return;
      } else {
        setPhase('choose');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Heartbeat — update profiles.last_seen every 15s while user is online
  useEffect(() => {
    if (!userId) return;
    supabase.rpc('touch_profile', { p_id: userId });
    heartbeatRef.current = setInterval(() => {
      supabase.rpc('touch_profile', { p_id: userId });
    }, 15000);
    return () => {
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    };
  }, [userId]);

  // Visibility change — stop heartbeat when hidden (cleanup removes stale entries after 60s),
  // restart and check for active game when shown again
  useEffect(() => {
    if (!userId) return;
    const handleVisibility = () => {
      if (document.hidden) {
        if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
        // Last heartbeat already sent — profile.last_seen is fresh
      } else {
        supabase.rpc('touch_profile', { p_id: userId });
        heartbeatRef.current = setInterval(() => {
          supabase.rpc('touch_profile', { p_id: userId });
        }, 15000);
        // Check if we were matched or game started while away
        checkForActiveGame();
        // If we were in quick match, try to match now
        if (quickMatching) {
          supabase.rpc('try_match');
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [userId, checkForActiveGame, quickMatching]);

  // Final heartbeat on beforeunload (best-effort)
  useEffect(() => {
    if (!userId) return;
    const handleBeforeUnload = () => {
      fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/touch_profile`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ p_id: userId }),
          keepalive: true,
        }
      );
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [userId]);

  async function loadProfile(uid: string, cachedName: string | null) {
    setUserId(uid);
    localStorage.setItem(LS_USER_ID, uid);

    const { data: prof } = await supabase
      .from('profiles')
      .select('username, games_played, wins, xp, country')
      .eq('id', uid)
      .single();

    if (prof) {
      const p = { username: prof.username, games_played: prof.games_played ?? 0, wins: prof.wins ?? 0, xp: prof.xp ?? 0 };
      setProfile(p);
      localStorage.setItem(LS_USERNAME, p.username);
      setPhase('choose');

      // Auto-detect country if not set
      if (!prof.country) {
        const country = await detectCountry();
        if (country) {
          await supabase.from('profiles').update({ country }).eq('id', uid);
        }
      }
    } else if (cachedName) {
      // Session exists but no profile yet — use cached name
      setProfile({ username: cachedName, games_played: 0, wins: 0, xp: 0 });
      setNeedUsername(true);
      setUsernameInput(cachedName);
      setPhase('choose');
    } else {
      setNeedUsername(true);
      setUsernameInput(randomUsername());
      setPhase('choose');
    }
  }

  const handleGuestSignIn = async () => {
    setAuthBusy(true);
    const { data: { user }, error } = await supabase.auth.signInAnonymously();
    if (error || !user) {
      setAuthError(error?.message || 'Sign-in failed');
      setAuthBusy(false);
      return;
    }
    const cachedName = localStorage.getItem(LS_USERNAME);
    await loadProfile(user.id, cachedName);
    setAuthBusy(false);
  };

  const handleGoogleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/#online' },
    });
  };

  // ---- Username availability check (debounced) ----
  const checkUsernameAvailable = useCallback(async (name: string) => {
    if (name.length < 2) { setSignupUsernameChecking(false); setSignupUsernameAvailable(null); return; }
    setSignupUsernameChecking(true);
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', name)
      .maybeSingle();
    setSignupUsernameAvailable(!data);
    setSignupUsernameChecking(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      if (signupUsername.trim().length >= 2) checkUsernameAvailable(signupUsername.trim());
    }, 400);
    return () => clearTimeout(t);
  }, [signupUsername, checkUsernameAvailable]);

  const handleSignIn = async () => {
    const identifier = loginIdentifier.trim();
    if (!identifier || loginPassword.length < 6) {
      setAuthError('Valid email/username and password required');
      return;
    }
    setAuthBusy(true);
    setAuthError('');

    let email = identifier;
    if (!email.includes('@')) {
      const { data: prof, error: lerr } = await supabase
        .from('profiles')
        .select('email')
        .eq('username', email)
        .maybeSingle();
      if (lerr || !prof?.email) {
        setAuthError('Username not found');
        setAuthBusy(false);
        return;
      }
      email = prof.email;
    }

    const { data: { user }, error } = await supabase.auth.signInWithPassword({ email, password: loginPassword });
    if (error) { setAuthError(error.message); setAuthBusy(false); return; }
    if (user) await loadProfile(user.id, null);
    setAuthBusy(false);
  };

  const handleSignUp = async () => {
    const name = signupUsername.trim();
    if (name.length < 2) { setAuthError('Username must be at least 2 characters'); return; }
    if (name.length > 20) { setAuthError('Username must be 20 characters or less'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(name)) { setAuthError('Letters, numbers and underscores only'); return; }
    if (!signupEmail.trim() || signupPassword.length < 6) { setAuthError('Valid email and password (6+ chars) required'); return; }
    if (signupUsernameAvailable === false) { setAuthError('Username already taken'); return; }

    setAuthBusy(true);
    setAuthError('');

    const { data: { user }, error } = await supabase.auth.signUp({
      email: signupEmail.trim(),
      password: signupPassword,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) { setAuthError(error.message); setAuthBusy(false); return; }
    if (!user) { setAuthError('Sign-up failed'); setAuthBusy(false); return; }

    // Create profile with username + email for later username→email lookup
    const { error: perr } = await supabase.from('profiles').insert({
      id: user.id,
      username: name,
      email: signupEmail.trim(),
      games_played: 0, wins: 0, xp: 0,
    });
    if (perr) {
      if (perr.message.includes('duplicate') || perr.code === '23505') {
        setAuthError('Username already taken \u2014 try another');
      } else {
        setAuthError(perr.message);
      }
      setAuthBusy(false);
      return;
    }

    localStorage.setItem(LS_USERNAME, name);
    localStorage.setItem(LS_USER_ID, user.id);
    setProfile({ username: name, games_played: 0, wins: 0, xp: 0 });
    setUserId(user.id);
    setAuthBusy(false);

    // Auto-detect and save country
    const country = await detectCountry();
    if (country) {
      await supabase.from('profiles').update({ country }).eq('id', user.id);
    }
  };

  const handleSaveUsername = async () => {
    const name = usernameInput.trim();
    if (name.length < 2) { setUsernameError('Username must be at least 2 characters'); return; }
    if (name.length > 20) { setUsernameError('Username must be 20 characters or less'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(name)) { setUsernameError('Letters, numbers and underscores only'); return; }
    setSavingUsername(true);
    setUsernameError('');

    // Optimistically save to localStorage
    localStorage.setItem(LS_USERNAME, name);

    const { error } = await supabase.from('profiles').insert({
      id: userId,
      username: name,
      games_played: 0,
      wins: 0,
      xp: 0,
    });
    if (error) {
      if (error.message.includes('duplicate') || error.code === '23505') {
        setUsernameError('Username already taken — try another');
      } else {
        setUsernameError(error.message);
      }
      localStorage.removeItem(LS_USERNAME);
      setSavingUsername(false);
      return;
    }
    setProfile({ username: name, games_played: 0, wins: 0, xp: 0 });
    setNeedUsername(false);
    setSavingUsername(false);

    // Auto-detect and save country
    if (userId) {
      const country = await detectCountry();
      if (country) {
        await supabase.from('profiles').update({ country }).eq('id', userId);
      }
    }
  };

  const fetchPlayers = useCallback(async (lobbyId: string) => {
    const { data: players } = await supabase
      .from('lobby_players')
      .select('id, player_id, wins, losses, streak, best_win_streak, best_loss_streak, profiles(username)')
      .eq('lobby_id', lobbyId);
    if (players) {
      setLobbyPlayers(players.map((p: Record<string, unknown>) => ({
        id: p.id as string,
        player_id: p.player_id as string,
        username: ((p.profiles as Record<string, unknown> | null)?.username as string) || 'Unknown',
        wins: (p.wins as number) || 0,
        losses: (p.losses as number) || 0,
        streak: (p.streak as number) || 0,
        best_win_streak: (p.best_win_streak as number) || 0,
        best_loss_streak: (p.best_loss_streak as number) || 0,
      })));
    }
  }, []);

  const enterLobbyRoom = useCallback(async (lobbyId: string) => {
    const { data: lobby } = await supabase.from('lobbies').select('*').eq('id', lobbyId).single();
    if (!lobby) { addStatus('Lobby not found'); return; }
    setCurrentLobby(lobby);
    setView('room');

    const channel = supabase.channel(`lobby-${lobbyId}`);
    channel
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'lobby_players', filter: `lobby_id=eq.${lobbyId}` },
        () => fetchPlayers(lobbyId)
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'lobbies', filter: `id=eq.${lobbyId}` },
        (payload) => {
          const updated = payload.new as Record<string, unknown>;
          if (updated.status === 'playing') {
            (async () => {
              for (let i = 0; i < 10; i++) {
                const { data: game } = await supabase
                  .from('games')
                  .select('id, red_player_id, black_player_id')
                  .eq('lobby_id', lobbyId)
                  .single();
                if (game) {
                  const color = game.red_player_id === userIdRef.current ? 'red' as Player : 'black' as Player;
                  const oppId = color === 'red' ? game.black_player_id : game.red_player_id;
                  const { data: oppProfile } = await supabase.from('profiles').select('username').eq('id', oppId).single();
                  onEnterGame(game.id, color, oppProfile?.username || 'Unknown');
                  return;
                }
                await new Promise(r => setTimeout(r, 200));
              }
            })();
          }
        }
      )
      .subscribe();

    setLobbyChannel(channel);
    fetchPlayers(lobbyId);

    return () => { if (channel) supabase.removeChannel(channel); };
  }, [onEnterGame, addStatus, fetchPlayers]);

  enterLobbyRoomRef.current = enterLobbyRoom;

  const handleCreateLobby = async () => {
    if (!userId) return;
    setCreating(true);
    try {
      const { data: profileCheck } = await supabase.from('profiles').select('id').eq('id', userId).single();
      if (!profileCheck) { addStatus('Profile not found \u2013 try reconnecting'); setCreating(false); return; }

      let code = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        code = generateLobbyCode();
        const { data: existing } = await supabase.from('lobbies').select('id').eq('code', code).maybeSingle();
        if (!existing) break;
      }

      const shareToken = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const password = createPassword.trim();
      const { data: lobby, error } = await supabase
        .from('lobbies')
        .insert({ code, host_player_id: userId, is_protected: password.length > 0, password: password.length > 0 ? password : null, share_token: shareToken, share_expires_at: expiresAt })
        .select()
        .single();

      if (error) { addStatus(error.message); setCreating(false); return; }
      if (!lobby) { addStatus('Lobby creation returned no data'); setCreating(false); return; }

      await supabase.from('lobby_players').insert({ lobby_id: lobby.id, player_id: userId });
      await enterLobbyRoom(lobby.id);
    } catch (e) { addStatus(String(e)); }
    setCreating(false);
  };

  const handleJoinLobby = async () => {
    if (!userId) return;
    setJoining(true);
    try {
      const code = joinCode.toUpperCase().trim();
      const { data: lobby, error: lobbyErr } = await supabase
        .from('lobbies')
        .select('*')
        .eq('code', code)
        .eq('status', 'waiting')
        .maybeSingle();

      if (lobbyErr || !lobby) { addStatus('Lobby not found or already started'); setJoining(false); return; }
      if (lobby.is_protected && joinPassword.trim() !== lobby.password) {
        addStatus('Wrong password'); setJoining(false); return;
      }

      const { data: existing } = await supabase
        .from('lobby_players')
        .select('id')
        .eq('lobby_id', lobby.id)
        .eq('player_id', userId)
        .maybeSingle();

      if (!existing) {
        const { error: joinErr } = await supabase.from('lobby_players').insert({ lobby_id: lobby.id, player_id: userId });
        if (joinErr) { addStatus('Failed to join lobby'); setJoining(false); return; }
      }

      await enterLobbyRoom(lobby.id);
    } catch { addStatus('Error joining lobby'); }
    setJoining(false);
  };

  const handleStartGame = async () => {
    if (!currentLobby || !userId) return;
    const others = lobbyPlayers.filter(p => p.player_id !== userId);
    if (others.length === 0) { addStatus('Waiting for opponent'); return; }

    const opponent = others[0];
    const redId = hostColor === 'red' ? userId : opponent.player_id;
    const blackId = hostColor === 'red' ? opponent.player_id : userId;

    const { data: game, error } = await supabase
      .from('games')
      .insert({ lobby_id: currentLobby.id, red_player_id: redId, black_player_id: blackId, status: 'active' })
      .select()
      .single();

    if (error) { addStatus(error.message); return; }
    if (!game) { addStatus('Game creation returned no data'); return; }

    await supabase.from('lobbies').update({ status: 'playing' }).eq('id', currentLobby.id);

    const oppUsername = opponent.username || 'Unknown';
    onEnterGame(game.id, hostColor, oppUsername);
  };

  const handleLeaveLobby = async () => {
    if (currentLobby && userId) {
      await supabase.from('lobby_players').delete().eq('lobby_id', currentLobby.id).eq('player_id', userId);
      await supabase.from('lobbies').delete().eq('id', currentLobby.id).eq('host_player_id', userId);
    }
    if (lobbyChannel) supabase.removeChannel(lobbyChannel);
    setCurrentLobby(null);
    setLobbyPlayers([]);
    setView('menu');
  };

  const handleSignOut = async () => {
    localStorage.removeItem(LS_USERNAME);
    localStorage.removeItem(LS_USER_ID);
    await supabase.auth.signOut();
    setUserId(null);
    setProfile(null);
    setPhase('choose');
    setView('menu');
  };

  // ---- Quick Match ----
  const handleQuickMatch = useCallback(async () => {
    if (!userId) return;

    // Step 1: Check for active game — reconnect instead
    const { data: activeGame } = await supabase.rpc('check_active_game', { p_player_id: userId });
    if (activeGame && activeGame.length > 0) {
      const g = activeGame[0] as { game_id: string; opponent_id: string; opponent_name: string; player_color: string };
      onEnterGameRef.current(g.game_id, g.player_color as Player, g.opponent_name);
      return;
    }

    // Step 2: Check if already in queue
    const { data: existingQueue } = await supabase
      .from('matchmaking')
      .select('status, game_id, opponent_id')
      .eq('player_id', userId)
      .maybeSingle();

    // If already matched (e.g., after refresh during matched state), navigate directly
    if (existingQueue?.status === 'matched' && existingQueue.game_id && existingQueue.opponent_id) {
      const { data: opp } = await supabase.from('profiles').select('username').eq('id', existingQueue.opponent_id).single();
      const { data: gameRec } = await supabase.from('games').select('red_player_id, black_player_id').eq('id', existingQueue.game_id).single();
      if (gameRec) {
        const color = userId === gameRec.red_player_id ? 'red' as Player : 'black' as Player;
        onEnterGameRef.current(existingQueue.game_id, color, opp?.username || 'Unknown');
        return;
      }
    }

    setQuickMatching(true);
    setMatched(null);
    setPoolCount(0);
    setQuickMatchTimedOut(false);

    // Subscribe to our own row for match detection
    const channel = supabase.channel('quick-match');
    channel
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matchmaking', filter: `player_id=eq.${userId}` },
        async (payload) => {
          const row = payload.new as { opponent_id: string | null; game_id: string | null; status: string };
          if (row.opponent_id && row.game_id && row.status === 'matched') {
            if (quickMatchTimeoutRef.current) { clearTimeout(quickMatchTimeoutRef.current); quickMatchTimeoutRef.current = null; }
            const { data: opp } = await supabase.from('profiles').select('username, xp, wins').eq('id', row.opponent_id).single();
            const { data: gameRec } = await supabase.from('games').select('red_player_id, black_player_id').eq('id', row.game_id).single();
            if (gameRec) {
              const color = userId === gameRec.red_player_id ? 'red' as Player : 'black' as Player;
              setMatched({
                opponentUsername: opp?.username || 'Unknown',
                opponentXp: opp?.xp ?? 0,
                opponentWins: opp?.wins ?? 0,
                gameId: row.game_id,
                color,
              });
            }
          }
        }
      )
      .subscribe();
    quickMatchChannelRef.current = channel;

    // Subscribe to pool changes for real-time count + matching trigger
    const poolChan = supabase.channel('pool-count');
    poolChan
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'matchmaking' },
        async () => {
          const { count } = await supabase
            .from('matchmaking')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'searching');
          setPoolCount(count ?? 0);
          await supabase.rpc('try_match');
        }
      )
      .subscribe();
    poolChannelRef.current = poolChan;

    // Step 3: Insert into queue only if not already there
    if (!existingQueue) {
      await supabase.from('matchmaking').insert({ player_id: userId, status: 'searching' });
    }
    // Try to match immediately
    await supabase.rpc('try_match');

    const { count } = await supabase
      .from('matchmaking')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'searching');
    setPoolCount(count ?? 0);

    // 1-minute timeout
    quickMatchTimeoutRef.current = setTimeout(() => {
      setQuickMatchTimedOut(true);
    }, 60000);
  }, [userId]);

  // Auto-navigate into game 2 seconds after match found
  useEffect(() => {
    if (!matched) return;
    matchedCountdownRef.current = setTimeout(() => {
      const m = matched;
      const uid = userIdRef.current;
      if (quickMatchTimeoutRef.current) { clearTimeout(quickMatchTimeoutRef.current); quickMatchTimeoutRef.current = null; }
      if (poolChannelRef.current) supabase.removeChannel(poolChannelRef.current);
      poolChannelRef.current = null;
      if (quickMatchChannelRef.current) supabase.removeChannel(quickMatchChannelRef.current);
      quickMatchChannelRef.current = null;
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
      // Update matchmaking status
      if (uid) supabase.from('matchmaking').update({ status: 'in_game' }).eq('player_id', uid);
      setQuickMatching(false);
      setMatched(null);
      setPoolCount(0);
      setQuickMatchTimedOut(false);
      onEnterGameRef.current(m.gameId, m.color, m.opponentUsername);
    }, 2000);
    return () => {
      if (matchedCountdownRef.current) { clearTimeout(matchedCountdownRef.current); matchedCountdownRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched]);

  const handleCancelQuickMatch = useCallback(async () => {
    if (quickMatchTimeoutRef.current) { clearTimeout(quickMatchTimeoutRef.current); quickMatchTimeoutRef.current = null; }
    if (matchedCountdownRef.current) { clearTimeout(matchedCountdownRef.current); matchedCountdownRef.current = null; }
    if (poolChannelRef.current) supabase.removeChannel(poolChannelRef.current);
    poolChannelRef.current = null;
    if (quickMatchChannelRef.current) supabase.removeChannel(quickMatchChannelRef.current);
    quickMatchChannelRef.current = null;
    if (userId) await supabase.from('matchmaking').delete().eq('player_id', userId);
    setQuickMatching(false);
    setMatched(null);
    setPoolCount(0);
    setQuickMatchTimedOut(false);
  }, [userId]);

  const handleRetryMatch = useCallback(async () => {
    if (!userId) return;
    setQuickMatchTimedOut(false);
    // Update last_seen so cleanup doesn't drop us
    await supabase.rpc('touch_profile', { p_id: userId });
    await supabase.rpc('try_match');
    if (quickMatchTimeoutRef.current) { clearTimeout(quickMatchTimeoutRef.current); }
    quickMatchTimeoutRef.current = setTimeout(() => {
      setQuickMatchTimedOut(true);
    }, 60000);
  }, [userId]);

  const handleStartMatch = useCallback(() => {
    if (!matched) return;
    const uid = userIdRef.current;
    if (quickMatchTimeoutRef.current) { clearTimeout(quickMatchTimeoutRef.current); quickMatchTimeoutRef.current = null; }
    if (matchedCountdownRef.current) { clearTimeout(matchedCountdownRef.current); matchedCountdownRef.current = null; }
    if (poolChannelRef.current) supabase.removeChannel(poolChannelRef.current);
    poolChannelRef.current = null;
    if (quickMatchChannelRef.current) supabase.removeChannel(quickMatchChannelRef.current);
    quickMatchChannelRef.current = null;
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    // Update matchmaking status
    if (uid) supabase.from('matchmaking').update({ status: 'in_game' }).eq('player_id', uid);
    setQuickMatching(false);
    setMatched(null);
    setPoolCount(0);
    setQuickMatchTimedOut(false);
    onEnterGameRef.current(matched.gameId, matched.color, matched.opponentUsername);
  }, [matched]);

  const localUsername = localStorage.getItem(LS_USERNAME);
  const displayName = profile?.username || localUsername || 'Player';

  // ---- Username Setup ----
  if (needUsername) {
    return (
      <div className="page-root"><div className="page-overlay" />
        <div className="page-panel" style={{ maxWidth: 480 }}>
          <h1 className="page-title">Welcome</h1>
          <p className="on-welcome">Choose your online username</p>

          <div className="setup-field">
            <label className="setup-label">Username</label>
            <input
              className="lan-input"
              placeholder="Enter username"
              value={usernameInput}
              onChange={e => { setUsernameInput(e.target.value); setUsernameError(''); }}
              maxLength={20}
              autoFocus
            />
            {usernameError && <p className="on-err">{usernameError}</p>}
            <p className="setup-hint">Letters, numbers and underscores. 2\u201320 characters.</p>
          </div>

          <div className="set-actions" style={{ flexDirection: 'column', gap: 8, marginTop: 16 }}>
            <button className="set-btn" onClick={handleSaveUsername} disabled={savingUsername || usernameInput.trim().length < 2} style={{ width: '100%' }}>
              {savingUsername ? 'Saving\u2026' : 'Confirm'}
            </button>
            <button className="set-btn" onClick={onBack} style={{ width: '100%', background: 'linear-gradient(180deg, #3a3024, #1e1810)', borderColor: 'rgba(201,165,90,0.4)' }}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Loading ----
  if (phase === 'loading') {
    return (
      <div className="page-root"><div className="page-overlay" />
        <div className="page-panel" style={{ maxWidth: 400, textAlign: 'center' }}>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>Connecting\u2026</p>
        </div>
      </div>
    );
  }

  // ---- Auth Choice ----
  if (!userId && phase === 'choose') {
    return (
      <div className="page-root"><div className="page-overlay" />
        <div className="page-panel" style={{ maxWidth: 480 }}>
          <h1 className="page-title" style={{ fontSize: 28, marginBottom: 16 }}>Play Online</h1>
          <div className="page-divider" style={{ marginBottom: 20 }}>&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500; &#x25C7; &#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;</div>

          <div className="set-actions" style={{ flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            <button className="set-btn" onClick={handleGuestSignIn} disabled={authBusy} style={{ width: '100%' }}>
              {authBusy ? 'Connecting\u2026' : 'Play as Guest'}
            </button>
          </div>

          <div className="setup-section">
            <div className="on-divider"><span>or sign in</span></div>
          </div>

          <button className="set-btn" onClick={handleGoogleSignIn} disabled={authBusy} style={{ width: '100%', marginBottom: 14 }}>
            <svg width="18" height="18" viewBox="0 0 48 48" style={{ marginRight: 8, verticalAlign: 'middle' }}>
              <path fill="#FFC107" d="M43.6 20H24v8.5h11.3c-1.5 4.3-5.5 7-11.3 7A12.8 12.8 0 0 1 11 24a12.8 12.8 0 0 1 13-12.8c3.5 0 6.7 1.3 9.1 3.4L39.5 8C35.2 4.3 29.9 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 20.5-8 20.5-22 0-1.5-.1-2.7-.4-4z"/>
              <path fill="#FF3D00" d="M4.4 14.4l7.9 5.8A13 13 0 0 1 24 11.2c3.5 0 6.7 1.3 9.1 3.4l7.5-7.5C35.2 4.3 29.9 2 24 2 15.1 2 7.5 7 4.4 14.4z"/>
              <path fill="#4CAF50" d="M24 44c5.9 0 11.2-2 15.3-5.4l-7.2-6.1c-2.1 1.6-4.9 2.7-8.1 2.7-5.8 0-10.8-3.9-12.6-9.2l-8.1 6.2C6.8 38.8 14.4 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20H24v8.5h11.3c-.7 2-2 3.7-3.7 4.9l7.2 6.1c4.8-4.4 7.8-10.8 7.8-18.5 0-1.5-.1-2.7-.4-4z"/>
            </svg>
            Continue with Google
          </button>

          {authError && <p className="on-err" style={{ textAlign: 'center', marginBottom: 10 }}>{authError}</p>}

          <div className="setup-section">
            <div className="setup-options" style={{ marginBottom: 12 }}>
              <button className={`setup-opt ${authMode === 'signin' ? 'on' : ''}`}
                onClick={() => { setAuthMode('signin'); setAuthError(''); }}
                style={{ flex: 1, textAlign: 'center' }}>
                Sign In
              </button>
              <button className={`setup-opt ${authMode === 'signup' ? 'on' : ''}`}
                onClick={() => { setAuthMode('signup'); setAuthError(''); }}
                style={{ flex: 1, textAlign: 'center' }}>
                Create Account
              </button>
            </div>

            {authMode === 'signin' ? (
              <div>
                <div className="setup-field">
                  <label className="setup-label">Email or Username</label>
                  <input className="lan-input" type="text" placeholder="Enter your email or username"
                    value={loginIdentifier}
                    onChange={e => { setLoginIdentifier(e.target.value); setAuthError(''); }}
                    autoFocus />
                </div>
                <div className="setup-field">
                  <label className="setup-label">Password</label>
                  <input className="lan-input" type="password" placeholder="Enter your password"
                    value={loginPassword}
                    onChange={e => { setLoginPassword(e.target.value); setAuthError(''); }} />
                </div>
                <button className="set-btn" onClick={handleSignIn} disabled={authBusy} style={{ width: '100%', marginTop: 4 }}>
                  {authBusy ? 'Signing in\u2026' : 'Sign In'}
                </button>
              </div>
            ) : (
              <div>
                <div className="setup-field">
                  <label className="setup-label">Username</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="lan-input" type="text" placeholder="Choose a username"
                      value={signupUsername}
                      onChange={e => { setSignupUsername(e.target.value); setAuthError(''); setSignupUsernameAvailable(null); }}
                      maxLength={20}
                      autoFocus
                      style={{ flex: 1 }} />
                    <button className="pg-btn" onClick={async () => {
                      const name = randomUsername();
                      setSignupUsername(name);
                      setSignupUsernameAvailable(null);
                      checkUsernameAvailable(name);
                    }} style={{ whiteSpace: 'nowrap', fontSize: 12, height: 46, alignSelf: 'flex-end' }}>
                      Generate
                    </button>
                  </div>
                  {signupUsername.trim().length >= 2 && (
                    <p className="setup-hint" style={{ marginTop: 4 }}>
                      {signupUsernameChecking ? 'Searching\u2026' : signupUsernameAvailable === true ? 'Available' : 'The username is taken'}
                    </p>
                  )}
                  <p className="setup-hint" style={{ marginTop: signupUsername.trim().length >= 2 ? 2 : 4 }}>
                    Letters, numbers and underscores. 2\u201320 characters.
                  </p>
                </div>

                <div className="setup-field">
                  <label className="setup-label">Email</label>
                  <input className="lan-input" type="email" placeholder="Enter your email"
                    value={signupEmail}
                    onChange={e => { setSignupEmail(e.target.value); setAuthError(''); }} />
                </div>

                <div className="setup-field">
                  <label className="setup-label">Password</label>
                  <input className="lan-input" type="password" placeholder="Create a password (6+ characters)"
                    value={signupPassword}
                    onChange={e => { setSignupPassword(e.target.value); setAuthError(''); }} />
                </div>

                <button className="set-btn" onClick={handleSignUp} disabled={authBusy || signupUsernameAvailable === false} style={{ width: '100%', marginTop: 4 }}>
                  {authBusy ? 'Creating\u2026' : 'Create Account'}
                </button>
              </div>
            )}
          </div>

          <div className="set-actions" style={{ marginTop: 12 }}>
            <button className="set-btn" onClick={onBack} style={{ background: 'linear-gradient(180deg, #3a3024, #1e1810)', borderColor: 'rgba(201,165,90,0.4)' }}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Lobby Room ----
  if (view === 'room' && currentLobby) {
    const isHost = currentLobby.host_player_id === userId;
    const shareUrl = currentLobby.share_token ? `${window.location.origin}/#online?join=${currentLobby.share_token}` : '';
    const handleCopyLink = () => {
      navigator.clipboard.writeText(shareUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
    };
    return (
      <div className="page-root"><div className="page-overlay" />
        <div className="page-panel" style={{ maxWidth: 500 }}>
          <h1 className="page-title" style={{ fontSize: 28 }}>Lobby</h1>
          <div className="page-divider" style={{ marginBottom: 20 }}>&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500; &#x25C7; &#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;</div>

          <div className="lan-status-bar" style={{ marginBottom: 16 }}>
            <span className="lan-nickname">{displayName}</span>
            <span className="lan-connected">Code: <strong style={{ color: '#fff', letterSpacing: 2 }}>{currentLobby.code}</strong></span>
            <button className="pg-btn" onClick={handleLeaveLobby}>Leave</button>
          </div>

          {statusMsg && <p className="lan-status-msg">{statusMsg}</p>}

          {shareUrl && (
            <div className="setup-section">
              <label className="setup-label">Invite Link</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="lan-input" readOnly value={shareUrl}
                  onClick={e => (e.target as HTMLInputElement).select()}
                  style={{ flex: 1, fontSize: 12, letterSpacing: 0 }} />
                <button className="pg-btn" onClick={handleCopyLink} style={{ whiteSpace: 'nowrap', minWidth: 70 }}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="setup-hint">Share this link for direct join (expires in 1 hour if unused)</p>
            </div>
          )}

          <div className="setup-section">
            <label className="setup-label">Players ({lobbyPlayers.length}/2)</label>
            <div className="lan-player-list">
              {lobbyPlayers.map(p => (
                <div key={p.id} className="lan-player-row">
                  <span className="lan-player-name">
                    {p.username}{p.player_id === userId ? ' (You)' : ''}
                  </span>
                  <span className="lan-player-streak">
                    {p.streak && p.streak > 0 ? `\uD83D\uDD25 ${p.streak}` : p.streak && p.streak < 0 ? `\u2744\uFE0F ${Math.abs(p.streak)}` : ''}
                  </span>
                  {p.player_id === currentLobby.host_player_id && (
                    <span className="lan-pending" style={{ color: '#ffd54f' }}>Host</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {isHost && (
            <div className="setup-section">
              <label className="setup-label">Your Color</label>
              <div className="setup-options">
                <button className={`setup-opt ${hostColor === 'red' ? 'on' : ''}`} onClick={() => setHostColor('red')}>
                  <span className="setup-swatch red" /> Red
                </button>
                <button className={`setup-opt ${hostColor === 'black' ? 'on' : ''}`} onClick={() => setHostColor('black')}>
                  <span className="setup-swatch black" /> Black
                </button>
              </div>
            </div>
          )}

          {isHost && (
            <div className="set-actions" style={{ flexDirection: 'column', gap: 8 }}>
              <button className="set-btn" onClick={handleStartGame} style={{ width: '100%', fontSize: 14 }}>
                {lobbyPlayers.length < 2 ? 'Waiting for opponent\u2026' : 'Start Game'}
              </button>
              <button className="set-btn" onClick={handleLeaveLobby} style={{ width: '100%', background: 'linear-gradient(180deg, #3a3024, #1e1810)', borderColor: 'rgba(201,165,90,0.4)' }}>
                Cancel Lobby
              </button>
            </div>
          )}

          {!isHost && (
            <div className="set-actions">
              <button className="set-btn" onClick={handleLeaveLobby} style={{ width: '100%', background: 'linear-gradient(180deg, #3a3024, #1e1810)', borderColor: 'rgba(201,165,90,0.4)' }}>
                Leave Lobby
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- Join Lobby Form ----
  if (view === 'join') {
    return (
      <div className="page-root"><div className="page-overlay" />
        <div className="page-panel" style={{ maxWidth: 480 }}>
          <h1 className="page-title" style={{ fontSize: 28 }}>Join Lobby</h1>
          <div className="page-divider" style={{ marginBottom: 20 }}>&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500; &#x25C7; &#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;</div>
          <div className="setup-section">
            <label className="setup-label">Lobby Code</label>
            <input
              className="lan-input"
              placeholder="Enter 6-character code"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
              style={{ textTransform: 'uppercase', letterSpacing: 3, fontWeight: 700 }}
            />
          </div>
          <div className="setup-section">
            <label className="setup-label">Password</label>
            <input
              className="lan-input"
              type="password"
              placeholder="Leave empty if none"
              value={joinPassword}
              onChange={e => setJoinPassword(e.target.value)}
            />
          </div>
          {statusMsg && <p className="lan-status-msg" style={{ color: '#ef5350' }}>{statusMsg}</p>}
          <div className="set-actions" style={{ flexDirection: 'column', gap: 8, marginTop: 16 }}>
            <button className="set-btn" onClick={handleJoinLobby} disabled={joining || joinCode.length < 6} style={{ width: '100%' }}>
              {joining ? 'Joining\u2026' : 'Join'}
            </button>
            <button className="set-btn" onClick={() => { setView('menu'); setJoinCode(''); setJoinPassword(''); setStatusMsg(''); }}
              style={{ width: '100%', background: 'linear-gradient(180deg, #3a3024, #1e1810)', borderColor: 'rgba(201,165,90,0.4)' }}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Create Lobby Form ----
  if (view === 'create') {
    return (
      <div className="page-root"><div className="page-overlay" />
        <div className="page-panel" style={{ maxWidth: 480 }}>
          <h1 className="page-title" style={{ fontSize: 28 }}>Create Lobby</h1>
          <div className="page-divider" style={{ marginBottom: 20 }}>&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500; &#x25C7; &#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;</div>
          <div className="setup-section">
            <label className="setup-label">Password (optional)</label>
            <input
              className="lan-input"
              type="password"
              placeholder="Leave empty for open lobby"
              value={createPassword}
              onChange={e => setCreatePassword(e.target.value)}
            />
            <p className="setup-hint">
              {createPassword ? 'Players need this password to join' : 'Anyone can join without a password'}
            </p>
          </div>
          {statusMsg && <p className="lan-status-msg">{statusMsg}</p>}
          <div className="set-actions" style={{ flexDirection: 'column', gap: 8, marginTop: 16 }}>
            <button className="set-btn" onClick={handleCreateLobby} disabled={creating} style={{ width: '100%' }}>
              {creating ? 'Creating\u2026' : 'Create Lobby'}
            </button>
            <button className="set-btn" onClick={() => { setView('menu'); setCreatePassword(''); setStatusMsg(''); }}
              style={{ width: '100%', background: 'linear-gradient(180deg, #3a3024, #1e1810)', borderColor: 'rgba(201,165,90,0.4)' }}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Quick Match ----
  if (quickMatching) {
    return (
      <div className="page-root"><div className="page-overlay" />
        <div className="page-panel" style={{ maxWidth: 480, textAlign: 'center' }}>
          <h1 className="page-title" style={{ fontSize: 28, marginBottom: 24 }}>Quick Match</h1>

          {matched ? (
            <>
              <div className="qm-found-icon">&#10003;</div>
              <p className="qm-found-text">MATCH FOUND</p>
              <p className="qm-opponent">vs <strong>{matched.opponentUsername}</strong></p>
              <div className="qm-opponent-stats" style={{ display: 'flex', gap: 20, justifyContent: 'center', margin: '8px 0' }}>
                <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>XP: <strong style={{ color: '#ffd54f' }}>{matched.opponentXp}</strong></span>
                <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>Wins: <strong style={{ color: '#66bb6a' }}>{matched.opponentWins}</strong></span>
              </div>
              <p className="qm-color">You play as <strong>{matched.color === 'red' ? 'Red' : 'Black'}</strong></p>
              <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, marginTop: 8 }}>Starting in 2 seconds\u2026</p>

              <div className="set-actions" style={{ flexDirection: 'column', gap: 8, marginTop: 24 }}>
                <button className="set-btn" onClick={handleStartMatch} style={{ width: '100%' }}>
                  Start Match
                </button>
                <button className="set-btn" onClick={handleCancelQuickMatch} style={{ width: '100%', background: 'linear-gradient(180deg, #3a3024, #1e1810)', borderColor: 'rgba(201,165,90,0.4)' }}>
                  Cancel
                </button>
              </div>
            </>
          ) : quickMatchTimedOut ? (
            <>
              <div className="qm-found-icon" style={{ fontSize: 32, color: '#ffd54f' }}>&#9888;</div>
              <p className="qm-found-text" style={{ color: '#ffd54f' }}>No opponent found</p>
              <p className="qm-color" style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>No one joined the pool in the last minute</p>

              <div className="set-actions" style={{ flexDirection: 'column', gap: 8, marginTop: 24 }}>
                <button className="set-btn" onClick={handleRetryMatch} style={{ width: '100%' }}>
                  Try Again
                </button>
                <button className="set-btn" onClick={handleCancelQuickMatch} style={{ width: '100%', background: 'linear-gradient(180deg, #3a3024, #1e1810)', borderColor: 'rgba(201,165,90,0.4)' }}>
                  Back
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="qm-spinner">
                <div className="qm-ring" />
              </div>
              <p className="qm-searching">Searching for opponent\u2026</p>

              <div className="qm-pool">
                <span className="qm-pool-num">{poolCount}</span>
                <span className="qm-pool-lbl">player{poolCount !== 1 ? 's' : ''} in pool</span>
              </div>

              <div className="set-actions" style={{ marginTop: 24 }}>
                <button className="set-btn" onClick={handleCancelQuickMatch} style={{ width: '100%', background: 'linear-gradient(180deg, #3a3024, #1e1810)', borderColor: 'rgba(201,165,90,0.4)' }}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ---- Main Lobby Menu ----
  return (
    <div className="page-root"><div className="page-overlay" />
      <div className="page-panel" style={{ maxWidth: 520 }}>
        <h1 className="page-title" style={{ fontSize: 28 }}>Online</h1>
        <div className="page-divider" style={{ marginBottom: 20 }}>&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500; &#x25C7; &#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;</div>

        <div className="lan-status-bar" style={{ marginBottom: 16 }}>
          <span className="lan-nickname">{displayName}</span>
          <span className={`lan-connected ${isOnline ? '' : 'lan-offline'}`}>{isOnline ? 'Online' : 'Offline'}</span>
          <button className="pg-btn" onClick={onBack}>Back</button>
        </div>

        {!isOnline && (
          <div className="lan-offline-banner">
            Connect to the internet to play online
          </div>
        )}

        {profile && (
          <div className="on-stats" style={{ marginBottom: 16 }}>
            <div className="on-stat"><span className="on-stat-val">{profile.games_played}</span><span className="on-stat-lbl">Played</span></div>
            <div className="on-stat"><span className="on-stat-val">{profile.wins}</span><span className="on-stat-lbl">Wins</span></div>
            <div className="on-stat"><span className="on-stat-val">{profile.games_played - profile.wins}</span><span className="on-stat-lbl">Losses</span></div>
            <div className="on-stat"><span className="on-stat-val">{profile.xp}</span><span className="on-stat-lbl">XP</span></div>
          </div>
        )}

        {statusMsg && <p className="lan-status-msg">{statusMsg}</p>}

        <div className="set-actions" style={{ flexDirection: 'column', gap: 8, maxWidth: 300, margin: '0 auto 16px' }}>
          <button className="set-btn" onClick={handleQuickMatch} disabled={!isOnline} style={{ background: 'linear-gradient(135deg,#7c4dff,#448aff)', borderColor: '#7c4dff', opacity: isOnline ? 1 : 0.4 }}>
            Quick Match
          </button>
          <button className="set-btn" onClick={() => setView('create')} disabled={!isOnline}
            style={{ background: 'linear-gradient(180deg, #3a3024, #1e1810)', borderColor: 'rgba(201,165,90,0.4)', opacity: isOnline ? 1 : 0.4 }}>
            Create Lobby
          </button>
          <button className="set-btn" onClick={() => setView('join')} disabled={!isOnline}
            style={{ background: 'linear-gradient(180deg, #3a3024, #1e1810)', borderColor: 'rgba(201,165,90,0.4)', opacity: isOnline ? 1 : 0.4 }}>
            Join Lobby
          </button>
        </div>

        <div className="set-actions" style={{ marginTop: 12 }}>
          <button className="set-btn" onClick={handleSignOut}
            style={{ fontSize: 12, minWidth: 140, height: 40, background: 'linear-gradient(180deg, #3a3024, #1e1810)', borderColor: 'rgba(201,165,90,0.3)' }}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
