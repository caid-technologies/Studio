/**
 * Development-only logging helpers. In production builds these no-op
 * except `devWarn`/`devLog` calls are stripped from console noise;
 * keep `console.error` at call sites for real failures.
 */
export const IS_DEV = process.env.NODE_ENV === 'development'

export function devLog(...args: unknown[]) {
  if (IS_DEV) console.log(...args)
}

export function devWarn(...args: unknown[]) {
  if (IS_DEV) console.warn(...args)
}
