import { Check, ChevronDown } from 'lucide-react'
import {
	createContext,
	use,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import './desktop-overlays.css'

type Placement = 'bottom-end' | 'bottom-start' | 'right-start'
const EDGE = 8
const FOCUSABLE =
	'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

function focusableWithin(element: HTMLElement) {
	return Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
		(item) =>
			!item.hidden &&
			!item.closest('[inert], [hidden], [aria-hidden="true"]') &&
			getComputedStyle(item).display !== 'none' &&
			getComputedStyle(item).visibility !== 'hidden',
	)
}

function useFloatingPosition(
	open: boolean,
	anchorRef: RefObject<HTMLButtonElement | null>,
	panelRef: RefObject<HTMLDivElement | null>,
	placement: Placement,
	matchWidth = false,
) {
	const [style, setStyle] = useState<CSSProperties>({})
	useLayoutEffect(() => {
		if (!open) return
		const anchor = anchorRef.current!
		const panel = panelRef.current!
		function position() {
			const viewportWidth = document.documentElement.clientWidth || window.innerWidth
			const viewportHeight = document.documentElement.clientHeight || window.innerHeight
			const anchorBounds = anchor.getBoundingClientRect()
			panel.style.maxWidth = `${viewportWidth - EDGE * 2}px`
			if (matchWidth) {
				panel.style.minWidth = `${Math.min(anchorBounds.width, viewportWidth - EDGE * 2)}px`
			}
			const bounds = panel.getBoundingClientRect()
			const height = Math.max(bounds.height, panel.scrollHeight)
			let left = anchorBounds.right - bounds.width
			let top = anchorBounds.bottom + EDGE
			let maxHeight = viewportHeight - EDGE * 2
			if (placement === 'right-start') {
				left = anchorBounds.right + EDGE
				top = anchorBounds.top
				if (left + bounds.width > viewportWidth - EDGE) {
					left = anchorBounds.left - bounds.width - EDGE
				}
			} else {
				if (placement === 'bottom-start') left = anchorBounds.left
				const below = viewportHeight - anchorBounds.bottom - EDGE * 2
				const above = anchorBounds.top - EDGE * 2
				const upwards = height > below && above > below
				maxHeight = Math.max(0, upwards ? above : below)
				if (upwards) top = anchorBounds.top - Math.min(height, maxHeight) - EDGE
			}
			setStyle({
				left: Math.max(EDGE, Math.min(left, viewportWidth - bounds.width - EDGE)),
				top: Math.max(EDGE, Math.min(top, viewportHeight - Math.min(height, maxHeight) - EDGE)),
				maxWidth: viewportWidth - EDGE * 2,
				maxHeight,
				minWidth: matchWidth ? Math.min(anchorBounds.width, viewportWidth - EDGE * 2) : undefined,
			})
		}
		position()
		window.addEventListener('resize', position)
		window.addEventListener('scroll', position, true)
		const observer = new ResizeObserver(position)
		observer.observe(anchor)
		observer.observe(panel)
		return () => {
			window.removeEventListener('resize', position)
			window.removeEventListener('scroll', position, true)
			observer.disconnect()
		}
	}, [open, anchorRef, panelRef, placement, matchWidth])
	return style
}

function useOutsideDismiss(
	open: boolean,
	anchorRef: RefObject<HTMLButtonElement | null>,
	panelRef: RefObject<HTMLDivElement | null>,
	onClose: () => void,
) {
	const closeRef = useRef(onClose)
	useLayoutEffect(() => {
		closeRef.current = onClose
	})
	useEffect(() => {
		if (!open) return
		function dismiss(event: Event) {
			const target = event.target as Node
			if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return
			closeRef.current()
		}
		document.addEventListener('pointerdown', dismiss, true)
		document.addEventListener('focusin', dismiss)
		return () => {
			document.removeEventListener('pointerdown', dismiss, true)
			document.removeEventListener('focusin', dismiss)
		}
	}, [open, anchorRef, panelRef])
}

export interface PopupMenuProps {
	open: boolean
	anchorRef: RefObject<HTMLButtonElement | null>
	onClose: () => void
	children: ReactNode
	label: string
	id?: string
	className?: string
	placement?: 'bottom-end' | 'right-start'
}

