// ============================================================
// /internal-ask — HR/Staff AI evidence search across game logs
// ============================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');
const perms  = require('../utils/permissions');
const db     = require('../utils/discordDb');
const ai     = require('../utils/ai');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('internal-ask')
    .setDescription('[HR/Staff Only] AI-powered search of all game logs for evidence.')
    .addStringOption(o => o
      .setName('query')
      .setDescription('What do you want to investigate? (e.g. "Show kills by Kushal on 2026-03-30")')
      .setRequired(true)
    )
    .addUserOption(o => o
      .setName('target')
      .setDescription('Optional: filter results to a specific Discord user')
      .setRequired(false)
    )
    .addStringOption(o => o
      .setName('date')
      .setDescription('Optional: filter to a specific date (YYYY-MM-DD)')
      .setRequired(false)
    ),

  async execute(interaction) {
    if (!perms.isHR(interaction.member)) {
      return perms.denyPermission(interaction, 'HR / Management');
    }

    await interaction.deferReply({ ephemeral: true });

    const query      = interaction.options.getString('query');
    const targetUser = interaction.options.getUser('target');
    const dateFilter = interaction.options.getString('date');

    try {
      // Resolve Roblox ID if target user provided
      let robloxInfo = null;
      if (targetUser) {
        const verifyChannel = interaction.guild.channels.cache.get(config.channels.verifyDatabase);
        if (verifyChannel) {
          const { users } = await db.getVerifyDb(verifyChannel);
          robloxInfo = users.find(u => u.discordId === targetUser.id && u.status === 'active');
        }
      }

      // Fetch game-database files
      const gameChannel = interaction.guild.channels.cache.get(config.channels.gameDatabase);
      if (!gameChannel) {
        return interaction.editReply({ content: '❌ Game database channel not found.' });
      }

      const allFiles = await db.readAllFiles(gameChannel, 100);

      // Filter by date if provided
      const filtered = dateFilter
        ? allFiles.filter(f => (f.data?.fetchedAt || '').startsWith(dateFilter))
        : allFiles;

      if (!filtered.length) {
        return interaction.editReply({
          content: `❌ No game data found${dateFilter ? ` for date ${dateFilter}` : ''}.`,
        });
      }

      // Build context string for AI
      let contextParts = [];

      if (robloxInfo) {
        contextParts.push(`Target User: ${targetUser.tag} | Roblox: ${robloxInfo.robloxUsername} (ID: ${robloxInfo.robloxId})`);
      }

      // Extract relevant data from files
      const killEvents    = [];
      const cmdEvents     = [];
      const modCallEvents = [];
      const playerSessions = [];

      for (const file of filtered.slice(-50)) { // Last 50 files to stay under token limit
        const data = file.data;
        const ts   = data?._meta?.timestamp || new Date(file.timestamp).toISOString();

        // Kill logs
        if (data?.killLogs?.length) {
          for (const kill of data.killLogs) {
            const entry = `[${ts}] ${kill.Killer || '?'} killed ${kill.Killed || '?'} (weapon: ${kill.Weapon || 'unknown'})`;
            if (!robloxInfo || entry.includes(robloxInfo.robloxUsername) || entry.includes(String(robloxInfo.robloxId))) {
              killEvents.push(entry);
            }
          }
        }

        // Command logs
        if (data?.commandLogs?.length) {
          for (const cmd of data.commandLogs) {
            const entry = `[${ts}] ${cmd.Player || '?'} ran: ${cmd.Command || '?'}`;
            if (!robloxInfo || entry.includes(robloxInfo.robloxUsername) || entry.includes(String(robloxInfo.robloxId))) {
              cmdEvents.push(entry);
            }
          }
        }

        // Mod calls
        if (data?.modCalls?.length) {
          for (const mc of data.modCalls) {
            modCallEvents.push(`[${ts}] ${mc.Caller || '?'}: ${mc.Message || '?'}`);
          }
        }

        // Player presence
        if (data?.players?.length && robloxInfo) {
          const found = data.players.find(p => String(p.Player?.UserId) === String(robloxInfo.robloxId));
          if (found) {
            playerSessions.push(`[${ts}] Online — Team: ${found.Team}, Vehicle: ${found.Vehicle || 'On foot'}, Callsign: ${found.Player?.Callsign || 'N/A'}`);
          }
        }
      }

      const dataContext = [
        robloxInfo ? `=== USER INFO ===\n${contextParts.join('\n')}` : '',
        killEvents.length    ? `=== KILL LOGS (${killEvents.length}) ===\n${killEvents.slice(-30).join('\n')}` : '',
        cmdEvents.length     ? `=== COMMAND LOGS (${cmdEvents.length}) ===\n${cmdEvents.slice(-30).join('\n')}` : '',
        modCallEvents.length ? `=== MOD CALLS (${modCallEvents.length}) ===\n${modCallEvents.slice(-20).join('\n')}` : '',
        playerSessions.length ? `=== PLAYER SESSIONS (${playerSessions.length}) ===\n${playerSessions.slice(-30).join('\n')}` : '',
      ].filter(Boolean).join('\n\n');

      if (!dataContext.trim()) {
        return interaction.editReply({ content: '❌ No relevant data found for your query.' });
      }

      // Ask AI
      const result = await ai.internalAsk(query, dataContext);

      // Split if long
      const embed = new EmbedBuilder()
        .setColor(config.colors.neutral)
        .setTitle('🔍  Internal Investigation Report')
        .setDescription(result.length > 4096 ? result.slice(0, 4093) + '...' : result)
        .addFields(
          { name: '🔎 Query',    value: query,                                     inline: false },
          { name: '📁 Files Scanned', value: String(filtered.length),              inline: true  },
          { name: '👤 Target',   value: robloxInfo ? robloxInfo.robloxUsername : 'All users', inline: true },
          { name: '📅 Date Filter', value: dateFilter || 'All dates',              inline: true  },
          { name: '🕵️ Requested By', value: interaction.user.toString(),           inline: true  },
        )
        .setFooter({ text: 'RCRP Management Internal Affairs • Confidential' })
        .setTimestamp();

      // Also post to hr-central
      const hrChannel = interaction.guild.channels.cache.get(config.channels.hrCentral);
      if (hrChannel) {
        await hrChannel.send({ embeds: [embed] });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('[InternalAsk] Error:', err.message);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};
