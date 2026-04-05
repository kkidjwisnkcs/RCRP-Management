// ============================================================
// /management — Management command group
// Subcommands: staff actions, partnerships, server, announce
// Management+ roles only. Cleaned up — no useless commands.
// ============================================================

const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const config  = require('../config');
const perms   = require('../utils/permissions');
const db      = require('../utils/discordDb');
const erlc    = require('../utils/erlc');

let partnerships = [];
let partnershipsLoaded = false;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('management')
    .setDescription('Management commands — staff actions, partnerships, and server management.')

    // ── /management staff ──────────────────────────────────
    .addSubcommandGroup(group => group
      .setName('staff')
      .setDescription('Game Staff Team management actions.')
      .addSubcommand(sub => sub
        .setName('promote')
        .setDescription('Promote a staff member.')
        .addUserOption(o => o.setName('member').setDescription('Staff member to promote').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('New role to assign').setRequired(true))
        .addStringOption(o => o.setName('note').setDescription('Promotion note').setRequired(false))
      )
      .addSubcommand(sub => sub
        .setName('demote')
        .setDescription('Demote a staff member.')
        .addUserOption(o => o.setName('member').setDescription('Staff member').setRequired(true))
        .addRoleOption(o => o.setName('remove_role').setDescription('Role to remove').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
      )
      .addSubcommand(sub => sub
        .setName('fire')
        .setDescription('Remove a member from staff.')
        .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
      )
      .addSubcommand(sub => sub
        .setName('strike')
        .setDescription('Issue a strike to a member.')
        .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true))
        .addStringOption(o => o.setName('level').setDescription('Strike level').setRequired(true)
          .addChoices({ name: 'Strike 1', value: '1' }, { name: 'Strike 2', value: '2' }, { name: 'Strike 3', value: '3' }))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
      )
      .addSubcommand(sub => sub
        .setName('unstrike')
        .setDescription('Remove a strike from a member.')
        .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true))
        .addStringOption(o => o.setName('level').setDescription('Strike level to remove').setRequired(true)
          .addChoices({ name: 'Strike 1', value: '1' }, { name: 'Strike 2', value: '2' }, { name: 'Strike 3', value: '3' }))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
      )
      .addSubcommand(sub => sub
        .setName('roster')
        .setDescription('Show the current in-game staff roster from ERLC cache.')
      )
    )

    // ── /management server ──────────────────────────────────
    .addSubcommandGroup(group => group
      .setName('server')
      .setDescription('Server management actions.')
      .addSubcommand(sub => sub
        .setName('setup')
        .setDescription('Post a bot panel in this channel.')
        .addStringOption(o => o.setName('panel').setDescription('Panel to post').setRequired(true)
          .addChoices({ name: 'Verification', value: 'verify' }, { name: 'Applications', value: 'applications' }))
      )
      .addSubcommand(sub => sub
        .setName('lockdown')
        .setDescription('Post a server lockdown notice.')
        .addStringOption(o => o.setName('reason').setDescription('Reason for lockdown').setRequired(true))
      )
      .addSubcommand(sub => sub
        .setName('announce')
        .setDescription('Post a server announcement.')
        .addStringOption(o => o.setName('title').setDescription('Announcement title').setRequired(true))
        .addStringOption(o => o.setName('message').setDescription('Announcement content').setRequired(true))
        .addBooleanOption(o => o.setName('ping').setDescription('Ping staff role?').setRequired(false))
      )
    )

    // ── /management partnership ─────────────────────────────
    .addSubcommandGroup(group => group
      .setName('partnership')
      .setDescription('Manage server partnerships.')
      .addSubcommand(sub => sub
        .setName('add')
        .setDescription('Add a new partnership.')
        .addStringOption(o => o.setName('name').setDescription('Partner server name').setRequired(true))
        .addStringOption(o => o.setName('description').setDescription('Partnership description').setRequired(true))
      )
      .addSubcommand(sub => sub
        .setName('list')
        .setDescription('List all active partnerships.')
      )
      .addSubcommand(sub => sub
        .setName('remove')
        .setDescription('Remove a partnership.')
        .addStringOption(o => o.setName('name').setDescription('Partner name to remove').setRequired(true))
      )
    ),

  async execute(interaction) {
    if (!perms.isManagement(interaction.member)) {
      return perms.denyPermission(interaction, 'Management');
    }

    const group = interaction.options.getSubcommandGroup();
    const sub   = interaction.options.getSubcommand();

    if (group === 'staff') {
      if (sub === 'promote')  return handlePromote(interaction);
      if (sub === 'demote')   return handleDemote(interaction);
      if (sub === 'fire')     return handleFire(interaction);
      if (sub === 'strike')   return handleStrike(interaction);
      if (sub === 'unstrike') return handleUnstrike(interaction);
      if (sub === 'roster')   return handleRoster(interaction);
    }

    if (group === 'server') {
      if (sub === 'setup')    return handleSetup(interaction);
      if (sub === 'lockdown') return handleLockdown(interaction);
      if (sub === 'announce') return handleAnnounce(interaction);
    }

    if (group === 'partnership') {
      if (sub === 'add')      return handlePartnerAdd(interaction);
      if (sub === 'list')     return handlePartnerList(interaction);
      if (sub === 'remove')   return handlePartnerRemove(interaction);
    }
  },
};

