import {
	Check,
	ChevronDown,
	EllipsisVertical,
	History,
	Languages,
	Send,
	Settings,
	Square,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DEMO_MODEL } from '@/agent/constants'
import { HistoryDetail } from '@/components/HistoryDetail'
import { HistoryList } from '@/components/HistoryList'
import { Conversation } from '@/components/conversation'
import { EmptyState, MotionOverlay, PinTip, StatusDot } from '@/components/misc'
import { Button } from '@/components/ui/button'
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from '@/components/ui/input-group'
import { saveSession } from '@/lib/db'
import { openExtensionOptionsPage } from '@/lib/extensionPages'
import type { UILanguage } from '@/lib/i18n'
import { useI18n } from '@/lib/i18n'
import {
	BUILT_IN_MODEL_ID,
	BUILT_IN_MODEL_LABEL,
	getCustomModelLabel,
	normalizeSelectedModelId,
} from '@/lib/modelConfig'
import { cn } from '@/lib/utils'

import { type ExtConfig, type LanguagePreference, useAgent } from '../../agent/useAgent'

type View = { name: 'chat' } | { name: 'history' } | { name: 'history-detail'; sessionId: string }

export default function App() {
	const [view, setView] = useState<View>({ name: 'chat' })
	const [inputValue, setInputValue] = useState('')
	const historyRef = useRef<HTMLDivElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const { t } = useI18n()

	const { status, history, activity, currentTask, config, execute, stop, configure } = useAgent()

	// Persist session when task finishes
	const prevStatusRef = useRef(status)
	useEffect(() => {
		const prev = prevStatusRef.current
		prevStatusRef.current = status

		if (
			prev === 'running' &&
			(status === 'completed' || status === 'error') &&
			history.length > 0 &&
			currentTask
		) {
			saveSession({ task: currentTask, history, status }).catch((err) =>
				console.error('[SidePanel] Failed to save session:', err),
			)
		}
	}, [status, history, currentTask])

	// Auto-scroll to bottom on new events
	useEffect(() => {
		if (historyRef.current) {
			historyRef.current.scrollTop = historyRef.current.scrollHeight
		}
	}, [history, activity])

	const runTask = useCallback(
		(task: string) => {
			const normalizedTask = task.trim()
			if (!normalizedTask || status === 'running') return

			setInputValue('')
			setView({ name: 'chat' })

			execute(normalizedTask).catch((error) => {
				console.error('[SidePanel] Failed to execute task:', error)
			})
		},
		[execute, status],
	)

	const handleSubmit = useCallback(
		(e?: React.SyntheticEvent) => {
			e?.preventDefault()
			runTask(inputValue)
		},
		[inputValue, runTask],
	)

	const handleStop = useCallback(() => {
		console.log('[SidePanel] Stopping task...')
		stop()
	}, [stop])

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault()
			handleSubmit()
		}
	}

	// --- View routing ---

	if (view.name === 'history') {
		return (
			<HistoryList
				onSelect={(id) => setView({ name: 'history-detail', sessionId: id })}
				onBack={() => setView({ name: 'chat' })}
				onRerun={runTask}
			/>
		)
	}

	if (view.name === 'history-detail') {
		return (
			<HistoryDetail
				sessionId={view.sessionId}
				onBack={() => setView({ name: 'history' })}
				onRerun={runTask}
			/>
		)
	}

	// --- Chat view ---

	const isRunning = status === 'running'
	const showEmptyState = !currentTask && history.length === 0 && !isRunning

	return (
		<div className="relative flex h-screen w-full min-w-0 max-w-full flex-col overflow-x-hidden bg-background">
			<MotionOverlay active={isRunning} />
			{showEmptyState && <PinTip />}
			{/* Header */}
			<header className="flex items-center justify-between px-3 py-2">
				<div className="flex items-center gap-2">
					<img
						src="/assets/wenxue-slogan-header.png"
						alt="问学"
						className="h-5 w-auto select-none pointer-events-none"
					/>
				</div>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={() => setView({ name: 'history' })}
						className="cursor-pointer"
						aria-label={t('history')}
						title={t('history')}
					>
						<History className="size-3.5" />
					</Button>
					<MoreMenu config={config} onConfigure={configure} />
				</div>
			</header>

			{/* Content */}
			<main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				<div
					ref={historyRef}
					className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4 pt-2"
				>
					{showEmptyState ? (
						<EmptyState />
					) : (
						<Conversation
							task={currentTask}
							events={history}
							activity={activity}
							running={isRunning}
						/>
					)}
				</div>
			</main>

			{/* Input */}
			<footer className="px-3 pb-2 pt-1">
				<InputGroup className="relative rounded-[22px] border-border/70 bg-background/95 shadow-[0_10px_28px_rgb(0_0_0/0.07)] dark:bg-background/90">
					<TaskInput
						ref={textareaRef}
						value={inputValue}
						onChange={(e) => setInputValue(e.target.value)}
						onKeyDown={handleKeyDown}
						disabled={isRunning}
						aria-label={t('describeTask')}
						className="max-h-36 min-h-11 px-3.5 pb-2 pt-3 text-[14px] leading-relaxed"
					/>
					<InputGroupAddon align="block-end" className="justify-between gap-2 px-2.5 pb-2">
						<ModelMenu config={config} onConfigure={configure} disabled={isRunning} />
						<div className="flex items-center">
							<StatusDot status={status} />
							{isRunning ? (
								<InputGroupButton
									size="icon-sm"
									variant="destructive"
									onClick={handleStop}
									className="size-7"
									aria-label={t('stopTask')}
									title={t('stopTask')}
								>
									<Square className="size-3" />
								</InputGroupButton>
							) : (
								<InputGroupButton
									size="icon-sm"
									variant="default"
									onClick={() => handleSubmit()}
									disabled={!inputValue.trim()}
									className="size-7 cursor-pointer"
									aria-label={t('send')}
									title={t('send')}
								>
									<Send className="size-3" />
								</InputGroupButton>
							)}
						</div>
					</InputGroupAddon>
				</InputGroup>
				<p className="mt-1.5 text-center text-[10px] leading-none text-muted-foreground/70 select-none">
					{t('aiDisclaimer')}
				</p>
			</footer>
		</div>
	)
}

