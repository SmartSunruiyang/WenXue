export const ANNOUNCEMENT_LIMITS = Object.freeze({
	title: 80,
	body: 1000,
	detailUrl: 2048,
	userIds: 500,
	defaultExpiryDays: 7,
	maxExpiryDays: 30,
})

export const RELEASE_PERCENTAGES = Object.freeze([1, 5, 25, 50, 100])

const DAY_MS = 24 * 60 * 60 * 1000
const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

const SHA256_CONSTANTS = Object.freeze([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

export function parseSemver(value) {
	if (typeof value !== 'string') return null
	const match = SEMVER_PATTERN.exec(value.trim())
	if (!match) return null
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4]
			? match[4].split('.').map((item) => (/^\d+$/.test(item) ? Number(item) : item))
			: [],
	}
}

export function isValidSemver(value) {
	return parseSemver(value) !== null
}

export function compareSemver(left, right) {
	const parsedLeft = parseSemver(left)
	const parsedRight = parseSemver(right)
	if (!parsedLeft || !parsedRight) throw new TypeError('Invalid semantic version')

	for (const field of ['major', 'minor', 'patch']) {
		const difference = parsedLeft[field] - parsedRight[field]
		if (difference !== 0) return difference < 0 ? -1 : 1
	}
	if (parsedLeft.prerelease.length === 0 && parsedRight.prerelease.length === 0) return 0
	if (parsedLeft.prerelease.length === 0) return 1
	if (parsedRight.prerelease.length === 0) return -1

	const length = Math.max(parsedLeft.prerelease.length, parsedRight.prerelease.length)
	for (let index = 0; index < length; index += 1) {
		const leftIdentifier = parsedLeft.prerelease[index]
		const rightIdentifier = parsedRight.prerelease[index]
		if (leftIdentifier === undefined) return -1
		if (rightIdentifier === undefined) return 1
		if (leftIdentifier === rightIdentifier) continue
		if (typeof leftIdentifier === 'number' && typeof rightIdentifier === 'string') return -1
		if (typeof leftIdentifier === 'string' && typeof rightIdentifier === 'number') return 1
		return leftIdentifier < rightIdentifier ? -1 : 1
	}
	return 0
}

export function versionInRange(version, minVersion, maxVersion) {
	if (!parseSemver(version)) return false
	if (minVersion && (!parseSemver(minVersion) || compareSemver(version, minVersion) < 0)) {
		return false
	}
	if (maxVersion && (!parseSemver(maxVersion) || compareSemver(version, maxVersion) > 0)) {
		return false
	}
	return true
}

export function isValidHttpsUrl(value) {
	if (typeof value !== 'string' || value.length === 0) return false
	try {
		return new globalThis.URL(value).protocol === 'https:'
	} catch {
		return false
	}
}

export function validateAnnouncementInput(input, options = {}) {
	if (!isRecord(input)) {
		return invalid('root', '消息内容格式无效')
	}

	const issues = []
	const title = readRequiredText(input.title, 'title', '标题', ANNOUNCEMENT_LIMITS.title, issues)
	const body = readRequiredText(input.body, 'body', '正文', ANNOUNCEMENT_LIMITS.body, issues)
	const importance = input.importance
	if (importance !== 'normal' && importance !== 'important') {
		issues.push({ field: 'importance', message: '请选择消息重要性' })
	}

	let detailUrl
	if (input.detailUrl !== undefined && input.detailUrl !== null && input.detailUrl !== '') {
		if (typeof input.detailUrl !== 'string') {
			issues.push({ field: 'detailUrl', message: '详情链接格式无效' })
		} else {
			detailUrl = input.detailUrl.trim()
			if (detailUrl.length > ANNOUNCEMENT_LIMITS.detailUrl) {
				issues.push({ field: 'detailUrl', message: '详情链接不能超过 2048 个字符' })
			} else if (!isValidHttpsUrl(detailUrl)) {
				issues.push({ field: 'detailUrl', message: '详情链接必须使用 HTTPS' })
			}
		}
	}

	const audience = validateAudience(input.audience, issues)
	const now = readNow(options.now)
	const maxExpiry = now + ANNOUNCEMENT_LIMITS.maxExpiryDays * DAY_MS
	let expiresAt = new Date(now + ANNOUNCEMENT_LIMITS.defaultExpiryDays * DAY_MS).toISOString()
	if (input.expiresAt !== undefined && input.expiresAt !== null && input.expiresAt !== '') {
		if (typeof input.expiresAt !== 'string') {
			issues.push({ field: 'expiresAt', message: '有效期格式无效' })
		} else {
			const timestamp = Date.parse(input.expiresAt)
			if (!Number.isFinite(timestamp) || timestamp <= now) {
				issues.push({ field: 'expiresAt', message: '有效期必须晚于当前时间' })
			} else if (timestamp > maxExpiry) {
				issues.push({ field: 'expiresAt', message: '有效期不能超过 30 天' })
			} else {
				expiresAt = new Date(timestamp).toISOString()
			}
		}
	}

	if (issues.length > 0) return { ok: false, issues }
	return {
		ok: true,
		value: {
			importance,
			title,
			body,
			...(detailUrl ? { detailUrl } : {}),
			audience,
			expiresAt,
		},
	}
}

