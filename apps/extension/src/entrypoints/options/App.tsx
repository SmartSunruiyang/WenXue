import { Check, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ExtConfig } from '@/agent/useAgent'
import {
	SETTINGS_SECTIONS,
	SettingsForm,
	type SettingsSaveStatus,
	type SettingsSectionId,
} from '@/components/SettingsForm'
import { Logo } from '@/components/misc'
import { isConfigStorageChange, loadStoredConfig, saveStoredConfig } from '@/lib/configStorage'
import { useI18n } from '@/lib/i18n'
import { settingsConfigKey } from '@/lib/settingsConfig'
import { cn } from '@/lib/utils'

import './options.css'

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
	const lastSection = SETTINGS_SECTIONS.at(-1)?.id ?? 'model'
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
	const [externalConfigRevision, setExternalConfigRevision] = useState(0)
	const [activeSection, setActiveSection] = useState<SettingsSectionId>('model')
	const [saveStatus, setSaveStatus] = useState<SettingsSaveStatus>('idle')
	const configRef = useRef<ExtConfig | null>(null)
	const reloadVersionRef = useRef(0)
	const pendingLocalSavesRef = useRef(0)
	const reloadAfterSaveRef = useRef(false)
	const scheduleReloadRef = useRef<() => void>(() => {})
	const saveQueueRef = useRef<Promise<void>>(Promise.resolve())

	useEffect(() => {
		let reloadTimer: number | null = null
		let cancelled = false
		const reloadConfig = () => {
			if (pendingLocalSavesRef.current > 0) {
				reloadAfterSaveRef.current = true
				return
			}
			const version = ++reloadVersionRef.current
			loadStoredConfig()
				.then((nextConfig) => {
					if (cancelled || version !== reloadVersionRef.current) return
					if (pendingLocalSavesRef.current > 0) {
						reloadAfterSaveRef.current = true
						return
					}
					const previousConfig = configRef.current
					if (
						previousConfig &&
						settingsConfigKey(previousConfig) !== settingsConfigKey(nextConfig)
					) {
						setExternalConfigRevision((revision) => revision + 1)
					}
					configRef.current = nextConfig
					setConfig(nextConfig)
				})
				.catch((error) => {
					console.error('[Options] Failed to load config:', error)
				})
		}
		const scheduleReload = () => {
			if (pendingLocalSavesRef.current > 0) {
				reloadAfterSaveRef.current = true
				return
			}
			if (reloadTimer !== null) window.clearTimeout(reloadTimer)
			reloadTimer = window.setTimeout(reloadConfig, 50)
		}
		const handleStorageChange = (
			changes: Record<string, chrome.storage.StorageChange>,
			areaName: string,
		) => {
			if (!isConfigStorageChange(changes, areaName)) return
			scheduleReload()
		}

		scheduleReloadRef.current = scheduleReload
		reloadConfig()
		chrome.storage.onChanged.addListener(handleStorageChange)
		return () => {
			cancelled = true
			reloadVersionRef.current++
			if (reloadTimer !== null) window.clearTimeout(reloadTimer)
			chrome.storage.onChanged.removeListener(handleStorageChange)
		}
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

	const handleAutoSave = useCallback(async (nextConfig: ExtConfig) => {
		pendingLocalSavesRef.current++
		reloadVersionRef.current++
		const save = saveQueueRef.current.then(() => saveStoredConfig(chrome.storage.local, nextConfig))
		saveQueueRef.current = save.then(
			() => {},
			() => {},
		)
		try {
			const savedConfig = await save
			configRef.current = savedConfig
			setConfig(savedConfig)
		} finally {
			pendingLocalSavesRef.current--
			if (pendingLocalSavesRef.current === 0 && reloadAfterSaveRef.current) {
				reloadAfterSaveRef.current = false
				scheduleReloadRef.current()
			}
		}
	}, [])

	const scrollToSection = (sectionId: SettingsSectionId) => {
		setActiveSection(sectionId)
		document.getElementById(sectionId)?.scrollIntoView({
			behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
				? 'instant'
				: 'smooth',
			block: 'start',
		})
	}

	return (
		<div className="settings-page">
			<div className="settings-page-layout">
				<aside className="settings-page-sidebar">
					<div className="settings-page-brand" aria-label="WenXue">
						<Logo className="size-8" />
						<span>WenXue</span>
					</div>
					<nav className="settings-page-navigation" aria-label={t('settingsPageTitle')}>
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

				<main className="settings-page-main">
					<header className="settings-page-header">
						<h1>{t('settingsPageTitle')}</h1>
						<p>{t('settingsPageSubtitle')}</p>
						<div className="settings-page-save-status" role="status" aria-live="polite">
							{saveStatus === 'saving' ? (
								<>
									<LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
									{t('settingsSaving')}
								</>
							) : saveStatus === 'saved' ? (
								<>
									<Check className="size-3.5" aria-hidden="true" />
									{t('settingsSaved')}
								</>
							) : saveStatus === 'error' ? (
								t('settingsSaveError')
							) : (
								t('settingsAutoSave')
							)}
						</div>
					</header>
					{config ? (
						<SettingsForm
							key={externalConfigRevision}
							config={config}
							onSave={handleAutoSave}
							mode="page"
							onSaveStatusChange={setSaveStatus}
						/>
					) : (
						<div className="settings-page-loading" role="status">
							{t('loading')}
						</div>
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
			aria-current={active ? 'location' : undefined}
			onClick={onClick}
			className={cn('settings-page-nav-item', active && 'is-active')}
		>
			{title}
		</button>
	)
}
