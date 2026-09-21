import { ArrowDown, Download, Play } from 'lucide-react'
import {
	useEffect,
	useRef,
	useState,
	type ButtonHTMLAttributes,
	type MouseEvent,
	type ReactNode,
} from 'react'
import DocsPage from './DocsPage'
import DotField from './DotField'
import PrivacyPage from './PrivacyPage'
import SiteNavbar from './SiteNavbar'
import TiltHover from './TiltHover'
import VariableProximity from './VariableProximity'
import { parseSiteRoute } from './siteRoute'

const githubUrl = 'https://github.com/SmartSunruiyang/WenXue'
const workDemoVideoSrc = '/assets/wenxue-work-demo.mov'
const teachingDemoVideoSrc = '/assets/wenxue-teaching-demo.mov'
const tutorialStepDurationMs = 4200
const copy = {
	nav: {
		brandAlt: '问学 ask for everything',
		docs: '文档',
		github: 'GitHub',
	},
	hero: {
		brand: '问学 WenXue',
		version: 'v0.0.1 beta',
		titleFirst: 'Agent，',
		titleSecond: '直接操作浏览器',
		description:
			'问学启动一个预装 AI 助手的浏览器，research、答题、总结、表单操作都在你的工作现场完成。',
		download: '下载问学',
		demo: '看演示',
		scroll: '查看演示',
	},
	browser: {
		eyebrow: '浏览器里的问学',
		titleFirst: '问学是如何工作的',
		titleSecond: '如何将问学呼出并固定到顶部',
		tabLabel: '问学使用步骤',
		workLabel: '问学操作演示',
		tutorialLabel: '问学教学演示',
		lessonTabLabel: '呼出与固定步骤',
		workingStatus: '问学正在操作网页',
		newTab: '新建标签页',
		favorite: '收藏',
		openPlugin: '打开问学插件',
		pinPlugin: '固定问学插件',
		sendTask: '发送任务',
		sidepanelName: '问学',
		breadcrumb: 'Computer Science · Machine Learning',
		paperTitle: 'Large Language Models are Reasoners with Self-Verification',
		authors: 'Xuehai Pan, Li Dong, Furu Wei',
		abstractTitle: 'Abstract',
		abstract:
			'We introduce a simple method that lets models critique, refine, and verify their own responses across web tasks.',
		questionLabel: '页面题目',
		question: '根据本文摘要，模型自我验证的主要作用是什么？',
		choiceA: 'A. 压缩上下文',
		choiceB: 'B. 检查并修正答案',
		steps: [
			{ id: 'summon', title: '呼出问学', description: '点击浏览器顶部的问学入口。' },
			{ id: 'pin', title: '固定到顶部', description: '点亮图钉，让入口常驻工具栏。' },
			{ id: 'task', title: '开始任务', description: '回到网页，直接输入第一条指令。' },
		],
		tasks: ['总结这页重点', '回答页面题目', '整理成表格'],
		results: [
			'已提炼摘要、贡献与适用边界。',
			'已读取题干，答案建议为 B。',
			'已整理为两列对照表，可继续导出。',
		],
	},
	finalCta: {
		title: '让 AI 在真实网页里，成为你的得力助手',
		platforms: 'macOS / Windows',
	},
} as const

export default function App() {
	const [route, setRoute] = useState(() => parseSiteRoute(window.location.hash))

	useEffect(() => {
		const syncRoute = () => setRoute(parseSiteRoute(window.location.hash))
		window.addEventListener('hashchange', syncRoute)
		window.addEventListener('popstate', syncRoute)
		return () => {
			window.removeEventListener('hashchange', syncRoute)
			window.removeEventListener('popstate', syncRoute)
		}
	}, [])

	useEffect(() => {
		document.title =
			route.page === 'docs'
				? '使用文档 · 问学 WenXue'
				: route.page === 'privacy'
					? `${route.section === 'terms-of-use' ? '用户须知' : '隐私协议'} · 问学 WenXue`
					: '问学 WenXue · Agent，直接操作浏览器'
		const frame = window.requestAnimationFrame(() => {
			const anchor = route.page === 'home' ? window.location.hash.slice(1) : route.anchor
			const target = anchor ? document.getElementById(anchor) : null
			if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' })
			else window.scrollTo({ top: 0, behavior: 'instant' })
		})
		return () => window.cancelAnimationFrame(frame)
	}, [route])

	const goDocsSection = (id: string) => {
		window.location.hash = `docs/${id}`
	}

	const revisitCurrentAnchor = (event: MouseEvent<HTMLDivElement>) => {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return
		const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]')
		if (!link || link.getAttribute('href') !== (window.location.hash || '#')) return
		event.preventDefault()
		const anchor = route.page === 'home' ? window.location.hash.slice(1) : route.anchor
		const target = anchor ? document.getElementById(anchor) : null
		if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' })
		else window.scrollTo({ top: 0, behavior: 'instant' })
	}

	return (
		<div className="site-shell" onClick={revisitCurrentAnchor}>
			<a
				className="skip-link"
				href="#main-content"
				onClick={(event) => {
					event.preventDefault()
					document.getElementById('main-content')?.focus()
				}}
			>
				跳转到正文
			</a>
			<SiteNavbar
				copy={{
					brandAlt: '问学 ask for everything',
					docs: '文档',
					privacy: '隐私',
					download: '下载问学',
					github: 'GitHub',
				}}
				githubUrl={githubUrl}
				activePage={route.page}
			/>
			<main id="main-content" tabIndex={-1}>
				{route.page === 'home' ? (
					<HomePage />
				) : route.page === 'docs' ? (
					<DocsPage activeSectionId={route.section} onSectionChange={goDocsSection} />
				) : (
					<PrivacyPage policyId={route.section} />
				)}
			</main>
			<footer className="site-footer">
				<a href="#" className="footer-brand">
					问学 <span>ask for everything</span>
				</a>
				<nav aria-label="页脚导航">
					<a href="#docs/overview">文档</a>
					<a href="#privacy/privacy-policy">隐私协议</a>
					<a href="#privacy/terms-of-use">用户须知</a>
					<a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">
						沪ICP备2026019743号-2
					</a>
				</nav>
			</footer>
		</div>
	)
}

