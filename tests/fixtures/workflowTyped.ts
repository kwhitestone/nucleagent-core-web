import { readFileSync } from "node:fs";
import type { WorkflowSchema } from "../../src/chat-react/workflowParams.ts";

export const engineInput = JSON.parse(readFileSync(new URL("./engine6792-input.json", import.meta.url), "utf8"));
export const engineFramesInput = JSON.parse(readFileSync(new URL("./engine6793-input.json", import.meta.url), "utf8"));
export const scalarInput = JSON.parse(readFileSync(new URL("./core-job-scalars.json", import.meta.url), "utf8"));
export const videoSchema: WorkflowSchema = {
  model: "video-model", invocation: { toolId: 37, revision: "9007199254740993" },
  inputSchema: {
    type: "object", additionalProperties: false,
    required: engineInput.required.filter((name: string) => name !== "api_key"),
    properties: Object.fromEntries(["prompt", "image_url", "duration", "resolution"].map((name) => [name, engineInput.properties[name]])),
  },
};
export const scalarSchema: WorkflowSchema = {
  invocation: { toolId: 38, revision: "7" },
  inputSchema: { ...scalarInput, additionalProperties: false },
};
