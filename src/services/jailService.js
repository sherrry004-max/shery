import { getFromDb, setInDb } from '../utils/database.js';
import { logger } from '../utils/logger.js';

export class JailService {

  static _key(guildId, userId)  { return `moderation:jail:${guildId}:${userId}`; }
  static _logKey(guildId)       { return `moderation:jail_log_channel:${guildId}`; }
  static _roleKey(guildId)      { return `moderation:jail_role:${guildId}`; }
  static _allKey(guildId)       { return `moderation:jail_all:${guildId}`; }

  static async setJailRole(guildId, roleId) { await setInDb(this._roleKey(guildId), roleId); }
  static async getJailRole(guildId) { return await getFromDb(this._roleKey(guildId), null); }
  static async setLogChannel(guildId, channelId) { await setInDb(this._logKey(guildId), channelId); }
  static async getLogChannel(guildId) { return await getFromDb(this._logKey(guildId), null); }

  static async jailMember({ guild, member, moderator, reason, durationMs }) {
    try {
      const jailRoleId = await this.getJailRole(guild.id);
      if (!jailRoleId) return { success: false, error: 'No jail role configured. Use `/jail setup` first.' };

      const jailRole = guild.roles.cache.get(jailRoleId);
      if (!jailRole) return { success: false, error: 'Jail role not found in server.' };

      const existing = await getFromDb(this._key(guild.id, member.id), null);
      if (existing?.active) return { success: false, error: 'Member is already jailed.' };

      const savedRoles = member.roles.cache
        .filter(r => r.id !== guild.id && r.id !== jailRoleId)
        .map(r => r.id);

      await member.roles.set([jailRole]);

      const record = {
        userId: member.id, guildId: guild.id, moderatorId: moderator.id,
        reason, savedRoles,
        jailedAt: Date.now(),
        expiresAt: durationMs ? Date.now() + durationMs : null,
        permanent: !durationMs,
        active: true
      };
      await setInDb(this._key(guild.id, member.id), record);

      const allJails = await getFromDb(this._allKey(guild.id), []);
      if (!allJails.includes(member.id)) {
        allJails.push(member.id);
        await setInDb(this._allKey(guild.id), allJails);
      }
      return { success: true, record };
    } catch (error) {
      logger.error('Jail error:', error);
      return { success: false, error: error.message };
    }
  }

  static async unjailMember({ guild, member, moderator, reason, auto = false }) {
    try {
      const record = await getFromDb(this._key(guild.id, member.id), null);
      if (!record?.active) return { success: false, error: 'This member is not currently jailed.' };

      const jailRoleId = await this.getJailRole(guild.id);
      const rolesToRestore = record.savedRoles.filter(id => guild.roles.cache.has(id));
      await member.roles.set(rolesToRestore);
      if (jailRoleId) await member.roles.remove(jailRoleId).catch(() => {});

      record.active = false;
      record.unjailedAt = Date.now();
      record.unjailModeratorId = auto ? 'AUTO' : moderator?.id;
      record.unjailReason = reason || (auto ? 'Duration expired' : 'No reason provided');
      await setInDb(this._key(guild.id, member.id), record);

      const allJails = await getFromDb(this._allKey(guild.id), []);
      await setInDb(this._allKey(guild.id), allJails.filter(id => id !== member.id));

      return { success: true, record };
    } catch (error) {
      logger.error('Unjail error:', error);
      return { success: false, error: error.message };
    }
  }

  static async getJailRecord(guildId, userId) {
    return await getFromDb(this._key(guildId, userId), null);
  }

  static async getActiveJails(guildId) {
    const allIds = await getFromDb(this._allKey(guildId), []);
    const records = [];
    for (const userId of allIds) {
      const r = await getFromDb(this._key(guildId, userId), null);
      if (r?.active) records.push(r);
    }
    return records;
  }

  static parseDuration({ days = 0, hours = 0, minutes = 0 }) {
    return ((days * 24 * 60) + (hours * 60) + minutes) * 60 * 1000;
  }

  static formatDuration(ms) {
    if (!ms) return 'Permanent';
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    return parts.length ? parts.join(' ') : 'Less than a minute';
  }

  static formatTimeLeft(expiresAt) {
    if (!expiresAt) return '♾️ Permanent';
    const diff = expiresAt - Date.now();
    if (diff <= 0) return 'Expired';
    return this.formatDuration(diff);
  }
}