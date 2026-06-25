import { motion, useMotionValue, useReducedMotion, useSpring } from 'motion/react'
import { useRef, type PointerEvent, type ReactNode } from 'react'

const springValues = {
	damping: 30,
	stiffness: 100,
	mass: 2,
}

interface PointerPosition {
	clientX: number
	clientY: number
}

interface TiltBounds {
	left: number
	top: number
	width: number
	height: number
}

interface TiltHoverProps {
	children: ReactNode
	className?: string
	innerClassName?: string
	rotateAmplitude?: number
	scaleOnHover?: number
}

function normalizeRotation(value: number) {
	return Math.abs(value) < 0.000001 ? 0 : value
}

export function calculateTiltTransform(
	pointer: PointerPosition,
	bounds: TiltBounds,
	rotateAmplitude: number,
) {
	if (bounds.width <= 0 || bounds.height <= 0) {
		return { rotateX: 0, rotateY: 0 }
	}

	const offsetX = pointer.clientX - bounds.left - bounds.width / 2
	const offsetY = pointer.clientY - bounds.top - bounds.height / 2
	const rotateX = (offsetY / (bounds.height / 2)) * -rotateAmplitude
	const rotateY = (offsetX / (bounds.width / 2)) * rotateAmplitude

	return {
		rotateX: normalizeRotation(rotateX),
		rotateY: normalizeRotation(rotateY),
	}
}

export default function TiltHover({
	children,
	className = '',
	innerClassName = '',
	rotateAmplitude = 8,
	scaleOnHover = 1.04,
}: TiltHoverProps) {
	const frameRef = useRef<HTMLDivElement | null>(null)
	const prefersReducedMotion = useReducedMotion()
	const rotateX = useSpring(useMotionValue(0), springValues)
	const rotateY = useSpring(useMotionValue(0), springValues)
	const scale = useSpring(1, springValues)

	const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
		if (prefersReducedMotion || !frameRef.current) {
			return
		}

		const bounds = frameRef.current.getBoundingClientRect()
		const transform = calculateTiltTransform(event, bounds, rotateAmplitude)
		rotateX.set(transform.rotateX)
		rotateY.set(transform.rotateY)
	}

	const handlePointerEnter = () => {
		if (!prefersReducedMotion) {
			scale.set(scaleOnHover)
		}
	}

	const handlePointerLeave = () => {
		scale.set(1)
		rotateX.set(0)
		rotateY.set(0)
	}

	return (
		<div
			className={`tilt-hover ${className}`}
			onPointerEnter={handlePointerEnter}
			onPointerLeave={handlePointerLeave}
			onPointerMove={handlePointerMove}
			ref={frameRef}
		>
			<motion.div
				className={`tilt-hover-inner ${innerClassName}`}
				style={{ rotateX, rotateY, scale }}
			>
				{children}
			</motion.div>
		</div>
	)
}
