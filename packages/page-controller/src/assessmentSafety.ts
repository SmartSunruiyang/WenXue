export type AssessmentAutomationAction = 'click' | 'input'

/**
 * Runtime backstop for actions that the Agent must hand to the user. The
 * question-solver has stricter capability routing; this guard also prevents a
 * generic indexed action from bypassing that boundary.
 */
export function assessmentAutomationBlockReason(
	element: HTMLElement,
	action: AssessmentAutomationAction,
): 'protected_challenge' | 'login_secret' | 'final_assessment_submission' | undefined {
	if (hasProtectedChallengeSemantics(element)) return 'protected_challenge'
	if (action === 'input' && isLoginSecret(element)) return 'login_secret'
	if (action === 'click' && isFinalAssessmentSubmission(element)) {
		return 'final_assessment_submission'
	}
	return undefined
}

function hasProtectedChallengeSemantics(element: HTMLElement): boolean {
	for (let current: HTMLElement | null = element; current; current = current.parentElement) {
		const semantics = semanticText(current)
		if (
			/(?:captcha|yidun|slider.?captcha|slide.?verify|face.?recogn|two.?factor|one.?time.?code|anti.?abuse|验证码|滑块验证|人脸识别|二次验证|易盾)/i.test(
				semantics,
			)
		) {
			return true
		}
	}
	return false
}

function isLoginSecret(element: HTMLElement): boolean {
	if (element instanceof HTMLInputElement && element.type.toLowerCase() === 'password') return true
	const semantics = semanticText(element)
	return /(?:autocomplete.?one-time-code|\botp\b|短信验证码|登录密码|login.?password)/i.test(
		semantics,
	)
}

function isFinalAssessmentSubmission(element: HTMLElement): boolean {
	const assessmentContext = isAssessmentDocument(element.ownerDocument)
	for (let current: HTMLElement | null = element; current; current = current.parentElement) {
		if (
			current !== element &&
			!current.matches('button,input,a,[role="button"],[data-action],[onclick],form')
		) {
			continue
		}
		if (current.hasAttribute('data-final-submit')) return true
		if (hasFinalActionSemantics(current)) return true
		const semantics = semanticText(current)
		if (
			/(?:交\s*卷|提\s*交\s*(?:试\s*卷|考\s*试|作\s*业|答\s*卷|测\s*验|答\s*案)|结\s*束\s*答\s*题|完\s*成\s*(?:考\s*试|作\s*业|测\s*验|答\s*题)|确\s*认\s*提\s*交(?:\s*(?:试\s*卷|考\s*试|作\s*业|答\s*卷|测\s*验))?|confirm.?submit|hand\s*in(?:\s*(?:exam|test|quiz|assignment))?|submit\s*(?:exam|test|quiz|assignment)|finish\s*(?:exam|test|quiz|assignment)|complete\s*(?:exam|test|quiz|assignment))/i.test(
				semantics,
			)
		) {
			return true
		}
		if (assessmentContext && /(?:^|\s)(?:提\s*交|submit)(?:\s|$)/i.test(semantics)) return true
	}
	return false
}

function hasFinalActionSemantics(element: HTMLElement): boolean {
	const associatedForm =
		element instanceof HTMLButtonElement || element instanceof HTMLInputElement
			? element.form
			: element.closest('form')
	if (
		associatedForm &&
		((element instanceof HTMLButtonElement && element.type === 'submit') ||
			(element instanceof HTMLInputElement && ['submit', 'image'].includes(element.type)))
	) {
		return true
	}
	const actionText = [
		element.getAttribute('href'),
		element.getAttribute('action'),
		element.getAttribute('formaction'),
		element.getAttribute('data-action'),
		element.getAttribute('onclick'),
		associatedForm?.getAttribute('action'),
	]
		.filter((value): value is string => typeof value === 'string')
		.join(' ')
	return /(?:submit|hand.?in|finish|complete|(?:^|[\s/_.?&#=-])(?:done|end|final)(?:$|[\s/_.?&#=()-])|提\s*交|交\s*卷|完\s*成|结\s*束)/i.test(
		actionText,
	)
}

function isAssessmentDocument(doc: Document): boolean {
	if (
		doc.querySelector(
			[
				'[data-question]',
				'[data-question-type]',
				'.questionLi',
				'.TiMu',
				'.examPaper_subject',
				'.questionBox',
				'.questionContent',
				'.question-area-content',
				'.exam-item',
				'.q_main',
				'.question-item',
				'.subjectDet',
				'.q_content',
				'.content-item',
				'.u-questionItem',
				'[class*="questionBody"]',
				'.question-common-abs-reply',
				'.question-common-abs-choice',
				'.question-material-banked-cloze-reply',
				'.question-wrap',
				'.layout-reply-container',
				'.question:has(input[type="radio"],input[type="checkbox"],input[type="text"],textarea,select)',
				'fieldset:has(input[type="radio"],input[type="checkbox"],input[type="text"],textarea,select)',
				'[class*="assessment"]',
				'[class*="quiz"]',
				'[class*="exam"]',
			].join(','),
		)
	) {
		return true
	}
	return /(?:^|[/_-])(?:assessment|quiz|exam|homework|work|test)(?:[/_?&#=-]|$)/i.test(
		doc.location.href,
	)
}

function semanticText(element: HTMLElement): string {
	return [
		element.textContent,
		element.id,
		element.className,
		element.getAttribute('name'),
		element.getAttribute('type'),
		element.getAttribute('autocomplete'),
		element.getAttribute('aria-label'),
		element.getAttribute('title'),
		element.getAttribute('placeholder'),
		element.getAttribute('data-action'),
		element.getAttribute('onclick'),
		element.getAttribute('href'),
		element.getAttribute('action'),
		element.getAttribute('formaction'),
		element.getAttribute('value'),
	]
		.filter((value): value is string => typeof value === 'string')
		.join(' ')
}
