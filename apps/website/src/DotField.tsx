import { memo, useEffect, useRef } from 'react'

const TWO_PI = Math.PI * 2

interface Dot {
	ax: number
	ay: number
	sx: number
	sy: number
}

interface DotFieldProps {
	dotRadius?: number
	dotSpacing?: number
	cursorRadius?: number
	bulgeStrength?: number
	glowRadius?: number
	sparkle?: boolean
	waveAmplitude?: number
	gradientFrom?: string
	gradientTo?: string
	glowColor?: string
}

function colorWithAlpha(color: string, alpha: number) {
	const hex = color.trim().replace(/^#/, '')
	const normalized =
		hex.length === 3
			? hex
					.split('')
					.map((part) => part + part)
					.join('')
			: hex

	if (/^[\da-f]{6}$/i.test(normalized)) {
		const value = Number.parseInt(normalized, 16)
		const red = (value >> 16) & 255
		const green = (value >> 8) & 255
		const blue = value & 255
		return `rgba(${red}, ${green}, ${blue}, ${alpha})`
	}

	return color
}

const DotField = memo(function DotField({
	dotRadius = 2.1,
	dotSpacing = 14,
	cursorRadius = 470,
	bulgeStrength = 118,
	glowRadius = 190,
	sparkle = false,
	waveAmplitude = 1.2,
	gradientFrom = 'rgba(8, 9, 10, 0.5)',
	gradientTo = 'rgba(8, 9, 10, 0.34)',
	glowColor = '#6e7278',
}: DotFieldProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const dotsRef = useRef<Dot[]>([])
	const mouseRef = useRef({ x: -9999, y: -9999, prevX: -9999, prevY: -9999, speed: 0 })
	const sizeRef = useRef({ w: 0, h: 0 })
	const rafRef = useRef<number | undefined>(undefined)

	useEffect(() => {
		const canvasEl = canvasRef.current
		if (!canvasEl) return
		const canvas: HTMLCanvasElement = canvasEl

		const maybeCtx = canvas.getContext('2d', { alpha: true })
		if (!maybeCtx) return
		const ctx: CanvasRenderingContext2D = maybeCtx

		const dpr = Math.min(window.devicePixelRatio || 1, 2)
		const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
		let resizeTimer: number | undefined
		let frame = 0

		function buildDots(w: number, h: number) {
			const step = dotRadius + dotSpacing
			const cols = Math.ceil(w / step) + 8
			const rows = Math.ceil(h / step) + 8
			const padX = (w - cols * step) / 2
			const padY = (h - rows * step) / 2
			const dots: Dot[] = []

			for (let row = 0; row < rows; row++) {
				for (let col = 0; col < cols; col++) {
					const ax = padX + col * step + step / 2
					const ay = padY + row * step + step / 2
					dots.push({ ax, ay, sx: ax, sy: ay })
				}
			}
			dotsRef.current = dots
		}

		function doResize() {
			const rect = canvas.getBoundingClientRect()
			const w = rect.width
			const h = rect.height
			canvas.width = w * dpr
			canvas.height = h * dpr
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
			sizeRef.current = { w, h }
			buildDots(w, h)
		}

		function resize() {
			clearTimeout(resizeTimer)
			resizeTimer = window.setTimeout(doResize, 100)
		}

		function move(e: PointerEvent) {
			const rect = canvas.getBoundingClientRect()
			mouseRef.current.x = e.clientX - rect.left
			mouseRef.current.y = e.clientY - rect.top
		}

		function tick() {
			frame += 1
			const { w, h } = sizeRef.current
			const mouse = mouseRef.current
			const dx = mouse.x - mouse.prevX
			const dy = mouse.y - mouse.prevY
			const dist = Math.sqrt(dx * dx + dy * dy)
			mouse.speed += (dist - mouse.speed) * 0.32
			mouse.prevX = mouse.x
			mouse.prevY = mouse.y

			const active = prefersReducedMotion.matches ? 0 : Math.min(mouse.speed / 16, 1)
			const cursorSq = cursorRadius * cursorRadius
			const wave =
				prefersReducedMotion.matches || waveAmplitude <= 0
					? 0
					: Math.sin(frame * 0.012) * waveAmplitude

			ctx.clearRect(0, 0, w, h)

			const vignette = ctx.createRadialGradient(w * 0.52, h * 0.44, 80, w * 0.52, h * 0.44, w * 0.74)
			vignette.addColorStop(0, 'rgba(255, 255, 255, 0)')
			vignette.addColorStop(0.62, 'rgba(255, 255, 255, 0)')
			vignette.addColorStop(1, 'rgba(10, 10, 12, 0.04)')
			ctx.fillStyle = vignette
			ctx.fillRect(0, 0, w, h)

			const grad = ctx.createLinearGradient(0, 0, w, h)
			grad.addColorStop(0, gradientFrom)
			grad.addColorStop(0.55, 'rgba(8, 9, 10, 0.22)')
			grad.addColorStop(1, gradientTo)
			ctx.fillStyle = grad
			ctx.beginPath()

			for (const [index, dot] of dotsRef.current.entries()) {
				const mx = mouse.x - dot.ax
				const my = mouse.y - dot.ay
				const distSq = mx * mx + my * my
				let drawX = dot.ax
				let drawY = dot.ay + Math.sin(dot.ax * 0.016 + frame * 0.009) * wave

				if (distSq < cursorSq && active > 0.02) {
					const distance = Math.sqrt(distSq)
					const force = (1 - distance / cursorRadius) ** 2 * bulgeStrength * active
					const angle = Math.atan2(my, mx)
					drawX = dot.ax - Math.cos(angle) * force
					drawY = dot.ay - Math.sin(angle) * force
				}

				dot.sx += (drawX - dot.sx) * 0.14
				dot.sy += (drawY - dot.sy) * 0.14
				const sparkleHash = ((index * 2654435761) ^ (frame >> 3)) >>> 0
				const radius = sparkle && sparkleHash % 100 < 3 ? dotRadius * 0.9 : dotRadius / 2
				ctx.moveTo(dot.sx + radius, dot.sy)
				ctx.arc(dot.sx, dot.sy, radius, 0, TWO_PI)
			}

			ctx.fill()

			if (active > 0.01) {
				const glow = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, glowRadius)
				glow.addColorStop(0, colorWithAlpha(glowColor, 0.34 * active))
				glow.addColorStop(0.48, colorWithAlpha(glowColor, 0.16 * active))
				glow.addColorStop(1, 'rgba(255, 255, 255, 0)')
				ctx.fillStyle = glow
				ctx.fillRect(0, 0, w, h)
			}

			rafRef.current = requestAnimationFrame(tick)
		}

		doResize()
		window.addEventListener('resize', resize)
		window.addEventListener('pointermove', move, { passive: true })
		rafRef.current = requestAnimationFrame(tick)

		return () => {
			clearTimeout(resizeTimer)
			if (rafRef.current) cancelAnimationFrame(rafRef.current)
			window.removeEventListener('resize', resize)
			window.removeEventListener('pointermove', move)
		}
	}, [
		bulgeStrength,
		cursorRadius,
		dotRadius,
		dotSpacing,
		glowColor,
		glowRadius,
		gradientFrom,
		gradientTo,
		sparkle,
		waveAmplitude,
	])

	return <canvas className="dot-field" ref={canvasRef} aria-hidden="true" />
})

export default DotField
