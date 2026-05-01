import { tool } from "@langchain/core/tools";
import type { z } from "zod";
import type { HITLRequest } from "langchain";

export type InterruptConfig = {
  enabled: boolean;
  reviewConfigs?: HITLRequest["reviewConfigs"];
  description?: string;
};

export interface ToolContractInterface<
  Schema extends z.ZodObject<any>,
  Result = unknown,
  Runtime = unknown,
> {
  name: string;
  description: string;
  schema: Schema;

  execute(args: z.infer<Schema>, runtime?: Runtime): Promise<Result>;

  interrupt?(args: z.infer<Schema>): Promise<InterruptConfig>;
}

export function buildToolFromContract<
  Schema extends z.ZodObject<any>,
  Result = unknown,
  Runtime = unknown,
>(contract: ToolContractInterface<Schema, Result, Runtime>) {
  return tool(
    async (args, runtime) =>
      contract.execute(args as z.infer<Schema>, runtime as Runtime),
    {
      name: contract.name,
      description: contract.description,
      schema: contract.schema,
    },
  );
}
