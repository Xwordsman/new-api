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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Save } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'

import { getInvitationSettings, updateInvitationSettings } from './api'

const settingsSchema = z.object({
  enabled: z.boolean(),
})

type SettingsFormValues = z.infer<typeof settingsSchema>

export function InvitationSettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: ['invitation-extension', 'settings'],
    queryFn: getInvitationSettings,
  })
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { enabled: false },
  })

  useEffect(() => {
    if (settingsQuery.data) {
      form.reset(settingsQuery.data)
    }
  }, [form, settingsQuery.data])

  const updateMutation = useMutation({
    mutationFn: (values: SettingsFormValues) =>
      updateInvitationSettings(values.enabled),
    onSuccess: async (settings) => {
      form.reset(settings)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['invitation-extension', 'settings'],
        }),
        queryClient.invalidateQueries({ queryKey: ['status'] }),
      ])
      toast.success(t('Invitation settings saved'))
    },
  })

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Invitation Settings')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          onClick={form.handleSubmit((values) => updateMutation.mutate(values))}
          disabled={settingsQuery.isLoading || updateMutation.isPending}
        >
          {updateMutation.isPending ? (
            <Loader2 className='animate-spin' />
          ) : (
            <Save />
          )}
          {t('Save')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) =>
              updateMutation.mutate(values)
            )}
            className='max-w-3xl'
          >
            <FormField
              control={form.control}
              name='enabled'
              render={({ field }) => (
                <FormItem className='flex items-center justify-between gap-6 border-b py-4'>
                  <div className='space-y-1'>
                    <FormLabel>{t('Require Invitation Code')}</FormLabel>
                    <FormDescription>
                      {t(
                        'When enabled, password registration requires a valid invitation code'
                      )}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={settingsQuery.isLoading}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </form>
        </Form>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