export function validateReleasePublishInput(input) {
	if (!isRecord(input)) return invalid('root', '发布策略格式无效')
	const issues = []
	const candidateId = readRequiredText(input.candidateId, 'candidateId', '版本候选', 160, issues)
	const title = readRequiredText(input.title, 'title', '更新标题', 80, issues)
	const notes = readRequiredText(input.notes, 'notes', '更新说明', 2000, issues)
	const percentage = input.percentage
	if (!RELEASE_PERCENTAGES.includes(percentage)) {
		issues.push({ field: 'percentage', message: '请选择有效的放量比例' })
	}
	const mode = input.mode
	if (mode !== 'optional' && mode !== 'mandatory') {
		issues.push({ field: 'mode', message: '请选择更新模式' })
	}
	if (mode === 'mandatory' && percentage !== 100) {
		issues.push({ field: 'percentage', message: '强制更新必须使用 100% 放量' })
	}

	let minSupportedVersion
	if (
		input.minSupportedVersion !== undefined &&
		input.minSupportedVersion !== null &&
		input.minSupportedVersion !== ''
	) {
		if (
			typeof input.minSupportedVersion !== 'string' ||
			!isValidSemver(input.minSupportedVersion)
		) {
			issues.push({ field: 'minSupportedVersion', message: '最低版本必须是完整语义版本号' })
		} else {
			minSupportedVersion = input.minSupportedVersion.trim()
		}
	}

	if (issues.length > 0) return { ok: false, issues }
	return {
		ok: true,
		value: {
			candidateId,
			title,
			notes,
			percentage,
			mode,
			...(minSupportedVersion ? { minSupportedVersion } : {}),
		},
	}
}

export function matchesAudience(context, audience) {
	if (!isRecord(context) || !isRecord(audience)) return false
	if (!context.userId || !context.platform || !context.version) return false
	if (
		Array.isArray(audience.platforms) &&
		audience.platforms.length > 0 &&
		!audience.platforms.includes(context.platform)
	) {
		return false
	}
	if (
		Array.isArray(audience.userIds) &&
		audience.userIds.length > 0 &&
		!audience.userIds.includes(context.userId)
	) {
		return false
	}
	return versionInRange(context.version, audience.minVersion, audience.maxVersion)
}

