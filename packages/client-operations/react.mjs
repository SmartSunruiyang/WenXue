import {
	BellRing,
	CircleGauge,
	Download,
	ExternalLink,
	Power,
	RefreshCw,
	TriangleAlert,
	X,
} from 'lucide-react'
import { createElement as h, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { isValidHttpsUrl } from './index.mjs'

export function AnnouncementDialog({
	open = true,
	announcement,
	presentation = 'modal',
	portalRoot,
	onAcknowledge,
	onDismiss,
	onOpenDetail,
}) {
	const dialogRef = useRef(null)
	const titleId = useId()
	const bodyId = useId()
	const important = announcement.importance === 'important'
	const dismissible = !important
	useDialogKeyboard({
		open,
		presentation,
		dialogRef,
		dismissible,
		onDismiss,
	})
	if (!open) return null

	const detailUrl = isValidHttpsUrl(announcement.detailUrl) ? announcement.detailUrl : null
	const detailHost = detailUrl ? readHost(detailUrl) : null
	const dialog = h(
		'div',
		{
			className: `wx-ops-dialog wx-ops-dialog--${important ? 'important' : 'normal'}`,
			ref: dialogRef,
			role: presentation === 'modal' ? (important ? 'alertdialog' : 'dialog') : 'group',
			'aria-modal': presentation === 'modal' ? true : undefined,
			'aria-labelledby': titleId,
			'aria-describedby': bodyId,
			tabIndex: -1,
		},
		h('div', { className: 'wx-ops-rail', 'aria-hidden': true }),
		h(
			'div',
			{ className: 'wx-ops-icon', 'aria-hidden': true },
			important
				? h(TriangleAlert, { size: 21, strokeWidth: 1.8 })
				: h(BellRing, { size: 21, strokeWidth: 1.8 }),
		),
		h(
			'div',
			{ className: 'wx-ops-content' },
			dismissible &&
				h(
					'button',
					{
						className: 'wx-ops-close',
						type: 'button',
						'aria-label': '关闭消息',
						onClick: onDismiss,
					},
					h(X, { size: 17 }),
				),
			h('div', { className: 'wx-ops-eyebrow' }, important ? '重要消息' : '问学消息'),
			h('h2', { id: titleId }, announcement.title),
			h('p', { id: bodyId, className: 'wx-ops-body' }, announcement.body),
			detailUrl &&
				h(
					'button',
					{
						className: 'wx-ops-detail',
						type: 'button',
						onClick: () => onOpenDetail?.(detailUrl),
					},
					h(ExternalLink, { size: 15, 'aria-hidden': true }),
					h('span', null, '查看详情'),
					detailHost && h('small', null, detailHost),
				),
			h(
				'div',
				{ className: 'wx-ops-actions' },
				h(
					'button',
					{
						className: 'wx-ops-button wx-ops-button--primary',
						type: 'button',
						onClick: onAcknowledge,
					},
					'我知道了',
				),
			),
		),
	)
	return renderDialogFrame({ dialog, presentation, portalRoot, dismissible, onDismiss })
}

export function UpdateDialog({
	open = true,
	state,
	presentation = 'modal',
	portalRoot,
	onDismiss,
	onDownload,
	onOpenInstaller,
	onRetry,
	onExit,
}) {
	const dialogRef = useRef(null)
	const titleId = useId()
	const bodyId = useId()
	const release = 'release' in state ? state.release : undefined
	const mandatory = release?.mode === 'mandatory'
	const manualUnsigned = release?.distribution.mode === 'manual-unsigned'
	const dismissible = !mandatory
	const phaseOwnsCopy =
		state.phase === 'checking' || state.phase === 'opening' || state.phase === 'handedOff'
	useDialogKeyboard({
		open,
		presentation,
		dialogRef,
		dismissible,
		onDismiss,
	})
	if (!open) return null

	const dialog = h(
		'div',
		{
			className: `wx-ops-dialog wx-ops-dialog--update${mandatory ? ' wx-ops-dialog--mandatory' : ''}`,
			ref: dialogRef,
			role: presentation === 'modal' ? (mandatory ? 'alertdialog' : 'dialog') : 'group',
			'aria-modal': presentation === 'modal' ? true : undefined,
			'aria-labelledby': titleId,
			'aria-describedby': bodyId,
			tabIndex: -1,
		},
		h('div', { className: 'wx-ops-rail', 'aria-hidden': true }),
		h(
			'div',
			{ className: 'wx-ops-icon', 'aria-hidden': true },
			state.phase === 'error'
				? h(TriangleAlert, { size: 21, strokeWidth: 1.8 })
				: h(Download, { size: 21, strokeWidth: 1.8 }),
		),
		h(
			'div',
			{ className: 'wx-ops-content' },
			dismissible &&
				h(
					'button',
					{
						className: 'wx-ops-close',
						type: 'button',
						'aria-label': '稍后更新',
						onClick: onDismiss,
					},
					h(X, { size: 17 }),
				),
			h('div', { className: 'wx-ops-eyebrow' }, mandatory ? '需要更新' : '版本更新'),
			h(
				'h2',
				{ id: titleId },
				phaseOwnsCopy ? updatePhaseTitle(state) : (release?.title ?? updatePhaseTitle(state)),
			),
			release &&
				h('span', { className: 'wx-ops-version' }, `v${release.version} · ${release.channel}`),
			h(
				'p',
				{ id: bodyId, className: 'wx-ops-body' },
				state.phase === 'error'
					? state.message
					: phaseOwnsCopy
						? updatePhaseDescription(state)
						: (release?.notes ?? updatePhaseDescription(state)),
			),
			release &&
				h(
					'div',
					{ className: 'wx-ops-update-meta' },
					h(CircleGauge, { size: 15, 'aria-hidden': true }),
					h('span', null, formatBytes(release.size)),
					mandatory && h('span', { className: 'wx-ops-required' }, '强制更新'),
				),
			manualUnsigned &&
				h(
					'div',
					{ className: 'wx-ops-unsigned-notice', role: 'note' },
					h(TriangleAlert, { size: 16, 'aria-hidden': true }),
					h(
						'span',
						null,
						h('strong', null, '未签名安装包。'),
						' macOS Gatekeeper 或 Windows SmartScreen 可能显示安全警告；Ed25519 仅校验来源和文件完整性。',
					),
				),
			state.phase === 'downloading' && h(DownloadProgressView, { progress: state.progress }),
			h(
				'div',
				{ className: 'wx-ops-actions' },
				...renderUpdateActions({
					state,
					mandatory,
					onDismiss,
					onDownload,
					onOpenInstaller,
					onRetry,
					onExit,
				}),
			),
		),
	)
	return renderDialogFrame({ dialog, presentation, portalRoot, dismissible, onDismiss })
}

function DownloadProgressView({ progress }) {
	const percent = Math.max(0, Math.min(100, progress.percent))
	return h(
		'div',
		{ className: 'wx-ops-progress' },
		h(
			'div',
			{ className: 'wx-ops-progress__labels' },
			h('span', null, `正在下载 ${percent.toFixed(0)}%`),
			h('span', null, `${formatBytes(progress.transferred)} / ${formatBytes(progress.total)}`),
		),
		h(
			'div',
			{
				className: 'wx-ops-progress__track',
				role: 'progressbar',
				'aria-valuenow': percent,
				'aria-valuemin': 0,
				'aria-valuemax': 100,
			},
			h('span', { style: { width: `${percent}%` } }),
		),
		h('small', null, `${formatBytes(progress.bytesPerSecond)}/s`),
	)
}

function renderUpdateActions({
	state,
	mandatory,
	onDismiss,
	onDownload,
	onOpenInstaller,
	onRetry,
	onExit,
}) {
	const actions = []
	if (!mandatory && onDismiss && state.phase !== 'opening') {
		actions.push(
			h(
				'button',
				{
					key: 'later',
					className: 'wx-ops-button wx-ops-button--secondary',
					type: 'button',
					onClick: onDismiss,
				},
				'稍后',
			),
		)
	}
	if (mandatory && onExit) {
		actions.push(
			h(
				'button',
				{
					key: 'exit',
					className: 'wx-ops-button wx-ops-button--secondary',
					type: 'button',
					onClick: onExit,
				},
				h(Power, { size: 15, 'aria-hidden': true }),
				'退出问学',
			),
		)
	}
	if (state.phase === 'available') {
		actions.push(
			h(
				'button',
				{
					key: 'download',
					className: 'wx-ops-button wx-ops-button--primary',
					type: 'button',
					onClick: onDownload,
				},
				'下载更新',
			),
		)
	} else if (state.phase === 'ready' || state.phase === 'handedOff') {
		actions.push(
			h(
				'button',
				{
					key: 'open-installer',
					className: 'wx-ops-button wx-ops-button--primary',
					type: 'button',
					onClick: onOpenInstaller,
				},
				state.phase === 'handedOff' ? '再次打开安装包' : '打开安装包',
			),
		)
	} else if (state.phase === 'error' && state.retryable) {
		actions.push(
			h(
				'button',
				{
					key: 'retry',
					className: 'wx-ops-button wx-ops-button--primary',
					type: 'button',
					onClick: onRetry,
				},
				h(RefreshCw, { size: 15, 'aria-hidden': true }),
				'重试',
			),
		)
	} else if (
		state.phase === 'downloading' ||
		state.phase === 'opening' ||
		state.phase === 'checking'
	) {
		actions.push(
			h(
				'button',
				{
					key: 'pending',
					className: 'wx-ops-button wx-ops-button--primary',
					type: 'button',
					disabled: true,
				},
				state.phase === 'downloading'
					? '正在下载'
					: state.phase === 'opening'
						? '正在打开安装包'
						: '正在检查',
			),
		)
	}
	return actions
}

function renderDialogFrame({ dialog, presentation, portalRoot, dismissible, onDismiss }) {
	const frame = h(
		'div',
		{
			className: presentation === 'modal' ? 'wx-ops-backdrop' : 'wx-ops-preview',
			'data-wx-ops-presentation': presentation,
			onMouseDown: (event) => {
				if (dismissible && event.target === event.currentTarget) onDismiss?.()
			},
		},
		dialog,
	)
	if (presentation !== 'modal' || typeof globalThis.document === 'undefined') return frame
	return createPortal(frame, portalRoot ?? globalThis.document.body)
}

function useDialogKeyboard({ open, presentation, dialogRef, dismissible, onDismiss }) {
	const previousFocus = useRef(null)
	const onDismissRef = useRef(onDismiss)
	onDismissRef.current = onDismiss
	useEffect(() => {
		if (!open || presentation !== 'modal' || typeof globalThis.document === 'undefined') {
			return undefined
		}
		const ownerDocument = globalThis.document
		previousFocus.current = ownerDocument.activeElement
		const dialog = dialogRef.current
		const focusable = readFocusable(dialog)
		;(focusable[0] ?? dialog)?.focus()

		const handleKeyDown = (event) => {
			if (event.key === 'Escape' && dismissible) {
				event.preventDefault()
				onDismissRef.current?.()
				return
			}
			if (event.key !== 'Tab') return
			const items = readFocusable(dialog)
			if (items.length === 0) {
				event.preventDefault()
				dialog?.focus()
				return
			}
			const first = items[0]
			const last = items.at(-1)
			if (!dialog?.contains(ownerDocument.activeElement)) {
				event.preventDefault()
				;(event.shiftKey ? last : first)?.focus()
				return
			}
			if (event.shiftKey && ownerDocument.activeElement === first) {
				event.preventDefault()
				last?.focus()
			} else if (!event.shiftKey && ownerDocument.activeElement === last) {
				event.preventDefault()
				first.focus()
			}
		}
		ownerDocument.addEventListener('keydown', handleKeyDown)
		return () => {
			ownerDocument.removeEventListener('keydown', handleKeyDown)
			previousFocus.current?.focus?.()
		}
	}, [dialogRef, dismissible, open, presentation])
}

function readFocusable(root) {
	if (!root) return []
	return [
		...root.querySelectorAll('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'),
	].filter((element) => !element.hasAttribute('aria-hidden'))
}

function updatePhaseTitle(state) {
	if (state.phase === 'checking') return '正在检查更新'
	if (state.phase === 'opening') return '正在打开安装包'
	if (state.phase === 'handedOff') return '安装包已打开'
	if (state.phase === 'error') return '更新未完成'
	return '问学已是最新状态'
}

function updatePhaseDescription(state) {
	if (state.phase === 'checking') return '正在读取已发布的版本策略。'
	if (state.phase === 'opening') return '正在请求操作系统打开已校验的安装包。'
	if (state.phase === 'handedOff') return '请按照操作系统提示手动完成安装；问学无法确认安装结果。'
	return '当前没有可下载的新版本。'
}

function readHost(value) {
	try {
		return new globalThis.URL(value).host
	} catch {
		return null
	}
}

function formatBytes(value) {
	if (!Number.isFinite(value) || value <= 0) return '大小未知'
	const units = ['B', 'KB', 'MB', 'GB']
	const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
	const amount = value / 1024 ** exponent
	return `${amount >= 10 || exponent === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[exponent]}`
}