export function PopupMenu({
	open,
	anchorRef,
	onClose,
	children,
	label,
	id,
	className = '',
	placement = 'bottom-end',
}: PopupMenuProps) {
	const panelRef = useRef<HTMLDivElement>(null)
	const restoreRef = useRef(true)
	const style = useFloatingPosition(open, anchorRef, panelRef, placement)
	useOutsideDismiss(open, anchorRef, panelRef, () => {
		restoreRef.current = false
		onClose()
	})
	useLayoutEffect(() => {
		if (!open) return
		const panel = panelRef.current!
		restoreRef.current = true
		;(focusableWithin(panel)[0] ?? panel).focus({ preventScroll: true })
		return () => {
			if (
				restoreRef.current &&
				(panel.contains(document.activeElement) || document.activeElement === document.body)
			) {
				anchorRef.current?.focus({ preventScroll: true })
			}
		}
	}, [open, anchorRef])
	function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		const items = focusableWithin(panelRef.current!)
		const index = items.indexOf(document.activeElement as HTMLElement)
		let next: number | undefined
		if (event.key === 'ArrowDown') next = (index + 1) % items.length
		if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
		if (event.key === 'Home') next = 0
		if (event.key === 'End') next = items.length - 1
		if (next !== undefined) {
			event.preventDefault()
			items[next]?.focus({ preventScroll: true })
			items[next]?.scrollIntoView?.({ block: 'nearest' })
		} else if (event.key === 'Escape') {
			event.preventDefault()
			event.stopPropagation()
			onClose()
		} else if (event.key === 'Tab') {
			event.preventDefault()
			restoreRef.current = false
			const controls = focusableWithin(
				anchorRef.current?.closest<HTMLElement>('.wx-dialog-backdrop') ?? document.body,
			).filter((item) => !panelRef.current!.contains(item))
			const triggerIndex = controls.indexOf(anchorRef.current!)
			controls[triggerIndex + (event.shiftKey ? -1 : 1)]?.focus()
			onClose()
		}
	}
	if (!open) return null
	return createPortal(
		<div
			ref={panelRef}
			id={id}
			role="menu"
			aria-label={label}
			tabIndex={-1}
			className={`wx-popup-menu ${className}`}
			style={style}
			onKeyDown={handleKeyDown}
		>
			{children}
		</div>,
		anchorRef.current?.closest<HTMLElement>('.wx-dialog-backdrop') ?? document.body,
	)
}

export interface SelectFieldProps {
	value: string
	onChange: (value: string) => void
	options: { value: string; label: string }[]
	label: string
	disabled?: boolean
	className?: string
}

export function SelectField({
	value,
	onChange,
	options,
	label,
	disabled = false,
	className = '',
}: SelectFieldProps) {
	const [expanded, setExpanded] = useState(false)
	const [active, setActive] = useState(0)
	const anchorRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const searchRef = useRef({ value: '', time: 0 })
	const id = useId()
	const open = expanded && !disabled && options.length > 0
	const selectedIndex = options.findIndex((option) => option.value === value)
	const style = useFloatingPosition(open, anchorRef, panelRef, 'bottom-start', true)
	useOutsideDismiss(open, anchorRef, panelRef, () => setExpanded(false))
	useLayoutEffect(() => {
		if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: 'nearest' })
	}, [open, active, id])
	function expand(index = Math.max(0, selectedIndex)) {
		setActive(index)
		setExpanded(true)
	}
	function choose(index: number) {
		if (options[index]) onChange(options[index].value)
		setExpanded(false)
	}
	function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
		if (event.key === 'Tab') {
			setExpanded(false)
			return
		}
		if (event.key === 'Escape' && open) {
			event.preventDefault()
			event.stopPropagation()
			setExpanded(false)
			return
		}
		if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
			event.preventDefault()
			if (event.key === 'Home') expand(0)
			else if (event.key === 'End') expand(options.length - 1)
			else if (!open) expand()
			else if (event.key === 'Enter' || event.key === ' ') choose(active)
			else
				setActive((active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
			return
		}
		if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
			const previous = searchRef.current
			const search = Date.now() - previous.time > 500 ? event.key : previous.value + event.key
			searchRef.current = { value: search.toLocaleLowerCase(), time: Date.now() }
			const index = options.findIndex((option) =>
				option.label.toLocaleLowerCase().startsWith(searchRef.current.value),
			)
			if (index >= 0) {
				event.preventDefault()
				expand(index)
			}
		}
	}
	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				role="combobox"
				aria-label={label}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? id : undefined}
				aria-activedescendant={open ? `${id}-${active}` : undefined}
				disabled={disabled || options.length === 0}
				className={`wx-select-field ${className}`}
				onClick={() => (open ? setExpanded(false) : expand())}
				onKeyDown={handleKeyDown}
			>
				<span>{options[selectedIndex]?.label ?? value}</span>
				<ChevronDown size={15} aria-hidden="true" className="wx-select-field__chevron" />
			</button>
			{open &&
				createPortal(
					<div
						ref={panelRef}
						id={id}
						role="listbox"
						aria-label={label}
						className="wx-select-list"
						style={style}
					>
						{options.map((option, index) => (
							<div
								key={option.value}
								id={`${id}-${index}`}
								role="option"
								aria-selected={option.value === value}
								className="wx-select-option"
								data-active={index === active || undefined}
								onPointerMove={() => setActive(index)}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => choose(index)}
							>
								<span>{option.label}</span>
								{option.value === value && <Check size={15} aria-hidden="true" />}
							</div>
						))}
					</div>,
					anchorRef.current?.closest<HTMLElement>('.wx-dialog-backdrop') ?? document.body,
				)}
		</>
	)
}

const modalStack: HTMLElement[] = []

export interface DesktopDialogProps {
	title: string
	description?: string
	children: ReactNode
	onClose: () => void
	initialFocusRef?: RefObject<HTMLElement | null>
}

