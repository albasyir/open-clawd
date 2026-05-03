import { randomUUID } from 'node:crypto'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { BindToolsInput } from '@langchain/core/language_models/chat_models'
import { isOpenAITool, type FunctionDefinition } from '@langchain/core/language_models/base'
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import { convertToOpenAITool } from '@langchain/core/utils/function_calling'
import { ChatOpenAICompletions } from '@langchain/openai'
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager'
import { isRecord, type UnknownRecord } from '../utils/record.ts'

/** Params accepted by the ChatOpenAICompletions constructor (model, apiKey, configuration, etc.) */
export type ChatOpenAICompletionsParams = ConstructorParameters<typeof ChatOpenAICompletions>[0]

interface ToolMeta {
  name: string
  description: string
  parameters: FunctionDefinition['parameters']
}

type ToolParameter = UnknownRecord & {
  type?: string
  description?: string
  enum?: unknown[]
}
type RouterToolCall = {
  name: string
  arguments?: Record<string, unknown>
}

function toToolMeta(input: BindToolsInput): ToolMeta {
  const definition = isOpenAITool(input)
    ? input
    : convertToOpenAITool(input)

  return {
    name: definition.function.name,
    description: definition.function.description ?? '',
    parameters: definition.function.parameters,
  }
}

function getParameterProperties(parameters: FunctionDefinition['parameters']): Record<string, ToolParameter> {
  const params: UnknownRecord = isRecord(parameters) ? parameters : {}
  if (!isRecord(params.properties)) return {}

  return Object.fromEntries(
    Object.entries(params.properties).filter((entry): entry is [string, ToolParameter] => isRecord(entry[1])),
  )
}

function getRequiredParameters(parameters: FunctionDefinition['parameters']): string[] {
  const params: UnknownRecord = isRecord(parameters) ? parameters : {}

  return Array.isArray(params.required)
    ? params.required.filter((item): item is string => typeof item === 'string')
    : []
}

function formatToolParameter(name: string, parameter: ToolParameter, required: string[]): string {
  const requiredLabel = required.includes(name) ? ' (required)' : ''
  const description = typeof parameter.description === 'string' ? ` - ${parameter.description}` : ''
  const enumValues = Array.isArray(parameter.enum)
    ? ` [values: ${parameter.enum.map(value => `"${String(value)}"`).join(', ')}]`
    : ''
  const type = typeof parameter.type === 'string' ? parameter.type : 'string'
  return `    "${name}": ${type}${enumValues}${requiredLabel}${description}`
}

function parseRouterToolCall(value: unknown): RouterToolCall | null {
  if (!isRecord(value) || typeof value.name !== 'string') return null

  return {
    name: value.name,
    arguments: isRecord(value.arguments) ? value.arguments : undefined,
  }
}

function parseRouterToolCalls(value: unknown): RouterToolCall[] {
  const values = Array.isArray(value) ? value : [value]
  return values
    .map(parseRouterToolCall)
    .filter((call): call is RouterToolCall => call !== null)
}

/**
 * A ChatModel wrapper that implements tool calling via prompt engineering.
 * Compatible with LangChain's `createAgent` / ReAct agent loop.
 *
 * Use this when the underlying LLM server doesn't support native
 * OpenAI tool_calls in the response.
 */
export default class OpenAICodexModel extends BaseChatModel {
  private llm: ChatOpenAICompletions
  private llmParams: ChatOpenAICompletionsParams
  private llmToolCallParams: ChatOpenAICompletionsParams
  private boundTools: ToolMeta[] = []
  private llmToolCall: ChatOpenAICompletions

  constructor(fields: {
    llmParams: ChatOpenAICompletionsParams
    llmToolCallParams?: ChatOpenAICompletionsParams
  }) {
    super({})
    this.llmParams = fields.llmParams
    this.llmToolCallParams = fields.llmToolCallParams ?? fields.llmParams
    this.llm = new ChatOpenAICompletions(fields.llmParams)
    this.llmToolCall =
      fields.llmToolCallParams != null
        ? new ChatOpenAICompletions(fields.llmToolCallParams)
        : this.llm
  }

  _llmType() {
    return 'prompt-tools-chat-model'
  }

  bindTools(tools: BindToolsInput[], _kwargs?: Partial<this['ParsedCallOptions']>): this {
    const bound = new OpenAICodexModel({
      llmParams: this.llmParams,
      llmToolCallParams: this.llmToolCallParams,
    })
    bound.boundTools = tools.map(toToolMeta)
    return bound as this
  }

