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
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/components/footer'
import { PageTransition } from '@/components/page-transition'

import {
  LoadingSkeleton,
  EmptyState,
  SearchBar,
  PricingTable,
  PricingSidebar,
  PricingToolbar,
  ModelCardGrid,
  ModelDetailsDrawer,
} from './components'
import { PricingHero } from './components/pricing-hero'
import { EXCLUDED_GROUPS, VIEW_MODES } from './constants'
import { useFilters } from './hooks/use-filters'
import { usePricingData } from './hooks/use-pricing-data'

export function Pricing() {
  const { t } = useTranslation()
  const [selectedModelName, setSelectedModelName] = useState<string | null>(
    null
  )

  const {
    models,
    vendors,
    groupRatio,
    usableGroup,
    groupOrder,
    endpointMap,
    autoGroups,
    isLoading,
    error,
    refetch,
    priceRate,
    usdExchangeRate,
  } = usePricingData()

  const {
    searchInput,
    sortBy,
    vendorFilter,
    groupFilter,
    quotaTypeFilter,
    endpointTypeFilter,
    tagFilter,
    tokenUnit,
    viewMode,
    showRechargePrice,
    setSearchInput,
    setSortBy,
    setVendorFilter,
    setGroupFilter,
    setQuotaTypeFilter,
    setEndpointTypeFilter,
    setTagFilter,
    setTokenUnit,
    setViewMode,
    setShowRechargePrice,
    filteredModels,
    hasActiveFilters,
    activeFilterCount,
    availableTags,
    clearFilters,
    clearSearch,
  } = useFilters(models || [])

  const handleModelClick = useCallback((modelName: string) => {
    setSelectedModelName(modelName)
  }, [])

  const selectedModel = useMemo(
    () =>
      selectedModelName
        ? (models || []).find(
            (model) => model.model_name === selectedModelName
          ) || null
        : null,
    [models, selectedModelName]
  )

  const availableGroups = useMemo(
    () => groupOrder.filter((g) => !EXCLUDED_GROUPS.includes(g)),
    [groupOrder]
  )

  const enabledVendors = useMemo(() => {
    const vendorIds = new Set(models.map((model) => model.vendor_id))
    return vendors.filter((vendor) => vendorIds.has(vendor.id))
  }, [models, vendors])

  const handleClearAll = useCallback(() => {
    clearFilters()
    clearSearch()
  }, [clearFilters, clearSearch])

  const renderPricingContent = () => {
    if (error) {
      return (
        <ErrorState
          title={t('Unable to load models')}
          description={t('Please try again to load the model catalog.')}
          onRetry={() => void refetch()}
          className='pricing-result-state'
        />
      )
    }

    if (filteredModels.length === 0) {
      return (
        <EmptyState
          searchQuery={searchInput}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={handleClearAll}
        />
      )
    }

    if (viewMode === VIEW_MODES.CARD) {
      return (
        <ModelCardGrid
          models={filteredModels}
          onModelClick={handleModelClick}
          priceRate={priceRate}
          usdExchangeRate={usdExchangeRate}
          tokenUnit={tokenUnit}
          showRechargePrice={showRechargePrice}
          selectedGroup={groupFilter}
        />
      )
    }

    return (
      <div className='pricing-table-panel'>
        <PricingTable
          models={filteredModels}
          priceRate={priceRate}
          usdExchangeRate={usdExchangeRate}
          tokenUnit={tokenUnit}
          showRechargePrice={showRechargePrice}
          selectedGroup={groupFilter}
          onModelClick={handleModelClick}
        />
      </div>
    )
  }

  return (
    <PublicLayout showMainContainer={false}>
      <main className='pricing-page'>
        <PricingHero
          modelCount={models.length}
          vendors={enabledVendors}
          groupCount={availableGroups.length}
          pending={isLoading || Boolean(error)}
        />
        <PageTransition className='pricing-container pricing-catalog'>
          <section aria-labelledby='pricing-catalog-title'>
            <div className='pricing-catalog-heading'>
              <div>
                <p className='pricing-section-label'>{t('Model collection')}</p>
                <h2 id='pricing-catalog-title'>{t('Browse all models')}</h2>
                <p className='pricing-catalog-description'>
                  {t(
                    'Select a group to compare its model prices. Open a model for full pricing details.'
                  )}
                </p>
              </div>
              <SearchBar
                value={searchInput}
                onChange={setSearchInput}
                onClear={clearSearch}
                placeholder={t('Search models, providers, or tags...')}
                className='pricing-catalog-search'
              />
            </div>

            {isLoading ? (
              <LoadingSkeleton viewMode={viewMode} />
            ) : (
              <div className='pricing-catalog-grid'>
                <PricingSidebar
                  quotaTypeFilter={quotaTypeFilter}
                  endpointTypeFilter={endpointTypeFilter}
                  vendorFilter={vendorFilter}
                  groupFilter={groupFilter}
                  tagFilter={tagFilter}
                  onQuotaTypeChange={setQuotaTypeFilter}
                  onEndpointTypeChange={setEndpointTypeFilter}
                  onVendorChange={setVendorFilter}
                  onGroupChange={setGroupFilter}
                  onTagChange={setTagFilter}
                  vendors={vendors || []}
                  groups={availableGroups}
                  groupRatios={groupRatio}
                  tags={availableTags}
                  models={models || []}
                  hasActiveFilters={hasActiveFilters}
                  onClearFilters={clearFilters}
                  className='hover-scrollbar sticky top-20 hidden max-h-[calc(100dvh-6rem)] self-start overflow-y-auto lg:block'
                />

                <div className='min-w-0 space-y-5'>
                  <PricingToolbar
                    filteredCount={filteredModels.length}
                    totalCount={models?.length}
                    sortBy={sortBy}
                    onSortChange={setSortBy}
                    tokenUnit={tokenUnit}
                    onTokenUnitChange={setTokenUnit}
                    showRechargePrice={showRechargePrice}
                    onRechargePriceChange={setShowRechargePrice}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    quotaTypeFilter={quotaTypeFilter}
                    endpointTypeFilter={endpointTypeFilter}
                    vendorFilter={vendorFilter}
                    groupFilter={groupFilter}
                    tagFilter={tagFilter}
                    onQuotaTypeChange={setQuotaTypeFilter}
                    onEndpointTypeChange={setEndpointTypeFilter}
                    onVendorChange={setVendorFilter}
                    onGroupChange={setGroupFilter}
                    onTagChange={setTagFilter}
                    vendors={vendors || []}
                    groups={availableGroups}
                    groupRatios={groupRatio}
                    tags={availableTags}
                    models={models || []}
                    hasActiveFilters={hasActiveFilters}
                    activeFilterCount={activeFilterCount}
                    onClearFilters={clearFilters}
                  />

                  {renderPricingContent()}
                </div>
              </div>
            )}
          </section>

          {selectedModel && (
            <ModelDetailsDrawer
              open={Boolean(selectedModel)}
              onOpenChange={(open) => {
                if (!open) setSelectedModelName(null)
              }}
              model={selectedModel}
              groupRatio={groupRatio || {}}
              usableGroup={usableGroup || {}}
              groupOrder={groupOrder}
              endpointMap={
                (endpointMap as Record<
                  string,
                  { path?: string; method?: string }
                >) || {}
              }
              autoGroups={autoGroups || []}
              priceRate={priceRate ?? 1}
              usdExchangeRate={usdExchangeRate ?? 1}
              tokenUnit={tokenUnit}
              showRechargePrice={showRechargePrice}
            />
          )}
        </PageTransition>
      </main>
      <Footer />
    </PublicLayout>
  )
}
