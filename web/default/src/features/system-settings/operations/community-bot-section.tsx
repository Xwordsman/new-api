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
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import { Textarea } from '@/components/ui/textarea'
import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'

type CommunityBotValues = {
  enabled: boolean
  baseUrl: string
  roomId: string
  botToken: string
  pollIntervalSeconds: number
  oauthProviderId: number
  oauthProviderSlug: string
  checkinCommand: string
  tokenRequestCommand: string
  minAmount: number
  maxAmount: number
  checkinSuccessReply: string
  checkinAlreadyReply: string
  checkinUnboundReply: string
  tokenApprovedReply: string
  tokenAlreadyApprovedReply: string
  tokenUnboundReply: string
  unknownErrorReply: string
  tokenBlockPrompt: string
}

const createSchema = (t: (key: string) => string) =>
  z
    .object({
      enabled: z.boolean(),
      baseUrl: z
        .string()
        .trim()
        .refine((value) => value === '' || /^https?:\/\//.test(value), {
          message: t('Provide a valid URL starting with http:// or https://'),
        }),
      roomId: z.string(),
      botToken: z.string(),
      pollIntervalSeconds: z.coerce.number().int().min(5),
      oauthProviderId: z.coerce.number().int().min(0),
      oauthProviderSlug: z.string(),
      checkinCommand: z.string(),
      tokenRequestCommand: z.string(),
      minAmount: z.coerce.number().min(0),
      maxAmount: z.coerce.number().min(0),
      checkinSuccessReply: z.string(),
      checkinAlreadyReply: z.string(),
      checkinUnboundReply: z.string(),
      tokenApprovedReply: z.string(),
      tokenAlreadyApprovedReply: z.string(),
      tokenUnboundReply: z.string(),
      unknownErrorReply: z.string(),
      tokenBlockPrompt: z.string(),
    })
    .superRefine((values, ctx) => {
      if (values.maxAmount < values.minAmount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxAmount'],
          message: t('Maximum amount must be greater than or equal to minimum amount'),
        })
      }
      if (values.enabled) {
        if (!values.baseUrl.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['baseUrl'],
            message: t('Community bot API URL is required'),
          })
        }
        if (!values.roomId.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['roomId'],
            message: t('Community chat room ID is required'),
          })
        }
        if (
          values.oauthProviderId <= 0 &&
          values.oauthProviderSlug.trim() === ''
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['oauthProviderId'],
            message: t('OAuth provider ID or slug is required'),
          })
        }
      }
    })

const optionMap: Record<keyof CommunityBotValues, string> = {
  enabled: 'community_bot.enabled',
  baseUrl: 'community_bot.base_url',
  roomId: 'community_bot.room_id',
  botToken: 'community_bot.bot_token',
  pollIntervalSeconds: 'community_bot.poll_interval_seconds',
  oauthProviderId: 'community_bot.oauth_provider_id',
  oauthProviderSlug: 'community_bot.oauth_provider_slug',
  checkinCommand: 'community_bot.checkin_command',
  tokenRequestCommand: 'community_bot.token_request_command',
  minAmount: 'community_bot.min_amount',
  maxAmount: 'community_bot.max_amount',
  checkinSuccessReply: 'community_bot.checkin_success_reply',
  checkinAlreadyReply: 'community_bot.checkin_already_reply',
  checkinUnboundReply: 'community_bot.checkin_unbound_reply',
  tokenApprovedReply: 'community_bot.token_approved_reply',
  tokenAlreadyApprovedReply: 'community_bot.token_already_approved_reply',
  tokenUnboundReply: 'community_bot.token_unbound_reply',
  unknownErrorReply: 'community_bot.unknown_error_reply',
  tokenBlockPrompt: 'community_bot.token_block_prompt',
}

function normalize(values: CommunityBotValues): CommunityBotValues {
  return {
    ...values,
    baseUrl: values.baseUrl.trim().replace(/\/+$/, ''),
    roomId: values.roomId.trim(),
    botToken: values.botToken.trim(),
    oauthProviderSlug: values.oauthProviderSlug.trim(),
    checkinCommand: values.checkinCommand.trim(),
    tokenRequestCommand: values.tokenRequestCommand.trim(),
  }
}

type CommunityBotTextareaKey =
  | 'checkinSuccessReply'
  | 'checkinAlreadyReply'
  | 'checkinUnboundReply'
  | 'tokenApprovedReply'
  | 'tokenAlreadyApprovedReply'
  | 'tokenUnboundReply'
  | 'unknownErrorReply'
  | 'tokenBlockPrompt'

function textareaField(
  name: CommunityBotTextareaKey,
  label: string,
  description: string,
  rows = 2
) {
  return { name, label, description, rows }
}

