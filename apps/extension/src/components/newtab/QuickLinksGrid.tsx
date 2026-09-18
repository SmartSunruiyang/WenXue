import { ArrowLeft, ArrowRight, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import {
	addQuickLink,
	type QuickLink,
	removeQuickLink,
	reorderQuickLinks,
	updateQuickLink,
} from '@/lib/quickLinks'

import { QuickLinkEditor } from './QuickLinkEditor'

interface Props {
	links: QuickLink[]
	onChange: (next: QuickLink[]) => void
}

function Favicon({ link }: { link: QuickLink }) {
	if (link.icon && /^https?:\/\//.test(link.icon)) {
		return <img src={link.icon} alt="" className="size-6 rounded" />
	}
	if (link.icon) return <span className="text-xl leading-none">{link.icon}</span>
	return <span>{link.title.slice(0, 1).toUpperCase()}</span>
}

export function QuickLinksGrid({ links, onChange }: Props) {
	const { t } = useI18n()
	const [editing, setEditing] = useState<QuickLink | null>(null)
	const [adding, setAdding] = useState(false)
	const [dragId, setDragId] = useState<string | null>(null)
	const [menu, setMenu] = useState<{ id: string; top: number; left: number } | null>(null)
	const menuRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement | null>(null)
	const activeLink = links.find((link) => link.id === menu?.id)
	const activeIndex = links.findIndex((link) => link.id === menu?.id)

	const closeMenu = (restoreFocus = false) => {
		setMenu(null)
		if (restoreFocus) triggerRef.current?.focus()
	}

	useEffect(() => {
		if (!menu) return
		menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
		const outside = (event: PointerEvent) => {
			if (
				!menuRef.current?.contains(event.target as Node) &&
				!triggerRef.current?.contains(event.target as Node)
			)
				setMenu(null)
		}
		const dismiss = () => setMenu(null)
		document.addEventListener('pointerdown', outside)
		window.addEventListener('resize', dismiss)
		window.addEventListener('scroll', dismiss, true)
		return () => {
			document.removeEventListener('pointerdown', outside)
			window.removeEventListener('resize', dismiss)
			window.removeEventListener('scroll', dismiss, true)
		}
	}, [menu])

	return (
		<section className="newtab-shortcuts" aria-labelledby="newtab-shortcuts-title">
			<header className="newtab-section-heading">
				<h2 id="newtab-shortcuts-title">{t('ntQuickLinks')}</h2>
				<Button type="button" onClick={() => setAdding(true)}>
					<Plus className="size-4" />
					{t('ntAddLink')}
				</Button>
			</header>
			<ul className="newtab-links">
				{links.map((link, index) => (
					<li
						key={link.id}
						draggable
						onDragStart={() => setDragId(link.id)}
						onDragEnd={() => setDragId(null)}
						onDragOver={(event) => event.preventDefault()}
						onDrop={() => {
							if (dragId && dragId !== link.id) onChange(reorderQuickLinks(links, dragId, index))
							setDragId(null)
						}}
						className={`newtab-link ${dragId === link.id ? 'newtab-link--dragging' : ''}`}
					>
						<a href={link.url} draggable={false} title={link.url}>
							<span className="newtab-link-icon">
								<Favicon link={link} />
							</span>
							<span className="newtab-link-title" title={link.title}>
								{link.title}
							</span>
						</a>
						<button
							type="button"
							aria-label={`${t('settingsMenu')} · ${link.title}`}
							title={t('settingsMenu')}
							aria-haspopup="menu"
							aria-expanded={menu?.id === link.id}
							className="newtab-icon-button newtab-link-menu-trigger"
							onClick={(event) => {
								if (menu?.id === link.id) return closeMenu()
								triggerRef.current = event.currentTarget
								const bounds = event.currentTarget.getBoundingClientRect()
								setMenu({
									id: link.id,
									left: Math.max(12, Math.min(bounds.right - 176, window.innerWidth - 188)),
									top: Math.max(12, Math.min(bounds.bottom + 6, window.innerHeight - 176)),
								})
							}}
						>
							<MoreHorizontal className="size-4" />
						</button>
					</li>
				))}
				<li
					className="newtab-link newtab-link--add"
					onDragOver={(event) => event.preventDefault()}
					onDrop={() => {
						if (dragId) onChange(reorderQuickLinks(links, dragId, links.length))
						setDragId(null)
					}}
				>
					<button type="button" onClick={() => setAdding(true)}>
						<span className="newtab-link-icon">
							<Plus className="size-5" />
						</span>
						<span>{t('ntAddLink')}</span>
					</button>
				</li>
			</ul>

			{menu &&
				activeLink &&
				createPortal(
					<div
						ref={menuRef}
						className="newtab-link-menu"
						role="menu"
						aria-label={activeLink.title}
						style={{ top: menu.top, left: menu.left }}
						onKeyDown={(event) => {
							if (event.key === 'Escape') {
								event.preventDefault()
								closeMenu(true)
							} else if (event.key === 'Tab') closeMenu(true)
							else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
								event.preventDefault()
								const items = Array.from(
									event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
								)
								const current = items.indexOf(document.activeElement as HTMLButtonElement)
								const next =
									event.key === 'Home'
										? 0
										: event.key === 'End'
											? items.length - 1
											: (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
												items.length
								items[next]?.focus()
							}
						}}
					>
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								closeMenu(true)
								setEditing(activeLink)
							}}
						>
							<Pencil className="size-4" />
							{t('ntEditLink')}
						</button>
						<button
							type="button"
							role="menuitem"
							disabled={activeIndex === 0}
							onClick={() => {
								onChange(reorderQuickLinks(links, activeLink.id, activeIndex - 1))
								closeMenu(true)
							}}
						>
							<ArrowLeft className="size-4" />
							{t('ntMoveEarlier')}
						</button>
						<button
							type="button"
							role="menuitem"
							disabled={activeIndex === links.length - 1}
							onClick={() => {
								onChange(reorderQuickLinks(links, activeLink.id, activeIndex + 2))
								closeMenu(true)
							}}
						>
							<ArrowRight className="size-4" />
							{t('ntMoveLater')}
						</button>
						<button
							type="button"
							role="menuitem"
							className="newtab-danger"
							onClick={() => {
								if (window.confirm(`${t('ntDeleteConfirm')}\n${activeLink.title}`))
									onChange(removeQuickLink(links, activeLink.id))
								closeMenu(true)
							}}
						>
							<Trash2 className="size-4" />
							{t('ntDelete')}
						</button>
					</div>,
					document.body,
				)}
			{adding && (
				<QuickLinkEditor
					onClose={() => setAdding(false)}
					onSubmit={(value) => {
						onChange(addQuickLink(links, value))
						setAdding(false)
					}}
				/>
			)}
			{editing && (
				<QuickLinkEditor
					initial={editing}
					onClose={() => setEditing(null)}
					onSubmit={(value) => {
						onChange(updateQuickLink(links, editing.id, value))
						setEditing(null)
					}}
				/>
			)}
		</section>
	)
}
