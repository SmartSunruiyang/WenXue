import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

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
	return (
		<span className="flex size-6 items-center justify-center rounded bg-accent text-xs font-semibold text-accent-foreground">
			{link.title.slice(0, 1).toUpperCase()}
		</span>
	)
}

export function QuickLinksGrid({ links, onChange }: Props) {
	const { t } = useI18n()
	const [editing, setEditing] = useState<QuickLink | null>(null)
	const [adding, setAdding] = useState(false)
	const [dragId, setDragId] = useState<string | null>(null)

	return (
		<div className="flex w-full flex-col items-center">
			<p className="mb-2 w-full max-w-[38rem] px-1 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
				{t('ntQuickLinks')}
			</p>
			<div className="flex w-full max-w-[38rem] flex-wrap justify-center gap-2">
				{links.map((link, index) => (
					<div
						key={link.id}
						draggable
						onDragStart={() => setDragId(link.id)}
						onDragOver={(e) => e.preventDefault()}
						onDrop={() => {
							if (dragId && dragId !== link.id) onChange(reorderQuickLinks(links, dragId, index))
							setDragId(null)
						}}
						className="group relative flex min-h-[76px] w-[104px] flex-col items-center gap-1.5 rounded-xl border bg-card p-3 transition-colors hover:bg-accent"
					>
						<a
							href={link.url}
							draggable={false}
							className="flex flex-col items-center gap-1.5"
							title={link.url}
						>
							<Favicon link={link} />
							<span className="line-clamp-1 max-w-full text-xs text-foreground">{link.title}</span>
						</a>
						<div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
							<button
								type="button"
								aria-label={t('ntEditLink')}
								onClick={() => setEditing(link)}
								className="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
							>
								<Pencil className="size-3" />
							</button>
							<button
								type="button"
								aria-label={t('ntDelete')}
								onClick={() => onChange(removeQuickLink(links, link.id))}
								className="rounded p-0.5 text-muted-foreground hover:text-destructive cursor-pointer"
							>
								<Trash2 className="size-3" />
							</button>
						</div>
					</div>
				))}
				<button
					type="button"
					onClick={() => setAdding(true)}
					onDragOver={(e) => e.preventDefault()}
					onDrop={() => {
						if (dragId) onChange(reorderQuickLinks(links, dragId, links.length))
						setDragId(null)
					}}
					aria-label={t('ntAddLink')}
					className="flex min-h-[76px] w-[104px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
				>
					<Plus className="size-5" />
					<span className="text-xs">{t('ntAddLink')}</span>
				</button>
			</div>

			{adding && (
				<QuickLinkEditor
					onClose={() => setAdding(false)}
					onSubmit={(v) => {
						onChange(addQuickLink(links, v))
						setAdding(false)
					}}
				/>
			)}
			{editing && (
				<QuickLinkEditor
					initial={editing}
					onClose={() => setEditing(null)}
					onSubmit={(v) => {
						onChange(updateQuickLink(links, editing.id, v))
						setEditing(null)
					}}
				/>
			)}
		</div>
	)
}
