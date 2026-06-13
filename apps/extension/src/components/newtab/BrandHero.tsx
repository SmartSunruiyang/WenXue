import { Logo } from '@/components/misc'
import { useI18n } from '@/lib/i18n'

export function BrandHero() {
	const { t } = useI18n()
	return (
		<div className="flex flex-col items-center gap-3 text-center select-none">
			<Logo className="size-16 opacity-90" />
			<img
				src="/assets/wenxue-slogan.png"
				alt="问学 — ask for everything"
				className="w-52 max-w-full pointer-events-none"
			/>
			<p className="text-xs tracking-[0.16em] text-muted-foreground">{t('ntSlogan')}</p>
		</div>
	)
}
