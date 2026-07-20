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
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { getHomepageSettings, updateHomepageSettings } from './api'

const settingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['showcase', 'not_found', 'community']),
  title: z.string().max(120),
  description: z.string().max(500),
  button_text: z.string().max(50),
  button_url: z.string().max(2048),
})

type SettingsFormValues = z.infer<typeof settingsSchema>

const defaultValues: SettingsFormValues = {
  enabled: false,
  mode: 'showcase',
  title: '',
  description: '',
  button_text: '',
  button_url: '',
}

export function HomepageSettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: ['homepage-extension', 'settings'],
    queryFn: getHomepageSettings,
  })
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues,
  })
  const selectedMode = form.watch('mode')

  useEffect(() => {
    if (settingsQuery.data) {
      form.reset(settingsQuery.data)
    }
  }, [form, settingsQuery.data])

  const updateMutation = useMutation({
    mutationFn: updateHomepageSettings,
    onSuccess: async (settings) => {
      form.reset(settings)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['homepage-extension', 'settings'],
        }),
        queryClient.invalidateQueries({ queryKey: ['status'] }),
      ])
      toast.success(t('Homepage settings saved'))
    },
  })

  const save = form.handleSubmit((values) => updateMutation.mutate(values))

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Homepage Settings')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          onClick={save}
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
          <form onSubmit={save} className='max-w-3xl space-y-6'>
            <FormField
              control={form.control}
              name='enabled'
              render={({ field }) => (
                <FormItem className='flex items-center justify-between gap-6 border-b py-4'>
                  <div className='space-y-1'>
                    <FormLabel>{t('Enable Homepage Override')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Choose a custom homepage. Community mode keeps the public navigation; scene and 404 modes hide it.'
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

            <div className='grid gap-5 md:grid-cols-2'>
              <FormField
                control={form.control}
                name='mode'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Homepage Mode')}</FormLabel>
                    <Select
                      items={[
                        {
                          value: 'community',
                          label: t('Community Homepage'),
                        },
                        { value: 'showcase', label: t('Immersive Scene') },
                        { value: 'not_found', label: t('404 Style Page') },
                      ]}
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className='w-full'>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectGroup>
                          <SelectItem value='community'>
                            {t('Community Homepage')}
                          </SelectItem>
                          <SelectItem value='showcase'>
                            {t('Immersive Scene')}
                          </SelectItem>
                          <SelectItem value='not_found'>
                            {t('404 Style Page')}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {selectedMode === 'community'
                        ? t(
                            'The community homepage replaces the default new frontend homepage and keeps the public header and footer.'
                          )
                        : t(
                            'The immersive scene and 404 page are completely separate from the application.'
                          )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='title'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Page Title')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={120}
                        placeholder={t('Leave blank to use the default title')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name='description'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Page Description')}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      maxLength={500}
                      rows={4}
                      placeholder={t(
                        'Leave blank to use the default description'
                      )}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='grid gap-5 md:grid-cols-2'>
              <FormField
                control={form.control}
                name='button_text'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Button Text')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={50}
                        placeholder={t('Optional button')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='button_url'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Button Link')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={2048}
                        placeholder='https://example.com'
                      />
                    </FormControl>
                    <FormDescription>
                      {selectedMode === 'community'
                        ? t(
                            'In community mode, this optional link highlights a community resource.'
                          )
                        : t('Leave both button fields blank to show no link')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </form>
        </Form>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
