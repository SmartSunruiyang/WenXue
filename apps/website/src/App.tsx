import {
	ArrowDown,
	Circle,
	Code2,
	Compass,
	Download,
	ExternalLink,
	Globe2,
	Lock,
	MousePointer2,
	Pin,
	Play,
	Send,
	Sparkles,
	Terminal,
	X,
} from 'lucide-react'
import {
	useEffect,
	useRef,
	useState,
	type AnchorHTMLAttributes,
	type ButtonHTMLAttributes,
	type ReactNode,
} from 'react'
import DotField from './DotField'
import SiteNavbar, { type SiteNavbarCopy } from './SiteNavbar'
import TiltHover from './TiltHover'
import VariableProximity from './VariableProximity'

type Language = 'zh' | 'en'
type SitePage = 'home' | 'docs'

const githubUrl = 'https://github.com/SmartSunruiyang/WenXue'

const translations = {
	zh: {
		nav: {
			brandAlt: '问学 ask for everything',
			docs: '文档',
			github: 'GitHub',
		},
		hero: {
			brand: '问学 WenXue',
			version: 'v0.0.1 beta',
			titleFirst: '在真实网页里，',
			titleSecond: '直接让 AI 动手',
			description:
				'问学启动一个预装 AI 助手的浏览器，research、答题、总结、表单操作都在你的工作现场完成。',
			download: '下载问学',
			demo: '看演示',
			scroll: '查看演示',
		},
		browser: {
			eyebrow: '浏览器里的问学',
			titleFirst: '下滑一次，',
			titleSecond: '看见它怎样出现。',
			tabLabel: '问学使用步骤',
			newTab: '新建标签页',
			favorite: '收藏',
			openPlugin: '打开问学插件',
			pinPlugin: '固定问学插件',
			sendTask: '发送任务',
			sidepanelName: '问学',
			breadcrumb: 'Computer Science · Machine Learning',
			paperTitle: 'Large Language Models are Reasoners with Self-Verification',
			authors: 'Xuehai Pan, Li Dong, Furu Wei',
			abstractTitle: 'Abstract',
			abstract:
				'We introduce a simple method that lets models critique, refine, and verify their own responses across web tasks.',
			questionLabel: '页面题目',
			question: '根据本文摘要，模型自我验证的主要作用是什么？',
			choiceA: 'A. 压缩上下文',
			choiceB: 'B. 检查并修正答案',
			steps: [
				{ id: 'summon', title: '呼出插件', description: '在浏览器工具栏打开问学。' },
				{ id: 'pin', title: '固定到顶部', description: '把问学留在每个网页旁边。' },
				{ id: 'task', title: '输入任务', description: '让 AI 在当前网页里执行。' },
			],
			tasks: ['总结这页重点', '回答页面题目', '整理成表格'],
			results: [
				'已提炼摘要、贡献与适用边界。',
				'已读取题干，答案建议为 B。',
				'已整理为两列对照表，可继续导出。',
			],
		},
		finalCta: {
			title: '让 AI 在真实网页里，成为你的得力助手',
			platforms: 'macOS / Windows',
		},
		docs: {
			eyebrow: 'WenXue Docs',
			title: '问学 WenXue',
			description:
				'问学是一个桌面应用，它启动一个预装 AI 助手插件的浏览器，让网页 research、答题、总结和表单操作都发生在真实网页里。',
			backHome: '回到主页',
			download: '下载问学',
			github: '查看仓库',
			repo: 'SmartSunruiyang / WenXue',
			contents: '目录',
			badges: ['Desktop Launcher', 'Chrome for Testing', 'MV3 Extension', 'OpenAI-compatible'],
			toc: [
				{ id: 'quick-start', label: '快速开始' },
				{ id: 'workflow', label: '完整操作流程' },
				{ id: 'features', label: '功能特性' },
				{ id: 'troubleshooting', label: '故障排查' },
				{ id: 'boundaries', label: '能力边界' },
			],
			quickStart: {
				title: '快速开始',
				steps: [
					'下载并打开问学桌面端，确认桌面端状态显示为“未运行”。',
					'点击“启动浏览器”，问学会启动独立的 Chrome for Testing，并自动注入问学插件。',
					'进入你要处理的网页，例如资料页、在线题目页、表单页或后台系统。',
					'点击浏览器顶部工具栏里的问学图标，打开右侧 AI 侧边栏。',
					'将问学插件固定在顶部，后续每个网页都可以一键呼出。',
					'输入任务，例如“总结这页重点”“回答页面题目”“把表格信息整理成清单”。',
					'观察 Agent 执行过程，必要时点击停止，或在登录、验证码、权限确认时人工接管。',
				],
			},
			workflow: {
				title: '完整操作流程',
				groups: [
					{
						title: '1. 安装与首次启动',
						steps: [
							'打开问学 App。',
							'桌面端自检浏览器二进制和插件资源。',
							'点击启动后，问学创建独立用户画像目录，不污染系统 Chrome。',
							'浏览器启动成功后，状态从“启动中”切换为“运行中”。',
						],
					},
					{
						title: '2. 配置模型',
						steps: [
							'在侧边栏右上角打开设置。',
							'默认模型为内置 Qwen；高级用户可添加 OpenAI-compatible 服务。',
							'填写厂商、Base URL、API Key 与模型名。',
							'保存后从输入框底部模型菜单切换默认模型。',
						],
					},
					{
						title: '3. 执行网页任务',
						steps: [
							'在目标网页打开问学侧边栏。',
							'用自然语言描述目标，不需要写选择器或脚本。',
							'Agent 读取 DOM 文本、调用 LLM 决策、执行点击/输入/滚动/切换标签页。',
							'完成后返回结果总结，并将执行过程写入本地历史。',
						],
					},
					{
						title: '4. 答题与学习通求解',
						steps: [
							'进入学习通作业或普通 HTML 表单题目页。',
							'让问学读取题目并生成结构化答案。',
							'问学可以回填答案，但不会自动提交最终交卷。',
							'用户核对后自行决定是否提交。',
						],
					},
					{
						title: '5. 历史、日志与复盘',
						steps: [
							'通过历史列表回看任务步骤与结果。',
							'在设置页查看本地日志，按来源、级别、时间和关键词筛选。',
							'需要排障时导出日志；清理记录前会二次确认。',
							'API Key、Authorization 与 Bearer 凭据永不写入日志。',
						],
					},
				],
			},
			features: {
				title: '功能特性',
				rows: [
					{ name: '预装插件浏览器', detail: '无需 Chrome 商店、开发者模式或手动加载插件。' },
					{
						name: '文本化 DOM 操作',
						detail: '通过页面结构和文本理解网页，不依赖截图式多模态推理。',
					},
					{ name: '自然语言任务', detail: '把多步点击、输入、翻页和整理流程压缩成一句话。' },
					{
						name: '多标签任务',
						detail: '支持打开新页、跨页接续，并让浏览器视图跟随当前操作标签。',
					},
					{ name: '本地模型配置', detail: 'API Key 与模型设置保存在本机浏览器画像内。' },
					{ name: '人工接管', detail: '遇到登录、验证码、权限确认或不可操作区域时提示用户接管。' },
				],
			},
			troubleshooting: {
				title: '故障排查',
				rows: [
					{
						problem: '浏览器没有启动',
						cause: '浏览器资源缺失、系统授权未通过，或已有实例占用画像目录。',
						solution: '重新打开桌面端，确认资源完整；若仍失败，查看桌面端日志并重试。',
					},
					{
						problem: '工具栏看不到问学图标',
						cause: '插件注入失败，或浏览器未使用问学专属启动参数。',
						solution: '关闭浏览器后从问学桌面端重新启动，不要直接打开系统 Chrome。',
					},
					{
						problem: '模型请求失败',
						cause: 'API Key、Base URL、模型名或网络环境不正确。',
						solution: '在设置页重新保存模型配置；先用默认模型验证侧边栏链路。',
					},
					{
						problem: 'Agent 反复执行同一动作',
						cause: '页面状态未变化、目标元素不可操作，或网页结构高度动态。',
						solution: '点击停止，手动完成当前阻塞步骤后继续，或把任务描述得更具体。',
					},
					{
						problem: '题目读取不完整',
						cause: '题目位于跨域 iframe、Canvas 或平台反爬结构中。',
						solution: '切换到可见题目区域后重试；无法 DOM 文本化的内容需要人工辅助。',
					},
				],
			},
			boundaries: {
				title: '能力边界',
				items: [
					'问学是用户在场的协作助手，不是无人值守自动化机器人。',
					'不会绕过验证码、滑块、人脸识别、防作弊系统或目标平台权限控制。',
					'学习通等答题场景不自动提交最终结果，提交动作由用户完成。',
					'强前端混淆、跨域 iframe、Canvas 渲染页面可能降低成功率。',
				],
			},
		},
	},
	en: {
		nav: {
			brandAlt: 'WenXue ask for everything',
			docs: 'Docs',
			github: 'GitHub',
		},
		hero: {
			brand: 'WenXue',
			version: 'v0.0.1 beta',
			titleFirst: 'Let AI work',
			titleSecond: 'inside real webpages',
			description:
				'WenXue launches a browser with an AI assistant built in, so research, quizzes, summaries, and form work happen right where you work.',
			download: 'Download',
			demo: 'Watch demo',
			scroll: 'Watch demo',
		},
		browser: {
			eyebrow: 'WenXue in the browser',
			titleFirst: 'Scroll once,',
			titleSecond: 'watch it appear.',
			tabLabel: 'WenXue usage steps',
			newTab: 'New tab',
			favorite: 'Save',
			openPlugin: 'Open WenXue extension',
			pinPlugin: 'Pin WenXue extension',
			sendTask: 'Send task',
			sidepanelName: 'WenXue',
			breadcrumb: 'Computer Science · Machine Learning',
			paperTitle: 'Large Language Models are Reasoners with Self-Verification',
			authors: 'Xuehai Pan, Li Dong, Furu Wei',
			abstractTitle: 'Abstract',
			abstract:
				'We introduce a simple method that lets models critique, refine, and verify their own responses across web tasks.',
			questionLabel: 'Page question',
			question: 'According to the abstract, what is the main role of self-verification?',
			choiceA: 'A. Compress context',
			choiceB: 'B. Check and refine answers',
			steps: [
				{ id: 'summon', title: 'Open', description: 'Launch WenXue from the browser toolbar.' },
				{ id: 'pin', title: 'Pin', description: 'Keep WenXue beside every webpage.' },
				{ id: 'task', title: 'Ask', description: 'Let AI act on the current page.' },
			],
			tasks: ['Summarize this page', 'Answer the question', 'Turn into a table'],
			results: [
				'Summary, contribution, and limits extracted.',
				'Question read. Suggested answer: B.',
				'Two-column comparison created and ready to export.',
			],
		},
		finalCta: {
			title: 'Make AI your capable assistant inside real webpages',
			platforms: 'macOS / Windows',
		},
		docs: {
			eyebrow: 'WenXue Docs',
			title: 'WenXue',
			description:
				'WenXue is a desktop app that launches a browser with an AI assistant extension built in, so research, quizzes, summaries, and forms happen inside real webpages.',
			backHome: 'Home',
			download: 'Download',
			github: 'View repo',
			repo: 'SmartSunruiyang / WenXue',
			contents: 'Contents',
			badges: ['Desktop Launcher', 'Chrome for Testing', 'MV3 Extension', 'OpenAI-compatible'],
			toc: [
				{ id: 'quick-start', label: 'Quick start' },
				{ id: 'workflow', label: 'Workflow' },
				{ id: 'features', label: 'Features' },
				{ id: 'troubleshooting', label: 'Troubleshooting' },
				{ id: 'boundaries', label: 'Boundaries' },
			],
			quickStart: {
				title: 'Quick start',
				steps: [
					'Download and open the WenXue desktop app.',
					'Click Launch Browser to start the dedicated Chrome for Testing runtime.',
					'Open a target webpage such as a research page, quiz, form, or admin system.',
					'Click the WenXue icon in the browser toolbar to open the AI side panel.',
					'Pin WenXue to the toolbar for one-click access on future pages.',
					'Enter a task such as “summarize this page” or “answer the page question”.',
					'Watch the Agent work, stop it at any time, and take over when login is needed.',
				],
			},
			workflow: {
				title: 'Workflow',
				groups: [
					{
						title: '1. Install and launch',
						steps: [
							'Open the WenXue app.',
							'The desktop launcher checks browser and extension resources.',
							'WenXue creates an isolated browser profile instead of using system Chrome.',
							'The state changes from launching to running after the browser is ready.',
						],
					},
					{
						title: '2. Configure models',
						steps: [
							'Open settings from the side panel.',
							'Use the built-in Qwen model or add an OpenAI-compatible endpoint.',
							'Save provider, Base URL, API key, and model name.',
							'Switch models from the input bar before starting a task.',
						],
					},
					{
						title: '3. Run web tasks',
						steps: [
							'Open the side panel on the target page.',
							'Describe the goal in natural language.',
							'The Agent reads DOM text, asks the LLM, and performs page actions.',
							'When finished, WenXue shows a summary and stores local task history.',
						],
					},
					{
						title: '4. Answer and solve quizzes',
						steps: [
							'Open a quiz or Chaoxing task page.',
							'Ask WenXue to read questions and generate structured answers.',
							'WenXue can fill answers but does not submit the final form.',
							'Review everything manually before deciding to submit.',
						],
					},
					{
						title: '5. Review history and logs',
						steps: [
							'Open task history to review prior steps and results.',
							'Filter local logs by source, level, time, and keyword.',
							'Export logs for troubleshooting or clear them after confirmation.',
							'API keys and authorization tokens are never persisted in logs.',
						],
					},
				],
			},
			features: {
				title: 'Features',
				rows: [
					{ name: 'Bundled browser extension', detail: 'No Chrome Web Store or manual loading.' },
					{
						name: 'Text-based DOM actions',
						detail: 'Understands page structure without screenshot-only automation.',
					},
					{
						name: 'Natural language tasks',
						detail: 'Turns multi-step clicks and typing into one instruction.',
					},
					{
						name: 'Multi-tab tasks',
						detail: 'Can open pages, switch tabs, and keep focus on current work.',
					},
					{
						name: 'Local model settings',
						detail: 'API keys and model choices stay in the local browser profile.',
					},
					{
						name: 'Human takeover',
						detail: 'Pauses for login, verification, permissions, or blocked page states.',
					},
				],
			},
			troubleshooting: {
				title: 'Troubleshooting',
				rows: [
					{
						problem: 'Browser does not launch',
						cause: 'Missing browser resources, OS permission issues, or profile lock.',
						solution:
							'Restart the app, verify resources, and inspect desktop logs if it still fails.',
					},
					{
						problem: 'WenXue icon is missing',
						cause: 'The extension did not load or the browser was not launched by WenXue.',
						solution: 'Close the browser and relaunch it from the WenXue desktop app.',
					},
					{
						problem: 'Model request fails',
						cause: 'Invalid API key, Base URL, model name, or network environment.',
						solution: 'Save model settings again and test the default model path first.',
					},
					{
						problem: 'Agent repeats the same action',
						cause: 'Page state is not changing or the target element is not operable.',
						solution: 'Stop, manually resolve the blocker, then continue with a clearer task.',
					},
					{
						problem: 'Questions are incomplete',
						cause: 'Content may live in iframe, Canvas, or anti-scraping structures.',
						solution: 'Focus the visible question area and retry; some content needs manual help.',
					},
				],
			},
			boundaries: {
				title: 'Boundaries',
				items: [
					'WenXue is a user-present assistant, not unattended automation.',
					'It does not bypass CAPTCHA, sliders, face checks, anti-cheat systems, or permissions.',
					'Quiz workflows never submit final answers automatically.',
					'Cross-origin iframes, Canvas pages, and obfuscated frontends may reduce success rate.',
				],
			},
		},
	},
} as const

