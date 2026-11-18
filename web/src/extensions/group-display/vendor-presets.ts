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
import type { GroupCategory } from './types'

// Categories are created only when selected. Existing categories, including
// their custom icons, colors and ordering, always take precedence.
export const vendorPresets: GroupCategory[] = [
  { id: 'openai', name: 'OpenAI', icon: 'OpenAI', color: '#10a37f' },
  { id: 'anthropic', name: 'Anthropic', icon: 'Anthropic', color: '#d97757' },
  { id: 'google', name: 'Google', icon: 'Gemini.Color', color: '#4285f4' },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    icon: 'DeepSeek.Color',
    color: '#4d6bfe',
  },
  { id: 'xai', name: 'xAI', icon: 'XAI', color: '#64748b' },
  { id: 'qwen', name: 'Qwen', icon: 'Qwen.Color', color: '#615ced' },
  { id: 'doubao', name: 'Doubao', icon: 'Doubao.Color', color: '#2563eb' },
  { id: 'moonshot', name: 'Moonshot', icon: 'Moonshot', color: '#7c3aed' },
  { id: 'minimax', name: 'MiniMax', icon: 'Minimax.Color', color: '#ef4444' },
  { id: 'mistral', name: 'Mistral', icon: 'Mistral.Color', color: '#f97316' },
]
