export type LogContext = Record<string, unknown>

/**
 * Minimal structured logger — no external dependency. Matches the
 * "Monitoring & Logging" shared service from the architecture diagram
 * without pulling in a logging framework for an MVP this size. Swap for
 * whatever CopySight's own backend already uses (pino, winston, etc.)
 * once this module is actually integrated — the point right now is just
 * that state transitions aren't silent.
 */
function write(level: 'info' | 'warn' | 'error', message: string, context: LogContext = {}) {
  const entry = { timestamp: new Date().toISOString(), level, message, ...context }
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  info: (message: string, context?: LogContext) => write('info', message, context),
  warn: (message: string, context?: LogContext) => write('warn', message, context),
  error: (message: string, context?: LogContext) => write('error', message, context),
}
