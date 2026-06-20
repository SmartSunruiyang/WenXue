import React from 'react'
import ReactDOM from 'react-dom/client'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { I18nProvider } from '@/lib/i18n'
import { configureLogger } from '@/lib/logger'
import { installLlmFetchLogging } from '@/lib/loggingFetch'

import App from './App'

import '@/assets/index.css'

// Install logging before anything else
configureLogger({ context: 'hub', sink: 'message' })
installLlmFetchLogging()

// Force light mode
document.documentElement.classList.remove('dark')

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<ErrorBoundary>
			<I18nProvider>
				<App />
			</I18nProvider>
		</ErrorBoundary>
	</React.StrictMode>
)
