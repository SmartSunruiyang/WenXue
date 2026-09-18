import { ChevronDown, HelpCircle } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'

interface Props {
	done: boolean
	onDone: (done: boolean) => void
}

export function OnboardingChecklist({ done, onDone }: Props) {
	const { t } = useI18n()
	const [open, setOpen] = useState(!done)
	const steps = [t('ntStep1'), t('ntStep2'), t('ntStep3'), t('ntStep4')]

	const collapse = () => {
		setOpen(false)
		onDone(true)
	}

	return (
		<section className="newtab-onboarding">
			<button
				type="button"
				onClick={() => (open ? collapse() : setOpen(true))}
				className="newtab-onboarding-toggle"
				aria-expanded={open}
				aria-controls="newtab-onboarding-steps"
			>
				<HelpCircle className="size-4" />
				<span>{t('ntOnboardingTitle')}</span>
				<ChevronDown className={`size-4 ${open ? 'rotate-180' : ''}`} />
			</button>
			{open && (
				<div id="newtab-onboarding-steps" className="newtab-onboarding-content">
					<ol>
						{steps.map((step) => (
							<li key={step}>{step}</li>
						))}
					</ol>
					<Button type="button" variant="outline" onClick={collapse}>
						{t('ntOnboardingDone')}
					</Button>
				</div>
			)}
		</section>
	)
}
