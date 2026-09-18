import { useEffect, useState } from 'react'

import { BrandHero } from '@/components/newtab/BrandHero'
import { OnboardingChecklist } from '@/components/newtab/OnboardingChecklist'
import { QuickLinksGrid } from '@/components/newtab/QuickLinksGrid'
import { RefreshEntry, SettingsEntry } from '@/components/newtab/SettingsEntry'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import type { QuickLink } from '@/lib/quickLinks'
import {
	loadOnboardingDone,
	loadQuickLinks,
	saveOnboardingDone,
	saveQuickLinks,
} from '@/lib/quickLinksStorage'

export default function App() {
	const { t } = useI18n()
	const [state, setState] = useState<{ links: QuickLink[]; onboardingDone: boolean } | null>(null)
	const [error, setError] = useState<'load' | 'save' | null>(null)

	useEffect(() => {
		Promise.all([loadQuickLinks(), loadOnboardingDone()])
			.then(([links, onboardingDone]) => setState({ links, onboardingDone }))
			.catch(() => setError('load'))
	}, [])

	const updateLinks = (next: QuickLink[]) => {
		setState((current) => (current ? { ...current, links: next } : current))
		setError(null)
		saveQuickLinks(chrome.storage.local, next).catch(() => setError('save'))
	}
	const markOnboarding = (done: boolean) => {
		setState((current) => (current ? { ...current, onboardingDone: done } : current))
		setError(null)
		saveOnboardingDone(chrome.storage.local, done).catch(() => setError('save'))
	}
	const retry = () => {
		if (!state) return window.location.reload()
		Promise.all([
			saveQuickLinks(chrome.storage.local, state.links),
			saveOnboardingDone(chrome.storage.local, state.onboardingDone),
		])
			.then(() => setError(null))
			.catch(() => setError('save'))
	}

	return (
		<div className="newtab-page">
			<nav className="newtab-tools" aria-label={t('settingsMenu')}>
				<RefreshEntry />
				<SettingsEntry />
			</nav>
			<main className="newtab-main">
				<BrandHero />
				{error && (
					<div className="newtab-error" role="alert">
						<p>{t(error === 'load' ? 'ntLoadError' : 'ntSaveError')}</p>
						<Button type="button" variant="outline" onClick={retry}>
							{t('ntRetry')}
						</Button>
					</div>
				)}
				{state ? (
					<>
						<QuickLinksGrid links={state.links} onChange={updateLinks} />
						<OnboardingChecklist done={state.onboardingDone} onDone={markOnboarding} />
					</>
				) : (
					!error && (
						<div className="newtab-loading" role="status" aria-label={t('loading')}>
							<span />
							<span />
							<span />
						</div>
					)
				)}
			</main>
		</div>
	)
}
