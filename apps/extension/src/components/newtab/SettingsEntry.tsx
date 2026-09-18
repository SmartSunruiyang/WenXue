import { RefreshCw, Settings } from 'lucide-react'

import { openExtensionOptionsPage } from '@/lib/extensionPages'
import { useI18n } from '@/lib/i18n'

export function SettingsEntry() {
	const { t } = useI18n()
	return (
		<button
			type="button"
			onClick={() =>
				openExtensionOptionsPage().catch((error) =>
					console.error('[NewTab] Failed to open settings:', error),
				)
			}
			aria-label={t('ntOpenSettings')}
			title={t('ntOpenSettings')}
			className="newtab-icon-button"
		>
			<Settings className="size-4" />
		</button>
	)
}

export function RefreshEntry() {
	const { t } = useI18n()
	return (
		<button
			type="button"
			onClick={() => window.location.reload()}
			aria-label={t('ntRefreshPage')}
			title={t('ntRefreshPage')}
			className="newtab-icon-button"
		>
			<RefreshCw className="size-4" />
		</button>
	)
}
