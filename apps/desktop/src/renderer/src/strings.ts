export const strings = {
	brand: '问学 WenXue',
	slogan: 'ask for everything',
	shellLabel: '问学桌面启动器',
	runtimeLabel: 'DESKTOP',
	statusCapsuleLabel: '浏览器运行状态',
	status: {
		idle: '未运行',
		launching: '启动中',
		running: '浏览器运行中',
		error: '启动异常',
	},
	description: {
		idle: '浏览器尚未启动。点击后会打开独立的问学浏览器。',
		launching: '正在准备浏览器与问学插件。',
		running: '在浏览器工具栏打开问学侧边栏，输入你的任务。',
		error: '浏览器启动或运行异常。可重新启动，或查看日志定位原因。',
	},
	action: {
		launch: '启动浏览器',
		focus: '聚焦窗口',
		relaunch: '重新启动',
		openLogs: '查看日志',
	},
	launchTimeline: {
		title: '启动序列',
		items: ['检查资源', '启动浏览器', '加载插件'],
	},
	onboarding: {
		title: '第一次使用问学',
		items: [
			'启动独立的问学浏览器。',
			'在工具栏打开或固定问学插件。',
			'需要自定义模型时，进入插件设置页添加 OpenAI-compatible 模型。',
			'打开目标网页，在侧边栏输入自然语言任务。',
			'执行过程中可随时停止或人工接管。',
		],
	},
	errorFallback: '浏览器启动或运行异常。请重新启动；若仍失败，请查看主进程日志定位原因。',
	openLogsFallback: '无法打开日志目录。请在系统的应用数据目录中手动查看问学日志。',
	versionLabel: {
		app: 'App',
		browser: 'Browser',
		extension: 'Extension',
	},
}
