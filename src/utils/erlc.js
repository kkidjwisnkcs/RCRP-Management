// erlc.js — ERLC API v2 (single endpoint, all data in one call)
  const axios = require('axios');

  const ERLC_BASE = 'https://api.policeroleplay.community/v2';

  let lastSnapshot     = null;
  let lastFetchTime    = 0;
  let lastError        = null;
  let consecutiveFails = 0;
  let backoffUntil     = 0;
  let invalidKeyMode   = false;

  function parsePlayer(p) {
    if (typeof p === 'string') {
      const parts = p.split(':');
      return { username: parts[0] || 'Unknown', userId: parts[1] || '0' };
    }
    return {
      username: p?.Name || p?.name || 'Unknown',
      userId:   String(p?.UserId || p?.userId || '0'),
    };
  }

  async function fetchAllData() {
    const apiKey = process.env.ERLC_API_KEY;
    if (!apiKey) {
      if (!invalidKeyMode) {
        invalidKeyMode = true;
        console.error('[ERLC] ❌ ERLC_API_KEY is not set.');
      }
      return lastSnapshot;
    }
    if (Date.now() < backoffUntil) return lastSnapshot;

    const headers = { 'Server-Key': apiKey };
    const timeout = 15000;
    const params  = 'Players=true&Staff=true&JoinLogs=true&KillLogs=true&CommandLogs=true&ModCalls=true&EmergencyCalls=true&Vehicles=true&Queue=true';

    try {
      const res = await axios.get(`${ERLC_BASE}/server?${params}`, { headers, timeout });
      const d   = res.data;

      const rawPlayers  = Array.isArray(d.Players)  ? d.Players  : [];
      const rawVehicles = Array.isArray(d.Vehicles) ? d.Vehicles : [];

      // Build username → vehicle map (v2: Owner is a username string)
      const vehByOwner = {};
      for (const v of rawVehicles) {
        if (v.Owner) vehByOwner[v.Owner.toLowerCase()] = v;
      }

      const enriched = rawPlayers.map(p => {
        const { username, userId } = parsePlayer(p.Player || p);
        const v = vehByOwner[username.toLowerCase()];
        return {
          ...p,
          _username:    username,
          _userId:      userId,
          _team:        p.Team       || 'Civilian',
          _permission:  p.Permission || 'Normal',
          _callsign:    p.Callsign   || null,
          _wantedStars: p.WantedStars || 0,
          _location:    p.Location   || null,
          _vehicle:     v?.Name      || null,
          _vehiclePlate: v?.Plate    || null,
          _vehicleColor: v ? `${v.ColorName || ''} (${v.ColorHex || ''})`.trim() : null,
          _vehicleTexture: v?.Texture || null,
        };
      });

      consecutiveFails = 0;
      lastError        = null;
      invalidKeyMode   = false;
      backoffUntil     = 0;

      lastSnapshot = {
        fetchedAt:      new Date().toISOString(),
        _stale:         false,
        _offline:       false,
        server:         { Name: d.Name, OwnerId: d.OwnerId, CurrentPlayers: d.CurrentPlayers, MaxPlayers: d.MaxPlayers, JoinKey: d.JoinKey, TeamBalance: d.TeamBalance },
        players:        enriched,
        vehicles:       rawVehicles,
        staff:          d.Staff || {},
        joinLogs:       Array.isArray(d.JoinLogs)       ? d.JoinLogs       : [],
        killLogs:       Array.isArray(d.KillLogs)       ? d.KillLogs       : [],
        commandLogs:    Array.isArray(d.CommandLogs)    ? d.CommandLogs    : [],
        modCalls:       Array.isArray(d.ModCalls)       ? d.ModCalls       : [],
        emergencyCalls: Array.isArray(d.EmergencyCalls) ? d.EmergencyCalls : [],
        queue:          Array.isArray(d.Queue)          ? d.Queue          : [],
        bans:           [],  // v2 has no bans endpoint yet — kept for compat
      };
      lastFetchTime = Date.now();
      console.log(`[ERLC] ✅ ${enriched.length} players | ${rawVehicles.length} vehicles | ${lastSnapshot.emergencyCalls.length} 911 calls`);
      return lastSnapshot;

    } catch (err) {
      const code = err.response?.status;
      const body = err.response?.data;

      if (code === 403 && body?.code === 2002) {
        consecutiveFails++;
        lastError      = '❌ Invalid ERLC Server Key (code 2002). Fix ERLC_API_KEY in Railway.';
        invalidKeyMode = true;
        const ms       = consecutiveFails <= 3 ? 5 * 60_000 : 10 * 60_000;
        backoffUntil   = Date.now() + ms;
        if (consecutiveFails === 1) console.error('[ERLC] ❌ INVALID SERVER KEY — code 2002. Fix ERLC_API_KEY in Railway.');
        return lastSnapshot;
      }

      if (code === 404) {
        lastSnapshot = { ...(lastSnapshot || {}), fetchedAt: new Date().toISOString(), _offline: true, players: [], vehicles: [], emergencyCalls: [], modCalls: [] };
        lastFetchTime = Date.now();
        return lastSnapshot;
      }

      consecutiveFails++;
      lastError    = `${code || 'ERR'}: ${err.message}`;
      backoffUntil = Date.now() + Math.min(consecutiveFails * 30_000, 5 * 60_000);
      lastSnapshot = lastSnapshot ? { ...lastSnapshot, _stale: true } : null;
      console.error(`[ERLC] ❌ ${code}: ${err.message} (fail #${consecutiveFails})`);
      return lastSnapshot;
    }
  }

  async function sendCommand(command) {
    const apiKey = process.env.ERLC_API_KEY;
    if (!apiKey) return { ok: false, error: 'No API key set' };
    try {
      await axios.post(`${ERLC_BASE}/server/command`, { command }, { headers: { 'Server-Key': apiKey }, timeout: 10000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.response?.data?.message || err.message };
    }
  }

  async function testConnection() {
    console.log('[ERLC] Running startup API test...');
    const apiKey = process.env.ERLC_API_KEY;
    if (!apiKey) { console.error('[ERLC] ❌ ERLC_API_KEY not set.'); return { ok: false, error: 'not set' }; }
    try {
      const r = await axios.get(`${ERLC_BASE}/server`, { headers: { 'Server-Key': apiKey }, timeout: 10000 });
      console.log(`[ERLC] ✅ Connected — ${r.data?.Name || 'OK'}`);
      return { ok: true, data: r.data };
    } catch (err) {
      console.error(`[ERLC] ❌ ${err.response?.status}: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  const getCachedSnapshot  = () => lastSnapshot;
  const getCacheAge        = () => (lastFetchTime ? Math.floor((Date.now() - lastFetchTime) / 1000) : -1);
  const getLastError       = () => lastError;
  const getConsecFails     = () => consecutiveFails;
  const isInvalidKeyMode   = () => invalidKeyMode;

  const findPlayerByName = u => {
    if (!lastSnapshot?.players) return null;
    const lo = u.toLowerCase();
    return lastSnapshot.players.find(p => p._username.toLowerCase() === lo) || null;
  };
  const findPlayerById = id => {
    if (!lastSnapshot?.players) return null;
    return lastSnapshot.players.find(p => p._userId === String(id)) || null;
  };
  const getPlayersByTeam = t => {
    if (!lastSnapshot?.players) return [];
    return lastSnapshot.players.filter(p => p._team?.toLowerCase() === t.toLowerCase());
  };

  module.exports = {
    fetchAllData, sendCommand, testConnection,
    getCachedSnapshot, getCacheAge, getLastError, getConsecFails, isInvalidKeyMode,
    findPlayerByName, findPlayerById, getPlayersByTeam, parsePlayer,
  };
  