interface TiltButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	children: ReactNode
	tiltClassName?: string
	rotateAmplitude?: number
	scaleOnHover?: number
}

function TiltButton({
	children,
	tiltClassName = '',
	rotateAmplitude = 7,
	scaleOnHover = 1.045,
	...props
}: TiltButtonProps) {
	return (
		<TiltHover
			className={tiltClassName}
			rotateAmplitude={rotateAmplitude}
			scaleOnHover={scaleOnHover}
		>
			<button {...props}>{children}</button>
		</TiltHover>
	)
}

function HomePage() {
	const homeRef = useRef<HTMLDivElement>(null)
	const heroTitleRef = useRef<HTMLHeadingElement>(null)
	useEffect(() => {
		let context: { revert: () => void } | undefined
		let disposed = false

		const setupTitleMotion = async () => {
			const [{ default: gsap }, { ScrollTrigger }] = await Promise.all([
				import('gsap'),
				import('gsap/ScrollTrigger'),
			])

			if (disposed) {
				return
			}

			gsap.registerPlugin(ScrollTrigger)

			const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
			context = gsap.context(() => {
				const titles = gsap.utils.toArray<HTMLElement>(
					[
						'.hero-title-proximity',
						'.reveal-title',
						'.docs-section-hero h1',
						'.docs-section > h2',
						'.docs-subsection h3',
						'.docs-card h3',
					].join(', '),
				)

				if (reduceMotion) {
					gsap.set(titles, { autoAlpha: 1, y: 0 })
					return
				}

				titles.forEach((title) => {
					gsap.fromTo(
						title,
						{ autoAlpha: 0, y: 30 },
						{
							autoAlpha: 1,
							duration: 0.82,
							ease: 'power3.out',
							y: 0,
							scrollTrigger: {
								trigger: title,
								start: 'top 86%',
								once: true,
							},
						},
					)
				})
			}, homeRef)

			ScrollTrigger.refresh()
		}

		void setupTitleMotion()

		return () => {
			disposed = true
			context?.revert()
		}
	}, [])

	useEffect(() => {
		const videos = document.querySelectorAll<HTMLVideoElement>('video.demo-video')
		videos.forEach((video) => {
			video.muted = true
			void video.play().catch(() => undefined)
		})
	}, [])

	const scrollToDemo = () =>
		document.getElementById('browser-demo')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
	const scrollToDownload = () =>
		document.getElementById('download')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
	return (
		<div ref={homeRef}>
			<section className="hero-section" aria-label={copy.hero.brand}>
				<DotField
					bulgeStrength={132}
					cursorRadius={500}
					dotRadius={2.2}
					dotSpacing={14}
					glowColor="#6b6f76"
					glowRadius={230}
					gradientFrom="rgba(8, 9, 10, 0.54)"
					gradientTo="rgba(8, 9, 10, 0.38)"
					sparkle
					waveAmplitude={1.1}
				/>
				<div className="hero-center">
					<div className="hero-brand">
						<img src="/assets/wenxue-logo.png" alt="" aria-hidden="true" />
						<span>{copy.hero.version}</span>
					</div>
					<h1 className="hero-title-proximity reveal-title" ref={heroTitleRef}>
						<span>
							<VariableProximity
								className="hero-title-line"
								containerRef={heroTitleRef}
								falloff="gaussian"
								fromFontVariationSettings="'wght' 720, 'opsz' 18"
								label={copy.hero.titleFirst}
								radius={180}
								toFontVariationSettings="'wght' 1000, 'opsz' 78"
							/>
						</span>
						<span>
							<VariableProximity
								className="hero-title-line"
								containerRef={heroTitleRef}
								falloff="gaussian"
								fromFontVariationSettings="'wght' 720, 'opsz' 18"
								label={copy.hero.titleSecond}
								radius={180}
								toFontVariationSettings="'wght' 1000, 'opsz' 78"
							/>
						</span>
					</h1>
					<p>{copy.hero.description}</p>
					<div className="hero-actions">
						<TiltButton
							className="button button-primary"
							onClick={scrollToDownload}
							tiltClassName="tilt-action tilt-action-primary"
							type="button"
						>
							<Download size={18} />
							{copy.hero.download}
						</TiltButton>
						<TiltButton
							className="button button-secondary"
							onClick={scrollToDemo}
							tiltClassName="tilt-action"
							type="button"
						>
							<Play size={18} />
							{copy.hero.demo}
						</TiltButton>
					</div>
				</div>
				<TiltButton
					aria-label={copy.hero.scroll}
					className="scroll-cue-button"
					onClick={scrollToDemo}
					rotateAmplitude={6}
					scaleOnHover={1.05}
					tiltClassName="scroll-cue tilt-scroll-cue"
					type="button"
				>
					<ArrowDown size={18} />
				</TiltButton>
			</section>

			<section
				className="browser-section work-demo-section"
				id="browser-demo"
				aria-label={copy.browser.titleFirst}
			>
				<div className="section-copy">
					<h2 className="reveal-title">{copy.browser.titleFirst}</h2>
				</div>
				<WorkDemo copy={copy.browser} />
			</section>

			<section className="browser-section tutorial-section" aria-label={copy.browser.titleSecond}>
				<div className="section-copy">
					<h2 className="reveal-title">{copy.browser.titleSecond}</h2>
				</div>
				<TutorialDemo copy={copy.browser} />
			</section>

			<section className="final-cta" id="download" aria-label={copy.hero.download}>
				<img src="/assets/wenxue-logo.png" alt="" aria-hidden="true" />
				<h2 className="reveal-title">{copy.finalCta.title}</h2>
				<div className="hero-actions">
					<TiltButton
						className="button button-primary"
						onClick={() => {
							window.location.hash = 'docs/customer-start'
						}}
						tiltClassName="tilt-action tilt-action-primary"
						type="button"
					>
						<Download size={18} />
						阅读使用指南
					</TiltButton>
					<TiltButton
						className="button button-secondary"
						onClick={scrollToDemo}
						tiltClassName="tilt-action"
						type="button"
					>
						<Play size={18} />
						{copy.hero.demo}
					</TiltButton>
				</div>
				<p className="platforms">下载入口准备中 · {copy.finalCta.platforms}</p>
			</section>
		</div>
	)
}

