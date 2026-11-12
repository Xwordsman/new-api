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
import { z } from 'zod'

const action = z.enum(['observe', 'review', 'deny'])
const integer = (min: number, max: number) => z.number().int().min(min).max(max)
export const splitList = (value: string): string[] => [
  ...new Set(
    value
      .split(/[,;\n\r]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  ),
]
const domains = z.string().refine(
  (value) =>
    splitList(value).length <= 2000 &&
    splitList(value).every((domain) => {
      try {
        const normalized = new URL(`https://${domain}`).hostname
        return (
          normalized.includes('.') &&
          !/[\s/@*:#?]/.test(domain) &&
          normalized.length <= 253
        )
      } catch {
        return false
      }
    }),
  'Invalid email domain list'
)

export const ruleSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[^ /|\n\r]+$/),
  enabled: z.boolean(),
  stage: z.enum(['email', 'register']),
  signal: z.enum(['email', 'ip', 'network', 'device', 'inviter', 'global']),
  window_seconds: integer(10, 2592000),
  limit: integer(1, 1000000),
  action,
})

export const registrationSettingsSchema = z
  .object({
    revision: integer(0, Number.MAX_SAFE_INTEGER),
    mode: z.enum(['off', 'observe', 'enforce']),
    require_email: z.boolean(),
    oauth_email_action: action,
    captcha: z.boolean(),
    captcha_hostname: z
      .string()
      .max(253)
      .regex(/^[^ /:?#]*$/),
    code_ttl_seconds: integer(60, 1800),
    resend_seconds: integer(10, 3600),
    code_max_failures: integer(1, 20),
    code_failure_window: integer(60, 86400),
    domain_action: action,
    allow_only: z.boolean(),
    blocked_domains: domains,
    allowed_domains: domains,
    domain_exceptions: domains,
    ipv4_prefix: integer(8, 32),
    ipv6_prefix: integer(16, 128),
    device_days: integer(1, 730),
    rules: z
      .array(ruleSchema)
      .max(50)
      .refine(
        (rules) => new Set(rules.map((rule) => rule.id)).size === rules.length,
        'Rule identifiers must be unique'
      ),
    bonus_enabled: z.boolean(),
    bonus_quota: integer(0, 2147483647),
    bonus_days: integer(1, 365),
    bonus_daily_quota: integer(0, Number.MAX_SAFE_INTEGER),
    bonus_models: z
      .string()
      .refine(
        (value) =>
          splitList(value).length <= 200 &&
          splitList(value).every(
            (model) => model.length <= 200 && !model.includes('*')
          ),
        'Invalid model list'
      ),
    bonus_rpm: integer(1, 10000),
    bonus_concurrency: integer(1, 100),
    lease_seconds: integer(60, 86400),
    shared_payer_action: action,
    hold_referral: z.boolean(),
    alert_enabled: z.boolean(),
    alert_emails: z
      .string()
      .refine(
        (value) =>
          splitList(value).length <= 20 &&
          splitList(value).every((email) => z.email().safeParse(email).success),
        'Invalid alert email list'
      ),
    alert_webhook: z
      .string()
      .max(2000)
      .refine((value) => {
        if (!value) return true
        try {
          const url = new URL(value)
          return (
            url.protocol === 'https:' &&
            !!url.host &&
            !url.username &&
            !url.password
          )
        } catch {
          return false
        }
      }, 'Use an HTTPS webhook URL'),
    alert_minutes: integer(1, 1440),
    alert_window_minutes: integer(1, 1440),
    alert_risk_count: integer(1, 2147483647),
    alert_email_count: integer(1, 2147483647),
    alert_completion_percent: integer(0, 100),
    alert_budget_percent: integer(1, 100),
    alert_dedup_minutes: integer(1, 10080),
    retention_days: integer(1, 3650),
  })
  .refine(
    (values) =>
      !values.allow_only || splitList(values.allowed_domains).length > 0,
    {
      path: ['allowed_domains'],
      message: 'An allowlist is required in allowlist-only mode',
    }
  )

export type SettingsFormValues = z.infer<typeof registrationSettingsSchema>
type ListField =
  | 'blocked_domains'
  | 'allowed_domains'
  | 'domain_exceptions'
  | 'bonus_models'
  | 'alert_emails'
export type RegistrationSettings = Omit<SettingsFormValues, ListField> &
  Record<ListField, string[]>
export function settingsToForm(
  settings: RegistrationSettings
): SettingsFormValues {
  return {
    ...settings,
    blocked_domains: settings.blocked_domains.join('\n'),
    allowed_domains: settings.allowed_domains.join('\n'),
    domain_exceptions: settings.domain_exceptions.join('\n'),
    bonus_models: settings.bonus_models.join('\n'),
    alert_emails: settings.alert_emails.join('\n'),
  }
}
export function formToSettings(
  values: SettingsFormValues
): RegistrationSettings {
  return {
    ...values,
    blocked_domains: splitList(values.blocked_domains),
    allowed_domains: splitList(values.allowed_domains),
    domain_exceptions: splitList(values.domain_exceptions),
    bonus_models: splitList(values.bonus_models),
    alert_emails: splitList(values.alert_emails),
  }
}
export const reviewSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Enter a reason between 3 and 500 characters.')
    .max(500, 'Enter a reason between 3 and 500 characters.'),
})
