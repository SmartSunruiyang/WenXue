import { ArrowUp, ArrowUpRight, Mail } from 'lucide-react'
import { policies, policyReviewNotice, policyUpdatedAt, type PolicyId } from './policyContent'
import './PrivacyPage.css'

export default function PrivacyPage({ policyId }: { policyId: PolicyId }) {
	const policy = policies[policyId]
	return (
		<div className="policy-page">
			<header className="policy-header" id="policy-top">
				<p className="policy-eyebrow">问学 · 隐私与使用</p>
				<h1>隐私与用户须知</h1>
				<p className="policy-intro">
					了解问学如何处理你的信息，
					<br className="policy-mobile-break" />
					以及使用浏览器 Agent 时需要知道的事。
				</p>
			</header>
			<nav className="policy-tabs" aria-label="隐私与用户须知">
				<a
					href="#privacy/privacy-policy"
					aria-current={policyId === 'privacy-policy' ? 'page' : undefined}
				>
					隐私协议
				</a>
				<a
					href="#privacy/terms-of-use"
					aria-current={policyId === 'terms-of-use' ? 'page' : undefined}
				>
					用户须知
				</a>
			</nav>
			<div className="policy-layout">
				<aside className="policy-sidebar">
					<nav aria-label={`${policy.title}目录`}>
						<p>本页内容</p>
						<ol>
							{policy.sections.map((section, index) => (
								<li key={section.id}>
									<a href={`#privacy/${policyId}/${section.id}`}>
										<span>{String(index + 1).padStart(2, '0')}</span>
										{section.title}
									</a>
								</li>
							))}
						</ol>
					</nav>
					<a className="policy-contact-link" href="mailto:contact@askwenxue.com">
						<Mail size={15} />
						联系隐私团队
						<ArrowUpRight size={14} />
					</a>
				</aside>
				<article className="policy-article">
					<header className="policy-article-header">
						<div className="policy-meta">
							<span>协议草案</span>
							<span>更新于 {policyUpdatedAt}</span>
						</div>
						<h2>{policy.title}</h2>
						<p>{policy.description}</p>
					</header>
					<p className="policy-review-note">{policyReviewNotice}</p>
					<details className="policy-mobile-toc">
						<summary>浏览本页目录</summary>
						<ol>
							{policy.sections.map((section) => (
								<li key={section.id}>
									<a
										href={`#privacy/${policyId}/${section.id}`}
										onClick={(event) => {
											event.currentTarget.closest('details')?.removeAttribute('open')
										}}
									>
										{section.title}
									</a>
								</li>
							))}
						</ol>
					</details>
					{policy.sections.map((section, index) => (
						<section className="policy-section" id={section.id} key={section.id}>
							<h3>
								<span>{String(index + 1).padStart(2, '0')}</span>
								{section.title}
							</h3>
							{section.paragraphs.map((paragraph) => (
								<p key={paragraph}>{paragraph}</p>
							))}
							{section.items && (
								<ul>
									{section.items.map((item) => (
										<li key={item}>{item}</li>
									))}
								</ul>
							)}
						</section>
					))}
					<div className="policy-bottom">
						<div>
							<h3>有关隐私或使用的问题？</h3>
							<p>你可以通过邮件联系 Askwenxue.com opc。</p>
							<a href="mailto:contact@askwenxue.com">
								contact@askwenxue.com <ArrowUpRight size={15} />
							</a>
						</div>
						<a href={`#privacy/${policyId}/policy-top`} className="policy-back-top">
							回到顶部
							<ArrowUp size={15} />
						</a>
					</div>
				</article>
			</div>
		</div>
	)
}
