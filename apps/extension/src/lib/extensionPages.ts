interface ExtensionPagesApi {
	runtime: Pick<typeof chrome.runtime, 'getURL'>
	tabs: Pick<typeof chrome.tabs, 'create'>
}

export async function openExtensionOptionsPage(api: ExtensionPagesApi = chrome) {
	await api.tabs.create({
		active: true,
		url: api.runtime.getURL('options.html'),
	})
}
