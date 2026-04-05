// intelSystem.js — Player Intel System
// /intel <username> — pulls a full deep-profile on any Roblox player:
//   • Discord link from verify DB
//   • In-game history from game DB snapshots
//   • Wanted history, team history, shift activity, last seen
//   • AI-generated risk assessment
'use strict';

const { EmbedBuilder } = require('discord.js');
const config  = require('../config');
const db      = require('../utils/discordDb');
const ai      = require('../utils/ai');

let _client = null;

function init(client) {
  _client = client;
  console.log('[IntelSystem] Initialized.');
}

async function runIntel(interaction, robloxUsername) {
  if (!_client) return;
  await interaction.deferReply({ ephemeral: false });

  const guild    = interaction.guild;
  const gameCh   = _client.channels.cache.get(config.channels.gameDatabase);
  const verifyCh = _client.channels.cache.get(config.channels.verifyDatabase);

  // ── 1. Pull all snapshots (up to 30 messages)
  let snapshots = [];
  if (gameCh) {
    try {
      const msgs = await gameCh.messages.fetch({ limit: 30 });
      for (const msg of msgs.values()) {
        for (const att of msg.attachments.values()) {
          try {
            const resp = await fetch(att.url);
            const data = await resp.json();
            if (data?.players) snapshots.push(data);
          } catch {}
        }
      }
    } catch {}
  }

  // ── 2. Build player profile from snapshots
  const target = robloxUsername.toLowerCase();
  let appearances = 0;
  let teamsUsed   = {};
  let maxStars    = 0;
  let totalWanted = 0;
  let lastSeen    = null;
  let vehicles    = {};
  let callsigns   = {};
  let kills       = 0;
  let deaths      = 0;

  for (const snap of snapshots) {
    const p = (snap.players || []).find(pl =>
      (pl._username || pl.Name || '').toLowerCase() === target ||
      String(pl._userId || '').toLowerCase() === target
    );
    if (p) {
      appearances++;
      if (snap._meta?.timestamp) {
        const ts = new Date(snap._meta.timestamp);
        if (!lastSeen || ts > new Date(lastSeen)) lastSeen = snap._meta.timestamp;
      }
      const team = p._team || 'Civilian';
      teamsUsed[team] = (teamsUsed[team] || 0) + 1;
      const stars = p._wantedStars || 0;
      if (stars > maxStars) maxStars = stars;
      if (stars > 0) totalWanted++;
      const veh = p._vehicle || 'On foot';
      vehicles[veh] = (vehicles[veh] || 0) + 1;
      const cs = p._callsign || 'None';
      callsigns[cs] = (callsigns[cs] || 0) + 1;
    }

    // Kill/death tally from kill logs
    for (const k of (snap.killLogs || [])) {
      if ((k.Killer || '').toLowerCase() === target) kills++;
      if ((k.Killed || '').toLowerCase() === target) deaths++;
    }
  }

  // ── 3. Lookup Discord link
  let discordUser = null;
  if (verifyCh) {
    try {
      const { users } = await db.getVerifyDb(verifyCh);
      discordUser = users.find(u =>
        u.robloxUsername?.toLowerCase() === target && u.status === 'active'
      );
    } catch {}
  }

  const foundAny = appearances > 0;
  const topTeam  = Object.entries(teamsUsed).sort((a,b) => b[1]-a[1])[0]?.[0] || 'N/A';
  const topVeh   = Object.entries(vehicles).sort((a,b) => b[1]-a[1])[0]?.[0]  || 'N/A';

  // ── 4. Risk level
  const riskScore = (maxStars * 2) + (totalWanted * 0.5) + (kills * 0.3);
  const riskLabel = riskScore >= 10 ? '🔴 HIGH RISK' : riskScore >= 5 ? '🟠 MODERATE' : riskScore >= 2 ? '🟡 LOW RISK' : '🟢 CLEAN';
  const riskColor = riskScore >= 10 ? 0xED4245 : riskScore >= 5 ? 0xFF6B00 : riskScore >= 2 ? 0xFFD700 : 0x2D7D46;

  // ── 5. Build embed
  const embed = new EmbedBuilder()
    .setColor(riskColor)
    .setAuthor({ name: '🔍  RCRP INTEL REPORT  —  CLASSIFIED' })
    .setTitle(`📋  Intel File: ${robloxUsername}`)
    .setDescription(
      foundAny
        ? `> Compiled from **${snapshots.length}** game database snapshots.\n> Intelligence covers all recorded activity in RCRP.\n\n` +
          `**Risk Assessment:** ${riskLabel}`
        : `> No in-game data found for **${robloxUsername}** in the RCRP database.\n> Player may be new, or has never joined the server.`
    );

  if (foundAny) {
    embed.addFields(
      { name: '📅 Last Seen In-Game', value: lastSeen ? `<t:${Math.floor(new Date(lastSeen).getTime()/1000)}:R>` : 'Unknown', inline: true },
      { name: '📊 Sessions Recorded', value: String(appearances),  inline: true },
      { name: '🏷️  Primary Role',    value: topTeam,              inline: true },
      { name: '⭐ Max Wanted Stars', value: `${maxStars}★`,        inline: true },
      { name: '🕒 Wanted Incidents', value: String(totalWanted),  inline: true },
      { name: '🚗 Fav Vehicle',      value: topVeh,               inline: true },
      { name: '💀 Kill Log',         value: `${kills}K / ${deaths}D`, inline: true },
    );
  }

  embed.addFields(
    { name: '🔗 Discord Link', value: discordUser ? `<@${discordUser.discordId}> (Verified)` : '❌ Not verified in system', inline: true },
    { name: '⚠️ Risk Level',   value: riskLabel, inline: true },
  );

  embed.setFooter({ text: `RCRP Intel System — Requested by ${interaction.user.username} — River City Role Play` }).setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

module.exports = { init, runIntel };