const docsTranslations = {
	zh: {
		title: '问学 WenXue 文档',
		subtitle: '桌面浏览器里的 AI 网页操作助手',
		repo: 'SmartSunruiyang / WenXue',
		readmeLabel: 'README.md',
		parsedLabel: '已解析 README 内容',
		lastUpdated: '适用于 Demo 阶段 · Chrome for Testing · MV3 插件',
		badges: ['Desktop App', 'TypeScript', 'Chrome for Testing', 'MV3 Extension', 'OpenAI-compatible'],
		leftNavTitle: '文档导航',
		outlineTitle: '本页目录',
		mediaLabel: '待补素材',
		codeLabel: '示例',
		navGroups: [
			{
				title: '介绍',
				items: [
					{ id: 'overview', label: '项目概览' },
					{ id: 'customer-start', label: '客户快速上手' },
					{ id: 'troubleshooting', label: '排障与边界' },
				],
			},
			{
				title: '功能特性',
				items: [
					{ id: 'customer-workflows', label: '常见任务教程' },
					{ id: 'media-checklist', label: '截图与动画清单' },
				],
			},
			{
				title: '高级',
				items: [{ id: 'developer-guide', label: '开发者接入' }],
			},
		],
		sections: [
			{
				id: 'overview',
				kicker: 'Overview',
				title: '问学是什么',
				lead: '问学是一个桌面应用，它启动一套隔离的 Chrome for Testing 浏览器，并在启动时预装问学 MV3 插件。用户不用访问 Chrome 商店，也不用手动加载扩展，就能在真实网页旁边打开 AI 侧边栏，让 Agent 读取页面、规划动作、点击、输入、翻页并返回结果。',
				blocks: [
					{
						type: 'paragraph',
						text: '问学的重点不是把网页截图交给模型猜，而是把页面 DOM 文本化后交给 Agent 推理。这样做更适合表单、题目、后台系统和资料页这类结构化网页，也让用户可以看到每一步发生了什么。',
					},
					{
						type: 'cards',
						items: [
							{
								title: '桌面启动器',
								text: '负责检查浏览器资源、创建独立画像目录、启动并看护 Chrome for Testing。它不处理 API Key，也不参与 Agent 决策。',
							},
							{
								title: '问学浏览器',
								text: '基于 Chrome for Testing，和系统 Chrome 隔离。插件、历史、模型配置都留在问学自己的浏览器画像里。',
							},
							{
								title: 'AI 侧边栏',
								text: '承载自然语言任务、过程时间线、人工接管、历史记录、模型切换与日志查看。',
							},
							{
								title: '本地可控',
								text: '模型配置、任务历史和日志都保存在本机，API Key 不经过桌面端进程。',
							},
						],
					},
					{
						type: 'table',
						headers: ['你想做的事', '问学的处理方式', '用户要做的确认'],
						rows: [
							[
								'总结资料页',
								'读取 DOM 文本、提炼重点、返回 Markdown 结果',
								'确认摘要是否符合当前页面',
							],
							['回答网页题目', '读取题干与选项，生成答案并可辅助回填', '最终提交前必须人工核对'],
							['填写表单', '按任务描述点击、输入、选择和翻页', '遇到登录、验证码、权限确认时接管'],
							['排查失败', '查看本地历史和日志，不远程上传隐私数据', '导出日志前确认脱敏内容'],
						],
					},
				],
			},
			{
				id: 'customer-start',
				kicker: 'Customer Tutorial',
				title: '客户快速上手',
				lead: '这一章面向第一次使用问学的用户，按真实界面路径描述，不要求用户理解扩展、模型或浏览器供应链。截图和动画先用占位框标出，等你提供素材后可以直接替换。',
				blocks: [
					{
						type: 'subsection',
						id: 'install-launch',
						title: '1. 打开问学并启动浏览器',
						body: '双击问学 App 后，桌面端会显示当前浏览器状态。第一次启动时系统可能会要求确认未签名应用或网络权限；这是桌面运行时启动内置浏览器所需的系统授权。',
						steps: [
							'打开问学 App，确认主按钮显示“启动浏览器”。',
							'点击“启动浏览器”，等待状态从“启动中”变成“浏览器运行中”。',
							'问学会打开一套独立浏览器窗口，不会复用你系统里的 Chrome 个人资料。',
							'如果已经有问学浏览器在运行，再点启动会聚焦已有窗口，而不是开第二个实例。',
						],
					},
					{
						type: 'media',
						kind: 'screenshot',
						title: '桌面启动器启动前后状态',
						description:
							'待补两张截图：未运行状态、运行中状态。建议标注“启动浏览器”按钮和状态胶囊。',
					},
					{
						type: 'subsection',
						id: 'toolbar-entry',
						title: '2. 从浏览器工具栏进入问学',
						body: '浏览器打开后，问学插件已经预装在浏览器里。入口通常在右上角工具栏；如果没有直接看到问学图标，先点工具栏里的扩展程序按钮，再从扩展列表里打开问学。',
						steps: [
							'进入任意网页，例如资料页、在线题目页或后台系统页面。',
							'查看浏览器右上角工具栏，找到问学图标并点击。',
							'如果工具栏没有图标，点击扩展程序按钮，在扩展列表中找到“问学”。',
							'点击“问学”后，右侧会打开 AI 侧边栏。侧边栏不会遮住网页主体内容。',
						],
					},
					{
						type: 'media',
						kind: 'animation',
						title: '从工具栏打开问学侧边栏',
						description: '待补 6-8 秒动图：点击工具栏问学图标，右侧侧边栏展开，输入框获得焦点。',
					},
					{
						type: 'subsection',
						id: 'pin-extension',
						title: '3. 将问学固定到任务栏',
						body: '这里的“任务栏”指浏览器右上角工具栏。固定后，问学图标会一直显示在地址栏旁边，不需要每次都进入扩展列表查找。',
						steps: [
							'点击浏览器右上角的扩展程序按钮。',
							'在扩展列表里找到“问学”。',
							'点击问学右侧的图钉按钮，让图钉变成已固定状态。',
							'回到工具栏，确认问学图标固定在地址栏右侧。',
							'之后打开任意网页，都可以直接点这个图标呼出问学。',
						],
					},
					{
						type: 'media',
						kind: 'screenshot',
						title: '固定问学到浏览器工具栏',
						description:
							'待补截图：扩展列表中的问学条目、图钉按钮、固定后的工具栏图标。建议用红框或箭头标注。',
					},
					{
						type: 'subsection',
						id: 'first-task',
						title: '4. 输入第一条任务',
						body: '问学接受自然语言任务。不要写 CSS 选择器，也不需要描述每一个点击细节；把目标说清楚，再观察它的执行过程即可。',
						steps: [
							'在目标网页保持侧边栏打开。',
							'在底部输入框输入任务，例如“总结这页重点并列出待办”。',
							'点击发送按钮后，观察左侧网页高亮和侧边栏时间线。',
							'如果页面要求登录、验证码或权限确认，先人工完成，再点击继续。',
							'完成后阅读结果正文；如果是答题或表单，最终提交动作由你自己完成。',
						],
					},
				],
			},
			{
				id: 'customer-workflows',
				kicker: 'Workflows',
				title: '常见任务教程',
				lead: '下面的教程按用户目标组织。每个流程都强调“用户在场”：问学可以辅助操作，但不会绕过平台规则，也不会替用户做最终不可逆提交。',
				blocks: [
					{
						type: 'subsection',
						id: 'workflow-research',
						title: '资料总结与研究',
						body: '适合论文页、政策页、商品说明、后台详情页等长内容页面。问学会读取页面文本，按你的要求输出摘要、对比表、行动清单或问题列表。',
						steps: [
							'打开资料页并呼出问学。',
							'输入“总结这页重点，按背景、结论、风险分三段”。',
							'如果需要跨页查找，可以继续输入“打开作者主页并补充相关项目”。',
							'把最终结果复制到笔记或导出历史记录进行复盘。',
						],
					},
					{
						type: 'subsection',
						id: 'workflow-quiz',
						title: '题目读取与学习通求解',
						body: '问学可以读取标准 HTML 题目、生成结构化答案并辅助回填。它不会绕过验证码、人脸识别、防作弊系统，也不会自动点击最终提交。',
						steps: [
							'进入学习通作业、考试练习或普通网页题目页。',
							'输入“读取本页题目，给出每题答案和理由，能回填的先回填”。',
							'逐题核对答案和理由；遇到图片题、Canvas 题或跨域 iframe 内容时人工补充信息。',
							'确认无误后，由用户自己决定是否提交。',
						],
					},
					{
						type: 'subsection',
						id: 'workflow-logs',
						title: '历史、日志与复盘',
						body: '问学会在本机保存任务历史和运行日志，方便回看 Agent 做过什么。日志用于排障，不用于远程上报。',
						steps: [
							'从侧边栏历史入口查看过往任务。',
							'在设置页打开日志，按来源、级别、时间或关键词筛选。',
							'排障时导出当前筛选结果；导出前确认内容不包含敏感上下文。',
							'需要清空日志时，按二次确认操作执行。',
						],
					},
					{
						type: 'callout',
						title: '使用边界',
						text: '只要任务涉及登录、验证码、支付、最终提交、删除数据、权限授权或平台规则确认，问学都应该停下来让用户接管。文档和界面需要一致表达这一点。',
					},
				],
			},
			{
				id: 'developer-guide',
				kicker: 'Developer Guide',
				title: '开发者接入与二次开发',
				lead: '这一章面向维护问学官网、桌面端和插件端的开发者。示例以本仓库结构为准，不引入新的运行时依赖，也不让官网域依赖桌面或插件内部实现。',
				blocks: [
					{
						type: 'subsection',
						id: 'dev-local',
						title: '本地启动官网文档页',
						body: '官网是 `apps/website` 下的 Vite + React 静态站点。它只消费静态文案和品牌资产，不读取桌面进程、插件存储或用户 API Key。',
					},
					{
						type: 'code',
						language: 'sh',
						code: [
							'pnpm i',
							'pnpm -F website dev',
							'pnpm -F website test',
							'pnpm -F website build',
						].join('\n'),
					},
					{
						type: 'subsection',
						id: 'dev-boundary',
						title: '模块边界',
						body: '问学当前有三个域：桌面域负责运行时，插件域负责 Agent 与网页操作，官网域负责产品叙事与文档展示。官网可以描述功能，但不能直接 import 插件或桌面模块。',
					},
					{
						type: 'code',
						language: 'txt',
						code: [
							'apps/desktop    # Electron 启动器与浏览器进程看护',
							'apps/extension  # WXT MV3 插件、侧边栏、设置页、日志',
							'apps/website    # 静态官网与文档页',
							'packages/*      # fork 自 page-agent 的 vendor 包',
						].join('\n'),
					},
					{
						type: 'subsection',
						id: 'dev-model',
						title: 'OpenAI-compatible 模型配置示例',
						body: '用户在插件设置页里添加模型；开发者文档只说明字段含义，不要求用户把 Key 写进代码。API Key 必须留在浏览器本机存储里，不经过桌面进程。',
					},
					{
						type: 'code',
						language: 'json',
						code: [
							'{',
							'  "provider": "Qwen",',
							'  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",',
							'  "model": "qwen3.5-plus",',
							'  "apiKey": "只在本机浏览器画像中保存"',
							'}',
						].join('\n'),
					},
					{
						type: 'subsection',
						id: 'dev-tool',
						title: '扩展网页能力的工具示意',
						body: '如果要为某类网页增加专用能力，先在架构文档中确认模块归属，再在插件域暴露清晰的工具入口。下面是结构示意，真实实现要使用当前插件域已有的消息、日志和页面控制契约。',
					},
					{
						type: 'code',
						language: 'ts',
						code: [
							'type ExampleToolDeps = {',
							'\treadCurrentPageText(): Promise<string>',
							'\twriteLog(message: string): void',
							'}',
							'',
							'export function createExampleTools(deps: ExampleToolDeps) {',
							'\treturn {',
							"\t\tname: 'wenxue_extract_page_summary',",
							"\t\tdescription: 'Read the current page and return a concise summary.',",
							'\t\tasync execute() {',
							'\t\t\tconst text = await deps.readCurrentPageText()',
							"\t\t\tdeps.writeLog('summary tool read current page')",
							'\t\t\treturn text.slice(0, 2000)',
							'\t\t},',
							'\t}',
							'}',
						].join('\n'),
					},
					{
						type: 'callout',
						title: '提交前检查',
						text: '功能范围变化同步 PRD；模块或依赖变化同步 ARCHITECTURE；视觉交互规则变化同步 UIUX。官网文档是静态站点，但仍属于 WebsiteSite 模块。',
					},
				],
			},
			{
				id: 'troubleshooting',
				kicker: 'Troubleshooting',
				title: '故障排查与能力边界',
				lead: '这一章把常见问题写成“现象、可能原因、处理动作”。客服、开发和最终用户都可以按同一套语言定位问题。',
				blocks: [
					{
						type: 'table',
						headers: ['现象', '可能原因', '处理动作'],
						rows: [
							[
								'浏览器没有启动',
								'浏览器资源缺失、系统授权失败或画像目录被占用',
								'重新打开问学，确认资源完整；仍失败则查看桌面端日志',
							],
							[
								'工具栏找不到问学',
								'插件未加载或用户打开了系统 Chrome',
								'关闭当前窗口，从问学桌面端重新启动浏览器',
							],
							[
								'模型请求失败',
								'Base URL、API Key、模型名或网络环境不正确',
								'在设置页重新保存模型，先用默认模型验证链路',
							],
							[
								'Agent 重复执行同一动作',
								'页面状态没有变化、元素不可操作或任务描述过宽',
								'点击停止，人工完成阻塞步骤，再用更具体的任务继续',
							],
							[
								'题目读取不完整',
								'内容在跨域 iframe、Canvas、图片或反爬结构中',
								'聚焦可见题目区域后重试；必要时手动补充题干',
							],
						],
					},
					{
						type: 'callout',
						title: '不会做的事',
						text: '问学不会绕过验证码、滑块、人脸识别、防作弊系统、付费墙或目标平台权限控制。它不是无人值守自动化机器人，而是用户在场的协作助手。',
					},
				],
			},
			{
				id: 'media-checklist',
				kicker: 'Assets',
				title: '截图与动画清单',
				lead: '下面这些素材需要真实界面截图或短动画。当前页面已经保留占位，后续只要把素材文件放入官网 public assets 并替换对应块即可。',
				blocks: [
					{
						type: 'cards',
						items: [
							{
								title: '桌面启动器',
								text: '未运行、启动中、运行中三个状态截图，突出“启动浏览器”主按钮。',
							},
							{
								title: '工具栏入口',
								text: '点击浏览器工具栏问学图标，右侧侧边栏展开的 6-8 秒动图。',
							},
							{
								title: '固定到工具栏',
								text: '扩展列表、图钉按钮、固定后图标三个关键状态，适合用一张合成截图。',
							},
							{
								title: '执行任务',
								text: '输入任务、页面高亮、结果生成的短动画，建议不要包含私人网页内容。',
							},
						],
					},
					{
						type: 'media',
						kind: 'screenshot',
						title: '真实素材待接入',
						description:
							'如果你能提供截图或录屏，我会把这些占位替换成真实图片/视频，并补 alt 文案与响应式尺寸。',
					},
				],
			},
		],
	},
	en: {
		title: 'WenXue Docs',
		subtitle: 'AI web-operation assistant inside a dedicated desktop browser',
		repo: 'SmartSunruiyang / WenXue',
		readmeLabel: 'README.md',
		parsedLabel: 'Parsed README content',
		lastUpdated: 'Demo stage · Chrome for Testing · MV3 extension',
		badges: ['Desktop App', 'TypeScript', 'Chrome for Testing', 'MV3 Extension', 'OpenAI-compatible'],
		leftNavTitle: 'Docs',
		outlineTitle: 'On this page',
		mediaLabel: 'Asset placeholder',
		codeLabel: 'Example',
		navGroups: [
			{
				title: 'Intro',
				items: [
					{ id: 'overview', label: 'Overview' },
					{ id: 'customer-start', label: 'Customer tutorial' },
					{ id: 'troubleshooting', label: 'Troubleshooting' },
				],
			},
			{
				title: 'Features',
				items: [
					{ id: 'customer-workflows', label: 'Workflows' },
					{ id: 'media-checklist', label: 'Media checklist' },
				],
			},
			{
				title: 'Advanced',
				items: [{ id: 'developer-guide', label: 'Developer guide' }],
			},
		],
		sections: [
			{
				id: 'overview',
				kicker: 'Overview',
				title: 'What WenXue is',
				lead: 'WenXue is a desktop app that launches an isolated Chrome for Testing browser with the WenXue MV3 extension preinstalled. Users can open an AI side panel beside real webpages and ask it to read, click, type, scroll, switch tabs, and summarize results.',
				blocks: [
					{
						type: 'paragraph',
						text: 'The agent works from structured DOM text rather than screenshot-only guessing. This makes it useful for forms, quizzes, admin systems, research pages, and other text-heavy workflows.',
					},
					{
						type: 'cards',
						items: [
							{
								title: 'Desktop launcher',
								text: 'Checks browser resources, creates an isolated profile, launches Chrome for Testing, and supervises the process.',
							},
							{
								title: 'WenXue browser',
								text: 'Runs separately from system Chrome. Extension data, history, and model settings stay in the WenXue profile.',
							},
							{
								title: 'AI side panel',
								text: 'Hosts natural-language tasks, timeline feedback, human takeover, history, model switching, and local logs.',
							},
							{
								title: 'Local control',
								text: 'Model settings, task history, and logs stay local; API keys never pass through the desktop process.',
							},
						],
					},
					{
						type: 'table',
						headers: ['Goal', 'How WenXue helps', 'User confirmation'],
						rows: [
							['Summarize a page', 'Reads DOM text and returns Markdown', 'Review the summary'],
							[
								'Answer a quiz',
								'Reads questions and may fill answers',
								'Submit manually only after review',
							],
							[
								'Fill a form',
								'Clicks, types, selects, and scrolls',
								'Take over for login or verification',
							],
							[
								'Debug failures',
								'Uses local history and logs',
								'Export only after checking sensitive content',
							],
						],
					},
				],
			},
			{
				id: 'customer-start',
				kicker: 'Customer Tutorial',
				title: 'Customer quick start',
				lead: 'This chapter is written for first-time users. Screenshots and animations are currently explicit placeholders so real product media can be dropped in later.',
				blocks: [
					{
						type: 'subsection',
						id: 'install-launch',
						title: '1. Open WenXue and launch the browser',
						body: 'Open the desktop app, click the launch button, and wait until the browser state changes to running. The browser profile is isolated from system Chrome.',
						steps: [
							'Open the WenXue app.',
							'Click Launch Browser.',
							'Wait for the dedicated browser window.',
							'Clicking launch again focuses the existing browser instead of opening another one.',
						],
					},
					{
						type: 'media',
						kind: 'screenshot',
						title: 'Desktop launcher before and after launch',
						description: 'Placeholder for screenshots of idle and running states.',
					},
					{
						type: 'subsection',
						id: 'toolbar-entry',
						title: '2. Open WenXue from the browser toolbar',
						body: 'The extension is preinstalled. Click the WenXue icon in the top-right toolbar, or open it from the extensions menu if the icon is hidden.',
						steps: [
							'Open a target webpage.',
							'Find the WenXue icon in the browser toolbar.',
							'If it is hidden, open the extensions menu and click WenXue.',
							'The AI side panel opens on the right without covering the page.',
						],
					},
					{
						type: 'media',
						kind: 'animation',
						title: 'Open the side panel from the toolbar',
						description: 'Placeholder for a short toolbar-to-side-panel animation.',
					},
					{
						type: 'subsection',
						id: 'pin-extension',
						title: '3. Pin WenXue to the toolbar',
						body: 'Pinning keeps the WenXue icon visible beside the address bar, so users can open it from any page in one click.',
						steps: [
							'Open the browser extensions menu.',
							'Find WenXue.',
							'Click the pin icon next to it.',
							'Confirm the WenXue icon stays in the toolbar.',
						],
					},
					{
						type: 'media',
						kind: 'screenshot',
						title: 'Pin WenXue to the toolbar',
						description: 'Placeholder for extension menu and pinned toolbar screenshots.',
					},
				],
			},
			{
				id: 'customer-workflows',
				kicker: 'Workflows',
				title: 'Common workflows',
				lead: 'WenXue is a user-present assistant. It can help operate pages, but the user remains responsible for irreversible actions.',
				blocks: [
					{
						type: 'subsection',
						id: 'workflow-research',
						title: 'Research and summaries',
						body: 'Ask WenXue to summarize articles, policies, product pages, or admin details into sections, tables, or action lists.',
						steps: [
							'Open the page.',
							'Ask for a summary format.',
							'Review the result.',
							'Continue across tabs if needed.',
						],
					},
					{
						type: 'subsection',
						id: 'workflow-quiz',
						title: 'Quiz reading and Chaoxing solving',
						body: 'WenXue can read standard HTML questions, generate structured answers, and assist with filling. It never bypasses verification or submits final answers automatically.',
						steps: [
							'Open the quiz page.',
							'Ask WenXue to read questions.',
							'Review every answer.',
							'Submit manually if appropriate.',
						],
					},
					{
						type: 'subsection',
						id: 'workflow-logs',
						title: 'History and logs',
						body: 'History and logs are local-first. Use them to review steps, filter events, and export troubleshooting evidence.',
						steps: [
							'Open history.',
							'Filter local logs.',
							'Export only after checking sensitive content.',
							'Clear records with confirmation.',
						],
					},
				],
			},
			{
				id: 'developer-guide',
				kicker: 'Developer Guide',
				title: 'Developer guide',
				lead: 'Developer examples follow the local monorepo boundaries: website, desktop, extension, and vendored page-agent packages stay separate.',
				blocks: [
					{
						type: 'subsection',
						id: 'dev-local',
						title: 'Run the website locally',
						body: 'The website is a Vite + React static app under `apps/website`. It does not import desktop or extension runtime modules.',
					},
					{
						type: 'code',
						language: 'sh',
						code: [
							'pnpm i',
							'pnpm -F website dev',
							'pnpm -F website test',
							'pnpm -F website build',
						].join('\n'),
					},
					{
						type: 'subsection',
						id: 'dev-boundary',
						title: 'Module boundaries',
						body: 'Desktop owns runtime launch, extension owns the agent, and website owns product narrative and docs.',
					},
					{
						type: 'code',
						language: 'txt',
						code: [
							'apps/desktop    # Electron launcher',
							'apps/extension  # WXT MV3 extension',
							'apps/website    # static website and docs',
							'packages/*      # vendored page-agent packages',
						].join('\n'),
					},
					{
						type: 'subsection',
						id: 'dev-model',
						title: 'OpenAI-compatible model shape',
						body: 'Users configure models in the extension settings page. API keys stay in the local browser profile and never pass through the desktop process.',
					},
					{
						type: 'code',
						language: 'json',
						code: [
							'{',
							'  "provider": "Qwen",',
							'  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",',
							'  "model": "qwen3.5-plus",',
							'  "apiKey": "stored locally"',
							'}',
						].join('\n'),
					},
				],
			},
			{
				id: 'troubleshooting',
				kicker: 'Troubleshooting',
				title: 'Troubleshooting and boundaries',
				lead: 'Use the same language across support, docs, and product UI: symptom, likely cause, and next action.',
				blocks: [
					{
						type: 'table',
						headers: ['Symptom', 'Likely cause', 'Action'],
						rows: [
							[
								'Browser does not launch',
								'Missing resources or permission issue',
								'Restart WenXue and inspect logs',
							],
							[
								'WenXue icon is missing',
								'Extension was not loaded',
								'Relaunch from the desktop app',
							],
							[
								'Model request fails',
								'Invalid key, URL, model, or network',
								'Save model settings again',
							],
							[
								'Agent repeats one action',
								'Page state is blocked',
								'Stop, take over, then continue',
							],
						],
					},
					{
						type: 'callout',
						title: 'Boundaries',
						text: 'WenXue does not bypass CAPTCHA, sliders, face checks, anti-cheat systems, paywalls, or platform permissions.',
					},
				],
			},
			{
				id: 'media-checklist',
				kicker: 'Assets',
				title: 'Screenshot and animation checklist',
				lead: 'The docs already include placeholders for real product media. Replace them with screenshots or short recordings when available.',
				blocks: [
					{
						type: 'cards',
						items: [
							{ title: 'Launcher states', text: 'Idle, launching, and running.' },
							{ title: 'Toolbar entry', text: 'Click WenXue and open the side panel.' },
							{ title: 'Pinning', text: 'Extensions menu, pin button, and pinned icon.' },
							{ title: 'Task execution', text: 'Input, page highlight, timeline, and result.' },
						],
					},
					{
						type: 'media',
						kind: 'screenshot',
						title: 'Real media pending',
						description:
							'Drop real screenshots or recordings into public assets and replace this placeholder.',
					},
				],
			},
		],
	},
} as const

