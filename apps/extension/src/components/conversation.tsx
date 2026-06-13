import type {
	AgentActivity,
	AgentErrorEvent,
	AgentStepEvent,
	HistoricalEvent,
	ObservationEvent,
	RetryEvent,
	UserTakeoverEvent,
} from '@page-agent/core'
import { Check, ChevronRight, CircleAlert, Hand, X } from 'lucide-react'
import { useState } from 'react'

import { Markdown } from '@/components/markdown'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// Stable message PageAgentCore uses when a task is aborted via stop()
const STOPPED_MESSAGE = 'Task aborted'
const LONG_TEXT_LENGTH = 180
const RAW_TEXT_LENGTH = 1200
const RAW_LINE_COUNT = 12

// ---- Event stream → conversation flow items (UIUX §6) ----

type FlowItem =
	| { kind: 'step'; event: AgentStepEvent }
	| { kind: 'observation'; event: ObservationEvent }
	| { kind: 'retry'; event: RetryEvent; cause?: AgentErrorEvent }
	| { kind: 'user-takeover'; event: UserTakeoverEvent }
	| { kind: 'stopped' }
	| { kind: 'error'; event: AgentErrorEvent }
	| { kind: 'result'; success: boolean; text: string; event: AgentStepEvent }

function toFlowItems(events: readonly HistoricalEvent[]): FlowItem[] {
	const items: FlowItem[] = []
	for (let i = 0; i < events.length; i++) {
		const event = events[i]
		if (event.type === 'step') {
			if (event.action?.name === 'done') {
				const input = event.action.input as { text?: string; success?: boolean } | undefined
				items.push({
					kind: 'result',
					success: input?.success ?? true,
					text: input?.text || event.action.output || '',
					event,
				})
			} else {
				items.push({ kind: 'step', event })
			}
		} else if (event.type === 'observation') {
			items.push({ kind: 'observation', event })
		} else if (event.type === 'user_takeover') {
			items.push({ kind: 'user-takeover', event })
		} else if (event.type === 'retry') {
			items.push({ kind: 'retry', event })
		} else if (event.type === 'error') {
			const next = events[i + 1]
			if (next?.type === 'retry') {
				// LLM retry pushes an error + retry pair; collapse into one amber line
				items.push({ kind: 'retry', event: next, cause: event })
				i++
			} else if (event.message === STOPPED_MESSAGE) {
				items.push({ kind: 'stopped' })
			} else {
				items.push({ kind: 'error', event })
			}
		}
	}
	return items
}

type FlowBlock = { trace: FlowItem[] } | { single: FlowItem }

function toBlocks(items: FlowItem[]): FlowBlock[] {
	const blocks: FlowBlock[] = []
	for (const item of items) {
		const isTrace = item.kind === 'step' || item.kind === 'observation' || item.kind === 'retry'
		const last = blocks[blocks.length - 1]
		if (isTrace && last && 'trace' in last) last.trace.push(item)
		else if (isTrace) blocks.push({ trace: [item] })
		else blocks.push({ single: item })
	}
	return blocks
}

/**
 * Claude-desktop style conversation: user task as a right-aligned bubble,
 * agent output as a plain timeline flow — no cards, no bubbles (UIUX §6).
 */
export function Conversation({
	task,
	events,
	activity,
	running = false,
}: {
	task: string
	events: readonly HistoricalEvent[]
	activity?: AgentActivity | null
	running?: boolean
}) {
	const { t } = useI18n()
	const blocks = toBlocks(toFlowItems(events))
	const shouldShowWaiting = running && !activity && Boolean(task) && blocks.length === 0

	return (
		<div
			className="w-full min-w-0 max-w-full overflow-x-hidden space-y-5 pb-1"
			aria-live={running ? 'polite' : undefined}
		>
			{task && <UserMessage text={task} />}

			{blocks.map((block, index) =>
				'trace' in block ? (
					<TraceBlock key={index} items={block.trace} />
				) : (
					<SingleBlock key={index} item={block.single} />
				),
			)}

			{shouldShowWaiting && <LiveStatus text={t('thinking')} live />}
			{activity && <ActivityLine activity={activity} />}
		</div>
	)
}

