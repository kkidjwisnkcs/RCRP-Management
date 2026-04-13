// /review — Staff Review System
// submit: post a star-rated review for a staff member
// view:   pull review history for a staff member
// panel:  post the interactive review button panel
'use strict';

const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');
const config = require('../config');
const ai     = require('../utils/ai');
const perms  = require('../utils/permissions');

const REVIEW_CHANNEL = config.channels.staffReview || '1487893136687759421';
const STAR_LABELS    = { 1: 'Poor', 2: 'Below Average', 3: 'Average', 4: 'Good', 5: 'Outstanding' };

// ── Helpers ────────────────────────────────────────────────────────────────
function isPrivileged(member) {
  if (config.staffRoles?.some(r => member.roles.cache.has(r))) return true;
  return [
    PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers,
  ].some(p => member.permissions.has(p));
}

function getRoleLabel(member) {
  const r = config.roles;
  if (r.owner           && member.roles.cache.has(r.owner))           return 'Server Owner';
  if (r.coOwner         && member.roles.cache.has(r.coOwner))         return 'Co-Owner';
  if (r.serverDirector  && member.roles.cache.has(r.serverDirector))  return 'Server Director';
  if (r.deputyDirector  && member.roles.cache.has(r.deputyDirector))  return 'Deputy Director';
  if (r.hr              && member.roles.cache.has(r.hr))              return 'Human Resources';
  if (r.headManagement   && member.roles.cache.has(r.headManagement))   return 'Head Management';
  if (r.seniorManagement         && member.roles.cache.has(r.seniorManagement))         return 'Senior Management';
  if (r.headAdmin       && member.roles.cache.has(r.headAdmin))       return 'Head Admin';
  if (r.seniorAdmin     && member.roles.cache.has(r.seniorAdmin))     return 'Senior Admin';
  if (r.gameStaff       && member.roles.cache.has(r.gameStaff))       return 'Game Staff';
  if (r.trialAdmin      && member.roles.cache.has(r.trialAdmin))      return 'Trial Game Staff';
  if (r.headModerator   && member.roles.cache.has(r.headModerator))   return 'Head Moderator';
  if (r.seniorMod       && member.roles.cache.has(r.seniorMod))       return 'Senior Moderator';
  if (r.moderator       && member.roles.cache.has(r.moderator))       return 'Moderator';
  if (r.trialMod        && member.roles.cache.has(r.trialMod))        return 'Trial Moderator';
  if (r.discordMod      && member.roles.cache.has(r.discordMod))      return 'Discord Moderator';
  if (r.trialDiscordMod && member.roles.cache.has(r.trialDiscordMod)) return 'Trial Discord Mod';
  if (r.mediaTeam       && member.roles.cache.has(r.mediaTeam))       return 'Media Team';
  const top = [...member.roles.cache.values()]
    .filter(role => role.id !== member.guild.id)
    .sort((a, b) => b.position - a.position)[0];
  return top ? top.name : 'Staff Member';
}

// ── Module export ─────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('review')
    .setDescription('Staff review system.')
    .addSubcommand(s => s
      .setName('submit')
      .setDescription('Submit a star rating review for a staff member.')
      .addUserOption(o => o.setName('staff').setDescription('Staff member to review').setRequired(true))
      .addIntegerOption(o => o.setName('stars').setDescription('Rating (1-5)').setRequired(true).setMinValue(1).setMaxValue(5))
      .addStringOption(o => o.setName('comment').setDescription('Your review').setRequired(true).setMinLength(10).setMaxLength(800))
    )
    .addSubcommand(s => s
      .setName('view')
      .setDescription('View review history and average rating for a staff member.')
      .addUserOption(o => o.setName('staff').setDescription('Staff member to check').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('panel')
      .setDescription('[Staff] Post the staff review panel in this channel.')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'submit') return handleSubmit(interaction);
    if (sub === 'view')   return handleView(interaction);
    if (sub === 'panel')  return handlePanel(interaction);
  },
};

