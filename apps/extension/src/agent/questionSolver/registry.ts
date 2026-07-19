import type { AdapterRef, QuestionPlatformAdapter } from './contracts'
import { assertProductionVariantCoverage, assertValidAdapterManifests } from './manifest'

export class QuestionAdapterRegistry {
	readonly adapters: readonly QuestionPlatformAdapter[]
	private readonly byVariant = new Map<string, QuestionPlatformAdapter>()

	constructor(
		adapters: readonly QuestionPlatformAdapter[],
		options: { requireProductionCoverage?: boolean } = {},
	) {
		assertValidAdapterManifests(adapters)
		if (options.requireProductionCoverage) assertProductionVariantCoverage(adapters)
		this.adapters = [...adapters]
		for (const adapter of adapters) this.byVariant.set(adapter.manifest.ref.variant, adapter)
	}

	getByVariant(variant: string): QuestionPlatformAdapter | undefined {
		return this.byVariant.get(variant)
	}

	require(ref: AdapterRef): QuestionPlatformAdapter {
		const adapter = this.byVariant.get(ref.variant)
		if (!adapter || !sameRef(adapter.manifest.ref, ref)) {
			throw new Error(
				`Question adapter is unavailable: ${ref.platform}/${ref.variant}@${ref.version}`,
			)
		}
		return adapter
	}

	forPlatform(platform: string): readonly QuestionPlatformAdapter[] {
		return this.adapters.filter((adapter) => adapter.manifest.ref.platform === platform)
	}
}

function sameRef(left: AdapterRef, right: AdapterRef): boolean {
	return (
		left.platform === right.platform &&
		left.variant === right.variant &&
		left.version === right.version
	)
}
