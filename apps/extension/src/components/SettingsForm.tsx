import {
	ArrowUpRight,
	Check,
	CornerUpLeft,
	Eye,
	EyeOff,
	FoldVertical,
	Home,
	Plus,
	Trash2,
	UnfoldVertical,
	X,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { siGithub } from 'simple-icons'

import type { ExtConfig, LanguagePreference } from '@/agent/useAgent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MagicSelect, type MagicSelectOption } from '@/components/ui/magic-select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { TranslationKey, UILanguage } from '@/lib/i18n'
import { useI18n } from '@/lib/i18n'
import {
	BUILT_IN_MODEL_ID,
	BUILT_IN_MODEL_OPTIONS,
	BUILT_IN_VISION_MODEL_ID,
	BUILT_IN_VISION_MODEL_OPTIONS,
	type CustomModelConfig,
	MODEL_PROVIDER_PRESETS,
	type ModelProvider,
	getCustomModelLabel,
	getCustomModelProviderLabel,
	getModelProviderPreset,
	normalizeCustomModelBaseUrl,
	normalizeSelectedModelId,
	normalizeVisionModelId,
} from '@/lib/modelConfig'
import { buildSettingsConfig, settingsConfigKey } from '@/lib/settingsConfig'
import { cn } from '@/lib/utils'

import './SettingsForm.css'

export const SETTINGS_SECTIONS = [
	{
		id: 'model',
		labelKey: 'settingsSectionModel',
		descriptionKey: 'settingsSectionModelDesc',
	},
	{
		id: 'language',
		labelKey: 'settingsSectionLanguage',
		descriptionKey: 'settingsSectionLanguageDesc',
	},
	{
		id: 'advanced',
		labelKey: 'settingsSectionAdvanced',
		descriptionKey: 'settingsSectionAdvancedDesc',
	},
	{
		id: 'logs',
		labelKey: 'settingsSectionLogs',
		descriptionKey: 'settingsSectionLogsDesc',
	},
	{
		id: 'about',
		labelKey: 'settingsSectionAbout',
		descriptionKey: 'settingsSectionAboutDesc',
	},
] as const satisfies ReadonlyArray<{
	id: string
	labelKey: TranslationKey
	descriptionKey: TranslationKey
}>

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']
export const SETTINGS_PAGE_VERSION = __DISPLAY_VERSION__
export const WENXUE_WEBSITE_URL = 'https://wenxue-d8gz76tacc3659f05-1427406869.tcloudbaseapp.com/'
export const WENXUE_GITHUB_URL = 'https://github.com/SmartSunruiyang/WenXue'

export type SettingsSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface SettingsFormProps {
	config: ExtConfig | null
	onSave: (config: ExtConfig) => Promise<void>
	onClose?: () => void
	mode?: 'panel' | 'page'
	onSaved?: () => void
	onSaveStatusChange?: (status: SettingsSaveStatus) => void
}

function createCustomModelId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `custom:${crypto.randomUUID()}`
	}
	return `custom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function ProviderLogo({
	provider,
	providerName,
	className,
}: {
	provider: ModelProvider
	providerName?: string
	className?: string
}) {
	const label =
		provider === 'deepseek'
			? 'D'
			: provider === 'qwen'
				? '千'
				: (providerName?.trim().slice(0, 1).toUpperCase() ?? '自')

	return (
		<span className={cn('settings-provider-logo', className)} aria-hidden="true">
			{label || '自'}
		</span>
	)
}

export function SettingsForm({
	config,
	onSave,
	onClose,
	mode = 'panel',
	onSaved,
	onSaveStatusChange,
}: SettingsFormProps) {
	const { t, setLang } = useI18n()
	const [selectedModelId, setSelectedModelId] = useState(
		config?.selectedModelId ?? BUILT_IN_MODEL_ID,
	)
	const [customModels, setCustomModels] = useState<CustomModelConfig[]>(config?.customModels ?? [])
	const [visionModelId, setVisionModelId] = useState(() =>
		normalizeVisionModelId(config?.visionModelId, config?.customModels ?? []),
	)
	const [language, setLanguage] = useState<LanguagePreference>(config?.language)
	const [uiLanguage, setUILanguage] = useState<UILanguage>(config?.uiLanguage ?? 'zh-CN')
	const [systemInstruction, setSystemInstruction] = useState(config?.systemInstruction ?? '')
	const [experimentalLlmsTxt, setExperimentalLlmsTxt] = useState(
		config?.experimentalLlmsTxt ?? false,
	)
	const [experimentalIncludeAllTabs, setExperimentalIncludeAllTabs] = useState(
		config?.experimentalIncludeAllTabs ?? true,
	)
	const [logRetentionDays, setLogRetentionDays] = useState(config?.logRetentionDays ?? 3)
	const [logMaxEntries, setLogMaxEntries] = useState(config?.logMaxEntries ?? 5000)
	const [advancedOpen, setAdvancedOpen] = useState(mode === 'page')
	const [modelDialogOpen, setModelDialogOpen] = useState(false)
	const [draftProvider, setDraftProvider] = useState<ModelProvider>('deepseek')
	const [draftProviderName, setDraftProviderName] = useState('')
	const [draftBaseURL, setDraftBaseURL] = useState(
		getModelProviderPreset('deepseek')?.baseURL ?? '',
	)
	const [draftApiKey, setDraftApiKey] = useState('')
	const [draftModel, setDraftModel] = useState('')
	const [showDraftApiKey, setShowDraftApiKey] = useState(false)
	const [ready, setReady] = useState(false)
	const isPage = mode === 'page'
	const hydratedRef = useRef(false)
	const lastSavedKeyRef = useRef<string | null>(null)
	const pendingSavesRef = useRef(0)
	const modelDialogRef = useRef<HTMLDivElement>(null)
	const dialogTriggerRef = useRef<HTMLElement | null>(null)
	const [saveStatus, setSaveStatus] = useState<SettingsSaveStatus>('idle')
	const [saveAttempt, setSaveAttempt] = useState(0)

	useEffect(() => {
		if (!config || hydratedRef.current) return

		const nextCustomModels = config.customModels ?? []
		const nextSelectedModelId = normalizeSelectedModelId(
			config.selectedModelId ?? BUILT_IN_MODEL_ID,
			nextCustomModels,
		)
		const nextVisionModelId = normalizeVisionModelId(config.visionModelId, nextCustomModels)
		const nextLanguage = config.language
		const nextUILanguage = config.uiLanguage ?? 'zh-CN'
		const nextSystemInstruction = config.systemInstruction ?? ''
		const nextExperimentalLlmsTxt = config.experimentalLlmsTxt ?? false
		const nextExperimentalIncludeAllTabs = config.experimentalIncludeAllTabs ?? true

		hydratedRef.current = true
		lastSavedKeyRef.current = settingsConfigKey(
			buildSettingsConfig({
				selectedModelId: nextSelectedModelId,
				customModels: nextCustomModels,
				visionModelId: nextVisionModelId,
				language: nextLanguage,
				uiLanguage: nextUILanguage,
				systemInstruction: nextSystemInstruction,
				experimentalLlmsTxt: nextExperimentalLlmsTxt,
				experimentalIncludeAllTabs: nextExperimentalIncludeAllTabs,
				logRetentionDays,
				logMaxEntries,
			}),
		)

		setSelectedModelId(nextSelectedModelId)
		setCustomModels(nextCustomModels)
		setVisionModelId(nextVisionModelId)
		setLanguage(nextLanguage)
		setUILanguage(nextUILanguage)
		setSystemInstruction(nextSystemInstruction)
		setExperimentalLlmsTxt(nextExperimentalLlmsTxt)
		setExperimentalIncludeAllTabs(nextExperimentalIncludeAllTabs)
		setReady(true)
	}, [config])

	const resetModelDraft = useCallback(() => {
		const preset = getModelProviderPreset('deepseek') ?? MODEL_PROVIDER_PRESETS[0]
		setDraftProvider(preset.id)
		setDraftProviderName('')
		setDraftBaseURL(preset.baseURL)
		setDraftApiKey('')
		setDraftModel('')
		setShowDraftApiKey(false)
	}, [])

	const openModelDialog = useCallback(() => {
		dialogTriggerRef.current = document.activeElement as HTMLElement | null
		resetModelDraft()
		setModelDialogOpen(true)
	}, [resetModelDraft])

	const closeModelDialog = useCallback(() => {
		setModelDialogOpen(false)
		resetModelDraft()
	}, [resetModelDraft])

	useEffect(() => {
		if (!modelDialogOpen) return

		const dialog = modelDialogRef.current
		if (!dialog) return
		const previousOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		dialog.querySelector<HTMLElement>('[role="combobox"]')?.focus()

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				if (dialog.querySelector('[role="combobox"][aria-expanded="true"]')) return
				event.preventDefault()
				closeModelDialog()
			}
			if (event.key !== 'Tab') return
			const controls = Array.from(
				dialog.querySelectorAll<HTMLElement>(':is(button, input, [tabindex]):not(:disabled)'),
			).filter((element) => element.tabIndex >= 0 && !element.closest('[hidden]'))
			const first = controls[0]
			const last = controls.at(-1)
			if (!first || !last) return
			if (
				event.shiftKey &&
				(document.activeElement === first || !dialog.contains(document.activeElement))
			) {
				event.preventDefault()
				last.focus()
			} else if (
				!event.shiftKey &&
				(document.activeElement === last || !dialog.contains(document.activeElement))
			) {
				event.preventDefault()
				first.focus()
			}
		}

		window.addEventListener('keydown', handleKeyDown)
		return () => {
			document.body.style.overflow = previousOverflow
			window.removeEventListener('keydown', handleKeyDown)
			dialogTriggerRef.current?.focus()
		}
	}, [closeModelDialog, modelDialogOpen])

	useEffect(() => {
		onSaveStatusChange?.(saveStatus)
	}, [onSaveStatusChange, saveStatus])

	const handleDraftProviderChange = (provider: ModelProvider) => {
		const preset = getModelProviderPreset(provider)
		setDraftProvider(provider)
		setDraftProviderName('')
		setDraftBaseURL(preset?.baseURL ?? '')
	}

	const handleAddCustomModel = () => {
		const baseURL = normalizeCustomModelBaseUrl(draftBaseURL)
		const apiKey = draftApiKey.trim()
		const model = draftModel.trim()
		const providerName = draftProvider === 'custom' ? draftProviderName.trim() : undefined
		if (!baseURL || !apiKey || !model || (draftProvider === 'custom' && !providerName)) return

		const newModel: CustomModelConfig = {
			id: createCustomModelId(),
			provider: draftProvider,
			providerName,
			baseURL,
			apiKey,
			model,
		}

		setCustomModels((models) => [...models, newModel])
		setSelectedModelId(newModel.id)
		closeModelDialog()
	}

	const handleRemoveCustomModel = (modelId: string) => {
		setCustomModels((models) => models.filter((model) => model.id !== modelId))
		setSelectedModelId((current) => (current === modelId ? BUILT_IN_MODEL_ID : current))
		// vision selector pointing at the removed model falls back to the vision built-in
		setVisionModelId((current) => (current === modelId ? BUILT_IN_VISION_MODEL_ID : current))
	}

	const canAddCustomModel =
		normalizeCustomModelBaseUrl(draftBaseURL) !== null &&
		draftApiKey.trim().length > 0 &&
		draftModel.trim().length > 0 &&
		(draftProvider !== 'custom' || draftProviderName.trim().length > 0)

	const customModelOptions = useMemo<Array<MagicSelectOption<string>>>(
		() =>
			customModels.map((customModel) => ({
				value: customModel.id,
				label: getCustomModelLabel(customModel),
				description: customModel.baseURL,
				icon: (
					<ProviderLogo provider={customModel.provider} providerName={customModel.providerName} />
				),
			})),
		[customModels],
	)
	const modelOptions = useMemo<Array<MagicSelectOption<string>>>(
		() => [
			...BUILT_IN_MODEL_OPTIONS.map((option) => ({ value: option.id, label: option.label })),
			...customModelOptions,
		],
		[customModelOptions],
	)
	const visionModelOptions = useMemo<Array<MagicSelectOption<string>>>(
		() => [
			...BUILT_IN_VISION_MODEL_OPTIONS.map((option) => ({
				value: option.id,
				label: option.label,
			})),
			...customModelOptions,
		],
		[customModelOptions],
	)
	const providerOptions = useMemo<Array<MagicSelectOption<ModelProvider>>>(
		() => [
			...MODEL_PROVIDER_PRESETS.map((provider) => ({
				value: provider.id,
				label: provider.label,
				description: provider.baseURL,
				icon: <ProviderLogo provider={provider.id} />,
			})),
			{
				value: 'custom',
				label: t('customProvider'),
				description: t('customProviderDesc'),
				icon: <ProviderLogo provider="custom" />,
			},
		],
		[t],
	)
	const uiLanguageOptions = useMemo<Array<MagicSelectOption<UILanguage>>>(
		() => [
			{ value: 'zh-CN', label: '中文' },
			{ value: 'en-US', label: 'English' },
		],
		[],
	)
	const responseLanguageOptions = useMemo<Array<MagicSelectOption<string>>>(
		() => [
			{ value: '', label: t('langSystem') },
			{ value: 'en-US', label: t('langEnglish') },
			{ value: 'zh-CN', label: t('langChinese') },
		],
		[t],
	)

	const currentConfig = useMemo(
		() =>
			buildSettingsConfig({
				selectedModelId,
				customModels,
				visionModelId,
				language,
				uiLanguage,
				systemInstruction,
				experimentalLlmsTxt,
				experimentalIncludeAllTabs,
				logRetentionDays,
				logMaxEntries,
			}),
		[
			selectedModelId,
			customModels,
			visionModelId,
			language,
			uiLanguage,
			systemInstruction,
			experimentalLlmsTxt,
			experimentalIncludeAllTabs,
			logRetentionDays,
			logMaxEntries,
		],
	)
	const currentConfigKey = useMemo(() => settingsConfigKey(currentConfig), [currentConfig])
	const latestConfigKeyRef = useRef(currentConfigKey)
	latestConfigKeyRef.current = currentConfigKey

	useEffect(() => {
		if (!ready || !hydratedRef.current || !config) return
		if (lastSavedKeyRef.current === currentConfigKey) {
			if (pendingSavesRef.current === 0) {
				setSaveStatus((status) => (status === 'idle' ? status : 'saved'))
			}
			return
		}

		let stale = false
		setSaveStatus('saving')
		const timer = window.setTimeout(() => {
			setLang(uiLanguage)
			pendingSavesRef.current++
			onSave(currentConfig)
				.then(() => {
					lastSavedKeyRef.current = currentConfigKey
					if (stale) return
					onSaved?.()
				})
				.catch((error) => {
					console.error('[SettingsForm] Failed to auto-save settings:', error)
					if (!stale) setSaveStatus('error')
				})
				.finally(() => {
					pendingSavesRef.current--
					if (
						pendingSavesRef.current === 0 &&
						lastSavedKeyRef.current === latestConfigKeyRef.current
					) {
						setSaveStatus('saved')
					}
				})
		}, 500)

		return () => {
			stale = true
			window.clearTimeout(timer)
		}
	}, [
		config,
		currentConfig,
		currentConfigKey,
		onSave,
		onSaved,
		ready,
		setLang,
		uiLanguage,
		saveAttempt,
	])

	return (
		<div className={cn('settings-form', isPage ? 'settings-form--page' : 'settings-form--panel')}>
			<div className="settings-form-content" inert={modelDialogOpen || undefined}>
				{!isPage && (
					<header className="settings-panel-header">
						<div>
							<h2>{t('settings')}</h2>
							<p role="status" aria-live="polite">
								{saveStatus === 'saving'
									? t('settingsSaving')
									: saveStatus === 'saved'
										? t('settingsSaved')
										: t('settingsAutoSave')}
							</p>
						</div>
						{onClose && (
							<Button
								variant="ghost"
								size="icon"
								onClick={onClose}
								aria-label={t('back')}
								title={t('back')}
							>
								<CornerUpLeft className="size-4" />
							</Button>
						)}
					</header>
				)}
				{saveStatus === 'error' && (
					<div className="settings-save-error" role="alert">
						<p>{t('settingsSaveError')}</p>
						<Button variant="outline" onClick={() => setSaveAttempt((attempt) => attempt + 1)}>
							{t('settingsRetrySave')}
						</Button>
					</div>
				)}

				<SettingsSection
					id="model"
					title={t('settingsSectionModel')}
					description={t('settingsSectionModelDesc')}
				>
					<SettingRow label={t('defaultModel')} htmlFor="default-model">
						<MagicSelect
							id="default-model"
							value={selectedModelId}
							options={modelOptions}
							onChange={setSelectedModelId}
						/>
					</SettingRow>
					<SettingRow label={t('visionModel')} htmlFor="vision-model">
						<MagicSelect
							id="vision-model"
							value={visionModelId}
							options={visionModelOptions}
							onChange={setVisionModelId}
						/>
					</SettingRow>

					<div className="settings-custom-models">
						<div className="settings-models-header">
							<div>
								<h3>{t('customModels')}</h3>
								<p>{t('customModelsDesc')}</p>
							</div>
							<Button type="button" onClick={openModelDialog} aria-label={t('addCustomModel')}>
								<Plus className="size-4" />
								<span>{t('addCustomModel')}</span>
							</Button>
						</div>
						{customModels.length > 0 ? (
							<ul className="settings-model-list" aria-label={t('customModels')}>
								{customModels.map((customModel) => (
									<li key={customModel.id} className="settings-model-row">
										<ProviderLogo
											provider={customModel.provider}
											providerName={customModel.providerName}
											className="settings-model-avatar"
										/>
										<div className="settings-model-info">
											<div className="settings-model-name">
												<span title={customModel.model}>{customModel.model}</span>
												{selectedModelId === customModel.id && (
													<span className="settings-model-selected">
														<Check className="size-3" aria-hidden="true" />
														{t('selectedModel')}
													</span>
												)}
											</div>
											<p>
												{getCustomModelProviderLabel(customModel)}
												<span aria-hidden="true"> · </span>
												{customModel.apiKey ? t('modelApiKeySet') : t('modelApiKeyMissing')}
											</p>
											<p className="settings-model-url" title={customModel.baseURL}>
												{customModel.baseURL}
											</p>
										</div>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											className="settings-remove-model"
											onClick={() => handleRemoveCustomModel(customModel.id)}
											aria-label={`${t('removeModel')} ${customModel.model}`}
											title={t('removeModel')}
										>
											<Trash2 className="size-4" />
										</Button>
									</li>
								))}
							</ul>
						) : (
							<p className="settings-model-empty">{t('noCustomModels')}</p>
						)}
					</div>
				</SettingsSection>

				<SettingsSection
					id="language"
					title={t('settingsSectionLanguage')}
					description={t('settingsSectionLanguageDesc')}
				>
					<SettingRow label={t('uiLanguageLabel')} htmlFor="ui-language">
						<MagicSelect
							id="ui-language"
							value={uiLanguage}
							options={uiLanguageOptions}
							onChange={setUILanguage}
						/>
					</SettingRow>
					<SettingRow label={t('responseLanguage')} htmlFor="response-language">
						<MagicSelect
							id="response-language"
							value={language ?? ''}
							options={responseLanguageOptions}
							onChange={(nextLanguage) =>
								setLanguage((nextLanguage || undefined) as LanguagePreference)
							}
						/>
					</SettingRow>
				</SettingsSection>

				<SettingsSection
					id="advanced"
					title={t('settingsSectionAdvanced')}
					description={t('settingsSectionAdvancedDesc')}
				>
					{!isPage && (
						<button
							type="button"
							onClick={() => setAdvancedOpen(!advancedOpen)}
							className="settings-advanced-toggle"
							aria-expanded={advancedOpen}
							aria-controls="advanced-fields"
						>
							{t('advanced')}
							{advancedOpen ? (
								<FoldVertical className="size-4" />
							) : (
								<UnfoldVertical className="size-4" />
							)}
						</button>
					)}
					{advancedOpen && (
						<div id="advanced-fields">
							<div className="settings-instruction-field">
								<label htmlFor="system-instruction">{t('systemInstruction')}</label>
								<Textarea
									id="system-instruction"
									placeholder={t('systemInstructionPlaceholder')}
									value={systemInstruction}
									onChange={(event) => setSystemInstruction(event.target.value)}
									rows={4}
								/>
							</div>
							<SettingRow
								label={t('experimentalLlmsTxt')}
								htmlFor="experimental-llms-txt"
								description={t('experimentalLlmsTxtHelp')}
								compact
							>
								<Switch
									id="experimental-llms-txt"
									checked={experimentalLlmsTxt}
									onCheckedChange={setExperimentalLlmsTxt}
								/>
							</SettingRow>
							<SettingRow
								label={t('experimentalIncludeAllTabs')}
								htmlFor="experimental-all-tabs"
								compact
							>
								<Switch
									id="experimental-all-tabs"
									checked={experimentalIncludeAllTabs}
									onCheckedChange={setExperimentalIncludeAllTabs}
								/>
							</SettingRow>
						</div>
					)}
				</SettingsSection>

				<SettingsSection
					id="logs"
					title={t('settingsSectionLogs')}
					description={t('settingsSectionLogsDesc')}
				>
					<SettingRow label={t('logRetentionDays')} htmlFor="log-retention-days">
						<Input
							id="log-retention-days"
							type="number"
							min={1}
							max={365}
							value={logRetentionDays}
							onChange={(event) => setLogRetentionDays(Number(event.target.value) || 3)}
						/>
					</SettingRow>
					<SettingRow label={t('logMaxEntries')} htmlFor="log-max-entries">
						<Input
							id="log-max-entries"
							type="number"
							min={100}
							max={100000}
							value={logMaxEntries}
							onChange={(event) => setLogMaxEntries(Number(event.target.value) || 5000)}
						/>
					</SettingRow>
				</SettingsSection>

				<SettingsSection
					id="about"
					title={t('settingsSectionAbout')}
					description={t('settingsSectionAboutDesc')}
				>
					<div className="settings-about-version">
						<span>{t('version')}</span>
						<span>{SETTINGS_PAGE_VERSION}</span>
					</div>
					<a
						href={WENXUE_GITHUB_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="settings-about-link"
					>
						<svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden="true">
							<path d={siGithub.path} />
						</svg>
						<span>{t('sourceCode')}</span>
						<ArrowUpRight className="size-4" aria-hidden="true" />
					</a>
					<a
						href={WENXUE_WEBSITE_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="settings-about-link"
					>
						<Home className="size-4" aria-hidden="true" />
						<span>{t('homePage')}</span>
						<ArrowUpRight className="size-4" aria-hidden="true" />
					</a>
				</SettingsSection>
			</div>

			{modelDialogOpen && (
				<div
					className="settings-dialog-overlay"
					onMouseDown={(event) => {
						if (event.currentTarget === event.target) closeModelDialog()
					}}
				>
					<div
						ref={modelDialogRef}
						role="dialog"
						aria-modal="true"
						aria-labelledby="custom-model-dialog-title"
						aria-describedby="custom-model-dialog-description"
						className="settings-model-dialog"
					>
						<header className="settings-dialog-header">
							<div>
								<h2 id="custom-model-dialog-title">{t('addCustomModel')}</h2>
								<p id="custom-model-dialog-description">{t('addCustomModelDesc')}</p>
							</div>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								onClick={closeModelDialog}
								aria-label={t('close')}
								title={t('close')}
							>
								<X className="size-4" />
							</Button>
						</header>
						<form
							onSubmit={(event) => {
								event.preventDefault()
								if (canAddCustomModel) handleAddCustomModel()
							}}
						>
							<div className="settings-dialog-fields">
								<div className="settings-dialog-field">
									<label htmlFor="custom-model-provider">{t('provider')}</label>
									<MagicSelect
										id="custom-model-provider"
										value={draftProvider}
										options={providerOptions}
										onChange={handleDraftProviderChange}
									/>
								</div>
								{draftProvider === 'custom' && (
									<div className="settings-dialog-field">
										<label htmlFor="custom-provider-name">{t('customProviderName')}</label>
										<Input
											id="custom-provider-name"
											value={draftProviderName}
											onChange={(event) => setDraftProviderName(event.target.value)}
											placeholder={t('customProviderNamePlaceholder')}
											autoComplete="off"
										/>
									</div>
								)}
								<div className="settings-dialog-field">
									<label htmlFor="custom-model-url">{t('customModelUrl')}</label>
									<Input
										id="custom-model-url"
										value={draftBaseURL}
										onChange={(event) => setDraftBaseURL(event.target.value)}
										autoComplete="url"
										spellCheck={false}
									/>
								</div>
								<div className="settings-dialog-field">
									<label htmlFor="custom-model-api-key">{t('customModelApiKey')}</label>
									<div className="settings-secret-field">
										<Input
											id="custom-model-api-key"
											type={showDraftApiKey ? 'text' : 'password'}
											value={draftApiKey}
											onChange={(event) => setDraftApiKey(event.target.value)}
											autoComplete="off"
											spellCheck={false}
										/>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											onClick={() => setShowDraftApiKey(!showDraftApiKey)}
											aria-label={showDraftApiKey ? t('hideApiKey') : t('showApiKey')}
											title={showDraftApiKey ? t('hideApiKey') : t('showApiKey')}
										>
											{showDraftApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
										</Button>
									</div>
								</div>
								<div className="settings-dialog-field">
									<label htmlFor="custom-model-name">{t('customModelName')}</label>
									<Input
										id="custom-model-name"
										value={draftModel}
										onChange={(event) => setDraftModel(event.target.value)}
										placeholder={t('customModelNamePlaceholder')}
										autoComplete="off"
										spellCheck={false}
									/>
								</div>
							</div>
							<footer className="settings-dialog-footer">
								<Button type="button" variant="outline" onClick={closeModelDialog}>
									{t('cancel')}
								</Button>
								<Button type="submit" disabled={!canAddCustomModel}>
									<Plus className="size-4" />
									{t('add')}
								</Button>
							</footer>
						</form>
					</div>
				</div>
			)}
		</div>
	)
}

function SettingRow({
	label,
	htmlFor,
	description,
	compact,
	children,
}: {
	label: string
	htmlFor: string
	description?: string
	compact?: boolean
	children: ReactNode
}) {
	return (
		<div className={cn('settings-field-row', compact && 'settings-field-row--compact')}>
			<div className="settings-field-copy">
				<label htmlFor={htmlFor}>{label}</label>
				{description && <p>{description}</p>}
			</div>
			<div className="settings-field-control">{children}</div>
		</div>
	)
}

function SettingsSection({
	id,
	title,
	description,
	children,
}: {
	id: SettingsSectionId
	title: string
	description: string
	children: ReactNode
}) {
	return (
		<section id={id} className="settings-section" aria-labelledby={`${id}-title`}>
			<header className="settings-section-heading">
				<h2 id={`${id}-title`}>{title}</h2>
				<p>{description}</p>
			</header>
			<div className="settings-section-body">{children}</div>
		</section>
	)
}
