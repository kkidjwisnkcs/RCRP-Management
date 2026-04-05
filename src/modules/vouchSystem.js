// vouchSystem.js — Community Vouch/Rep System
// /vouch @player reason → after 10 vouches auto-posts "Community Favourite" shoutout

'use strict';

const { EmbedBuilder } = require('discord.js');
const config           = require('../config');

// In-memory store: userId → { count, vouchers: Set<userId>, name }
const vouchStore = new Map();
const THRESHOLD  = 10;

let _client = null;

function init(client) {
  _client = client;
}

async function addVouch(giverId, targetId, targetName, reason, guild) {
  if (!vouchStore.has(targetId)) {
    vouchStore.set(targetId, { count: 0, vouchers: new Set(), name: targetName, reachedMilestone: false });
  }
  const entry = vouchStore.get(targetId);

  if (entry.vouchers.has(giverId)) {
    return { ok: false, reason: 'You already vouched for this person this session.' };
  }

  entry.vouchers.add(giverId);
  entry.count++;
  entry.name = targetName;

  // Auto-shoutout at THRESHOLD
  if (entry.count >= THRESHOLD && !entry.reachedMilestone) {
    entry.reachedMilestone = true;
    await postCommunityFavourite(targetId, targetName, entry.count, reason, guild);
  }

  return { ok: true, count: entry.count };
}

async function postCommunityFavourite(userId, username, count, lastReason, guild) {
  if (!_client) return;
  const ch = _client.channels.cache.get(config.channels.announcements || config.channels.vouchBoard);
  if (!ch) return;

  const member = guild?.members.cache.get(userId);

  const embed = new EmbedBuilder()
    .setColor(config.colors.gold)
    .setTitle('🏆 COMMUNITY FAVOURITE — River City')
    .setDescription(
      `The River City community has spoken! **${username}** has received **${count} vouches** from fellow players.\n\n` +
      `Most recent recognition:\n> *"${lastReason}"*\n\n` +
      `Thank you for making River City Role Play an incredible place.`
    )
    .setThumbnail(member?.displayAvatarURL() || null)
    .addFields(
      { name: '🌟 Community Rep', value: `${count} vouches`, inline: true },
      { name: '👤 Player',        value: `<@${userId}>`,     inline: true },
    )
    .setFooter({ text: 'RCRP Community Rep System — River City' })
    .setTimestamp();

  await ch.send({ content: `🎉 Congratulations <@${userId}>!`, embeds: [embed] }).catch(() => {});
}

function getVouches(userId) {
  return vouchStore.get(userId) || { count: 0, vouchers: new Set(), name: '?' };
}

module.exports = { init, addVouch, getVouches };
