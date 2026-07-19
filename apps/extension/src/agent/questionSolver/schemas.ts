import * as z from 'zod/v4'

import {
	QUESTION_OUTCOME_STATUSES,
	QUESTION_SOLVER_ACTIONS,
	QUESTION_SOLVER_SCOPES,
	QUESTION_TYPES,
} from './contracts'

const DATA_IMAGE_PATTERN = /data:image\/[a-z0-9.+-]+;base64,/i
const LONG_BASE64_PATTERN = /(?:[a-z0-9+/]{1024,}={0,2})/i

export const safePublicText = (maximum: number) =>
	z
		.string()
		.max(maximum)
		.refine((value) => !DATA_IMAGE_PATTERN.test(value), 'Image data URLs are not public wire data.')
		.refine(
			(value) => !LONG_BASE64_PATTERN.test(value),
			'Long base64 payloads are not public wire data.',
		)

export const questionSolverCapabilitySchema = z
	.object({
		name: z.literal('question_solver'),
		action: z.enum(QUESTION_SOLVER_ACTIONS),
		scope: z.enum(QUESTION_SOLVER_SCOPES),
		continuationToken: z.string().min(16).max(256).optional(),
		resumeToken: z.string().min(16).max(256).optional(),
	})
	.strict()
	.refine((value) => !(value.continuationToken && value.resumeToken), {
		message: 'continuationToken and resumeToken are mutually exclusive.',
	})

export const questionSolverInputSchema = z
	.object({
		mode: z.literal('capability'),
		reason: safePublicText(2_000).min(1),
		capability: questionSolverCapabilitySchema,
	})
	.strict()

export const imageAssetRefSchema = z
	.object({
		assetId: z.string().min(16).max(256),
		runId: z.string().min(1).max(256),
		questionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
		sha256: z.string().regex(/^[a-f0-9]{64}$/),
		mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
		width: z.number().int().positive().max(16_384),
		height: z.number().int().positive().max(16_384),
		byteLength: z
			.number()
			.int()
			.positive()
			.max(2 * 1024 * 1024),
	})
	.strict()

const answerEvidenceSchema = z
	.object({
		source: z.enum(['embedded_answer', 'visible_solution', 'llm_text', 'llm_vision']),
		questionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
		attemptId: safePublicText(256).optional(),
		sourceRefHash: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.optional(),
		mappingConfidence: z.number().min(0).max(1),
		modelConfidence: z.number().min(0).max(1).optional(),
		warnings: z.array(safePublicText(200)).max(32),
	})
	.strict()

export const structuredAnswerSchema: z.ZodType<unknown> = z.lazy(() =>
	z
		.object({
			questionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
			type: z.enum(QUESTION_TYPES),
			selectedOptions: z.array(safePublicText(100)).max(32).optional(),
			blanks: z
				.array(z.object({ key: safePublicText(100), value: safePublicText(2_000) }).strict())
				.max(64)
				.optional(),
			dropdowns: z
				.array(z.object({ key: safePublicText(100), optionKey: safePublicText(100) }).strict())
				.max(64)
				.optional(),
			linePairs: z
				.array(z.object({ leftKey: safePublicText(100), rightKey: safePublicText(100) }).strict())
				.max(64)
				.optional(),
			subAnswers: z.array(structuredAnswerSchema).max(64).optional(),
			evidence: answerEvidenceSchema,
		})
		.strict(),
)

const wireContentPartSchema = z.discriminatedUnion('kind', [
	z
		.object({ kind: z.literal('text'), text: safePublicText(1_000), truncated: z.boolean() })
		.strict(),
	z
		.object({
			kind: z.literal('image'),
			label: safePublicText(300),
			resolution: z.enum(['inline', 'screenshot', 'failed']),
			requiredForAnswer: z.boolean(),
		})
		.strict(),
])

const wireQuestionViewSchema = z
	.object({
		stem: z.array(wireContentPartSchema).max(128),
		material: z.array(wireContentPartSchema).max(128).optional(),
		options: z
			.array(
				z
					.object({ key: safePublicText(100), content: z.array(wireContentPartSchema).max(128) })
					.strict(),
			)
			.max(32),
		blankKeys: z.array(safePublicText(100)).max(64).optional(),
		subQuestionPaths: z.array(safePublicText(200)).max(64).optional(),
	})
	.strict()

