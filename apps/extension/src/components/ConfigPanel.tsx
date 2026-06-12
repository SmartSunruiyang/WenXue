import type { ExtConfig } from '@/agent/useAgent'
import { SettingsForm } from '@/components/SettingsForm'

interface ConfigPanelProps {
	config: ExtConfig | null
	onSave: (config: ExtConfig) => Promise<void>
	onClose: () => void
}

export function ConfigPanel({ config, onSave, onClose }: ConfigPanelProps) {
	return <SettingsForm config={config} onSave={onSave} onClose={onClose} mode="panel" />
}
