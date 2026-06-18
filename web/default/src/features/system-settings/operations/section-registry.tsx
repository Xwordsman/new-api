/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { SystemBehaviorSection } from '../general/system-behavior-section'
import { CommunityBotSection } from './community-bot-section'
import { EmailSettingsSection } from '../integrations/email-settings-section'
import { MonitoringSettingsSection } from '../integrations/monitoring-settings-section'
import { WorkerSettingsSection } from '../integrations/worker-settings-section'
import { LogSettingsSection } from '../maintenance/log-settings-section'
import { PerformanceSection } from '../maintenance/performance-section'
import { UpdateCheckerSection } from '../maintenance/update-checker-section'
import type { OperationsSettings } from '../types'
import { createSectionRegistry } from '../utils/section-registry'

const OPERATIONS_SECTIONS = [
  {
    id: 'behavior',
    titleKey: 'System Behavior',
    build: (settings: OperationsSettings) => (
      <SystemBehaviorSection
        defaultValues={{
          RetryTimes: settings.RetryTimes,
          DefaultCollapseSidebar: settings.DefaultCollapseSidebar,
          DemoSiteEnabled: settings.DemoSiteEnabled,
          SelfUseModeEnabled: settings.SelfUseModeEnabled,
        }}
      />
    ),
  },
  {
    id: 'monitoring',
    titleKey: 'Monitoring & Alerts',
    build: (settings: OperationsSettings) => (
      <MonitoringSettingsSection
        defaultValues={{
          ChannelDisableThreshold: settings.ChannelDisableThreshold,
          QuotaRemindThreshold: settings.QuotaRemindThreshold,
          AutomaticDisableChannelEnabled:
            settings.AutomaticDisableChannelEnabled,
          AutomaticEnableChannelEnabled: settings.AutomaticEnableChannelEnabled,
          AutomaticDisableKeywords: settings.AutomaticDisableKeywords,
          AutomaticDisableStatusCodes: settings.AutomaticDisableStatusCodes,
          AutomaticRetryStatusCodes: settings.AutomaticRetryStatusCodes,
          'monitor_setting.auto_test_channel_enabled':
            settings['monitor_setting.auto_test_channel_enabled'],
          'monitor_setting.auto_test_channel_minutes':
            settings['monitor_setting.auto_test_channel_minutes'],
        }}
      />
    ),
  },
  {
    id: 'email',
    titleKey: 'SMTP Email',
    build: (settings: OperationsSettings) => (
      <EmailSettingsSection
        defaultValues={{
          SMTPServer: settings.SMTPServer,
          SMTPPort: settings.SMTPPort,
          SMTPAccount: settings.SMTPAccount,
          SMTPFrom: settings.SMTPFrom,
          SMTPToken: settings.SMTPToken,
          SMTPSSLEnabled: settings.SMTPSSLEnabled,
          SMTPForceAuthLogin: settings.SMTPForceAuthLogin,
        }}
      />
    ),
  },
  {
    id: 'worker',
    titleKey: 'Worker Proxy',
    build: (settings: OperationsSettings) => (
      <WorkerSettingsSection
        defaultValues={{
          WorkerUrl: settings.WorkerUrl,
          WorkerValidKey: settings.WorkerValidKey,
          WorkerAllowHttpImageRequestEnabled:
            settings.WorkerAllowHttpImageRequestEnabled,
        }}
      />
    ),
  },
  {
    id: 'community-bot',
    titleKey: 'Community Bot',
    build: (settings: OperationsSettings) => (
      <CommunityBotSection
        defaultValues={{
          enabled: settings['community_bot.enabled'],
          baseUrl: settings['community_bot.base_url'],
          roomId: settings['community_bot.room_id'],
          botToken: settings['community_bot.bot_token'],
          pollIntervalSeconds: settings['community_bot.poll_interval_seconds'],
          oauthProviderId: settings['community_bot.oauth_provider_id'],
          oauthProviderSlug: settings['community_bot.oauth_provider_slug'],
          checkinCommand: settings['community_bot.checkin_command'],
          tokenRequestCommand: settings['community_bot.token_request_command'],
          minAmount: settings['community_bot.min_amount'],
          maxAmount: settings['community_bot.max_amount'],
          checkinSuccessReply: settings['community_bot.checkin_success_reply'],
          checkinAlreadyReply: settings['community_bot.checkin_already_reply'],
          checkinUnboundReply: settings['community_bot.checkin_unbound_reply'],
          tokenApprovedReply: settings['community_bot.token_approved_reply'],
          tokenAlreadyApprovedReply:
            settings['community_bot.token_already_approved_reply'],
          tokenUnboundReply: settings['community_bot.token_unbound_reply'],
          unknownErrorReply: settings['community_bot.unknown_error_reply'],
          tokenBlockPrompt: settings['community_bot.token_block_prompt'],
          lotteryEnabled: settings['community_bot.lottery_enabled'],
          lotteryCommand: settings['community_bot.lottery_command'],
          lotterySessions: settings['community_bot.lottery_sessions'],
          lotteryWinReply: settings['community_bot.lottery_win_reply'],
          lotteryNoPrizeReply:
            settings['community_bot.lottery_no_prize_reply'],
          lotteryAlreadyDrawnReply:
            settings['community_bot.lottery_already_drawn_reply'],
          lotteryOutOfSessionReply:
            settings['community_bot.lottery_out_of_session_reply'],
          lotteryPoolEmptyReply:
            settings['community_bot.lottery_pool_empty_reply'],
          lotteryUnboundReply: settings['community_bot.lottery_unbound_reply'],
          lotteryErrorReply: settings['community_bot.lottery_error_reply'],
          redPacketEnabled: settings['community_bot.red_packet_enabled'],
          redPacketCreateCommand:
            settings['community_bot.red_packet_create_command'],
          redPacketClaimCommand:
            settings['community_bot.red_packet_claim_command'],
          redPacketWhitelist: settings['community_bot.red_packet_whitelist'],
          redPacketConcurrencyMode:
            settings['community_bot.red_packet_concurrency_mode'],
          redPacketExpireMinutes:
            settings['community_bot.red_packet_expire_minutes'],
          redPacketSplitMode: settings['community_bot.red_packet_split_mode'],
          redPacketMinTotalAmount:
            settings['community_bot.red_packet_min_total_amount'],
          redPacketMaxTotalAmount:
            settings['community_bot.red_packet_max_total_amount'],
          redPacketMinCount: settings['community_bot.red_packet_min_count'],
          redPacketMaxCount: settings['community_bot.red_packet_max_count'],
          redPacketCreatedReply:
            settings['community_bot.red_packet_created_reply'],
          redPacketClaimedReply:
            settings['community_bot.red_packet_claimed_reply'],
          redPacketEmptyReply:
            settings['community_bot.red_packet_empty_reply'],
          redPacketAlreadyReply:
            settings['community_bot.red_packet_already_reply'],
          redPacketNotAllowedReply:
            settings['community_bot.red_packet_not_allowed_reply'],
          redPacketExpiredReply:
            settings['community_bot.red_packet_expired_reply'],
          redPacketUsageReply:
            settings['community_bot.red_packet_usage_reply'],
          redPacketUnboundReply:
            settings['community_bot.red_packet_unbound_reply'],
          redPacketErrorReply:
            settings['community_bot.red_packet_error_reply'],
        }}
      />
    ),
  },
  {
    id: 'logs',
    titleKey: 'Log Maintenance',
    build: (settings: OperationsSettings) => (
      <LogSettingsSection
        defaultEnabled={Boolean(settings.LogConsumeEnabled)}
      />
    ),
  },
  {
    id: 'performance',
    titleKey: 'Performance',
    build: (settings: OperationsSettings) => (
      <PerformanceSection
        defaultValues={{
          'performance_setting.disk_cache_enabled':
            settings['performance_setting.disk_cache_enabled'] ?? false,
          'performance_setting.disk_cache_threshold_mb':
            settings['performance_setting.disk_cache_threshold_mb'] ?? 10,
          'performance_setting.disk_cache_max_size_mb':
            settings['performance_setting.disk_cache_max_size_mb'] ?? 1024,
          'performance_setting.disk_cache_path':
            settings['performance_setting.disk_cache_path'] ?? '',
          'performance_setting.monitor_enabled':
            settings['performance_setting.monitor_enabled'] ?? false,
          'performance_setting.monitor_cpu_threshold':
            settings['performance_setting.monitor_cpu_threshold'] ?? 90,
          'performance_setting.monitor_memory_threshold':
            settings['performance_setting.monitor_memory_threshold'] ?? 90,
          'performance_setting.monitor_disk_threshold':
            settings['performance_setting.monitor_disk_threshold'] ?? 95,
          'perf_metrics_setting.enabled':
            settings['perf_metrics_setting.enabled'] ?? true,
          'perf_metrics_setting.flush_interval':
            settings['perf_metrics_setting.flush_interval'] ?? 5,
          'perf_metrics_setting.bucket_time':
            settings['perf_metrics_setting.bucket_time'] ?? 'hour',
          'perf_metrics_setting.retention_days':
            settings['perf_metrics_setting.retention_days'] ?? 0,
        }}
      />
    ),
  },
  {
    id: 'update-checker',
    titleKey: 'System maintenance',
    build: (
      _settings: OperationsSettings,
      currentVersion?: string | null,
      startTime?: number | null
    ) => (
      <UpdateCheckerSection
        currentVersion={currentVersion}
        startTime={startTime}
      />
    ),
  },
] as const

export type OperationsSectionId = (typeof OPERATIONS_SECTIONS)[number]['id']

const operationsRegistry = createSectionRegistry<
  OperationsSectionId,
  OperationsSettings,
  [string | null | undefined, number | null | undefined]
>({
  sections: OPERATIONS_SECTIONS,
  defaultSection: 'behavior',
  basePath: '/system-settings/operations',
  urlStyle: 'path',
})

export const OPERATIONS_SECTION_IDS = operationsRegistry.sectionIds
export const OPERATIONS_DEFAULT_SECTION = operationsRegistry.defaultSection
export const getOperationsSectionNavItems =
  operationsRegistry.getSectionNavItems
export const getOperationsSectionContent = operationsRegistry.getSectionContent
export const getOperationsSectionMeta = operationsRegistry.getSectionMeta
