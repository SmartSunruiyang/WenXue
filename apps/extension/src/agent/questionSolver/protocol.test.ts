import { describe, expect, it } from 'vitest'

import {
	assertJsonValue,
	assertMainWorldParentAllows,
	parseMainWorldRequest,
	parseSolverControlRequest,
	parseSolverReleaseRequest,
	QuestionSolverProtocolError,
} from './protocol'

describe('question solver protocol', () => {
	it('parses a strict read request and rejects unknown fields', () => {
		expect(parseSolverControlRequest(solverRequest('extract'))).toMatchObject({
			kind: 'request',
			operation: 'extract',
		})
		expect(() =>
			parseSolverControlRequest({ ...solverRequest('extract'), unexpected: true }),
		).toThrowError(QuestionSolverProtocolError)
	})

	it('requires exact document identity for every effect-capable operation', () => {
		const { documentId: _readDocumentId, ...readTarget } = frame()
		const read = { ...solverRequest('extract'), target: readTarget }
		expect(() => parseSolverControlRequest(read)).not.toThrow()
		const { documentId: _fillDocumentId, ...fillTarget } = frame()
		const fill = { ...solverRequest('fill'), target: fillTarget }
		expect(() => parseSolverControlRequest(fill)).toThrowError('document_identity_unavailable')
	})

	it('allows cleanup phase only for the frozen cleanup operations', () => {
		expect(() =>
			parseSolverControlRequest({ ...solverRequest('state_restore'), phase: 'cleanup' }),
		).not.toThrow()
		expect(() =>
			parseSolverControlRequest({ ...solverRequest('fill'), phase: 'cleanup' }),
		).toThrowError('cleanup_operation_forbidden')
	})

	it('binds release messages to one strict frame document', () => {
		const release = {
			type: 'QUESTION_SOLVER_RELEASE',
			protocolVersion: 1,
			identity: { taskId: 'task', taskEpoch: 1, runId: 'run' },
			target: frame(),
			preserveRecovery: false,
		}
		expect(parseSolverReleaseRequest(release)).toMatchObject({ target: frame() })
		expect(() => parseSolverReleaseRequest({ ...release, target: undefined })).toThrowError(
			'invalid_solver_release',
		)
		expect(() => parseSolverReleaseRequest({ ...release, unexpected: true })).toThrowError(
			'invalid_solver_release',
		)
	})

	it('requires setter transaction metadata and rejects executable payload fields', () => {
		const valid = mainRequest()
		expect(parseMainWorldRequest(valid)).toMatchObject({ operationId: 'common.native_input_set' })
		expect(() => parseMainWorldRequest({ ...valid, snapshotDigest: undefined })).toThrowError(
			'setter_effect_metadata_required',
		)
		expect(() =>
			parseMainWorldRequest({ ...valid, args: { script: 'document.body.innerHTML = "x"' } }),
		).toThrowError('executable_payload_forbidden')
	})

	it('binds every MAIN operation to its live parent request kind', () => {
		expect(() => assertMainWorldParentAllows('fill', 'common.native_input_set')).not.toThrow()
		expect(() => assertMainWorldParentAllows('extract', 'common.native_input_set')).toThrowError(
			'main_world_parent_operation_mismatch',
		)
		expect(() =>
			assertMainWorldParentAllows('ready', 'common.network_quiet_snapshot'),
		).not.toThrow()
	})

	it('forbids image bytes on ordinary JSON channels', () => {
		expect(() => assertJsonValue({ image: 'data:image/png;base64,AAAA' }, false)).toThrowError(
			'embedded_image_payload_forbidden',
		)
		expect(() =>
			assertJsonValue({ kind: 'question_solver_image_asset', base64: 'AAAA' }, false),
		).toThrowError('image_envelope_channel_forbidden')
		expect(() =>
			assertJsonValue({ kind: 'question_solver_image_asset', base64: 'AAAA' }, true),
		).not.toThrow()
	})
})

function solverRequest(operation: string) {
	return {
		type: 'QUESTION_SOLVER_CONTROL',
		protocolVersion: 1,
		kind: 'request',
		identity: { taskId: 'task', taskEpoch: 1, runId: 'run' },
		requestId: 'request-1',
		requestSeq: 1,
		leaseToken: 'l'.repeat(32),
		target: frame(),
		adapter: { platform: 'generic', variant: 'generic.standard_html', version: 1 },
		operation,
		payload: {},
	}
}

function mainRequest() {
	return {
		type: 'QUESTION_SOLVER_MAIN_WORLD',
		protocolVersion: 1,
		kind: 'request',
		identity: { taskId: 'task', taskEpoch: 1, runId: 'run' },
		requestId: 'main-1',
		parentRequestId: 'request-1',
		phase: 'business',
		leaseToken: 'l'.repeat(32),
		target: frame(),
		adapter: { platform: 'generic', variant: 'generic.standard_html', version: 1 },
		operationId: 'common.native_input_set',
		transactionId: 'transaction-1',
		snapshotDigestVersion: 1,
		snapshotDigest: 'a'.repeat(64),
		questionFingerprint: 'b'.repeat(64),
		args: { values: [{ key: '1', value: 'answer' }] },
	}
}

function frame() {
	return {
		tabId: 1,
		frameId: 0,
		parentFrameId: -1,
		documentId: 'document-1',
		documentToken: 'document-token',
		urlFingerprint: 'f'.repeat(64),
	}
}
