// /game — ERLC oversight and in-game command runner
const {
  SlashCommandBuilder, EmbedBuilder,
} = require('discord.js');
const erlc   = require('../utils/erlc');
const config = require('../config');
const perms  = require('../utils/permissions');
const db     = require('../utils/discordDb');

// Permission levels from ERLC API
const STAFF_PERMS = ['Moderator', 'Admin', 'ServerOwner', 'Owner', 'GameOwner'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('game')
    .setDescription('ERLC server oversight and in-game commands.')
    .addSubcommand(s => s.setName('status').setDescription('Show ERLC API connection status.'))
    .addSubcommand(s => s.setName('overview').setDescription('Full server snapshot.'))
    .addSubcommand(s => s.setName('players').setDescription('List all players currently in-game.'))
    .addSubcommand(s => s.setName('staff').setDescription('List all staff/permission members in-game.'))
    .addSubcommand(s => s.setName('vehicles').setDescription('List all spawned vehicles with plates and colors.'))
    .addSubcommand(s => s.setName('modcalls').setDescription('Show active mod calls.'))
    .addSubcommand(s => s.setName('emergency').setDescription('Show active 911 emergency calls from ERLC.'))
    .addSubcommand(s => s
      .setName('player')
      .setDescription('Detailed dossier on a specific player.')
      .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('team')
      .setDescription('List all players on a specific team.')
      .addStringOption(o => o.setName('name').setDescription('Team name').setRequired(true)
        .addChoices(
          { name: 'Police',   value: 'Police' },
          { name: 'Fire',     value: 'Fire' },
          { name: 'EMS',      value: 'EMS' },
          { name: 'Criminal', value: 'Criminal' },
          { name: 'Civilian', value: 'Civilian' },
          { name: 'DOT',      value: 'DOT' },
          { name: 'Sheriff',  value: 'Sheriff' },
        ))
    )
    .addSubcommand(s => s
      .setName('action')
      .setDescription('Run an in-game command from Discord (Staff only).')
      .addStringOption(o => o
        .setName('command')
        .setDescription('Select the action to run')
        .setRequired(true)
        .addChoices(
          { name: ':m Message All (server-wide)',   value: ':m' },
          { name: ':h Hint (yellow banner)',         value: ':h' },
          { name: ':n Notification (red banner)',    value: ':n' },
          { name: ':pm Private Message a player',   value: ':pm' },
          { name: ':kick Kick a player',            value: ':kick' },
          { name: ':ban Ban a player',              value: ':ban' },
          { name: ':unban Unban a player',          value: ':unban' },
          { name: ':to Teleport to player',         value: ':to' },
          { name: ':bring Teleport player to you',  value: ':bring' },
          { name: ':respawn Respawn a player',      value: ':respawn' },
          { name: ':slock Server lock',             value: ':slock' },
          { name: ':unslock Server unlock',         value: ':unslock' },
        ))
      .addStringOption(o => o.setName('text').setDescription('Message text or reason').setRequired(false))
      .addStringOption(o => o.setName('player').setDescription('Target player username').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('killlogs')
      .setDescription('Recent kill events.')
      .addIntegerOption(o => o.setName('limit').setDescription('How many (max 25)').setMinValue(1).setMaxValue(25))
    )
    .addSubcommand(s => s
      .setName('commandlogs')
      .setDescription('Recent in-game command usage.')
      .addIntegerOption(o => o.setName('limit').setDescription('How many (max 25)').setMinValue(1).setMaxValue(25))
    )
    .addSubcommand(s => s
      .setName('joinlogs')
      .setDescription('Recent join/leave events.')
      .addIntegerOption(o => o.setName('limit').setDescription('How many (max 25)').setMinValue(1).setMaxValue(25))
    )
    .addSubcommand(s => s.setName('verify').setDescription('Cross-ref in-game players with Discord verification.')),

  async execute(interaction) {
    if (!perms.isStaff(interaction.member)) return perms.denyPermission(interaction, 'Staff');

    const sub = interaction.options.getSubcommand();

    // /game action — runs ERLC command, posted to channel so team sees it
    if (sub === 'action') {
      const cmd    = interaction.options.getString('command');
      const text   = interaction.options.getString('text')   || '';
      const target = interaction.options.getString('player') || '';

      let fullCmd = cmd;
      if (target && text) fullCmd = cmd + ' ' + target + ' ' + text;
      else if (target)    fullCmd = cmd + ' ' + target;
      else if (text)      fullCmd = cmd + ' ' + text;

      await interaction.deferReply({ ephemeral: false });

      // Log command to logs channel (Melonly-style command log)
      const logCh = interaction.guild.channels.cache.get(config.channels.logs);
      if (logCh) {
        const actionEmbed = new EmbedBuilder()
          .setColor(config.colors.warning)
          .setTitle('🛠️ In-Game Command Issued')
          .addFields(
            { name: '📡 Command',  value: '`' + fullCmd + '`',                    inline: false },
            { name: '👮 Issued By', value: `${interaction.member.displayName} (<@${interaction.user.id}>)`, inline: true },
            { name: '⏰ Time',      value: `<t:${Math.floor(Date.now() / 1000)}:T>`, inline: true },
          )
          .setFooter({ text: 'RCRP Game Action Log' })
          .setTimestamp();
        await logCh.send({ embeds: [actionEmbed] }).catch(() => {});
      }

      const result = await erlc.sendCommand(fullCmd);
      const embed  = new EmbedBuilder()
        .setColor(result.ok ? config.colors.success : config.colors.danger)
        .setTitle(result.ok ? '✅ Command Sent to ERLC' : '❌ Command Failed')
        .addFields(
          { name: 'Command',  value: '`' + fullCmd + '`',               inline: false },
          { name: 'Run By',   value: '<@' + interaction.user.id + '>',  inline: true },
          { name: 'Status',   value: result.ok ? 'Executed in-game' : (result.error || 'Unknown error'), inline: true },
        )
        .setFooter({ text: 'RCRP Management In-Game Command Runner' })
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    await interaction.deferReply({ ephemeral: false });
    const snapshot = erlc.getCachedSnapshot();
    const cacheAge = erlc.getCacheAge();
    const lastErr  = erlc.getLastError();

    if (sub === 'status') {
      const embed = new EmbedBuilder()
        .setColor(snapshot ? config.colors.success : config.colors.danger)
        .setTitle('ERLC API Status')
        .addFields(
          { name: 'API Key Set',       value: process.env.ERLC_API_KEY ? 'Yes' : 'Not set', inline: true },
          { name: 'Cache Available',   value: snapshot ? 'Yes' : 'No data yet',              inline: true },
          { name: 'Cache Age',         value: cacheAge >= 0 ? (cacheAge + 's ago') : 'Never', inline: true },
          { name: 'Players In-Game',   value: String(snapshot?.players?.length ?? 'N/A'),    inline: true },
          { name: 'Stale Data',        value: snapshot?._stale ? 'Yes' : 'No',               inline: true },
          { name: 'Consecutive Fails', value: String(erlc.getConsecFails()),                  inline: true },
          { name: 'Last Error',        value: lastErr ? lastErr.slice(0, 400) : 'None',       inline: false },
        )
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (!snapshot) return interaction.editReply({ content: lastErr ? ('No ERLC data.\n\n' + lastErr.slice(0, 300)) : 'No ERLC data yet — polling every 20s, try again shortly.' });

    if (sub === 'overview') {
      const srv = snapshot.server || {};
      const teams = {};
      for (const p of snapshot.players || []) teams[p._team] = (teams[p._team] || 0) + 1;
      const embed = new EmbedBuilder()
        .setColor(config.colors.primary)
        .setTitle('RCRP — Live Server Overview')
        .addFields(
          { name: '👥 Players',  value: String(snapshot.players.length),                       inline: true },
          { name: '🔒 Max',      value: String(srv.MaxPlayers || '?'),                          inline: true },
          { name: '⏱️ Data Age', value: cacheAge + 's',                                         inline: true },
          { name: '🔑 Join Key', value: srv.JoinKey || 'N/A',                                   inline: true },
          { name: '🚨 911 Calls', value: String(snapshot.emergencyCalls?.length || 0),          inline: true },
          { name: '📞 Mod Calls', value: String(snapshot.modCalls?.length || 0),                inline: true },
          { name: '📊 Teams',    value: Object.entries(teams).map(([t, n]) => t + ': ' + n).join('\n') || 'None', inline: false },
        )
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'players') {
      const players = snapshot.players || [];
      if (!players.length) return interaction.editReply({ content: 'No players in-game right now.' });
      const lines = players.map(p =>
        '**' + p._username + '** — ' + p._team +
        (p._vehicle ? ' | ' + p._vehicle : '') +
        (p._callsign ? ' [' + p._callsign + ']' : '') +
        (p._wantedStars > 0 ? ' ' + '⭐'.repeat(Math.min(p._wantedStars, 5)) : '')
      );
      const chunks = [];
      let cur = '';
      for (const l of lines) { if ((cur + '\n' + l).length > 3900) { chunks.push(cur); cur = l; } else cur = cur ? cur + '\n' + l : l; }
      if (cur) chunks.push(cur);
      const ea = chunks.slice(0, 5).map((c, i) => new EmbedBuilder().setColor(config.colors.primary).setTitle(i === 0 ? ('In-Game Players (' + players.length + ')') : 'Players (cont.)').setDescription(c).setFooter({ text: cacheAge + 's ago' }));
      return interaction.editReply({ embeds: ea });
    }

    if (sub === 'staff') {
      // BUG FIX: check both _permission field AND cross-reference with verify DB
      // Some staff have non-standard permission strings in ERLC — we cast a wider net
      let staff = (snapshot.players || []).filter(p => {
        const perm = (p._permission || '').toLowerCase();
        // ERLC permission levels: Moderator, Admin, ServerOwner, Owner, GameOwner
        return perm && perm !== 'none' && perm !== 'normal' && perm !== 'civilian' && perm !== 'player' && perm !== '';
      });

      // Also cross-reference with verify DB to find any Discord staff in game
      // even if ERLC shows them as 'Normal'
      try {
        const verifyCh = interaction.guild.channels.cache.get(config.channels.verifyDatabase);
        if (verifyCh) {
          const { users } = await db.getVerifyDb(verifyCh);
          const discordStaffRobloxIds = new Set(
            users
              .filter(u => {
                const m = interaction.guild.members.cache.get(u.discordId);
                return m && perms.isStaff(m);
              })
              .map(u => u.robloxId)
          );

          // Add players who are Discord staff but not already in the staff list
          const alreadyInList = new Set(staff.map(p => p._userId));
          const additionalStaff = (snapshot.players || []).filter(p =>
            discordStaffRobloxIds.has(p._userId) && !alreadyInList.has(p._userId)
          );
          staff = [...staff, ...additionalStaff];
        }
      } catch {}

      if (!staff.length) {
        return interaction.editReply({
          content: [
            '**No staff currently in-game.**',
            '',
            '> This means no players with ERLC mod/admin permissions were found,',
            '> and no Discord staff members could be matched to in-game players.',
            '> If you believe someone is in-game, they may not be verified or may have just joined.',
          ].join('\n'),
        });
      }

      // Cross-ref with verify DB for Discord tags
      let verifiedMap = new Map();
      try {
        const verifyCh = interaction.guild.channels.cache.get(config.channels.verifyDatabase);
        if (verifyCh) {
          const { users } = await db.getVerifyDb(verifyCh);
          verifiedMap = new Map(users.filter(u => u.status === 'active').map(u => [u.robloxId, u]));
        }
      } catch {}

      const lines = staff.map(p => {
        const linked = verifiedMap.get(p._userId);
        const tag    = linked ? ` (<@${linked.discordId}>)` : '';
        return `**${p._username}**${tag} — ${p._permission || 'Staff'}` +
          (p._callsign ? ` [${p._callsign}]` : '') +
          (p._vehicle  ? ` | ${p._vehicle}`  : '');
      });

      const embed = new EmbedBuilder()
        .setColor(config.colors.blue)
        .setTitle(`🛡️ In-Game Staff (${staff.length})`)
        .setDescription(lines.join('\n').slice(0, 4096))
        .setFooter({ text: `${cacheAge}s ago • Cross-referenced with Discord verification` })
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'vehicles') {
      const vehicles = snapshot.vehicles || [];
      if (!vehicles.length) return interaction.editReply({ content: 'No vehicles spawned right now.' });
      const lines = vehicles.map(v =>
        '**' + (v.Name || 'Unknown') + '** — ' + (v.Owner || '?') +
        (v.Plate     ? ' | `' + v.Plate + '`' : '') +
        (v.ColorName ? ' | ' + v.ColorName    : '') +
        (v.ColorHex  ? ' (' + v.ColorHex + ')' : '')
      );
      const chunks = [];
      let cur = '';
      for (const l of lines) { if ((cur + '\n' + l).length > 3900) { chunks.push(cur); cur = l; } else cur = cur ? cur + '\n' + l : l; }
      if (cur) chunks.push(cur);
      const ea = chunks.slice(0, 5).map((c, i) => new EmbedBuilder().setColor(config.colors.primary).setTitle(i === 0 ? ('Spawned Vehicles (' + vehicles.length + ')') : 'Vehicles (cont.)').setDescription(c).setFooter({ text: cacheAge + 's ago' }));
      return interaction.editReply({ embeds: ea });
    }

    if (sub === 'modcalls') {
      const calls = snapshot.modCalls || [];
      if (!calls.length) return interaction.editReply({ content: 'No active mod calls right now.' });
      const embed = new EmbedBuilder().setColor(config.colors.warning).setTitle('Active Mod Calls (' + calls.length + ')')
        .setDescription(calls.map(c => '**' + (c.Caller || '?') + '** — ' + (c.Message || c.CallMessage || 'No message') + (c.Timestamp ? ' (<t:' + c.Timestamp + ':R>)' : '')).join('\n').slice(0, 4096))
        .setFooter({ text: cacheAge + 's ago' }).setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'emergency') {
      const calls = snapshot.emergencyCalls || [];
      if (!calls.length) return interaction.editReply({ content: 'No active 911 calls right now. All clear!' });
      const embed = new EmbedBuilder().setColor(config.colors.danger).setTitle('🚨 Active 911 Emergency Calls (' + calls.length + ')')
        .setDescription(calls.map(c =>
          '**Call #' + (c.CallNumber || '?') + '** — ' + (c.Team || 'Unknown') + ' needed\n' +
          '> 📍 ' + (c.PositionDescriptor || 'Unknown location') + '\n' +
          '> 📋 ' + (c.Description || 'No description') + '\n' +
          '> ⏰ <t:' + (c.StartedAt || Math.floor(Date.now() / 1000)) + ':R>'
        ).join('\n\n').slice(0, 4096))
        .setFooter({ text: cacheAge + 's ago' }).setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'player') {
      const username = interaction.options.getString('username');
      const p = erlc.findPlayerByName(username);
      if (!p) return interaction.editReply({ content: 'No player named **' + username + '** found in-game.' });
      const stars = (p._wantedStars || 0) > 0 ? '⭐'.repeat(Math.min(p._wantedStars, 5)) : 'Clean';
      const loc   = p._location ? ('Postal ' + (p._location.PostalCode || '?') + ' — ' + (p._location.StreetName || '?')) : 'Unknown';
      const embed = new EmbedBuilder().setColor(config.colors.primary).setTitle('Player — ' + p._username)
        .addFields(
          { name: 'Roblox ID',  value: '`' + p._userId + '`', inline: true },
          { name: 'Team',       value: p._team || 'Unknown',    inline: true },
          { name: 'Permission', value: p._permission || 'None', inline: true },
          { name: 'Callsign',   value: p._callsign || 'None',   inline: true },
          { name: 'Wanted',     value: stars,                    inline: true },
          { name: 'Vehicle',    value: p._vehicle || 'On foot',  inline: true },
          { name: 'Plate',      value: p._vehiclePlate || '—',  inline: true },
          { name: 'Color',      value: p._vehicleColor || '—',  inline: true },
          { name: 'Location',   value: loc,                      inline: false },
        )
        .setFooter({ text: cacheAge + 's ago' }).setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'team') {
      const team    = interaction.options.getString('name');
      const members = erlc.getPlayersByTeam(team);
      if (!members.length) return interaction.editReply({ content: 'No players on **' + team + '** right now.' });
      const embed = new EmbedBuilder().setColor(config.colors.primary).setTitle(team + ' Team (' + members.length + ')')
        .setDescription(members.map(p => '**' + p._username + '**' + (p._callsign ? ' [' + p._callsign + ']' : '') + (p._vehicle ? ' — ' + p._vehicle : '')).join('\n').slice(0, 4096))
        .setFooter({ text: cacheAge + 's ago' }).setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'killlogs') {
      const limit = interaction.options.getInteger('limit') || 10;
      const logs  = (snapshot.killLogs || []).slice(-limit);
      if (!logs.length) return interaction.editReply({ content: 'No kill logs available.' });
      const embed = new EmbedBuilder().setColor(config.colors.danger).setTitle('Kill Logs (last ' + logs.length + ')')
        .setDescription(logs.map(l => '**' + (l.Killer || '?') + '** killed **' + (l.Killed || '?') + '**' + (l.Timestamp ? ' <t:' + l.Timestamp + ':R>' : '')).join('\n').slice(0, 4096))
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'commandlogs') {
      const limit = interaction.options.getInteger('limit') || 10;
      const logs  = (snapshot.commandLogs || []).slice(-limit);
      if (!logs.length) return interaction.editReply({ content: 'No command logs available.' });
      const embed = new EmbedBuilder().setColor(config.colors.neutral).setTitle('Command Logs (last ' + logs.length + ')')
        .setDescription(logs.map(l => '**' + (l.Player || '?') + '**: `' + (l.Command || '?') + '`' + (l.Timestamp ? ' <t:' + l.Timestamp + ':R>' : '')).join('\n').slice(0, 4096))
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'joinlogs') {
      const limit = interaction.options.getInteger('limit') || 10;
      const logs  = (snapshot.joinLogs || []).slice(-limit);
      if (!logs.length) return interaction.editReply({ content: 'No join logs available.' });
      const embed = new EmbedBuilder().setColor(config.colors.neutral).setTitle('Join/Leave Logs (last ' + logs.length + ')')
        .setDescription(logs.map(l => (l.Join ? '✅' : '❌') + ' **' + (l.Player || '?') + '**' + (l.Timestamp ? ' <t:' + l.Timestamp + ':R>' : '')).join('\n').slice(0, 4096))
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'verify') {
      const verifyCh = interaction.guild.channels.cache.get(config.channels.verifyDatabase);
      if (!verifyCh) return interaction.editReply({ content: 'Verify database channel not found.' });
      const { users } = await db.getVerifyDb(verifyCh);
      const verifiedMap = new Map(users.filter(u => u.status === 'active').map(u => [u.robloxUsername?.toLowerCase(), u]));
      const inGame = snapshot.players || [];
      const linked = [], unlinked = [];
      for (const p of inGame) {
        const v = verifiedMap.get(p._username.toLowerCase());
        if (v) linked.push('✅ **' + p._username + '** → <@' + v.discordId + '>');
        else    unlinked.push('❓ **' + p._username + '** — not linked');
      }
      const desc = [...linked, ...unlinked].join('\n') || 'No players in-game.';
      const embed = new EmbedBuilder().setColor(config.colors.primary)
        .setTitle('In-Game Verification Cross-Reference')
        .setDescription(desc.slice(0, 4096))
        .addFields({ name: 'Verified', value: String(linked.length), inline: true }, { name: 'Unlinked', value: String(unlinked.length), inline: true })
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }
  },
};
