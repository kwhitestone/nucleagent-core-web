import { getPlatformRuntime } from "@/contracts/platform-runtime";
import type { Skill } from "./types";

const http = () => getPlatformRuntime().http;

const BASE = "/api/v1/addons/skill";

/** 后端返回 { code, message, data } 信封；data 才是业务载荷。 */
interface Envelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

/**
 * GET /skill —— 列出**已启用**的技能（后端 where is_active = true）。
 *
 * 权限是 core:skill:read，默认角色即有（见 auth 的 accesspolicy seed），
 * 普通用户建任务时能正常拉到；/skill/bindings 那几个才是 admin-read。
 *
 * 为什么 conversation 自带一份而不复用 administration/api/skill.ts：addon 之间
 * 不互相 import 实现（见 AGENTS.md 前端边界），与 agent.ts 同款——各 addon 拥有
 * 自己的 API 层。管理端那份还漏了信封解包（返回的是 Envelope 而非数组），
 * 属于从未被调用的死代码，这里不沿用它的错误。
 */
export async function listSkills(): Promise<Skill[]> {
  const response = await http().get<Envelope<Skill[]>>(BASE);
  return response.data?.data ?? [];
}
