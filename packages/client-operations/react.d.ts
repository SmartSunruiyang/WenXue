import type { ReactNode } from 'react'

import type { AnnouncementView, ClientAnnouncementView, UpdateState } from './index.mjs'

export type DialogPresentation = 'modal' | 'preview'

export interface AnnouncementDialogProps {
	open?: boolean
	announcement: AnnouncementView | ClientAnnouncementView
	presentation?: DialogPresentation
	portalRoot?: Element | DocumentFragment
	onAcknowledge?: () => void
	onDismiss?: () => void
	onOpenDetail?: (url: string) => void
}

export interface UpdateDialogProps {
	open?: boolean
	state: UpdateState
	presentation?: DialogPresentation
	portalRoot?: Element | DocumentFragment
	onDismiss?: () => void
	onDownload?: () => void
	onOpenInstaller?: () => void
	onRetry?: () => void
	onExit?: () => void
}

export function AnnouncementDialog(props: AnnouncementDialogProps): ReactNode
export function UpdateDialog(props: UpdateDialogProps): ReactNode
