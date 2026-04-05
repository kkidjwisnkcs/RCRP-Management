// /profile — Staff profile card with session stats
  const { SlashCommandBuilder } = require('discord.js');
  const config = require('../config');
  const db     = require('../utils/discordDb');
  const embeds = require('../utils/embeds');
  const erlc   = require('../utils/erlc');
  const perms  = require('../utils/permissions');

  module.exports = {
    data: new SlashCommandBuilder()
      .setName('profile')
      .setDescription('View a staff member profile card with in-game history.')
      .addUserOption(o => o
        .setName('member')
        .setDescription('Staff member to look up (defaults to you)')
        .setRequired(false)
      ),

    async execute(interaction) {
      await interaction.deferReply({ ephemeral: false });

      const target = interaction.options.getMember('member') || interaction.member;
      const guild  = interaction.guild;

      // Fetch verify DB
      const verifyCh = guild.channels.cache.get(config.channels.verifyDatabase);
      if (!verifyCh) return interaction.editReply({ content: 'Verify database not configured.' });

      const { users } = await db.getVerifyDb(verifyCh);
      const entry = users.find(u => u.discordId === target.id && u.status === 'active');

      if (!entry) {
        return interaction.editReply({ content: target.id === interaction.user.id
          ? 'You are not verified. Use /verify first.'
          : target.displayName + ' is not verified in the RCRP database.' });
      }

      // Fetch game DB history
      const gameCh = guild.channels.cache.get(config.channels.gameDatabase);
      const appearances = [];
      if (gameCh) {
        try {
          const files = await db.readAllFiles(gameCh, 100);
          for (const f of files) {
            const p = (f.data?.players || []).find(pl => String(pl.userId || pl._userId) === String(entry.robloxId));
            if (p) appearances.push({
              ts:       f.data?._meta?.timestamp || new Date(f.timestamp).toISOString(),
              team:     p.team || p._team || '?',
              vehicle:  p.vehicle || p._vehicle || null,
              modCalls: 0,
            });
          }
        } catch {}
      }

      const snapshot     = erlc.getCachedSnapshot();
      const livePlayer   = snapshot ? erlc.findPlayerById(entry.robloxId) || erlc.findPlayerByName(entry.robloxUsername) : null;
      const currentStatus = livePlayer ? '🟢 In-Game (' + (livePlayer._team || '?') + ')' : '🔴 Off-Duty';
      const currentTeam   = livePlayer?._team || null;

      // Aggregate stats
      const totalMins = appearances.length * 2;  // each snapshot = ~2min interval
      const teams     = [...new Set(appearances.map(a => a.team).filter(Boolean))];
      const vehicles  = [...new Set(appearances.map(a => a.vehicle).filter(Boolean))];

      const embed = embeds.profileCard({
        member:        target,
        robloxUsername: entry.robloxUsername || '?',
        robloxId:      entry.robloxId,
        verifiedAt:    entry.verifiedAt,
        sessions:      appearances.length,
        totalMins,
        modCalls:      0,
        teams,
        vehicles,
        currentStatus,
        currentTeam,
      });

      return interaction.editReply({ embeds: [embed] });
    },
  };
  