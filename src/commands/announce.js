// ============================================================
  // /announce — Professional announcement embed with image support
  // ============================================================

  const {
    SlashCommandBuilder,
    EmbedBuilder,
  } = require('discord.js');
  const config = require('../config');
  const perms  = require('../utils/permissions');

  module.exports = {
    data: new SlashCommandBuilder()
      .setName('announce')
      .setDescription('Post a professional announcement embed.')
      .addStringOption(o => o
        .setName('title')
        .setDescription('Announcement title')
        .setRequired(true)
      )
      .addStringOption(o => o
        .setName('message')
        .setDescription('Announcement body text')
        .setRequired(true)
      )
      .addChannelOption(o => o
        .setName('channel')
        .setDescription('Channel to post in (defaults to current channel)')
        .setRequired(false)
      )
      .addStringOption(o => o
        .setName('ping')
        .setDescription('Who to ping with this announcement')
        .setRequired(false)
        .addChoices(
          { name: 'Everyone',      value: 'everyone' },
          { name: 'Staff Only',    value: 'staff'    },
          { name: 'No Ping',       value: 'none'     },
        )
      )
      .addAttachmentOption(o => o
        .setName('image')
        .setDescription('Optional image to include in the announcement')
        .setRequired(false)
      )
      .addStringOption(o => o
        .setName('color')
        .setDescription('Embed accent color')
        .setRequired(false)
        .addChoices(
          { name: 'Default (Dark)',  value: 'primary' },
          { name: 'Green',           value: 'success' },
          { name: 'Red',             value: 'danger'  },
          { name: 'Gold',            value: 'gold'    },
        )
      ),

    async execute(interaction) {
      if (!perms.isManagement(interaction.member)) {
        return perms.denyPermission(interaction, 'Management');
      }

      await interaction.deferReply({ ephemeral: true });

      const title      = interaction.options.getString('title');
      const message    = interaction.options.getString('message');
      const channel    = interaction.options.getChannel('channel') || interaction.channel;
      const pingChoice = interaction.options.getString('ping') || 'none';
      const image      = interaction.options.getAttachment('image');
      const colorKey   = interaction.options.getString('color') || 'primary';

      const colorMap = {
        primary: config.colors.primary,
        gold:    config.colors.gold,
        danger:  config.colors.danger,
        success: config.colors.success,
      };

      const embed = new EmbedBuilder()
        .setColor(colorMap[colorKey] || config.colors.primary)
        .setTitle(title)
        .setDescription(message)
        .addFields(
          { name: 'Posted',    value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
          { name: 'Posted By', value: interaction.user.toString(),               inline: true },
        )
        .setFooter({ text: 'RCRP Management — River City Role Play' })
        .setTimestamp();

      if (image) embed.setImage(image.url);

      // Build ping content
      let pingContent = '';
      if (pingChoice === 'everyone') {
        pingContent = '@everyone';
      } else if (pingChoice === 'staff') {
        const staffRoleId = config.roles.gameStaff || config.roles.discordMod || '';
        pingContent = staffRoleId ? `<@&${staffRoleId}>` : '';
      }

      await channel.send({
        content: pingContent || undefined,
        embeds:  [embed],
      });

      await interaction.editReply({ content: `Announcement posted in ${channel}.` });
    },
  };
  