type DocsCopy = (typeof docsTranslations)[Language]
type DocsBlock = DocsCopy['sections'][number]['blocks'][number]
const defaultDocsSectionId = docsTranslations.zh.sections[0].id

function getInitialPage(): SitePage {
	if (typeof window !== 'undefined' && window.location.hash.replace(/^#/, '').startsWith('docs')) {
		return 'docs'
	}

	return 'home'
}

function getInitialDocsSectionId(): string {
	if (typeof window === 'undefined') {
		return defaultDocsSectionId
	}

	const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''))
	if (hash === 'docs') {
		return defaultDocsSectionId
	}

	if (hash.startsWith('docs/')) {
		return hash.slice('docs/'.length).split('/')[0] || defaultDocsSectionId
	}

	return defaultDocsSectionId
}

function clearHash() {
	window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`)
}

interface TiltButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	children: ReactNode
	tiltClassName?: string
	rotateAmplitude?: number
	scaleOnHover?: number
}

function TiltButton({
	children,
	tiltClassName = '',
	rotateAmplitude = 7,
	scaleOnHover = 1.045,
	...props
}: TiltButtonProps) {
	return (
		<TiltHover
			className={tiltClassName}
			rotateAmplitude={rotateAmplitude}
			scaleOnHover={scaleOnHover}
		>
			<button {...props}>{children}</button>
		</TiltHover>
	)
}

interface TiltAnchorProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
	children: ReactNode
	tiltClassName?: string
	rotateAmplitude?: number
	scaleOnHover?: number
}

function TiltAnchor({
	children,
	tiltClassName = '',
	rotateAmplitude = 7,
	scaleOnHover = 1.045,
	...props
}: TiltAnchorProps) {
	return (
		<TiltHover
			className={tiltClassName}
			rotateAmplitude={rotateAmplitude}
			scaleOnHover={scaleOnHover}
		>
			<a {...props}>{children}</a>
		</TiltHover>
	)
}

export default function App() {
	const [activeStep, setActiveStep] = useState(0)
	const [activeTask, setActiveTask] = useState(0)
	const [page, setPage] = useState<SitePage>(getInitialPage)
	const [docsSectionId, setDocsSectionId] = useState(getInitialDocsSectionId)
	const heroTitleRef = useRef<HTMLHeadingElement | null>(null)
	const language: Language = 'zh'
	const copy = translations[language]
	const docsCopy = docsTranslations[language]

	useEffect(() => {
		const syncRoute = () => {
			setPage(getInitialPage())
			setDocsSectionId(getInitialDocsSectionId())
		}

		window.addEventListener('hashchange', syncRoute)
		window.addEventListener('popstate', syncRoute)
		return () => {
			window.removeEventListener('hashchange', syncRoute)
			window.removeEventListener('popstate', syncRoute)
		}
	}, [])

	const goHome = () => {
		setPage('home')
		clearHash()
		window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
	}

	const goDocs = () => {
		const nextSectionId = defaultDocsSectionId
		setPage('docs')
		setDocsSectionId(nextSectionId)
		window.history.pushState(null, '', `#docs/${nextSectionId}`)
		window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
	}

	const goDocsSection = (sectionId: string) => {
		setPage('docs')
		setDocsSectionId(sectionId)
		window.history.pushState(null, '', `#docs/${sectionId}`)
		window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
	}

	const scrollToDemo = () => {
		setPage('home')
		clearHash()
		window.requestAnimationFrame(() => {
			window.requestAnimationFrame(() => {
				document
					.getElementById('browser-demo')
					?.scrollIntoView({ behavior: 'smooth', block: 'start' })
			})
		})
	}

	const scrollToDownload = () => {
		setPage('home')
		clearHash()
		window.requestAnimationFrame(() => {
			window.requestAnimationFrame(() => {
				document.getElementById('download')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
			})
		})
	}

	return (
		<main className="site-shell">
			<TopInfoBar
				copy={{ ...copy.nav, download: copy.hero.download }}
				githubUrl={githubUrl}
				isDocsActive={page === 'docs'}
				onDocs={goDocs}
				onDownload={scrollToDownload}
				onHome={goHome}
			/>

			{page === 'home' ? (
				<>
					<section className="hero-section" aria-label={copy.hero.brand}>
						<DotField
							bulgeStrength={132}
							cursorRadius={500}
							dotRadius={2.2}
							dotSpacing={14}
							glowColor="#6b6f76"
							glowRadius={230}
							gradientFrom="rgba(8, 9, 10, 0.54)"
							gradientTo="rgba(8, 9, 10, 0.38)"
							sparkle
							waveAmplitude={1.1}
						/>
						<div className="hero-center">
							<div className="hero-brand">
								<img src="/assets/wenxue-logo.png" alt="" aria-hidden="true" />
								<span>{copy.hero.version}</span>
							</div>
							<h1 className="hero-title-proximity" ref={heroTitleRef}>
								<span>
									<VariableProximity
										className="hero-title-line"
										containerRef={heroTitleRef}
										falloff="gaussian"
										fromFontVariationSettings="'wght' 720, 'opsz' 18"
										label={copy.hero.titleFirst}
										radius={180}
										toFontVariationSettings="'wght' 1000, 'opsz' 78"
									/>
								</span>
								<span>
									<VariableProximity
										className="hero-title-line"
										containerRef={heroTitleRef}
										falloff="gaussian"
										fromFontVariationSettings="'wght' 720, 'opsz' 18"
										label={copy.hero.titleSecond}
										radius={180}
										toFontVariationSettings="'wght' 1000, 'opsz' 78"
									/>
								</span>
							</h1>
							<p>{copy.hero.description}</p>
							<div className="hero-actions">
								<TiltButton
									className="button button-primary"
									onClick={scrollToDownload}
									tiltClassName="tilt-action tilt-action-primary"
									type="button"
								>
									<Download size={18} />
									{copy.hero.download}
								</TiltButton>
								<TiltButton
									className="button button-secondary"
									onClick={scrollToDemo}
									tiltClassName="tilt-action"
									type="button"
								>
									<Play size={18} />
									{copy.hero.demo}
								</TiltButton>
							</div>
						</div>
						<TiltButton
							aria-label={copy.hero.scroll}
							className="scroll-cue-button"
							onClick={scrollToDemo}
							rotateAmplitude={6}
							scaleOnHover={1.05}
							tiltClassName="scroll-cue tilt-scroll-cue"
							type="button"
						>
							<ArrowDown size={18} />
						</TiltButton>
					</section>

					<section className="browser-section" id="browser-demo" aria-label={copy.browser.eyebrow}>
						<div className="section-copy">
							<p>{copy.browser.eyebrow}</p>
							<h2>
								<span>{copy.browser.titleFirst}</span>
								<span>{copy.browser.titleSecond}</span>
							</h2>
						</div>
						<div className="step-switcher" role="tablist" aria-label={copy.browser.tabLabel}>
							{copy.browser.steps.map((step, index) => (
								<TiltButton
									aria-selected={activeStep === index}
									className={activeStep === index ? 'step-pill step-pill-active' : 'step-pill'}
									key={step.id}
									onClick={() => setActiveStep(index)}
									rotateAmplitude={6}
									role="tab"
									tiltClassName="tilt-pill"
									type="button"
								>
									<span>{index + 1}</span>
									{step.title}
								</TiltButton>
							))}
						</div>
						<BrowserDemo
							activeStep={activeStep}
							activeTask={activeTask}
							copy={copy.browser}
							onTaskChange={setActiveTask}
						/>
					</section>

					<section className="final-cta" id="download" aria-label={copy.hero.download}>
						<img src="/assets/wenxue-logo.png" alt="" aria-hidden="true" />
						<h2>{copy.finalCta.title}</h2>
						<div className="hero-actions">
							<TiltButton
								className="button button-primary"
								onClick={scrollToDownload}
								tiltClassName="tilt-action tilt-action-primary"
								type="button"
							>
								<Download size={18} />
								{copy.hero.download}
							</TiltButton>
							<TiltButton
								className="button button-secondary"
								onClick={scrollToDemo}
								tiltClassName="tilt-action"
								type="button"
							>
								<Play size={18} />
								{copy.hero.demo}
							</TiltButton>
						</div>
						<p className="platforms">{copy.finalCta.platforms}</p>
					</section>
				</>
			) : (
				<DocsPage activeSectionId={docsSectionId} copy={docsCopy} onSectionChange={goDocsSection} />
			)}
		</main>
	)
}

