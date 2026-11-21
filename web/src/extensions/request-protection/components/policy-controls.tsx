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
import { useTranslation } from 'react-i18next'

import { PolicyField } from './policy-field'

export function PolicyControls(props: { disabled: boolean }) {
  const { t } = useTranslation()
  return (
    <div className='space-y-6'>
      <div className='grid gap-5 sm:grid-cols-2'>
        <PolicyField
          name='groups'
          label={t('Protected groups')}
          description={t('One value per line. Leave empty to match all.')}
          kind='lines'
          disabled={props.disabled}
        />
        <PolicyField
          name='models'
          label={t('Protected model patterns')}
          description={t(
            'One glob per line, such as gpt-*. Leave empty to match all.'
          )}
          kind='lines'
          disabled={props.disabled}
        />
        <PolicyField
          name='protocols'
          label={t('Protected protocols')}
          description={t(
            'Use protocol IDs such as openai, claude, gemini, openai_responses, mj_proxy or task. Leave empty to match all.'
          )}
          kind='lines'
          disabled={props.disabled}
        />
        <PolicyField
          name='exempt_user_ids'
          label={t('Exempt user IDs')}
          description={t(
            'One user ID per line. Exempt users bypass this plugin, including temporary restrictions.'
          )}
          kind='lines'
          disabled={props.disabled}
        />
      </div>
      <PolicyField
        name='reviewer.timeout_seconds'
        label={t('Review timeout (seconds)')}
        kind='number'
        min={1}
        max={60}
        disabled={props.disabled}
      />
      <h3 className='font-semibold'>{t('Inspection limits')}</h3>
      <div className='grid gap-5 sm:grid-cols-2'>
        <PolicyField
          name='max_body_bytes'
          label={t('Maximum inspected body (bytes)')}
          kind='number'
          min={1024}
          max={33554432}
          disabled={props.disabled}
        />
        <PolicyField
          name='max_text_bytes'
          label={t('Maximum inspected text (bytes)')}
          kind='number'
          min={256}
          max={8388608}
          disabled={props.disabled}
        />
        <PolicyField
          name='uninspected_action'
          label={t('Incomplete inspection action')}
          description={t(
            'Applies to oversized, unsupported and media payloads. Realtime frames cannot be inspected; blocking rejects the handshake.'
          )}
          options={[
            { value: 'allow', label: t('Allow') },
            { value: 'observe', label: t('Record only') },
            { value: 'block', label: t('Block') },
          ]}
          disabled={props.disabled}
        />
        <PolicyField
          name='require_complete_text'
          label={t('Block incomplete text inspection')}
          kind='switch'
          description={t(
            'Reject text or body limits, malformed structures and uninspectable realtime sessions without adding penalties. Media follows the incomplete inspection action.'
          )}
          disabled={props.disabled}
        />
        <PolicyField
          name='fail_closed'
          label={t('Block when protection storage is unavailable')}
          kind='switch'
          description={t(
            'A storage failure returns 503 when enabled. An unreadable policy always fails closed.'
          )}
          disabled={props.disabled}
        />
      </div>
    </div>
  )
}

export function PenaltyControls(props: { disabled: boolean }) {
  const { t } = useTranslation()
  return (
    <div className='space-y-5'>
      <h3 className='font-semibold'>{t('Temporary restrictions')}</h3>
      <div className='grid gap-5 sm:grid-cols-2'>
        <PolicyField
          name='duplicate_seconds'
          label={t('Identical content cooldown (seconds)')}
          kind='number'
          min={1}
          max={86400}
          description={t(
            'Identical content counts once per account during the cooldown, even across different Keys.'
          )}
          disabled={props.disabled}
        />
        <PolicyField
          name='key_threshold'
          label={t('Key violation threshold')}
          kind='number'
          min={0}
          max={10000}
          disabled={props.disabled}
        />
        <PolicyField
          name='key_suspend_minutes'
          label={t('Key restriction duration (minutes)')}
          kind='number'
          min={1}
          max={43200}
          disabled={props.disabled}
        />
      </div>
      <h3 className='font-semibold'>{t('Audit and alerts')}</h3>
      <div className='grid gap-5 sm:grid-cols-2'>
        <PolicyField
          name='upstream_action'
          label={t('Upstream safety response')}
          description={t(
            'Only an explicit upstream cyber-session block can pause the triggering user. Ordinary refusals are recorded without suspending users.'
          )}
          options={[
            { value: 'observe', label: t('Record only') },
            { value: 'hold_user', label: t('Pause user until review') },
          ]}
          disabled={props.disabled}
        />
        <PolicyField
          name='retention_days'
          label={t('Event retention (days)')}
          kind='number'
          min={2}
          max={365}
          disabled={props.disabled}
        />
        <PolicyField
          name='upstream_codes'
          label={t('Upstream safety codes to record')}
          kind='lines'
          description={t(
            'Exact structured codes only, one per line. Refusal text and HTTP status codes do not count as evidence.'
          )}
          disabled={props.disabled}
        />
        <PolicyField
          name='alert_enabled'
          label={t('Enable protection email alerts')}
          kind='switch'
          disabled={props.disabled}
        />
        <PolicyField
          name='alert_emails'
          label={t('Alert recipients')}
          kind='lines'
          description={t(
            'One email per line. Configure SMTP in system settings first. Alerts contain aggregate counts only.'
          )}
          disabled={props.disabled}
        />
        <PolicyField
          name='alert_minutes'
          label={t('Alert window (minutes)')}
          kind='number'
          min={1}
          max={1440}
          disabled={props.disabled}
        />
        <PolicyField
          name='alert_threshold'
          label={t('Blocked requests required for an alert')}
          kind='number'
          min={1}
          max={100000}
          disabled={props.disabled}
        />
      </div>
    </div>
  )
}
