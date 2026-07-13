import { OWASP_LLM, type OwaspId } from "./categories";

export function owaspLabel(id: OwaspId): string {
  return `${id} · ${OWASP_LLM[id]}`;
}

export function isOwaspId(value: string): value is OwaspId {
  return value in OWASP_LLM;
}