const TASK_HINT_KEYS = [
	'taskHint1',
	'taskHint2',
	'taskHint3',
	'taskHint4',
	'taskHint5',
	'taskHint6',
] as const

// Typewriter-cycled placeholder; ticks only while the textarea is empty
function useTypingPlaceholder(words: string[], active: boolean): string {
	const [text, setText] = useState('')
	const [wordIndex, setWordIndex] = useState(0)
	const [phase, setPhase] = useState<'typing' | 'pause' | 'deleting'>('typing')
	const [reduceMotion] = useState(
		() => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
	)

	// clear placeholder text when deactivated (e.g. textarea focused)
	useEffect(() => {
		if (!active) {
			setText('')
			setWordIndex(0)
			setPhase('typing')
		}
	}, [active])

	// restart the cycle when the word list (interface language) changes
	const wordsKey = words.join('\n')
	useEffect(() => {
		setText('')
		setWordIndex(0)
		setPhase('typing')
	}, [wordsKey])

	useEffect(() => {
		if (!active || reduceMotion || words.length === 0) return

		const graphemes = Array.from(words[wordIndex] ?? '')
		const typed = Array.from(text).length
		const delay = phase === 'typing' ? (typed === 0 ? 700 : 90) : phase === 'pause' ? 2600 : 30

		const timeout = setTimeout(() => {
			if (phase === 'typing') {
				if (typed < graphemes.length) setText(graphemes.slice(0, typed + 1).join(''))
				else setPhase('pause')
			} else if (phase === 'pause') {
				setPhase('deleting')
			} else if (typed > 0) {
				setText(graphemes.slice(0, typed - 1).join(''))
			} else {
				setWordIndex((wordIndex + 1) % words.length)
				setPhase('typing')
			}
		}, delay)
		return () => clearTimeout(timeout)
	}, [active, reduceMotion, words, wordIndex, phase, text])

	if (!active) return ''
	if (reduceMotion) return words[0] ?? ''
	return `${text}_`
}

