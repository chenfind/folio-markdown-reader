export function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem('folio:' + key) || 'null') ?? fallback } catch { return fallback }
}
export function save(key: string, value: unknown) {
  localStorage.setItem('folio:' + key, JSON.stringify(value))
}