interface TopInfoBarProps {
	copy: SiteNavbarCopy
	githubUrl: string
	isDocsActive: boolean
	onDocs: () => void
	onDownload: () => void
	onHome: () => void
}

function TopInfoBar({
	copy,
	githubUrl,
	isDocsActive,
	onDocs,
	onDownload,
	onHome,
}: TopInfoBarProps) {
	return (
		<header className="top-info-bar" aria-label="WenXue">
			<SiteNavbar
				copy={copy}
				githubUrl={githubUrl}
				isDocsActive={isDocsActive}
				onDocs={onDocs}
				onDownload={onDownload}
				onHome={onHome}
			/>
		</header>
	)
}

interface DocsPageProps {
	activeSectionId: string
	copy: DocsCopy
	onSectionChange: (sectionId: string) => void
}

function DocsPage({ activeSectionId, copy, onSectionChange }: DocsPageProps) {
	const activeSection =
		copy.sections.find((section) => section.id === activeSectionId) ?? copy.sections[0]

	return (
		<section className="docs-page" aria-label={copy.title}>
			<div className="docs-layout">
				<aside className="docs-sidebar" aria-label={copy.leftNavTitle}>
					<div className="docs-sidebar-sticky">
						<nav className="docs-left-nav">
							{copy.navGroups.map((group) => (
								<section key={group.title}>
									<h2>{group.title}</h2>
									{group.items.map((item) => (
										<button
											className={item.id === activeSection.id ? 'docs-nav-active' : undefined}
											key={item.id}
											onClick={() => onSectionChange(item.id)}
											type="button"
										>
											<span>{item.label}</span>
										</button>
									))}
								</section>
							))}
						</nav>
					</div>
				</aside>

				<article className="docs-article">
					<div className="docs-content">
						<section className="docs-section" id={activeSection.id}>
							<header className="docs-section-hero">
								<h1>{activeSection.kicker}</h1>
								<p>{activeSection.lead}</p>
								<div className="docs-badge-strip" aria-label={copy.lastUpdated}>
									{copy.badges.map((badge) => (
										<span key={badge}>{badge}</span>
									))}
								</div>
							</header>
							<h2>{activeSection.title}</h2>
							{activeSection.blocks.map((block, index) => renderDocsBlock(block, copy, index))}
						</section>
					</div>
				</article>
			</div>
		</section>
	)
}

