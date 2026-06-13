import { useEffect, useState } from 'react'

import { BrandHero } from '@/components/newtab/BrandHero'
import { OnboardingChecklist } from '@/components/newtab/OnboardingChecklist'
import { QuickLinksGrid } from '@/components/newtab/QuickLinksGrid'
import { RefreshEntry, SettingsEntry } from '@/components/newtab/SettingsEntry'
import type { QuickLink } from '@/lib/quickLinks'
import {
	loadOnboardingDone,
	loadQuickLinks,
	saveOnboardingDone,
	saveQuickLinks,
} from '@/lib/quickLinksStorage'

export default function App() {
	const [state, setState] = useState<{ links: QuickLink[]; onboardingDone: boolean } | null>(null)

	useEffect(() => {
		Promise.all([loadQuickLinks(), loadOnboardingDone()]).then(([links, onboardingDone]) => {
			setState({ links, onboardingDone })
		})
	}, [])

	const updateLinks = (next: QuickLink[]) => {
		setState((current) => (current ? { ...current, links: next } : current))
		saveQuickLinks(chrome.storage.local, next)
	}
	const markOnboarding = (done: boolean) => {
		setState((current) => (current ? { ...current, onboardingDone: done } : current))
		saveOnboardingDone(chrome.storage.local, done)
	}

	return (
		<div className="wx-newtab-page relative min-h-screen w-full overflow-hidden bg-white text-foreground">
			{state && (
				<>
					<div data-newtab-enter className="absolute right-5 top-5 z-20 flex gap-2">
						<RefreshEntry />
						<SettingsEntry />
					</div>
					<main className="relative z-10 mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-8 px-6 py-16">
						<div data-newtab-enter>
							<BrandHero />
						</div>
						<div data-newtab-enter className="w-full">
							<QuickLinksGrid links={state.links} onChange={updateLinks} />
						</div>
						<div data-newtab-enter>
							<OnboardingChecklist done={state.onboardingDone} onDone={markOnboarding} />
						</div>
					</main>
				</>
			)}
		</div>
	)
}
