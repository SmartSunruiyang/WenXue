import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateTiltTransform } from './TiltHover'

test('calculateTiltTransform keeps the card flat at the pointer center', () => {
	const transform = calculateTiltTransform(
		{ clientX: 150, clientY: 100 },
		{ left: 50, top: 50, width: 200, height: 100 },
		12,
	)

	assert.deepEqual(transform, { rotateX: 0, rotateY: 0 })
})

test('calculateTiltTransform tilts toward the pointer near the top right', () => {
	const transform = calculateTiltTransform(
		{ clientX: 250, clientY: 50 },
		{ left: 50, top: 50, width: 200, height: 100 },
		12,
	)

	assert.deepEqual(transform, { rotateX: 12, rotateY: 12 })
})

test('calculateTiltTransform returns a flat transform for empty bounds', () => {
	const transform = calculateTiltTransform(
		{ clientX: 250, clientY: 50 },
		{ left: 50, top: 50, width: 0, height: 100 },
		12,
	)

	assert.deepEqual(transform, { rotateX: 0, rotateY: 0 })
})
