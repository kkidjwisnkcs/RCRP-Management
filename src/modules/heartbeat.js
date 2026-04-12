// heartbeat.js — ERLC Pulse Engine
// Polls ERLC every 20s, saves snapshots every 2min.
// Handles: ghost-clock, MDT mod calls, 911 emergency calls, shift cards,
//          wanted wall, crime ticker, map pinner, daily report tracking.

const config      = require('../config');
const erlc        = require('../utils/erlc');
const db          = require('../utils/discordDb');
const ai          = require('../utils/ai');
const embeds      = require('../utils/embeds');
const shiftCards  = require('./shiftCards');
const wantedWall  = require('./crimeTickerWall');
const crimeTicker = require('./crimeTicker');
const mapPinner   = require('./mapPinner');
const dailyReport = require('./dailyReport');

const sessionStore      = require('./sessionStore');
const pursuitTracker    = require('./pursuitTracker');
const staffAlerts       = require('./staffAlertSystem');
const serverBroadcast   = require('./serverBroadcast');
const activeShifts    = sessionStore.getActiveShifts();
const postedModCalls  = new Set();   // dedup keys for mod calls
const postedEmergency = new Set();   // dedup keys for 911 calls
const postedCmdLogs   = new Set();   // dedup keys for in-game command logs

let _client         = null;
let _running        = false;
let _seeded         = false;  // true after dedup sets are pre-seeded from latest snapshot
// Hard block: the very first pulse only seeds — it NEVER posts anything to MDT or logs.
// This is the final safety net against restart spam even if key formats change.
let _postingEnabled = false;
let _lastSaveTime   = 0;
let _mapPulse       = 0;

// ── Key builders — single source of truth for dedup keys ─────────────────────
// Seed and runtime MUST use the same function to guarantee matching.
function modCallKey(call) {
  return `mc:${call.Caller || ''}:${call.Message || call.CallMessage || ''}:${call.Timestamp || ''}`;
}
function emergencyKey(call) {
  return `em:${call.CallNumber || ''}:${call.StartedAt || ''}:${call.Caller || ''}`;
}
function cmdLogKey(log) {
  const staffName = log.Player?.Name || log.ExecutedBy || '';
  const rawCmd    = (log.Command || '').trim();
  // Normalise timestamp: both seed and runtime use epoch ms
  const ts = log.Timestamp ? String(new Date(log.Timestamp).getTime()) : '';
  return `cl:${staffName}:${rawCmd}:${ts}`;
}

function start(discordClient) {
  if (_running) return;
  _running = true;
  _client  = discordClient;
  crimeTicker.init(discordClient);
  wantedWall.init(discordClient);
  mapPinner.findExistingMessage(discordClient).catch(() => {});
  wantedWall.findExistingWantedWall(discordClient).catch(() => {});
  pursuitTracker.init(discordClient);
  staffAlerts.init(discordClient);
  serverBroadcast.init(discordClient);
  console.log('[Heartbeat] Started — polling every 20s, DB save every 2min.');
  setInterval(pulse, config.heartbeatInterval);
  pulse();
}

