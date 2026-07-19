import type {
	EmbeddedAnswerCandidate,
	Question,
	QuestionOption,
	StructuredAnswer,
} from './contracts'

const HASH_PATTERN = /^[a-f0-9]{64}$/

export interface EmbeddedMappingOptions {
	attemptRefHash?: string
	paperVersionRefHash?: string
}

export type EmbeddedAnswerResolution =
	| { status: 'accepted'; answer: StructuredAnswer; warningCodes: string[] }
	| { status: 'none' | 'rejected' | 'conflict'; warningCodes: string[] }

export type EmbeddedFirstResolution<T> =
	| { source: 'embedded'; answer: StructuredAnswer; mapping: EmbeddedAnswerResolution }
	| { source: 'fallback'; result: T; mapping: EmbeddedAnswerResolution }

interface CandidateMapping {
	answer: StructuredAnswer
	warningCodes: string[]
	sourcePriority: number
}

interface CandidateFailure {
	code: string
	conflict?: boolean
}

export function mapEmbeddedAnswerCandidates(
	question: Question,
	candidates: EmbeddedAnswerCandidate[],
	options: EmbeddedMappingOptions = {},
): EmbeddedAnswerResolution {
	if (
		(question.type === 'fill' || question.type === 'reader') &&
		question.subQuestions &&
		question.subQuestions.length > 0
	) {
		return mapCompositeAnswer(question, candidates, options)
	}

	const relevant = candidates.filter((candidate) =>
		candidateCouldTargetQuestion(candidate, question),
	)
	if (relevant.length === 0) return { status: 'none', warningCodes: [] }

	const accepted: CandidateMapping[] = []
	const rejectedCodes: string[] = []
	for (const candidate of relevant) {
		const result = mapCandidate(question, candidate, options)
		if ('answer' in result) accepted.push(result)
		else rejectedCodes.push(result.code)
	}
	if (accepted.length === 0) {
		return { status: 'rejected', warningCodes: unique(rejectedCodes) }
	}

	const expected = canonicalAnswer(accepted[0].answer)
	if (accepted.some((mapping) => canonicalAnswer(mapping.answer) !== expected)) {
		return {
			status: 'conflict',
			warningCodes: unique([...rejectedCodes, 'embedded_sources_conflict']),
		}
	}

	accepted.sort((left, right) => left.sourcePriority - right.sourcePriority)
	const selected = accepted[0]
	return {
		status: 'accepted',
		answer: selected.answer,
		warningCodes: unique([...selected.warningCodes, ...rejectedCodes]),
	}
}

export async function resolveEmbeddedFirst<T>(
	question: Question,
	candidates: EmbeddedAnswerCandidate[],
	options: EmbeddedMappingOptions,
	fallback: () => Promise<T>,
): Promise<EmbeddedFirstResolution<T>> {
	const mapping = mapEmbeddedAnswerCandidates(question, candidates, options)
	if (mapping.status === 'accepted') {
		return { source: 'embedded', answer: mapping.answer, mapping }
	}
	return { source: 'fallback', result: await fallback(), mapping }
}

function mapCompositeAnswer(
	question: Question,
	candidates: EmbeddedAnswerCandidate[],
	options: EmbeddedMappingOptions,
): EmbeddedAnswerResolution {
	const subAnswers: StructuredAnswer[] = []
	const warningCodes: string[] = []
	let missing = false
	for (const subQuestion of question.subQuestions ?? []) {
		const resolution = mapEmbeddedAnswerCandidates(subQuestion, candidates, options)
		warningCodes.push(...resolution.warningCodes)
		if (resolution.status === 'conflict') {
			return {
				status: 'conflict',
				warningCodes: unique([...warningCodes, 'embedded_composite_conflict']),
			}
		}
		if (resolution.status !== 'accepted') {
			missing = true
			continue
		}
		subAnswers.push(resolution.answer)
	}
	if (missing || subAnswers.length !== question.subQuestions?.length) {
		return {
			status: subAnswers.length === 0 ? 'none' : 'rejected',
			warningCodes: unique([...warningCodes, 'embedded_composite_incomplete']),
		}
	}

	const mappingConfidence = Math.min(
		...subAnswers.map((answer) => answer.evidence.mappingConfidence),
	)
	const allVisible = subAnswers.every((answer) => answer.evidence.source === 'visible_solution')
	return {
		status: 'accepted',
		warningCodes: unique([...warningCodes, 'embedded_composite']),
		answer: {
			questionFingerprint: question.locator.fingerprint,
			type: question.type,
			subAnswers,
			evidence: {
				source: allVisible ? 'visible_solution' : 'embedded_answer',
				questionFingerprint: question.locator.fingerprint,
				attemptId: question.locator.attemptId,
				mappingConfidence,
				warnings: ['embedded_composite'],
			},
		},
	}
}