// ── Staff Actions ─────────────────────────────────────────

async function handlePromote(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const member   = interaction.options.getMember('member');
  const role     = interaction.options.getRole('role');
  const note     = interaction.options.getString('note') || 'No note provided';

  await member.roles.add(role).catch(e => { throw new Error(`Failed to add role: ${e.message}`); });

  const promoCh = interaction.guild.channels.cache.get(config.channels.staffPromotion);
  const embed = new EmbedBuilder()
    .setColor(config.colors.success)
    .setTitle('Staff Promotion')
    .addFields(
      { name: 'Member',     value: member.toString(),         inline: true },
      { name: 'New Role',   value: role.toString(),           inline: true },
      { name: 'By',         value: interaction.user.toString(), inline: true },
      { name: 'Note',       value: note,                      inline: false },
    )
    .setFooter({ text: 'RCRP Management — River City Role Play' })
    .setTimestamp();

  if (promoCh) await promoCh.send({ embeds: [embed] }).catch(() => {});
  await interaction.editReply({ content: `Promoted ${member} to ${role}.` });
}

async function handleDemote(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const member = interaction.options.getMember('member');
  const role   = interaction.options.getRole('remove_role');
  const reason = interaction.options.getString('reason');

  await member.roles.remove(role).catch(e => { throw new Error(`Failed: ${e.message}`); });

  const logsChannel = interaction.guild.channels.cache.get(config.channels.logs);
  const embed = new EmbedBuilder()
    .setColor(config.colors.warning)
    .setTitle('Staff Demotion')
    .addFields(
      { name: 'Member', value: member.toString(), inline: true },
      { name: 'Role Removed', value: role.toString(), inline: true },
      { name: 'By', value: interaction.user.toString(), inline: true },
      { name: 'Reason', value: reason, inline: false },
    )
    .setFooter({ text: 'RCRP Management — River City Role Play' })
    .setTimestamp();

  if (logsChannel) await logsChannel.send({ embeds: [embed] }).catch(() => {});
  await interaction.editReply({ content: `Demoted ${member} — removed ${role}.` });
}

async function handleFire(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const member = interaction.options.getMember('member');
  const reason = interaction.options.getString('reason');

  const staffRoles = config.staffRoles.filter(r => member.roles.cache.has(r));
  for (const roleId of staffRoles) {
    await member.roles.remove(roleId).catch(() => {});
  }
  await member.roles.add(config.roles.formerStaff).catch(() => {});

  const logsChannel = interaction.guild.channels.cache.get(config.channels.logs);
  const embed = new EmbedBuilder()
    .setColor(config.colors.danger)
    .setTitle('Staff Removed')
    .addFields(
      { name: 'Member', value: member.toString(), inline: true },
      { name: 'By',     value: interaction.user.toString(), inline: true },
      { name: 'Reason', value: reason, inline: false },
    )
    .setFooter({ text: 'RCRP Management — River City Role Play' })
    .setTimestamp();

  if (logsChannel) await logsChannel.send({ embeds: [embed] }).catch(() => {});
  await interaction.editReply({ content: `${member} has been removed from staff.` });
}

async function handleStrike(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const member = interaction.options.getMember('member');
  const level  = interaction.options.getString('level');
  const reason = interaction.options.getString('reason');

  const roleId = config.roles[`strike${level}`];
  if (roleId) await member.roles.add(roleId).catch(() => {});

  const logsChannel = interaction.guild.channels.cache.get(config.channels.logs);
  const embed = new EmbedBuilder()
    .setColor(config.colors.danger)
    .setTitle(`Strike ${level} Issued`)
    .addFields(
      { name: 'Member', value: member.toString(), inline: true },
      { name: 'By',     value: interaction.user.toString(), inline: true },
      { name: 'Reason', value: reason, inline: false },
    )
    .setFooter({ text: 'RCRP Management — River City Role Play' })
    .setTimestamp();

  if (logsChannel) await logsChannel.send({ embeds: [embed] }).catch(() => {});
  await interaction.editReply({ content: `Strike ${level} issued to ${member}.` });
}

async function handleUnstrike(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const member = interaction.options.getMember('member');
  const level  = interaction.options.getString('level');
  const reason = interaction.options.getString('reason');

  const roleId = config.roles[`strike${level}`];
  if (roleId) await member.roles.remove(roleId).catch(() => {});

  const logsChannel = interaction.guild.channels.cache.get(config.channels.logs);
  const embed = new EmbedBuilder()
    .setColor(config.colors.success)
    .setTitle(`Strike ${level} Removed`)
    .addFields(
      { name: 'Member', value: member.toString(), inline: true },
      { name: 'By',     value: interaction.user.toString(), inline: true },
      { name: 'Reason', value: reason, inline: false },
    )
    .setFooter({ text: 'RCRP Management — River City Role Play' })
    .setTimestamp();

  if (logsChannel) await logsChannel.send({ embeds: [embed] }).catch(() => {});
  await interaction.editReply({ content: `Strike ${level} removed from ${member}.` });
}