async function pulse() {
  try {
    const snapshot = await erlc.fetchAllData();
    if (!snapshot) return;

    const guild = _client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) return;

    // First pulse: seed dedup sets, then return WITHOUT posting anything.
    // This is the hard block against restart spam.
    if (!_seeded) {
      _seeded = true;
      console.log('[Heartbeat] First pulse — seeding dedup sets. No MDT posts this cycle.');
      seedFromLiveSnapshot(snapshot); // ← seeds live ERLC data before posting
      await seedDedupFromLatestSnapshot(guild).catch(e =>
        console.error('[Heartbeat] seedDedup error:', e.message)
      );
      _postingEnabled = true; // allow posting from 2nd pulse onwards
      return; // ← hard stop: nothing gets posted on restart
    }

    // Only post when the server is actually online and has players
    const playerCount = snapshot.players?.length || 0;
    const serverOnline = !snapshot._offline && !snapshot._stale;

    const now = Date.now();

    // DB Snapshot every 2min (always save regardless of player count)
    if (now - _lastSaveTime >= config.snapshotInterval) {
      await saveGameSnapshot(snapshot, guild);
      _lastSaveTime = now;
    }

    // Map pinner every 2min — only if there are players
    if (now - _mapPulse >= config.snapshotInterval) {
      _mapPulse = now;
      if (playerCount > 0 && serverOnline) {
        mapPinner.pulse(snapshot).catch(e => console.error('[Heartbeat] MapPinner:', e.message));
      }
    }

    dailyReport.track(snapshot);

    // If server is offline/empty, run shift card updates and wanted wall but skip MDT pings
    await Promise.allSettled([
      runGhostClock(snapshot, guild),
      runShiftCards(snapshot, guild),
      wantedWall.pulse(snapshot),
      // Only fire MDT alerts + crime ticker if the game server has actual players
      ...(serverOnline && playerCount > 0 ? [
        runMDTModCalls(snapshot, guild),
        runMDTEmergency(snapshot, guild),
        crimeTicker.pulse(snapshot),
        runCommandLogs(snapshot, guild),
        pursuitTracker.pulse(snapshot),
        staffAlerts.pulse(snapshot),
      ] : []),
    ]);
  } catch (err) {
    console.error('[Heartbeat] pulse error:', err.message);
  }
}

// ── Save game snapshot to Discord DB ──────────────────────
async function saveGameSnapshot(snapshot, guild) {
  try {
    const ch = _client.channels.cache.get(config.channels.gameDatabase);
    if (!ch) return;
    const payload = {
      _meta: { timestamp: snapshot.fetchedAt, playerCount: snapshot.players.length, stale: snapshot._stale || false },
      server:  snapshot.server,
      players: snapshot.players.map(p => ({
        username:      p._username,
        userId:        p._userId,
        team:          p._team,
        permission:    p._permission,
        callsign:      p._callsign,
        vehicle:       p._vehicle,
        vehiclePlate:  p._vehiclePlate,
        vehicleColor:  p._vehicleColor,
        wantedStars:   p._wantedStars,
        location:      p._location,
      })),
      killLogs:       snapshot.killLogs?.slice(-50)    || [],
      commandLogs:    snapshot.commandLogs?.slice(-50) || [],
      modCalls:       snapshot.modCalls                || [],
      emergencyCalls: snapshot.emergencyCalls          || [],
      joinLogs:       snapshot.joinLogs?.slice(-50)    || [],
    };
    await db.writeGameSnapshot(ch, payload);
    console.log('[Heartbeat] Snapshot saved — ' + snapshot.players.length + ' players');
  } catch (err) {
    console.error('[Heartbeat] saveGameSnapshot:', err.message);
  }
}

