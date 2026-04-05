// staffAlertSystem.js — Intelligent Staff Alert Engine
// Monitors game state and fires targeted staff alerts:
//   • Server population milestones (25, 50, 75, 100 players)
//   • Kill spike (5+ kills in 60s — possible mass RDM)
//   • Server offline/stale detection
//   • Mod call surge (3+ unhandled mod calls)
//   • High-wanted player spike (4+ star player)
'use strict';

const { EmbedBuilder } = require('discord.js');
const config = require('../config');

let _client = null;
let _lastPlayerCount   = 0;
let _lastOfflineAlert  = 0;
let _lastOnlineAlert   = 0;
let _wasOffline        = false;
let _recentKills       = [];
let _rdmAlerted        = false;
const ALERT_COOLDOWN   = 5 * 60 * 1000;  // 5 min between same alert type
const milestonesFired  = new Set();

function init(client) {
  _client = client;
  console.log('[StaffAlertSystem] Initialized.');
}

async function pulse(snapshot) {
  if (!_client) return;
  const staffCh   = _client.channels.cache.get(config.channels.staffChat);
  const mdtCh     = _client.channels.cache.get(config.channels.mdt);
  if (!staffCh && !mdtCh) return;

  const now         = Date.now();
  const players     = snapshot?.players || [];
  const playerCount = players.length;
  const serverOnline = !snapshot?._offline && !snapshot?._stale;
  const killLogs    = snapshot?.killLogs || [];
  const modCalls    = snapshot?.modCalls || [];

  // ── 1. Server offline alert ──────────────────────────────
  if (!serverOnline && !_wasOffline && (now - _lastOfflineAlert > ALERT_COOLDOWN)) {
    _wasOffline = true;
    _lastOfflineAlert = now;
    const embed = new EmbedBuilder()
      .setColor(0x992D22)
      .setAuthor({ name: '⚠️  RCRP ALERT SYSTEM  —  AUTOMATED MONITOR' })
      .setTitle('🔴  Server Offline / Unreachable')
      .setDescription(
        '> The ERLC game server is currently **offline or not responding**.\n\n' +
        '**Affected systems:** MDT • Shift Cards • Crime Ticker • Map Pinner\n' +
        'All live features are paused until the server comes back online.'
      )
      .addFields({ name: '🕐 Detected At', value: `<t:${Math.floor(now/1000)}:F>`, inline: true })
      .setFooter({ text: 'RCRP Staff Alert System — River City Role Play' })
      .setTimestamp();
    await _sendAlert(staffCh || mdtCh, embed);
  }

  // ── 2. Server back online ────────────────────────────────
  if (serverOnline && _wasOffline && (now - _lastOnlineAlert > ALERT_COOLDOWN)) {
    _wasOffline = false;
    _lastOnlineAlert = now;
    const embed = new EmbedBuilder()
      .setColor(0x2D7D46)
      .setAuthor({ name: '✅  RCRP ALERT SYSTEM  —  AUTOMATED MONITOR' })
      .setTitle('🟢  Server Back Online')
      .setDescription('> The ERLC server is **back online** and responding normally.\n\nAll live features have resumed. MDT, shift cards, and crime ticker are active.')
      .addFields(
        { name: '👥 Current Players', value: String(playerCount), inline: true },
        { name: '🕐 Restored At',    value: `<t:${Math.floor(now/1000)}:T>`, inline: true },
      )
      .setFooter({ text: 'RCRP Staff Alert System — River City Role Play' })
      .setTimestamp();
    await _sendAlert(staffCh || mdtCh, embed);
  }

  // ── 3. Population milestones ─────────────────────────────
  const milestones = [25, 50, 75, 100];
  for (const m of milestones) {
    if (_lastPlayerCount < m && playerCount >= m && !milestonesFired.has(m)) {
      milestonesFired.add(m);
      const embed = new EmbedBuilder()
        .setColor(m >= 100 ? 0x8B7536 : m >= 75 ? 0x9B59B6 : m >= 50 ? 0x1D6FA5 : 0x2D7D46)
        .setAuthor({ name: '📊  RCRP ALERT SYSTEM  —  POPULATION MILESTONE' })
        .setTitle(`${m >= 100 ? '🏆' : m >= 75 ? '🚀' : m >= 50 ? '🔥' : '📈'}  ${m} Players Online — River City!`)
        .setDescription(`> The RCRP server just hit **${m} active players** — ${m >= 100 ? 'maximum capacity!' : 'consider announcing a session or event!'}`)
        .addFields(
          { name: '👥 Current Count', value: String(playerCount), inline: true },
          { name: '🕐 Time',          value: `<t:${Math.floor(now/1000)}:T>`,  inline: true },
        )
        .setFooter({ text: 'RCRP Staff Alert System — River City Role Play' })
        .setTimestamp();
      await _sendAlert(staffCh || mdtCh, embed);
    }
    // Reset milestone when players drop below
    if (playerCount < m * 0.8) milestonesFired.delete(m);
  }
  _lastPlayerCount = playerCount;

  // ── 4. Kill spike — possible mass RDM ───────────────────
  const recentWindow = now - 60_000;
  const fresh = killLogs.filter(k => {
    const ts = k.Timestamp ? new Date(k.Timestamp).getTime() : 0;
    return ts >= recentWindow;
  });
  _recentKills = fresh;
  if (fresh.length >= 5 && !_rdmAlerted) {
    _rdmAlerted = true;
    setTimeout(() => { _rdmAlerted = false; }, 3 * 60 * 1000);
    const killerMap = {};
    for (const k of fresh) { killerMap[k.Killer || '?'] = (killerMap[k.Killer || '?'] || 0) + 1; }
    const topKiller = Object.entries(killerMap).sort((a,b) => b[1]-a[1])[0];
    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setAuthor({ name: '🚨  RCRP ALERT SYSTEM  —  KILL SPIKE DETECTED' })
      .setTitle(`⚠️  Possible Mass RDM — ${fresh.length} Kills in 60 Seconds`)
      .setDescription('> An unusual number of kills was detected in the last 60 seconds.\n> **Staff action may be required in-game.**')
      .addFields(
        { name: '💀 Total Kills (60s)', value: String(fresh.length),              inline: true },
        { name: '👤 Top Suspect',       value: topKiller ? `${topKiller[0]} (${topKiller[1]} kills)` : 'N/A', inline: true },
        { name: '🕐 Detected At',       value: `<t:${Math.floor(now/1000)}:T>`,   inline: true },
      )
      .setFooter({ text: 'RCRP Staff Alert System — River City Role Play' })
      .setTimestamp();
    await _sendAlert(mdtCh || staffCh, embed);
  }
  if (fresh.length < 3) _rdmAlerted = false;

  // ── 5. Mod call surge ───────────────────────────────────
  if ((modCalls?.length || 0) >= 3) {
    // Only alert once per surge — tracked via _lastModSurge
    if (!_staffAlertSystem._modSurgeTime || (now - _staffAlertSystem._modSurgeTime) > ALERT_COOLDOWN) {
      _staffAlertSystem._modSurgeTime = now;
      const embed = new EmbedBuilder()
        .setColor(0xC37D00)
        .setAuthor({ name: '📢  RCRP ALERT SYSTEM  —  MOD CALL SURGE' })
        .setTitle(`🛑  ${modCalls.length} Active Mod Calls — Staff Needed In-Game`)
        .setDescription('> There are **' + modCalls.length + ' open mod calls** in the game right now.\n> Please send available game staff to handle them.')
        .addFields(
          { name: '📋 Open Calls', value: String(modCalls.length), inline: true },
          { name: '🕐 Time',       value: `<t:${Math.floor(now/1000)}:T>`, inline: true },
        )
        .setFooter({ text: 'RCRP Staff Alert System — River City Role Play' })
        .setTimestamp();
      await _sendAlert(mdtCh || staffCh, embed);
    }
  }
}

async function _sendAlert(channel, embed) {
  if (!channel) return;
  try { await channel.send({ embeds: [embed] }); }
  catch (e) { console.error('[StaffAlertSystem] send error:', e.message); }
}

const _staffAlertSystem = { init, pulse };
module.exports = _staffAlertSystem;