function SingleBlock({ item }: { item: FlowItem }) {
	if (item.kind === 'result')
		return <ResultBlock success={item.success} text={item.text} event={item.event} />
	if (item.kind === 'error') return <ErrorCallout event={item.event} />
	if (item.kind === 'user-takeover') return <UserTakeoverNote />
	if (item.kind === 'stopped') return <StoppedNote />
	return null
}

function UserMessage({ text }: { text: string }) {
	return (
		<div className="flex w-full min-w-0 justify-end overflow-x-hidden pl-8">
			<div className="max-w-[88%] min-w-0 overflow-hidden rounded-[20px] rounded-br-md border border-border/60 bg-muted/80 px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground shadow-[0_6px_18px_rgb(0_0_0/0.04)] animate-in fade-in-0 slide-in-from-bottom-2 duration-300 dark:bg-muted/70">
				<ExpandableText
					text={text}
					maxChars={220}
					collapsedClassName="line-clamp-4"
					className="whitespace-pre-wrap [overflow-wrap:anywhere]"
				/>
			</div>
		</div>
	)
}

// ---- Timeline trace (steps / observations / retries) ----

function TraceBlock({ items }: { items: FlowItem[] }) {
	return (
		<div className="relative w-full min-w-0 max-w-full overflow-x-hidden space-y-3.5">
			<span
				aria-hidden
				className="absolute bottom-2 left-[6px] top-2 w-px bg-gradient-to-b from-border via-border to-transparent"
			/>
			{items.map((item, index) => {
				if (item.kind === 'step') return <StepRow key={index} event={item.event} />
				if (item.kind === 'observation') return <ObservationRow key={index} event={item.event} />
				if (item.kind === 'retry')
					return <RetryRow key={index} event={item.event} cause={item.cause} />
				return null
			})}
		</div>
	)
}

function TraceDot({ className }: { className?: string }) {
	return (
		<span
			aria-hidden
			className={cn(
				'absolute left-0 top-[5px] size-3 rounded-full border-[1.5px] border-muted-foreground/35 bg-background shadow-[0_0_0_3px_var(--background)]',
				className,
			)}
		/>
	)
}

function StepRow({ event }: { event: AgentStepEvent }) {
	const [expanded, setExpanded] = useState(false)
	const goal = event.reflection?.next_goal?.trim()
	const action = event.action

	return (
		<div className="relative min-w-0 max-w-full overflow-x-hidden pl-7 animate-in fade-in-0 duration-300">
			<TraceDot className={expanded ? 'border-foreground/60' : undefined} />
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				aria-expanded={expanded}
				className="group block w-full min-w-0 cursor-pointer overflow-x-hidden rounded-md text-left transition-colors"
			>
				<p
					className={cn(
						'min-w-0 text-[13px] leading-relaxed text-foreground/90 [overflow-wrap:anywhere]',
						!expanded && 'line-clamp-2',
					)}
				>
					{goal || action?.name || ''}
				</p>
				{action && (
					<p
						className={cn(
							'mt-0.5 min-w-0 break-all font-mono text-[11px] leading-relaxed text-muted-foreground/75 transition-colors group-hover:text-muted-foreground',
							!expanded && 'line-clamp-1',
						)}
					>
						<ChevronRight
							className={cn(
								'mr-0.5 inline size-2.5 align-[-1px] transition-transform',
								expanded && 'rotate-90',
							)}
						/>
						{action.name}
						{action.input != null && ` ${JSON.stringify(action.input)}`}
						{action.output && <span className="text-muted-foreground/55"> → {action.output}</span>}
					</p>
				)}
			</button>
			{expanded && <StepDetails event={event} />}
		</div>
	)
}

function StepDetails({ event }: { event: AgentStepEvent }) {
	const { t } = useI18n()
	const details = [
		{ label: t('evalLabel'), value: event.reflection?.evaluation_previous_goal },
		{ label: t('memoryLabel'), value: event.reflection?.memory },
	].filter((detail) => detail.value)

	return (
		<div className="mt-2 min-w-0 max-w-full overflow-x-hidden space-y-1.5 animate-in fade-in-0 slide-in-from-top-1 duration-200">
			{details.map((detail) => (
				<div
					key={detail.label}
					className="min-w-0 text-[11px] leading-relaxed text-muted-foreground"
				>
					<span className="text-muted-foreground/60">{detail.label}</span>
					<ExpandableText
						text={String(detail.value)}
						maxChars={140}
						collapsedClassName="line-clamp-2"
						className="mt-0.5 whitespace-pre-wrap [overflow-wrap:anywhere]"
					/>
				</div>
			))}
			<RawSection rawRequest={event.rawRequest} rawResponse={event.rawResponse} />
		</div>
	)
}