function mapCandidate(
	question: Question,
	candidate: EmbeddedAnswerCandidate,
	options: EmbeddedMappingOptions,
): CandidateMapping | CandidateFailure {
	if (!HASH_PATTERN.test(candidate.sourceRefHash)) return { code: 'embedded_source_ref_invalid' }
	if (candidate.type !== question.type) return { code: 'embedded_type_mismatch' }

	const identityFailure = verifyQuestionIdentity(question, candidate)
	if (identityFailure) return identityFailure
	const attempt = verifyOptionalBinding(
		options.attemptRefHash,
		candidate.attemptRefHash,
		'embedded_attempt_mismatch',
		'embedded_attempt_unverifiable',
	)
	if (attempt.failure) return { code: attempt.failure }
	const paper = verifyOptionalBinding(
		options.paperVersionRefHash,
		candidate.paperVersionRefHash,
		'embedded_paper_version_mismatch',
		'embedded_paper_version_unverifiable',
	)
	if (paper.failure) return { code: paper.failure }

	const mappingConfidence = attempt.missing || paper.missing ? 0.9 : 1
	const warningCodes = [
		...(attempt.missing ? ['embedded_attempt_missing'] : []),
		...(paper.missing ? ['embedded_paper_version_missing'] : []),
	]
	const evidence = {
		source:
			candidate.source === 'visible_solution'
				? ('visible_solution' as const)
				: ('embedded_answer' as const),
		questionFingerprint: question.locator.fingerprint,
		attemptId: question.locator.attemptId,
		sourceRefHash: candidate.sourceRefHash,
		mappingConfidence,
		warnings: [...warningCodes],
	}

	let answer: StructuredAnswer | CandidateFailure
	switch (question.type) {
		case 'single':
		case 'multiple':
		case 'judgement': {
			if (candidate.blankValues || candidate.linePairs) {
				return { code: 'embedded_answer_shape_mismatch' }
			}
			const selected = mapSelectedOptions(question, candidate)
			if ('code' in selected) return selected
			const expectedCount = question.type === 'multiple' ? undefined : 1
			if (
				selected.length === 0 ||
				(expectedCount !== undefined && selected.length !== expectedCount)
			) {
				return { code: 'embedded_choice_count_mismatch' }
			}
			answer = {
				questionFingerprint: question.locator.fingerprint,
				type: question.type,
				selectedOptions: selected,
				evidence,
			}
			break
		}
		case 'completion':
		case 'fill':
		case 'translation': {
			if (
				candidate.selectedPlatformOptionIds ||
				candidate.selectedStableKeys ||
				candidate.linePairs
			) {
				return { code: 'embedded_answer_shape_mismatch' }
			}
			const blanks = mapBlankValues(question, candidate)
			if ('code' in blanks) return blanks
			answer = {
				questionFingerprint: question.locator.fingerprint,
				type: question.type,
				blanks,
				evidence,
			}
			break
		}
		case 'dropdown': {
			if (
				candidate.selectedPlatformOptionIds ||
				candidate.selectedStableKeys ||
				candidate.linePairs
			) {
				return { code: 'embedded_answer_shape_mismatch' }
			}
			const dropdowns = mapDropdownValues(question, candidate)
			if ('code' in dropdowns) return dropdowns
			answer = {
				questionFingerprint: question.locator.fingerprint,
				type: question.type,
				dropdowns,
				evidence,
			}
			break
		}
		case 'line': {
			if (
				candidate.selectedPlatformOptionIds ||
				candidate.selectedStableKeys ||
				candidate.blankValues
			) {
				return { code: 'embedded_answer_shape_mismatch' }
			}
			const linePairs = mapLinePairs(question, candidate)
			if ('code' in linePairs) return linePairs
			answer = {
				questionFingerprint: question.locator.fingerprint,
				type: question.type,
				linePairs,
				evidence,
			}
			break
		}
		case 'reader':
		case 'unknown':
		default:
			return { code: 'embedded_type_unsupported' }
	}

	return {
		answer,
		warningCodes,
		sourcePriority: sourcePriority(candidate.source),
	}
}

