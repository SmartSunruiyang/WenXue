import { useEffect, useRef, useState } from 'react'

import { GlassPortalScene, type GlassPortalHandle } from './GlassPortalScene'

interface Props {
	dark: boolean
	children: React.ReactNode
	onComplete: () => void
}

export function IntroSequence({ dark, children, onComplete }: Props) {
	const handleRef = useRef<GlassPortalHandle | null>(null)
	const contentRef = useRef<HTMLDivElement>(null)
	const onCompleteRef = useRef(onComplete)
	onCompleteRef.current = onComplete
	const [done, setDone] = useState(false)

	useEffect(() => {
		let killed = false
		let tl: gsap.core.Timeline | null = null
		;(async () => {
			const { gsap } = await import('gsap')
			if (killed) return
			const proxy = { p: 0 }
			tl = gsap.timeline({
				onComplete: () => {
					setDone(true)
					onCompleteRef.current()
				},
			})
			tl.to(proxy, {
				p: 1,
				duration: 1.2,
				ease: 'power3.out',
				onUpdate: () => handleRef.current?.setProgress(proxy.p),
			})
			if (contentRef.current) {
				tl.fromTo(
					contentRef.current,
					{ autoAlpha: 0, y: 16, filter: 'blur(10px)' },
					{ autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 0.9, ease: 'power2.out' },
					'-=0.5',
				)
				tl.fromTo(
					contentRef.current.querySelectorAll('[data-stagger]'),
					{ autoAlpha: 0, y: 12 },
					{ autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.1, ease: 'power2.out' },
					'-=0.4',
				)
			}
		})()
		return () => {
			killed = true
			tl?.kill()
		}
	}, [])

	return (
		<div className="absolute inset-0">
			{!done && <GlassPortalScene dark={dark} onReady={(h) => (handleRef.current = h)} />}
			<div ref={contentRef} className="relative z-10 h-full">
				{children}
			</div>
		</div>
	)
}
