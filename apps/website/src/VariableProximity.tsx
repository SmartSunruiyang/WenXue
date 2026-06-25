import { motion } from 'motion/react'
import {
	forwardRef,
	useEffect,
	useMemo,
	useRef,
	type CSSProperties,
	type HTMLAttributes,
	type RefObject,
} from 'react'
import './VariableProximity.css'

type Falloff = 'linear' | 'exponential' | 'gaussian'

interface VariableProximityProps extends HTMLAttributes<HTMLSpanElement> {
	label: string
	fromFontVariationSettings: string
	toFontVariationSettings: string
	containerRef?: RefObject<HTMLElement | null>
	radius?: number
	falloff?: Falloff
	style?: CSSProperties
}

function useAnimationFrame(callback: () => void) {
	useEffect(() => {
		let frameId = 0
		const loop = () => {
			callback()
			frameId = requestAnimationFrame(loop)
		}

		frameId = requestAnimationFrame(loop)
		return () => cancelAnimationFrame(frameId)
	}, [callback])
}

function useMousePositionRef(containerRef?: RefObject<HTMLElement | null>) {
	const positionRef = useRef({ x: 0, y: 0 })

	useEffect(() => {
		const updatePosition = (x: number, y: number) => {
			if (containerRef?.current) {
				const rect = containerRef.current.getBoundingClientRect()
				positionRef.current = { x: x - rect.left, y: y - rect.top }
				return
			}

			positionRef.current = { x, y }
		}

		const handleMouseMove = (event: MouseEvent) => updatePosition(event.clientX, event.clientY)
		const handleTouchMove = (event: TouchEvent) => {
			const touch = event.touches[0]
			if (touch) {
				updatePosition(touch.clientX, touch.clientY)
			}
		}

		window.addEventListener('mousemove', handleMouseMove)
		window.addEventListener('touchmove', handleTouchMove)
		return () => {
			window.removeEventListener('mousemove', handleMouseMove)
			window.removeEventListener('touchmove', handleTouchMove)
		}
	}, [containerRef])

	return positionRef
}

const VariableProximity = forwardRef<HTMLSpanElement, VariableProximityProps>(
	(
		{
			label,
			fromFontVariationSettings,
			toFontVariationSettings,
			containerRef,
			radius = 50,
			falloff = 'linear',
			className = '',
			onClick,
			style,
			...restProps
		},
		ref,
	) => {
		const letterRefs = useRef<Array<HTMLSpanElement | null>>([])
		const interpolatedSettingsRef = useRef<string[]>([])
		const mousePositionRef = useMousePositionRef(containerRef)
		const lastPositionRef = useRef<{ x: number | null; y: number | null }>({ x: null, y: null })

		const parsedSettings = useMemo(() => {
			const parseSettings = (settings: string) =>
				new Map(
					settings
						.split(',')
						.map((setting) => setting.trim())
						.map((setting) => {
							const [name, value] = setting.split(' ')
							return [name.replace(/['"]/g, ''), Number.parseFloat(value)] as const
						}),
				)

			const fromSettings = parseSettings(fromFontVariationSettings)
			const toSettings = parseSettings(toFontVariationSettings)

			return Array.from(fromSettings.entries()).map(([axis, fromValue]) => ({
				axis,
				fromValue,
				toValue: toSettings.get(axis) ?? fromValue,
			}))
		}, [fromFontVariationSettings, toFontVariationSettings])

		useAnimationFrame(() => {
			if (!containerRef?.current) {
				return
			}

			const containerRect = containerRef.current.getBoundingClientRect()
			const { x, y } = mousePositionRef.current
			if (lastPositionRef.current.x === x && lastPositionRef.current.y === y) {
				return
			}
			lastPositionRef.current = { x, y }

			letterRefs.current.forEach((letterRef, index) => {
				if (!letterRef) {
					return
				}

				const rect = letterRef.getBoundingClientRect()
				const letterCenterX = rect.left + rect.width / 2 - containerRect.left
				const letterCenterY = rect.top + rect.height / 2 - containerRect.top
				const distance = Math.sqrt((x - letterCenterX) ** 2 + (y - letterCenterY) ** 2)

				if (distance >= radius) {
					letterRef.style.fontVariationSettings = fromFontVariationSettings
					letterRef.style.transform = 'translateY(0) scale(1)'
					return
				}

				const norm = Math.min(Math.max(1 - distance / radius, 0), 1)
				const falloffValue =
					falloff === 'exponential'
						? norm ** 2
						: falloff === 'gaussian'
							? Math.exp(-((distance / (radius / 2)) ** 2) / 2)
							: norm
				const newSettings = parsedSettings
					.map(({ axis, fromValue, toValue }) => {
						const interpolatedValue = fromValue + (toValue - fromValue) * falloffValue
						return `'${axis}' ${interpolatedValue}`
					})
					.join(', ')

				interpolatedSettingsRef.current[index] = newSettings
				letterRef.style.fontVariationSettings = newSettings
				const lift = -3 * falloffValue
				const scale = 1 + 0.085 * falloffValue
				letterRef.style.transform = `translateY(${lift}px) scale(${scale})`
			})
		})

		const words = label.split(' ')
		let letterIndex = 0

		return (
			<span
				ref={ref}
				className={`${className} variable-proximity`}
				onClick={onClick}
				style={{ display: 'inline', ...style }}
				{...restProps}
			>
				{words.map((word, wordIndex) => (
					<span
						key={`${word}-${wordIndex}`}
						style={{ display: 'inline-block', whiteSpace: 'nowrap' }}
					>
						{word.split('').map((letter) => {
							const currentLetterIndex = letterIndex++
							return (
								<motion.span
									aria-hidden="true"
									key={currentLetterIndex}
									ref={(element) => {
										letterRefs.current[currentLetterIndex] = element
									}}
									style={{
										display: 'inline-block',
										fontVariationSettings: interpolatedSettingsRef.current[currentLetterIndex],
										transformOrigin: 'center 62%',
										willChange: 'font-variation-settings, transform',
									}}
								>
									{letter}
								</motion.span>
							)
						})}
						{wordIndex < words.length - 1 && (
							<span style={{ display: 'inline-block' }}>&nbsp;</span>
						)}
					</span>
				))}
				<span className="sr-only">{label}</span>
			</span>
		)
	},
)

VariableProximity.displayName = 'VariableProximity'

export default VariableProximity