interface DemoProps {
	copy: typeof copy.browser
}

function WorkDemo({ copy }: DemoProps) {
	return (
		<div className="demo-stage work-demo-stage">
			<article className="demo-shell work-demo-shell">
				<div className="demo-video-frame">
					<video
						aria-label={copy.workLabel}
						autoPlay
						className="demo-video"
						controls={false}
						controlsList="nodownload noplaybackrate noremoteplayback"
						disablePictureInPicture
						loop
						muted
						onContextMenu={(event) => event.preventDefault()}
						playsInline
						preload="metadata"
						src={workDemoVideoSrc}
					/>
				</div>
			</article>
		</div>
	)
}

function TutorialDemo({ copy }: DemoProps) {
	const [activeStep, setActiveStep] = useState(0)

	useEffect(() => {
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
		if (reduceMotion) {
			return
		}

		const intervalId = window.setInterval(() => {
			setActiveStep((current) => (current + 1) % copy.steps.length)
		}, tutorialStepDurationMs)

		return () => window.clearInterval(intervalId)
	}, [copy.steps.length])

	return (
		<div className="demo-stage tutorial-demo-stage">
			<div className="tutorial-progress" role="tablist" aria-label={copy.lessonTabLabel}>
				{copy.steps.map((step, index) => (
					<button
						aria-selected={activeStep === index}
						className={[
							'tutorial-step',
							activeStep === index ? 'tutorial-step-active' : '',
							index < activeStep ? 'tutorial-step-complete' : '',
						]
							.filter(Boolean)
							.join(' ')}
						key={step.id}
						onClick={() => setActiveStep(index)}
						role="tab"
						type="button"
					>
						<span className="tutorial-step-number">{String(index + 1).padStart(2, '0')}</span>
						<span className="tutorial-step-copy">
							<strong>{step.title}</strong>
							<span>{step.description}</span>
						</span>
						<span className="tutorial-step-track" aria-hidden="true">
							<span className="tutorial-step-fill" />
						</span>
					</button>
				))}
			</div>

			<article className="demo-shell tutorial-demo-shell">
				<div className="demo-video-frame">
					<video
						aria-label={copy.tutorialLabel}
						autoPlay
						className="demo-video"
						controls={false}
						controlsList="nodownload noplaybackrate noremoteplayback"
						disablePictureInPicture
						loop
						muted
						onContextMenu={(event) => event.preventDefault()}
						playsInline
						preload="metadata"
						src={teachingDemoVideoSrc}
					/>
				</div>
			</article>
		</div>
	)
}
