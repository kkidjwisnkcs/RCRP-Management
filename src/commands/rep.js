// rep.js — /rep command
// Community reputation system — give rep and view rep profiles.
'use strict';

const { SlashCommandBuilder } = require('discord.js');
const reputationSystem = require('../modules/reputationSystem');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rep')
    .setDescription('Community reputation — give rep or view a rep profile.')
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View rep profile for yourself or another member.')
        .addUserOption(opt =>
          opt.setName('member')
            .setDescription('Member to view (leave blank for yourself)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('give')
        .setDescription('Give +1 reputation to a community member (once per 24h per person).')
        .addUserOption(opt =>
          opt.setName('member')
            .setDescription('The member to give rep to')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      const user   = interaction.options.getUser('member');
      const target = user ? await interaction.guild.members.fetch(user.id).catch(() => null) : interaction.member;
      if (!target) return interaction.reply({ content: '❌ Member not found.', ephemeral: true });
      return reputationSystem.viewRep(interaction, target);
    }

    if (sub === 'give') {
      const user   = interaction.options.getUser('member');
      const target = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!target) return interaction.reply({ content: '❌ Member not found.', ephemeral: true });
      return reputationSystem.giveRep(interaction, target);
    }
  },
};
