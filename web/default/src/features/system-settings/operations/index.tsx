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
import { useStatus } from '@/hooks/use-status'
import { SettingsPage } from '../components/settings-page'
import type { OperationsSettings } from '../types'
import {
  OPERATIONS_DEFAULT_SECTION,
  getOperationsSectionContent,
  getOperationsSectionMeta,
} from './section-registry.tsx'

const defaultOperationsSettings: OperationsSettings = {
  RetryTimes: 0,
  DefaultCollapseSidebar: false,
  DemoSiteEnabled: false,
  SelfUseModeEnabled: false,
  ChannelDisableThreshold: '',
  QuotaRemindThreshold: '',
  AutomaticDisableChannelEnabled: false,
  AutomaticEnableChannelEnabled: false,
  AutomaticDisableKeywords: '',
  AutomaticDisableStatusCodes: '401',
  AutomaticRetryStatusCodes:
    '100-199,300-399,401-407,409-499,500-503,505-523,525-599',
  'monitor_setting.auto_test_channel_enabled': false,
  'monitor_setting.auto_test_channel_minutes': 10,
  SMTPServer: '',
  SMTPPort: '',
  SMTPAccount: '',
  SMTPFrom: '',
  SMTPToken: '',
  SMTPSSLEnabled: false,
  SMTPForceAuthLogin: false,
  WorkerUrl: '',
  WorkerValidKey: '',
  WorkerAllowHttpImageRequestEnabled: false,
  LogConsumeEnabled: false,
  'performance_setting.disk_cache_enabled': false,
  'performance_setting.disk_cache_threshold_mb': 10,
  'performance_setting.disk_cache_max_size_mb': 1024,
  'performance_setting.disk_cache_path': '',
  'performance_setting.monitor_enabled': false,
  'performance_setting.monitor_cpu_threshold': 90,
  'performance_setting.monitor_memory_threshold': 90,
  'performance_setting.monitor_disk_threshold': 95,
  'perf_metrics_setting.enabled': true,
  'perf_metrics_setting.flush_interval': 5,
  'perf_metrics_setting.bucket_time': 'hour',
  'perf_metrics_setting.retention_days': 0,
  'community_bot.enabled': false,
  'community_bot.base_url': 'https://dc.hhhl.cc',
  'community_bot.room_id': '',
  'community_bot.bot_token': '',
  'community_bot.poll_interval_seconds': 15,
  'community_bot.oauth_provider_id': 0,
  'community_bot.oauth_provider_slug': '',
  'community_bot.checkin_command': '签到',
  'community_bot.token_request_command': '创建令牌',
  'community_bot.min_amount': 1,
  'community_bot.max_amount': 5,
  'community_bot.checkin_success_reply': '$[sparkle $[rainbow 🎉 恭喜 @{provider_user_id} 领到了{amount}美元！]] $[sparkle $[rainbow 当前余额：{balance}美刀]]',
  'community_bot.checkin_already_reply': '⏰ @{provider_user_id} 你今天已经签到过啦！明天再来领取奖励吧',,
  'community_bot.checkin_unbound_reply': '请先使用社区账号登录并绑定 new-api 账号。',
  'community_bot.token_approved_reply': '$[border.style=solid,width=3,color=0af,radius=5 $[tada $[fg.color=0af 🔑 令牌授权成功！]]] $[fg.color=0af @{provider_user_id} 你现在可以创建令牌了]',
  'community_bot.token_already_approved_reply': '你已经拥有令牌创建权限。',
  'community_bot.token_unbound_reply': '请先使用社区账号登录并绑定 new-api 账号。',
  'community_bot.unknown_error_reply': '处理失败，请稍后再试。',
  'community_bot.token_block_prompt': '请先在社区群内发送“创建令牌”完成令牌创建授权。',
}

export function OperationsSettings() {
  const { status } = useStatus()

  return (
    <SettingsPage
      routePath='/_authenticated/system-settings/operations/$section'
      defaultSettings={defaultOperationsSettings}
      defaultSection={OPERATIONS_DEFAULT_SECTION}
      getSectionContent={getOperationsSectionContent}
      getSectionMeta={getOperationsSectionMeta}
      extraArgs={[
        status?.version as string | undefined,
        status?.start_time as number | null | undefined,
      ]}
      loadingMessage='Loading maintenance settings...'
    />
  )
}
