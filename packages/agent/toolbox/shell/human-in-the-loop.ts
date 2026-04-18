import type { ToolCall } from "@langchain/core/messages"
import { shellTool } from "./tool"
import { HumanInTheLoopMiddlewareConfig } from "langchain"

export const shellApprovalHumanInTheLoop: HumanInTheLoopMiddlewareConfig['interruptOn'] = {
    [shellTool.name]: {
        allowedDecisions: ['approve', 'edit', 'reject'],
        description(toolCall: ToolCall): string {
            const { command, cwd } = shellTool.schema.parse(toolCall.args);

            const workingDirectory = cwd ? `\nWorking directory: ${cwd}` : ''

            return `Command: ${command}${workingDirectory}`
        },
    },
}
