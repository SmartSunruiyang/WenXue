import { Check, ChevronDown } from 'lucide-react'
import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from 'react'

import { cn } from '@/lib/utils'

export interface MagicSelectOption<T extends string> {
	value: T
	label: string
	description?: string
	icon?: ReactNode
}

interface MagicSelectProps<T extends string> {
	id?: string
	value: T
	options: Array<MagicSelectOption<T>>
	onChange: (value: T) => void
	placeholder?: string
	className?: string
	triggerClassName?: string
	menuClassName?: string
}

export function MagicSelect<T extends string>({
	id,
	value,
	options,
	onChange,
	placeholder,
	className,
	triggerClassName,
	menuClassName,
}: MagicSelectProps<T>) {
	const generatedId = useId()
	const triggerId = id ?? generatedId
	const menuId = `${triggerId}-listbox`
	const selectedOption = options.find((option) => option.value === value)
	const [open, setOpen] = useState(false)
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const menuRef = useRef<HTMLDivElement>(null)
	const initialIndex = useRef(0)

	const closeMenu = (restoreFocus = false) => {
		setOpen(false)
		if (restoreFocus) triggerRef.current?.focus()
	}
	const openMenu = (fromEnd = false) => {
		const selectedIndex = options.findIndex((option) => option.value === value)
		initialIndex.current = selectedIndex >= 0 ? selectedIndex : fromEnd ? options.length - 1 : 0
		setOpen(true)
	}

	useLayoutEffect(() => {
		if (!open) return
		const menu = menuRef.current
		const trigger = triggerRef.current
		if (!menu || !trigger) return
		// The top layer escapes scrolling containers while retaining the dialog's DOM/focus boundary.
		menu.showPopover?.()
		const positionMenu = () => {
			const rect = trigger.getBoundingClientRect()
			const below = window.innerHeight - rect.bottom - 14
			const above = rect.top - 14
			const upward = below < 220 && above > below
			menu.style.width = `${Math.min(rect.width, window.innerWidth - 16)}px`
			menu.style.maxHeight = `${Math.max(40, Math.min(288, upward ? above : below))}px`
			menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`
			menu.style.top = `${upward ? Math.max(8, rect.top - menu.offsetHeight - 6) : rect.bottom + 6}px`
		}
		positionMenu()
		const initialOption =
			menu.querySelectorAll<HTMLButtonElement>('[role="option"]')[initialIndex.current]
		if (initialOption) {
			initialOption.focus({ preventScroll: true })
			menu.scrollTop = Math.max(
				0,
				initialOption.offsetTop + initialOption.offsetHeight - menu.clientHeight,
			)
		}
		window.addEventListener('resize', positionMenu)
		const onScroll = (event: Event) => {
			if (!menu.contains(event.target as Node)) positionMenu()
		}
		document.addEventListener('scroll', onScroll, true)
		return () => {
			window.removeEventListener('resize', positionMenu)
			document.removeEventListener('scroll', onScroll, true)
		}
	}, [open])

	useEffect(() => {
		if (!open) return
		const outside = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
		}
		document.addEventListener('pointerdown', outside)
		return () => document.removeEventListener('pointerdown', outside)
	}, [open])

	const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === 'Escape') {
			event.preventDefault()
			event.stopPropagation()
			closeMenu(true)
			return
		}
		if (event.key === 'Tab') {
			// Return to the trigger before the browser advances to the adjacent control.
			closeMenu(true)
			return
		}
		const buttons = Array.from(
			menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
		)
		const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
		let next: number
		if (event.key === 'ArrowDown') next = (current + 1) % buttons.length
		else if (event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length
		else if (event.key === 'Home') next = 0
		else if (event.key === 'End') next = buttons.length - 1
		else return
		event.preventDefault()
		buttons[next]?.focus()
	}

	return (
		<div
			ref={rootRef}
			className={cn('relative', className)}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
			}}
		>
			<button
				ref={triggerRef}
				id={triggerId}
				type="button"
				role="combobox"
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				onClick={() => (open ? closeMenu() : openMenu())}
				onKeyDown={(event) => {
					if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
						event.preventDefault()
						openMenu(event.key === 'ArrowUp')
					}
				}}
				className={cn(
					'flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
					triggerClassName,
				)}
			>
				<span className="flex min-w-0 items-center gap-2">
					{selectedOption?.icon}
					<span className={cn('truncate', !selectedOption && 'text-muted-foreground')}>
						{selectedOption?.label ?? placeholder}
					</span>
				</span>
				<ChevronDown
					className={cn(
						'size-4 shrink-0 text-muted-foreground transition-transform duration-150',
						open && 'rotate-180',
					)}
					aria-hidden="true"
				/>
			</button>
			{open && (
				<div
					ref={menuRef}
					id={menuId}
					role="listbox"
					aria-labelledby={triggerId}
					popover="manual"
					onKeyDown={handleMenuKeyDown}
					style={{ position: 'fixed', inset: 'auto', margin: 0 }}
					className={cn(
						'overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-[0_4px_8px_rgb(0_0_0/0.08)]',
						menuClassName,
					)}
				>
					{options.map((option) => (
						<button
							key={option.value}
							type="button"
							role="option"
							aria-selected={option.value === value}
							tabIndex={-1}
							onClick={() => {
								onChange(option.value)
								closeMenu(true)
							}}
							className={cn(
								'flex min-h-10 w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
								option.value === value && 'bg-muted',
							)}
						>
							<span className="flex min-w-0 items-center gap-2">
								{option.icon && <span className="shrink-0">{option.icon}</span>}
								<span className="min-w-0">
									<span className="block break-words">{option.label}</span>
									{option.description && (
										<span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
											{option.description}
										</span>
									)}
								</span>
							</span>
							<Check
								className={cn('size-4 shrink-0', option.value !== value && 'invisible')}
								aria-hidden="true"
							/>
						</button>
					))}
				</div>
			)}
		</div>
	)
}
