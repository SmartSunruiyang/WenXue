import ReactDOM from 'react-dom/client'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { I18nProvider } from '@/lib/i18n'

import App from './App'

import '@/assets/index.css'

// 新标签页固定白底（浅色），不跟随系统深色
document.documentElement.classList.remove('dark')

ReactDOM.createRoot(document.getElementById('root')!).render(
	<ErrorBoundary>
		<I18nProvider>
			<App />
		</I18nProvider>
	</ErrorBoundary>
)