  async _generate(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ) {
    if (this.boundTools.length === 0) {
      const result = await this.llm.invoke(messages)
      return {
        generations: [{ message: result, text: typeof result.content === 'string' ? result.content : '' }],
      }
    }

    const flat = this.flattenMessages(messages)

    const calls = await this.callRouter(flat)
    const listToolsOnly = calls.some((c) => c.name === '__list_tools__')
    const validCalls = calls.filter((c) => c.name && c.name !== 'none' && c.name !== '__list_tools__')

    if (listToolsOnly) {
      const toolsListText = this.boundTools
        .map((t) => {
          const params = getParameterProperties(t.parameters)
          const paramStr = Object.keys(params).length
            ? ` (${Object.keys(params).join(', ')})`
            : ''
          return `- **${t.name}**${paramStr}: ${t.description}`
        })
        .join('\n')
      // Simulate tool result so the LLM is invoked again and can respond naturally
      const syntheticToolResult = [
        new AIMessage('Called tool "__list_tools__" with {}'),
        new HumanMessage(`[Tool result]: ${toolsListText}`),
      ]
      const answer = await this.llm.invoke([...flat, ...syntheticToolResult])
      return {
        generations: [{
          message: answer,
          text: typeof answer.content === 'string' ? answer.content : '',
        }],
      }
    }

    if (validCalls.length > 0) {
      const msg = new AIMessage({
        content: '',
        tool_calls: validCalls.map((c) => ({
          id: `call_${randomUUID()}`,
          name: c.name,
          args: c.arguments ?? {},
        })),
      })
      return { generations: [{ message: msg, text: '' }] }
    }

    const answer = await this.llm.invoke(flat)
    return {
      generations: [{
        message: answer,
        text: typeof answer.content === 'string' ? answer.content : '',
      }],
    }
  }

  /**
   * Convert message history into a format the server understands.
   * Replaces AIMessage(tool_calls) + ToolMessage pairs with plain messages.
   */
  private flattenMessages(messages: BaseMessage[]): BaseMessage[] {
    const result: BaseMessage[] = []

    for (const msg of messages) {
      if (AIMessage.isInstance(msg) && msg.tool_calls && msg.tool_calls.length > 0) {
        const callSummary = msg.tool_calls
          .map((toolCall) => `Called tool "${toolCall.name}" with ${JSON.stringify(toolCall.args)}`)
          .join('; ')
        result.push(new AIMessage(callSummary))
        continue
      }

      if (ToolMessage.isInstance(msg)) {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        result.push(new HumanMessage(`[Tool result]: ${content}`))
        continue
      }

      result.push(msg)
    }

    return result
  }

  /**
   * Separate LLM call framed as a "tool router" that MUST output JSON.
   * This bypasses the model's refusal to use tools in normal conversation.
   */
  private async callRouter(
    conversationMessages: BaseMessage[],
  ): Promise<RouterToolCall[]> {
    const toolDefs = this.boundTools.map((t) => {
      const props = getParameterProperties(t.parameters)
      const required = getRequiredParameters(t.parameters)
      const paramLines = Object.entries(props)
        .map(([name, parameter]) => formatToolParameter(name, parameter, required))
        .join('\n')
      const exampleArgs = Object.fromEntries(
        Object.entries(props).map(([k]) => [k, `<${k}>`])
      )
      return (
        `## ${t.name}\n` +
        `Description: ${t.description}\n` +
        `Parameters:\n${paramLines}\n` +
        `Example: {"name": "${t.name}", "arguments": ${JSON.stringify(exampleArgs)}}`
      )
    }).join('\n\n')

    const routerSystemPrompt =
      'You are a tool router. Given a conversation and available tools, decide which tools to call.\n' +
      'Respond with ONLY a JSON array. No explanation, no markdown, ONLY valid JSON.\n' +
      'You MUST use the EXACT parameter names shown below.\n\n' +
      '# Tools\n' +
      `${toolDefs}\n` +
      '# RULES\n' +
      '- If ONE tool is needed, respond: [{"name": "<tool>", "arguments": {<params>}}]\n' +
      '- If MULTIPLE tools are needed, return ALL of them in one response: [{"name": "<tool1>", "arguments": {...}}, {"name": "<tool2>", "arguments": {...}}, ...]. Do not omit any tool that is needed for the answer.\n' +
      '- If the user asks to list or show all tools (e.g. "what tools do you have?", "list all tools"), respond with ONLY: [{"name": "__list_tools__"}]. Do NOT return real tool names - we will list them without executing.\n' +
      '- If the conversation is already fully answered or no tool is needed, respond: [{"name": "none"}]\n' +
      '- If some parts are answered (by previous tool results) but other parts still need a tool, return ONLY the unanswered tool calls.\n' +
      'Output ONLY a JSON array.'

    const lastMessage = conversationMessages.at(-1)

    const response = await this.llmToolCall.invoke([
      new SystemMessage(routerSystemPrompt),
      lastMessage || new HumanMessage('No conversation yet'),
    ])

    const content = (typeof response.content === 'string' ? response.content : '').trim()
    try {
      const parsed = JSON.parse(content)
      return parseRouterToolCalls(parsed)
    } catch {
      return []
    }
  }
}