function renderDocsBlock(block: DocsBlock, copy: DocsCopy, index: number) {
	if (block.type === 'paragraph') {
		return (
			<p className="docs-paragraph" key={`${block.type}-${index}`}>
				{block.text}
			</p>
		)
	}

	if (block.type === 'cards') {
		return (
			<div className="docs-card-grid" key={`${block.type}-${index}`}>
				{block.items.map((item) => (
					<article className="docs-card" key={item.title}>
						<h3>{item.title}</h3>
						<p>{item.text}</p>
					</article>
				))}
			</div>
		)
	}

	if (block.type === 'table') {
		return (
			<div className="docs-table-wrap" key={`${block.type}-${index}`}>
				<table>
					<thead>
						<tr>
							{block.headers.map((header) => (
								<th key={header}>{header}</th>
							))}
						</tr>
					</thead>
					<tbody>
						{block.rows.map((row) => (
							<tr key={row.join('-')}>
								{row.map((cell) => (
									<td key={cell}>{cell}</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		)
	}

	if (block.type === 'subsection') {
		return (
			<section className="docs-subsection" id={block.id} key={block.id}>
				<h3>{block.title}</h3>
				<p>{block.body}</p>
				{'steps' in block ? (
					<ol className="docs-steps">
						{block.steps.map((step) => (
							<li key={step}>{step}</li>
						))}
					</ol>
				) : null}
			</section>
		)
	}

	if (block.type === 'media') {
		const Icon = block.kind === 'animation' ? Play : Compass
		return (
			<figure className="docs-media-placeholder" key={`${block.type}-${index}`}>
				<div>
					<Icon size={20} />
					<span>{copy.mediaLabel}</span>
				</div>
				<figcaption>
					<strong>{block.title}</strong>
					<span>{block.description}</span>
				</figcaption>
			</figure>
		)
	}

	if (block.type === 'code') {
		return (
			<div className="docs-code-block" key={`${block.type}-${index}`}>
				<div className="docs-code-title">
					<Terminal size={15} />
					<span>
						{copy.codeLabel} · {block.language}
					</span>
				</div>
				<pre>
					<code>{block.code}</code>
				</pre>
			</div>
		)
	}

	return (
		<aside className="docs-callout" key={`${block.type}-${index}`}>
			<Code2 size={18} />
			<div>
				<strong>{block.title}</strong>
				<p>{block.text}</p>
			</div>
		</aside>
	)
}

interface BrowserDemoProps {
	activeStep: number
	activeTask: number
	copy: (typeof translations)[Language]['browser']
	onTaskChange: (index: number) => void
}

function BrowserDemo({ activeStep, activeTask, copy, onTaskChange }: BrowserDemoProps) {
	const active = copy.steps[activeStep]

	return (
		<div className="browser-stage">
			<div className="signal-path signal-path-one" />
			<div className="signal-path signal-path-two" />
			<article className="browser-window">
				<header className="browser-toolbar">
					<div className="traffic-lights" aria-hidden="true">
						<span />
						<span />
						<span />
					</div>
					<div className="tab-strip">
						<div className="browser-tab">
							<Globe2 size={15} />
							arXiv.org
							<X size={13} />
						</div>
						<TiltButton
							aria-label={copy.newTab}
							className="toolbar-icon"
							rotateAmplitude={5}
							scaleOnHover={1.05}
							tiltClassName="tilt-icon-button"
							type="button"
						>
							<Circle size={13} />
						</TiltButton>
					</div>
					<div className="address-bar">
						<Lock size={14} />
						<span>https://arxiv.org/abs/2401.12345</span>
					</div>
					<div className="toolbar-actions">
						<TiltButton
							aria-label={copy.favorite}
							className="toolbar-icon"
							rotateAmplitude={5}
							scaleOnHover={1.05}
							tiltClassName="tilt-icon-button"
							type="button"
						>
							<ExternalLink size={15} />
						</TiltButton>
						<TiltButton
							aria-label={copy.openPlugin}
							className="toolbar-plugin toolbar-plugin-active"
							rotateAmplitude={5}
							scaleOnHover={1.05}
							tiltClassName="tilt-icon-button"
							type="button"
						>
							<img src="/assets/wenxue-logo.png" alt="" aria-hidden="true" />
						</TiltButton>
						<TiltButton
							aria-label={copy.pinPlugin}
							className={activeStep >= 1 ? 'toolbar-pin toolbar-pin-active' : 'toolbar-pin'}
							rotateAmplitude={5}
							scaleOnHover={1.05}
							tiltClassName="tilt-icon-button"
							type="button"
						>
							<Pin size={15} />
						</TiltButton>
					</div>
				</header>

				<div className="browser-body">
					<section className="page-surface">
						<div className="breadcrumb">{copy.breadcrumb}</div>
						<h3>{copy.paperTitle}</h3>
						<p className="authors">{copy.authors}</p>
						<div className="abstract-block">
							<strong>{copy.abstractTitle}</strong>
							<p>{copy.abstract}</p>
						</div>
						<TiltHover
							className="tilt-card tilt-quiz-card"
							rotateAmplitude={4}
							scaleOnHover={1.018}
						>
							<div className="quiz-strip">
								<span>{copy.questionLabel}</span>
								<p>{copy.question}</p>
								<div className="choice-row">
									<TiltButton
										className="choice-button"
										rotateAmplitude={5}
										scaleOnHover={1.035}
										tiltClassName="tilt-choice"
										type="button"
									>
										{copy.choiceA}
									</TiltButton>
									<TiltButton
										className="choice-button choice-selected"
										rotateAmplitude={5}
										scaleOnHover={1.035}
										tiltClassName="tilt-choice"
										type="button"
									>
										{copy.choiceB}
									</TiltButton>
								</div>
							</div>
						</TiltHover>
					</section>

					<aside className={activeStep === 0 ? 'sidepanel sidepanel-summon' : 'sidepanel'}>
						<header className="sidepanel-header">
							<div>
								<img src="/assets/wenxue-logo.png" alt="" aria-hidden="true" />
								<span>{copy.sidepanelName}</span>
							</div>
							<Pin size={15} className={activeStep >= 1 ? 'pin-lit' : undefined} />
						</header>
						<div className="sidepanel-copy">
							<p>{active.title}</p>
							<h4>{active.description}</h4>
						</div>
						<div className="task-chips">
							{copy.tasks.map((task, index) => (
								<TiltButton
									className={activeTask === index ? 'task-chip task-chip-active' : 'task-chip'}
									key={task}
									onClick={() => onTaskChange(index)}
									rotateAmplitude={5}
									scaleOnHover={1.032}
									tiltClassName="tilt-chip"
									type="button"
								>
									{task}
								</TiltButton>
							))}
						</div>
						<TiltHover
							className="tilt-card tilt-result-card"
							rotateAmplitude={4}
							scaleOnHover={1.018}
						>
							<div className="result-card">
								<Sparkles size={16} />
								<p>{copy.results[activeTask]}</p>
							</div>
						</TiltHover>
						<div className="command-bar">
							<MousePointer2 size={15} />
							<span>{copy.tasks[activeTask]}</span>
							<TiltButton
								aria-label={copy.sendTask}
								rotateAmplitude={5}
								scaleOnHover={1.05}
								tiltClassName="tilt-send"
								type="button"
							>
								<Send size={16} />
							</TiltButton>
						</div>
					</aside>
				</div>
			</article>
		</div>
	)
}