// ── Ghost-clock: track staff in-game shifts ───────────────
async function runGhostClock(snapshot, guild) {
  try {
    const verifyCh = _client.channels.cache.get(config.channels.verifyDatabase);
    if (!verifyCh) return;
    const { users } = await db.getVerifyDb(verifyCh);
    const inGameIds = new Set(snapshot.players.map(p => p._userId));
    const perms     = require('../utils/permissions');
    const { EmbedBuilder } = require('discord.js');

    for (const user of users.filter(u => u.status === 'active')) {
      const inGame  = inGameIds.has(user.robloxId);
      const tracked = sessionStore.isOnShift(user.robloxId);
      const member  = guild.members.cache.get(user.discordId);
      if (!member) continue;

      // Only treat as staff if they actually have a staff role
      const isActualStaff = perms.isStaff(member) || perms.isManagement(member);

      if (inGame && !tracked) {
        sessionStore.startShift(user.robloxId, user.discordId, user.robloxUsername);

        if (_postingEnabled && isActualStaff) {
          const logCh = _client.channels.cache.get(config.channels.logs);
          if (logCh) {
            const topRole = member.roles.cache
              .filter(r => r.id !== guild.id)
              .sort((a, b) => b.position - a.position)
              .first();
            await logCh.send({
              embeds: [new EmbedBuilder()
                .setColor(0x2D7D46)
                .setTitle('🟢 Staff On Duty')
                .setDescription('<@' + user.discordId + '> (**' + user.robloxUsername + '**) is now in Florida State.')
                .addFields(
                  { name: '👤 Discord', value: '<@' + user.discordId + '>', inline: true },
                  { name: '🎮 Roblox',  value: user.robloxUsername,         inline: true },
                  { name: '🏷️ Role',   value: topRole?.name || 'Staff',    inline: true },
                )
                .setFooter({ text: 'FSRP Shift Tracker — Session started' })
                .setTimestamp()]
            }).catch(() => {});
          }
        }

      } else if (!inGame && tracked) {
        const durationMin = await sessionStore.endShift(user.robloxId, _client);

        if (_postingEnabled && isActualStaff) {
          const logCh = _client.channels.cache.get(config.channels.logs);
          if (logCh) {
            await logCh.send({
              embeds: [new EmbedBuilder()
                .setColor(0x992D22)
                .setTitle('🔴 Staff Off Duty')
                .setDescription('<@' + user.discordId + '> (**' + user.robloxUsername + '**) left Florida State.')
                .addFields(
                  { name: '👤 Discord',  value: '<@' + user.discordId + '>', inline: true },
                  { name: '🎮 Roblox',   value: user.robloxUsername,          inline: true },
                  { name: '⏱️ Session', value: durationMin + 'm',             inline: true },
                )
                .setFooter({ text: 'FSRP Shift Tracker — Session saved to database' })
                .setTimestamp()]
            }).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    console.error('[Heartbeat] GhostClock:', err.message);
  }
}

// ── MDT: Mod calls → MDT channel ─────────────────────────
async function runMDTModCalls(snapshot, guild) {
  try {
    const modCalls = snapshot.modCalls || [];
    if (!modCalls.length) return;
    const mdtCh = _client.channels.cache.get(config.channels.mdt);
    if (!mdtCh) return;

    for (const call of modCalls) {
      const key = modCallKey(call);
      if (postedModCalls.has(key)) continue;
      postedModCalls.add(key);
      if (postedModCalls.size > 300) postedModCalls.delete(postedModCalls.values().next().value);

      const callerPlayer = snapshot.players.find(p => p._userId === String(call.Caller));
      const callerName   = callerPlayer ? callerPlayer._username : ('User ' + String(call.Caller || '?'));

      let rec = '';
      try { rec = await ai.generateDispatch('Mod call: ' + (call.Message || call.CallMessage || ''), snapshot.players || []); } catch {}

      await mdtCh.send({ embeds: [embeds.mdtModCall(call, rec, callerName)] }).catch(() => {});
    }
  } catch (err) {
    console.error('[Heartbeat] MDTModCalls:', err.message);
  }
}

// ── MDT: 911 Emergency calls → MDT channel with team pings ─
async function runMDTEmergency(snapshot, guild) {
  try {
    const calls = snapshot.emergencyCalls || [];
    if (!calls.length) return;
    const mdtCh = _client.channels.cache.get(config.channels.mdt);
    if (!mdtCh) return;

    for (const call of calls) {
      const key = emergencyKey(call);
      if (postedEmergency.has(key)) continue;
      postedEmergency.add(key);
      if (postedEmergency.size > 300) postedEmergency.delete(postedEmergency.values().next().value);

      const callerPlayer = snapshot.players.find(p => p._userId === String(call.Caller));
      const callerName   = callerPlayer ? callerPlayer._username : ('User ' + String(call.Caller || '?'));

      let rec = '';
      try { rec = await ai.generateDispatch('911 call: ' + (call.Description || '') + ' at ' + (call.PositionDescriptor || 'unknown location'), snapshot.players || []); } catch {}

      const pingRoles = (config.mdtPings && (config.mdtPings[call.Team] || config.mdtPings['Police'])) || [];
      const pingStr   = pingRoles.map(rid => '<@&' + rid + '>').join(' ');

      await mdtCh.send({ content: pingStr ? pingStr + ' — 911 Call Incoming' : '911 Call Incoming', embeds: [embeds.mdtEmergency(call, rec, callerName)] }).catch(() => {});
    }
  } catch (err) {
    console.error('[Heartbeat] MDTEmergency:', err.message);
  }
}

// ── Shift cards: update live staff cards ─────────────────
async function runShiftCards(snapshot, guild) {
  try {
    const verifyCh = _client.channels.cache.get(config.channels.verifyDatabase);
    if (!verifyCh) return;
    const { users } = await db.getVerifyDb(verifyCh);
    await shiftCards.update(snapshot, users.filter(u => u.status === 'active'), guild);
  } catch (err) {
    console.error('[Heartbeat] ShiftCards:', err.message);
  }
}

// ── In-game command logs → logs channel ──────────────────
async function runCommandLogs(snapshot, guild) {
  try {
    const logs = snapshot.commandLogs || [];
    if (!logs.length) return;

    const logsCh = _client.channels.cache.get(config.channels.logs);
    if (!logsCh) return;

    const verifyCh  = _client.channels.cache.get(config.channels.verifyDatabase);
    const { users } = verifyCh ? await db.getVerifyDb(verifyCh).catch(() => ({ users: [] })) : { users: [] };

    for (const log of logs) {
      const staffName = log.Player?.Name || log.ExecutedBy || 'Unknown';
      const rawCmd    = (log.Command || '').trim();
      const ts        = log.Timestamp ? new Date(log.Timestamp).getTime() : Date.now();

      const key = cmdLogKey(log);
      if (postedCmdLogs.has(key)) continue;
      postedCmdLogs.add(key);
      if (postedCmdLogs.size > 600) postedCmdLogs.delete(postedCmdLogs.values().next().value);

      if (!rawCmd.startsWith(':')) continue;
      const parts  = rawCmd.slice(1).trim().split(/\s+/);
      const action = (parts[0] || '').toLowerCase();
      const MOD_CMDS = ['kick', 'ban', 'warn', 'unban', 'jail', 'unjail', 'kill', 'tp', 'bring', 'goto', 'respawn', 'h', 'pm', 'm', 'spectate'];
      if (!MOD_CMDS.includes(action)) continue;

      const messageOnlyActions = ['m', 'h'];
      let targetName = 'N/A';
      let reason     = 'No reason provided';

      if (messageOnlyActions.includes(action)) {
        reason = parts.slice(1).join(' ') || 'No message';
      } else {
        targetName = parts[1] || 'Unknown';
        reason     = parts.slice(2).join(' ') || 'No reason provided';
      }

      const linked    = users.find(u => u.robloxUsername === staffName && u.status === 'active');
      const dcMention = linked ? `<@${linked.discordId}>` : `**${staffName}**`;

      const COLOR_MAP = {
        kick: 0xFF6B35, ban: 0xFF0000, warn: 0xFFD700,
        unban: 0x00CC66, jail: 0xFF8C00, unjail: 0x00CC66,
        kill: 0xFF4444, tp: 0x7289DA, bring: 0x7289DA,
        goto: 0x7289DA, respawn: 0x43B581, m: 0x5865F2, h: 0x5865F2,
        pm: 0x5865F2, spectate: 0x99AAB5,
      };
      const EMOJI_MAP = {
        kick: '🦵', ban: '🔨', warn: '⚠️', unban: '✅', jail: '⛓️',
        unjail: '🔓', kill: '💀', tp: '🌀', bring: '🤚', goto: '👣',
        respawn: '♻️', m: '📢', h: '📣', pm: '💬', spectate: '👁️',
      };

      const color = COLOR_MAP[action] ?? 0x5865F2;
      const emoji = EMOJI_MAP[action] ?? '⚙️';
      const { EmbedBuilder } = require('discord.js');

      const fields = [
        { name: '👮 Staff Member', value: dcMention,    inline: true },
        { name: '⏰ Time',         value: `<t:${Math.floor(ts / 1000)}:F>`, inline: true },
        { name: '🎮 Team',         value: log.Player?.Team || 'Unknown', inline: true },
        { name: '📋 Reason',       value: reason,       inline: false },
        { name: '⌨️ Full Command', value: `\`${rawCmd}\``, inline: false },
      ];

      if (!messageOnlyActions.includes(action)) {
        fields.splice(1, 0, { name: '🎯 Target Player', value: targetName, inline: true });
      }

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${emoji} In-Game Command — :${action.toUpperCase()}`)
        .addFields(...fields)
        .setFooter({ text: 'FSRP In-Game Command Log  •  Florida State' })
        .setTimestamp(ts);

      await logsCh.send({ embeds: [embed] }).catch(e => console.error('[Heartbeat] cmdLog send:', e.message));
    }
  } catch (err) {
    console.error('[Heartbeat] runCommandLogs:', err.message);
  }
}

// ── Pre-seed dedup sets from the latest saved snapshot ────
// Called once on first pulse. Keys MUST use the same key builder functions
// as the runtime functions above — no more key format mismatches.
// Seed dedup sets directly from a live ERLC snapshot.
  // This is the definitive fix against restart spam — whatever ERLC is currently
  // serving gets marked as "already seen" before we start posting anything new.
  function seedFromLiveSnapshot(snapshot) {
    for (const c of (snapshot.modCalls    || [])) postedModCalls.add(modCallKey(c));
    for (const c of (snapshot.emergencyCalls || [])) postedEmergency.add(emergencyKey(c));
    for (const l of (snapshot.commandLogs || [])) postedCmdLogs.add(cmdLogKey(l));
    for (const k of (snapshot.killLogs   || [])) {
      crimeTicker.seedSeen((k.Killer || '') + '-' + (k.Killed || '') + '-' + (k.Timestamp || ''));
    }
    // Seed wantedWall + pursuitTracker so neither re-announces already-wanted players on restart
    const highWanted = (snapshot.players || [])
      .filter(p => (p._wantedStars || 0) >= 3)
      .map(p => String(p._userId || p._username || ''));
    if (highWanted.length) {
      wantedWall.seedSeen(highWanted);
      pursuitTracker.seedSeen(highWanted); // ← was missing — caused pursuit spam on restart
    }
    console.log('[Heartbeat] Live-seeded: ' + (snapshot.modCalls||[]).length + ' modCalls, ' +
      (snapshot.emergencyCalls||[]).length + ' emergencies, ' + (snapshot.killLogs||[]).length + ' kills, ' +
      highWanted.length + ' high-wanted players — restart spam fully blocked.');
  }

  async function seedDedupFromLatestSnapshot(guild) {
  const gameCh = _client.channels.cache.get(config.channels.gameDatabase);
  if (!gameCh) {
    console.log('[Heartbeat] seedDedup: gameDatabase channel not found, skipping seed.');
    return;
  }

  const { data } = await db.readLatestFile(gameCh, null);
  if (!data) {
    console.log('[Heartbeat] seedDedup: no snapshot found in gameDatabase, starting fresh.');
    return;
  }

  const killLogs    = data.killLogs    || [];
  const cmdLogs     = data.commandLogs || [];
  const modCalls    = data.modCalls    || [];
  const emergencies = data.emergencyCalls || [];

  for (const c of modCalls)    postedModCalls.add(modCallKey(c));
  for (const c of emergencies) postedEmergency.add(emergencyKey(c));
  for (const l of cmdLogs)     postedCmdLogs.add(cmdLogKey(l));

  // Seed crime ticker kills
  for (const k of killLogs) {
    const key = `${k.Killer || ''}-${k.Killed || ''}-${k.Timestamp || ''}`;
    crimeTicker.seedSeen(key);
  }

  console.log(`[Heartbeat] Seeded: ${postedModCalls.size} modCalls, ${postedEmergency.size} emergencies, ${postedCmdLogs.size} cmdLogs, ${killLogs.length} kills. Posting enabled from next pulse.`);
}

function getActiveShifts() { return sessionStore.getActiveShifts(); }

module.exports = { start, getActiveShifts };
