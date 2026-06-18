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
  lotteryEnabled: boolean
  lotteryCommand: string
  lotterySessions: string
  lotteryWinReply: string
  lotteryNoPrizeReply: string
  lotteryAlreadyDrawnReply: string
  lotteryOutOfSessionReply: string
  lotteryPoolEmptyReply: string
  lotteryUnboundReply: string
  lotteryErrorReply: string
  redPacketEnabled: boolean
  redPacketCreateCommand: string
  redPacketClaimCommand: string
  redPacketWhitelist: string
  redPacketConcurrencyMode: 'single' | 'multiple'
  redPacketExpireMinutes: number
  redPacketSplitMode: 'random' | 'average'
  redPacketMinTotalAmount: number
  redPacketMaxTotalAmount: number
  redPacketMinCount: number
  redPacketMaxCount: number
  redPacketCreatedReply: string
  redPacketClaimedReply: string
  redPacketEmptyReply: string
  redPacketAlreadyReply: string
  redPacketNotAllowedReply: string
  redPacketExpiredReply: string
  redPacketUsageReply: string
  redPacketUnboundReply: string
  redPacketErrorReply: string
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
      lotteryEnabled: z.boolean(),
      lotteryCommand: z.string(),
      lotterySessions: z
        .string()
        .refine((value) => {
          const trimmed = value.trim()
          if (trimmed === '') return true
          try {
            const parsed = JSON.parse(trimmed)
            return Array.isArray(parsed)
          } catch {
            return false
          }
        }, t('Lottery sessions must be a valid JSON array')),
      lotteryWinReply: z.string(),
      lotteryNoPrizeReply: z.string(),
      lotteryAlreadyDrawnReply: z.string(),
      lotteryOutOfSessionReply: z.string(),
      lotteryPoolEmptyReply: z.string(),
      lotteryUnboundReply: z.string(),
      lotteryErrorReply: z.string(),
      redPacketEnabled: z.boolean(),
      redPacketCreateCommand: z.string(),
      redPacketClaimCommand: z.string(),
      redPacketWhitelist: z.string(),
      redPacketConcurrencyMode: z.enum(['single', 'multiple']),
      redPacketExpireMinutes: z.coerce.number().int().min(0),
      redPacketSplitMode: z.enum(['random', 'average']),
      redPacketMinTotalAmount: z.coerce.number().min(0),
      redPacketMaxTotalAmount: z.coerce.number().min(0),
      redPacketMinCount: z.coerce.number().int().min(1),
      redPacketMaxCount: z.coerce.number().int().min(1),
      redPacketCreatedReply: z.string(),
      redPacketClaimedReply: z.string(),
      redPacketEmptyReply: z.string(),
      redPacketAlreadyReply: z.string(),
      redPacketNotAllowedReply: z.string(),
      redPacketExpiredReply: z.string(),
      redPacketUsageReply: z.string(),
      redPacketUnboundReply: z.string(),
      redPacketErrorReply: z.string(),
    })
    .superRefine((values, ctx) => {
      if (values.maxAmount < values.minAmount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxAmount'],
          message: t('Maximum amount must be greater than or equal to minimum amount'),
        })
      }
      if (values.redPacketMaxTotalAmount < values.redPacketMinTotalAmount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['redPacketMaxTotalAmount'],
          message: t('Maximum red packet amount must be greater than or equal to minimum amount'),
        })
      }
      if (values.redPacketMaxCount < values.redPacketMinCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['redPacketMaxCount'],
          message: t('Maximum red packet count must be greater than or equal to minimum count'),
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
  lotteryEnabled: 'community_bot.lottery_enabled',
  lotteryCommand: 'community_bot.lottery_command',
  lotterySessions: 'community_bot.lottery_sessions',
  lotteryWinReply: 'community_bot.lottery_win_reply',
  lotteryNoPrizeReply: 'community_bot.lottery_no_prize_reply',
  lotteryAlreadyDrawnReply: 'community_bot.lottery_already_drawn_reply',
  lotteryOutOfSessionReply: 'community_bot.lottery_out_of_session_reply',
  lotteryPoolEmptyReply: 'community_bot.lottery_pool_empty_reply',
  lotteryUnboundReply: 'community_bot.lottery_unbound_reply',
  lotteryErrorReply: 'community_bot.lottery_error_reply',
  redPacketEnabled: 'community_bot.red_packet_enabled',
  redPacketCreateCommand: 'community_bot.red_packet_create_command',
  redPacketClaimCommand: 'community_bot.red_packet_claim_command',
  redPacketWhitelist: 'community_bot.red_packet_whitelist',
  redPacketConcurrencyMode: 'community_bot.red_packet_concurrency_mode',
  redPacketExpireMinutes: 'community_bot.red_packet_expire_minutes',
  redPacketSplitMode: 'community_bot.red_packet_split_mode',
  redPacketMinTotalAmount: 'community_bot.red_packet_min_total_amount',
  redPacketMaxTotalAmount: 'community_bot.red_packet_max_total_amount',
  redPacketMinCount: 'community_bot.red_packet_min_count',
  redPacketMaxCount: 'community_bot.red_packet_max_count',
  redPacketCreatedReply: 'community_bot.red_packet_created_reply',
  redPacketClaimedReply: 'community_bot.red_packet_claimed_reply',
  redPacketEmptyReply: 'community_bot.red_packet_empty_reply',
  redPacketAlreadyReply: 'community_bot.red_packet_already_reply',
  redPacketNotAllowedReply: 'community_bot.red_packet_not_allowed_reply',
  redPacketExpiredReply: 'community_bot.red_packet_expired_reply',
  redPacketUsageReply: 'community_bot.red_packet_usage_reply',
  redPacketUnboundReply: 'community_bot.red_packet_unbound_reply',
  redPacketErrorReply: 'community_bot.red_packet_error_reply',
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
    lotteryCommand: values.lotteryCommand.trim(),
    lotterySessions: values.lotterySessions.trim(),
    redPacketCreateCommand: values.redPacketCreateCommand.trim(),
    redPacketClaimCommand: values.redPacketClaimCommand.trim(),
    redPacketWhitelist: values.redPacketWhitelist.trim(),
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
  | 'lotteryWinReply'
  | 'lotteryNoPrizeReply'
  | 'lotteryAlreadyDrawnReply'
  | 'lotteryOutOfSessionReply'
  | 'lotteryPoolEmptyReply'
  | 'lotteryUnboundReply'
  | 'lotteryErrorReply'
  | 'redPacketCreatedReply'
  | 'redPacketClaimedReply'
  | 'redPacketEmptyReply'
  | 'redPacketAlreadyReply'
  | 'redPacketNotAllowedReply'
  | 'redPacketExpiredReply'
  | 'redPacketUsageReply'
  | 'redPacketUnboundReply'
  | 'redPacketErrorReply'

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
    textareaField(
      'lotteryWinReply',
      'Lottery win reply',
      'Supports {prize_name}, {amount}, {balance}, {quota}, {session_name}, {date}, {user_id}, {provider_user_id}, {command}.',
      3
    ),
    textareaField(
      'lotteryNoPrizeReply',
      'Lottery no prize reply',
      'Sent when the drawn prize amount is 0.',
      2
    ),
    textareaField(
      'lotteryAlreadyDrawnReply',
      'Lottery already drawn reply',
      'Sent when the user already drew this session today.',
      2
    ),
    textareaField(
      'lotteryOutOfSessionReply',
      'Lottery out of session reply',
      'Sent when no session is currently active. Supports {next_session_name}, {next_start}, {next_end}.',
      2
    ),
    textareaField(
      'lotteryPoolEmptyReply',
      'Lottery pool empty reply',
      'Sent when the session budget cannot fund any remaining prize.',
      2
    ),
    textareaField(
      'lotteryUnboundReply',
      'Lottery unbound reply',
      'Sent when the lottery requester has not bound their community account.',
      2
    ),
    textareaField(
      'lotteryErrorReply',
      'Lottery error reply',
      'Sent when the lottery cannot be processed due to a configuration or internal error.',
      2
    ),
    textareaField(
      'redPacketCreatedReply',
      'Red packet created reply',
      'Supports {provider_user_id}, {creator}, {total_amount}, {total_count}, {claim_command}.',
      2
    ),
    textareaField(
      'redPacketClaimedReply',
      'Red packet claimed reply',
      'Supports {provider_user_id}, {amount}, {balance}, {remaining_count}, {creator}.',
      2
    ),
    textareaField(
      'redPacketEmptyReply',
      'Red packet empty reply',
      'Sent when there is no active red packet to claim.',
      2
    ),
    textareaField(
      'redPacketAlreadyReply',
      'Red packet already claimed reply',
      'Sent when the user already claimed the current red packet.',
      2
    ),
    textareaField(
      'redPacketNotAllowedReply',
      'Red packet not allowed reply',
      'Sent when a non-whitelisted user tries to create a red packet.',
      2
    ),
    textareaField(
      'redPacketExpiredReply',
      'Red packet expired reply',
      'Sent when the red packet has expired.',
      2
    ),
    textareaField(
      'redPacketUsageReply',
      'Red packet usage reply',
      'Sent when the create command parameters are invalid.',
      2
    ),
    textareaField(
      'redPacketUnboundReply',
      'Red packet unbound reply',
      'Sent when the requester has not bound their community account.',
      2
    ),
    textareaField(
      'redPacketErrorReply',
      'Red packet error reply',
      'Sent when an internal error happens during red packet processing.',
      2
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

          <FormField
            control={form.control}
            name='lotteryEnabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable community lottery')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Open the lottery command during configured time windows. Each user can draw once per session per day.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={!enabled || updateOption.isPending || form.formState.isSubmitting}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <div className='grid gap-6 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='lotteryCommand'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Lottery command')}</FormLabel>
                  <FormControl>
                    <Input disabled={!enabled} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name='lotterySessions'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Lottery sessions JSON')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={12}
                    spellCheck={false}
                    className='font-mono text-xs'
                    disabled={!enabled}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Define daily lottery sessions. Each session has key, name, start, end (HH:mm), budget (USD), and prizes with name, weight, amount.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='redPacketEnabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable community red packet')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Allow whitelisted users to send red packets and other members to claim them in the community room.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={!enabled || updateOption.isPending || form.formState.isSubmitting}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <div className='grid gap-6 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='redPacketCreateCommand'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Red packet create command')}</FormLabel>
                  <FormControl>
                    <Input disabled={!enabled} {...field} />
                  </FormControl>
                  <FormDescription>
                    {t('Used as command prefix, e.g. send "<prefix> 10 5".')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='redPacketClaimCommand'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Red packet claim command')}</FormLabel>
                  <FormControl>
                    <Input disabled={!enabled} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='redPacketWhitelist'
              render={({ field }) => (
                <FormItem className='sm:col-span-2'>
                  <FormLabel>{t('Red packet creator whitelist')}</FormLabel>
                  <FormControl>
                    <Input disabled={!enabled} {...field} />
                  </FormControl>
                  <FormDescription>
                    {t('Comma-separated community usernames that are allowed to send red packets.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='redPacketConcurrencyMode'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Red packet concurrency mode')}</FormLabel>
                  <FormControl>
                    <select
                      className='border-input bg-background flex h-9 w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
                      disabled={!enabled}
                      value={field.value}
                      onChange={(event) => field.onChange(event.target.value)}
                    >
                      <option value='single'>{t('Single (only one open at a time)')}</option>
                      <option value='multiple'>{t('Multiple (allow several open)')}</option>
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='redPacketSplitMode'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Red packet split mode')}</FormLabel>
                  <FormControl>
                    <select
                      className='border-input bg-background flex h-9 w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
                      disabled={!enabled}
                      value={field.value}
                      onChange={(event) => field.onChange(event.target.value)}
                    >
                      <option value='random'>{t('Random (twice-the-mean random)')}</option>
                      <option value='average'>{t('Average (everyone gets the same)')}</option>
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='redPacketExpireMinutes'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Red packet expire minutes')}</FormLabel>
                  <FormControl>
                    <Input type='number' min={0} disabled={!enabled} {...field} />
                  </FormControl>
                  <FormDescription>
                    {t('0 means the red packet never expires.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='redPacketMinTotalAmount'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Red packet minimum total amount')}</FormLabel>
                  <FormControl>
                    <Input type='number' min={0} step='0.01' disabled={!enabled} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='redPacketMaxTotalAmount'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Red packet maximum total amount')}</FormLabel>
                  <FormControl>
                    <Input type='number' min={0} step='0.01' disabled={!enabled} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='redPacketMinCount'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Red packet minimum count')}</FormLabel>
                  <FormControl>
                    <Input type='number' min={1} disabled={!enabled} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='redPacketMaxCount'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Red packet maximum count')}</FormLabel>
                  <FormControl>
                    <Input type='number' min={1} disabled={!enabled} {...field} />
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
