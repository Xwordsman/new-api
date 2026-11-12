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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { useSystemConfig } from '@/hooks/use-system-config'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'

import { registrationQueryKey, saveSettings } from '../api'
import {
  registrationSettingsSchema,
  formToSettings,
  settingsToForm,
  type SettingsFormValues,
} from '../lib/schema'
import type { RegistrationSettings } from '../types'
import { RulesEditor } from './rules-editor'
import { SettingField } from './setting-field'

const sections = ['email', 'signals', 'bonus', 'payments', 'alerts']

export function RegistrationSettingsForm(props: {
  settings: RegistrationSettings
}) {
  const { t, i18n } = useTranslation()
  const client = useQueryClient()
  const { currency } = useSystemConfig()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [expanded, setExpanded] = useState<string[]>([])
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(registrationSettingsSchema, {
      error: () => 'Check this value and the permitted limits',
    }),
    defaultValues: settingsToForm(props.settings),
  })
  const revision = form.watch('revision')
  const quota = form.watch('bonus_quota')
  const actions = [
    ['observe', t('Observe only')],
    ['review', t('Hold rewards for review')],
    ['deny', t('Deny registration')],
  ] as const
  const save = useMutation({
    mutationFn: saveSettings,
    onSuccess: async (settings) => {
      form.reset(settingsToForm(settings))
      await client.invalidateQueries({ queryKey: registrationQueryKey })
      toast.success(t('Registration protection settings saved'))
    },
  })
  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(
          (values) => save.mutate(formToSettings(values)),
          () => setExpanded(sections)
        )}
      >
        <fieldset
          disabled={save.isPending}
          className='space-y-5 disabled:opacity-70'
        >
          <div className='console-surface bg-card space-y-4 rounded-xl border p-5'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <h2 className='font-semibold'>{t('Registration protection')}</h2>
              <Button
                type='submit'
                disabled={save.isPending || !form.formState.isDirty}
              >
                {t('Save')}
              </Button>
            </div>
            <SettingField
              name='mode'
              label={t('Protection mode')}
              options={[
                ['off', t('Off')],
                ['observe', t('Observe only')],
                ['enforce', t('Enforce rules')],
              ]}
            />
            <p className='text-muted-foreground text-sm'>
              {t(
                'Observe mode records risk without blocking or holding rewards. Off disables risk decisions. Email verification and promotional credit controls remain independent of protection mode.'
              )}
            </p>
            {props.settings.revision > revision && (
              <Alert>
                <AlertDescription className='flex flex-wrap items-center justify-between gap-3'>
                  <span>
                    {t(
                      'Registration risk settings changed. Reload before saving.'
                    )}
                  </span>
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => form.reset(settingsToForm(props.settings))}
                  >
                    {t('Reload saved settings')}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </div>
          <Accordion
            multiple
            keepMounted
            value={expanded}
            onValueChange={setExpanded}
            className='gap-4'
          >
            <AccordionItem
              value='email'
              data-console-tone='info'
              className='console-surface bg-card rounded-xl border'
            >
              <AccordionTrigger className='p-5'>
                {t('Email verification and domain policy')}
              </AccordionTrigger>
              <AccordionContent className='space-y-5 border-t p-5'>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <SettingField
                    name='require_email'
                    label={t('Require verified email for password signup')}
                    kind='toggle'
                  />
                  <SettingField
                    name='captcha'
                    label={t('Require Turnstile in enforce mode')}
                    kind='toggle'
                  />
                  <SettingField
                    name='captcha_hostname'
                    label={t('Expected Turnstile hostname')}
                    description={t(
                      'Uses the site key and secret in system security settings. Empty hostname accepts any hostname verified by Cloudflare.'
                    )}
                  />
                  <SettingField
                    name='oauth_email_action'
                    label={t('Unverified OAuth or WeChat identity')}
                    options={actions}
                  />
                  <SettingField
                    name='code_ttl_seconds'
                    label={t('Verification code lifetime (seconds)')}
                    kind='number'
                  />
                  <SettingField
                    name='resend_seconds'
                    label={t('Email resend interval (seconds)')}
                    kind='number'
                  />
                  <SettingField
                    name='code_max_failures'
                    label={t('Maximum incorrect code attempts')}
                    kind='number'
                  />
                  <SettingField
                    name='code_failure_window'
                    label={t('Code failure window (seconds)')}
                    kind='number'
                  />
                  <SettingField
                    name='allow_only'
                    label={t('Allow listed email domains only')}
                    kind='toggle'
                  />
                  <SettingField
                    name='domain_action'
                    label={t('Action for restricted email domains')}
                    options={actions}
                  />
                  <SettingField
                    name='blocked_domains'
                    label={t('Blocked email domains')}
                    kind='list'
                  />
                  <SettingField
                    name='allowed_domains'
                    label={t('Allowed email domains')}
                    kind='list'
                  />
                  <SettingField
                    name='domain_exceptions'
                    label={t('Email domain exceptions')}
                    kind='list'
                  />
                </div>
                <p className='text-muted-foreground text-sm'>
                  {t(
                    'Separate entries with commas or new lines. Domain rules include subdomains; exceptions take priority. Disposable email lists need ongoing maintenance. Existing system email verification remains effective.'
                  )}
                </p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem
              value='signals'
              data-console-tone='warning'
              className='console-surface bg-card rounded-xl border'
            >
              <AccordionTrigger className='p-5'>
                {t('Risk signals and rate rules')}
              </AccordionTrigger>
              <AccordionContent className='space-y-5 border-t p-5'>
                <div className='grid gap-4 sm:grid-cols-3'>
                  <SettingField
                    name='ipv4_prefix'
                    label={t('IPv4 network prefix length')}
                    kind='number'
                  />
                  <SettingField
                    name='ipv6_prefix'
                    label={t('IPv6 network prefix length')}
                    kind='number'
                  />
                  <SettingField
                    name='device_days'
                    label={t('Browser cookie lifetime (days)')}
                    kind='number'
                  />
                </div>
                <RulesEditor />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem
              value='bonus'
              data-console-tone='success'
              className='console-surface bg-card rounded-xl border'
            >
              <AccordionTrigger className='p-5'>
                {t('Promotional credit and spending limits')}
              </AccordionTrigger>
              <AccordionContent className='space-y-5 border-t p-5'>
                <Alert>
                  <AlertDescription>
                    {t(
                      'New signup bonuses use a separate expiring credit pool. They cannot be transferred or withdrawn. Requests reserve their initial estimate from this pool; additional costs use paid balance. Asynchronous tasks use paid balance or subscriptions. Disabling restores the upstream signup bonus policy for future accounts.'
                    )}
                  </AlertDescription>
                </Alert>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <SettingField
                    name='bonus_enabled'
                    label={t('Use isolated signup credits')}
                    kind='toggle'
                  />
                  <SettingField
                    name='bonus_quota'
                    label={t('Signup credit (raw quota)')}
                    kind='number'
                    description={formatQuotaWithCurrency(
                      Number.isFinite(quota) ? quota : 0,
                      { locale, ...currency }
                    )}
                  />
                  <SettingField
                    name='bonus_days'
                    label={t('Promotional credit validity (days)')}
                    kind='number'
                  />
                  <SettingField
                    name='bonus_daily_quota'
                    label={t('Daily issuance budget (raw quota, UTC)')}
                    kind='number'
                    description={t(
                      'Zero means unlimited. Excess grants are held for review rather than added to paid balance.'
                    )}
                  />
                  <SettingField
                    name='bonus_models'
                    label={t('Models eligible for promotional credit')}
                    kind='list'
                    description={t(
                      'Exact model names, separated by commas or new lines. Empty allows all synchronous models.'
                    )}
                  />
                  <SettingField
                    name='bonus_rpm'
                    label={t('Promotional requests per minute')}
                    kind='number'
                  />
                  <SettingField
                    name='bonus_concurrency'
                    label={t('Promotional concurrent requests')}
                    kind='number'
                  />
                  <SettingField
                    name='lease_seconds'
                    label={t('Reservation lease (seconds)')}
                    kind='number'
                    description={t(
                      'Expired leases release concurrency. Uncertain upstream spending after a crash is not automatically refunded. Set this longer than expected requests.'
                    )}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem
              value='payments'
              data-console-tone='chart-4'
              className='console-surface bg-card rounded-xl border'
            >
              <AccordionTrigger className='p-5'>
                {t('Payment signals and referral protection')}
              </AccordionTrigger>
              <AccordionContent className='space-y-5 border-t p-5'>
                <SettingField
                  name='shared_payer_action'
                  label={t('Shared trusted payment identity')}
                  options={[
                    ['observe', t('Observe only')],
                    ['review', t('Hold rewards for review')],
                    ['deny', t('Reject promotional credits')],
                  ]}
                />
                <SettingField
                  name='hold_referral'
                  label={t('Hold referral qualification on enforced risk')}
                  kind='toggle'
                />
                <p className='text-muted-foreground text-sm'>
                  {t(
                    'Only verified payment callbacks supply payer identities. Review or rejection affects promotional credits, never paid balance or account access. Referral holds require separate approval in referral administration.'
                  )}
                </p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem
              value='alerts'
              data-console-tone='destructive'
              className='console-surface bg-card rounded-xl border'
            >
              <AccordionTrigger className='p-5'>
                {t('Alerts and data retention')}
              </AccordionTrigger>
              <AccordionContent className='space-y-5 border-t p-5'>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <SettingField
                    name='alert_enabled'
                    label={t('Enable registration risk alerts')}
                    kind='toggle'
                  />
                  <SettingField
                    name='alert_emails'
                    label={t('Alert recipient emails')}
                    kind='list'
                  />
                  <SettingField
                    name='alert_webhook'
                    label={t('Alert webhook URL (HTTPS)')}
                  />
                  <SettingField
                    name='alert_minutes'
                    label={t('Alert check interval (minutes)')}
                    kind='number'
                  />
                  <SettingField
                    name='alert_window_minutes'
                    label={t('Alert observation window (minutes)')}
                    kind='number'
                  />
                  <SettingField
                    name='alert_risk_count'
                    label={t('Risk attempts alert threshold')}
                    kind='number'
                  />
                  <SettingField
                    name='alert_email_count'
                    label={t('Minimum email attempts for conversion alert')}
                    kind='number'
                  />
                  <SettingField
                    name='alert_completion_percent'
                    label={t('Alert below registration conversion (%)')}
                    kind='number'
                  />
                  <SettingField
                    name='alert_budget_percent'
                    label={t('Alert at daily issuance budget (%)')}
                    kind='number'
                  />
                  <SettingField
                    name='alert_dedup_minutes'
                    label={t('Same alert cooldown (minutes)')}
                    kind='number'
                  />
                  <SettingField
                    name='retention_days'
                    label={t('Risk event and audit retention (days)')}
                    kind='number'
                  />
                </div>
                <p className='text-muted-foreground text-sm'>
                  {t(
                    'Alerts include aggregate counts only. Failed deliveries retry with backoff; successful email and webhook deliveries are tracked separately. Account and credit ledgers are retained for accounting. No passwords, codes or raw IPs are stored in risk events.'
                  )}
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </fieldset>
      </form>
    </Form>
  )
}
