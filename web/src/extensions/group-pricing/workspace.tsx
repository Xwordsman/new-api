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
import { useEffect, useState } from 'react'
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Form } from '@/components/ui/form'
import {
  GroupRatioForm,
  type GroupFormValues,
} from '@/features/system-settings/models/group-ratio-form'

import { getGroupPricing, saveGroupPricing, type PricingSnapshot } from './api'
import { PromotionFields } from './promotion-fields'
import { promotionsSchema, type PromotionForm } from './schema'

function pricingValues(snapshot: PricingSnapshot): GroupFormValues {
  return {
    GroupRatio: snapshot.options.GroupRatio,
    GroupDisplayOrder: snapshot.options.GroupDisplayOrder,
    TopupGroupRatio: snapshot.options.TopupGroupRatio,
    UserUsableGroups: snapshot.options.UserUsableGroups,
    GroupGroupRatio: snapshot.options.GroupGroupRatio,
    AutoGroups: snapshot.options.AutoGroups,
    MaxTokenAutoGroups: Number(snapshot.options.MaxTokenAutoGroups),
    DefaultUseAutoGroup: snapshot.options.DefaultUseAutoGroup === 'true',
    GroupSpecialUsableGroup:
      snapshot.options['group_ratio_setting.group_special_usable_group'],
  }
}
function promotionValues(snapshot: PricingSnapshot): PromotionForm {
  const bases = JSON.parse(snapshot.options.GroupRatio) as Record<
    string,
    number
  >
  return {
    revision: snapshot.promotions.revision,
    groups: snapshot.promotions.groups.map((entry) => ({
      group: entry.group,
      promotion: entry.promotion
        ? {
            ...entry.promotion,
            ratio:
              entry.promotion.ratio ??
              (bases[entry.group] ?? 1) * (entry.promotion.factor ?? 1),
          }
        : null,
    })),
  }
}

// A rename is explicit only in the visual editor. Raw JSON delete/add operations
// cannot establish identity and must not silently move another group's offer.
function renameReferences(
  values: GroupFormValues,
  old: string,
  name: string
): Pick<
  GroupFormValues,
  'GroupGroupRatio' | 'GroupSpecialUsableGroup' | 'AutoGroups'
> {
  const ratios = z
    .record(z.string(), z.record(z.string(), z.number()))
    .parse(JSON.parse(values.GroupGroupRatio))
  const special = z
    .record(z.string(), z.record(z.string(), z.string()))
    .parse(JSON.parse(values.GroupSpecialUsableGroup))
  const auto = z.array(z.string()).parse(JSON.parse(values.AutoGroups))
  if (
    (Object.hasOwn(ratios, old) && Object.hasOwn(ratios, name)) ||
    (Object.hasOwn(special, old) && Object.hasOwn(special, name)) ||
    Object.values(ratios).some(
      (inner) => Object.hasOwn(inner, old) && Object.hasOwn(inner, name)
    ) ||
    Object.values(special).some((inner) =>
      ['', '+:', '-:'].some(
        (prefix) =>
          Object.hasOwn(inner, prefix + old) &&
          Object.hasOwn(inner, prefix + name)
      )
    )
  ) {
    throw new Error('Conflicting group references')
  }
  const renamedRatios = Object.fromEntries(
    Object.entries(ratios).map(([outer, inner]) => [
      outer === old ? name : outer,
      Object.fromEntries(
        Object.entries(inner).map(([key, value]) => [
          key === old ? name : key,
          value,
        ])
      ),
    ])
  )
  const renamedSpecial = Object.fromEntries(
    Object.entries(special).map(([outer, inner]) => [
      outer === old ? name : outer,
      Object.fromEntries(
        Object.entries(inner).map(([key, value]) => {
          let next = key
          if (key === old) next = name
          if (key === `+:${old}`) next = `+:${name}`
          if (key === `-:${old}`) next = `-:${name}`
          return [next, value]
        })
      ),
    ])
  )
  return {
    GroupGroupRatio: JSON.stringify(renamedRatios),
    GroupSpecialUsableGroup: JSON.stringify(renamedSpecial),
    AutoGroups: JSON.stringify(
      auto.map((group) => (group === old ? name : group))
    ),
  }
}

export function GroupPricingWorkspace(props: {
  form: UseFormReturn<GroupFormValues>
}) {
  const query = useQuery({
    queryKey: ['group-pricing', 'settings'],
    queryFn: getGroupPricing,
    refetchOnWindowFocus: false,
  })
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  return <PricingEditor form={props.form} initial={query.data} />
}

