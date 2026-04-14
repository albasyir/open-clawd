import type { AvatarProps } from '@nuxt/ui'

export type UserStatus = 'subscribed' | 'unsubscribed' | 'bounced'
export type SaleStatus = 'paid' | 'failed' | 'refunded'

export interface User {
  id: number
  name: string
  email: string
  avatar?: AvatarProps
  status: UserStatus
  location: string
}

export interface Mail {
  id: number
  unread?: boolean
  from: User
  subject: string
  body: string
  date: string
}

export interface Member {
  name: string
  username: string
  role: 'member' | 'owner'
  avatar: AvatarProps
}

export interface Stat {
  title: string
  icon: string
  value: number | string
  variation: number
  formatter?: (value: number) => string
}

export interface Sale {
  id: string
  date: string
  status: SaleStatus
  email: string
  amount: number
}

export interface Notification {
  id: number
  unread?: boolean
  sender: User
  body: string
  date: string
}

export type Period = 'daily' | 'weekly' | 'monthly'

export interface Range {
  start: Date
  end: Date
}

export interface ToolFile {
  id: string
  name: string
  content?: string
  /** When true, this tool is a symlink and cannot be edited here. */
  symlink?: boolean
}

export interface ModelFile {
  id: string
  name: string
  content?: string
}

export type ChatMessageRole = 'user' | 'agent'

export interface ChatTimelineItem {
  value: string
  slot: string
  date: string
  title: string
  description: string
  icon?: string
  toolState?: 'working' | 'done' | 'error'
  durationMs?: number
}

export interface ChatMessage {
  id: string
  role: ChatMessageRole
  content: string
  thinking?: string
  thinkingState?: 'working' | 'done'
  thinkingDurationMs?: number
  date: string
  timeline?: ChatTimelineItem[]
  streamState?: 'working' | 'done' | 'error'
}

export interface AgentConversation {
  /** Unique thread id (use agentId for the default thread per agent). */
  id: string
  /** Agent id for API calls (e.g. /api/agents/:agentId/chat). */
  agentId: string
  agent: {
    name: string
    avatar?: AvatarProps
  }
  messages: ChatMessage[]
  unread?: boolean
  updatedAt: string
}
