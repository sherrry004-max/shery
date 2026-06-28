import {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType
} from 'discord.js';
import { successEmbed, errorEmbed, infoEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { JailService } from '../../services/jailService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('jail')
    .setDescription('Jail system — jail, unjail, setup, and dashboard')
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('Configure jail role and log channel')
        .addRoleOption(o => o.setName('role').setDescription('The jail role').setRequired(true))
        .addChannelOption(o =>
          o.setName('log_channel').setDescription('Jail log channel')
           .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Jail a member')
        .addUserOption(o => o.setName('member').setDescription('Member to jail').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason'))
        .addIntegerOption(o => o.setName('days').setDescription('Days').setMinValue(0))
        .addIntegerOption(o => o.setName('hours').setDescription('Hours').setMinValue(0))
        .addIntegerOption(o => o.setName('minutes').setDescription('Minutes').setMinValue(0))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Unjail a member')
        .addUserOption(o => o.setName('member').setDescription('Member to unjail').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason'))
    )
    .addSubcommand(sub =>
      sub.setName('dashboard')
        .setDescription('View all currently jailed members')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  category: 'moderation',

  async execute(interaction, config, client) {
    try {
      const sub = interaction.options.getSubcommand();

      // ── SETUP ─────────────────────────────────────────────
      if (sub === 'setup') {
        const role = interaction.options.getRole('role');
        const logChannel = interaction.options.getChannel('log_channel');
        await JailService.setJailRole(interaction.guild.id, role.id);
        if (logChannel) await JailService.setLogChannel(interaction.guild.id, logChannel.id);
        return await InteractionHelper.universalReply(interaction, {
          embeds: [successEmbed('⚙️ Jail Setup Complete',
            `**Jail Role:** ${role}\n**Log Channel:** ${logChannel ?? '`Not set`'}`)]
        });
      }

      // ── JAIL ──────────────────────────────────────────────
      if (sub === 'add') {
        const user    = interaction.options.getUser('member');
        const reason  = interaction.options.getString('reason') || 'No reason provided';
        const days    = interaction.options.getInteger('days')    || 0;
        const hours   = interaction.options.getInteger('hours')   || 0;
        const minutes = interaction.options.getInteger('minutes') || 0;

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return await InteractionHelper.universalReply(interaction, {
          embeds: [errorEmbed('Not Found', 'That user is not in this server.')], ephemeral: true
        });
        if (member.id === interaction.user.id) return await InteractionHelper.universalReply(interaction, {
          embeds: [errorEmbed('Invalid Target', 'You cannot jail yourself.')], ephemeral: true
        });

        const durationMs  = JailService.parseDuration({ days, hours, minutes });
        const isPermanent = durationMs === 0;

        const result = await JailService.jailMember({
          guild: interaction.guild, member,
          moderator: interaction.member, reason,
          durationMs: isPermanent ? null : durationMs
        });
        if (!result.success) return await InteractionHelper.universalReply(interaction, {
          embeds: [errorEmbed('Jail Failed', result.error)], ephemeral: true
        });

        const durationText = isPermanent ? '♾️ Permanent' : JailService.formatDuration(durationMs);
        const expiresText  = isPermanent ? 'Never' : `<t:${Math.floor((Date.now() + durationMs) / 1000)}:R>`;

        // DM jailed member
        await user.send({ embeds: [new EmbedBuilder().setColor(0xFF4444)
          .setTitle('🔒 You have been Jailed')
          .setDescription(`You were jailed in **${interaction.guild.name}**.`)
          .addFields(
            { name: '📋 Reason', value: reason },
            { name: '⏱️ Duration', value: durationText },
            { name: '🔓 Expires', value: expiresText },
            { name: '🛡️ Moderator', value: `<@${interaction.user.id}>` }
          ).setTimestamp()]
        }).catch(() => {});

        await _sendJailLog({ client, guild: interaction.guild, type: 'JAILED',
          user, moderator: interaction.user, reason, durationText,
          expiresAt: result.record.expiresAt });

        return await InteractionHelper.universalReply(interaction, {
          embeds: [successEmbed(`🔒 ${user.tag} has been Jailed`,
            `**Reason:** ${reason}\n**Duration:** ${durationText}\n**Expires:** ${expiresText}\n**Saved Roles:** ${result.record.savedRoles.length} role(s) stored`)]
        });
      }

      // ── UNJAIL ────────────────────────────────────────────
      if (sub === 'remove') {
        const user   = interaction.options.getUser('member');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return await InteractionHelper.universalReply(interaction, {
          embeds: [errorEmbed('Not Found', 'That user is not in this server.')], ephemeral: true
        });

        const result = await JailService.unjailMember({
          guild: interaction.guild, member,
          moderator: interaction.member, reason
        });
        if (!result.success) return await InteractionHelper.universalReply(interaction, {
          embeds: [errorEmbed('Unjail Failed', result.error)], ephemeral: true
        });

        await user.send({ embeds: [new EmbedBuilder().setColor(0x44FF88)
          .setTitle('🔓 You have been Unjailed')
          .setDescription(`Your roles have been restored in **${interaction.guild.name}**.`)
          .addFields(
            { name: '📋 Reason', value: reason },
            { name: '🛡️ Moderator', value: `<@${interaction.user.id}>` }
          ).setTimestamp()]
        }).catch(() => {});

        await _sendJailLog({ client, guild: interaction.guild, type: 'UNJAILED',
          user, moderator: interaction.user, reason });

        return await InteractionHelper.universalReply(interaction, {
          embeds: [successEmbed(`🔓 ${user.tag} has been Unjailed`,
            `**Reason:** ${reason}\n**Roles Restored:** ${result.record.savedRoles.length} role(s) given back`)]
        });
      }

      // ── DASHBOARD ─────────────────────────────────────────
      if (sub === 'dashboard') {
        const activeJails = await JailService.getActiveJails(interaction.guild.id);
        if (activeJails.length === 0) return await InteractionHelper.universalReply(interaction, {
          embeds: [infoEmbed('🔒 Jail Dashboard', 'No members are currently jailed. ✅')]
        });

        const embed = new EmbedBuilder()
          .setColor(0xFF8C00).setTitle('🔒 Jail Dashboard')
          .setDescription(`**${activeJails.length}** member(s) currently jailed`)
          .setTimestamp()
          .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() });

        for (const record of activeJails.slice(0, 10)) {
          embed.addFields({ name: `👤 <@${record.userId}>`, value: [
            `**Reason:** ${record.reason}`,
            `**By:** <@${record.moderatorId}>`,
            `**Jailed:** <t:${Math.floor(record.jailedAt / 1000)}:R>`,
            `**Time Left:** ${JailService.formatTimeLeft(record.expiresAt)}`
          ].join('\n') });
        }

        // Quick-unjail buttons (up to 5)
        const rows = [];
        const btnList = activeJails.slice(0, 5);
        if (btnList.length > 0) {
          const row = new ActionRowBuilder();
          for (const record of btnList) {
            const m = interaction.guild.members.cache.get(record.userId);
            const label = (m?.displayName ?? record.userId).slice(0, 20);
            row.addComponents(new ButtonBuilder()
              .setCustomId(`jail_unjail_btn:${record.userId}`)
              .setLabel(`🔓 ${label}`)
              .setStyle(ButtonStyle.Danger));
          }
          rows.push(row);
        }

        return await InteractionHelper.universalReply(interaction, { embeds: [embed], components: rows });
      }

    } catch (error) {
      logger.error('Jail command error:', error);
      await handleInteractionError(interaction, error, { subtype: 'jail_failed' });
    }
  }
};

async function _sendJailLog({ client, guild, type, user, moderator, reason, durationText, expiresAt }) {
  try {
    const logChannelId = await JailService.getLogChannel(guild.id);
    if (!logChannelId) return;
    const channel = guild.channels.cache.get(logChannelId);
    if (!channel) return;

    const isJail = type === 'JAILED';
    const embed = new EmbedBuilder()
      .setColor(isJail ? 0xFF4444 : 0x44FF88)
      .setTitle(`${isJail ? '🔒' : '🔓'} Member ${type}`)
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: '👤 Member',    value: `${user.tag} (${user.id})`,         inline: true },
        { name: '🛡️ Moderator', value: `${moderator.tag} (${moderator.id})`, inline: true },
        { name: '📋 Reason',    value: reason }
      ).setTimestamp();

    if (isJail) embed.addFields(
      { name: '⏱️ Duration', value: durationText || '♾️ Permanent', inline: true },
      { name: '🔓 Expires',  value: expiresAt ? `<t:${Math.floor(expiresAt / 1000)}:F>` : 'Never', inline: true }
    );

    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.error('Jail log send error:', err);
  }
}