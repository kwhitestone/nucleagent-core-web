import type { ToolInvocation } from "../addons/conversation/api/types.ts";

export type WorkflowValue = ToolInvocation["arguments"][string];
type Field = {
  "x-owned-image"?: boolean;
  anyOf?: Field[];
  type?: string; description?: string; minLength?: number; maxLength?: number; enum?: WorkflowValue[];
  minimum?: number; maximum?: number; exclusiveMinimum?: number; exclusiveMaximum?: number;
};
export interface WorkflowSchema {
  nativeCapability?: string;
  output?: string;
  model?: string;
  declaredModel?: string;
  invocation?: { toolId: number; revision: string };
  inputSchema: { type: string; additionalProperties: boolean; required?: string[]; properties: Record<string, Field> };
}

type WorkflowTool = { id: number; imported?: boolean; status?: string; nativeCapability?: string; nativeModel?: string; mediaModel?: string };
const audioCapability = "nucleagent.audio.tts.v1";
const sttCapability = "nucleagent.audio.stt.v1";

/** MUYU-365 exp85: only native audio keeps a user form; every other tool is an agent grant (ToolGrants). */
export function workflowToolEligible(row: WorkflowTool): boolean {
  return row.status === "ready" && row.imported === false && !row.mediaModel && ((row.nativeCapability === audioCapability && row.nativeModel === "qwen3-tts-flash")
    || (row.nativeCapability === sttCapability && row.nativeModel === "whisper-1"));
}

export function validateWorkflowTool(row: WorkflowTool, definition: WorkflowSchema): void {
  if (!workflowToolEligible(row) || row.id !== definition.invocation?.toolId) throw new Error("Invalid workflow");
  workflowFields(definition, true);
  const schema = definition.inputSchema;
  if (row.nativeCapability === sttCapability) {
    const field = schema.properties.fileId;
    if (definition.nativeCapability !== sttCapability || definition.model !== row.nativeModel || definition.output !== "text/plain" || definition.declaredModel ||
      Object.keys(schema).sort().join() !== "additionalProperties,properties,required,type" || schema.required?.join() !== "fileId" || Object.keys(schema.properties).join() !== "fileId" ||
      field?.type !== "string" || field.maxLength !== 128 || Object.keys(field).sort().join() !== "maxLength,type") throw new Error("Invalid workflow");
    return;
  }
  if (definition.nativeCapability !== audioCapability || definition.model !== row.nativeModel || definition.output !== "audio/wav" || definition.declaredModel ||
    Object.keys(schema).sort().join() !== "additionalProperties,properties,required,type" || schema.required?.slice().sort().join() !== "input,voice" || Object.keys(schema.properties).sort().join() !== "input,voice") throw new Error("Invalid workflow");
  for (const [name, limit] of [["input", 256], ["voice", 64]] as const) {
    const field = schema.properties[name];
    if (field.type !== "string" || field.maxLength !== limit || Object.keys(field).sort().join() !== "maxLength,type") throw new Error("Invalid workflow");
  }
}