function verifyQuestionIdentity(
	question: Question,
	candidate: EmbeddedAnswerCandidate,
): CandidateFailure | undefined {
	const currentPlatformId = question.locator.platformQuestionId
	if (
		candidate.platformQuestionId !== undefined &&
		currentPlatformId !== undefined &&
		candidate.platformQuestionId !== currentPlatformId
	) {
		return { code: 'embedded_question_id_mismatch' }
	}
	if (
		candidate.questionFingerprint !== undefined &&
		candidate.questionFingerprint !== question.locator.fingerprint
	) {
		return { code: 'embedded_question_fingerprint_mismatch' }
	}
	const platformIdMatched =
		candidate.platformQuestionId !== undefined &&
		currentPlatformId !== undefined &&
		candidate.platformQuestionId === currentPlatformId
	const fingerprintMatched = candidate.questionFingerprint === question.locator.fingerprint
	if (!platformIdMatched && !fingerprintMatched)
		return { code: 'embedded_question_identity_missing' }
	return undefined
}

function verifyOptionalBinding(
	expected: string | undefined,
	actual: string | undefined,
	mismatchCode: string,
	unverifiableCode: string,
): { missing: boolean; failure?: string } {
	if (expected !== undefined && !HASH_PATTERN.test(expected))
		return { missing: false, failure: unverifiableCode }
	if (actual !== undefined && !HASH_PATTERN.test(actual))
		return { missing: false, failure: unverifiableCode }
	if (expected !== undefined && actual !== undefined) {
		return expected === actual ? { missing: false } : { missing: false, failure: mismatchCode }
	}
	if (expected === undefined && actual !== undefined) {
		return { missing: false, failure: unverifiableCode }
	}
	return { missing: true }
}

function candidateCouldTargetQuestion(
	candidate: EmbeddedAnswerCandidate,
	question: Question,
): boolean {
	const platformIdMatched =
		candidate.platformQuestionId !== undefined &&
		question.locator.platformQuestionId !== undefined &&
		candidate.platformQuestionId === question.locator.platformQuestionId
	const fingerprintMatched = candidate.questionFingerprint === question.locator.fingerprint
	return platformIdMatched || fingerprintMatched
}

function mapSelectedOptions(
	question: Question,
	candidate: EmbeddedAnswerCandidate,
): string[] | CandidateFailure {
	let fromPlatformIds: string[] | undefined
	if (candidate.selectedPlatformOptionIds) {
		fromPlatformIds = []
		for (const platformId of candidate.selectedPlatformOptionIds) {
			const matches = question.options.filter((option) => option.platformId === platformId)
			if (matches.length !== 1) return { code: 'embedded_platform_option_unmapped' }
			fromPlatformIds.push(matches[0].key)
		}
	}

	let fromStableKeys: string[] | undefined
	if (candidate.selectedStableKeys) {
		const optionKeys = new Set(question.options.map((option) => option.key))
		if (candidate.selectedStableKeys.some((key) => !optionKeys.has(key))) {
			return { code: 'embedded_stable_option_unmapped' }
		}
		fromStableKeys = [...candidate.selectedStableKeys]
	}
	if (!fromPlatformIds && !fromStableKeys) return { code: 'embedded_choice_missing' }
	if (
		fromPlatformIds &&
		fromStableKeys &&
		canonicalKeys(fromPlatformIds) !== canonicalKeys(fromStableKeys)
	) {
		return { code: 'embedded_option_mapping_conflict' }
	}
	const selected = fromPlatformIds ?? fromStableKeys!
	if (new Set(selected).size !== selected.length) return { code: 'embedded_option_duplicate' }
	const optionOrder = question.options.map((option) => option.key)
	return [...selected].sort((left, right) => optionOrder.indexOf(left) - optionOrder.indexOf(right))
}