function ObservationRow({ event }: { event: ObservationEvent }) {
	return (
		<div className="relative min-w-0 max-w-full overflow-x-hidden pl-7 animate-in fade-in-0 duration-300">
			<TraceDot className="border-muted-foreground/25" />
			<ExpandableText
				text={event.content}
				maxChars={160}
				collapsedClassName="line-clamp-2"
				className="text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"
			/>
		</div>
	)
}

function RetryRow({ event, cause }: { event: RetryEvent; cause?: AgentErrorEvent }) {
	const { t } = useI18n()
	const [expanded, setExpanded] = useState(false)

	return (
		<div className="relative min-w-0 max-w-full overflow-x-hidden pl-7 animate-in fade-in-0 duration-300">
			<TraceDot className="border-amber-500/60" />
			<button
				type="button"
				onClick={() => cause && setExpanded(!expanded)}
				className={cn(
					'block w-full min-w-0 overflow-x-hidden text-left',
					cause && 'cursor-pointer',
				)}
			>
				<p className="text-xs leading-relaxed text-amber-600 dark:text-amber-400">
					{t('retrying')} ({event.attempt}/{event.maxAttempts})
				</p>
				{cause && (
					<p
						className={cn(
							'min-w-0 break-all text-[11px] leading-relaxed text-muted-foreground/80',
							!expanded && 'line-clamp-1',
						)}
					>
						{cause.message}
					</p>
				)}
			</button>
			{expanded && cause && <RawSection rawResponse={cause.rawResponse} />}
		</div>
	)
}

function StoppedNote() {
	const { t } = useI18n()
	return (
		<p className="pl-7 text-[12px] leading-relaxed text-muted-foreground/70 animate-in fade-in-0 duration-300">
			{t('taskStopped')}
		</p>
	)
}

function UserTakeoverNote() {
	const { t } = useI18n()
	return (
		<div className="min-w-0 max-w-full overflow-x-hidden pl-7 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
			<div className="flex min-w-0 items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-amber-700 dark:text-amber-300">
				<Hand className="mt-0.5 size-3.5 shrink-0" />
				<p className="min-w-0 text-[12px] leading-relaxed [overflow-wrap:anywhere]">
					{t('userTakeoverNeeded')}
				</p>
			</div>
		</div>
	)
}

// ---- Terminal blocks ----

function ErrorCallout({ event }: { event: AgentErrorEvent }) {
	const { t } = useI18n()
	return (
		<div className="min-w-0 max-w-full overflow-x-hidden pl-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
			<div className="min-w-0 rounded-2xl bg-destructive/10 px-3.5 py-3">
				<div className="flex min-w-0 items-start gap-2">
					<CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
					<div className="min-w-0 flex-1">
						<ExpandableText
							text={event.message}
							maxChars={180}
							collapsedClassName="line-clamp-3"
							className="text-xs leading-relaxed text-destructive [overflow-wrap:anywhere]"
						/>
						<p className="mt-1 text-[11px] text-destructive/70">{t('errorNextStep')}</p>
						{event.rawResponse != null && <RawSection rawResponse={event.rawResponse} />}
					</div>
				</div>
			</div>
		</div>
	)
}

function ResultBlock({
	success,
	text,
	event,
}: {
	success: boolean
	text: string
	event: AgentStepEvent
}) {
	const { t } = useI18n()
	return (
		<div className="min-w-0 max-w-full overflow-x-hidden pt-1 animate-in fade-in-0 slide-in-from-bottom-2 duration-500">
			<div className="flex min-w-0 items-center gap-2">
				<span
					className={cn(
						'flex size-4 items-center justify-center rounded-full',
						success
							? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
							: 'bg-destructive/15 text-destructive',
					)}
				>
					{success ? <Check className="size-3" /> : <X className="size-3" />}
				</span>
				<span className="text-[11px] font-medium tracking-wide text-muted-foreground">
					{success ? t('resultDone') : t('resultFailed')}
				</span>
				<span
					aria-hidden
					className="h-px min-w-0 flex-1 bg-gradient-to-r from-border to-transparent"
				/>
			</div>
			<FinalText text={text} />
			<div className="opacity-60 transition-opacity hover:opacity-100">
				<RawSection rawRequest={event.rawRequest} rawResponse={event.rawResponse} />
			</div>
		</div>
	)
}

