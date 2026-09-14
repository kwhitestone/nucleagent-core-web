/** Matches nucleagent-shared/a2a/runtime_management.go and Core's admin projection. */
export interface RuntimeBackendConfig {
  backend: string;
  mode: string;
  minProcesses: number;
  maxProcesses: number;
  sessionsPerProcess: number;
  maxActiveSessions: number;
}

export interface ExecutorRuntimeConfig {
  maxConcurrency: number;
  backends: RuntimeBackendConfig[];
}

export interface RuntimeProcessStatus {
  slot: string;
  generation: number;
  state: string;
  activeSessions: number;
}

export interface RuntimeBackendStatus extends RuntimeBackendConfig {
  readyProcesses: number;
  startingProcesses: number;
  drainingProcesses: number;
  residentProcesses: number;
  activeSessions: number;
  targetCapacity: number;
  admissionCapacity: number;
  state: string;
  errorCode?: string;
  processes?: RuntimeProcessStatus[];
}

export interface ExecutorRuntimeStatus {
  revision: number;
  configurable: boolean;
  isolationMode: string;
  maxConcurrency: number;
  backends: RuntimeBackendStatus[];
}

export interface ConnectedExecutor {
  instanceId: string;
  deviceId: string;
  deviceName: string;
  os: string;
  appVersion?: string;
  connectedAt: string;
  lastSeenAt: string;
  activeExecutions: number;
  maxConcurrency: number;
  runtime: ExecutorRuntimeStatus | null;
}

export interface ExecutorSnapshot {
  instances: ConnectedExecutor[];
  updatedAt: string;
}

export interface RuntimeUpdate {
  expectedRevision: number;
  config: ExecutorRuntimeConfig;
}

export interface RuntimeUpdateResult {
  accepted: boolean;
  errorCode?: string;
  message?: string;
  status?: ExecutorRuntimeStatus;
}

export interface ExecutorManagementAPI {
  list(signal: AbortSignal): Promise<ExecutorSnapshot>;
  update(instanceId: string, body: RuntimeUpdate, signal: AbortSignal): Promise<RuntimeUpdateResult>;
}
