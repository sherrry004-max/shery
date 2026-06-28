import { EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { JailService } from '../services/jailService.js';
import { successEmbed, errorEmbed } from '../utils/embeds.js';

export const jailUnJailBtnHandler = {
  customId: 'jail_unjail_btn',
  async execute(interaction, client) {
    try {
      if (!interaction.memberPermissions.has('ModerateMembers')) {
        return interaction.reply({
          embeds: [errorEmbed('No Permission', 'You need **Moderate Members** permission.')],
          ephemeral: true
        });
      }

      const userId = interaction.customId.split(':')[1];
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!member) return interaction.reply({
        embeds: [errorEmbed('Not Found', 'Could not find that member.')], ephemeral: true
      });

      const result = await JailService.unjailMember({
        guild: interaction.guild, member,
        moderator: interaction.member,
        reason: `Unjailed via dashboard by ${interaction.user.tag}`
      });
      if (!result.success) return interaction.reply({
        embeds: [errorEmbed('Failed', result.error)], ephemeral: true
      });

      // DM
      await member.user.send({ embeds: [new EmbedBuilder().setColor(0x44FF88)
        .setTitle('🔓 You have been Unjailed')
        .setDescription(`You were unjailed in **${interaction.guild.name}** via dashboard.`)
        .addFields({ name: '🛡️ Moderator', value: `<@${interaction.user.id}>` })
        .setTimestamp()]
      }).catch(() => {});

      // Log channel
      const logChannelId = await JailService.getLogChannel(interaction.guild.id);
      if (logChannelId) {
        const logChannel = interaction.guild.channels.cache.get(logChannelId);
        if (logChannel) await logChannel.send({ embeds: [new EmbedBuilder().setColor(0x44FF88)
          .setTitle('🔓 Member UNJAILED (Dashboard)')
          .addFields(
            { name: '👤 Member',    value: `${member.user.tag}`, inline: true },
            { name: '🛡️ Moderator', value: interaction.user.tag, inline: true },
            { name: '📋 Reason',    value: 'Unjailed via dashboard' }
          ).setTimestamp()]
        }).catch(() => {});
      }

      await interaction.reply({
        embeds: [successEmbed(`🔓 ${member.user.tag} Unjailed`,
          `Roles restored: ${result.record.savedRoles.length} role(s)`)],
        ephemeral: true
      });
    } catch (error) {
      logger.error('Jail button error:', error);
      await interaction.reply({
        embeds: [errorEmbed('Error', 'Something went wrong.')], ephemeral: true
      }).catch(() => {});
    }
  }
};

export default [jailUnJailBtnHandler];