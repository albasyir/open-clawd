import { DynamicStructuredTool, HumanInTheLoopMiddlewareConfig, Tool } from "langchain"

export type AgentErrorCode = 'NOT_FOUND' | 'ALREADY_EXISTS' | 'INVALID_INPUT'

export class AgentError extends Error {
  code: AgentErrorCode
  constructor(code: AgentErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export interface ToolInfo {
  id: string
  name: string
  content?: string
  symlink?: boolean
}

export interface ModelInfo {
  id: string
  name: string
  content?: string
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
