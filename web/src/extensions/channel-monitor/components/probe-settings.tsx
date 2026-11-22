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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { startMonitorProbe } from '../api'
import type { MonitorSettings } from '../types'

export function ProbeSettingsFields(props: { busy: boolean; usage: number }) {
  const { t, i18n } = useTranslation()
  const form = useFormContext<MonitorSettings>()
  const client = useQueryClient()
  const enabled = form.watch('enabled')
  const probe = form.watch('probe')
  const groups = form.watch('groups')
  const targets = groups.reduce(
    (count, group) => count + (group.probe_models?.length ?? 0),
    0
  )
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const configuredInterval = probe?.interval_minutes ?? 30
  const configuredLimit = probe?.daily_limit ?? 500
  const interval = Number.isFinite(configuredInterval) ? configuredInterval : 30
  const dailyLimit = Number.isFinite(configuredLimit) ? configuredLimit : 500
  const estimate = Math.min(
    Math.max(1, dailyLimit),
    Math.ceil(1440 / Math.max(5, interval)) * targets
  )
  const manual = useMutation({
    mutationFn: startMonitorProbe,
    onSuccess: (result) => {
      toast.success(
        result.created
          ? t(
              'Probe task queued. Results appear in channel monitor after completion.'
            )
          : t('A probe task is already running or queued')
      )
      void client.invalidateQueries({ queryKey: ['channel-monitor'] })
    },
  })
  return (
    <section
      aria-label={t('Automatic probes')}
      className='console-surface bg-card space-y-5 rounded-xl border p-5 sm:p-6'
    >
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <h3 className='font-semibold'>{t('Automatic probes')}</h3>
        <Button
          type='button'
          variant='outline'
          onClick={() => manual.mutate()}
          disabled={
            props.busy ||
            manual.isPending ||
            form.formState.isDirty ||
            !enabled ||
            targets === 0 ||
            props.usage >= (probe?.daily_limit ?? 500)
          }
        >
          {t('Probe now')}
        </Button>
      </div>
      <p className='text-muted-foreground text-sm leading-6'>
        {t(
          'Probes send a short text request with at most 32 output tokens. Upstream costs are paid by the platform; member balances are not charged. No automatic retries.'
        )}
      </p>
      <FormField
        control={form.control}
        name='probe.enabled'
        render={({ field }) => (
          <FormItem className='flex items-center justify-between gap-4'>
            <FormLabel>{t('Enable automatic probes')}</FormLabel>
            <FormControl>
              <Switch
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
                disabled={props.busy || !enabled}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className='grid gap-5 sm:grid-cols-2'>
        {(
          [
            {
              name: 'interval_minutes',
              label: t('Probe interval (minutes)'),
              min: 5,
              max: 1440,
            },
            {
              name: 'daily_limit',
              label: t('Probe limit per rolling 24 hours'),
              min: 1,
              max: 5000,
            },
          ] as const
        ).map((item) => (
          <FormField
            key={item.name}
            control={form.control}
            name={`probe.${item.name}`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{item.label}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={item.min}
                    max={item.max}
                    step={1}
                    value={Number.isNaN(field.value) ? '' : (field.value ?? '')}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === ''
                          ? Number.NaN
                          : Number(event.target.value)
                      )
                    }
                    disabled={props.busy}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </div>
      <FormField
        control={form.control}
        name='probe.only_when_idle'
        render={({ field }) => (
          <FormItem className='flex items-center justify-between gap-4'>
            <div>
              <FormLabel>{t('Only probe idle models')}</FormLabel>
              <FormDescription>
                {t(
                  'Skip models with real requests during the interval. Automatic probes pause when request logging is incomplete.'
                )}
              </FormDescription>
            </div>
            <FormControl>
              <Switch
                checked={field.value ?? true}
                onCheckedChange={field.onChange}
                disabled={props.busy}
              />
            </FormControl>
          </FormItem>
        )}
      />
      <p className='text-muted-foreground text-sm'>
        {t(
          '{{targets}} targets · up to {{estimate}} scheduled requests per day · {{used}} attempts in the last 24 hours',
          {
            targets: formatNumber(targets, locale),
            estimate: formatNumber(estimate, locale),
            used: formatNumber(props.usage, locale),
          }
        )}
      </p>
      <p className='text-muted-foreground text-xs leading-5'>
        {t(
          'Choose probe models inside each group below, then save. Manual probes use the saved configuration and share the daily limit; each target can run at most once per minute. Probe status is shown separately from real traffic.'
        )}
      </p>
    </section>
  )
}
