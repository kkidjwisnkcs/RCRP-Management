// broadcast.js — /broadcast command
// Sends styled server broadcasts to any channel, with role pings.
'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const serverBroadcast = require('../modules/serverBroadcast');

const TYPES = ['general', 'session', 'event', 'alert', 'staff', 'shutdown'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('broadcast')
    .setDescription('Send a styled server-wide broadcast announcement.')
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Type of broadcast')
        .setRequired(true)
        .addChoices(
          { name: '📢 General Announcement', value: 'general' },
          { name: '🟢 Session Announcement', value: 'session' },
          { name: '🏆 Community Event',       value: 'event'   },
          { name: '🚨 Staff Alert',            value: 'alert'   },
          { name: '👥 Staff Announcement',     value: 'staff'   },
          { name: '🔴 Server Shutdown Notice', value: 'shutdown'},
        )
    )
    .addStringOption(opt =>
      opt.setName('title')
        .setDescription('Broadcast title / headline')
        .setRequired(true)
        .setMaxLength(256)
    )
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('Full broadcast message body')
        .setRequired(true)
        .setMaxLength(1800)
    )
    .addStringOption(opt =>
      opt.setName('channel')
        .setDescription('Channel ID or name (defaults to #announcements)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const type    = interaction.options.getString('type');
    const title   = interaction.options.getString('title');
    const message = interaction.options.getString('message');
    const channel = interaction.options.getString('channel');
    await serverBroadcast.broadcast(interaction, type, title, message, channel);
  },
};