export function canonicalJson(value) {
	if (value === null) return 'null'
	if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new TypeError('Canonical JSON requires finite numbers')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(',')}}`
	}
	throw new TypeError('Value is not valid canonical JSON')
}

export function rolloutBucket(releaseId, installId) {
	if (typeof releaseId !== 'string' || releaseId.length === 0) {
		throw new TypeError('releaseId is required')
	}
	if (typeof installId !== 'string' || installId.length === 0) {
		throw new TypeError('installId is required')
	}
	return sha256FirstWord(`${releaseId}${installId}`) % 100
}

function validateAudience(value, issues) {
	if (!isRecord(value)) {
		issues.push({ field: 'audience', message: '目标范围格式无效' })
		return {}
	}
	const audience = {}
	if (value.platforms !== undefined) {
		if (
			!Array.isArray(value.platforms) ||
			value.platforms.some((item) => item !== 'darwin' && item !== 'win32')
		) {
			issues.push({ field: 'audience.platforms', message: '平台范围格式无效' })
		} else if (value.platforms.length > 0) {
			audience.platforms = [...new Set(value.platforms)]
		}
	}

	for (const field of ['minVersion', 'maxVersion']) {
		const candidate = value[field]
		if (candidate === undefined || candidate === null || candidate === '') continue
		if (typeof candidate !== 'string' || !isValidSemver(candidate)) {
			issues.push({ field: `audience.${field}`, message: '版本必须是完整语义版本号' })
		} else {
			audience[field] = candidate.trim()
		}
	}
	if (
		audience.minVersion &&
		audience.maxVersion &&
		compareSemver(audience.minVersion, audience.maxVersion) > 0
	) {
		issues.push({ field: 'audience.maxVersion', message: '最高版本不能低于最低版本' })
	}

	if (value.userIds !== undefined) {
		if (!Array.isArray(value.userIds) || value.userIds.some((item) => typeof item !== 'string')) {
			issues.push({ field: 'audience.userIds', message: '用户 UID 列表格式无效' })
		} else {
			const normalized = value.userIds.map((item) => item.trim())
			if (normalized.length > ANNOUNCEMENT_LIMITS.userIds) {
				issues.push({ field: 'audience.userIds', message: '用户 UID 不能超过 500 个' })
			}
			if (normalized.some((item) => item.length === 0)) {
				issues.push({ field: 'audience.userIds', message: '用户 UID 不能为空' })
			}
			if (new Set(normalized).size !== normalized.length) {
				issues.push({ field: 'audience.userIds', message: '用户 UID 不能重复' })
			}
			if (normalized.length > 0) audience.userIds = normalized
		}
	}
	return audience
}

function readRequiredText(value, field, label, maxLength, issues) {
	if (typeof value !== 'string' || value.trim().length === 0) {
		issues.push({ field, message: `请输入${label}` })
		return ''
	}
	const normalized = value.trim()
	if (normalized.length > maxLength) {
		issues.push({ field, message: `${label}不能超过 ${maxLength} 个字符` })
	}
	return normalized
}

function readNow(value) {
	if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime()
	if (typeof value === 'number' && Number.isFinite(value)) return value
	return Date.now()
}

function invalid(field, message) {
	return { ok: false, issues: [{ field, message }] }
}

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rotateRight(value, distance) {
	return (value >>> distance) | (value << (32 - distance))
}

function sha256FirstWord(value) {
	const input = new globalThis.TextEncoder().encode(value)
	const paddedLength = Math.ceil((input.length + 9) / 64) * 64
	const bytes = new Uint8Array(paddedLength)
	bytes.set(input)
	bytes[input.length] = 0x80
	const bitLength = input.length * 8
	const view = new DataView(bytes.buffer)
	view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000))
	view.setUint32(paddedLength - 4, bitLength >>> 0)

	const hash = new Uint32Array([
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
	])
	const words = new Uint32Array(64)
	for (let offset = 0; offset < bytes.length; offset += 64) {
		for (let index = 0; index < 16; index += 1) {
			words[index] = view.getUint32(offset + index * 4)
		}
		for (let index = 16; index < 64; index += 1) {
			const first = words[index - 15]
			const second = words[index - 2]
			const sigma0 = rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3)
			const sigma1 = rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10)
			words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0
		}

		let [a, b, c, d, e, f, g, h] = hash
		for (let index = 0; index < 64; index += 1) {
			const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
			const choice = (e & f) ^ (~e & g)
			const temporary1 = (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0
			const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
			const majority = (a & b) ^ (a & c) ^ (b & c)
			const temporary2 = (sum0 + majority) >>> 0
			h = g
			g = f
			f = e
			e = (d + temporary1) >>> 0
			d = c
			c = b
			b = a
			a = (temporary1 + temporary2) >>> 0
		}

		hash[0] = (hash[0] + a) >>> 0
		hash[1] = (hash[1] + b) >>> 0
		hash[2] = (hash[2] + c) >>> 0
		hash[3] = (hash[3] + d) >>> 0
		hash[4] = (hash[4] + e) >>> 0
		hash[5] = (hash[5] + f) >>> 0
		hash[6] = (hash[6] + g) >>> 0
		hash[7] = (hash[7] + h) >>> 0
	}
	return hash[0]
}
