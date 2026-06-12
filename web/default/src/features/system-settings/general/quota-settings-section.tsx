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
import { useState, type ChangeEvent } from 'react'
import * as z from 'zod'
import type { Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
  SettingsFormGrid,
  SettingsFormGridItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateOption } from '../hooks/use-update-option'

const QUOTA_PER_UNIT = 500000 // 500,000 quota points = $1

const quotaSchema = z.object({
  QuotaForNewUser: z.coerce.number().min(0),
  PreConsumedQuota: z.coerce.number().min(0),
  QuotaForInviter: z.coerce.number().min(0),
  QuotaForInvitee: z.coerce.number().min(0),
  TopUpLink: z.string(),
  general_setting: z.object({
    docs_link: z.string(),
  }),
  quota_setting: z.object({
    enable_free_model_pre_consume: z.boolean(),
  }),
})

type QuotaFormValues = z.infer<typeof quotaSchema>

type QuotaSettingsSectionProps = {
  defaultValues: QuotaFormValues
  complianceConfirmed?: boolean
}

export function QuotaSettingsSection({
  defaultValues,
  complianceConfirmed = true,
}: QuotaSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [useDollarInput, setUseDollarInput] = useState(false)

  const handleNumberChange =
    (onChange: (value: number | string) => void) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange(
        event.target.value === '' ? '' : event.currentTarget.valueAsNumber
      )
    }

  // Convert quota points to dollars
  const quotaToDollar = (quota: number): number => {
    return quota / QUOTA_PER_UNIT
  }

  // Convert dollars to quota points
  const dollarToQuota = (dollar: number): number => {
    return Math.round(dollar * QUOTA_PER_UNIT)
  }

  const handleQuotaChange =
    (onChange: (value: number | string) => void) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const inputValue = event.target.value
      if (inputValue === '') {
        onChange('')
        return
      }

      const numValue = parseFloat(inputValue)
      if (isNaN(numValue)) return

      if (useDollarInput) {
        // User input is in dollars, convert to quota points
        onChange(dollarToQuota(numValue))
      } else {
        // User input is in quota points
        onChange(numValue)
      }
    }

  const getDisplayValue = (quotaValue: number | ''): number | '' => {
    if (quotaValue === '') return ''
    if (useDollarInput) {
      return quotaToDollar(quotaValue)
    }
    return quotaValue
  }

  const { form, handleSubmit, isDirty, isSubmitting } =
    useSettingsForm<QuotaFormValues>({
      resolver: zodResolver(quotaSchema) as Resolver<
        QuotaFormValues,
        unknown,
        QuotaFormValues
      >,
      defaultValues,
      onSubmit: async (_data, changedFields) => {
        for (const [key, value] of Object.entries(changedFields)) {
          await updateOption.mutateAsync({
            key,
            value: value as string | number | boolean,
          })
        }
      },
    })

  return (
    <SettingsSection title={t('Quota Settings')}>
      <FormNavigationGuard when={isDirty} />

      {!complianceConfirmed ? (
        <Alert variant='destructive'>
          <AlertDescription>
            {t(
              'Non-zero invitation rewards require compliance confirmation in Payment Gateway settings.'
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Dollar input mode toggle */}
      <div className="bg-muted/50 mb-6 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">
              {t('Use dollar input mode')}
            </p>
            <p className="text-muted-foreground text-sm">
              {useDollarInput
                ? t('Input amounts in dollars (e.g., 30 for $30)')
                : t('Input amounts in quota points (e.g., 15000000 for $30)')}
            </p>
            {useDollarInput && (
              <p className="text-muted-foreground mt-1 text-xs">
                {t('Conversion: 500,000 quota points = $1')}
              </p>
            )}
          </div>
          <Switch
            checked={useDollarInput}
            onCheckedChange={setUseDollarInput}
          />
        </div>
      </div>

      <Form {...form}>
        <SettingsForm onSubmit={handleSubmit}>
          <SettingsPageFormActions
            onSave={handleSubmit}
            isSaving={updateOption.isPending || isSubmitting}
          />
          <FormDirtyIndicator isDirty={isDirty} />
          <SettingsFormGrid>
            <FormField
              control={form.control}
              name='QuotaForNewUser'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('New User Quota')}
                    {useDollarInput && (
                      <span className="text-muted-foreground ml-2 text-xs font-normal">
                        (${getDisplayValue(field.value)})
                      </span>
                    )}
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      {useDollarInput && (
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                          $
                        </span>
                      )}
                      <Input
                        type='number'
                        step={useDollarInput ? '0.01' : '1'}
                        value={getDisplayValue(field.value)}
                        onChange={handleQuotaChange(field.onChange)}
                        name={field.name}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        className={useDollarInput ? 'pl-7' : ''}
                      />
                    </div>
                  </FormControl>
                  <FormDescription>
                    {t('Initial quota given to new users')}
                    {!useDollarInput && field.value > 0 && (
                      <span className="text-muted-foreground ml-1">
                        (≈ ${quotaToDollar(field.value).toFixed(2)})
                      </span>
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='PreConsumedQuota'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Pre-Consumed Quota')}
                    {useDollarInput && (
                      <span className="text-muted-foreground ml-2 text-xs font-normal">
                        (${getDisplayValue(field.value)})
                      </span>
                    )}
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      {useDollarInput && (
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                          $
                        </span>
                      )}
                      <Input
                        type='number'
                        step={useDollarInput ? '0.01' : '1'}
                        value={getDisplayValue(field.value)}
                        onChange={handleQuotaChange(field.onChange)}
                        name={field.name}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        className={useDollarInput ? 'pl-7' : ''}
                      />
                    </div>
                  </FormControl>
                  <FormDescription>
                    {t('Quota consumed before charging users')}
                    {!useDollarInput && field.value > 0 && (
                      <span className="text-muted-foreground ml-1">
                        (≈ ${quotaToDollar(field.value).toFixed(2)})
                      </span>
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='QuotaForInviter'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Inviter Reward')}
                    {useDollarInput && (
                      <span className="text-muted-foreground ml-2 text-xs font-normal">
                        (${getDisplayValue(field.value)})
                      </span>
                    )}
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      {useDollarInput && (
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                          $
                        </span>
                      )}
                      <Input
                        type='number'
                        step={useDollarInput ? '0.01' : '1'}
                        value={getDisplayValue(field.value)}
                        onChange={handleQuotaChange(field.onChange)}
                        name={field.name}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        className={useDollarInput ? 'pl-7' : ''}
                      />
                    </div>
                  </FormControl>
                  <FormDescription>
                    {t('Quota given to users who invite others')}
                    {!useDollarInput && field.value > 0 && (
                      <span className="text-muted-foreground ml-1">
                        (≈ ${quotaToDollar(field.value).toFixed(2)})
                      </span>
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='QuotaForInvitee'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Invitee Reward')}
                    {useDollarInput && (
                      <span className="text-muted-foreground ml-2 text-xs font-normal">
                        (${getDisplayValue(field.value)})
                      </span>
                    )}
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      {useDollarInput && (
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                          $
                        </span>
                      )}
                      <Input
                        type='number'
                        step={useDollarInput ? '0.01' : '1'}
                        value={getDisplayValue(field.value)}
                        onChange={handleQuotaChange(field.onChange)}
                        name={field.name}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        className={useDollarInput ? 'pl-7' : ''}
                      />
                    </div>
                  </FormControl>
                  <FormDescription>
                    {t('Quota given to invited users')}
                    {!useDollarInput && field.value > 0 && (
                      <span className="text-muted-foreground ml-1">
                        (≈ ${quotaToDollar(field.value).toFixed(2)})
                      </span>
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <SettingsFormGridItem span='full'>
              <FormField
                control={form.control}
                name='quota_setting.enable_free_model_pre_consume'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Pre-Consume for Free Models')}</FormLabel>
                      <FormDescription>
                        {t(
                          'When enabled, zero-cost models also pre-consume quota before final settlement.'
                        )}
                      </FormDescription>
                    </SettingsSwitchContent>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={updateOption.isPending}
                      />
                    </FormControl>
                  </SettingsSwitchItem>
                )}
              />
            </SettingsFormGridItem>

            <FormField
              control={form.control}
              name='TopUpLink'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Top-Up Link')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('https://example.com/topup')}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('External link for users to purchase quota')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='general_setting.docs_link'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Documentation Link')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('https://docs.example.com')}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Link to your documentation site')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGrid>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
