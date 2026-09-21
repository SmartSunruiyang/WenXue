import {
	ArrowLeft,
	ArrowRight,
	CircleAlert,
	Film,
	LoaderCircle,
	Pause,
	Play,
	RotateCcw,
} from 'lucide-react'
import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
} from 'react'

import './OnboardingTour.css'
import { ONBOARDING_VIDEO_SOURCES as VIDEO_SOURCES } from './onboardingProgress'
import { strings } from './strings'

const STEP_COUNT = VIDEO_SOURCES.length
const LEAVE_DURATION = 110
const ENTER_DURATION = 150

interface OnboardingTourProps {
	onExit: (reason: 'completed' | 'skipped') => void
	frameless?: boolean
	windowControls?: ReactNode
	suspended?: boolean
}

export function OnboardingTour({
	onExit,
	frameless = false,
	windowControls,
	suspended = false,
}: OnboardingTourProps) {
	const id = useId()
	const [stepIndex, setStepIndex] = useState(0)
	const [attempt, setAttempt] = useState(0)
	const [phase, setPhase] = useState<'idle' | 'leaving' | 'entering'>('idle')
	const [direction, setDirection] = useState<'forward' | 'backward'>('forward')
	const [documentHidden, setDocumentHidden] = useState(() => document.hidden)
	const [finalStepEnded, setFinalStepEnded] = useState(false)
	const [reducedMotion, setReducedMotion] = useState(
		() => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
	)
	const headingRef = useRef<HTMLHeadingElement>(null)
	const videoRef = useRef<HTMLVideoElement>(null)
	const playButtonRef = useRef<HTMLButtonElement>(null)
	const mountedRef = useRef(true)
	const exitedRef = useRef(false)
	const transitioningRef = useRef(false)
	const stepRef = useRef(0)
	const attemptRef = useRef(0)
	const reducedMotionRef = useRef(reducedMotion)
	const pendingStepRef = useRef<number | null>(null)
	const transitionTimerRef = useRef<number | null>(null)
	const copy = strings.onboarding
	const isFinish = stepIndex === STEP_COUNT
	const transitioning = phase !== 'idle'
	const interactionsDisabled = transitioning || suspended
	const playbackSuspended = suspended || documentHidden
	const step = copy.steps[stepIndex]

	useEffect(() => {
		mountedRef.current = true
		const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
		const changePreference = () => {
			reducedMotionRef.current = preference.matches
			setReducedMotion(preference.matches)
			if (!preference.matches) return
			videoRef.current?.pause()
			if (transitionTimerRef.current !== null) {
				window.clearTimeout(transitionTimerRef.current)
				transitionTimerRef.current = null
			}
			if (pendingStepRef.current !== null) {
				stepRef.current = pendingStepRef.current
				setStepIndex(pendingStepRef.current)
				pendingStepRef.current = null
			}
			transitioningRef.current = false
			setPhase('idle')
		}
		preference.addEventListener('change', changePreference)
		return () => {
			mountedRef.current = false
			preference.removeEventListener('change', changePreference)
			if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current)
		}
	}, [])

	useEffect(() => {
		if (!suspended && !documentHidden) headingRef.current?.focus({ preventScroll: true })
	}, [stepIndex, suspended, documentHidden])

	useEffect(() => {
		const updateVisibility = () => {
			setDocumentHidden(document.hidden)
			if (document.hidden) videoRef.current?.pause()
		}
		document.addEventListener('visibilitychange', updateVisibility)
		return () => document.removeEventListener('visibilitychange', updateVisibility)
	}, [])

	const navigate = useCallback(
		(nextIndex: number) => {
			if (
				exitedRef.current ||
				suspended ||
				document.hidden ||
				transitioningRef.current ||
				nextIndex < 0 ||
				nextIndex > STEP_COUNT ||
				nextIndex === stepRef.current
			)
				return
			videoRef.current?.pause()
			setFinalStepEnded(false)
			if (reducedMotionRef.current) {
				stepRef.current = nextIndex
				setStepIndex(nextIndex)
				return
			}
			transitioningRef.current = true
			pendingStepRef.current = nextIndex
			setDirection(nextIndex > stepRef.current ? 'forward' : 'backward')
			setPhase('leaving')
			transitionTimerRef.current = window.setTimeout(() => {
				if (!mountedRef.current || exitedRef.current) return
				stepRef.current = nextIndex
				setStepIndex(nextIndex)
				setPhase('entering')
				transitionTimerRef.current = window.setTimeout(() => {
					if (!mountedRef.current || exitedRef.current) return
					transitioningRef.current = false
					pendingStepRef.current = null
					transitionTimerRef.current = null
					setPhase('idle')
				}, ENTER_DURATION)
			}, LEAVE_DURATION)
		},
		[suspended],
	)

	useEffect(() => {
		if (!finalStepEnded || playbackSuspended || phase !== 'idle') return
		const frame = window.requestAnimationFrame(() => navigate(STEP_COUNT))
		return () => window.cancelAnimationFrame(frame)
	}, [finalStepEnded, playbackSuspended, phase, navigate])

	const exit = (reason: 'completed' | 'skipped') => {
		if (exitedRef.current) return
		exitedRef.current = true
		if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current)
		videoRef.current?.pause()
		onExit(reason)
	}

	const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (
			suspended ||
			event.defaultPrevented ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.nativeEvent.isComposing
		)
			return
		const target = event.target as HTMLElement
		if (target.closest('video, input, textarea, select, [role="slider"], [role="dialog"]')) return
		if (event.key === 'Escape' && !document.fullscreenElement) {
			event.preventDefault()
			exit('skipped')
		} else if (event.key === 'ArrowLeft' && stepIndex > 0) {
			event.preventDefault()
			navigate(stepIndex - 1)
		} else if (event.key === 'ArrowRight' && stepIndex < STEP_COUNT - 1) {
			event.preventDefault()
			navigate(stepIndex + 1)
		} else if (event.key === ' ' && !isFinish && !target.closest('button, a')) {
			event.preventDefault()
			playButtonRef.current?.click()
		}
	}

	return (
		<main
			className={`auth-shell onboarding-tour ${frameless ? 'app-shell--frameless' : ''}`}
			onKeyDown={handleKeyDown}
			aria-label={copy.title}
		>
			<div className="drag-region onboarding-tour__drag" aria-hidden="true" />
			{windowControls}
			<header className="onboarding-tour__header">
				<div className="onboarding-tour__identity">
					<img src="logo.png" alt="" width="28" height="28" />
					<span>{copy.title}</span>
				</div>
				<button className="onboarding-tour__skip" type="button" onClick={() => exit('skipped')}>
					{copy.skip}
					<ArrowRight size={15} aria-hidden="true" />
				</button>
			</header>
			<div
				className="onboarding-tour__panel"
				data-phase={phase}
				data-direction={direction}
				aria-busy={transitioning}
			>
				{isFinish ? (
					<OnboardingBrandFinish
						headingRef={headingRef}
						reducedMotion={reducedMotion}
						disabled={interactionsDisabled}
						onStart={() => exit('completed')}
						onReplay={() => navigate(0)}
					/>
				) : (
					<section className="onboarding-tour__scene" aria-labelledby={`${id}-title`}>
						<div className="onboarding-tour__heading">
							<div>
								<p className="onboarding-tour__eyebrow">
									{copy.stepCount(stepIndex + 1, STEP_COUNT)}
								</p>
								<h1 id={`${id}-title`} ref={headingRef} tabIndex={-1}>
									{step.title}
								</h1>
								<p className="onboarding-tour__subtitle">{step.description}</p>
							</div>
							<ol className="onboarding-tour__progress" aria-label={copy.progressLabel}>
								{VIDEO_SOURCES.map((source, index) => (
									<li
										key={source}
										aria-current={index === stepIndex ? 'step' : undefined}
										data-visited={index < stepIndex || undefined}
									>
										<span className="sr-only">{copy.steps[index].title}</span>
									</li>
								))}
							</ol>
						</div>
						<TutorialVideo
							key={`${stepIndex}-${attempt}`}
							src={VIDEO_SOURCES[stepIndex]}
							title={step.title}
							videoRef={videoRef}
							playButtonRef={playButtonRef}
							reducedMotion={reducedMotion}
							suspended={playbackSuspended}
							disabled={interactionsDisabled}
							onRetry={() => {
								setFinalStepEnded(false)
								attemptRef.current += 1
								setAttempt(attemptRef.current)
							}}
							onEnded={() => {
								if (
									!transitioningRef.current &&
									!exitedRef.current &&
									stepRef.current === stepIndex &&
									attemptRef.current === attempt &&
									stepIndex === STEP_COUNT - 1
								)
									setFinalStepEnded(true)
							}}
							navigation={
								<nav className="onboarding-tour__navigation" aria-label={copy.navigationLabel}>
									<button
										className="onboarding-tour__button onboarding-tour__button--secondary"
										type="button"
										disabled={stepIndex === 0 || interactionsDisabled}
										onClick={() => navigate(stepIndex - 1)}
									>
										<ArrowLeft size={16} aria-hidden="true" />
										{copy.previous}
									</button>
									<button
										className="onboarding-tour__button onboarding-tour__button--primary"
										type="button"
										disabled={interactionsDisabled || stepIndex === STEP_COUNT - 1}
										onClick={() => navigate(stepIndex + 1)}
									>
										{stepIndex === STEP_COUNT - 1 ? copy.finishAfterPlayback : copy.next}
										{stepIndex < STEP_COUNT - 1 ? (
											<ArrowRight size={16} aria-hidden="true" />
										) : null}
									</button>
								</nav>
							}
						/>
					</section>
				)}
			</div>
		</main>
	)
}