async function handleRoster(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const snapshot = erlc.getCachedSnapshot();
  const cacheAge = erlc.getCacheAge();

  if (!snapshot) {
    return interaction.editReply({ content: 'No ERLC data available yet. Please wait for the 20-second cycle.' });
  }

  const staffInGame = (snapshot.players || []).filter(p =>
    p._permission && p._permission !== 'None' && p._permission !== 'Normal'
  );

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`In-Game Staff Roster (${staffInGame.length})`)
    .setDescription(
      staffInGame.length
        ? staffInGame.map(p => `**${p._username}** — ${p._permission}${p._callsign ? ` [${p._callsign}]` : ''}`).join('\n')
        : 'No staff currently in-game.'
    )
    .setFooter({ text: `RCRP Management • data ${cacheAge}s ago — River City Role Play` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ── Server Actions ────────────────────────────────────────

async function handleSetup(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const panel        = interaction.options.getString('panel');
  const verification = require('../modules/verification');
  const applications = require('../modules/applications');

  if (panel === 'verify') {
    await verification.postVerifyPanel(interaction.channel);
    await interaction.editReply({ content: 'Verification panel posted in this channel.' });
  } else {
    await applications.postApplicationPanel(interaction.channel);
    await interaction.editReply({ content: 'Applications panel posted in this channel.' });
  }
}

async function handleLockdown(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const reason = interaction.options.getString('reason');

  const embed = new EmbedBuilder()
    .setColor(config.colors.danger)
    .setTitle('Server Lockdown')
    .setDescription(
      `River City Role Play is currently under lockdown.\n\n` +
      `**Reason:** ${reason}\n\n` +
      `Please refrain from joining in-game or creating tickets until further notice.`
    )
    .addFields(
      { name: 'Ordered By', value: interaction.user.toString(), inline: true },
      { name: 'Time',       value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
    )
    .setFooter({ text: 'RCRP Management — Official Notice' })
    .setTimestamp();

  await interaction.channel.send({ embeds: [embed] });
  await interaction.editReply({ content: 'Lockdown notice posted.' });
}

async function handleAnnounce(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const title   = interaction.options.getString('title');
  const message = interaction.options.getString('message');
  const ping    = interaction.options.getBoolean('ping') ?? false;

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(title)
    .setDescription(message)
    .addFields({ name: 'Posted By', value: interaction.user.toString(), inline: true })
    .setFooter({ text: 'RCRP Management — River City Role Play' })
    .setTimestamp();

  const content = ping ? `<@&${config.roles.announcementPing}>` : '';
  await interaction.channel.send({ content, embeds: [embed] });
  await interaction.editReply({ content: 'Announcement posted.' });
}

// ── Partnerships ──────────────────────────────────────────

async function loadPartnerships(guild) {
  if (partnershipsLoaded) return;
  try {
    const ch = guild.channels.cache.get(config.channels.discordDatabase);
    if (!ch) return;
    const { data } = await db.readLatestFile(ch, 'partnerships');
    if (data?.partnerships) partnerships = data.partnerships;
    partnershipsLoaded = true;
  } catch { /* ignore */ }
}

async function savePartnerships(guild) {
  const ch = guild.channels.cache.get(config.channels.discordDatabase);
  if (!ch) return;
  await db.writeFile(ch, { partnerships }, 'partnerships.json', '`partnerships.json` — Partnership Registry');
}

async function handlePartnerAdd(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await loadPartnerships(interaction.guild);

  const name  = interaction.options.getString('name');
  const desc  = interaction.options.getString('description');

  partnerships.push({ name, description: desc, addedBy: interaction.user.id, addedAt: new Date().toISOString() });
  await savePartnerships(interaction.guild);

  await interaction.editReply({ content: `Partnership with **${name}** added.` });
}

async function handlePartnerList(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await loadPartnerships(interaction.guild);

  if (!partnerships.length) return interaction.editReply({ content: 'No active partnerships.' });

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`Active Partnerships (${partnerships.length})`)
    .setDescription(partnerships.map(p => `**${p.name}** — ${p.description}`).join('\n'))
    .setFooter({ text: 'RCRP Management — River City Role Play' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handlePartnerRemove(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await loadPartnerships(interaction.guild);

  const name = interaction.options.getString('name').toLowerCase();
  const idx  = partnerships.findIndex(p => p.name.toLowerCase() === name);

  if (idx < 0) return interaction.editReply({ content: `No partnership found with name **${name}**.` });

  partnerships.splice(idx, 1);
  await savePartnerships(interaction.guild);
  await interaction.editReply({ content: `Partnership removed.` });
}
