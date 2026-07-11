-- ============================================================
-- Chekaz Online – Supabase Schema (idempotent)
-- Safe to run multiple times – uses IF NOT EXISTS / OR REPLACE
-- ============================================================

-- 1. Profiles
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_seen TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view profiles" ON profiles;
CREATE POLICY "Anyone can view profiles"
  ON profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- Add stats columns if upgrading from an older schema
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS games_played INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wins INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country TEXT;
CREATE INDEX IF NOT EXISTS profiles_email_idx ON profiles(email);

-- 2. Lobbies
CREATE TABLE IF NOT EXISTS lobbies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  host_player_id UUID REFERENCES profiles(id) NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','playing','finished','cancelled')),
  is_protected BOOLEAN DEFAULT false,
  password TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add share-link columns in case table already existed
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE;
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ;

ALTER TABLE lobbies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view lobbies" ON lobbies;
CREATE POLICY "Anyone can view lobbies"
  ON lobbies FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert lobbies" ON lobbies;
CREATE POLICY "Authenticated users can insert lobbies"
  ON lobbies FOR INSERT WITH CHECK (auth.uid() = host_player_id);

-- 3. Lobby Players
CREATE TABLE IF NOT EXISTS lobby_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id UUID REFERENCES lobbies(id) ON DELETE CASCADE NOT NULL,
  player_id UUID REFERENCES profiles(id) NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(lobby_id, player_id)
);

-- Add streak columns in case table already existed
ALTER TABLE lobby_players ADD COLUMN IF NOT EXISTS wins INTEGER DEFAULT 0;
ALTER TABLE lobby_players ADD COLUMN IF NOT EXISTS losses INTEGER DEFAULT 0;
ALTER TABLE lobby_players ADD COLUMN IF NOT EXISTS streak INTEGER DEFAULT 0;
ALTER TABLE lobby_players ADD COLUMN IF NOT EXISTS best_win_streak INTEGER DEFAULT 0;
ALTER TABLE lobby_players ADD COLUMN IF NOT EXISTS best_loss_streak INTEGER DEFAULT 0;

ALTER TABLE lobby_players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view lobby players" ON lobby_players;
CREATE POLICY "Anyone can view lobby players"
  ON lobby_players FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can join lobbies" ON lobby_players;
CREATE POLICY "Authenticated users can join lobbies"
  ON lobby_players FOR INSERT WITH CHECK (auth.uid() = player_id);

DROP POLICY IF EXISTS "Players can leave lobbies" ON lobby_players;
CREATE POLICY "Players can leave lobbies"
  ON lobby_players FOR DELETE USING (auth.uid() = player_id);

-- 3b. Lobbies policy that depends on lobby_players (created after lobby_players exists)
DROP POLICY IF EXISTS "Authenticated users can update lobbies" ON lobbies;
CREATE POLICY "Authenticated users can update lobbies"
  ON lobbies FOR UPDATE
  USING (auth.uid() = host_player_id OR auth.uid() IN (
    SELECT player_id FROM lobby_players WHERE lobby_id = id
  ));

-- 4. Games
CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id UUID REFERENCES lobbies(id),
  red_player_id UUID REFERENCES profiles(id) NOT NULL,
  black_player_id UUID REFERENCES profiles(id) NOT NULL,
  winner_id UUID REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','finished','cancelled')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add lobby_id column if upgrading from an older schema
ALTER TABLE games ADD COLUMN IF NOT EXISTS lobby_id UUID REFERENCES lobbies(id);

ALTER TABLE games ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view games" ON games;
CREATE POLICY "Anyone can view games"
  ON games FOR SELECT USING (true);

DROP POLICY IF EXISTS "Players can insert games" ON games;
CREATE POLICY "Players can insert games"
  ON games FOR INSERT WITH CHECK (auth.uid() = red_player_id OR auth.uid() = black_player_id);

DROP POLICY IF EXISTS "Players can update their games" ON games;
CREATE POLICY "Players can update their games"
  ON games FOR UPDATE
  USING (auth.uid() = red_player_id OR auth.uid() = black_player_id);

-- 5. Moves
CREATE TABLE IF NOT EXISTS moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
  player_id UUID REFERENCES profiles(id) NOT NULL,
  move_data JSONB NOT NULL,
  move_number INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE moves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view moves" ON moves;
CREATE POLICY "Anyone can view moves"
  ON moves FOR SELECT USING (true);

DROP POLICY IF EXISTS "Players can insert moves" ON moves;
CREATE POLICY "Players can insert moves"
  ON moves FOR INSERT WITH CHECK (auth.uid() = player_id);