export function DesktopDialog({
	title,
	description,
	children,
	onClose,
	initialFocusRef,
}: DesktopDialogProps) {
	const panelRef = useRef<HTMLDivElement>(null)
	const closeRef = useRef(onClose)
	const initialRef = useRef(initialFocusRef)
	const id = useId()
	useLayoutEffect(() => {
		closeRef.current = onClose
	})
	useLayoutEffect(() => {
		const panel = panelRef.current!
		const previousFocus = document.activeElement as HTMLElement | null
		modalStack.push(panel)
		const focusInitial = () => {
			const initial = initialRef.current?.current
			const target = initial && !initial.matches(':disabled') ? initial : focusableWithin(panel)[0]
			;(target ?? panel).focus({
				preventScroll: true,
			})
		}
		focusInitial()
		function trapFocus(event: FocusEvent) {
			if (modalStack.at(-1) === panel && !panel.parentElement!.contains(event.target as Node))
				focusInitial()
		}
		document.addEventListener('focusin', trapFocus)
		return () => {
			document.removeEventListener('focusin', trapFocus)
			modalStack.splice(modalStack.indexOf(panel), 1)
			if (
				previousFocus?.isConnected &&
				(panel.contains(document.activeElement) || document.activeElement === document.body)
			) {
				previousFocus.focus({ preventScroll: true })
			}
		}
	}, [])
	function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		const panel = panelRef.current!
		if (modalStack.at(-1) !== panel || !['Escape', 'Tab'].includes(event.key)) return
		event.stopPropagation()
		if (event.defaultPrevented) return
		if (event.key === 'Escape') {
			event.preventDefault()
			closeRef.current()
			return
		}
		const controls = focusableWithin(panel)
		const first = controls[0]
		const last = controls.at(-1)
		if (
			!first ||
			(event.shiftKey ? document.activeElement === first : document.activeElement === last)
		) {
			event.preventDefault()
			;(event.shiftKey ? (last ?? panel) : (first ?? panel)).focus()
		}
	}
	return createPortal(
		<div
			className="wx-dialog-backdrop"
			onKeyDown={handleKeyDown}
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && modalStack.at(-1) === panelRef.current)
					onClose()
			}}
		>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={`${id}-title`}
				aria-describedby={description ? `${id}-description` : undefined}
				tabIndex={-1}
				className="wx-dialog"
			>
				<h2 id={`${id}-title`} className="wx-dialog__title">
					{title}
				</h2>
				{description && (
					<p id={`${id}-description`} className="wx-dialog__description">
						{description}
					</p>
				)}
				{children}
			</div>
		</div>,
		document.body,
	)
}

export interface ConfirmationOptions {
	title: string
	description: string
	confirmLabel?: string
	danger?: boolean
}
type Confirm = (options: ConfirmationOptions) => Promise<boolean>
const ConfirmationContext = createContext<Confirm | null>(null)

export function ConfirmationProvider({
	children,
	labels,
}: {
	children: ReactNode
	labels: { cancel: string; confirm: string }
}) {
	const [options, setOptions] = useState<(ConfirmationOptions & { requestId: number }) | null>(null)
	const requestRef = useRef(0)
	const resolveRef = useRef<((value: boolean) => void) | null>(null)
	const mountedRef = useRef(true)
	const cancelRef = useRef<HTMLButtonElement>(null)
	const confirm = useCallback<Confirm>((next) => {
		if (!mountedRef.current) return Promise.resolve(false)
		resolveRef.current?.(false)
		return new Promise<boolean>((resolve) => {
			resolveRef.current = resolve
			setOptions({ ...next, requestId: ++requestRef.current })
		})
	}, [])
	function settle(accepted: boolean) {
		const resolve = resolveRef.current
		resolveRef.current = null
		setOptions(null)
		resolve?.(accepted)
	}
	useEffect(() => {
		mountedRef.current = true
		return () => {
			mountedRef.current = false
			resolveRef.current?.(false)
			resolveRef.current = null
		}
	}, [])
	return (
		<ConfirmationContext value={confirm}>
			{children}
			{options && (
				<DesktopDialog
					key={options.requestId}
					title={options.title}
					description={options.description}
					onClose={() => settle(false)}
					initialFocusRef={cancelRef}
				>
					<div className="wx-dialog__actions">
						<button
							ref={cancelRef}
							type="button"
							className="wx-dialog__button"
							onClick={() => settle(false)}
						>
							{labels.cancel}
						</button>
						<button
							type="button"
							className={`wx-dialog__button wx-dialog__button--${options.danger ? 'danger' : 'primary'}`}
							onClick={() => settle(true)}
						>
							{options.confirmLabel ?? labels.confirm}
						</button>
					</div>
				</DesktopDialog>
			)}
		</ConfirmationContext>
	)
}

export function useConfirmation(): Confirm {
	const confirm = use(ConfirmationContext)
	if (!confirm) throw new Error('useConfirmation requires ConfirmationProvider')
	return confirm
}
