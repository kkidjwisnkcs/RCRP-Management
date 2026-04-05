// embeds.js — RCRP Visual Embed Templates (UPGRADED — RCRP STYLE)
'use strict';

const { EmbedBuilder } = require('discord.js');
const config = require('../config');

const BRAND  = 'River City Role Play';
const FOOTER = { text: `RCRP Management — ${BRAND}` };
const MDT_FOOTER = { text: `RCRP MDT — ${BRAND} Dispatch Center` };

// ── Base builders ─────────────────────────────────────────────────────────────
function base(color = config.colors.primary) {
  return new EmbedBuilder().setColor(color).setFooter(FOOTER).setTimestamp();
}
function success(title, desc) {
  return new EmbedBuilder()
    .setColor(0x2D7D46).setFooter(FOOTER).setTimestamp()
    .setAuthor({ name: `✅  ${BRAND}  —  SUCCESS` })
    .setTitle(title).setDescription(desc);
}
function error(title, desc) {
  return new EmbedBuilder()
    .setColor(0xED4245).setFooter(FOOTER).setTimestamp()
    .setAuthor({ name: `❌  ${BRAND}  —  ERROR` })
    .setTitle(title).setDescription(desc);
}
function warning(title, desc) {
  return new EmbedBuilder()
    .setColor(0xC37D00).setFooter(FOOTER).setTimestamp()
    .setAuthor({ name: `⚠️  ${BRAND}  —  WARNING` })
    .setTitle(title).setDescription(desc);
}
function info(title, desc) {
  return new EmbedBuilder()
    .setColor(0x1D6FA5).setFooter(FOOTER).setTimestamp()
    .setAuthor({ name: `ℹ️  ${BRAND}  —  INFORMATION` })
    .setTitle(title).setDescription(desc);
}

// ── MDT Emergency Call ────────────────────────────────────────────────────────
function mdtEmergency(call, aiRec, callerName) {
  const teamEmojis = { Police: '🚓', Fire: '🚒', EMS: '🚑', DOT: '🚧', Sheriff: '🚔', SWAT: '⚡' };
  const emoji  = teamEmojis[call.Team] || '🚨';
  const postal = call.PositionDescriptor || 'Unknown Location';
  const ts     = call.StartedAt ? `<t:${call.StartedAt}:T>` : `<t:${Math.floor(Date.now()/1000)}:T>`;
  const team   = (call.Team || 'ALL UNITS').toUpperCase();
  return new EmbedBuilder()
    .setColor(0xED4245)
    .setAuthor({ name: `🚨  EMERGENCY DISPATCH  —  RCRP MDT` })
    .setTitle(`${emoji}  CALL #${call.CallNumber || '?'}  ⟶  ${team} NEEDED`)
    .setDescription(
      `> ${aiRec || 'All available units respond. Follow standard protocol.'}\n\n` +
      `**Priority:** ${call.Team === 'SWAT' ? '🔴 CRITICAL' : call.Team === 'Police' || call.Team === 'Sheriff' ? '🟠 HIGH' : '🟡 STANDARD'}`
    )
    .addFields(
      { name: '📍 Location',    value: `\`${postal}\``,                            inline: true  },
      { name: '👤 Caller',      value: callerName || String(call.Caller || '?'),   inline: true  },
      { name: '⏰ Received',    value: ts,                                          inline: true  },
      { name: '📋 Description', value: `\`\`\`${call.Description || 'No description provided.'}\`\`\``, inline: false },
    )
    .setFooter(MDT_FOOTER)
    .setTimestamp();
}