export function workflowFields(definition: WorkflowSchema, _typed?: true): [string, Field][] {
  const schema = definition.inputSchema;
  if (!definition.invocation || !/^(0|[1-9][0-9]{0,19})$/.test(definition.invocation.revision) || schema.type !== "object" || schema.additionalProperties !== false) throw new Error("Invalid workflow");
  const fields = Object.entries(schema.properties).map(([name, field]): [string, Field] => {
    if (!field.anyOf) return [name, field];
    const branches = field.anyOf;
    const value = branches.find((branch) => branch.type !== "null");
    if (Object.keys(field).some((key) => !["anyOf", "description", "title"].includes(key)) || branches.length !== 2 || !branches.some((branch) => branch.type === "null" && Object.keys(branch).length === 1) || !value || value.anyOf) throw new Error("Invalid workflow");
    return [name, { ...value, description: field.description ?? value.description }];
  }).filter(([, field]) => ["string", "integer", "number", "boolean"].includes(field.type ?? ""));
  if ((schema.required ?? []).some((name) => !fields.some(([key]) => key === name))) throw new Error("Invalid workflow");
  for (const [, field] of fields) {
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
  if (definition.nativeCapability === sttCapability && (typeof values.fileId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(values.fileId))) throw new Error("Invalid workflow");
  if (toolId !== definition.invocation?.toolId || Object.keys(values).some((name) => !fields.some(([key]) => key === name))) throw new Error("Invalid workflow");
  for (const [name, field] of fields) {
    if (!Object.hasOwn(values, name) && !definition.inputSchema.required?.includes(name)) continue;
    if (field["x-owned-image"] && !/^storage-image:[a-zA-Z0-9_-]{1,128}$/.test(values[name] as string)) throw new Error("Invalid workflow");
    if (!Object.hasOwn(values, name) || !validValue(field, values[name])) throw new Error("Invalid workflow");
  }
  return { toolId, revision: definition.invocation.revision, arguments: { ...values } };
}

type MediaRow = { id: number; imported?: boolean; status?: string; mediaModel?: string };
/** `prompt` names the schema field that carries the composer text ("input", or the source's own free-text prompt). */
export type DirectMedia = { toolId: number; schema: WorkflowSchema; prompt: string };
const freeText = (field?: Field) => field?.type === "string" && !field.enum;
export const mediaImageField = (name: string) => ["image_url", "first_frame_url", "last_frame_url"].includes(name);
/** The composer text goes to `input`; else to the source's own `prompt` when it is the only free-text required field. */
function promptField(schema: WorkflowSchema): string | null {
  const { properties, required = [] } = schema.inputSchema;
  const name = freeText(properties.input) ? "input" : freeText(properties.prompt) ? "prompt" : null;
  // Every other required parameter must be a real enum the user can pick.
  return name && !required.some((key) => key !== name && !properties[key]?.enum && properties[key]?.type === "string" && !mediaImageField(key)) ? name : null;
}
/** The Toolgate job tool Core binds to this media model, with its real parameter schema; null = not connected. */
export async function directMediaTool(model: string, rows: MediaRow[], load: (id: number) => Promise<WorkflowSchema & { model?: string }>): Promise<DirectMedia | null> {
  for (const row of rows.filter((entry) => entry.imported && entry.status === "ready" && entry.mediaModel === model)) {
    try {
      const schema = await load(row.id);
      const prompt = schema.model === model && schema.invocation?.toolId === row.id && workflowFields(schema, true) ? promptField(schema) : null;
      if (prompt) return { toolId: row.id, schema, prompt };
    } catch { /* this row stays closed; try the next one */ }
  }
  return null;
}

/** Conversation request fields of a direct media generation: the model's job tool with server-validated arguments. */
export function directMediaRequest(direct: DirectMedia, params: Record<string, string>, input: string) {
  const uncontrolled = (name: string) => mediaImageField(name) && !direct.schema.inputSchema.properties[name]?.["x-owned-image"];
  if (direct.schema.inputSchema.required?.some(uncontrolled) || Object.keys(params).some(name => uncontrolled(name) && params[name] !== "" || name === direct.prompt)) throw new Error("Invalid workflow");
  return { toolIds: [direct.toolId], toolInvocation: workflowFormInvocation(direct.toolId, direct.schema, { ...params, [direct.prompt]: input }) };
}

export function workflowFormInvocation(toolId: number, schema: WorkflowSchema, params: Record<string, string>) {
  const fields = workflowFields(schema, true);
  const values: Record<string, WorkflowValue> = {};
  for (const [name, text] of Object.entries(params)) {
    if (text === "") continue;
    const field = fields.find(([key]) => key === name)?.[1];
    if (!field) throw new Error("Invalid workflow");
    if (field.type === "integer" && !/^-?\d+(?:\.0+)?$/.test(text)) throw new Error("Invalid workflow");
    if (field.type === "boolean" && !["true", "false"].includes(text)) throw new Error("Invalid workflow");
    values[name] = field.type === "boolean" ? text === "true" : field.type === "number" || field.type === "integer" ? (text.trim() ? Number(text) : NaN) : text;
  }
  return workflowInvocation(toolId, schema, values);
}

export function directMediaReady(direct: DirectMedia, params: Record<string, string>, input: string): boolean {
  try {
    directMediaRequest(direct, params, input);
    return true;
  } catch { return false; }
}
