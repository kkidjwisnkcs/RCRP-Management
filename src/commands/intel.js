// intel.js — /intel command
// Staff-only command to pull a deep intel profile on any Roblox player.
'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const intelSystem = require('../modules/intelSystem');
const config      = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('intel')
    .setDescription('Pull a deep intel report on any Roblox player from RCRP game data.')
    .addStringOption(opt =>
      opt.setName('username')
        .setDescription('Roblox username or User ID to look up')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const username = interaction.options.getString('username').trim();
    await intelSystem.runIntel(interaction, username);
  },
};