const wireAnswerPartSchema = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal('choice'),
			questionPath: safePublicText(200),
			selectedOptionKeys: z.array(safePublicText(100)).max(32),
		})
		.strict(),
	z
		.object({
			kind: z.literal('text'),
			questionPath: safePublicText(200),
			values: z
				.array(z.object({ blankKey: safePublicText(100), value: safePublicText(2_000) }).strict())
				.max(64),
		})
		.strict(),
	z
		.object({
			kind: z.literal('dropdown'),
			questionPath: safePublicText(200),
			values: z
				.array(z.object({ blankKey: safePublicText(100), optionKey: safePublicText(100) }).strict())
				.max(64),
		})
		.strict(),
	z
		.object({
			kind: z.literal('line'),
			questionPath: safePublicText(200),
			pairs: z
				.array(z.object({ leftKey: safePublicText(100), rightKey: safePublicText(100) }).strict())
				.max(64),
		})
		.strict(),
])

const adapterRefSchema = z
	.object({
		platform: safePublicText(100),
		variant: safePublicText(200),
		version: z.number().int().positive(),
	})
	.strict()

const wireEvidenceSchema = z
	.object({
		source: z.enum(['embedded_answer', 'visible_solution', 'llm_text', 'llm_vision']),
		sourceRefHash: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.optional(),
		mappingConfidence: z.number().min(0).max(1),
		modelConfidence: z.number().min(0).max(1).optional(),
		warningCodes: z.array(safePublicText(200)).max(32),
	})
	.strict()

const wireProblemSchema = z
	.object({
		code: safePublicText(200),
		stage: z.enum([
			'detect',
			'extract',
			'embedded',
			'image',
			'model',
			'fill',
			'verify',
			'navigation',
			'interrupt',
			'privacy',
		]),
		message: safePublicText(2_000),
		retryable: z.boolean(),
		requiresReview: z.boolean(),
	})
	.strict()

export const questionOutcomeSummarySchema = z
	.object({
		adapter: adapterRefSchema,
		questionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
		pageOrdinal: z.number().int().positive(),
		questionOrdinal: safePublicText(100),
		type: z.enum(QUESTION_TYPES),
		status: z.enum(QUESTION_OUTCOME_STATUSES),
		question: wireQuestionViewSchema,
		answer: z
			.object({ parts: z.array(wireAnswerPartSchema).max(128) })
			.strict()
			.optional(),
		evidence: wireEvidenceSchema.optional(),
		pageEffect: z.enum([
			'none',
			'already_exact',
			'written_and_verified',
			'restored',
			'possibly_modified',
		]),
		problem: wireProblemSchema.optional(),
		warningCodes: z.array(safePublicText(200)).max(32),
	})
	.strict()

const countsSchema = z
	.object({
		pages: z.number().int().nonnegative(),
		discovered: z.number().int().nonnegative(),
		inspected: z.number().int().nonnegative(),
		answered: z.number().int().nonnegative(),
		answeredNotFilled: z.number().int().nonnegative(),
		filledVerified: z.number().int().nonnegative(),
		needsReviewNotFilled: z.number().int().nonnegative(),
		fillFailed: z.number().int().nonnegative(),
		filledUnverified: z.number().int().nonnegative(),
		skipped: z.number().int().nonnegative(),
	})
	.strict()

export const questionSolverResultSchema = z
	.object({
		mode: z.literal('capability'),
		capability: z.literal('question_solver'),
		action: z.enum(QUESTION_SOLVER_ACTIONS),
		scope: z.enum(QUESTION_SOLVER_SCOPES),
		status: z.enum(['completed', 'partial', 'blocked', 'failed']),
		executionStatus: z.enum(['completed', 'partial', 'blocked', 'failed']),
		platform: safePublicText(100),
		adapters: z
			.array(
				z
					.object({
						ref: adapterRefSchema,
						maturity: z.enum(['implemented', 'fixture_verified', 'live_verified']),
						pages: z.number().int().nonnegative(),
					})
					.strict(),
			)
			.max(32),
		counts: countsSchema,
		questions: z.array(questionOutcomeSummarySchema).max(2_000),
		delivery: z
			.object({
				chunkIndex: z.number().int().nonnegative(),
				hasMore: z.boolean(),
				remainingQuestionCount: z.number().int().nonnegative(),
				continuationToken: z.string().min(16).max(256).optional(),
			})
			.strict(),
		resumeToken: z.string().min(16).max(256).optional(),
		blocker: z
			.object({
				code: safePublicText(200),
				message: safePublicText(2_000),
				requiresTakeover: z.boolean(),
			})
			.strict()
			.optional(),
		finalSubmissionPerformed: z.literal(false),
	})
	.strict()

export function assertPublicWireBudget(value: unknown, maximum = 96 * 1024): void {
	const serialized = JSON.stringify(value)
	if (serialized.length > maximum) throw new Error('question_solver_result_too_large')
	if (DATA_IMAGE_PATTERN.test(serialized) || LONG_BASE64_PATTERN.test(serialized)) {
		throw new Error('question_solver_private_image_payload_rejected')
	}
}
