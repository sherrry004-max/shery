import { logger } from '../utils/logger.js';
import { JailService } from './jailService.js';
import { EmbedBuilder } from 'discord.js';

export function startJailExpiryChecker(client) {
  setInterval(async () => {
    try {
      for (const [guildId, guild] of client.guilds.cache) {
        const activeJails = await JailService.getActiveJails(guildId);
        for (const record of activeJails) {
          if (!record.expiresAt || Date.now() < record.expiresAt) continue;

          const member = await guild.members.fetch(record.userId).catch(() => null);
          if (!member) continue;

          const result = await JailService.unjailMember({ guild, member, auto: true });
          if (!result.success) continue;

          await member.user.send({ embeds: [new EmbedBuilder().setColor(0x44FF88)
            .setTitle('🔓 Your Jail Has Expired')
            .setDescription(`Your jail in **${guild.name}** is over and your roles have been restored.`)
            .addFields({ name: '📋 Original Reason', value: record.reason })
            .setTimestamp()]
          }).catch(() => {});

          const logChannelId = await JailService.getLogChannel(guildId);
          if (logChannelId) {
            const logChannel = guild.channels.cache.get(logChannelId);
            if (logChannel) await logChannel.send({ embeds: [new EmbedBuilder().setColor(0x44FF88)
              .setTitle('🔓 Auto-Unjailed (Duration Expired)')
              .addFields(
                { name: '👤 Member', value: `${member.user.tag} (${member.id})`, inline: true },
                { name: '📋 Reason', value: record.reason }
              ).setTimestamp()]
            }).catch(() => {});
          }
        }
      }
    } catch (error) {
      logger.error('Jail expiry checker error:', error);
    }
  }, 60_000); // runs every 60 seconds

  logger.info('✅ Jail expiry checker started');
}