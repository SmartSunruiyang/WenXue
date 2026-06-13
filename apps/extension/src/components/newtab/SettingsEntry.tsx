import { Settings } from 'lucide-react'

import { openExtensionOptionsPage } from '@/lib/extensionPages'
import { useI18n } from '@/lib/i18n'

export function SettingsEntry() {
	const { t } = useI18n()
	return (
		<button
			type="button"
			onClick={() => openExtensionOptionsPage()}
			aria-label={t('ntOpenSettings')}
			title={t('ntOpenSettings')}
			className="flex size-9 items-center justify-center rounded-lg border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
		>
			<Settings className="size-4" />
		</button>
	)
}
