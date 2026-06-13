import { describe, expect, it } from 'vitest'

import {
	addQuickLink,
	DEFAULT_QUICK_LINKS,
	normalizeQuickLinks,
	normalizeUrl,
	removeQuickLink,
	reorderQuickLinks,
	updateQuickLink,
} from '@/lib/quickLinks'

describe('normalizeUrl', () => {
	it('prepends https when protocol missing', () => {
		expect(normalizeUrl('example.com')).toBe('https://example.com/')
	})
	it('keeps existing protocol', () => {
		expect(normalizeUrl('http://a.test/')).toBe('http://a.test/')
	})
	it('returns null for blank or invalid', () => {
		expect(normalizeUrl('   ')).toBeNull()
		expect(normalizeUrl('http://')).toBeNull()
	})
})

describe('normalizeQuickLinks', () => {
	it('uses the WenXue default quick entries in order', () => {
		expect(DEFAULT_QUICK_LINKS.map(({ title, url }) => ({ title, url }))).toEqual([
			{ title: '百度', url: 'https://www.baidu.com' },
			{ title: '学习通', url: 'https://www.chaoxing.com' },
			{ title: '必应中国', url: 'https://cn.bing.com' },
		])
	})
	it('falls back to defaults for non-array', () => {
		expect(normalizeQuickLinks(undefined)).toEqual(DEFAULT_QUICK_LINKS)
	})
	it('drops entries without title or valid url, normalizes url', () => {
		const out = normalizeQuickLinks([
			{ id: 'a', title: 'A', url: 'a.com' },
			{ id: 'b', title: '', url: 'b.com' },
			{ id: 'c', title: 'C', url: 'not a url ::' },
		])
		expect(out).toHaveLength(1)
		expect(out[0]).toMatchObject({ id: 'a', title: 'A', url: 'https://a.com/' })
	})
})

describe('CRUD + reorder', () => {
	const base = [
		{ id: '1', title: 'One', url: 'https://1.test/' },
		{ id: '2', title: 'Two', url: 'https://2.test/' },
	]
	it('adds a normalized link', () => {
		const out = addQuickLink(base, { title: ' Three ', url: '3.test' })
		expect(out).toHaveLength(3)
		expect(out[2]).toMatchObject({ title: 'Three', url: 'https://3.test/' })
		expect(out[2].id).toBeTruthy()
	})
	it('ignores invalid add', () => {
		expect(addQuickLink(base, { title: '', url: '3.test' })).toEqual(base)
		expect(addQuickLink(base, { title: 'x', url: '' })).toEqual(base)
	})
	it('updates fields, keeping old url on invalid', () => {
		const out = updateQuickLink(base, '1', { title: 'Uno', url: 'bad ::' })
		expect(out[0]).toMatchObject({ title: 'Uno', url: 'https://1.test/' })
	})
	it('removes by id', () => {
		expect(removeQuickLink(base, '1')).toHaveLength(1)
	})
	it('reorders to index', () => {
		expect(reorderQuickLinks(base, '2', 0).map((l) => l.id)).toEqual(['2', '1'])
	})
	it('reorders forward without off-by-one (insert before drop target)', () => {
		const four = [
			{ id: 'a', title: 'A', url: 'https://a.test/' },
			{ id: 'b', title: 'B', url: 'https://b.test/' },
			{ id: 'c', title: 'C', url: 'https://c.test/' },
			{ id: 'd', title: 'D', url: 'https://d.test/' },
		]
		expect(reorderQuickLinks(four, 'a', 2).map((l) => l.id)).toEqual(['b', 'a', 'c', 'd'])
		expect(reorderQuickLinks(four, 'd', 1).map((l) => l.id)).toEqual(['a', 'd', 'b', 'c'])
	})
})
