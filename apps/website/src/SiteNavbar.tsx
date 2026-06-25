import { Download } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

export const websiteSloganSrc = '/assets/wenxue-slogan.png'

export type SiteNavbarLinkKind = 'docs' | 'download' | 'github'
export type SiteNavbarPlacement = 'left' | 'right'

export interface SiteNavbarCopy {
	brandAlt: string
	docs: string
	download: string
	github: string
}

export interface SiteNavbarLink {
	kind: SiteNavbarLinkKind
	label: string
	placement: SiteNavbarPlacement
	href?: string
	external?: boolean
}

interface SiteNavbarProps {
	copy: SiteNavbarCopy
	githubUrl: string
	isDocsActive?: boolean
	onDocs: () => void
	onDownload: () => void
	onHome: () => void
}

export function buildSiteNavbarLinks(copy: SiteNavbarCopy, githubUrl: string): SiteNavbarLink[] {
	return [
		{
			kind: 'docs',
			label: copy.docs,
			placement: 'left',
		},
		{
			kind: 'download',
			label: copy.download,
			placement: 'right',
		},
		{
			kind: 'github',
			label: copy.github,
			placement: 'right',
			href: githubUrl,
			external: true,
		},
	]
}

export default function SiteNavbar({
	copy,
	githubUrl,
	isDocsActive = false,
	onDocs,
	onDownload,
	onHome,
}: SiteNavbarProps) {
	const links = buildSiteNavbarLinks(copy, githubUrl)
	const docsLink = links.find((link) => link.kind === 'docs')
	const downloadLink = links.find((link) => link.kind === 'download')
	const githubLink = links.find((link) => link.kind === 'github')
	const [isScrolled, setIsScrolled] = useState(false)
	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
	const linksRef = useRef<HTMLDivElement | null>(null)
	const docsButtonRef = useRef<HTMLButtonElement | null>(null)
	const highlightRef = useRef<HTMLSpanElement | null>(null)

	const hideHighlight = useCallback(() => {
		const highlight = highlightRef.current
		if (!highlight) {
			return
		}

		highlight.style.opacity = '0'
	}, [])

	const showHighlight = useCallback((target: HTMLElement) => {
		const linksElement = linksRef.current
		const highlight = highlightRef.current
		if (!linksElement || !highlight) {
			return
		}

		const targetRect = target.getBoundingClientRect()
		const linksRect = linksElement.getBoundingClientRect()
		highlight.style.width = `${targetRect.width}px`
		highlight.style.height = `${targetRect.height}px`
		highlight.style.transform = `translate3d(${targetRect.left - linksRect.left}px, ${
			targetRect.top - linksRect.top
		}px, 0)`
		highlight.style.opacity = '1'
	}, [])

	const resetHighlight = useCallback(() => {
		if (isDocsActive && docsButtonRef.current) {
			showHighlight(docsButtonRef.current)
			return
		}

		hideHighlight()
	}, [hideHighlight, isDocsActive, showHighlight])

	useEffect(() => {
		const handleScroll = () => setIsScrolled(window.scrollY > 50)
		handleScroll()

		window.addEventListener('scroll', handleScroll, { passive: true })
		return () => window.removeEventListener('scroll', handleScroll)
	}, [])

	useEffect(() => {
		const handleResize = () => {
			if (window.matchMedia('(min-width: 761px)').matches) {
				setIsMobileMenuOpen(false)
			}

			window.requestAnimationFrame(resetHighlight)
		}

		window.addEventListener('resize', handleResize)
		return () => window.removeEventListener('resize', handleResize)
	}, [resetHighlight])

	useEffect(() => {
		const frame = window.requestAnimationFrame(resetHighlight)
		return () => window.cancelAnimationFrame(frame)
	}, [resetHighlight])

	const handleDocs = () => {
		setIsMobileMenuOpen(false)
		onDocs()
	}

	const handleDownload = () => {
		setIsMobileMenuOpen(false)
		onDownload()
	}

	return (
		<header
			className={`site-navbar ${isScrolled ? 'site-navbar-scrolled' : ''}`}
			aria-label="WenXue"
		>
			<div className="site-navbar-inner">
				<div className="site-navbar-left">
					<button className="site-navbar-logo" onClick={onHome} type="button">
						<img src={websiteSloganSrc} alt={copy.brandAlt} />
					</button>
					<span className="site-navbar-divider" aria-hidden="true">
						/
					</span>
					<nav className="site-navbar-links" aria-label="Primary" onMouseLeave={resetHighlight}>
						<div className="site-navbar-link-track" ref={linksRef}>
							<span className="site-navbar-link-highlight" ref={highlightRef} aria-hidden="true" />
							<button
								className={`site-navbar-link ${isDocsActive ? 'site-navbar-link-active' : ''}`}
								onBlur={resetHighlight}
								onClick={handleDocs}
								onFocus={(event) => showHighlight(event.currentTarget)}
								onMouseEnter={(event) => showHighlight(event.currentTarget)}
								ref={docsButtonRef}
								type="button"
							>
								{docsLink?.label ?? copy.docs}
							</button>
						</div>
					</nav>
				</div>

				<div className="site-navbar-right">
					<button
						className="site-navbar-action site-navbar-action-primary"
						onClick={handleDownload}
						type="button"
					>
						<Download size={15} />
						<span>{downloadLink?.label ?? copy.download}</span>
					</button>
					<a
						className="site-navbar-action site-navbar-action-secondary"
						href={githubLink?.href ?? githubUrl}
						rel={githubLink?.external ? 'noreferrer' : undefined}
						target={githubLink?.external ? '_blank' : undefined}
					>
						<GitHubMark size={15} />
						<span>{githubLink?.label ?? copy.github}</span>
					</a>
					<button
						aria-controls="site-navbar-mobile-menu"
						aria-expanded={isMobileMenuOpen}
						aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
						className={`site-navbar-hamburger ${
							isMobileMenuOpen ? 'site-navbar-hamburger-open' : ''
						}`}
						onClick={() => setIsMobileMenuOpen((current) => !current)}
						type="button"
					>
						<span />
						<span />
					</button>
				</div>

				<div
					aria-hidden={!isMobileMenuOpen}
					className={`site-navbar-mobile-menu ${isMobileMenuOpen ? 'site-navbar-mobile-menu-open' : ''}`}
					id="site-navbar-mobile-menu"
				>
					<button className="site-navbar-mobile-link" onClick={handleDocs} type="button">
						{docsLink?.label ?? copy.docs}
					</button>
					<button className="site-navbar-mobile-link" onClick={handleDownload} type="button">
						{downloadLink?.label ?? copy.download}
					</button>
					<a
						className="site-navbar-mobile-link"
						href={githubLink?.href ?? githubUrl}
						onClick={() => setIsMobileMenuOpen(false)}
						rel={githubLink?.external ? 'noreferrer' : undefined}
						target={githubLink?.external ? '_blank' : undefined}
					>
						{githubLink?.label ?? copy.github}
					</a>
				</div>
			</div>
		</header>
	)
}

function GitHubMark({ size }: { size: number }) {
	return (
		<svg aria-hidden="true" fill="currentColor" height={size} viewBox="0 0 16 16" width={size}>
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.59 7.59 0 0 1 8 3.86c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
		</svg>
	)
}
