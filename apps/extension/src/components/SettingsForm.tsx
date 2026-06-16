import {
	Copy,
	CornerUpLeft,
	Eye,
	EyeOff,
	FoldVertical,
	HatGlasses,
	Home,
	Plus,
	Sparkles,
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
	BUILT_IN_MODEL_LABEL,
	type CustomModelConfig,
	MODEL_PROVIDER_PRESETS,
	type ModelProvider,
	getCustomModelLabel,
	getCustomModelProviderLabel,
	getModelProviderPreset,
	normalizeSelectedModelId,
} from '@/lib/modelConfig'
import { buildSettingsConfig, settingsConfigKey } from '@/lib/settingsConfig'
import { cn } from '@/lib/utils'

export const SETTINGS_SECTIONS = [
	{
		id: 'account',
		labelKey: 'settingsSectionAccount',
		descriptionKey: 'settingsSectionAccountDesc',
	},
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

interface SettingsFormProps {
	config: ExtConfig | null
	onSave: (config: ExtConfig) => Promise<void>
	onClose?: () => void
	mode?: 'panel' | 'page'
	onSaved?: () => void
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
		<span
			className={cn(
				'flex size-5 shrink-0 items-center justify-center rounded-sm border text-[10px] font-semibold leading-none shadow-xs',
				provider === 'deepseek' && 'border-cyan-500/25 bg-cyan-500/10 text-cyan-700',
				provider === 'qwen' && 'border-amber-500/25 bg-amber-500/10 text-amber-700',
				provider === 'custom' && 'border-primary/25 bg-primary/10 text-primary',
				className,
			)}
			aria-hidden="true"
		>
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
}: SettingsFormProps) {
	const { t, setLang } = useI18n()
	const [selectedModelId, setSelectedModelId] = useState(
		config?.selectedModelId ?? BUILT_IN_MODEL_ID,
	)
	const [customModels, setCustomModels] = useState<CustomModelConfig[]>(config?.customModels ?? [])
	const [language, setLanguage] = useState<LanguagePreference>(config?.language)
	const [uiLanguage, setUILanguage] = useState<UILanguage>(config?.uiLanguage ?? 'zh-CN')
	const [systemInstruction, setSystemInstruction] = useState(config?.systemInstruction ?? '')
	const [experimentalLlmsTxt, setExperimentalLlmsTxt] = useState(
		config?.experimentalLlmsTxt ?? false,
	)
	const [experimentalIncludeAllTabs, setExperimentalIncludeAllTabs] = useState(
		config?.experimentalIncludeAllTabs ?? false,
	)
	const [disableNamedToolChoice, setDisableNamedToolChoice] = useState(
		config?.disableNamedToolChoice ?? false,
	)
	const [advancedOpen, setAdvancedOpen] = useState(mode === 'page')
	const [userAuthToken, setUserAuthToken] = useState('')
	const [copied, setCopied] = useState(false)
	const [showToken, setShowToken] = useState(false)
	const [modelDialogOpen, setModelDialogOpen] = useState(false)
	const [modelDialogClosing, setModelDialogClosing] = useState(false)
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
	const closeDialogTimerRef = useRef<number | null>(null)

	useEffect(() => {
		if (!config || hydratedRef.current) return

		const nextCustomModels = config.customModels ?? []
		const nextSelectedModelId = normalizeSelectedModelId(
			config.selectedModelId ?? BUILT_IN_MODEL_ID,
			nextCustomModels,
		)
		const nextLanguage = config.language
		const nextUILanguage = config.uiLanguage ?? 'zh-CN'
		const nextSystemInstruction = config.systemInstruction ?? ''
		const nextExperimentalLlmsTxt = config.experimentalLlmsTxt ?? false
		const nextExperimentalIncludeAllTabs = config.experimentalIncludeAllTabs ?? false
		const nextDisableNamedToolChoice = config.disableNamedToolChoice ?? false

		hydratedRef.current = true
		lastSavedKeyRef.current = settingsConfigKey(
			buildSettingsConfig({
				selectedModelId: nextSelectedModelId,
				customModels: nextCustomModels,
				language: nextLanguage,
				uiLanguage: nextUILanguage,
				systemInstruction: nextSystemInstruction,
				experimentalLlmsTxt: nextExperimentalLlmsTxt,
				experimentalIncludeAllTabs: nextExperimentalIncludeAllTabs,
				disableNamedToolChoice: nextDisableNamedToolChoice,
			}),
		)

		setSelectedModelId(nextSelectedModelId)
		setCustomModels(nextCustomModels)
		setLanguage(nextLanguage)
		setUILanguage(nextUILanguage)
		setSystemInstruction(nextSystemInstruction)
		setExperimentalLlmsTxt(nextExperimentalLlmsTxt)
		setExperimentalIncludeAllTabs(nextExperimentalIncludeAllTabs)
		setDisableNamedToolChoice(nextDisableNamedToolChoice)
		setReady(true)
	}, [config])

	useEffect(() => {
		let interval: NodeJS.Timeout | null = null

		const fetchToken = async () => {
			const result = await chrome.storage.local.get('PageAgentExtUserAuthToken')
			const token = result.PageAgentExtUserAuthToken
			if (typeof token === 'string' && token) {
				setUserAuthToken(token)
				if (interval) {
					clearInterval(interval)
					interval = null
				}
			}
		}

		fetchToken()
		interval = setInterval(fetchToken, 1000)

		return () => {
			if (interval) clearInterval(interval)
		}
	}, [])

	const handleCopyToken = async () => {
		if (!userAuthToken) return
		await navigator.clipboard.writeText(userAuthToken)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}

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
		if (closeDialogTimerRef.current) {
			window.clearTimeout(closeDialogTimerRef.current)
			closeDialogTimerRef.current = null
		}
		resetModelDraft()
		setModelDialogClosing(false)
		setModelDialogOpen(true)
	}, [resetModelDraft])

	const closeModelDialog = useCallback(() => {
		if (modelDialogClosing) return
		setModelDialogClosing(true)
		closeDialogTimerRef.current = window.setTimeout(() => {
			setModelDialogOpen(false)
			setModelDialogClosing(false)
			resetModelDraft()
			closeDialogTimerRef.current = null
		}, 180)
	}, [modelDialogClosing, resetModelDraft])

	useEffect(() => {
		return () => {
			if (closeDialogTimerRef.current) {
				window.clearTimeout(closeDialogTimerRef.current)
			}
		}
	}, [])

	useEffect(() => {
		if (!modelDialogOpen) return

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') closeModelDialog()
		}

		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [closeModelDialog, modelDialogOpen])

	const handleDraftProviderChange = (provider: ModelProvider) => {
		const preset = getModelProviderPreset(provider)
		setDraftProvider(provider)
		setDraftProviderName('')
		setDraftBaseURL(preset?.baseURL ?? '')
	}

	const handleAddCustomModel = () => {
		const baseURL = draftBaseURL.trim()
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
	}

	const canAddCustomModel =
		draftBaseURL.trim().length > 0 &&
		draftApiKey.trim().length > 0 &&
		draftModel.trim().length > 0 &&
		(draftProvider !== 'custom' || draftProviderName.trim().length > 0)

	const modelOptions = useMemo<Array<MagicSelectOption<string>>>(
		() => [
			{ value: BUILT_IN_MODEL_ID, label: BUILT_IN_MODEL_LABEL },
			...customModels.map((customModel) => ({
				value: customModel.id,
				label: getCustomModelLabel(customModel),
				description: customModel.baseURL,
				icon: (
					<ProviderLogo provider={customModel.provider} providerName={customModel.providerName} />
				),
			})),
		],
		[customModels],
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
				language,
				uiLanguage,
				systemInstruction,
				experimentalLlmsTxt,
				experimentalIncludeAllTabs,
				disableNamedToolChoice,
			}),
		[
			selectedModelId,
			customModels,
			language,
			uiLanguage,
			systemInstruction,
			experimentalLlmsTxt,
			experimentalIncludeAllTabs,
			disableNamedToolChoice,
		],
	)
	const currentConfigKey = useMemo(() => settingsConfigKey(currentConfig), [currentConfig])

	useEffect(() => {
		if (!ready || !hydratedRef.current || !config) return
		if (lastSavedKeyRef.current === currentConfigKey) return

		const timer = window.setTimeout(() => {
			setLang(uiLanguage)
			onSave(currentConfig)
				.then(() => {
					lastSavedKeyRef.current = currentConfigKey
					onSaved?.()
				})
				.catch((error) => {
					console.error('[SettingsForm] Failed to auto-save settings:', error)
				})
		}, 500)

		return () => window.clearTimeout(timer)
	}, [config, currentConfig, currentConfigKey, onSave, onSaved, ready, setLang, uiLanguage])

	return (
		<div className={cn(isPage ? 'flex flex-col' : 'relative flex flex-col gap-4 p-4')}>
			{!isPage && (
				<div className="flex items-center justify-between">
					<h2 className="text-base font-semibold">{t('settings')}</h2>
					{onClose && (
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={onClose}
							className="absolute top-2 right-3 cursor-pointer"
							aria-label={t('back')}
						>
							<CornerUpLeft className="size-3.5" />
						</Button>
					)}
				</div>
			)}

			<SettingsSection
				id="account"
				title={t('settingsSectionAccount')}
				description={t('settingsSectionAccountDesc')}
				mode={mode}
			>
				<div className="flex flex-col gap-1.5 rounded-md border bg-muted/40 p-3">
					<label htmlFor="user-auth-token" className="text-xs font-medium text-muted-foreground">
						{t('userAuthToken')}
					</label>
					<p className="mb-1 text-[10px] text-muted-foreground">{t('userAuthTokenDesc')}</p>
					<div className="flex items-center gap-2">
						<Input
							id="user-auth-token"
							readOnly
							value={
								userAuthToken
									? showToken
										? userAuthToken
										: `${userAuthToken.slice(0, 4)}${'•'.repeat(userAuthToken.length - 8)}${userAuthToken.slice(-4)}`
									: t('loading')
							}
							className="h-8 bg-background font-mono text-xs"
						/>
						<Button
							variant="outline"
							size="icon"
							className="h-8 w-8 shrink-0 cursor-pointer"
							onClick={() => setShowToken(!showToken)}
							disabled={!userAuthToken}
							aria-label={showToken ? t('hideToken') : t('showToken')}
							aria-pressed={showToken}
						>
							{showToken ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
						</Button>
						<Button
							variant="outline"
							size="icon"
							className="h-8 w-8 shrink-0 cursor-pointer"
							onClick={handleCopyToken}
							disabled={!userAuthToken}
							aria-label={t('copyToken')}
						>
							{copied ? <span className="">✓</span> : <Copy className="size-3" />}
						</Button>
						<span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
							{copied ? t('tokenCopied') : ''}
						</span>
					</div>
				</div>
			</SettingsSection>

			<SettingsSection
				id="model"
				title={t('settingsSectionModel')}
				description={t('settingsSectionModelDesc')}
				mode={mode}
			>
				<div className="grid gap-4">
					<div className="flex flex-col gap-1.5">
						<label htmlFor="default-model" className="text-xs text-muted-foreground">
							{t('defaultModel')}
						</label>
						<MagicSelect
							id="default-model"
							value={selectedModelId}
							options={modelOptions}
							onChange={setSelectedModelId}
						/>
					</div>

					<div className="rounded-md border bg-muted/30 p-3">
						<div className="mb-3 flex items-start justify-between gap-3">
							<div className="grid gap-1">
								<h3 className="text-sm font-medium">{t('customModels')}</h3>
								<p className="text-[11px] leading-4 text-muted-foreground">
									{t('customModelsDesc')}
								</p>
							</div>
							<Button
								type="button"
								variant="outline"
								size="icon-sm"
								onClick={openModelDialog}
								className="shrink-0 cursor-pointer"
								aria-label={t('addCustomModel')}
							>
								<Plus className="size-3.5" />
							</Button>
						</div>

						{customModels.length > 0 ? (
							<div className="grid gap-2">
								{customModels.map((customModel) => (
									<div
										key={customModel.id}
										className="flex items-center justify-between gap-3 rounded-md border bg-background p-2.5"
									>
										<div className="min-w-0">
											<div className="flex min-w-0 items-center gap-2">
												<span className="flex shrink-0 items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
													<ProviderLogo
														provider={customModel.provider}
														providerName={customModel.providerName}
														className="size-4 text-[9px]"
													/>
													{getCustomModelProviderLabel(customModel)}
												</span>
												<span className="truncate text-xs font-medium">{customModel.model}</span>
												{selectedModelId === customModel.id && (
													<span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
														{t('selectedModel')}
													</span>
												)}
											</div>
											<p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
												{customModel.baseURL}
											</p>
											<p className="mt-0.5 text-[10px] text-muted-foreground">
												{customModel.apiKey ? t('modelApiKeySet') : t('modelApiKeyMissing')}
											</p>
										</div>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											className="shrink-0 cursor-pointer text-muted-foreground hover:text-destructive"
											onClick={() => handleRemoveCustomModel(customModel.id)}
											aria-label={t('removeModel')}
										>
											<Trash2 className="size-3.5" />
										</Button>
									</div>
								))}
							</div>
						) : (
							<div className="rounded-md border border-dashed bg-background/70 p-4 text-center text-[11px] leading-5 text-muted-foreground">
								{t('noCustomModels')}
							</div>
						)}
					</div>
				</div>
			</SettingsSection>

			<SettingsSection
				id="language"
				title={t('settingsSectionLanguage')}
				description={t('settingsSectionLanguageDesc')}
				mode={mode}
			>
				<div className="grid gap-4 md:grid-cols-2">
					<div className="flex flex-col gap-1.5">
						<label htmlFor="ui-language" className="text-xs text-muted-foreground">
							{t('uiLanguageLabel')}
						</label>
						<MagicSelect
							id="ui-language"
							value={uiLanguage}
							options={uiLanguageOptions}
							onChange={setUILanguage}
							triggerClassName="h-8"
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<label htmlFor="response-language" className="text-xs text-muted-foreground">
							{t('responseLanguage')}
						</label>
						<MagicSelect
							id="response-language"
							value={language ?? ''}
							options={responseLanguageOptions}
							onChange={(nextLanguage) =>
								setLanguage((nextLanguage || undefined) as LanguagePreference)
							}
							triggerClassName="h-8"
						/>
					</div>
				</div>
			</SettingsSection>

			<SettingsSection
				id="advanced"
				title={t('settingsSectionAdvanced')}
				description={t('settingsSectionAdvancedDesc')}
				mode={mode}
			>
				{!isPage && (
					<button
						type="button"
						onClick={() => setAdvancedOpen(!advancedOpen)}
						className="flex cursor-pointer items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground"
					>
						{t('advanced')}
						{advancedOpen ? (
							<FoldVertical className="size-3" />
						) : (
							<UnfoldVertical className="size-3" />
						)}
					</button>
				)}

				{advancedOpen && (
					<div className="grid gap-4">
						<div className="flex flex-col gap-1.5">
							<label htmlFor="system-instruction" className="text-xs text-muted-foreground">
								{t('systemInstruction')}
							</label>
							<Textarea
								id="system-instruction"
								placeholder={t('systemInstructionPlaceholder')}
								value={systemInstruction}
								onChange={(e) => setSystemInstruction(e.target.value)}
								rows={4}
								className="min-h-[88px] resize-y text-xs"
							/>
						</div>

						<label className="flex cursor-pointer items-center justify-between gap-4">
							<span className="text-xs text-muted-foreground">{t('disableNamedToolChoice')}</span>
							<Switch
								checked={disableNamedToolChoice}
								onCheckedChange={setDisableNamedToolChoice}
							/>
						</label>

						<label className="flex cursor-pointer items-center justify-between gap-4">
							<span className="text-xs text-muted-foreground">{t('experimentalLlmsTxt')}</span>
							<Switch checked={experimentalLlmsTxt} onCheckedChange={setExperimentalLlmsTxt} />
						</label>

						<label className="flex cursor-pointer items-center justify-between gap-4">
							<span className="text-xs text-muted-foreground">
								{t('experimentalIncludeAllTabs')}
							</span>
							<Switch
								checked={experimentalIncludeAllTabs}
								onCheckedChange={setExperimentalIncludeAllTabs}
							/>
						</label>
					</div>
				)}
			</SettingsSection>

			<SettingsSection
				id="about"
				title={t('settingsSectionAbout')}
				description={t('settingsSectionAboutDesc')}
				mode={mode}
			>
				<div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
					<span>
						{t('version')} <span className="font-mono">v{__VERSION__}</span>
					</span>

					<a
						href="https://github.com/alibaba/page-agent"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 hover:text-foreground"
					>
						<svg role="img" viewBox="0 0 24 24" className="size-3 fill-current">
							<path d={siGithub.path} />
						</svg>
						<span>{t('sourceCode')}</span>
					</a>

					<a
						href="https://alibaba.github.io/page-agent/"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 hover:text-foreground"
					>
						<Home className="size-3" />
						<span>{t('homePage')}</span>
					</a>

					<a
						href="https://github.com/alibaba/page-agent/blob/main/docs/terms-and-privacy.md"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 hover:text-foreground"
					>
						<HatGlasses className="size-3" />
						<span>{t('privacy')}</span>
					</a>
				</div>

				<div className="text-[10px] text-muted-foreground">
					{t('builtWith')} ♥️ {t('builtWithSuffix')}{' '}
					<a
						href="https://github.com/gaomeng1900"
						target="_blank"
						rel="noopener noreferrer"
						className="underline hover:text-foreground"
					>
						@Simon
					</a>
				</div>
			</SettingsSection>

			{modelDialogOpen && (
				<div
					className={cn(
						'fixed inset-0 z-50 flex items-end justify-center bg-background/70 p-4 backdrop-blur-sm transition-opacity duration-200 sm:items-center',
						modelDialogClosing ? 'opacity-0' : 'opacity-100',
					)}
					onMouseDown={(event) => {
						if (event.currentTarget === event.target) closeModelDialog()
					}}
				>
					<div
						role="dialog"
						aria-modal="true"
						aria-labelledby="custom-model-dialog-title"
						className={cn(
							'relative w-full max-w-md overflow-hidden rounded-lg border bg-background shadow-2xl transition-all duration-200',
							modelDialogClosing
								? 'translate-y-3 scale-95 opacity-0'
								: 'translate-y-0 scale-100 opacity-100',
						)}
					>
						<div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
						<div className="flex items-start justify-between gap-4 border-b p-4">
							<div className="flex gap-3">
								<div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted">
									<Sparkles className="size-4 text-primary" />
								</div>
								<div className="grid gap-1">
									<h2 id="custom-model-dialog-title" className="text-sm font-semibold">
										{t('addCustomModel')}
									</h2>
									<p className="text-[11px] leading-5 text-muted-foreground">
										{t('addCustomModelDesc')}
									</p>
								</div>
							</div>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								onClick={closeModelDialog}
								className="cursor-pointer"
								aria-label={t('close')}
							>
								<X className="size-3.5" />
							</Button>
						</div>

						<div className="grid gap-3 p-4">
							<div className="flex flex-col gap-1.5">
								<label htmlFor="custom-model-provider" className="text-xs text-muted-foreground">
									{t('provider')}
								</label>
								<MagicSelect
									id="custom-model-provider"
									value={draftProvider}
									options={providerOptions}
									onChange={handleDraftProviderChange}
								/>
							</div>

							{draftProvider === 'custom' && (
								<div className="flex flex-col gap-1.5 transition-all duration-200">
									<label htmlFor="custom-provider-name" className="text-xs text-muted-foreground">
										{t('customProviderName')}
									</label>
									<Input
										id="custom-provider-name"
										value={draftProviderName}
										onChange={(event) => setDraftProviderName(event.target.value)}
										placeholder={t('customProviderNamePlaceholder')}
										className="h-9 text-xs"
									/>
								</div>
							)}

							<div className="flex flex-col gap-1.5">
								<label htmlFor="custom-model-url" className="text-xs text-muted-foreground">
									{t('customModelUrl')}
								</label>
								<Input
									id="custom-model-url"
									value={draftBaseURL}
									onChange={(event) => setDraftBaseURL(event.target.value)}
									className="h-9 font-mono text-xs"
								/>
							</div>

							<div className="flex flex-col gap-1.5">
								<label htmlFor="custom-model-api-key" className="text-xs text-muted-foreground">
									{t('customModelApiKey')}
								</label>
								<div className="flex items-center gap-2">
									<Input
										id="custom-model-api-key"
										type={showDraftApiKey ? 'text' : 'password'}
										value={draftApiKey}
										onChange={(event) => setDraftApiKey(event.target.value)}
										className="h-9 text-xs"
									/>
									<Button
										type="button"
										variant="outline"
										size="icon"
										className="h-9 w-9 shrink-0 cursor-pointer"
										onClick={() => setShowDraftApiKey(!showDraftApiKey)}
										aria-label={showDraftApiKey ? t('hideApiKey') : t('showApiKey')}
									>
										{showDraftApiKey ? (
											<EyeOff className="size-3.5" />
										) : (
											<Eye className="size-3.5" />
										)}
									</Button>
								</div>
							</div>

							<div className="flex flex-col gap-1.5">
								<label htmlFor="custom-model-name" className="text-xs text-muted-foreground">
									{t('customModelName')}
								</label>
								<Input
									id="custom-model-name"
									value={draftModel}
									onChange={(event) => setDraftModel(event.target.value)}
									placeholder={t('customModelNamePlaceholder')}
									className="h-9 text-xs"
								/>
							</div>
						</div>

						<div className="flex justify-end gap-2 border-t p-4">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={closeModelDialog}
								className="cursor-pointer"
							>
								{t('cancel')}
							</Button>
							<Button
								type="button"
								size="sm"
								onClick={handleAddCustomModel}
								disabled={!canAddCustomModel}
								className="cursor-pointer"
							>
								<Plus className="size-3.5" />
								{t('add')}
							</Button>
						</div>
					</div>
				</div>
			)}

			{onClose && <div className="pb-4" />}
		</div>
	)
}

function SettingsSection({
	id,
	title,
	description,
	mode,
	children,
}: {
	id: SettingsSectionId
	title: string
	description: string
	mode: 'panel' | 'page'
	children: ReactNode
}) {
	const isPage = mode === 'page'

	return (
		<section
			id={id}
			className={cn(
				'flex scroll-mt-6 flex-col gap-4',
				isPage ? 'border-b py-6 first:pt-0' : 'gap-3',
			)}
		>
			{isPage && (
				<div className="grid gap-1">
					<h2 className="text-base font-semibold">{title}</h2>
					<p className="max-w-2xl text-xs leading-5 text-muted-foreground">{description}</p>
				</div>
			)}
			{children}
		</section>
	)
}
