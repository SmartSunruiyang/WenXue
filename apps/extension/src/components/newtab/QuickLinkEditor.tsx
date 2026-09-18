import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { normalizeUrl, type QuickLink } from '@/lib/quickLinks'

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
	const [urlTouched, setUrlTouched] = useState(false)
	const dialogRef = useRef<HTMLDialogElement>(null)
	const titleRef = useRef<HTMLInputElement>(null)
	const validUrl = normalizeUrl(url) !== null
	const canSave = Boolean(title.trim()) && validUrl

	useEffect(() => {
		const dialog = dialogRef.current
		dialog?.showModal()
		titleRef.current?.focus()
		return () => dialog?.close()
	}, [])

	const close = () => {
		dialogRef.current?.close()
		onClose()
	}

	return createPortal(
		<dialog
			ref={dialogRef}
			className="newtab-editor"
			aria-labelledby="newtab-editor-title"
			onCancel={(event) => {
				event.preventDefault()
				close()
			}}
			onClick={(event) => {
				if (event.target === event.currentTarget) close()
			}}
		>
			<form
				onSubmit={(event) => {
					event.preventDefault()
					if (!canSave) return
					dialogRef.current?.close()
					onSubmit({ title, url, icon })
				}}
			>
				<header>
					<h2 id="newtab-editor-title">{initial ? t('ntEditLink') : t('ntAddLink')}</h2>
					<button
						type="button"
						onClick={close}
						className="newtab-icon-button"
						aria-label={t('ntCancel')}
						title={t('ntCancel')}
					>
						<X className="size-4" />
					</button>
				</header>
				<label>
					<span>{t('ntLinkTitle')}</span>
					<input
						ref={titleRef}
						autoFocus
						required
						maxLength={40}
						value={title}
						onChange={(event) => setTitle(event.target.value)}
					/>
				</label>
				<label>
					<span>{t('ntLinkUrl')}</span>
					<input
						required
						inputMode="url"
						value={url}
						onChange={(event) => setUrl(event.target.value)}
						onBlur={() => setUrlTouched(true)}
						placeholder="example.com"
						aria-invalid={urlTouched && !validUrl}
						aria-describedby={urlTouched && !validUrl ? 'newtab-url-error' : undefined}
					/>
					{urlTouched && !validUrl && (
						<span className="newtab-field-error" id="newtab-url-error">
							{t('ntInvalidUrl')}
						</span>
					)}
				</label>
				<label>
					<span>{t('ntLinkIcon')}</span>
					<input value={icon} onChange={(event) => setIcon(event.target.value)} />
				</label>
				<footer>
					<Button type="button" variant="outline" onClick={close}>
						{t('ntCancel')}
					</Button>
					<Button type="submit" disabled={!canSave}>
						{t('ntSave')}
					</Button>
				</footer>
			</form>
		</dialog>,
		document.body,
	)
}
