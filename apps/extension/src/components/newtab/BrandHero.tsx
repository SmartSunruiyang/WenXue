import { Logo } from '@/components/misc'

export function BrandHero() {
	return (
		<header className="newtab-brand">
			<Logo className="size-10" />
			<h1>
				<img
					src="/assets/wenxue-slogan.png"
					alt="ask for everything"
					width={448}
					height={57}
					className="newtab-brand-slogan"
				/>
			</h1>
		</header>
	)
}
