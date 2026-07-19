import { QuestionAdapterRegistry } from '../registry'
import { createChaoxingAdapters } from './chaoxing'
import { createGenericQuestionAdapter } from './generic'
import { createIcourseAdapters } from './icourse'
import type { DomAdapterEnvironment } from './sharedDom'
import { createUnipusAdapters } from './unipus'
import { createVocationalAdapters } from './vocational'
import { createZhihuishuAdapters } from './zhihuishu'

export function createQuestionSolverAdapterRegistry(
	environment: Partial<DomAdapterEnvironment> = {},
): QuestionAdapterRegistry {
	return new QuestionAdapterRegistry(
		[
			...createChaoxingAdapters(environment),
			...createZhihuishuAdapters(environment),
			...createVocationalAdapters(environment),
			...createIcourseAdapters(environment),
			...createUnipusAdapters(environment),
			createGenericQuestionAdapter(environment),
		],
		{ requireProductionCoverage: true },
	)
}

export { createChaoxingAdapters } from './chaoxing'
export { createGenericQuestionAdapter } from './generic'
export { createIcourseAdapters } from './icourse'
export { createUnipusAdapters } from './unipus'
export { createVocationalAdapters } from './vocational'
export { createZhihuishuAdapters } from './zhihuishu'