function PricingEditor(props: {
  form: UseFormReturn<GroupFormValues>
  initial: PricingSnapshot
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [baseline, setBaseline] = useState(props.initial)
  const [renames, setRenames] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<string[]>([])
  const offers = useForm<PromotionForm>({
    resolver: zodResolver(promotionsSchema),
    defaultValues: promotionValues(props.initial),
  })
  const groups = useWatch({ control: offers.control, name: 'groups' })
  const rawBases = useWatch({ control: props.form.control, name: 'GroupRatio' })
  const rawOrder = useWatch({
    control: props.form.control,
    name: 'GroupDisplayOrder',
  })
  useEffect(() => {
    props.form.reset(pricingValues(baseline))
  }, [props.form, baseline])
  let bases: Record<string, number> = {}
  let order: string[] = []
  try {
    const parsed = z
      .record(z.string(), z.number())
      .safeParse(JSON.parse(rawBases))
    if (parsed.success) bases = parsed.data
  } catch {
    /* The group form reports invalid JSON on save. */
  }
  try {
    const parsed = z.array(z.string()).safeParse(JSON.parse(rawOrder))
    if (parsed.success) order = parsed.data
  } catch {
    /* Keep the editor usable while JSON is incomplete. */
  }
  const names = [
    ...new Set([
      ...Object.keys(bases),
      ...groups.filter((group) => group.promotion).map((group) => group.group),
    ]),
  ]
  const positions = new Map(order.map((name, index) => [name, index]))
  names.sort(
    (a, b) =>
      (positions.get(a) ?? Infinity) - (positions.get(b) ?? Infinity) ||
      a.localeCompare(b)
  )
  const save = useMutation({
    mutationFn: saveGroupPricing,
    onSuccess: async (snapshot) => {
      setBaseline(snapshot)
      offers.reset(promotionValues(snapshot))
      setRenames({})
      client.setQueryData(['group-pricing', 'settings'], snapshot)
      await Promise.all(
        [
          'system-options',
          'pricing',
          'groups',
          'user-groups',
          'token-auto-groups',
          'playground-groups',
          'channel-monitor',
          'model-pricing-config',
          'model-pricing-preview',
        ].map((key) => client.invalidateQueries({ queryKey: [key] }))
      )
      toast.success(t('Group settings saved'))
    },
  })
  const onRename = (original: string, name: string) => {
    const root =
      Object.entries(renames).find(
        ([, current]) => current === original
      )?.[0] ?? original
    const previous = renames[root] ?? original
    if (previous === name) return true
    const savedBases = JSON.parse(baseline.options.GroupRatio) as Record<
      string,
      number
    >
    if (
      (name !== root && Object.hasOwn(savedBases, name)) ||
      offers
        .getValues('groups')
        .some((group) => group.group === name && group.promotion)
    ) {
      toast.error(
        t('The target group already has settings. Choose another name.')
      )
      return false
    }
    try {
      const references = renameReferences(
        props.form.getValues(),
        previous,
        name
      )
      for (const key of [
        'GroupGroupRatio',
        'GroupSpecialUsableGroup',
        'AutoGroups',
      ] as const) {
        props.form.setValue(key, references[key], { shouldDirty: true })
      }
    } catch {
      toast.error(t('Fix invalid or conflicting group JSON before renaming.'))
      return false
    }
    offers.setValue(
      'groups',
      offers
        .getValues('groups')
        .map((group) =>
          group.group === previous ? { ...group, group: name } : group
        ),
      { shouldDirty: true }
    )
    setExpanded((current) =>
      current.map((group) => (group === previous ? name : group))
    )
    if (Object.hasOwn(savedBases, root)) {
      setRenames((current) => {
        const next = { ...current }
        if (name === root) delete next[root]
        else next[root] = name
        return next
      })
    }
    return true
  }
  return (
    <div className='space-y-6'>
      <GroupRatioForm
        key={baseline.promotions.revision}
        form={props.form}
        isSaving={save.isPending}
        onRename={onRename}
        onSave={async (values) => {
          await offers.handleSubmit(
            async (promotions) => {
              const options: Record<string, string> = { ...baseline.options }
              for (const [key, value] of Object.entries(values)) {
                options[
                  key === 'GroupSpecialUsableGroup'
                    ? 'group_ratio_setting.group_special_usable_group'
                    : key
                ] = String(value)
              }
              await save
                .mutateAsync({
                  options,
                  baseline: baseline.options,
                  renames,
                  promotions: {
                    ...promotions,
                    groups: promotions.groups.filter(
                      (group) => group.promotion
                    ),
                  },
                })
                .catch(() => {})
            },
            (errors) => {
              setExpanded((current) => [
                ...new Set([
                  ...current,
                  ...offers
                    .getValues('groups')
                    .filter((_, index) => errors.groups?.[index])
                    .map((group) => group.group),
                ]),
              ])
            }
          )()
        }}
      />
      <section className='space-y-4'>
        <h3 className='font-semibold'>{t('Public group discounts')}</h3>
        <Alert>
          <AlertDescription>
            {t(
              'Public discounts are saved independently of channel monitoring. Use Save group settings to save pricing and offers together.'
            )}
          </AlertDescription>
        </Alert>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Visual renames update pricing rules, public offers and monitor references. Existing channel, user and API key group assignments must be updated separately.'
          )}
        </p>
        <Form {...offers}>
          <Accordion
            multiple
            keepMounted
            value={expanded}
            onValueChange={(next) => {
              const entries = offers.getValues('groups')
              const missing = next.filter(
                (name) => !entries.some((entry) => entry.group === name)
              )
              if (missing.length) {
                offers.setValue('groups', [
                  ...entries,
                  ...missing.map((group) => ({ group, promotion: null })),
                ])
              }
              setExpanded(next)
            }}
            className='gap-3'
          >
            {names.map((name) => {
              const index = groups.findIndex((group) => group.group === name)
              return (
                <AccordionItem
                  key={name}
                  value={name}
                  className='bg-card rounded-xl border'
                >
                  <AccordionTrigger
                    aria-label={t('Public discount for {{group}}', {
                      group: name,
                    })}
                    className='px-5'
                  >
                    <span className='font-mono'>{name}</span>
                    {bases[name] === undefined && (
                      <span className='text-muted-foreground text-xs'>
                        {t('Group no longer configured')}
                      </span>
                    )}
                  </AccordionTrigger>
                  <AccordionContent className='px-5 pb-5'>
                    {index >= 0 && (
                      <PromotionFields
                        index={index}
                        baseRatio={bases[name]}
                        disabled={save.isPending}
                      />
                    )}
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        </Form>
      </section>
    </div>
  )
}
