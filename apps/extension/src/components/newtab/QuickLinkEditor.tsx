import { useState } from 'react'

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

	const submit = () => {
		if (!title.trim() || !url.trim()) return
		onSubmit({ title, url, icon })
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				className="w-80 max-w-[90vw] rounded-xl border bg-card p-4 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<p className="mb-3 text-sm font-semibold">
					{initial ? t('ntEditLink') : t('ntAddLink')}
				</p>
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
						onClick={onClose}
						className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent cursor-pointer"
					>
						{t('ntCancel')}
					</button>
					<button
						type="button"
						onClick={submit}
						className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 cursor-pointer"
					>
						{t('ntSave')}
					</button>
				</div>
			</div>
		</div>
	)
}