function mapBlankValues(
	question: Question,
	candidate: EmbeddedAnswerCandidate,
): Array<{ key: string; value: string }> | CandidateFailure {
	const keys = question.blanks?.map((blank) => blank.key) ?? []
	const values = candidate.blankValues
	if (keys.length === 0 || !values || values.length !== keys.length) {
		return { code: 'embedded_blank_count_mismatch' }
	}
	const keyedCount = values.filter((value) => value.blankKey !== undefined).length
	if (keyedCount !== 0 && keyedCount !== values.length)
		return { code: 'embedded_blank_mapping_mixed' }
	if (keyedCount === 0) {
		return values.map((value, index) => ({ key: keys[index], value: value.value }))
	}
	const byKey = new Map(values.map((value) => [value.blankKey!, value.value]))
	if (byKey.size !== keys.length || keys.some((key) => !byKey.has(key))) {
		return { code: 'embedded_blank_key_mismatch' }
	}
	return keys.map((key) => ({ key, value: byKey.get(key)! }))
}

function mapDropdownValues(
	question: Question,
	candidate: EmbeddedAnswerCandidate,
): Array<{ key: string; optionKey: string }> | CandidateFailure {
	const blanks = mapBlankValues(question, candidate)
	if ('code' in blanks) return blanks
	const mapped: Array<{ key: string; optionKey: string }> = []
	for (const blank of blanks) {
		const option = mapPlatformOrStableOption(question.options, blank.value)
		if (!option) return { code: 'embedded_dropdown_option_unmapped' }
		mapped.push({ key: blank.key, optionKey: option.key })
	}
	return mapped
}

function mapLinePairs(
	question: Question,
	candidate: EmbeddedAnswerCandidate,
): Array<{ leftKey: string; rightKey: string }> | CandidateFailure {
	const subs = question.subQuestions ?? []
	const pairs = candidate.linePairs
	if (subs.length === 0 || !pairs || pairs.length !== subs.length) {
		return { code: 'embedded_line_count_mismatch' }
	}
	const mapped: Array<{ leftKey: string; rightKey: string }> = []
	for (const pair of pairs) {
		const leftMatches = subs.filter(
			(subQuestion) => subQuestion.locator.platformQuestionId === pair.leftPlatformId,
		)
		if (leftMatches.length !== 1) return { code: 'embedded_line_left_unmapped' }
		const rightMatches = leftMatches[0].options.filter(
			(option) => option.platformId === pair.rightPlatformId,
		)
		if (rightMatches.length !== 1) return { code: 'embedded_line_right_unmapped' }
		mapped.push({
			leftKey: leftMatches[0].locator.fingerprint,
			rightKey: rightMatches[0].key,
		})
	}
	if (new Set(mapped.map((pair) => pair.leftKey)).size !== subs.length) {
		return { code: 'embedded_line_left_duplicate' }
	}
	const order = subs.map((subQuestion) => subQuestion.locator.fingerprint)
	return mapped.sort((left, right) => order.indexOf(left.leftKey) - order.indexOf(right.leftKey))
}

function mapPlatformOrStableOption(
	options: QuestionOption[],
	value: string,
): QuestionOption | undefined {
	const byPlatformId = options.filter((option) => option.platformId === value)
	if (byPlatformId.length === 1) return byPlatformId[0]
	const byStableKey = options.filter((option) => option.key === value)
	return byStableKey.length === 1 ? byStableKey[0] : undefined
}

function sourcePriority(source: EmbeddedAnswerCandidate['source']): number {
	switch (source) {
		case 'visible_solution':
			return 0
		case 'dom':
			return 1
		case 'runtime':
			return 2
		case 'passive_response':
			return 3
	}
}

function canonicalAnswer(answer: StructuredAnswer): string {
	return JSON.stringify({
		questionFingerprint: answer.questionFingerprint,
		type: answer.type,
		selectedOptions: answer.selectedOptions,
		blanks: answer.blanks,
		dropdowns: answer.dropdowns,
		linePairs: answer.linePairs,
		subAnswers: answer.subAnswers?.map((subAnswer) => JSON.parse(canonicalAnswer(subAnswer))),
	})
}

function canonicalKeys(keys: string[]): string {
	return JSON.stringify([...keys].sort())
}

function unique(values: string[]): string[] {
	return [...new Set(values)]
}
