import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSiteNavbarLinks, websiteSloganSrc, type SiteNavbarCopy } from './SiteNavbar'

const copy: SiteNavbarCopy = {
	brandAlt: '问学 ask for everything',
	docs: '文档',
	download: '下载问学',
	github: 'GitHub',
}

test('buildSiteNavbarLinks mirrors the React Bits style nav content without language switching', () => {
	const links = buildSiteNavbarLinks(copy, 'https://github.com/SmartSunruiyang/WenXue')

	assert.equal(websiteSloganSrc, '/assets/wenxue-slogan.png')
	assert.deepEqual(
		links.map((link) => [link.kind, link.label, link.placement]),
		[
			['docs', '文档', 'left'],
			['download', '下载问学', 'right'],
			['github', 'GitHub', 'right'],
		],
	)
	assert.equal(
		links.find((link) => link.kind === 'github')?.href,
		'https://github.com/SmartSunruiyang/WenXue',
	)
	assert.equal(
		links.some((link) => ['EN', '中文'].includes(link.label)),
		false,
	)
})
