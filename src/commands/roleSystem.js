// /role-system — Button-based role selection panels.
  // Supports role-swapping (selecting one removes others in panel).
  // Also exposes handleRoleButton() for interactionCreate.js routing.
  // Also exposes handleSelfRoleButton() for built-in self-roles panel.

  const {
    SlashCommandBuilder, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
  } = require('discord.js');
  const config = require('../config');
  const perms  = require('../utils/permissions');

  // In-memory panel store: panelId -> { roles, swap, messageId, channelId }
  const rolePanels = new Map();

  module.exports = {
    data: new SlashCommandBuilder()
      .setName('role-system')
      .setDescription('Create a role selection button panel.')
      .addSubcommand(sub => sub
        .setName('create')
        .setDescription('Create a new role panel in this channel.')
        .addStringOption(o => o.setName('title').setDescription('Panel title').setRequired(true))
        .addStringOption(o => o.setName('description').setDescription('Panel description').setRequired(false))
        .addBooleanOption(o => o.setName('swap').setDescription('Enable role-swapping?').setRequired(false))
        .addAttachmentOption(o => o.setName('image').setDescription('Optional panel image').setRequired(false))
      )
      .addSubcommand(sub => sub
        .setName('add-role')
        .setDescription('Add a role button to a specific panel.')
        .addStringOption(o => o.setName('panel_id').setDescription('Panel ID').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Role to add').setRequired(true))
        .addStringOption(o => o.setName('label').setDescription('Button label').setRequired(false))
        .addStringOption(o => o.setName('emoji').setDescription('Button emoji').setRequired(false))
      ),

    async execute(interaction) {
      if (!perms.isManagement(interaction.member)) {
        return perms.denyPermission(interaction, 'Management');
      }
      const sub = interaction.options.getSubcommand();
      if (sub === 'create')   return handleCreate(interaction);
      if (sub === 'add-role') return handleAddRole(interaction);
    },

    // Called from interactionCreate for custom role_panel: buttons
    async handleRoleButton(interaction) {
      const parts = interaction.customId.split(':');
      if (parts.length < 3) return;
      const [, panelId, roleId] = parts;
      let panel = rolePanels.get(panelId);

      // Reconstruct panel from message components if not in memory
      if (!panel) {
        const roles = [];
        interaction.message.components.forEach(row => {
          row.components.forEach(btn => {
            const bp = btn.customId?.split(':');
            if (bp?.length === 3 && bp[1] === panelId) roles.push({ roleId: bp[2], label: btn.label });
          });
        });
        panel = { roles, swap: true, messageId: interaction.message.id, channelId: interaction.channelId };
        rolePanels.set(panelId, panel);
      }

      await interaction.deferReply({ ephemeral: true });
      const member = interaction.member;
      const guild  = interaction.guild;
      const role   = guild.roles.cache.get(roleId);

      if (!role) return interaction.editReply({ content: 'Role not found. It may have been deleted.' });

      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(role).catch(() => {});
        return interaction.editReply({ content: 'Removed **' + role.name + '** from your roles.' });
      }

      if (panel.swap) {
        for (const r of panel.roles) {
          if (r.roleId !== roleId && member.roles.cache.has(r.roleId)) {
            const old = guild.roles.cache.get(r.roleId);
            if (old) await member.roles.remove(old).catch(() => {});
          }
        }
      }
      await member.roles.add(role).catch(() => {});
      return interaction.editReply({ content: 'You now have the **' + role.name + '** role!' });
    },

    // Called from interactionCreate for built-in self-roles panel
    async handleSelfRoleButton(interaction) {
      const roleId = interaction.customId.split(':')[1];
      if (!roleId) return;
      await interaction.deferReply({ ephemeral: true });
      const member = interaction.member;
      const role   = interaction.guild.roles.cache.get(roleId);
      if (!role) return interaction.editReply({ content: 'Role not found.' });

      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(role).catch(() => {});
        return interaction.editReply({ content: 'Removed **' + role.name + '**.' });
      }
      await member.roles.add(role).catch(() => {});
      return interaction.editReply({ content: 'Added **' + role.name + '**!' });
    },
  };

  async function handleCreate(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const title       = interaction.options.getString('title');
    const description = interaction.options.getString('description') || 'Click a button below to select your role.';
    const swap        = interaction.options.getBoolean('swap') ?? true;
    const image       = interaction.options.getAttachment('image');
    const panelId     = 'p' + Date.now().toString().slice(-6);

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: 'Panel ID: ' + panelId + ' • RCRP Role System' })
      .setTimestamp();
    if (image) embed.setImage(image.url);

    const msg = await interaction.channel.send({ embeds: [embed] });
    rolePanels.set(panelId, { roles: [], swap, messageId: msg.id, channelId: interaction.channelId });
    await interaction.editReply({ content: 'Panel created! ID: `' + panelId + '`\nUse `/role-system add-role panel_id:' + panelId + '` to add buttons.' });
  }

  async function handleAddRole(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const panelId = interaction.options.getString('panel_id');
    const role    = interaction.options.getRole('role');
    const label   = interaction.options.getString('label') || role.name;
    const emoji   = interaction.options.getString('emoji') || null;

    let panel = rolePanels.get(panelId);
    if (!panel) {
      const messages = await interaction.channel.messages.fetch({ limit: 50 });
      const msg = messages.find(m => m.embeds[0]?.footer?.text?.includes('Panel ID: ' + panelId));
      if (!msg) return interaction.editReply({ content: 'Panel `' + panelId + '` not found in this channel.' });
      const existingRoles = [];
      msg.components.forEach(row => {
        row.components.forEach(btn => {
          const p = btn.customId?.split(':');
          if (p?.length === 3 && p[1] === panelId) existingRoles.push({ roleId: p[2], label: btn.label, emoji: btn.emoji?.name });
        });
      });
      panel = { roles: existingRoles, swap: true, messageId: msg.id, channelId: interaction.channelId };
      rolePanels.set(panelId, panel);
    }

    if (panel.roles.some(r => r.roleId === role.id)) {
      return interaction.editReply({ content: 'Role **' + role.name + '** already on this panel.' });
    }

    panel.roles.push({ roleId: role.id, label, emoji });

    try {
      const msg  = await interaction.channel.messages.fetch(panel.messageId);
      const rows = buildRows(panelId, panel.roles);
      await msg.edit({ components: rows });
      rolePanels.set(panelId, panel);
      await interaction.editReply({ content: 'Added **' + role.name + '** to panel `' + panelId + '`.' });
    } catch (e) {
      await interaction.editReply({ content: 'Failed to update panel: ' + e.message });
    }
  }

  function buildRows(panelId, roles) {
    const rows = [];
    let row = new ActionRowBuilder();
    let count = 0;
    for (const r of roles) {
      if (count > 0 && count % 5 === 0) { rows.push(row); row = new ActionRowBuilder(); }
      const btn = new ButtonBuilder().setCustomId('role_panel:' + panelId + ':' + r.roleId).setLabel(r.label).setStyle(ButtonStyle.Secondary);
      if (r.emoji) btn.setEmoji(r.emoji);
      row.addComponents(btn);
      count++;
    }
    if (count > 0) rows.push(row);
    return rows;
  }
  