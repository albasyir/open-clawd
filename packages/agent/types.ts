import type { DynamicStructuredTool } from "langchain"

export type AgentErrorCode = 'NOT_FOUND' | 'ALREADY_EXISTS' | 'INVALID_INPUT' | 'UPSTREAM_ERROR'

export class AgentError extends Error {
  code: AgentErrorCode
  statusCode?: number
  constructor(code: AgentErrorCode, message: string, statusCode?: number) {
    super(message)
    this.code = code
    this.statusCode = statusCode
  }
}

export interface ToolInfo {
  id: string
  name: string
  content?: string
  files?: {
    id: string
    name: string
    content: string
  }[]
  symlink?: boolean
}

export interface ModelInfo {
  id: string
  name: string
  content?: string
}

export interface SkillInstallInput {
  id: string
  skillId: string
  source: string
}

export interface SkillInstallResult {
  id: string
  skillId: string
  source: string
  path: string
  githubPath: string
  githubUrl?: string
}

export interface SkillInstallationStatus extends SkillInstallInput {
  installed: boolean
}

export interface AgentFileInfo {
  id: string
  name: string
  content?: string
  symlink: boolean
}

export interface AgentInfo {
  id: string
  agentId: string
  agent: { name: string; avatar?: { src: string } }
  messages: unknown[]
  updatedAt: string
}

export interface TemplateInfo {
  id: string
  name: string
}

export interface TestResult {
  success: boolean
  result?: unknown
  error?: string
}

export interface Toolbox {
  tool: DynamicStructuredTool
}
