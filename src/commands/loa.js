// /loa — Leave of Absence System
// LOA requests → HR Central channel. Approvals/Denials via buttons.

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle,
} = require('discord.js');
const config = require('../config');
const perms  = require('../utils/permissions');

// HR Central channel — LOA decisions go here
const LOA_CHANNEL = () => config.channels.hrCentral || '148813817507498142';

// In-memory store: userId → loa data
const loaStore = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loa')
    .setDescription('Leave of Absence management for RCRP staff.')
    .addSubcommand(s => s
      .setName('request')
      .setDescription('Submit a leave of absence request.')
      .addStringOption(o => o.setName('reason').setDescription('Why you need LOA').setRequired(true).setMinLength(10).setMaxLength(500))
      .addStringOption(o => o.setName('start').setDescription('Start date (e.g. April 5)').setRequired(true))
      .addStringOption(o => o.setName('end').setDescription('Expected return date (e.g. April 15)').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('list')
      .setDescription('List all active and pending LOAs.')
    )
    .addSubcommand(s => s
      .setName('end')
      .setDescription('End your LOA — mark yourself as returned.')
    )
    .addSubcommand(s => s
      .setName('cancel')
      .setDescription('Cancel your pending or active LOA request.')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'request') return handleRequest(interaction);
    if (sub === 'list')    return handleList(interaction);
    if (sub === 'end')     return handleEnd(interaction);
    if (sub === 'cancel')  return handleCancel(interaction);
  },
};

