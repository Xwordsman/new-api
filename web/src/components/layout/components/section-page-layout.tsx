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
import {
  Children,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

import {
  ConsolePageHeader,
  type ConsolePageHeaderProps,
} from './console-page-header'
import { Main } from './main'
import { PageFooterProvider } from './page-footer'

type SlotProps = { children?: ReactNode }
type TitleProps = SlotProps &
  Pick<ConsolePageHeaderProps, 'icon' | 'eyebrow' | 'description' | 'variant'>

function SectionPageLayoutTitle(_props: TitleProps) {
  return null
}
SectionPageLayoutTitle.displayName = 'SectionPageLayout.Title'

function SectionPageLayoutActions(_props: SlotProps) {
  return null
}
SectionPageLayoutActions.displayName = 'SectionPageLayout.Actions'

function SectionPageLayoutContent(_props: SlotProps) {
  return null
}
SectionPageLayoutContent.displayName = 'SectionPageLayout.Content'

function SectionPageLayoutBreadcrumb(_props: SlotProps) {
  return null
}
SectionPageLayoutBreadcrumb.displayName = 'SectionPageLayout.Breadcrumb'

export type SectionPageLayoutProps = {
  children: ReactNode
  fixedContent?: boolean
  stackActionsOnMobile?: boolean
}

export function SectionPageLayout(props: SectionPageLayoutProps) {
  const [footerContainer, setFooterContainer] = useState<HTMLDivElement | null>(
    null
  )

  let title: TitleProps | null = null
  let actions: ReactNode = null
  let content: ReactNode = null
  let breadcrumb: ReactNode = null

  for (const node of Children.toArray(props.children)) {
    if (!isValidElement(node)) continue
    const child = node as ReactElement<SlotProps>
    if (child.type === SectionPageLayoutTitle) title = child.props as TitleProps
    else if (child.type === SectionPageLayoutActions) {
      actions = child.props.children
    } else if (child.type === SectionPageLayoutContent) {
      content = child.props.children
    } else if (child.type === SectionPageLayoutBreadcrumb) {
      breadcrumb = child.props.children
    }
  }

  return (
    <PageFooterProvider container={footerContainer}>
      <Main className='console-page'>
        {title && (
          <ConsolePageHeader
            icon={title.icon}
            eyebrow={title.eyebrow}
            title={title.children}
            description={title.description}
            variant={title.variant}
            actions={actions}
            breadcrumb={breadcrumb}
            stackActionsOnMobile={props.stackActionsOnMobile}
          />
        )}

        <div
          className={
            props.fixedContent
              ? 'min-h-0 flex-1 overflow-hidden px-4 pb-4 sm:px-6 sm:pb-6 lg:px-8'
              : 'min-h-0 flex-1 overflow-auto px-4 pb-4 sm:px-6 sm:pb-6 lg:px-8'
          }
        >
          {content}
        </div>

        <div
          ref={setFooterContainer}
          className='bg-card shrink-0 border-t px-4 py-2.5 empty:hidden sm:px-6 sm:py-3 lg:px-8'
        />
      </Main>
    </PageFooterProvider>
  )
}

SectionPageLayout.Title = SectionPageLayoutTitle
SectionPageLayout.Actions = SectionPageLayoutActions
SectionPageLayout.Content = SectionPageLayoutContent
SectionPageLayout.Breadcrumb = SectionPageLayoutBreadcrumb
