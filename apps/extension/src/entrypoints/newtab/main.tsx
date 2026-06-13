import ReactDOM from 'react-dom/client'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { I18nProvider } from '@/lib/i18n'

import App from './App'

import '@/assets/index.css'

const mq = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (dark: boolean) => document.documentElement.classList.toggle('dark', dark)
applyTheme(mq.matches)
mq.addEventListener('change', (e) => applyTheme(e.matches))

ReactDOM.createRoot(document.getElementById('root')!).render(
	<ErrorBoundary>
		<I18nProvider>
			<App />
		</I18nProvider>
	</ErrorBoundary>
)
