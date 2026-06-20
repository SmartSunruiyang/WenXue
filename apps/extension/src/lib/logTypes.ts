export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogSource = 'agent' | 'llm' | 'tabs' | 'page' | 'chaoxing' | 'config' | 'system'
export type LogContext = 'background' | 'sidepanel' | 'newtab' | 'hub' | 'content'

export interface LogEntry {
	id: number
	ts: number
	level: LogLevel
	source: LogSource
	context: LogContext
	message: string
	data?: unknown
}

export type LogDraft = Omit<LogEntry, 'id'>

export interface LogQueryFilter {
	level?: LogLevel[]
	source?: LogSource[]
	sinceTs?: number
	untilTs?: number
	text?: string
	limit?: number
	beforeId?: number
}

export type LogControlMessage =
	| { type: 'LOG_APPEND'; entries: LogDraft[] }
	| { type: 'LOG_QUERY'; filter: LogQueryFilter }
	| { type: 'LOG_EXPORT'; filter?: LogQueryFilter }
	| { type: 'LOG_CLEAR' }
