import {
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	ArrowUpRight,
	BookOpen,
	ChevronDown,
	Menu,
	Search,
	X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
	defaultDocsSectionId,
	docsArticles,
	docsGroups,
	searchDocs,
	type GuideBlock,
} from './docsContent'
import './DocsPage.css'

type DocsPageProps = {
	activeSectionId: string
	onSectionChange: (id: string) => void
}

function GuideContent({ block, articleId }: { block: GuideBlock; articleId: string }) {
	return (
		<section className="guide-section" id={`guide-${articleId}-${block.id}`} tabIndex={-1}>
			<h2>{block.title}</h2>
			{block.paragraphs?.map((paragraph) => (
				<p key={paragraph}>{paragraph}</p>
			))}
			{block.prompt && (
				<blockquote className="guide-prompt">
					<span>试着这样说</span>
					<p>{block.prompt}</p>
				</blockquote>
			)}
			{block.steps && (
				<ol className="guide-steps">
					{block.steps.map((step) => (
						<li key={step}>{step}</li>
					))}
				</ol>
			)}
			{block.items && (
				<dl className="guide-definitions">
					{block.items.map((item) => (
						<div key={item.title}>
							<dt>{item.title}</dt>
							<dd>{item.description}</dd>
						</div>
					))}
				</dl>
			)}
			{block.code && (
				<div className="guide-code">
					<span>{block.code.language}</span>
					<pre tabIndex={0} aria-label={`${block.title}代码示例`}>
						<code>{block.code.content}</code>
					</pre>
				</div>
			)}
			{block.video && (
				<figure className="guide-video">
					<video
						controls
						playsInline
						preload="none"
						aria-label={block.video.label}
						src={block.video.src}
					>
						<a href={block.video.src}>打开演示视频</a>
					</video>
					<figcaption>
						{block.video.label} ·{' '}
						<a href={block.video.src} target="_blank" rel="noreferrer">
							单独打开视频 <ArrowUpRight size={13} aria-hidden="true" />
						</a>
					</figcaption>
				</figure>
			)}
			{block.links && (
				<div className="guide-links">
					{block.links.map((link) => (
						<a
							key={link.href}
							href={link.href}
							{...(link.href.startsWith('https:') ? { target: '_blank', rel: 'noreferrer' } : {})}
						>
							<span>
								{link.label}
								{link.description && <small>{link.description}</small>}
							</span>
							{link.href.startsWith('https:') ? (
								<ArrowUpRight size={16} aria-hidden="true" />
							) : (
								<ArrowRight size={16} aria-hidden="true" />
							)}
						</a>
					))}
				</div>
			)}
		</section>
	)
}

