export type QType =
	| 'single'
	| 'multiple'
	| 'judgement'
	| 'completion'
	| 'line'
	| 'fill'
	| 'reader'
	| 'unknown'

export type ContentPart =
	| { type: 'text'; text: string }
	| { type: 'image'; label: string; dataUrl?: string; fallbackUrl?: string }

export interface ChaoxingOption {
	key: string // 回填用：字母 / data 值
	content: ContentPart[]
}

export interface ChaoxingQuestion {
	id: string
	typeCode: number
	type: QType
	stem: ContentPart[]
	options?: ChaoxingOption[]
	blanksCount?: number
	subQuestions?: ChaoxingQuestion[]
	hasImages: boolean
	needsReview: boolean
}

export interface ChaoxingAnswer {
	questionId: string
	type: QType
	selectedOptions?: string[]
	blanks?: string[]
	linePairs?: { leftIndex: number; rightKey: string }[]
	subAnswers?: { subIndex: number; optionKey: string }[]
	confidence?: number
	needsReview: boolean
}
