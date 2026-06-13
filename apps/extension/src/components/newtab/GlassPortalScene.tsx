import type * as THREE from 'three'

import { useEffect, useRef } from 'react'

export interface GlassPortalHandle {
	setProgress: (p: number) => void
}

interface Props {
	dark: boolean
	onReady?: (handle: GlassPortalHandle) => void
}

export function GlassPortalScene({ dark, onReady }: Props) {
	const containerRef = useRef<HTMLDivElement>(null)
	const onReadyRef = useRef(onReady)
	onReadyRef.current = onReady

	useEffect(() => {
		const el = containerRef.current
		if (!el) return
		let disposed = false
		let cleanup = () => {}

		;(async () => {
			const THREE = await import('three')
			if (disposed) return

			const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
			renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
			renderer.setSize(el.clientWidth, el.clientHeight)
			el.appendChild(renderer.domElement)

			const scene = new THREE.Scene()
			const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 100)
			camera.position.set(0, 0, 6)

			const bg = new THREE.Mesh(
				new THREE.PlaneGeometry(20, 12),
				new THREE.MeshBasicMaterial({ vertexColors: true }),
			)
			const cols = [
				new THREE.Color('#5b86c4'),
				new THREE.Color('#7b6fc9'),
				new THREE.Color('#49b0a8'),
				new THREE.Color('#cf7d5e'),
			]
			const geo = bg.geometry as THREE.PlaneGeometry
			const colorAttr = new Float32Array(geo.attributes.position.count * 3)
			for (let i = 0; i < geo.attributes.position.count; i++) {
				const c = cols[i % cols.length].clone().multiplyScalar(dark ? 0.5 : 0.85)
				colorAttr.set([c.r, c.g, c.b], i * 3)
			}
			geo.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3))
			bg.position.z = -3
			scene.add(bg)

			scene.add(new THREE.AmbientLight(0xffffff, dark ? 0.5 : 0.9))
			const key = new THREE.DirectionalLight(0xffffff, 1.1)
			key.position.set(3, 2, 5)
			scene.add(key)

			const glass = new THREE.Mesh(
				new THREE.PlaneGeometry(4.4, 2.8, 1, 1),
				new THREE.MeshPhysicalMaterial({
					transmission: 1,
					thickness: 1.2,
					roughness: 0.12,
					ior: 1.3,
					metalness: 0,
					clearcoat: 1,
					clearcoatRoughness: 0.2,
					transparent: true,
					opacity: 1,
				}),
			)
			scene.add(glass)

			let progress = 0
			const handle: GlassPortalHandle = { setProgress: (p) => void (progress = p) }
			onReadyRef.current?.(handle)

			let raf = 0
			let t = 0
			const render = () => {
				t += 0.016
				const mat = glass.material as THREE.MeshPhysicalMaterial
				mat.roughness = 0.6 - 0.48 * progress
				const s = 0.8 + 0.2 * progress
				glass.scale.setScalar(s)
				glass.rotation.y = Math.sin(t * 0.3) * 0.06
				glass.rotation.x = Math.cos(t * 0.25) * 0.04
				key.position.x = Math.sin(t * 0.6) * 4
				renderer.render(scene, camera)
				raf = requestAnimationFrame(render)
			}
			render()

			const onResize = () => {
				renderer.setSize(el.clientWidth, el.clientHeight)
				camera.aspect = el.clientWidth / el.clientHeight
				camera.updateProjectionMatrix()
			}
			window.addEventListener('resize', onResize)

			cleanup = () => {
				cancelAnimationFrame(raf)
				window.removeEventListener('resize', onResize)
				renderer.dispose()
				glass.geometry.dispose()
				;(glass.material as THREE.Material).dispose()
				bg.geometry.dispose()
				;(bg.material as THREE.Material).dispose()
				renderer.forceContextLoss()
				el.removeChild(renderer.domElement)
			}
		})()

		return () => {
			disposed = true
			cleanup()
		}
	}, [dark])

	return <div ref={containerRef} className="absolute inset-0" aria-hidden />
}
