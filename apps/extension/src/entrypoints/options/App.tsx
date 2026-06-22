import { useEffect, useState } from 'react'

import type { ExtConfig } from '@/agent/useAgent'
import { SETTINGS_SECTIONS, SettingsForm, type SettingsSectionId } from '@/components/SettingsForm'
import { Logo } from '@/components/misc'
import { loadStoredConfig, saveStoredConfig } from '@/lib/configStorage'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export { SETTINGS_PAGE_VERSION } from '@/components/SettingsForm'

interface ActiveSectionInput {
	sectionTops: ReadonlyArray<readonly [SettingsSectionId, number]>
	viewportHeight: number
	scrollY: number
	documentHeight: number
}

export function resolveActiveSettingsSection({
	sectionTops,
	viewportHeight,
	scrollY,
	documentHeight,
}: ActiveSectionInput): SettingsSectionId {
	const lastSection = SETTINGS_SECTIONS.at(-1)?.id ?? 'account'
	const lastSectionTop = sectionTops.at(-1)?.[1]
	if (
		lastSectionTop !== undefined &&
		scrollY + viewportHeight >= documentHeight - 2 &&
		lastSectionTop <= viewportHeight * 0.65
	) {
		return lastSection
	}

	const focusLine = Math.min(220, Math.max(120, viewportHeight * 0.28))
	let activeSection: SettingsSectionId = SETTINGS_SECTIONS[0].id

	for (const [sectionId, top] of sectionTops) {
		if (top > focusLine) break
		activeSection = sectionId
	}

	return activeSection
}

export default function App() {
	const { t } = useI18n()
	const [config, setConfig] = useState<ExtConfig | null>(null)
	const [activeSection, setActiveSection] = useState<SettingsSectionId>('account')
	const [saved, setSaved] = useState(false)

	useEffect(() => {
		loadStoredConfig()
			.then(setConfig)
			.catch((error) => {
				console.error('[Options] Failed to load config:', error)
			})
	}, [])

	useEffect(() => {
		if (!config) return

		let frame = 0
		const updateActiveSection = () => {
			frame = 0
			const sectionTops = SETTINGS_SECTIONS.flatMap((section) => {
				const element = document.getElementById(section.id)
				return element ? ([[section.id, element.getBoundingClientRect().top]] as const) : []
			})

			if (sectionTops.length === 0) return
			setActiveSection(
				resolveActiveSettingsSection({
					sectionTops,
					viewportHeight: window.innerHeight,
					scrollY: window.scrollY,
					documentHeight: document.documentElement.scrollHeight,
				}),
			)
		}
		const scheduleUpdate = () => {
			if (frame) return
			frame = window.requestAnimationFrame(updateActiveSection)
		}

		scheduleUpdate()
		window.addEventListener('scroll', scheduleUpdate, { passive: true })
		window.addEventListener('resize', scheduleUpdate)

		return () => {
			if (frame) window.cancelAnimationFrame(frame)
			window.removeEventListener('scroll', scheduleUpdate)
			window.removeEventListener('resize', scheduleUpdate)
		}
	}, [config])

	const handleAutoSave = async (nextConfig: ExtConfig) => {
		setConfig(await saveStoredConfig(chrome.storage.local, nextConfig))
	}

	const handleSaved = () => {
		setSaved(true)
		window.setTimeout(() => setSaved(false), 1800)
	}

	const scrollToSection = (sectionId: SettingsSectionId) => {
		setActiveSection(sectionId)
		document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
	}

	return (
		<div className="min-h-screen bg-background text-foreground">
			<header className="sticky top-0 z-30 border-b bg-background/92 backdrop-blur-md">
				<div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5">
					<div className="flex min-w-0 items-center gap-3">
						<Logo className="size-9" />
						<div className="min-w-0">
							<h1 className="truncate text-lg font-semibold">{t('settingsPageTitle')}</h1>
							<p className="truncate text-sm text-muted-foreground">{t('settingsPageSubtitle')}</p>
						</div>
					</div>
					<div
						role="status"
						aria-live="polite"
						className={cn(
							'text-xs text-muted-foreground transition-opacity',
							saved ? 'opacity-100' : 'opacity-0',
						)}
					>
						{t('settingsSaved')}
					</div>
				</div>
			</header>

			<div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-10 px-6 py-8 md:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">
				<aside className="min-w-0 md:sticky md:top-28 md:self-start">
					<nav className="flex min-w-0 max-w-full gap-1.5 overflow-x-auto border-b pb-3 md:flex-col md:overflow-visible md:rounded-md md:border md:bg-muted/20 md:p-1.5">
						{SETTINGS_SECTIONS.map((section) => (
							<SettingsSectionTab
								key={section.id}
								active={activeSection === section.id}
								title={t(section.labelKey)}
								onClick={() => scrollToSection(section.id)}
							/>
						))}
					</nav>
				</aside>

				<main className="min-w-0">
					{config ? (
						<SettingsForm
							config={config}
							onSave={handleAutoSave}
							mode="page"
							onSaved={handleSaved}
						/>
					) : (
						<div className="py-12 text-sm text-muted-foreground">{t('loading')}</div>
					)}
				</main>
			</div>
		</div>
	)
}

function SettingsSectionTab({
	active,
	title,
	onClick,
}: {
	active: boolean
	title: string
	onClick: () => void
}) {
	return (
		<button
			type="button"
			aria-current={active ? 'page' : undefined}
			onClick={onClick}
			className={cn(
				'group relative h-10 shrink-0 cursor-pointer overflow-hidden rounded-sm border border-transparent px-3 text-left text-sm transition-colors duration-200',
				'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
				active
					? 'bg-background text-foreground shadow-xs'
					: 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
			)}
		>
			<span
				className={cn(
					'pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary transition-opacity duration-200',
					active ? 'opacity-100' : 'opacity-0',
				)}
			/>
			<span className="truncate font-medium">{title}</span>
		</button>
	)
}
