import type { ToolCall } from "@langchain/core/messages"
import { shellTool } from "./tool"
import { Toolbox } from "../../types";

export const shellHumanInTheLoop: Toolbox['humanInTheLoop'] = {
    [shellTool.name]: {
        allowedDecisions: ['approve', 'edit', 'reject'],
        description(toolCall: ToolCall): string {
            const { command, cwd } = shellTool.schema.parse(toolCall.args);

            const workingDirectory = cwd ? `\nWorking directory: ${cwd}` : ''

            return `Command: ${command}${workingDirectory}`
        },
    },
}
