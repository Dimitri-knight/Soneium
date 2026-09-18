export type LogContext = Record<string, unknown>

/**
 * Minimal structured logger with no external dependency. Swap for pino,
 * winston, etc. once this integrates with CopySight's own backend.
 */
function write(level: 'info' | 'warn' | 'error', message: string, context: LogContext = {}) {
  // Envelope fields spread last so a context key named timestamp/level/message
  // can't overwrite them.
  const entry = { ...context, timestamp: new Date().toISOString(), level, message }
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
