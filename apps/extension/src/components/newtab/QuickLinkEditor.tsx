import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useI18n } from '@/lib/i18n'
import type { QuickLink } from '@/lib/quickLinks'

interface Props {
	initial?: QuickLink
	onSubmit: (value: { title: string; url: string; icon?: string }) => void
	onClose: () => void
}

export function QuickLinkEditor({ initial, onSubmit, onClose }: Props) {
	const { t } = useI18n()
	const [title, setTitle] = useState(initial?.title ?? '')
	const [url, setUrl] = useState(initial?.url ?? '')
	const [icon, setIcon] = useState(initial?.icon ?? '')
	const [closing, setClosing] = useState(false)
	const closeTimer = useRef<number | null>(null)

	const submit = () => {
		if (!title.trim() || !url.trim()) return
		onSubmit({ title, url, icon })
	}

	const requestClose = () => {
		if (closing) return
		setClosing(true)
		closeTimer.current = window.setTimeout(() => onClose(), 280)
	}

	useEffect(() => {
		return () => {
			if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
		}
	}, [])

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') requestClose()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose])

	return createPortal(
		<div
			className={`wx-editor-overlay fixed inset-0 z-50 flex items-center justify-center ${closing ? 'wx-editor-overlay--closing' : ''}`}
			onClick={requestClose}
		>
			<div
				className={`wx-editor-panel w-80 max-w-[90vw] rounded-xl border bg-card p-4 shadow-2xl ${closing ? 'wx-editor-panel--closing' : ''}`}
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label={initial ? t('ntEditLink') : t('ntAddLink')}
			>
				<p className="mb-3 text-sm font-semibold">
					{initial ? t('ntEditLink') : t('ntAddLink')}
				</p>
				<form
					onSubmit={(e) => {
						e.preventDefault()
						submit()
					}}
				>
					<label className="block space-y-1">
						<span className="text-xs text-muted-foreground">{t('ntLinkTitle')}</span>
						<input
							autoFocus
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</label>
					<label className="mt-3 block space-y-1">
						<span className="text-xs text-muted-foreground">{t('ntLinkUrl')}</span>
						<input
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							placeholder="example.com"
							className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</label>
					<label className="mt-3 block space-y-1">
						<span className="text-xs text-muted-foreground">{t('ntLinkIcon')}</span>
						<input
							value={icon}
							onChange={(e) => setIcon(e.target.value)}
							className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</label>
					<div className="mt-4 flex justify-end gap-2">
						<button
							type="button"
							onClick={requestClose}
							className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent cursor-pointer"
						>
							{t('ntCancel')}
						</button>
						<button
							type="submit"
							className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 cursor-pointer"
						>
							{t('ntSave')}
						</button>
					</div>
				</form>
			</div>
		</div>,
		document.body,
	)
}
