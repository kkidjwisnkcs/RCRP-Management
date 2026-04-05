// reputationSystem.js — Community Reputation System
// Tracks rep points per Discord user, stored in #discord-database.
// Points are earned via: vouches received, positive reviews, session time, mod calls handled.
// /rep view — show your rep profile
// /rep give <user> — give +1 rep (staff only, once per 24h per target)
'use strict';

const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const db     = require('../utils/discordDb');

let _client    = null;
const REP_PREFIX = 'rep-v1';
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

function init(client) {
  _client = client;
  console.log('[ReputationSystem] Initialized.');
}

// ── Get rep DB ────────────────────────────────────────────
async function getRepDb(guild) {
  const ch = _client.channels.cache.get(config.channels.discordDatabase);
  if (!ch) return { records: {}, save: async () => {} };
  const { data, save } = await db.readOrCreateFile(ch, REP_PREFIX, {});
  return { records: data || {}, save };
}

// ── Add points to a user ──────────────────────────────────
async function addRep(guild, discordId, points, reason) {
  const { records, save } = await getRepDb(guild);
  if (!records[discordId]) {
    records[discordId] = { points: 0, history: [], lastGiven: {} };
  }
  records[discordId].points += points;
  records[discordId].history.unshift({ reason, points, at: new Date().toISOString() });
  records[discordId].history = records[discordId].history.slice(0, 20); // keep last 20
  await save();
}

// ── Give rep (slash: /rep give) ───────────────────────────
async function giveRep(interaction, targetMember) {
  const giver  = interaction.member;
  const guild  = interaction.guild;
  if (!_client) return;

  await interaction.deferReply({ ephemeral: true });

  if (targetMember.id === giver.id) {
    return interaction.editReply({ content: '❌ You cannot give rep to yourself.' });
  }

  const { records, save } = await getRepDb(guild);
  const giverRecord = records[giver.id] || { points: 0, history: [], lastGiven: {} };
  const now = Date.now();

  // Cooldown check
  if (giverRecord.lastGiven?.[targetMember.id]) {
    const diff = now - new Date(giverRecord.lastGiven[targetMember.id]).getTime();
    if (diff < COOLDOWN_MS) {
      const remaining = Math.ceil((COOLDOWN_MS - diff) / 3600000);
      return interaction.editReply({ content: `⏳ You already gave rep to ${targetMember.displayName}. Try again in **${remaining}h**.` });
    }
  }

  // Give the rep
  if (!records[targetMember.id]) records[targetMember.id] = { points: 0, history: [], lastGiven: {} };
  records[targetMember.id].points += 1;
  records[targetMember.id].history.unshift({ reason: `Given by ${giver.displayName}`, points: 1, at: new Date().toISOString() });
  records[targetMember.id].history = records[targetMember.id].history.slice(0, 20);

  giverRecord.lastGiven = giverRecord.lastGiven || {};
  giverRecord.lastGiven[targetMember.id] = new Date().toISOString();
  records[giver.id] = giverRecord;

  await save();

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2D7D46)
        .setTitle('✅  Rep Given')
        .setDescription(`You gave **+1 rep** to ${targetMember}.\nThey now have **${records[targetMember.id].points} rep points**.`)
        .setFooter({ text: 'RCRP Reputation System — River City Role Play' })
        .setTimestamp()
    ]
  });

  // DM the target
  try {
    await targetMember.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x8B7536)
          .setAuthor({ name: '⭐  RCRP REPUTATION SYSTEM  —  River City Role Play' })
          .setTitle('🌟  You Received a Reputation Point!')
          .setDescription(
            `**${giver.displayName}** gave you **+1 reputation point** on River City Role Play.\n\n` +
            `> Your current rep: **${records[targetMember.id].points} points** ⭐\n\n` +
            `Keep up the great work — your positive impact in the community is noticed!`
          )
          .setThumbnail(giver.user.displayAvatarURL())
          .setFooter({ text: 'RCRP Reputation System — River City Role Play' })
          .setTimestamp()
      ]
    });
  } catch {}
}

// ── View rep profile (/rep view) ──────────────────────────
async function viewRep(interaction, targetMember) {
  const guild = interaction.guild;
  await interaction.deferReply({ ephemeral: false });

  const target = targetMember || interaction.member;
  const { records } = await getRepDb(guild);
  const rec = records[target.id] || { points: 0, history: [] };

  // Leaderboard rank
  const allEntries = Object.entries(records).sort((a,b) => (b[1].points||0) - (a[1].points||0));
  const rank = allEntries.findIndex(([id]) => id === target.id) + 1;

  const repTier = rec.points >= 50 ? '💎 Legend' : rec.points >= 25 ? '🏆 Elite' : rec.points >= 10 ? '⭐ Respected' : rec.points >= 5 ? '📈 Rising' : '🌱 New';
  const tierColor = rec.points >= 50 ? 0x8B7536 : rec.points >= 25 ? 0x9B59B6 : rec.points >= 10 ? 0x1D6FA5 : rec.points >= 5 ? 0x2D7D46 : 0x3D4045;

  const recentHistory = (rec.history || []).slice(0, 5).map(h => `• +${h.points} — ${h.reason} (<t:${Math.floor(new Date(h.at).getTime()/1000)}:R>)`).join('\n') || 'No activity yet.';

  const embed = new EmbedBuilder()
    .setColor(tierColor)
    .setAuthor({ name: '⭐  RCRP REPUTATION PROFILE  —  River City Role Play' })
    .setTitle(`${repTier}  —  ${target.displayName}`)
    .setThumbnail(target.user.displayAvatarURL())
    .addFields(
      { name: '⭐ Reputation Points', value: String(rec.points),  inline: true },
      { name: '🏅 Tier',             value: repTier,             inline: true },
      { name: '🏆 Leaderboard Rank', value: rank > 0 ? `#${rank} of ${allEntries.length}` : 'Unranked', inline: true },
      { name: '📜 Recent Activity (last 5)', value: recentHistory, inline: false },
    )
    .setFooter({ text: `RCRP Reputation System — Requested by ${interaction.user.username}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ── Auto-award rep for session completion ─────────────────
async function awardSessionRep(guild, discordId, durationMinutes) {
  if (durationMinutes < 30) return;
  const points = Math.floor(durationMinutes / 30); // 1 pt per 30 min
  await addRep(guild, discordId, points, `Session completed (${durationMinutes}m)`);
}

// ── Auto-award rep for handled mod call ───────────────────
async function awardModCallRep(guild, discordId) {
  await addRep(guild, discordId, 2, 'Handled mod call in-game');
}

module.exports = { init, giveRep, viewRep, addRep, awardSessionRep, awardModCallRep };