async function handleRequest(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const member = interaction.member;
  if (!perms.isStaff(member)) {
    return interaction.editReply({ content: 'Only staff members can submit LOA requests.' });
  }

  const reason = interaction.options.getString('reason');
  const start  = interaction.options.getString('start');
  const end    = interaction.options.getString('end');
  const guild  = interaction.guild;

  const existing = loaStore.get(member.id);
  if (existing?.status === 'pending') {
    return interaction.editReply({ content: 'You already have a pending LOA. Cancel it first with `/loa cancel`.' });
  }
  if (existing?.status === 'approved') {
    return interaction.editReply({ content: 'You already have an active approved LOA. Use `/loa end` when you return.' });
  }

  loaStore.set(member.id, {
    userId: member.id, displayName: member.displayName,
    reason, startDate: start, endDate: end,
    requestedAt: new Date().toISOString(), status: 'pending',
  });

  const embed = new EmbedBuilder()
    .setColor(config.colors.warning)
    .setAuthor({ name: 'RCRP — Leave of Absence Request', iconURL: guild.iconURL() || undefined })
    .setTitle('Pending Approval')
    .setThumbnail(member.displayAvatarURL())
    .setDescription(`**${member.displayName}** has requested a Leave of Absence.\n\n**Reason:** ${reason}`)
    .addFields(
      { name: 'Staff Member', value: `<@${member.id}>`,                      inline: true },
      { name: 'Duration',     value: `${start} → ${end}`,                    inline: true },
      { name: 'Requested',    value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
    )
    .setFooter({ text: 'RCRP Management — LOA System' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`loa_approve:${member.id}`).setLabel('✓ Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`loa_deny:${member.id}`).setLabel('✗ Deny').setStyle(ButtonStyle.Danger),
  );

  const ch = guild.channels.cache.get(LOA_CHANNEL());
  if (ch) {
    await ch.send({ content: `📋 New LOA Request from <@${member.id}>`, embeds: [embed], components: [row] }).catch(() => {});
  } else {
    console.warn('[LOA] HR Central channel not found. Set HR_CENTRAL_CHANNEL env var or hardcoded ID:', LOA_CHANNEL());
  }

  // DM the requester
  try {
    await member.send({ embeds: [new EmbedBuilder()
      .setColor(config.colors.warning)
      .setTitle('LOA Request Submitted — RCRP')
      .setDescription(`Your LOA from **${start}** to **${end}** is pending management approval.\n\n**Reason:** ${reason}\n\nYou'll be DM'd with the decision.`)
      .setFooter({ text: 'RCRP Management — River City Role Play' })
      .setTimestamp()
    ]});
  } catch {}

  await interaction.editReply({ content: `Your LOA request has been sent to HR for approval. You will be DM'd with the decision.` });
}

async function handleList(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const active  = [...loaStore.values()].filter(l => l.status === 'approved');
  const pending = [...loaStore.values()].filter(l => l.status === 'pending');

  if (!active.length && !pending.length) {
    return interaction.editReply({ content: 'No active or pending LOAs right now.' });
  }

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle('RCRP — Leave of Absence List')
    .setFooter({ text: 'RCRP Management — LOA System' })
    .setTimestamp();

  if (active.length) {
    embed.addFields({
      name:   `✅ Active LOAs (${active.length})`,
      value:  active.map(l => `<@${l.userId}> — ${l.startDate} to ${l.endDate}`).join('\n').slice(0, 1024),
      inline: false,
    });
  }
  if (pending.length) {
    embed.addFields({
      name:   `🕐 Pending Approval (${pending.length})`,
      value:  pending.map(l => `<@${l.userId}> — ${l.startDate} to ${l.endDate}`).join('\n').slice(0, 1024),
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleEnd(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const member = interaction.member;
  const loa    = loaStore.get(member.id);
  if (!loa) return interaction.editReply({ content: 'You do not have an active LOA.' });

  loaStore.delete(member.id);

  const guild = interaction.guild;
  const ch    = guild.channels.cache.get(LOA_CHANNEL());
  if (ch) {
    await ch.send({ embeds: [new EmbedBuilder()
      .setColor(config.colors.success)
      .setTitle('LOA Ended — Staff Returned')
      .setDescription(`<@${member.id}> has returned from their leave. Welcome back!`)
      .addFields({ name: 'LOA Duration Was', value: `${loa.startDate} → ${loa.endDate}`, inline: true })
      .setFooter({ text: 'RCRP Management — LOA System' })
      .setTimestamp()
    ]}).catch(() => {});
  }
  await interaction.editReply({ content: 'Your LOA is ended. Welcome back!' });
}

async function handleCancel(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const member = interaction.member;
  const loa    = loaStore.get(member.id);
  if (!loa) return interaction.editReply({ content: 'You have no active or pending LOA to cancel.' });
  loaStore.delete(member.id);
  await interaction.editReply({ content: 'Your LOA has been cancelled.' });
}

// Called from interactionCreate for button handling
async function handleLOADecision(interaction, decision) {
  if (!perms.isManagement(interaction.member)) {
    return interaction.reply({ content: 'Only management can approve or deny LOAs.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const userId   = interaction.customId.split(':')[1];
  const loa      = loaStore.get(userId);
  const guild    = interaction.guild;
  const approved = decision === 'approve';

  if (!loa) return interaction.editReply({ content: 'LOA data not found — may have been cancelled or already processed.' });

  if (approved) {
    loa.status = 'approved';
    loaStore.set(userId, loa);
  } else {
    loaStore.delete(userId);
  }

  const member = guild.members.cache.get(userId);
  const ch     = guild.channels.cache.get(LOA_CHANNEL());

  const resultEmbed = new EmbedBuilder()
    .setColor(approved ? config.colors.success : config.colors.danger)
    .setAuthor({ name: 'RCRP — Leave of Absence Decision', iconURL: guild.iconURL() || undefined })
    .setTitle(`LOA ${approved ? 'Approved ✅' : 'Denied ❌'}`)
    .setDescription(
      approved
        ? `<@${userId}>'s LOA from **${loa.startDate}** to **${loa.endDate}** has been **approved**. Rest up and come back strong!`
        : `<@${userId}>'s LOA request has been **denied** by management.`
    )
    .addFields({ name: 'Decision By', value: interaction.user.toString(), inline: true })
    .setFooter({ text: 'RCRP Management — LOA System' })
    .setTimestamp();

  if (ch) await ch.send({ content: `<@${userId}>`, embeds: [resultEmbed] }).catch(() => {});

  // DM the staff member
  if (member) {
    try {
      await member.send({ embeds: [new EmbedBuilder()
        .setColor(approved ? config.colors.success : config.colors.danger)
        .setTitle(`Your LOA was ${approved ? 'Approved' : 'Denied'} — RCRP`)
        .setDescription(
          approved
            ? `Your LOA from **${loa.startDate}** to **${loa.endDate}** has been approved!\nUse \`/loa end\` when you return.`
            : 'Your LOA request was denied by management. Please reach out if you have questions.'
        )
        .setFooter({ text: 'RCRP Management — River City Role Play' })
        .setTimestamp()
      ]});
    } catch {}
  }

  // Remove buttons from original message
  try { await interaction.message.edit({ components: [] }); } catch {}

  await interaction.editReply({ content: `LOA ${approved ? 'approved' : 'denied'}.` });
}

module.exports.handleLOADecision = handleLOADecision;
module.exports.loaStore          = loaStore;
