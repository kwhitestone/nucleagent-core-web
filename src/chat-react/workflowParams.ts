import type { ToolInvocation } from "../addons/conversation/api/types.ts";

type Field = { type?: string; description?: string; maxLength?: number; enum?: string[] };
export interface WorkflowSchema {
  invocation?: { toolId: number; revision: string };
  inputSchema: { type: string; additionalProperties: boolean; required?: string[]; properties: Record<string, Field> };
}

export function workflowFields(definition: WorkflowSchema): [string, Field][] {
  const schema = definition.inputSchema;
  if (!definition.invocation || !/^(0|[1-9][0-9]{0,19})$/.test(definition.invocation.revision) || schema.type !== "object" || schema.additionalProperties !== false) throw new Error("Invalid workflow");
  const fields = Object.entries(schema.properties).filter(([, field]) => field.type === "string");
  if ((schema.required ?? []).some((name) => !fields.some(([key]) => key === name))) throw new Error("Invalid workflow");
  return fields;
}

export function workflowInvocation(toolId: number, definition: WorkflowSchema, values: Record<string, string>): ToolInvocation {
  const fields = workflowFields(definition);
  if (toolId !== definition.invocation?.toolId || Object.keys(values).some((name) => !fields.some(([key]) => key === name))) throw new Error("Invalid workflow");
  for (const [name, field] of fields) {
    const value = values[name];
    if (value === undefined && !definition.inputSchema.required?.includes(name)) continue;
    if (typeof value !== "string" || (field.enum && !field.enum.includes(value)) || (field.maxLength !== undefined && Array.from(value).length > field.maxLength)) throw new Error("Invalid workflow");
  }
  return { toolId, revision: definition.invocation.revision, arguments: { ...values } };
}

type MediaRow = { id: number; imported?: boolean; status?: string; mediaModel?: string };
export type DirectMedia = { toolId: number; schema: WorkflowSchema };
/** The Toolgate job tool Core binds to this media model, with its real parameter schema; null = not connected. */
export async function directMediaTool(model: string, rows: MediaRow[], load: (id: number) => Promise<WorkflowSchema & { model?: string }>): Promise<DirectMedia | null> {
  const row = rows.find((entry) => entry.imported && entry.status === "ready" && entry.mediaModel === model);
  if (!row) return null;
  try {
    const schema = await load(row.id);
    const properties = schema.inputSchema.properties;
    // The composer text is the prompt; every other required parameter must be a real enum the user can pick.
    return schema.model === model && schema.invocation?.toolId === row.id && workflowFields(schema) && properties.input?.type === "string" && !properties.input.enum
      && !schema.inputSchema.required?.some((name) => name !== "input" && !properties[name]?.enum) ? { toolId: row.id, schema } : null;
  } catch { return null; }
}

/** Conversation request fields of a direct media generation: the model's job tool with server-validated arguments. */
export const directMediaRequest = (direct: DirectMedia, params: Record<string, string>, input: string) =>
  ({ toolIds: [direct.toolId], toolInvocation: workflowInvocation(direct.toolId, direct.schema, { ...Object.fromEntries(Object.entries(params).filter(([, value]) => value)), input }) });