// ── MDT Mod Call ──────────────────────────────────────────────────────────────
function mdtDispatch(callData, aiRec) {
  return new EmbedBuilder()
    .setColor(0xFF6B00)
    .setAuthor({ name: `🛑  MOD CALL  —  RCRP MDT  —  STAFF REQUIRED` })
    .setTitle(`📣  In-Game Staff Call  —  Action Required`)
    .setDescription(
      `> ${aiRec || 'Respond to this mod call as soon as possible.'}\n\n` +
      `**Urgency:** 🟠 HIGH — please respond promptly`
    )
    .addFields(
      { name: '👤 Caller',    value: `\`${callData.caller  || 'Unknown'}\``,        inline: true  },
      { name: '⏰ Time',      value: `<t:${Math.floor(Date.now()/1000)}:T>`,         inline: true  },
      { name: '📋 Message',   value: `\`\`\`${callData.message || 'No details.'}\`\`\``, inline: false },
    )
    .setFooter(MDT_FOOTER)
    .setTimestamp();
}

// ── Shift Card ────────────────────────────────────────────────────────────────
function shiftCard(member, user, player, durationMins, modCalls, online, lastTeam, lastCallsign) {
  const h    = Math.floor(durationMins / 60);
  const m    = durationMins % 60;
  const dur  = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m` : '< 1m';
  const team     = (player && player._team)     || lastTeam     || '—';
  const callsign = (player && player._callsign) || lastCallsign || 'None';
  const vehicle  = (player && player._vehicle)  || 'On foot';
  const postal   = (player && player._location?.PostalCode) ? `Postal ${player._location.PostalCode}` : '—';
  const stars    = player?._wantedStars || 0;
  const starBar  = stars > 0 ? '⭐'.repeat(stars) : 'Clean';
  return new EmbedBuilder()
    .setColor(online ? 0x2D7D46 : 0x3D4045)
    .setAuthor({ name: online ? `🟢  ON DUTY  —  RCRP SHIFT TRACKER` : `⚫  OFF DUTY  —  RCRP SHIFT TRACKER`, iconURL: member.user.displayAvatarURL() })
    .setTitle(member.displayName)
    .setThumbnail(member.user.displayAvatarURL())
    .setDescription(online
      ? `> Currently active in-game on River City Role Play.\n> Session is being tracked live.`
      : `> This staff member is currently off duty.`
    )
    .addFields(
      { name: '🎮 Roblox',      value: user.robloxUsername || '?', inline: true },
      { name: '⏱️ Session',     value: dur,                         inline: true },
      { name: '📞 Mod Calls',   value: String(modCalls),            inline: true },
      { name: '👥 Team',        value: team,                        inline: true },
      { name: '📻 Callsign',    value: callsign,                    inline: true },
      { name: '🚗 Vehicle',     value: vehicle,                     inline: true },
      { name: '📍 Location',    value: postal,                      inline: true },
      { name: '⭐ Wanted',      value: starBar,                     inline: true },
    )
    .setFooter({ text: `RCRP Shift Tracker — ${BRAND}` })
    .setTimestamp();
}

// ── Profile Card ──────────────────────────────────────────────────────────────
function profileCard(member, dbUser, stats, guild) {
  const topRole = member.roles.cache
    .filter(r => r.id !== guild?.id && r.color !== 0)
    .sort((a, b) => b.position - a.position)
    .first();
  return new EmbedBuilder()
    .setColor(topRole?.color || config.colors.primary)
    .setAuthor({ name: `👤  RCRP STAFF PROFILE  —  ${BRAND}`, iconURL: member.user.displayAvatarURL() })
    .setTitle(member.displayName)
    .setThumbnail(member.user.displayAvatarURL())
    .setDescription(`> ${topRole ? topRole.name : 'Community Member'} · ${BRAND}`)
    .addFields(
      { name: '🎮 Roblox',       value: dbUser?.robloxUsername || '❌ Not verified', inline: true },
      { name: '📋 Roblox ID',    value: dbUser?.robloxId       || '—',              inline: true },
      { name: '📅 Verified',     value: dbUser?.verifiedAt ? `<t:${Math.floor(new Date(dbUser.verifiedAt).getTime()/1000)}:R>` : '—', inline: true },
      { name: '⏱️ Shift Time',   value: stats?.totalMinutes ? `${Math.floor(stats.totalMinutes/60)}h ${stats.totalMinutes%60}m` : '—', inline: true },
      { name: '📞 Mod Calls',    value: String(stats?.modCalls || 0),              inline: true },
      { name: '🏅 Sessions',     value: String(stats?.sessions || 0),              inline: true },
      { name: '📅 Joined',       value: `<t:${Math.floor(member.joinedTimestamp/1000)}:R>`, inline: true },
      { name: '🔗 Discord',      value: `${member} (${member.user.tag})`,           inline: true },
    )
    .setFooter({ text: `RCRP Profile System — ${BRAND}` })
    .setTimestamp();
}

// ── Review Panel ──────────────────────────────────────────────────────────────
function reviewPanel(memberName, periodLabel) {
  return new EmbedBuilder()
    .setColor(0x8B7536)
    .setAuthor({ name: `⭐  RCRP STAFF REVIEW  —  ${BRAND}` })
    .setTitle(`📝  Staff Review — ${periodLabel}`)
    .setDescription(
      `> Share your honest experience with **${memberName}** during this period.\n\n` +
      `Your feedback is **anonymous** and directly impacts staff recognition.\n` +
      `Please be respectful and constructive.`
    )
    .addFields({ name: '📌 Why it matters', value: 'Peer reviews drive promotions, recognition, and team improvement.', inline: false })
    .setFooter({ text: `RCRP Review System — ${BRAND}` })
    .setTimestamp();
}

// ── Self Roles Panel ──────────────────────────────────────────────────────────
function selfRolesPanel() {
  return new EmbedBuilder()
    .setColor(0x9B59B6)
    .setAuthor({ name: `🎭  RCRP SELF ROLES  —  ${BRAND}` })
    .setTitle('Choose Your Roles')
    .setDescription(
      '> Click a button below to add or remove a role.\n\n' +
      '**🏢 Department Roles** — Shows your in-game department in the member list\n' +
      '**🔔 Notification Roles** — Opt in/out of session, giveaway, and event pings\n\n' +
      '_You can toggle roles on and off at any time._'
    )
    .setFooter({ text: `RCRP Self Roles — ${BRAND}` })
    .setTimestamp();
}

// ── Shift Log ─────────────────────────────────────────────────────────────────
function shiftLog(member, robloxUsername, durationMinutes, action) {
  const isStart = action === 'start';
  return new EmbedBuilder()
    .setColor(isStart ? 0x2D7D46 : 0x3D4045)
    .setAuthor({ name: isStart ? `🟢  SHIFT STARTED  —  RCRP` : `⚫  SHIFT ENDED  —  RCRP`, iconURL: member.user.displayAvatarURL() })
    .setTitle(isStart ? `${member.displayName} — On Duty` : `${member.displayName} — Off Duty`)
    .addFields(
      { name: '👤 Staff',     value: `<@${member.id}>`,  inline: true },
      { name: '🎮 Roblox',   value: robloxUsername,       inline: true },
      { name: '⏱️ Duration', value: isStart ? '—' : `${durationMinutes}m`, inline: true },
    )
    .setFooter({ text: `RCRP Shift Tracker — ${BRAND}` })
    .setTimestamp();
}

// ── Honor Promotion ───────────────────────────────────────────────────────────
function honorPromotion(member, robloxUsername, label) {
  return new EmbedBuilder()
    .setColor(0x8B7536)
    .setAuthor({ name: `🏆  HONOR MILESTONE  —  RCRP` })
    .setTitle(`${member.displayName} — ${label}`)
    .setDescription(`> **${member.displayName}** has reached **${label}** of in-game time at River City Role Play!\n\nThis milestone reflects outstanding dedication to the server. Congratulations!`)
    .addFields(
      { name: '🔗 Discord', value: `<@${member.id}>`,  inline: true },
      { name: '🎮 Roblox',  value: robloxUsername,      inline: true },
      { name: '🏅 Milestone', value: label,              inline: true },
    )
    .setFooter({ text: `RCRP Honor System — ${BRAND}` })
    .setTimestamp();
}

module.exports = { base, success, error, warning, info, mdtEmergency, mdtDispatch, shiftCard, profileCard, reviewPanel, selfRolesPanel, shiftLog, honorPromotion };
