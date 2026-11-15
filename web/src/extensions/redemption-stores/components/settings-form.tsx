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
import { Plus, Store } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'
import { TitledCard } from '@/components/ui/titled-card'
import { handleServerError } from '@/lib/handle-server-error'

import { redemptionStoreSettingsKey, saveSettings } from '../api'
import { redemptionStoreSchema } from '../lib/schema'
import type { RedemptionStoreSettings } from '../types'
import { StoreEditor } from './store-editor'

export function StoreSettingsForm(props: {
  settings: RedemptionStoreSettings
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [reloadOpen, setReloadOpen] = useState(false)
  const [removeIndex, setRemoveIndex] = useState<number | null>(null)
  const form = useForm<RedemptionStoreSettings>({
    resolver: zodResolver(redemptionStoreSchema, {
      error: () => 'Check this value and the permitted limits',
    }),
    defaultValues: props.settings,
  })
  const stores = useFieldArray({ control: form.control, name: 'stores' })
  const revision = form.watch('revision')
  const save = useMutation({
    mutationFn: saveSettings,
    onError: (error) => {
      handleServerError(error)
      void client.invalidateQueries({ queryKey: redemptionStoreSettingsKey })
    },
    onSuccess: (settings) => {
      form.reset(settings)
      client.setQueryData(redemptionStoreSettingsKey, settings)
      toast.success(t('Redemption stores saved'))
    },
  })
  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
      >
        <fieldset
          disabled={save.isPending}
          className='space-y-5 disabled:opacity-70'
        >
          <TitledCard
            title={t('Redemption stores')}
            icon={<Store aria-hidden='true' />}
            disableHoverEffect
            contentClassName='space-y-4'
            action={
              <Button
                type='submit'
                disabled={
                  save.isPending ||
                  !form.formState.isDirty ||
                  props.settings.revision > revision
                }
              >
                {t('Save Changes')}
              </Button>
            }
          >
            <FormField
              control={form.control}
              name='enabled'
              render={({ field }) => (
                <FormItem className='flex items-center gap-3'>
                  <FormLabel>{t('Enable redemption stores')}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className='text-muted-foreground text-sm'>
              {t(
                'Users buy codes in an external store, then return to the wallet to redeem. Online payment gateways are optional.'
              )}
            </p>
            <Alert>
              <AlertDescription>
                {t(
                  'Store cards appear only after payment compliance terms are confirmed. Store order below is the wallet display order.'
                )}
              </AlertDescription>
            </Alert>
            {props.settings.revision > revision && (
              <Alert>
                <AlertDescription className='flex flex-wrap items-center justify-between gap-3'>
                  <span>
                    {t('Redemption stores changed. Reload before saving.')}
                  </span>
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => setReloadOpen(true)}
                  >
                    {t('Reload saved settings')}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </TitledCard>
          <TitledCard
            title={t('Store cards')}
            description={t(
              'Add up to 32 stores. Hide an individual store or change its position using the arrow buttons.'
            )}
            disableHoverEffect
            contentClassName='space-y-4'
          >
            {stores.fields.length === 0 && (
              <EmptyState
                icon={Store}
                title={t('No stores configured')}
                description={t(
                  'Add a store name and purchase URL to get started.'
                )}
                className='min-h-40'
              />
            )}
            {stores.fields.map((store, index) => (
              <StoreEditor
                key={store.id}
                index={index}
                total={stores.fields.length}
                onMove={stores.move}
                onRemove={() => setRemoveIndex(index)}
              />
            ))}
            <Button
              type='button'
              variant='outline'
              disabled={stores.fields.length >= 32}
              onClick={() =>
                stores.append({
                  id: nanoid(),
                  name: '',
                  url: '',
                  description: '',
                  enabled: true,
                })
              }
            >
              <Plus aria-hidden='true' />
              {t('Add store')}
            </Button>
          </TitledCard>
        </fieldset>
      </form>
      <ConfirmDialog
        open={reloadOpen}
        onOpenChange={setReloadOpen}
        title={t('Reload saved settings')}
        desc={t('Discard unsaved changes and load the latest settings?')}
        confirmText={t('Reload')}
        handleConfirm={() => {
          form.reset(props.settings)
          setReloadOpen(false)
        }}
      />
      <ConfirmDialog
        open={removeIndex !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveIndex(null)
        }}
        title={t('Remove store')}
        desc={t(
          'This store will disappear from the wallet after you save changes.'
        )}
        confirmText={t('Remove')}
        destructive
        handleConfirm={() => {
          if (removeIndex !== null) stores.remove(removeIndex)
          setRemoveIndex(null)
        }}
      />
    </Form>
  )
}
