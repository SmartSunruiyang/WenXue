import type { QuestionSolverResult } from './contracts'
import type { QuestionSolverCapabilityRequest } from './orchestrator'

export interface VisualCapabilityContext {
	signal?: AbortSignal
}

export interface QuestionSolverCapabilityHandler {
	execute(
		request: QuestionSolverCapabilityRequest,
		context: VisualCapabilityContext,
	): Promise<QuestionSolverResult>
}

export class VisualCapabilityRegistry {
	private readonly questionSolver?: QuestionSolverCapabilityHandler

	constructor(handlers: { questionSolver?: QuestionSolverCapabilityHandler }) {
		this.questionSolver = handlers.questionSolver
	}

	has(name: string): name is 'question_solver' {
		return name === 'question_solver' && this.questionSolver !== undefined
	}

	async dispatch(
		capability: QuestionSolverCapabilityRequest & { name: 'question_solver' },
		context: VisualCapabilityContext,
	): Promise<QuestionSolverResult> {
		if (!this.questionSolver) throw new Error('question_solver_capability_unavailable')
		return this.questionSolver.execute(capability, context)
	}
}
