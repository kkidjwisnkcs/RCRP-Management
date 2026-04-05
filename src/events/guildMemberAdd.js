// guildMemberAdd.js — Member Join Logger
// Logs every new member join to the staff logs channel.
// Flags if the joining member is already a verified staff member (unlikely, but covered).

'use strict';

const { EmbedBuilder } = require('discord.js');
const config           = require('../config');

module.exports = {
  name: 'guildMemberAdd',
  once: false,

  async execute(member, client) {
    try {
      const logCh = client.channels.cache.get(config.channels.logs);
      if (!logCh) return;

      // Check if this person has staff roles already (rejoining staff)
      const isStaff = member.roles.cache.some(r =>
        Object.values(config.roles).includes(r.id) &&
        !['verified', 'unverified'].includes(Object.keys(config.roles).find(k => config.roles[k] === r.id))
      );

      const embed = new EmbedBuilder()
        .setColor(isStaff ? config.colors.warning : config.colors.success)
        .setTitle(isStaff ? '⚠️  Staff Member Joined' : '👋  New Member Joined')
        .setThumbnail(member.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '👤 User',       value: `${member} (${member.user.tag})`, inline: true },
          { name: '🆔 ID',         value: member.id,                         inline: true },
          { name: '📅 Account Age', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: '👥 Server Count', value: `${member.guild.memberCount} members`, inline: true },
          { name: '🏷️ Roles',       value: member.roles.cache.size > 1 ? member.roles.cache.map(r => r.name).filter(n => n !== '@everyone').join(', ').slice(0, 300) : 'None', inline: false },
        )
        .setFooter({ text: `RCRP Join Logger — ${isStaff ? 'Staff join flagged' : 'Standard join'}` })
        .setTimestamp();

      await logCh.send({ embeds: [embed] });
    } catch (err) {
      console.error('[GuildMemberAdd] Error:', err.message);
    }
  },
};