export function CommunityBotSection({
  defaultValues,
}: {
  defaultValues: CommunityBotValues
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const schema = createSchema(t)
  const formDefaults = { ...defaultValues, botToken: '' }

  const form = useForm<CommunityBotValues>({
    resolver: zodResolver(schema),
    defaultValues: formDefaults,
  })

  useResetForm(form, formDefaults)

  const enabled = form.watch('enabled')

  async function onSubmit(rawValues: CommunityBotValues) {
    const values = normalize(rawValues)
    const current = normalize(formDefaults)
    const updates: Array<{ key: string; value: string | boolean | number }> = []

    ;(Object.keys(optionMap) as Array<keyof CommunityBotValues>).forEach((key) => {
      if (key === 'botToken' && values.botToken === '') {
        return
      }
      if (values[key] !== current[key]) {
        updates.push({ key: optionMap[key], value: values[key] })
      }
    })

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    const orderedUpdates = [
      ...updates.filter((update) => update.key !== 'community_bot.enabled'),
      ...updates.filter((update) => update.key === 'community_bot.enabled'),
    ]

    for (const update of orderedUpdates) {
      await updateOption.mutateAsync(update)
    }
    form.reset({ ...values, botToken: '' })
  }

  const replyFields = [
    textareaField(
      'checkinSuccessReply',
      'Check-in success reply',
      'Supports {amount}, {balance}, {quota}, {date}, {user_id}, {provider_user_id}, and {command}.'
    ),
    textareaField(
      'checkinAlreadyReply',
      'Already checked-in reply',
      'Sent when the user has already checked in today.'
    ),
    textareaField(
      'checkinUnboundReply',
      'Check-in unbound reply',
      'Sent when the community account is not bound to a new-api user.'
    ),
    textareaField(
      'tokenApprovedReply',
      'Token request approved reply',
      'Sent when token creation permission is granted.'
    ),
    textareaField(
      'tokenAlreadyApprovedReply',
      'Token request already approved reply',
      'Sent when the user already has token creation permission.'
    ),
    textareaField(
      'tokenUnboundReply',
      'Token request unbound reply',
      'Sent when the requester has not bound their community account.'
    ),
    textareaField(
      'unknownErrorReply',
      'Community bot error reply',
      'Sent when a command cannot be processed due to an internal error.'
    ),
    textareaField(
      'tokenBlockPrompt',
      'Token creation block prompt',
      'Shown in new-api when a user tries to create a token before requesting it in the community group.',
      3
    ),
  ]

  return (
    <SettingsSection title={t('Community Bot')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending || form.formState.isSubmitting}
            saveLabel='Save community bot settings'
          />

          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable community bot')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Listen to the configured community room for check-in and token creation commands.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={updateOption.isPending || form.formState.isSubmitting}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <div className='grid gap-6 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='baseUrl'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Community API URL')}</FormLabel>
                  <FormControl>
                    <Input
                      type='url'
                      placeholder='https://dc.hhhl.cc'
                      disabled={!enabled}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Base URL of the Misskey/Sharkey community instance.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='roomId'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Community room ID')}</FormLabel>
                  <FormControl>
                    <Input disabled={!enabled} {...field} />
                  </FormControl>
                  <FormDescription>
                    {t('The chat room ID monitored by the bot.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='botToken'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Bot API token')}</FormLabel>
                  <FormControl>
                    <Input
                      type='password'
                      autoComplete='new-password'
                      placeholder={t('Enter new token to update')}
                      disabled={!enabled}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Requires read:chat and write:chat. Leave blank to keep the existing token.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='pollIntervalSeconds'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Poll interval seconds')}</FormLabel>
                  <FormControl>
                    <Input type='number' min={5} disabled={!enabled} {...field} />
                  </FormControl>
                  <FormDescription>
                    {t('Minimum 5 seconds. The task runs only on the master node.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='oauthProviderId'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('OAuth provider ID')}</FormLabel>
                  <FormControl>
                    <Input type='number' min={0} disabled={!enabled} {...field} />
                  </FormControl>
                  <FormDescription>
                    {t('Preferred identity mapping. Use the custom OAuth provider ID.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='oauthProviderSlug'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('OAuth provider slug')}</FormLabel>
                  <FormControl>
                    <Input disabled={!enabled} {...field} />
                  </FormControl>
                  <FormDescription>
                    {t('Fallback identity mapping when provider ID is not set.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='checkinCommand'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Check-in command')}</FormLabel>
                  <FormControl>
                    <Input disabled={!enabled} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='tokenRequestCommand'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Token request command')}</FormLabel>
                  <FormControl>
                    <Input disabled={!enabled} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='minAmount'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Minimum community check-in amount')}</FormLabel>
                  <FormControl>
                    <Input type='number' min={0} step='0.01' disabled={!enabled} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='maxAmount'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Maximum community check-in amount')}</FormLabel>
                  <FormControl>
                    <Input type='number' min={0} step='0.01' disabled={!enabled} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className='grid gap-6 lg:grid-cols-2'>
            {replyFields.map((item) => (
              <FormField
                key={item.name}
                control={form.control}
                name={item.name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t(item.label)}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={item.rows}
                        disabled={!enabled && item.name !== 'tokenBlockPrompt'}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>{t(item.description)}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
