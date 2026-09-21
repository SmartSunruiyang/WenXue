export type GuideBlock = {
	id: string
	title: string
	paragraphs?: string[]
	steps?: string[]
	items?: { title: string; description: string }[]
	prompt?: string
	code?: { language: string; content: string }
	links?: { label: string; href: string; description?: string }[]
	video?: { src: string; label: string }
}

export type GuideArticle = {
	id: string
	group: string
	title: string
	description: string
	readingTime: string
	blocks: GuideBlock[]
}

export const defaultDocsSectionId = 'overview'

export const docsArticles: GuideArticle[] = [
	{
		id: 'overview',
		group: '开始使用',
		title: '认识问学',
		description: '把目标告诉 Agent，让它在你正在使用的网页里完成操作。',
		readingTime: '3 分钟',
		blocks: [
			{
				id: 'what-is-wenxue',
				title: '一个能动手的浏览器助手',
				paragraphs: [
					'问学是一个桌面应用。打开它创建的浏览器，就能使用预装的 AI 助手：理解网页内容、查找资料、点击按钮、填写信息，并在多个标签页之间接续任务。',
					'你可以在网页旁边看到任务过程，随时停止，补充要求或亲自接管。开始使用不需要编写脚本，也不需要手动安装浏览器扩展。',
				],
			},
			{
				id: 'what-you-can-do',
				title: '从这些任务开始',
				items: [
					{ title: '阅读与研究', description: '总结长文章、比较多个页面的信息，整理要点和来源。' },
					{ title: '整理与录入', description: '按你的说明整理网页表格，填写有权操作的表单。' },
					{ title: '学习与理解', description: '解释概念、梳理解题思路，辅助自学与练习。' },
					{ title: '跨页工作', description: '打开相关页面、切换标签页，把连续的网页步骤串起来。' },
				],
			},
			{
				id: 'three-places',
				title: '认识三个常用界面',
				items: [
					{
						title: '桌面端',
						description: '登录账号，创建和打开浏览器，查看日志、用量与应用设置。',
					},
					{
						title: '浏览器侧边栏',
						description: '描述任务、查看执行过程、停止或继续任务，以及查看历史。',
					},
					{
						title: '插件设置页',
						description: '选择模型、配置自定义服务，调整语言和网页上下文设置。',
					},
				],
			},
			{
				id: 'stay-in-control',
				title: '让每一步都在你的掌握中',
				paragraphs: [
					'Agent 可能理解错误，也可能执行会改变网页数据的操作。开始前请说清范围；涉及付款、发布、提交或删除时，明确要求先等待你确认，并持续查看执行过程。不要把提示词当作不可越过的安全开关。',
					'任务相关的网页内容会随模型请求发送至所选服务。处理私人或工作资料前，先了解模型提供方，并检查已打开的标签页和上下文设置。',
				],
				links: [
					{ label: '开始你的第一个任务', href: '#docs/customer-start' },
					{ label: '了解隐私与使用须知', href: '#privacy' },
				],
			},
		],
	},
	{
		id: 'customer-start',
		group: '开始使用',
		title: '快速上手',
		description: '从安装、登录到发出第一条指令，按这几个步骤开始。',
		readingTime: '5 分钟',
		blocks: [
			{
				id: 'install-and-sign-in',
				title: '1. 安装并登录',
				steps: [
					'从官网获取适合你系统的问学安装包，完成安装后打开桌面应用。',
					'输入完整邮箱，选择“使用邮箱继续”，按界面提示获取并填写验证码；已有账号也可以使用邮箱和密码登录。',
					'首次注册按提示设置密码，再选择昵称和头像，完成注册后进入工作台。',
				],
				paragraphs: [
					'验证码以当前界面显示的有效期和重发倒计时为准。没有收到邮件时，请先检查垃圾邮件和邮箱拼写。',
				],
				links: [{ label: '查看下载信息', href: '#download' }],
			},
			{
				id: 'create-browser',
				title: '2. 创建并打开浏览器',
				steps: [
					'进入桌面端“浏览器”页面，点击“新建浏览器”。',
					'为浏览器起一个方便识别的名称，例如“资料研究”或“日常工作”。',
					'在列表中点击“打开”，等待浏览器窗口出现。已经运行的浏览器可通过“打开窗口”重新显示。',
					'在浏览器里打开你要处理的网页；如果网页需要登录，请先完成该网站的登录。',
				],
				paragraphs: [
					'问学创建的浏览器使用自己的本机资料目录。已有浏览器可以从桌面列表再次打开；不同浏览器的登录状态需要分别管理。',
				],
			},
			{
				id: 'open-assistant',
				title: '3. 打开问学侧边栏',
				steps: [
					'点击浏览器工具栏中的问学图标，打开右侧侧边栏。',
					'如果看不到图标，先打开浏览器的扩展程序菜单，在列表中找到问学。',
					'点击问学旁的图钉，将入口固定在工具栏，之后就可以直接打开。',
					'检查当前选择的模型；需要更换或添加模型时，从侧边栏进入设置。',
				],
				links: [{ label: '了解模型与设置', href: '#docs/models' }],
			},
			{
				id: 'first-task',
				title: '4. 试试第一条指令',
				paragraphs: ['先从简单的阅读任务开始。打开一篇文章，把下面这句话发送给问学。'],
				prompt: '总结当前页面的主要观点，列出 3 个重点，并标出需要进一步核实的信息。',
				steps: [
					'观察侧边栏里的执行步骤，以及浏览器正在查看的页面。',
					'如果方向偏离，点击停止，再补充范围、目标或输出格式。',
					'遇到登录、验证码或权限提示时，由你完成相应操作后再继续。',
					'对照原页面检查结果，再将它用于后续工作。',
				],
			},
		],
	},
	{
		id: 'customer-workflows',
		group: '日常使用',
		title: '常见任务',
		description: '用清楚的目标、适当的范围和可检查的结果，组织一次网页任务。',
		readingTime: '4 分钟',
		blocks: [
			{
				id: 'research',
				title: '阅读与比较资料',
				paragraphs: [
					'打开相关页面，说明比较维度，并要求保留来源。任务较大时，先整理资料，再让问学进行分析。',
				],
				prompt:
					'比较已打开的这三篇文章，按观点、依据和局限整理成表格。每一行注明来源，不确定的地方标为待核实。',
				steps: [
					'检查是否打开了无关或敏感标签页。',
					'确认整理结果能够对应到原文。',
					'继续追问你需要深入理解的部分。',
				],
			},
			{
				id: 'forms',
				title: '整理信息与填写表单',
				paragraphs: [
					'明确哪些字段可以填写、信息来自哪里，以及在哪一步等待你。网页数据可能发生真实变化，请从范围较小、容易核对的任务开始。',
				],
				prompt:
					'根据我提供的信息填写当前表单，只处理姓名、部门和备注这三个字段。完成后列出填写结果，提交前先等我确认。',
				steps: [
					'先核对页面、账号和操作权限。',
					'执行时查看字段和页面变化。',
					'核对结果、必填项及提交影响，再决定下一步。',
				],
			},
			{
				id: 'learning',
				title: '学习与练习',
				paragraphs: [
					'问学可以帮助理解概念、分析题目和检查思路。请遵守课程与平台规则，不在禁止使用辅助工具的考试或评估中使用。',
				],
				prompt:
					'解释这道练习题涉及的概念，先给我一个提示，再分步骤讲解推理过程，最后提供一道类似的练习。',
			},
			{
				id: 'history',
				title: '回看历史与继续任务',
				paragraphs: [
					'在侧边栏的历史入口中，查看过去的任务、执行步骤与结果。继续已有任务前，先确认当前页面和登录状态仍与原任务一致。',
					'日志更适合排查运行问题。桌面端和插件设置页分别提供相应日志入口，分享导出内容前请检查并移除私人信息、凭据和敏感页面内容。',
				],
				links: [{ label: '任务遇到问题？', href: '#docs/troubleshooting' }],
			},
		],
	},
	{
		id: 'models',
		group: '日常使用',
		title: '模型与设置',
		description: '选择适合任务的模型，了解网页上下文会如何参与任务。',
		readingTime: '3 分钟',
		blocks: [
			{
				id: 'select-model',
				title: '选择模型',
				paragraphs: [
					'从问学侧边栏打开设置，在“模型”分组中查看可用模型。内置模型的可用性取决于当前账号和服务状态；实际列表以应用内显示为准。',
					'主模型负责理解任务和规划操作。需要识别页面图像时，视觉观察能力还依赖可用的多模态模型和页面状态；仅支持文本的模型不适合承担图像理解。',
				],
			},
			{
				id: 'custom-model',
				title: '添加自定义模型',
				steps: [
					'在模型设置中选择添加自定义模型，再选择厂商或自定义服务。',
					'根据服务提供方的说明填写 Base URL、模型名称与 API Key。',
					'核对地址和模型支持的能力，完成保存后在模型选择中切换到它。',
					'用一条简单任务检查连接；失败时核对服务地址、密钥权限、额度和网络。',
				],
				paragraphs: [
					'自定义服务需要兼容应用使用的 OpenAI-compatible 接口。仅有相同的模型名称并不代表接口、工具调用或视觉能力完全兼容。请勿将 API Key 粘贴到聊天、公开 Issue 或截图中。',
				],
			},
			{
				id: 'page-context',
				title: '管理网页上下文',
				items: [
					{
						title: '包含所有标签页',
						description:
							'检查这个选项，决定是否让其他已打开标签页参与上下文。处理敏感资料前，关闭无关页面并按需调整。',
					},
					{
						title: '网站 llms.txt',
						description:
							'用于读取网站向模型提供的说明。仅对你信任的网站按需开启，并注意网页内容可能包含误导性指令。',
					},
					{
						title: '语言与系统指令',
						description:
							'在设置中调整界面语言、回复语言和系统指令。指令有助于表达偏好，但不能保证模型每次都正确执行。',
					},
				],
			},
			{
				id: 'model-data',
				title: '了解模型服务的数据处理',
				paragraphs: [
					'任务请求可能包含你的指令、相关网页内容、对话上下文和按功能需要获得的图像。内置服务与自定义服务的数据流不同，供应商也可能有不同的保留、训练和跨境处理规则。使用前请查看问学与所选服务的说明。',
				],
				links: [{ label: '阅读隐私协议', href: '#privacy' }],
			},
		],
	},
	{
		id: 'troubleshooting',
		group: '日常使用',
		title: '常见问题',
		description: '从看到的现象出发，找到下一步可以采取的操作。',
		readingTime: '4 分钟',
		blocks: [
			{
				id: 'sign-in-help',
				title: '没有收到验证码，或无法登录',
				paragraphs: [
					'核对完整邮箱地址，检查垃圾邮件，并等待界面上的重发倒计时结束。避免连续重复请求。已有密码的账号可尝试密码登录；忘记密码时使用登录页的找回入口。',
					'如果提示网络或服务异常，请保留错误信息，检查网络后再重试。不要向他人提供验证码、密码或登录令牌。',
				],
			},
			{
				id: 'browser-help',
				title: '浏览器打不开，或找不到问学图标',
				steps: [
					'回到桌面端“浏览器”列表，查看对应项目的状态和错误提示。',
					'确认打开的是由问学启动的浏览器，再检查工具栏的扩展程序菜单。',
					'检查安装是否完整，以及系统是否拦截了应用或浏览器运行。',
					'仍然失败时，查看桌面端日志，记录发生时间、系统和问学版本，以便反馈。',
				],
			},
			{
				id: 'model-help',
				title: '模型请求失败',
				paragraphs: [
					'内置模型先检查账号登录状态和服务提示。自定义模型请核对 Base URL、API Key、模型名称、可用额度及网络连通性。地址必须与提供方要求的兼容接口一致。',
					'如果只有一个模型失败，可切换到另一个当前可用模型做简单任务，帮助判断是服务配置问题还是页面任务问题。',
				],
				links: [{ label: '查看模型配置说明', href: '#docs/models' }],
			},
			{
				id: 'task-help',
				title: '任务卡住、重复操作或读取不完整',
				paragraphs: [
					'先点击停止，确认网页是否仍在加载、需要登录，或出现了验证码、弹窗和权限提示。由你处理阻塞后，再用更小、更具体的目标继续。',
					'动态页面、嵌入页面、图片和 Canvas 内容可能影响读取与操作。视觉观察可以辅助理解部分页面，但不保证每种内容都能识别或操作；必要时补充文字说明，或手动完成对应步骤。',
				],
			},
			{
				id: 'report-issue',
				title: '怎样反馈一个问题',
				paragraphs: [
					'提供操作系统、问学版本、复现步骤、预期结果与实际表现。截图和日志请先脱敏；公开反馈中不要包含邮箱、密码、API Key、验证码或私人网页内容。',
				],
				links: [
					{ label: '在 GitHub 反馈问题', href: 'https://github.com/SmartSunruiyang/WenXue/issues' },
				],
			},
		],
	},
	{
		id: 'media-checklist',
		group: '日常使用',
		title: '操作演示',
		description: '通过实际录屏，看看如何打开问学，以及一次网页任务如何进行。',
		readingTime: '视频演示',
		blocks: [
			{
				id: 'toolbar-demo',
				title: '打开并固定问学',
				paragraphs: [
					'演示如何从浏览器工具栏找到问学，并把入口固定下来。不同版本的界面可能略有差异，操作名称以当前应用为准。',
				],
				video: { src: '/assets/wenxue-teaching-demo.mov', label: '打开并固定问学的操作演示' },
				links: [{ label: '阅读分步教程', href: '#docs/customer-start' }],
			},
			{
				id: 'task-demo',
				title: '让 Agent 操作网页',
				paragraphs: [
					'观察任务输入、网页操作和结果呈现的过程。录屏展示一个具体任务，实际执行结果会受网页、模型和网络状态影响。',
				],
				video: { src: '/assets/wenxue-work-demo.mov', label: '问学执行网页任务的操作演示' },
				links: [{ label: '探索常见任务', href: '#docs/customer-workflows' }],
			},
		],
	},
	{
		id: 'developer-guide',
		group: '开发',
		title: '开发者指南',
		description: '在本地运行官网，了解仓库结构与参与开发的入口。',
		readingTime: '4 分钟',
		blocks: [
			{
				id: 'source-code',
				title: '获取源码',
				paragraphs: [
					'问学使用 pnpm monorepo。开发环境使用 Node.js 22 LTS 与仓库声明的 pnpm 版本；开始修改前，先阅读仓库中的贡献规则和对应运行时的架构文档。',
				],
				links: [
					{
						label: 'SmartSunruiyang / WenXue',
						href: 'https://github.com/SmartSunruiyang/WenXue',
						description: '源码、README 与问题反馈',
					},
				],
				code: {
					language: 'shell',
					content:
						'git clone https://github.com/SmartSunruiyang/WenXue.git\ncd WenXue\npnpm install',
				},
			},
			{
				id: 'website-development',
				title: '运行与验证官网',
				paragraphs: [
					'官网位于 apps/website，使用 React、TypeScript 和 Vite。开发命令启动本地服务；测试与构建可分别执行。官网不读取桌面端或插件内的用户数据。',
				],
				code: {
					language: 'shell',
					content:
						'pnpm -F website dev\n\n# 验证网站测试与生产构建\npnpm -F website test\npnpm -F website build',
				},
			},
			{
				id: 'repository-layout',
				title: '了解仓库结构',
				items: [
					{ title: 'apps/desktop', description: '当前 Electron 桌面应用、浏览器资料与进程管理。' },
					{
						title: 'apps/extension',
						description: 'WXT / MV3 插件、Agent 编排、侧边栏和设置页面。',
					},
					{ title: 'apps/website', description: '对外官网、使用文档、隐私协议与用户须知。' },
					{
						title: 'packages/',
						description: '共享包与基于 page-agent 的 vendor 库，修改时遵守各自模块边界。',
					},
				],
			},
			{
				id: 'desktop-development',
				title: '桌面端与插件开发',
				paragraphs: [
					'当前桌面运行时使用 Chrome for Testing。首次开发需要获取浏览器资源；完整环境、平台要求及构建细节请以仓库 README 为准。',
				],
				code: {
					language: 'shell',
					content:
						'# 获取当前桌面运行时所需的浏览器\npnpm -F desktop fetch-browser\n\n# 构建插件并启动桌面开发环境\npnpm dev',
				},
				links: [
					{ label: '阅读仓库 README', href: 'https://github.com/SmartSunruiyang/WenXue#readme' },
				],
			},
		],
	},
]

export const docsGroups = [...new Set(docsArticles.map((article) => article.group))]

export function searchDocs(query: string) {
	const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
	if (!terms.length) return []
	return docsArticles.flatMap((article) => {
		const text = [
			article.title,
			article.description,
			...article.blocks.flatMap((block) => [
				block.title,
				...(block.paragraphs ?? []),
				...(block.steps ?? []),
				...(block.items?.map((item) => `${item.title}：${item.description}`) ?? []),
				block.prompt ?? '',
				block.code?.content ?? '',
				...(block.links?.map((link) => `${link.label} ${link.description ?? ''}`) ?? []),
			]),
		].join(' ')
		const normalized = text.toLocaleLowerCase()
		if (!terms.every((term) => normalized.includes(term))) return []
		const matchIndex = normalized.indexOf(terms[0])
		const start = Math.max(0, matchIndex - 26)
		const end = Math.min(text.length, start + 130)
		return [
			{
				article,
				excerpt: `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`,
			},
		]
	})
}
