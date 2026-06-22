import { useCallback, useEffect, useRef, useState } from 'react'

import { useI18n } from '@/lib/i18n'
import type { LogEntry, LogLevel, LogQueryFilter, LogSource } from '@/lib/logTypes'

import { Button } from './ui/button'
import { Input } from './ui/input'

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']
const SOURCES: LogSource[] = ['agent', 'llm', 'tabs', 'page', 'chaoxing', 'config', 'system']

const LEVEL_COLORS: Record<LogLevel, string> = {
	debug: 'text-gray-400',
	info: 'text-blue-500',
	warn: 'text-yellow-500',
	error: 'text-red-500',
}

function sendLogMessage(message: unknown): Promise<unknown> {
	return chrome.runtime.sendMessage(message)
}

export function LogViewer() {
	const { t } = useI18n()
	const [entries, setEntries] = useState<LogEntry[]>([])
	const [selectedLevels, setSelectedLevels] = useState<LogLevel[]>([])
	const [selectedSources, setSelectedSources] = useState<LogSource[]>([])
	const [keyword, setKeyword] = useState('')
	const [expandedId, setExpandedId] = useState<number | null>(null)
	const [loading, setLoading] = useState(false)
	const debounceRef = useRef<ReturnType<typeof setTimeout>>()

	const fetchLogs = useCallback(async () => {
		setLoading(true)
		try {
			const filter: LogQueryFilter = {}
			if (selectedLevels.length > 0) filter.level = selectedLevels
			if (selectedSources.length > 0) filter.source = selectedSources
			if (keyword) filter.text = keyword

			const resp = (await sendLogMessage({ type: 'LOG_QUERY', filter })) as {
				entries?: LogEntry[]
				error?: string
			}
			setEntries(resp.entries ?? [])
		} catch {
			setEntries([])
		} finally {
			setLoading(false)
		}
	}, [selectedLevels, selectedSources, keyword])

	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current)
		debounceRef.current = setTimeout(fetchLogs, 300)
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current)
		}
	}, [fetchLogs])

	const handleExport = async () => {
		try {
			const filter: LogQueryFilter = {}
			if (selectedLevels.length > 0) filter.level = selectedLevels
			if (selectedSources.length > 0) filter.source = selectedSources
			if (keyword) filter.text = keyword

			const resp = (await sendLogMessage({ type: 'LOG_EXPORT', filter })) as {
				entries?: LogEntry[]
			}
			const data = JSON.stringify(resp.entries ?? [], null, 2)
			const blob = new Blob([data], { type: 'application/json' })
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = `wenxue-logs-${new Date().toISOString().slice(0, 10)}.json`
			a.click()
			URL.revokeObjectURL(url)
		} catch {
			// ignore export errors
		}
	}

	const handleClear = async () => {
		if (!window.confirm(t('logViewerClearConfirm'))) return
		try {
			await sendLogMessage({ type: 'LOG_CLEAR' })
			setEntries([])
		} catch {
			// ignore
		}
	}

	const toggleLevel = (level: LogLevel) => {
		setSelectedLevels((prev) =>
			prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level],
		)
	}

	const toggleSource = (source: LogSource) => {
		setSelectedSources((prev) =>
			prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source],
		)
	}

	return (
		<div className="flex flex-col gap-4">
			{/* Filters */}
			<div className="grid gap-3 rounded-md border bg-muted/15 p-4">
				<div className="flex flex-wrap gap-2">
					{LEVELS.map((level) => (
						<button
							key={level}
							onClick={() => toggleLevel(level)}
							className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
								selectedLevels.includes(level)
									? level === 'error'
										? 'bg-red-100 text-red-700'
										: level === 'warn'
											? 'bg-yellow-100 text-yellow-700'
											: level === 'info'
												? 'bg-blue-100 text-blue-700'
												: 'bg-gray-100 text-gray-700'
									: 'bg-background text-muted-foreground hover:text-foreground'
							}`}
						>
							{level}
						</button>
					))}
				</div>
				<div className="flex flex-wrap gap-2">
					{SOURCES.map((source) => (
						<button
							key={source}
							onClick={() => toggleSource(source)}
							className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
								selectedSources.includes(source)
									? 'bg-primary/10 text-primary'
									: 'bg-background text-muted-foreground hover:text-foreground'
							}`}
						>
							{source}
						</button>
					))}
				</div>
			</div>

			<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
				{/* Keyword search */}
				<Input
					placeholder={t('logViewerSearchPlaceholder')}
					value={keyword}
					onChange={(e) => setKeyword(e.target.value)}
					className="h-9 text-sm"
				/>

				{/* Actions */}
				<div className="flex gap-2">
					<Button variant="outline" size="sm" onClick={handleExport}>
						{t('logViewerExport')}
					</Button>
					<Button variant="outline" size="sm" onClick={handleClear}>
						{t('logViewerClear')}
					</Button>
				</div>
				{loading && (
					<span className="text-muted-foreground self-center text-xs">{t('logViewerLoading')}</span>
				)}
			</div>

			{/* Log list */}
			<div className="max-h-[28rem] overflow-y-auto rounded-md border">
				{entries.length === 0 ? (
					<div className="text-muted-foreground p-4 text-center text-sm">{t('logViewerEmpty')}</div>
				) : (
					<table className="w-full text-sm">
						<thead>
							<tr className="bg-muted/50 text-muted-foreground text-left text-xs">
								<th className="px-3 py-2 font-medium">{t('logViewerTime')}</th>
								<th className="px-3 py-2 font-medium">{t('logViewerLevel')}</th>
								<th className="px-3 py-2 font-medium">{t('logViewerSource')}</th>
								<th className="px-3 py-2 font-medium">{t('logViewerMessage')}</th>
							</tr>
						</thead>
						<tbody>
							{entries.map((entry) => (
								<LogRow
									key={entry.id}
									entry={entry}
									expanded={expandedId === entry.id}
									onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
								/>
							))}
						</tbody>
					</table>
				)}
			</div>
		</div>
	)
}

function LogRow({
	entry,
	expanded,
	onToggle,
}: {
	entry: LogEntry
	expanded: boolean
	onToggle: () => void
}) {
	const time = new Date(entry.ts).toLocaleTimeString()
	return (
		<>
			<tr className="hover:bg-muted/30 cursor-pointer border-b" onClick={onToggle}>
				<td className="text-muted-foreground whitespace-nowrap px-3 py-2 font-mono text-xs">
					{time}
				</td>
				<td className={`whitespace-nowrap px-3 py-2 font-medium ${LEVEL_COLORS[entry.level]}`}>
					{entry.level}
				</td>
				<td className="text-muted-foreground whitespace-nowrap px-3 py-2">{entry.source}</td>
				<td className="truncate px-3 py-2">{entry.message}</td>
			</tr>
			{expanded && entry.data !== undefined && (
				<tr>
					<td colSpan={4} className="bg-muted/20 px-3 py-3">
						<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">
							{typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data, null, 2)}
						</pre>
					</td>
				</tr>
			)}
		</>
	)
}
