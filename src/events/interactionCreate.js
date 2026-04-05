// interactionCreate.js — Central interaction router

const verification = require('../modules/verification');
const applications = require('../modules/applications');
const loa          = require('../commands/loa');
const roleSystem   = require('../commands/roleSystem');
const dutySignup   = require('../modules/dutySignup');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {

    // ── Slash Commands ──────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction);
      } catch (err) {
        console.error('[Command] /' + interaction.commandName + ':', err.message, err.stack?.split('\n')[1] || '');
        const msg = { content: 'Something went wrong. Please try again.', ephemeral: true };
        try {
          if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
          else await interaction.reply(msg);
        } catch {}
      }
      return;
    }

    // ── Buttons ─────────────────────────────────────────────
    if (interaction.isButton()) {
      const id = interaction.customId;

      // Verification
      if (id === 'verify_button') return verification.handleVerifyButton(interaction);

      // Applications
      if (id === 'apply_button')           return applications.handleApplyButton(interaction);
      if (id.startsWith('app_category:')) return applications.handleCategorySelect(interaction);
      if (id.startsWith('app_approve:'))  return applications.handleHRDecision(interaction, 'approve');
      if (id.startsWith('app_deny:'))     return applications.handleHRDecision(interaction, 'deny');
      if (id.startsWith('app_hold:'))     return applications.handleHRDecision(interaction, 'hold');

      // LOA
      if (id.startsWith('loa_approve:')) return loa.handleLOADecision(interaction, 'approve');
      if (id.startsWith('loa_deny:'))    return loa.handleLOADecision(interaction, 'deny');

      // Custom role panels (created via /role-system)
      if (id.startsWith('role_panel:'))  return roleSystem.handleRoleButton(interaction);

      // Built-in self-roles panel (selfrole:{roleId})
      if (id.startsWith('selfrole:'))    return roleSystem.handleSelfRoleButton(interaction);

      // Duty signup buttons
      if (id.startsWith('dutysignup:')) {
        const parts  = id.split(':');
        const action = parts[1];
        const sid    = parts[2];
        return dutySignup.handleSignup(interaction, action, sid);
      }

      // Scenario reroll
      if (id === 'member_scenario_reroll') {
        const SCENARIOS = require('../commands/member').SCENARIOS_EXPORT || [];
        const idx = Math.floor(Math.random() * 25);
        const { EmbedBuilder } = require('discord.js');
        const config = require('../config');
        const embed = new EmbedBuilder()
          .setColor(config.colors.warning)
          .setTitle('🎲  Random RP Scenario')
          .setDescription('**' + (SCENARIOS[idx] || 'You discover an overturned vehicle on Route 7 with no driver in sight.') + '**')
          .setFooter({ text: 'RCRP RP Tools — click to reroll again' })
          .setTimestamp();
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('member_scenario_reroll').setLabel('🎲  New Scenario').setStyle(ButtonStyle.Secondary)
        );
        return interaction.update({ embeds: [embed], components: [row] });
      }

      // Review panel
      if (id === 'leave_review') return handleLeaveReview(interaction);

      return;
    }

    // ── Select Menus ─────────────────────────────────────────
    if (interaction.isStringSelectMenu()) {
      const id = interaction.customId;
      if (id.startsWith('app_category:')) return applications.handleCategorySelect(interaction);
      return;
    }

    // ── Modals ────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      const id = interaction.customId;
      if (id === 'verify_roblox_modal')      return verification.handleVerifyModal(interaction);
      if (id.startsWith('app_deny_modal:')) return applications.handleDenyModal(interaction);
      if (id.startsWith('review_modal:'))   return handleReviewModal(interaction);
      return;
    }
  },
};

// ── Review button handler ────────────────────────────────────
async function handleLeaveReview(interaction) {
  const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
  const modal = new ModalBuilder().setCustomId('review_modal:' + interaction.user.id).setTitle('Leave a Staff Review');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('staff_name').setLabel('Staff Member Name').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. ExampleStaff123')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('rating').setLabel('Star Rating (1-5)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Enter a number from 1 to 5')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('review_text').setLabel('Your Review').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Describe your experience with this staff member...').setMinLength(10).setMaxLength(1000)
    ),
  );
  await interaction.showModal(modal);
}

async function handleReviewModal(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const config    = require('../config');
  const { EmbedBuilder } = require('discord.js');
  const staffName = interaction.fields.getTextInputValue('staff_name').trim();
  const ratingRaw = interaction.fields.getTextInputValue('rating').trim();
  const text      = interaction.fields.getTextInputValue('review_text').trim();
  const rating    = Math.min(5, Math.max(1, parseInt(ratingRaw) || 3));
  const stars     = '⭐'.repeat(rating) + '☆'.repeat(5 - rating);

  const reviewCh = interaction.guild.channels.cache.get(config.channels.staffReview);
  if (!reviewCh) return interaction.editReply({ content: 'Review channel not found.' });

  const embed = new EmbedBuilder()
    .setColor(config.colors.gold)
    .setTitle('Staff Review — ' + staffName)
    .setDescription('"' + text + '"')
    .addFields(
      { name: 'Rating',       value: stars + ' (' + rating + '/5)', inline: true },
      { name: 'Reviewed By',  value: '<@' + interaction.user.id + '>', inline: true },
      { name: 'Staff Member', value: staffName, inline: true },
    )
    .setFooter({ text: 'RCRP Staff Review System — River City Role Play' })
    .setTimestamp();

  await reviewCh.send({ embeds: [embed] });
  await interaction.editReply({ content: 'Your review has been submitted. Thank you!' });
}
