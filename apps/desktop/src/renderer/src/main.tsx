import '@wenxue/client-operations/styles.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import './account-settings.css'
import App from './App'
import './BrowserPage.css'
import { CaptchaDialog } from './CaptchaDialog'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<App />
		<CaptchaDialog />
	</React.StrictMode>,
)