// ── /review submit ────────────────────────────────────────────────────────
async function handleSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const targetUser   = interaction.options.getUser('staff');
  const stars        = interaction.options.getInteger('stars');
  const comment      = interaction.options.getString('comment');
  const reviewer     = interaction.user;
  const guild        = interaction.guild;

  const targetMember = guild.members.cache.get(targetUser.id) ||
    await guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember)      return interaction.editReply({ content: 'Could not find that member in this server.' });
  if (!isPrivileged(targetMember)) return interaction.editReply({ content: 'That member is not a staff member.' });
  if (reviewer.id === targetUser.id) return interaction.editReply({ content: 'You cannot review yourself.' });

  const roleLabel = getRoleLabel(targetMember);
  const starStr   = '⭐'.repeat(stars);
  const starLabel = STAR_LABELS[stars] || 'Rated';

  let aiMsg = '';
  try {
    aiMsg = await ai.chat(
      'You are the FSRP Management bot. Write short, warm appreciation messages for staff members receiving reviews. Keep it genuine, punchy, and 1-2 sentences max.',
      `Staff member "${targetMember.displayName}" (${roleLabel}) got ${stars}/5 stars with comment: "${comment.slice(0, 150)}". Write a short warm shoutout.`,
      100
    ) || '';
  } catch {}

  const color = stars >= 4 ? config.colors.success : stars >= 3 ? config.colors.warning : config.colors.danger;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`Staff Review — ${targetMember.displayName}`)
    .setThumbnail(targetMember.displayAvatarURL())
    .setDescription(`${starStr} **${starLabel}** — ${stars}/5\n\n"${comment}"${aiMsg ? `\n\n*${aiMsg}*` : ''}`)
    .addFields(
      { name: 'Staff Member', value: `<@${targetMember.id}>`, inline: true },
      { name: 'Role',         value: roleLabel,               inline: true },
      { name: 'Reviewed By',  value: `<@${reviewer.id}>`,    inline: true },
    )
    .setFooter({ text: 'FSRP Management — Staff Review System' })
    .setTimestamp();

  const reviewCh = guild.channels.cache.get(REVIEW_CHANNEL);
  if (reviewCh) await reviewCh.send({ embeds: [embed] }).catch(() => {});

  try {
    const dmEmbed = new EmbedBuilder()
      .setColor(color)
      .setTitle('You received a staff review!')
      .setDescription(`${starStr} **${starLabel}** — ${stars}/5\n\n"${comment}"${aiMsg ? `\n\n*${aiMsg}*` : ''}`)
      .addFields({ name: 'Reviewed By', value: reviewer.username })
      .setFooter({ text: 'FSRP Management' })
      .setTimestamp();
    await targetMember.send({ embeds: [dmEmbed] });
  } catch {}

  await interaction.editReply({ content: `Review for **${targetMember.displayName}** (${starStr}) posted in <#${REVIEW_CHANNEL}>.` });
}

