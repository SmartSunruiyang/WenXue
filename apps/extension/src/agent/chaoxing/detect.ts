export interface ChaoxingDetection {
	isChaoxing: boolean
	mode: 'work' | 'exam' | null
}

export function detectChaoxing(doc: Document = document, url = location.href): ChaoxingDetection {
	const host = new URL(url).hostname
	const hostOk = /(^|\.)chaoxing\.com$/.test(host)
	const hasQuestions = !!doc.querySelector('.questionLi')
	if (!hostOk || !hasQuestions) return { isChaoxing: false, mode: null }
	const mode = doc.querySelector('input[name^="type"]')
		? 'exam'
		: doc.querySelector('input[id^="answertype"]')
			? 'work'
			: null
	return { isChaoxing: true, mode }
}