// ---- Live activity line (thinking shimmer, UIUX §6) ----

function ActivityLine({ activity }: { activity: AgentActivity }) {
	const { t } = useI18n()

	const text =
		activity.type === 'thinking'
			? t('thinking')
			: activity.type === 'executing'
				? `${t('executing')} ${activity.tool}…`
				: activity.type === 'executed'
					? `${t('executed')}: ${activity.tool}`
					: activity.type === 'retrying'
						? `${t('retrying')} (${activity.attempt}/${activity.maxAttempts})…`
						: activity.message

	const isError = activity.type === 'error'
	const isLive =
		activity.type === 'thinking' || activity.type === 'executing' || activity.type === 'retrying'

	return <LiveStatus text={text} tone={isError ? 'error' : 'neutral'} live={isLive} />
}

function LiveStatus({
	text,
	tone = 'neutral',
	live = false,
}: {
	text: string
	tone?: 'neutral' | 'error'
	live?: boolean
}) {
	return (
		<div className="relative min-w-0 max-w-full overflow-x-hidden pl-7 animate-in fade-in-0 duration-300">
			<span
				aria-hidden
				className={cn(
					'absolute left-[3px] top-[7px] size-[9px] rounded-full',
					tone === 'error' ? 'bg-destructive' : 'bg-foreground/60',
					live && 'animate-pulse',
				)}
			/>
			<span
				className={cn(
					'inline-flex min-w-0 max-w-full items-center gap-2 text-[12.5px] leading-relaxed',
					tone === 'error'
						? 'text-destructive'
						: live
							? 'wx-shimmer-text'
							: 'text-muted-foreground',
				)}
			>
				<span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
				{live && <ThinkingDots />}
			</span>
		</div>
	)
}

function ThinkingDots() {
	return (
		<span aria-hidden className="wx-thinking-dots inline-flex items-center gap-1">
			<span />
			<span />
			<span />
		</span>
	)
}

function FinalText({ text }: { text: string }) {
	return (
		<div className="mt-3">
			<Markdown text={text} />
		</div>
	)
}

function ExpandableText({
	text,
	className,
	collapsedClassName = 'line-clamp-3',
	maxChars = LONG_TEXT_LENGTH,
}: {
	text: string
	className?: string
	collapsedClassName?: string
	maxChars?: number
}) {
	const { t } = useI18n()
	const [expanded, setExpanded] = useState(false)
	const lineCount = text.split('\n').length
	const canExpand = text.length > maxChars || lineCount > 3

	if (!canExpand) {
		return <p className={cn('min-w-0 max-w-full', className)}>{text}</p>
	}

	return (
		<button
			type="button"
			onClick={() => setExpanded((next) => !next)}
			aria-expanded={expanded}
			title={expanded ? t('collapseLongContent') : t('expandLongContent')}
			className={cn(
				'group block w-full min-w-0 max-w-full cursor-pointer overflow-x-hidden border-0 bg-transparent p-0 text-left text-current [font:inherit]',
				className,
			)}
		>
			<span className={cn('block min-w-0 max-w-full', !expanded && collapsedClassName)}>
				{text}
			</span>
			<span className="mt-1 block text-[10px] leading-none text-muted-foreground/55 transition-colors group-hover:text-muted-foreground">
				{expanded ? t('collapseLongContent') : t('expandLongContent')}
			</span>
		</button>
	)
}

// ---- Raw request/response debug section ----

// Extract message content by role from raw request
function extractPrompt(rawRequest: unknown, role: 'system' | 'user'): string | null {
	const messages = (rawRequest as { messages?: { role: string; content?: unknown }[] })?.messages
	if (!messages) return null
	if (!Array.isArray(messages)) return null
	const msg =
		role === 'system'
			? messages.find((m) => m.role === role)
			: messages.findLast((m) => m.role === role)
	if (!msg?.content) return null
	return typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2)
}