// ── /review view ─────────────────────────────────────────────────────────
async function handleView(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const targetUser = interaction.options.getUser('staff');
  const guild      = interaction.guild;

  try {
    const reviewCh = guild.channels.cache.get(REVIEW_CHANNEL);
    if (!reviewCh) return interaction.editReply({ content: 'Review channel not found.' });

    const msgs    = await reviewCh.messages.fetch({ limit: 100 });
    const reviews = [...msgs.values()].filter(m =>
      m.author.bot &&
      m.embeds?.[0]?.title?.includes('Staff Review') &&
      m.embeds[0]?.fields?.some(f => f.value.includes(targetUser.id))
    );

    if (!reviews.length) return interaction.editReply({ content: `No reviews found for <@${targetUser.id}>.` });

    let totalStars = 0;
    let count = 0;
    for (const msg of reviews) {
      const match = (msg.embeds[0]?.description || '').match(/(\d)\/5/);
      if (match) { totalStars += parseInt(match[1]); count++; }
    }
    const avg      = count ? (totalStars / count).toFixed(1) : 'N/A';
    const avgStars = count ? '⭐'.repeat(Math.round(totalStars / count)) : '';

    const targetMember = guild.members.cache.get(targetUser.id);
    const roleLabel    = targetMember ? getRoleLabel(targetMember) : 'Staff Member';

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle(`Review History — ${targetUser.username}`)
      .setThumbnail(targetUser.displayAvatarURL())
      .setDescription(`**${count}** review${count !== 1 ? 's' : ''} · Average: **${avg}/5** ${avgStars}`)
      .addFields(
        { name: 'Role',         value: roleLabel,                              inline: true },
        { name: 'Total Reviews', value: String(count),                         inline: true },
        { name: 'Full History', value: `<#${REVIEW_CHANNEL}>`,                inline: true },
      )
      .setFooter({ text: 'FSRP Management — Staff Review System' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('[Review] view error:', err.message);
    await interaction.editReply({ content: 'Could not fetch review history.' });
  }
}

// ── /review panel — post button panel ────────────────────────────────────
async function handlePanel(interaction) {
  if (!perms.isStaff(interaction.member)) {
    return interaction.reply({ content: 'Staff only.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setAuthor({ name: 'Florida State Roleplay', iconURL: interaction.guild.iconURL() || undefined })
    .setTitle('Staff Review Panel')
    .setDescription(
      'Use this panel to recognize and rate staff members based on their performance.\n\n' +
      '**How it works:**\n' +
      '> • Click **Submit Review** to rate a staff member (1–5 stars)\n' +
      '> • Click **View Reviews** to check the review history for any staff member\n' +
      '> • Reviews are posted publicly in <#' + REVIEW_CHANNEL + '>\n' +
      '> • Reviewed staff get a DM notification\n\n' +
      '**Why reviews matter:** They help management identify top performers and areas for growth.'
    )
    .setFooter({ text: 'FSRP Management — Florida State Roleplay' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('review_panel:submit').setLabel('Submit Review').setStyle(ButtonStyle.Primary).setEmoji('⭐'),
    new ButtonBuilder().setCustomId('review_panel:view').setLabel('View Reviews').setStyle(ButtonStyle.Secondary).setEmoji('📋'),
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  await interaction.editReply({ content: 'Review panel posted.' });
}

// ── Review panel button handler (called from interactionCreate) ────────────
async function handleReviewPanelButton(interaction) {
  const action = interaction.customId.split(':')[1];

  if (action === 'submit') {
    const modal = new ModalBuilder()
      .setCustomId('review_modal:submit')
      .setTitle('Submit Staff Review');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('target_username')
          .setLabel('Staff Member Username (Discord username)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. johnsmith (exact Discord username)')
          .setRequired(true)
          .setMaxLength(50)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('stars')
          .setLabel('Rating (1-5 stars)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Enter a number: 1, 2, 3, 4, or 5')
          .setRequired(true)
          .setMaxLength(1)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('comment')
          .setLabel('Your Review')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Write your honest feedback about this staff member...')
          .setRequired(true)
          .setMinLength(10)
          .setMaxLength(800)
      ),
    );
    return interaction.showModal(modal);
  }

  if (action === 'view') {
    const modal = new ModalBuilder()
      .setCustomId('review_modal:view')
      .setTitle('View Staff Reviews');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('target_username')
          .setLabel('Staff Member Username (Discord username)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. johnsmith')
          .setRequired(true)
          .setMaxLength(50)
      ),
    );
    return interaction.showModal(modal);
  }
}

// ── Review modal submit handler ───────────────────────────────────────────
async function handleReviewModal(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const action = interaction.customId.split(':')[1];
  const guild  = interaction.guild;

  const targetUsername = interaction.fields.getTextInputValue('target_username').toLowerCase();

  await guild.members.fetch().catch(() => {});
  const targetMember = guild.members.cache.find(
    m => m.user.username.toLowerCase() === targetUsername ||
         m.displayName.toLowerCase()   === targetUsername
  );

  if (!targetMember) {
    return interaction.editReply({ content: `Could not find a member with username **${targetUsername}**.` });
  }

  if (action === 'view') {
    const reviewCh = guild.channels.cache.get(REVIEW_CHANNEL);
    if (!reviewCh) return interaction.editReply({ content: 'Review channel not found.' });

    const msgs    = await reviewCh.messages.fetch({ limit: 100 });
    const reviews = [...msgs.values()].filter(m =>
      m.author.bot &&
      m.embeds?.[0]?.title?.includes('Staff Review') &&
      m.embeds[0]?.fields?.some(f => f.value.includes(targetMember.id))
    );

    if (!reviews.length) return interaction.editReply({ content: `No reviews found for **${targetMember.displayName}**.` });

    let totalStars = 0, count = 0;
    for (const msg of reviews) {
      const match = (msg.embeds[0]?.description || '').match(/(\d)\/5/);
      if (match) { totalStars += parseInt(match[1]); count++; }
    }
    const avg = count ? (totalStars / count).toFixed(1) : 'N/A';

    return interaction.editReply({
      content: `**${targetMember.displayName}** has **${count}** review${count !== 1 ? 's' : ''} with an average of **${avg}/5** ⭐\nSee <#${REVIEW_CHANNEL}> for full history.`,
    });
  }

  if (action === 'submit') {
    const starsRaw = interaction.fields.getTextInputValue('stars').trim();
    const stars    = parseInt(starsRaw);
    const comment  = interaction.fields.getTextInputValue('comment');

    if (isNaN(stars) || stars < 1 || stars > 5) {
      return interaction.editReply({ content: 'Rating must be a number between 1 and 5.' });
    }
    if (!isPrivileged(targetMember)) {
      return interaction.editReply({ content: 'That member is not a staff member.' });
    }
    if (interaction.user.id === targetMember.id) {
      return interaction.editReply({ content: 'You cannot review yourself.' });
    }

    const roleLabel = getRoleLabel(targetMember);
    const starStr   = '⭐'.repeat(stars);
    const starLabel = STAR_LABELS[stars] || 'Rated';

    let aiMsg = '';
    try {
      aiMsg = await ai.chat(
        'You are the FSRP Management bot. Write short, warm appreciation messages for staff members receiving reviews. 1-2 sentences max.',
        `Staff member "${targetMember.displayName}" (${roleLabel}) got ${stars}/5 stars: "${comment.slice(0, 150)}". Write a short warm shoutout.`,
        100
      ) || '';
    } catch {}

    const color = stars >= 4 ? config.colors.success : stars >= 3 ? config.colors.warning : config.colors.danger;
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`Staff Review — ${targetMember.displayName}`)
      .setThumbnail(targetMember.displayAvatarURL())
      .setDescription(`${starStr} **${starLabel}** — ${stars}/5\n\n"${comment}"${aiMsg ? `\n\n*${aiMsg}*` : ''}`)
      .addFields(
        { name: 'Staff Member', value: `<@${targetMember.id}>`, inline: true },
        { name: 'Role',         value: roleLabel,               inline: true },
        { name: 'Reviewed By',  value: `<@${interaction.user.id}>`, inline: true },
      )
      .setFooter({ text: 'FSRP Management — Staff Review System' })
      .setTimestamp();

    const reviewCh = guild.channels.cache.get(REVIEW_CHANNEL);
    if (reviewCh) await reviewCh.send({ embeds: [embed] }).catch(() => {});

    try {
      await targetMember.send({ embeds: [
        new EmbedBuilder()
          .setColor(color)
          .setTitle('You received a staff review!')
          .setDescription(`${starStr} **${starLabel}** — ${stars}/5\n\n"${comment}"${aiMsg ? `\n\n*${aiMsg}*` : ''}`)
          .addFields({ name: 'Reviewed By', value: interaction.user.username })
          .setFooter({ text: 'FSRP Management' })
          .setTimestamp(),
      ]});
    } catch {}

    return interaction.editReply({ content: `Review for **${targetMember.displayName}** (${starStr}) submitted and posted in <#${REVIEW_CHANNEL}>.` });
  }
}

module.exports.handleReviewPanelButton = handleReviewPanelButton;
module.exports.handleReviewModal       = handleReviewModal;
