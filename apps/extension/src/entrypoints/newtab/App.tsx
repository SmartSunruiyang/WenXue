import { useEffect, useState } from 'react'

import { BrandHero } from '@/components/newtab/BrandHero'
import { OnboardingChecklist } from '@/components/newtab/OnboardingChecklist'
import { QuickLinksGrid } from '@/components/newtab/QuickLinksGrid'
import { SettingsEntry } from '@/components/newtab/SettingsEntry'
import type { QuickLink } from '@/lib/quickLinks'
import {
	loadOnboardingDone,
	loadQuickLinks,
	saveOnboardingDone,
	saveQuickLinks,
} from '@/lib/quickLinksStorage'

export default function App() {
	const [links, setLinks] = useState<QuickLink[] | null>(null)
	const [onboardingDone, setOnboardingDone] = useState(true)

	useEffect(() => {
		loadQuickLinks().then(setLinks)
		loadOnboardingDone().then(setOnboardingDone)
	}, [])

	const updateLinks = (next: QuickLink[]) => {
		setLinks(next)
		saveQuickLinks(chrome.storage.local, next)
	}
	const markOnboarding = (done: boolean) => {
		setOnboardingDone(done)
		saveOnboardingDone(chrome.storage.local, done)
	}

	return (
		<div className="wx-newtab-page relative min-h-screen w-full overflow-hidden bg-background text-foreground">
			<div className="wx-marquee-edge" aria-hidden />
			<div className="absolute right-5 top-5 z-20 flex gap-2">
				<SettingsEntry />
			</div>
			<main className="relative z-10 mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-8 px-6 py-16">
				<div data-stagger>
					<BrandHero />
				</div>
				{links && (
					<div data-stagger className="w-full">
						<QuickLinksGrid links={links} onChange={updateLinks} />
					</div>
				)}
				<div data-stagger>
					<OnboardingChecklist done={onboardingDone} onDone={markOnboarding} />
				</div>
			</main>
		</div>
	)
}