-- Indexes (IF NOT EXISTS avoids duplicate errors)
CREATE INDEX IF NOT EXISTS moves_game_id_idx ON moves(game_id);
CREATE INDEX IF NOT EXISTS moves_game_id_move_number_idx ON moves(game_id, move_number);

-- 6. Trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop & recreate triggers so they can be re-run
DROP TRIGGER IF EXISTS update_games_updated_at ON games;
CREATE TRIGGER update_games_updated_at
  BEFORE UPDATE ON games
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_lobbies_updated_at ON lobbies;
CREATE TRIGGER update_lobbies_updated_at
  BEFORE UPDATE ON lobbies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 7a. RPC: increment profile stats atomically
CREATE OR REPLACE FUNCTION increment_profile_stats(
  player_id UUID,
  inc_games INTEGER DEFAULT 1,
  inc_wins INTEGER DEFAULT 0,
  inc_xp INTEGER DEFAULT 0
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
  SET
    games_played = games_played + inc_games,
    wins = wins + inc_wins,
    xp = xp + inc_xp
  WHERE id = player_id;
END;
$$;

-- 7b. RPC: update lobby streak stats for winner and loser
CREATE OR REPLACE FUNCTION update_lobby_streaks(
  p_lobby_id UUID,
  p_winner_id UUID,
  p_loser_id UUID
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  w_rec lobby_players%ROWTYPE;
  l_rec lobby_players%ROWTYPE;
BEGIN
  SELECT * INTO w_rec FROM lobby_players WHERE lobby_id = p_lobby_id AND player_id = p_winner_id;
  IF w_rec.id IS NOT NULL THEN
    IF w_rec.streak >= 0 THEN
      UPDATE lobby_players SET
        wins = wins + 1,
        streak = streak + 1,
        best_win_streak = GREATEST(best_win_streak, w_rec.streak + 1)
      WHERE id = w_rec.id;
    ELSE
      UPDATE lobby_players SET
        wins = wins + 1,
        streak = 1,
        best_win_streak = GREATEST(best_win_streak, 1)
      WHERE id = w_rec.id;
    END IF;
  END IF;

  SELECT * INTO l_rec FROM lobby_players WHERE lobby_id = p_lobby_id AND player_id = p_loser_id;
  IF l_rec.id IS NOT NULL THEN
    IF l_rec.streak <= 0 THEN
      UPDATE lobby_players SET
        losses = losses + 1,
        streak = streak - 1,
        best_loss_streak = GREATEST(best_loss_streak, ABS(l_rec.streak - 1))
      WHERE id = l_rec.id;
    ELSE
      UPDATE lobby_players SET
        losses = losses + 1,
        streak = -1,
        best_loss_streak = GREATEST(best_loss_streak, 1)
      WHERE id = l_rec.id;
    END IF;
  END IF;
END;
$$;

-- 8. Enable Realtime (safe to repeat – errors ignored if table already in publication)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE games;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE moves;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE lobbies;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE lobby_players;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- 9. Matchmaking pool
CREATE TABLE IF NOT EXISTS matchmaking (
  player_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  opponent_id UUID REFERENCES profiles(id),
  game_id UUID REFERENCES games(id),
  status TEXT DEFAULT 'searching'
    CHECK (status IN ('searching','matched','in_game','cancelled','offline')),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE matchmaking ENABLE ROW LEVEL SECURITY;

-- Add columns in case table already exists from prior run
ALTER TABLE matchmaking ADD COLUMN IF NOT EXISTS opponent_id UUID REFERENCES profiles(id);
ALTER TABLE matchmaking ADD COLUMN IF NOT EXISTS game_id UUID REFERENCES games(id);
ALTER TABLE matchmaking ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'searching';

DROP POLICY IF EXISTS "Anyone can view matchmaking" ON matchmaking;
CREATE POLICY "Anyone can view matchmaking"
  ON matchmaking FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert own matchmaking" ON matchmaking;
CREATE POLICY "Authenticated users can insert own matchmaking"
  ON matchmaking FOR INSERT WITH CHECK (auth.uid() = player_id);

DROP POLICY IF EXISTS "Players can delete own matchmaking" ON matchmaking;
CREATE POLICY "Players can delete own matchmaking"
  ON matchmaking FOR DELETE USING (auth.uid() = player_id);

DROP POLICY IF EXISTS "Players can update own matchmaking" ON matchmaking;
CREATE POLICY "Players can update own matchmaking"
  ON matchmaking FOR UPDATE USING (auth.uid() = player_id);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE matchmaking;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- 9b. Game presence tracking
CREATE TABLE IF NOT EXISTS game_presence (
  player_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
  last_seen TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE game_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view game_presence" ON game_presence;
CREATE POLICY "Anyone can view game_presence"
  ON game_presence FOR SELECT USING (true);

DROP POLICY IF EXISTS "Players can upsert own presence" ON game_presence;
CREATE POLICY "Players can upsert own presence"
  ON game_presence FOR INSERT WITH CHECK (auth.uid() = player_id);

DROP POLICY IF EXISTS "Players can update own presence" ON game_presence;
CREATE POLICY "Players can update own presence"
  ON game_presence FOR UPDATE USING (auth.uid() = player_id);

DROP POLICY IF EXISTS "Players can delete own presence" ON game_presence;
CREATE POLICY "Players can delete own presence"
  ON game_presence FOR DELETE USING (auth.uid() = player_id);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE game_presence;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- 9c. RPC: update last_seen on profile
CREATE OR REPLACE FUNCTION touch_profile(p_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles SET last_seen = now() WHERE id = p_id;
END;
$$;

-- 9d. RPC: cleanup stale matchmaking entries (runs every 60s via pg_cron or Edge Function)
CREATE OR REPLACE FUNCTION cleanup_matchmaking()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE matchmaking SET status = 'offline'
  WHERE status = 'searching'
    AND created_at < NOW() - INTERVAL '60 seconds'
    AND player_id IN (
      SELECT id FROM profiles WHERE last_seen IS NULL OR last_seen < NOW() - INTERVAL '60 seconds'
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  DELETE FROM matchmaking WHERE status = 'offline';
  RETURN v_count;
END;
$$;

-- Matchmaking RPC — atomically pairs two waiting players with duplicate-game prevention
CREATE OR REPLACE FUNCTION try_match()
RETURNS TABLE (p1_id UUID, p2_id UUID, game_id UUID)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_p1 UUID;
  v_p2 UUID;
  v_game_id UUID;
  v_red UUID;
  v_black UUID;
BEGIN
  -- Pick oldest searching player
  SELECT player_id INTO v_p1
  FROM matchmaking
  WHERE status = 'searching'
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_p1 IS NULL THEN RETURN; END IF;

  -- Pick second oldest searching player
  SELECT player_id INTO v_p2
  FROM matchmaking
  WHERE player_id != v_p1 AND status = 'searching'
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_p2 IS NULL THEN RETURN; END IF;

  -- Guard: ensure neither player is already in an active game
  IF EXISTS (
    SELECT 1 FROM games
    WHERE status = 'active'
      AND (red_player_id = v_p1 OR black_player_id = v_p1
        OR red_player_id = v_p2 OR black_player_id = v_p2)
  ) THEN
    -- Mark stale entries so they don't block the queue
    UPDATE matchmaking SET status = 'cancelled'
    WHERE player_id IN (v_p1, v_p2)
      AND EXISTS (
        SELECT 1 FROM games
        WHERE status = 'active'
          AND (red_player_id = matchmaking.player_id OR black_player_id = matchmaking.player_id)
      );
    RETURN;
  END IF;

  -- Assign colours randomly
  IF random() < 0.5 THEN v_red := v_p1; v_black := v_p2;
  ELSE v_red := v_p2; v_black := v_p1; END IF;

  -- Create game
  INSERT INTO games (red_player_id, black_player_id, status)
  VALUES (v_red, v_black, 'active')
  RETURNING id INTO v_game_id;

  -- Update both matchmaking rows atomically
  UPDATE matchmaking SET
    opponent_id = v_p2,
    game_id = v_game_id,
    status = 'matched'
  WHERE player_id = v_p1;

  UPDATE matchmaking SET
    opponent_id = v_p1,
    game_id = v_game_id,
    status = 'matched'
  WHERE player_id = v_p2;

  RETURN QUERY SELECT v_p1, v_p2, v_game_id;
END;
$$;

-- RPC: check if user has an active game
CREATE OR REPLACE FUNCTION check_active_game(p_player_id UUID)
RETURNS TABLE (game_id UUID, opponent_id UUID, opponent_name TEXT, player_color TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_game_id UUID;
  v_opponent_id UUID;
  v_player_color TEXT;
BEGIN
  SELECT g.id, CASE WHEN g.red_player_id = p_player_id THEN g.black_player_id ELSE g.red_player_id END,
         CASE WHEN g.red_player_id = p_player_id THEN 'red' ELSE 'black' END
  INTO v_game_id, v_opponent_id, v_player_color
  FROM games g
  WHERE g.status = 'active'
    AND (g.red_player_id = p_player_id OR g.black_player_id = p_player_id)
  LIMIT 1;

  IF v_game_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT v_game_id, v_opponent_id, p.username, v_player_color
  FROM profiles p
  WHERE p.id = v_opponent_id;
END;
$$;
