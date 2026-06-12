import { Check, ChevronDown, Sparkles } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

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
	const selectedOption = useMemo(
		() => options.find((option) => option.value === value),
		[options, value],
	)
	const [open, setOpen] = useState(false)
	const [closing, setClosing] = useState(false)
	const [hoveredValue, setHoveredValue] = useState<T | null>(null)
	const rootRef = useRef<HTMLDivElement | null>(null)
	const closeTimerRef = useRef<number | null>(null)

	const closeMenu = () => {
		if (!open || closing) return
		setClosing(true)
		setHoveredValue(null)
		closeTimerRef.current = window.setTimeout(() => {
			setOpen(false)
			setClosing(false)
			closeTimerRef.current = null
		}, 160)
	}

	const openMenu = () => {
		if (closeTimerRef.current) {
			window.clearTimeout(closeTimerRef.current)
			closeTimerRef.current = null
		}
		setClosing(false)
		setHoveredValue(null)
		setOpen(true)
	}

	const toggleMenu = () => {
		if (open) {
			closeMenu()
		} else {
			openMenu()
		}
	}

	useEffect(() => {
		return () => {
			if (closeTimerRef.current) {
				window.clearTimeout(closeTimerRef.current)
			}
		}
	}, [])

	useEffect(() => {
		if (!open) return

		const handlePointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) {
				closeMenu()
			}
		}
		const handleKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === 'Escape') closeMenu()
		}

		document.addEventListener('pointerdown', handlePointerDown)
		window.addEventListener('keydown', handleKeyDown)
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown)
			window.removeEventListener('keydown', handleKeyDown)
		}
	}, [open, closing])

	const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
			event.preventDefault()
			openMenu()
		}
	}

	return (
		<div ref={rootRef} className={cn('relative', className)}>
			<button
				id={id}
				type="button"
				role="combobox"
				aria-expanded={open}
				aria-controls={id ? `${id}-listbox` : undefined}
				onClick={toggleMenu}
				onKeyDown={handleTriggerKeyDown}
				className={cn(
					'group relative flex h-9 w-full cursor-pointer items-center justify-between gap-2 overflow-hidden rounded-md border border-input bg-background px-2 text-left text-xs transition-all duration-200',
					'hover:border-primary/40 hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
					open && 'border-primary/50 bg-muted/50 shadow-sm',
					triggerClassName,
				)}
			>
				<span className="pointer-events-none absolute inset-x-2 top-0 h-px scale-x-0 bg-gradient-to-r from-transparent via-primary/70 to-transparent transition-transform duration-300 group-hover:scale-x-100 group-focus-visible:scale-x-100" />
				<span className="flex min-w-0 items-center gap-1.5">
					{selectedOption?.icon ?? (
						<Sparkles
							className={cn(
								'size-3 shrink-0 text-muted-foreground transition-all duration-200',
								open && 'rotate-12 text-primary',
							)}
							aria-hidden="true"
						/>
					)}
					<span className={cn('truncate', !selectedOption && 'text-muted-foreground')}>
						{selectedOption?.label ?? placeholder}
					</span>
				</span>
				<ChevronDown
					className={cn(
						'size-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
						open && 'rotate-180 text-primary',
					)}
					aria-hidden="true"
				/>
			</button>

			{open && (
				<div
					id={id ? `${id}-listbox` : undefined}
					role="listbox"
					onMouseLeave={() => setHoveredValue(null)}
					className={cn(
						'absolute z-50 mt-2 max-h-56 w-full origin-top overflow-y-auto rounded-md border bg-background p-1 shadow-xl transition-all duration-200',
						closing ? '-translate-y-1 scale-95 opacity-0' : 'translate-y-0 scale-100 opacity-100',
						menuClassName,
					)}
				>
					<div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
					{options.map((option) => {
						const selected = option.value === value
						const selectedHighlighted =
							selected && (hoveredValue === null || hoveredValue === option.value)
						return (
							<button
								key={option.value}
								type="button"
								role="option"
								aria-selected={selected}
								data-selected-highlighted={selectedHighlighted ? 'true' : 'false'}
								onMouseEnter={() => setHoveredValue(option.value)}
								onClick={() => {
									onChange(option.value)
									closeMenu()
								}}
								className={cn(
									'group/option flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-2 text-left text-xs transition-all duration-150',
									'hover:bg-muted hover:pl-2.5 focus-visible:bg-muted focus-visible:outline-none',
									selectedHighlighted && 'bg-primary/10 text-primary',
								)}
							>
								<span className="flex min-w-0 items-center gap-2">
									{option.icon && <span className="shrink-0">{option.icon}</span>}
									<span className="min-w-0">
										<span className="block truncate font-medium">{option.label}</span>
										{option.description && (
											<span className="mt-0.5 block truncate text-[10px] leading-4 text-muted-foreground">
												{option.description}
											</span>
										)}
									</span>
								</span>
								<Check
									className={cn(
										'size-3.5 shrink-0 transition-all duration-150',
										selected ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
									)}
									aria-hidden="true"
								/>
							</button>
						)
					})}
				</div>
			)}
		</div>
	)
}