function TaskInput(props: React.ComponentProps<typeof InputGroupTextarea>) {
	const { t } = useI18n()
	const [focused, setFocused] = useState(false)
	const hints = useMemo(() => TASK_HINT_KEYS.map((key) => t(key)), [t])
	const placeholder = useTypingPlaceholder(hints, !props.value && !focused)
	return (
		<InputGroupTextarea
			placeholder={placeholder}
			{...props}
			onFocus={(e) => {
				setFocused(true)
				props.onFocus?.(e)
			}}
			onBlur={(e) => {
				setFocused(false)
				props.onBlur?.(e)
			}}
		/>
	)
}

function ModelMenu({
	config,
	onConfigure,
	disabled,
}: {
	config: ExtConfig | null
	onConfigure: (config: ExtConfig) => Promise<void>
	disabled: boolean
}) {
	const { t } = useI18n()
	const [open, setOpen] = useState(false)
	const menuRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) return

		const closeOnPointerDown = (event: PointerEvent) => {
			if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
		}
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false)
		}

		document.addEventListener('pointerdown', closeOnPointerDown)
		document.addEventListener('keydown', closeOnEscape)
		return () => {
			document.removeEventListener('pointerdown', closeOnPointerDown)
			document.removeEventListener('keydown', closeOnEscape)
		}
	}, [open])

	const customModels = config?.customModels ?? []
	const selectedId = normalizeSelectedModelId(config?.selectedModelId, customModels)
	const selectedName = customModels.find((model) => model.id === selectedId)?.model ?? DEMO_MODEL

	const selectModel = (id: string) => {
		setOpen(false)
		if (!config || id === selectedId) return
		onConfigure({ ...config, selectedModelId: id }).catch((error) => {
			console.error('[SidePanel] Failed to switch model:', error)
		})
	}

	const openModelSettings = () => {
		setOpen(false)
		openExtensionOptionsPage().catch((error) => {
			console.error('[SidePanel] Failed to open settings page:', error)
		})
	}

	return (
		<div ref={menuRef} className="relative min-w-0">
			<Button
				variant="ghost"
				disabled={disabled || !config}
				onClick={() => setOpen((next) => !next)}
				className="h-6 max-w-44 gap-1 rounded-md px-1.5 text-xs font-normal text-muted-foreground hover:text-foreground cursor-pointer"
				aria-label={t('selectModel')}
				title={t('selectModel')}
				aria-haspopup="menu"
				aria-expanded={open}
			>
				<span className="truncate">{selectedName}</span>
				<ChevronDown className={cn('size-3 shrink-0 transition-transform', open && 'rotate-180')} />
			</Button>

			{open && (
				<div
					role="menu"
					className="animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 absolute bottom-full left-0 z-50 mb-1.5 w-60 origin-bottom-left rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
				>
					<MenuRadioItem
						label={BUILT_IN_MODEL_LABEL}
						active={selectedId === BUILT_IN_MODEL_ID}
						disabled={!config}
						onClick={() => selectModel(BUILT_IN_MODEL_ID)}
					/>
					{customModels.map((model) => (
						<MenuRadioItem
							key={model.id}
							label={getCustomModelLabel(model)}
							active={model.id === selectedId}
							disabled={!config}
							onClick={() => selectModel(model.id)}
						/>
					))}

					<div className="mt-1 border-t pt-1">
						<button
							type="button"
							role="menuitem"
							onClick={openModelSettings}
							className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
						>
							<Settings className="size-3" />
							<span>{t('manageModels')}</span>
						</button>
					</div>
				</div>
			)}
		</div>
	)
}