export default function DocsPage({ activeSectionId, onSectionChange }: DocsPageProps) {
	const article =
		docsArticles.find((item) => item.id === activeSectionId) ??
		docsArticles.find((item) => item.id === defaultDocsSectionId)!
	const articleIndex = docsArticles.indexOf(article)
	const previous = docsArticles[articleIndex - 1]
	const next = docsArticles[articleIndex + 1]
	const [query, setQuery] = useState('')
	const [navigationOpen, setNavigationOpen] = useState(false)
	const [outlineOpen, setOutlineOpen] = useState(false)
	const [activeHeading, setActiveHeading] = useState(article.blocks[0].id)
	const searchInput = useRef<HTMLInputElement>(null)
	const articleHeading = useRef<HTMLHeadingElement>(null)
	const hasQuery = query.trim().length > 0
	const results = searchDocs(query)

	useEffect(() => {
		setQuery('')
		setNavigationOpen(false)
		setOutlineOpen(false)
		setActiveHeading(article.blocks[0].id)
	}, [article.id])

	useEffect(() => {
		if (hasQuery) return
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((entry) => entry.isIntersecting)
					.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
				if (visible[0]) setActiveHeading(visible[0].target.id.replace(`guide-${article.id}-`, ''))
			},
			{ rootMargin: '-100px 0px -60% 0px', threshold: 0 },
		)
		for (const block of article.blocks) {
			const element = document.getElementById(`guide-${article.id}-${block.id}`)
			if (element) observer.observe(element)
		}
		return () => observer.disconnect()
	}, [article.id, hasQuery])

	function clearSearch() {
		setQuery('')
		searchInput.current?.focus()
	}

	function goToHeading(id: string) {
		setOutlineOpen(false)
		setActiveHeading(id)
		const element = document.getElementById(`guide-${article.id}-${id}`)
		element?.scrollIntoView({ block: 'start', behavior: 'instant' })
		element?.focus({ preventScroll: true })
	}

	function openSearchResult(id: string) {
		setQuery('')
		onSectionChange(id)
		requestAnimationFrame(() => {
			articleHeading.current?.focus({ preventScroll: true })
			window.scrollTo({ top: 0, behavior: 'instant' })
		})
	}

	const outline = article.blocks.map((block) => (
		<button
			key={block.id}
			type="button"
			className={activeHeading === block.id ? 'guide-outline-link is-active' : 'guide-outline-link'}
			onClick={() => goToHeading(block.id)}
			aria-current={activeHeading === block.id ? 'location' : undefined}
		>
			{block.title}
		</button>
	))

	return (
		<div className="guide-page" id="guide-main">
			<div className="guide-mobile-topline">
				<span>
					<BookOpen size={16} aria-hidden="true" /> 使用文档
				</span>
				<button
					type="button"
					aria-expanded={navigationOpen}
					aria-controls="guide-navigation"
					onClick={() => setNavigationOpen(!navigationOpen)}
				>
					<Menu size={16} aria-hidden="true" /> {navigationOpen ? '收起导航' : '文档导航'}
					<ChevronDown size={14} className={navigationOpen ? 'is-open' : ''} aria-hidden="true" />
				</button>
			</div>
			<div className="guide-layout">
				<aside className="guide-sidebar" aria-label="文档导航与搜索">
					<a className="guide-sidebar-title" href="#docs/overview">
						<BookOpen size={18} aria-hidden="true" /> 使用文档
					</a>
					<div className="guide-search">
						<Search size={16} aria-hidden="true" />
						<input
							ref={searchInput}
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="搜索文档"
							aria-label="搜索文档"
							onKeyDown={(event) => {
								if (event.key === 'Escape') clearSearch()
							}}
						/>
						{query && (
							<button type="button" onClick={clearSearch} aria-label="清空搜索" title="清空搜索">
								<X size={15} aria-hidden="true" />
							</button>
						)}
					</div>
					<nav
						id="guide-navigation"
						className={`guide-navigation${navigationOpen ? ' is-open' : ''}`}
						aria-label="文档章节"
					>
						{docsGroups.map((group) => (
							<div className="guide-nav-group" key={group}>
								<h2>{group}</h2>
								{docsArticles
									.filter((item) => item.group === group)
									.map((item) => (
										<a
											href={`#docs/${item.id}`}
											key={item.id}
											onClick={() => {
												setQuery('')
												setNavigationOpen(false)
											}}
											className={
												article.id === item.id ? 'guide-nav-link is-active' : 'guide-nav-link'
											}
											aria-current={article.id === item.id && !hasQuery ? 'page' : undefined}
										>
											{item.title}
										</a>
									))}
							</div>
						))}
						<a
							className="guide-repository"
							href="https://github.com/SmartSunruiyang/WenXue"
							target="_blank"
							rel="noreferrer"
						>
							GitHub 仓库 <ArrowUpRight size={14} aria-hidden="true" />
						</a>
					</nav>
				</aside>
				{hasQuery ? (
					<div className="guide-search-page">
						<div className="guide-breadcrumb">
							使用文档 <span>/</span> 搜索
						</div>
						<h1>搜索结果</h1>
						<p className="guide-search-status" role="status">
							找到 {results.length} 篇与「{query.trim()}」相关的文档
						</p>
						{results.length ? (
							<div className="guide-results">
								{results.map(({ article: result, excerpt }) => (
									<button
										className="guide-result"
										key={result.id}
										onClick={() => openSearchResult(result.id)}
										type="button"
									>
										<span className="guide-result-group">{result.group}</span>
										<span className="guide-result-title">
											{result.title}
											<ArrowRight size={18} aria-hidden="true" />
										</span>
										<span className="guide-result-excerpt">{excerpt}</span>
									</button>
								))}
							</div>
						) : (
							<div className="guide-no-results">
								<Search size={28} strokeWidth={1.5} aria-hidden="true" />
								<h2>没有找到相关内容</h2>
								<p>试试“登录”“模型”或“浏览器”，也可以缩短关键词。</p>
								<button type="button" onClick={clearSearch}>
									清空搜索 <ArrowRight size={16} aria-hidden="true" />
								</button>
							</div>
						)}
					</div>
				) : (
					<article className="guide-article">
						<header className="guide-article-header">
							<div className="guide-breadcrumb">
								使用文档 <span>/</span> {article.group}
							</div>
							<h1 ref={articleHeading} tabIndex={-1}>
								{article.title}
							</h1>
							<p className="guide-lead">{article.description}</p>
							<div className="guide-article-meta">
								问学使用指南 <span aria-hidden="true">·</span> {article.readingTime}
							</div>
						</header>
						<div className="guide-mobile-outline">
							<button
								type="button"
								aria-expanded={outlineOpen}
								aria-controls="guide-mobile-headings"
								onClick={() => setOutlineOpen(!outlineOpen)}
							>
								本页目录
								<ChevronDown
									size={16}
									className={outlineOpen ? 'is-open' : ''}
									aria-hidden="true"
								/>
							</button>
							{outlineOpen && (
								<nav id="guide-mobile-headings" aria-label="本页目录">
									{outline}
								</nav>
							)}
						</div>
						<div className="guide-article-content">
							{article.blocks.map((block) => (
								<GuideContent key={block.id} block={block} articleId={article.id} />
							))}
						</div>
						<nav className="guide-pagination" aria-label="上一篇和下一篇">
							{previous ? (
								<a href={`#docs/${previous.id}`}>
									<span>
										<ArrowLeft size={14} aria-hidden="true" /> 上一篇
									</span>
									<strong>{previous.title}</strong>
								</a>
							) : (
								<span />
							)}
							{next ? (
								<a href={`#docs/${next.id}`}>
									<span>
										下一篇 <ArrowRight size={14} aria-hidden="true" />
									</span>
									<strong>{next.title}</strong>
								</a>
							) : (
								<a href="#docs/overview">
									<span>
										回到开始 <ArrowRight size={14} aria-hidden="true" />
									</span>
									<strong>认识问学</strong>
								</a>
							)}
						</nav>
						<div className="guide-article-footer">
							<p>
								找不到答案？
								<a
									href="https://github.com/SmartSunruiyang/WenXue/issues"
									target="_blank"
									rel="noreferrer"
								>
									反馈问题 <ArrowUpRight size={13} aria-hidden="true" />
								</a>
							</p>
							<button
								type="button"
								onClick={() => {
									window.scrollTo({ top: 0, behavior: 'instant' })
									articleHeading.current?.focus({ preventScroll: true })
								}}
							>
								回到顶部 <ArrowDown size={13} aria-hidden="true" />
							</button>
						</div>
					</article>
				)}
				{!hasQuery && (
					<aside className="guide-outline">
						<h2>本页目录</h2>
						<nav aria-label="本页目录">{outline}</nav>
					</aside>
				)}
			</div>
		</div>
	)
}
