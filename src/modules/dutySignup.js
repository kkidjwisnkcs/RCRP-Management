// dutySignup.js — Staff Duty Signup System
// Staff click a button to claim a session slot. Roster auto-posts 10 min before.

'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');

let _client  = null;
let sessions = new Map(); // sessionId → { title, time, signups: Map<userId, { name, team }>, msgId, channelId, reminded }

function init(client) {
  _client = client;
  // Check every minute for sessions starting in 10 min
  setInterval(checkReminders, 60_000);
}

async function postSignupEmbed(channel, title, timeLabel, sessionId) {
  const sid = sessionId || `session-${Date.now()}`;
  sessions.set(sid, { title, time: timeLabel, signups: new Map(), msgId: null, channelId: channel.id, reminded: false });

  const embed = buildEmbed(sid);
  const row   = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dutysignup:join:${sid}`).setLabel('✅ Sign Me Up').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`dutysignup:leave:${sid}`).setLabel('❌ Remove Me').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`dutysignup:roster:${sid}`).setLabel('📋 View Roster').setStyle(ButtonStyle.Secondary),
  );

  const msg = await channel.send({ embeds: [embed], components: [row] });
  sessions.get(sid).msgId = msg.id;
  return sid;
}

function buildEmbed(sid) {
  const s = sessions.get(sid);
  if (!s) return new EmbedBuilder().setDescription('Session not found.');
  const signupList = s.signups.size === 0
    ? '*No sign-ups yet*'
    : [...s.signups.values()].map((u, i) => `${i + 1}. **${u.name}** — ${u.team || 'TBA'}`).join('\n');

  return new EmbedBuilder()
    .setColor(config.colors.blue)
    .setTitle(`📋 Duty Sign-Up — ${s.title}`)
    .setDescription(`**Session Time:** ${s.time}\n\nSign up to let management plan the roster before the session starts.`)
    .addFields({ name: `📌 Signed Up (${s.signups.size})`, value: signupList.slice(0, 1024), inline: false })
    .setFooter({ text: 'RCRP Duty Signup — Staff Management' })
    .setTimestamp();
}

async function handleSignup(interaction, action, sid) {
  const s = sessions.get(sid);
  if (!s) return interaction.reply({ content: 'This signup session no longer exists.', ephemeral: true });

  const member = interaction.member;

  if (action === 'join') {
    s.signups.set(member.id, { name: member.displayName, team: member.roles.cache.find(r => ['Police','Fire','EMS','DOT','Sheriff'].some(t => r.name.includes(t)))?.name || 'Staff' });
    await interaction.reply({ content: `✅ You've been added to the roster for **${s.title}**!`, ephemeral: true });
  } else if (action === 'leave') {
    s.signups.delete(member.id);
    await interaction.reply({ content: `You've been removed from the roster.`, ephemeral: true });
  } else if (action === 'roster') {
    const lines = [...s.signups.values()].map((u, i) => `${i + 1}. **${u.name}** — ${u.team}`);
    return interaction.reply({
      content: `**Roster for ${s.title}:**\n${lines.join('\n') || '*Empty*'}`,
      ephemeral: true,
    });
  }

  // Refresh the embed
  await refreshEmbed(sid, interaction.channel);
}

async function refreshEmbed(sid, channel) {
  const s = sessions.get(sid);
  if (!s || !s.msgId) return;
  try {
    const ch  = channel || _client.channels.cache.get(s.channelId);
    const msg = await ch?.messages.fetch(s.msgId).catch(() => null);
    if (msg) await msg.edit({ embeds: [buildEmbed(sid)] }).catch(() => {});
  } catch {}
}

async function checkReminders() {
  // For sessions where the time string matches "in 10 minutes" — this is a heuristic
  // Real implementation: store UTC timestamps and compare
  // Left as a hook for the countdown command to wire up
}

function getSessions() { return sessions; }

module.exports = { init, postSignupEmbed, handleSignup, getSessions };