function MoreMenu({
	config,
	onConfigure,
}: {
	config: ExtConfig | null
	onConfigure: (config: ExtConfig) => Promise<void>
}) {
	const { t, lang, setLang } = useI18n()
	const [open, setOpen] = useState(false)
	const [languageOpen, setLanguageOpen] = useState(false)
	const menuRef = useRef<HTMLDivElement>(null)
	const uiLanguage = config?.uiLanguage ?? lang
	const responseLanguage = config?.language

	useEffect(() => {
		if (!open) return

		const closeOnPointerDown = (event: PointerEvent) => {
			if (!menuRef.current?.contains(event.target as Node)) {
				setOpen(false)
				setLanguageOpen(false)
			}
		}
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setOpen(false)
				setLanguageOpen(false)
			}
		}

		document.addEventListener('pointerdown', closeOnPointerDown)
		document.addEventListener('keydown', closeOnEscape)
		return () => {
			document.removeEventListener('pointerdown', closeOnPointerDown)
			document.removeEventListener('keydown', closeOnEscape)
		}
	}, [open])

	const openOptionsPage = () => {
		setOpen(false)
		setLanguageOpen(false)
		openExtensionOptionsPage().catch((error) => {
			console.error('[SidePanel] Failed to open settings page:', error)
		})
	}

	const updateUiLanguage = (next: UILanguage) => {
		if (!config) return
		setLang(next)
		onConfigure({ ...config, uiLanguage: next }).catch((error) => {
			console.error('[SidePanel] Failed to update UI language:', error)
		})
		setOpen(false)
		setLanguageOpen(false)
	}

	const updateResponseLanguage = (next: LanguagePreference) => {
		if (!config) return
		onConfigure({ ...config, language: next }).catch((error) => {
			console.error('[SidePanel] Failed to update response language:', error)
		})
		setOpen(false)
		setLanguageOpen(false)
	}

	return (
		<div ref={menuRef} className="relative">
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={() => {
					setOpen((next) => !next)
					setLanguageOpen(false)
				}}
				className="cursor-pointer"
				aria-label={t('settingsMenu')}
				title={t('settingsMenu')}
				aria-haspopup="menu"
				aria-expanded={open}
			>
				<EllipsisVertical className="size-3.5" />
			</Button>

			{open && (
				<div
					role="menu"
					className="animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 absolute right-0 top-9 z-50 w-56 origin-top-right rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
				>
					<button
						type="button"
						role="menuitem"
						onClick={openOptionsPage}
						className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs hover:bg-accent hover:text-accent-foreground"
					>
						<Settings className="size-3.5" />
						<span>{t('menuSettings')}</span>
					</button>

					<button
						type="button"
						role="menuitem"
						onClick={() => setLanguageOpen((next) => !next)}
						className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs hover:bg-accent hover:text-accent-foreground"
						aria-expanded={languageOpen}
					>
						<Languages className="size-3.5" />
						<span className="flex-1">{t('menuLanguage')}</span>
						<span className="text-[10px] text-muted-foreground">
							{uiLanguage === 'zh-CN' ? '中文' : 'EN'}
						</span>
					</button>

					{languageOpen && (
						<div className="mt-1 border-t pt-1">
							<div className="px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
								{t('quickInterfaceLanguage')}
							</div>
							<MenuRadioItem
								label="中文"
								active={uiLanguage === 'zh-CN'}
								disabled={!config}
								onClick={() => updateUiLanguage('zh-CN')}
							/>
							<MenuRadioItem
								label="English"
								active={uiLanguage === 'en-US'}
								disabled={!config}
								onClick={() => updateUiLanguage('en-US')}
							/>

							<div className="px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
								{t('quickResponseLanguage')}
							</div>
							<MenuRadioItem
								label={t('langSystem')}
								active={!responseLanguage}
								disabled={!config}
								onClick={() => updateResponseLanguage(undefined)}
							/>
							<MenuRadioItem
								label={t('langChinese')}
								active={responseLanguage === 'zh-CN'}
								disabled={!config}
								onClick={() => updateResponseLanguage('zh-CN')}
							/>
							<MenuRadioItem
								label={t('langEnglish')}
								active={responseLanguage === 'en-US'}
								disabled={!config}
								onClick={() => updateResponseLanguage('en-US')}
							/>
						</div>
					)}
				</div>
			)}
		</div>
	)
}

function MenuRadioItem({
	label,
	active,
	disabled,
	onClick,
}: {
	label: string
	active: boolean
	disabled: boolean
	onClick: () => void
}) {
	return (
		<button
			type="button"
			role="menuitemradio"
			aria-checked={active}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50',
				active && 'text-foreground',
			)}
		>
			<Check className={cn('size-3', active ? 'opacity-100' : 'opacity-0')} />
			<span>{label}</span>
		</button>
	)
}
