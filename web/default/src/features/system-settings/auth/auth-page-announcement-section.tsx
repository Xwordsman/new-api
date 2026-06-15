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
import { useForm } from 'react-hook-form'
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
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SettingsSection } from '../components/settings-section'
import { SettingsSwitchField } from '../components/settings-form-layout'
import { useUpdateOption } from '../hooks/use-update-option'

type AuthPageAnnouncementSectionProps = {
  defaultValues: {
    auth_page_announcement_enabled: boolean
    auth_page_announcement: string
  }
}

export function AuthPageAnnouncementSection({
  defaultValues,
}: AuthPageAnnouncementSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const form = useForm({
    defaultValues: {
      auth_page_announcement_enabled: defaultValues.auth_page_announcement_enabled || false,
      auth_page_announcement: defaultValues.auth_page_announcement || '',
    },
  })

  const handleToggleEnabled = async (checked: boolean) => {
    try {
      await updateOption.mutateAsync({
        key: 'auth_page_announcement_enabled',
        value: checked,
      })
      form.setValue('auth_page_announcement_enabled', checked)
      toast.success(t('Setting saved'))
    } catch {
      toast.error(t('Failed to update setting'))
    }
  }

  const handleSaveAnnouncement = async () => {
    const value = form.getValues('auth_page_announcement')
    try {
      await updateOption.mutateAsync({
        key: 'auth_page_announcement',
        value,
      })
      toast.success(t('Announcement saved'))
    } catch {
      toast.error(t('Failed to save announcement'))
    }
  }

  return (
    <SettingsSection title={t('Login/Register Page Announcement')}>
      <div className='space-y-4'>
        <SettingsSwitchField
          checked={form.watch('auth_page_announcement_enabled')}
          onCheckedChange={handleToggleEnabled}
          label={t('Enable Announcement')}
          description={t('Show announcement on login and registration pages')}
        />

        <Form {...form}>
          <FormField
            control={form.control}
            name='auth_page_announcement'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Announcement Content')}</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder={t('Enter announcement content (supports HTML)')}
                    rows={6}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t('This announcement will be displayed prominently on login and registration pages. Supports HTML for formatting.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </Form>

        <div className='flex justify-end'>
          <Button onClick={handleSaveAnnouncement} disabled={updateOption.isPending}>
            {t('Save Announcement')}
          </Button>
        </div>
      </div>
    </SettingsSection>
  )
}