function CopyButton({ text, label }: { text: string; label: string }) {
	const { t } = useI18n()
	const [copied, setCopied] = useState(false)

	return (
		<button
			type="button"
			onClick={() => {
				navigator.clipboard.writeText(text)
				setCopied(true)
				setTimeout(() => setCopied(false), 1500)
			}}
			className="shrink-0 cursor-pointer rounded border px-1 text-[9px] text-muted-foreground backdrop-blur-xs transition-colors hover:text-foreground"
		>
			{copied ? t('copied') : label}
		</button>
	)
}

function RawSection({ rawRequest, rawResponse }: { rawRequest?: unknown; rawResponse?: unknown }) {
	const { t } = useI18n()
	const [activeTab, setActiveTab] = useState<'request' | 'response' | null>(null)
	const [expanded, setExpanded] = useState(false)

	if (!rawRequest && !rawResponse) return null

	const handleTabClick = (tab: 'request' | 'response') => {
		setExpanded(false)
		setActiveTab(activeTab === tab ? null : tab)
	}

	const content =
		activeTab === 'request' ? rawRequest : activeTab === 'response' ? rawResponse : null

	const systemPrompt = activeTab === 'request' ? extractPrompt(rawRequest, 'system') : null
	const userPrompt = activeTab === 'request' ? extractPrompt(rawRequest, 'user') : null
	const rawText = content == null ? '' : JSON.stringify(content, null, 4)
	const rawCanExpand =
		rawText.length > RAW_TEXT_LENGTH || rawText.split('\n').length > RAW_LINE_COUNT

	return (
		<div className="mt-2 min-w-0 max-w-full overflow-x-hidden border-t border-dashed pt-2">
			<div className="-my-1 flex min-w-0 items-center gap-3 overflow-x-hidden">
				{rawRequest != null && (
					<button
						type="button"
						onClick={() => handleTabClick('request')}
						className={cn(
							'mt-0.5 cursor-pointer border-b text-[10px] transition-colors',
							activeTab === 'request'
								? 'border-foreground text-foreground'
								: 'border-transparent text-muted-foreground hover:text-foreground',
						)}
					>
						{t('rawRequest')}
					</button>
				)}
				{rawResponse != null && (
					<button
						type="button"
						onClick={() => handleTabClick('response')}
						className={cn(
							'mt-0.5 cursor-pointer border-b text-[10px] transition-colors',
							activeTab === 'response'
								? 'border-foreground text-foreground'
								: 'border-transparent text-muted-foreground hover:text-foreground',
						)}
					>
						{t('rawResponse')}
					</button>
				)}
			</div>
			{content != null && (
				<div className="relative mt-1.5 min-w-0 max-w-full overflow-hidden">
					<div className="absolute right-1 top-1 flex gap-1">
						{systemPrompt && <CopyButton text={systemPrompt} label={t('copySystem')} />}
						{userPrompt && <CopyButton text={userPrompt} label={t('copyUser')} />}
						<CopyButton text={rawText} label={t('copy')} />
					</div>
					<button
						type="button"
						onClick={() => rawCanExpand && setExpanded((next) => !next)}
						aria-expanded={rawCanExpand ? expanded : undefined}
						title={
							rawCanExpand
								? expanded
									? t('collapseLongContent')
									: t('expandLongContent')
								: undefined
						}
						className={cn(
							'block w-full min-w-0 max-w-full overflow-hidden rounded bg-muted p-0 text-left',
							rawCanExpand && 'cursor-pointer',
						)}
					>
						<pre
							className={cn(
								'max-w-full overflow-x-hidden whitespace-pre-wrap break-all p-2 pt-5 text-[10px] leading-relaxed text-foreground/70',
								rawCanExpand && !expanded && 'max-h-36 overflow-y-hidden',
								rawCanExpand && expanded && 'max-h-72 overflow-y-auto',
								!rawCanExpand && 'max-h-60 overflow-y-auto',
							)}
						>
							{rawText}
						</pre>
						{rawCanExpand && (
							<span className="block px-2 pb-2 text-[10px] leading-none text-muted-foreground/55">
								{expanded ? t('collapseLongContent') : t('expandLongContent')}
							</span>
						)}
					</button>
				</div>
			)}
		</div>
	)
}
