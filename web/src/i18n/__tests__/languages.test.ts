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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  convertDetectedLanguage,
  getUserInterfaceLanguage,
  normalizeInterfaceLanguage,
} from '../languages'

describe('normalizeInterfaceLanguage', () => {
  test('maps Chinese backend and browser codes onto zhCN / zhTW', () => {
    const cases: Array<[string, string]> = [
      ['zh', 'zhCN'],
      ['zh-CN', 'zhCN'],
      ['zh_CN', 'zhCN'],
      ['zh-cn', 'zhCN'],
      ['zh-Hans', 'zhCN'],
      ['zhCN', 'zhCN'],
      ['zh-TW', 'zhTW'],
      ['zh_TW', 'zhTW'],
      ['zh-HK', 'zhTW'],
      ['zh-Hant', 'zhTW'],
      ['zhTW', 'zhTW'],
    ]

    for (const [input, expected] of cases) {
      assert.equal(normalizeInterfaceLanguage(input), expected, input)
    }
  })

  test('keeps supported non-Chinese codes and falls back to English', () => {
    assert.equal(normalizeInterfaceLanguage('en'), 'en')
    assert.equal(normalizeInterfaceLanguage('fr'), 'fr')
    assert.equal(normalizeInterfaceLanguage('fr-FR'), 'fr')
    assert.equal(normalizeInterfaceLanguage('ja'), 'ja')
    assert.equal(normalizeInterfaceLanguage('ja-JP'), 'ja')
    assert.equal(normalizeInterfaceLanguage('ru'), 'ru')
    assert.equal(normalizeInterfaceLanguage('vi'), 'vi')
    assert.equal(normalizeInterfaceLanguage(undefined), 'en')
    assert.equal(normalizeInterfaceLanguage('de'), 'en')
  })
})

describe('convertDetectedLanguage', () => {
  test('maps Chinese navigator locales onto interface codes', () => {
    assert.equal(convertDetectedLanguage('zh'), 'zhCN')
    assert.equal(convertDetectedLanguage('zh-CN'), 'zhCN')
    assert.equal(convertDetectedLanguage('zh_CN'), 'zhCN')
    assert.equal(convertDetectedLanguage('zhTW'), 'zhTW')
    assert.equal(convertDetectedLanguage('zh-Hant-TW'), 'zhTW')
  })

  test('leaves non-Chinese tags unchanged for i18next matching', () => {
    assert.equal(convertDetectedLanguage('fr-FR'), 'fr-FR')
    assert.equal(convertDetectedLanguage('ja'), 'ja')
  })
})

describe('getUserInterfaceLanguage', () => {
  test('returns undefined when no language is saved', () => {
    assert.equal(getUserInterfaceLanguage({}), undefined)
    assert.equal(getUserInterfaceLanguage({ setting: '{' }), undefined)
  })

  test('normalizes saved backend language codes', () => {
    assert.equal(
      getUserInterfaceLanguage({ setting: { language: 'zh' } }),
      'zhCN'
    )
    assert.equal(getUserInterfaceLanguage({ language: 'zh-TW' }), 'zhTW')
    assert.equal(
      getUserInterfaceLanguage({ setting: '{"language":"ja"}' }),
      'ja'
    )
  })
})
