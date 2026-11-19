import type { ToolInvocation } from "../addons/conversation/api/types.ts";

export type WorkflowValue = ToolInvocation["arguments"][string];
type Field = {
  type?: string; description?: string; minLength?: number; maxLength?: number; enum?: WorkflowValue[];
  minimum?: number; maximum?: number; exclusiveMinimum?: number; exclusiveMaximum?: number;
};
type StringField = Omit<Field, "enum"> & { enum?: string[] };
export interface WorkflowSchema {
  model?: string;
  declaredModel?: string;
  invocation?: { toolId: number; revision: string };
  inputSchema: { type: string; additionalProperties: boolean; required?: string[]; properties: Record<string, Field> };
}

export function workflowFields(definition: WorkflowSchema): [string, StringField][];
export function workflowFields(definition: WorkflowSchema, typed: true): [string, Field][];
export function workflowFields(definition: WorkflowSchema, typed = false): [string, Field][] {
  const schema = definition.inputSchema;
  if (!definition.invocation || !/^(0|[1-9][0-9]{0,19})$/.test(definition.invocation.revision) || schema.type !== "object" || schema.additionalProperties !== false) throw new Error("Invalid workflow");
  const fields = Object.entries(schema.properties).filter(([, field]) => typed ? ["string", "integer", "number", "boolean"].includes(field.type ?? "") : field.type === "string");
  if ((schema.required ?? []).some((name) => !fields.some(([key]) => key === name))) throw new Error("Invalid workflow");
  if (typed) for (const [, field] of fields) {
    for (const key of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"] as const) {
      const bound = field[key];
      if (bound !== undefined && (!["number", "integer"].includes(field.type ?? "") || !safeNumber(bound))) throw new Error("Invalid workflow");
    }
    for (const key of ["minLength", "maxLength"] as const) {
      const bound = field[key];
      if (bound !== undefined && (field.type !== "string" || !Number.isSafeInteger(bound) || bound < 0)) throw new Error("Invalid workflow");
    }
    if (field.enum !== undefined && (!Array.isArray(field.enum) || !field.enum.length || field.enum.some((value) => !validValue({ ...field, enum: undefined }, value)))) throw new Error("Invalid workflow");
  }
  return fields;
}

const safeNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));

function validValue(field: Field, value: unknown): value is WorkflowValue {
  if (field.type === "string") {
    if (typeof value !== "string" || (field.minLength !== undefined && Array.from(value).length < field.minLength) || (field.maxLength !== undefined && Array.from(value).length > field.maxLength)) return false;
  } else if (field.type === "boolean") {
    if (typeof value !== "boolean") return false;
  } else if (field.type === "integer" || field.type === "number") {
    if (!safeNumber(value) || (field.type === "integer" && !Number.isSafeInteger(value))) return false;
    if ((field.minimum !== undefined && value < field.minimum) || (field.maximum !== undefined && value > field.maximum)
      || (field.exclusiveMinimum !== undefined && value <= field.exclusiveMinimum) || (field.exclusiveMaximum !== undefined && value >= field.exclusiveMaximum)) return false;
  } else return false;
  return !field.enum || field.enum.includes(value as WorkflowValue);
}

export function workflowInvocation<Values extends Record<string, WorkflowValue>>(toolId: number, definition: WorkflowSchema, values: Values): Omit<ToolInvocation, "arguments"> & { arguments: Values } {
  const fields = workflowFields(definition, true);
  if (toolId !== definition.invocation?.toolId || Object.keys(values).some((name) => !fields.some(([key]) => key === name))) throw new Error("Invalid workflow");
  for (const [name, field] of fields) {
    if (!Object.hasOwn(values, name) && !definition.inputSchema.required?.includes(name)) continue;
    if (!Object.hasOwn(values, name) || !validValue(field, values[name])) throw new Error("Invalid workflow");
  }
  return { toolId, revision: definition.invocation.revision, arguments: { ...values } };
}

type MediaRow = { id: number; imported?: boolean; status?: string; mediaModel?: string };
/** `prompt` names the schema field that carries the composer text ("input", or the source's own free-text prompt). */
export type DirectMedia = { toolId: number; schema: WorkflowSchema; prompt: string };
const freeText = (field?: Field) => field?.type === "string" && !field.enum;
/** The composer text goes to `input`; else to the source's own `prompt` when it is the only free-text required field. */
function promptField(schema: WorkflowSchema): string | null {
  const { properties, required = [] } = schema.inputSchema;
  const name = freeText(properties.input) ? "input" : freeText(properties.prompt) ? "prompt" : null;
  // Every other required parameter must be a real enum the user can pick.
  return name && !required.some((key) => key !== name && !properties[key]?.enum) ? name : null;
}
/** The Toolgate job tool Core binds to this media model, with its real parameter schema; null = not connected. */
export async function directMediaTool(model: string, rows: MediaRow[], load: (id: number) => Promise<WorkflowSchema & { model?: string }>): Promise<DirectMedia | null> {
  for (const row of rows.filter((entry) => entry.imported && entry.status === "ready" && entry.mediaModel === model)) {
    try {
      const schema = await load(row.id);
      const prompt = schema.model === model && schema.invocation?.toolId === row.id && workflowFields(schema) ? promptField(schema) : null;
      if (prompt) return { toolId: row.id, schema, prompt };
    } catch { /* this row stays closed; try the next one */ }
  }
  return null;
}

/** Conversation request fields of a direct media generation: the model's job tool with server-validated arguments. */
export const directMediaRequest = (direct: DirectMedia, params: Record<string, string>, input: string) =>
  ({ toolIds: [direct.toolId], toolInvocation: workflowInvocation(direct.toolId, direct.schema, { ...Object.fromEntries(Object.entries(params).filter(([, value]) => value)), [direct.prompt]: input }) });
