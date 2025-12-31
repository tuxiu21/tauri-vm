export function safeJsonParse<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function newId(): string {
  if ("randomUUID" in crypto) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function readLocalStorageJson<T>(key: string, fallback: T): T {
  return safeJsonParse<T>(localStorage.getItem(key)) ?? fallback;
}

export function writeLocalStorageJson<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

