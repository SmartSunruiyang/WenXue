import { useEffect, useState } from 'react'

import type { ExtConfig } from '@/agent/useAgent'
import { SETTINGS_SECTIONS, SettingsForm, type SettingsSectionId } from '@/components/SettingsForm'
import { Logo } from '@/components/misc'
import { loadStoredConfig, saveStoredConfig } from '@/lib/configStorage'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

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
			<header className="border-b bg-background/95 backdrop-blur">
				<div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
					<div className="flex min-w-0 items-center gap-3">
						<Logo className="size-8" />
						<div className="min-w-0">
							<h1 className="truncate text-lg font-semibold">{t('settingsPageTitle')}</h1>
							<p className="truncate text-xs text-muted-foreground">{t('settingsPageSubtitle')}</p>
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

			<div className="mx-auto grid max-w-6xl gap-6 px-5 py-6 md:grid-cols-[220px_minmax(0,1fr)]">
				<aside className="md:sticky md:top-6 md:self-start">
					<nav className="flex gap-2 overflow-x-auto border-b pb-3 md:flex-col md:overflow-visible md:border-b-0 md:pb-0">
						{SETTINGS_SECTIONS.map((section) => (
							<SettingsSectionTab
								key={section.id}
								active={activeSection === section.id}
								title={t(section.labelKey)}
								description={t(section.descriptionKey)}
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
	description,
	onClick,
}: {
	active: boolean
	title: string
	description: string
	onClick: () => void
}) {
	return (
		<button
			type="button"
			aria-current={active ? 'page' : undefined}
			onClick={onClick}
			className={cn(
				'group relative h-auto shrink-0 cursor-pointer overflow-hidden rounded-md border px-3 py-2 text-left text-xs transition-all duration-200',
				'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
				active
					? 'border-primary/35 bg-primary/10 text-foreground shadow-sm'
					: 'border-transparent text-muted-foreground hover:border-border hover:bg-muted/55 hover:text-foreground',
			)}
		>
			<span
				className={cn(
					'pointer-events-none absolute inset-x-2 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent transition-transform duration-300',
					active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100',
				)}
			/>
			<span
				className={cn(
					'pointer-events-none absolute top-2 right-2 size-1.5 rounded-full bg-primary transition-all duration-300',
					active
						? 'scale-100 opacity-80'
						: 'scale-0 opacity-0 group-hover:scale-75 group-hover:opacity-50',
				)}
			/>
			<span className="flex min-w-0 flex-col items-start gap-0.5">
				<span className="truncate font-medium">{title}</span>
				<span className="hidden whitespace-normal text-[10px] font-normal leading-4 text-muted-foreground md:block">
					{description}
				</span>
			</span>
		</button>
	)
}