function TutorialVideo({
	src,
	title,
	videoRef,
	playButtonRef,
	reducedMotion,
	suspended,
	disabled,
	onEnded,
	onRetry,
	navigation,
}: {
	src: string
	title: string
	videoRef: RefObject<HTMLVideoElement | null>
	playButtonRef: RefObject<HTMLButtonElement | null>
	reducedMotion: boolean
	suspended: boolean
	disabled: boolean
	onEnded: () => void
	onRetry: () => void
	navigation: ReactNode
}) {
	const copy = strings.onboarding
	const [loading, setLoading] = useState(true)
	const [delayed, setDelayed] = useState(false)
	const [playing, setPlaying] = useState(false)
	const [ended, setEnded] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [playBlocked, setPlayBlocked] = useState(false)
	const autoplayRef = useRef(!reducedMotion && !suspended)
	const mountedRef = useRef(true)
	const playRequestRef = useRef(0)

	useEffect(() => {
		mountedRef.current = true
		const video = videoRef.current
		return () => {
			mountedRef.current = false
			playRequestRef.current += 1
			video?.pause()
		}
	}, [videoRef])

	useEffect(() => {
		if (reducedMotion || suspended) {
			autoplayRef.current = false
			videoRef.current?.pause()
		}
	}, [reducedMotion, suspended, videoRef])

	useEffect(() => {
		if (!loading) return
		const timer = window.setTimeout(() => setDelayed(true), 12000)
		return () => window.clearTimeout(timer)
	}, [loading])

	const isCurrent = (video: HTMLVideoElement) => mountedRef.current && video === videoRef.current
	const play = () => {
		const video = videoRef.current
		if (!video || disabled || suspended || document.hidden) return
		const request = ++playRequestRef.current
		setPlayBlocked(false)
		void video.play().catch((reason: unknown) => {
			if (!isCurrent(video) || playRequestRef.current !== request) return
			if (reason instanceof DOMException && reason.name === 'AbortError') return
			setLoading(false)
			if (reason instanceof DOMException && reason.name === 'NotSupportedError') {
				setError(copy.unsupported)
			} else {
				setPlayBlocked(true)
			}
		})
	}
	const replay = () => {
		const video = videoRef.current
		if (!video || disabled) return
		video.currentTime = 0
		setEnded(false)
		play()
	}
	const ready = (video: HTMLVideoElement) => {
		if (!isCurrent(video)) return
		setLoading(false)
		setDelayed(false)
	}

	return (
		<div className="onboarding-tour__video-stage">
			<div className="onboarding-tour__video-frame">
				<video
					ref={videoRef}
					src={src}
					className="onboarding-tour__video"
					controls
					muted
					playsInline
					autoPlay={autoplayRef.current && !reducedMotion && !suspended}
					preload="auto"
					disablePictureInPicture
					tabIndex={0}
					aria-label={copy.videoLabel(title)}
					onLoadedData={(event) => ready(event.currentTarget)}
					onCanPlay={(event) => ready(event.currentTarget)}
					onWaiting={(event) => {
						if (isCurrent(event.currentTarget)) setLoading(true)
					}}
					onPlaying={(event) => {
						if (!isCurrent(event.currentTarget)) return
						if (suspended || document.hidden) {
							event.currentTarget.pause()
							return
						}
						setPlaying(true)
						setEnded(false)
						setPlayBlocked(false)
						ready(event.currentTarget)
					}}
					onPause={(event) => {
						if (isCurrent(event.currentTarget)) setPlaying(false)
					}}
					onEnded={(event) => {
						if (!isCurrent(event.currentTarget)) return
						setPlaying(false)
						setEnded(true)
						onEnded()
					}}
					onError={(event) => {
						if (!isCurrent(event.currentTarget)) return
						setLoading(false)
						setPlaying(false)
						setError(event.currentTarget.error?.code === 4 ? copy.unsupported : copy.loadError)
					}}
				>
					{copy.unsupported}
				</video>
				{error || delayed ? (
					<div className="onboarding-tour__media-message" role="alert">
						<CircleAlert size={26} strokeWidth={1.5} aria-hidden="true" />
						<p>{error ?? copy.loadDelayed}</p>
						<button
							className="onboarding-tour__button onboarding-tour__button--secondary"
							type="button"
							onClick={onRetry}
							disabled={disabled}
						>
							<RotateCcw size={16} aria-hidden="true" />
							{copy.retry}
						</button>
					</div>
				) : loading ? (
					<div
						className="onboarding-tour__media-message onboarding-tour__media-message--loading"
						role="status"
					>
						<LoaderCircle className="onboarding-tour__spinner" size={26} aria-hidden="true" />
						<p>{copy.loading}</p>
					</div>
				) : !playing && !ended ? (
					<button
						className="onboarding-tour__play-overlay"
						type="button"
						onClick={play}
						disabled={disabled}
					>
						<Play size={23} fill="currentColor" aria-hidden="true" />
						<span>{playBlocked ? copy.playBlocked : copy.play}</span>
					</button>
				) : null}
			</div>
			<footer className="onboarding-tour__footer">
				<div className="onboarding-tour__playback">
					<button
						ref={playButtonRef}
						className="onboarding-tour__playback-button"
						type="button"
						disabled={disabled || Boolean(error) || loading}
						onClick={() => {
							if (videoRef.current?.paused) play()
							else videoRef.current?.pause()
						}}
						aria-label={playing ? copy.pause : copy.play}
						title={playing ? copy.pause : copy.play}
					>
						{playing ? (
							<Pause size={18} aria-hidden="true" />
						) : (
							<Play size={18} aria-hidden="true" />
						)}
					</button>
					<button
						className="onboarding-tour__playback-button"
						type="button"
						disabled={disabled || Boolean(error) || loading}
						onClick={replay}
						aria-label={copy.replayStep}
						title={copy.replayStep}
					>
						<RotateCcw size={18} aria-hidden="true" />
					</button>
					<span className="onboarding-tour__playback-status" role="status">
						{ended
							? copy.stepFinished
							: reducedMotion && !playing
								? copy.manualPlayback
								: copy.demonstration}
					</span>
					<Film className="onboarding-tour__film-icon" size={15} aria-hidden="true" />
				</div>
				{navigation}
			</footer>
		</div>
	)
}

