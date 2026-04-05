// ============================================================
// /erlc — ERLC server management and info commands
// Subcommands: players, staff, info
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const erlc = require('../utils/erlc');
const config = require('../config');
const perms = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('erlc')
    .setDescription('ERLC Server management and information commands.')
    .addSubcommand(sub => sub
      .setName('players')
      .setDescription('List all players currently in the ERLC server.')
    )
    .addSubcommand(sub => sub
      .setName('staff')
      .setDescription('List all staff members currently on-duty in the ERLC server.')
    )
    .addSubcommand(sub => sub
      .setName('info')
      .setDescription('Get detailed information about the ERLC server status.')
    ),

  async execute(interaction) {
    // Only staff can use these commands to avoid exposing player data to everyone
    if (!perms.isStaff(interaction.member)) {
      return perms.denyPermission(interaction, 'Staff');
    }

    await interaction.deferReply({ ephemeral: true });

    const sub = interaction.options.getSubcommand();
    const snapshot = erlc.getCachedSnapshot();

    if (!snapshot || !snapshot.server) {
      return interaction.editReply({
        content: '❌ **ERLC Data Unavailable.** The bot might still be fetching data or the API key is invalid.',
      });
    }

    if (sub === 'players') {
      const players = snapshot.players || [];
      if (players.length === 0) {
        return interaction.editReply({ content: '🏜️ **The server is currently empty.**' });
      }

      // Group players by team
      const teams = {};
      players.forEach(p => {
        const teamName = p.Team || 'Unassigned';
        if (!teams[teamName]) teams[teamName] = [];
        
        // Handle both string and object formats
        let name = 'Unknown';
        if (typeof p.Player === 'string') {
          name = p.Player.split(':')[0];
        } else if (p.Player?.Name) {
          name = p.Player.Name;
        }
        
        teams[teamName].push(name);
      });

      const embed = new EmbedBuilder()
        .setColor(config.colors.primary)
        .setTitle(`👥  Players in ${snapshot.server.Name || 'ERLC Server'}`)
        .setDescription(`Total Players: **${players.length}/${snapshot.server.MaxPlayers || 'N/A'}**`)
        .setFooter({ text: 'RCRP Management • ERLC Real-Time Data' })
        .setTimestamp();

      for (const [team, members] of Object.entries(teams)) {
        embed.addFields({ name: team, value: members.join(', ') || 'None', inline: false });
      }

      await interaction.editReply({ embeds: [embed] });

    } else if (sub === 'staff') {
      const players = snapshot.players || [];
      // ERLC API often uses 'Permission' field to indicate staff/owner status
      const staff = players.filter(p => p.Permission && p.Permission !== 'None');

      if (staff.length === 0) {
        return interaction.editReply({ content: '🛡️ **No staff members are currently in-game.**' });
      }

      const embed = new EmbedBuilder()
        .setColor(config.colors.success)
        .setTitle('🛡️  On-Duty ERLC Staff')
        .setDescription('Current staff members active in the private server:')
        .setTimestamp();

      staff.forEach(s => {
        let name = 'Unknown';
        if (typeof s.Player === 'string') {
          name = s.Player.split(':')[0];
        } else if (s.Player?.Name) {
          name = s.Player.Name;
        }
        embed.addFields({ name: name, value: `Rank: **${s.Permission}** | Team: **${s.Team}**`, inline: false });
      });

      await interaction.editReply({ embeds: [embed] });

    } else if (sub === 'info') {
      const cacheAge = erlc.getCacheAge();
      const server = snapshot.server;

      const embed = new EmbedBuilder()
        .setColor(config.colors.primary)
        .setTitle(`📡  ${server.Name || 'Server'} Status`)
        .addFields(
          { name: '🎮 Server Name',     value: server.Name || 'N/A',            inline: true },
          { name: '👥 Players',         value: `${snapshot.players.length}/${server.MaxPlayers || 'N/A'}`, inline: true },
          { name: '🛠️ Version',         value: server.Version || 'N/A',         inline: true },
          { name: '🛡️ Owner ID',        value: String(server.OwnerId || 'N/A'), inline: true },
          { name: '⏱️ Cache Age',       value: `${cacheAge}s ago`,              inline: true },
          { name: '📡 API Status',      value: '🟢 Operational',                inline: true }
        )
        .setFooter({ text: 'RCRP Management • System Diagnostics' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  },
};