export function OnboardingBrandFinish({
	headingRef,
	reducedMotion,
	disabled,
	onStart,
	onReplay,
}: {
	headingRef: RefObject<HTMLHeadingElement | null>
	reducedMotion: boolean
	disabled: boolean
	onStart: () => void
	onReplay: () => void
}) {
	const [ready, setReady] = useState(reducedMotion)
	const copy = strings.onboarding

	useEffect(() => {
		const timer = window.setTimeout(() => setReady(true), reducedMotion ? 0 : 1200)
		return () => window.clearTimeout(timer)
	}, [reducedMotion])

	return (
		<section className="onboarding-finish" aria-label={copy.finishTitle}>
			<h1 ref={headingRef} tabIndex={-1} className="sr-only">
				{copy.finishTitle}
			</h1>
			<div className="onboarding-finish__brand">
				<img className="onboarding-finish__logo" src="logo.png" alt={strings.brandShort} />
				<div className="onboarding-finish__slogan">
					<img src="slogan.png" alt={strings.slogan} />
				</div>
			</div>
			<div className="onboarding-finish__invitation" data-ready={ready}>
				<p>{copy.finishDescription}</p>
				<button
					className="onboarding-tour__button onboarding-tour__button--primary onboarding-finish__start"
					type="button"
					disabled={!ready || disabled}
					onClick={onStart}
				>
					{copy.start}
					<ArrowRight size={17} aria-hidden="true" />
				</button>
				<button
					className="onboarding-finish__replay"
					type="button"
					disabled={!ready || disabled}
					onClick={onReplay}
				>
					<RotateCcw size={14} aria-hidden="true" />
					{copy.reopen}
				</button>
			</div>
		</section>
	)
}
