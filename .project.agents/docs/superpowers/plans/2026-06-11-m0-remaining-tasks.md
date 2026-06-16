# M0 剩余任务实施计划

> 关联：ROADMAP.md M0 — 基线整备
> 验收标准：克隆仓库 → `pnpm i` → `pnpm build` 一次成功；`pnpm dev` 打开空白主窗口

## 任务总览

| 序号 | 任务                | 产出物                                                                   |
| ---- | ------------------- | ------------------------------------------------------------------------ |
| 1    | pnpm workspace 骨架 | `pnpm-workspace.yaml`、根 `package.json`、`.nvmrc`、Prettier/ESLint 配置 |
| 2    | 空 Electron 壳      | `apps/desktop/` 完整目录结构 + 可运行的空白窗口                          |
| 3    | 根聚合脚本          | 根 `package.json` 中的 `build`/`dev`/`test` 脚本                         |

## 依赖关系

```
任务 1 (workspace 骨架) → 任务 2 (Electron 壳) → 任务 3 (聚合脚本)
```

---

## 任务 1: pnpm workspace 骨架

### 1.1 pnpm-workspace.yaml

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### 1.2 根 package.json

```json
{
	"name": "wenxue",
	"private": true,
	"packageManager": "pnpm@9.15.0",
	"engines": {
		"node": ">=22.0.0"
	},
	"scripts": {
		"build": "pnpm -r build",
		"dev": "pnpm -F desktop dev",
		"test": "pnpm -r test",
		"lint": "eslint .",
		"format": "prettier --write .",
		"format:check": "prettier --check ."
	},
	"devDependencies": {
		"prettier": "^3.4.0",
		"prettier-plugin-organize-imports": "^4.1.0",
		"eslint": "^9.15.0",
		"typescript-eslint": "^8.15.0",
		"@eslint-react/eslint-plugin": "^1.19.0",
		"typescript": "^5.7.0"
	}
}
```

### 1.3 .nvmrc

```
22
```

### 1.4 Prettier 配置 (.prettierrc)

继承上游 page-agent 配置：

- tab 缩进 (`useTabs: true`)
- 单引号 (`singleQuote: true`)
- 无分号 (`semi: false`)
- printWidth: 100
- import 排序插件

```json
{
	"useTabs": true,
	"singleQuote": true,
	"semi": false,
	"printWidth": 100,
	"plugins": ["prettier-plugin-organize-imports"]
}
```

### 1.5 ESLint 配置 (eslint.config.js)

使用 flat config 格式（ESLint 9）：

- typescript-eslint
- @eslint-react

```js
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from '@eslint-react/eslint-plugin'

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['**/*.{ts,tsx}'],
		...react.configs['recommended-typescript'],
	},
	{
		ignores: ['**/node_modules/**', '**/dist/**', '**/.output/**'],
	},
)
```

### 1.6 .prettierignore

```
node_modules
dist
.output
*.lock
pnpm-lock.yaml
```

---

## 任务 2: 空 Electron 壳

### 2.1 目录结构

```
apps/desktop/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
├── tailwind.config.js
├── postcss.config.js
├── src/
│   ├── main/
│   │   └── index.ts          # 主进程入口
│   ├── preload/
│   │   └── index.ts          # preload 脚本
│   └── renderer/
│       ├── index.html         # HTML 入口
│       ├── src/
│       │   ├── main.tsx       # React 入口
│       │   ├── App.tsx        # 根组件
│       │   └── index.css      # Tailwind 入口
│       └── env.d.ts           # 类型声明
└── resources/
    └── icon.png               # 占位图标
```

### 2.2 apps/desktop/package.json

```json
{
	"name": "desktop",
	"private": true,
	"version": "0.0.0",
	"main": "./out/main/index.js",
	"scripts": {
		"dev": "electron-vite dev",
		"build": "electron-vite build",
		"preview": "electron-vite preview",
		"test": "vitest run"
	},
	"dependencies": {
		"electron-log": "^5.2.0"
	},
	"devDependencies": {
		"@vitejs/plugin-react": "^4.3.4",
		"electron": "^33.2.0",
		"electron-vite": "^2.3.0",
		"react": "^19.0.0",
		"react-dom": "^19.0.0",
		"typescript": "^5.7.0",
		"vitest": "^2.1.0",
		"tailwindcss": "^4.0.0",
		"@tailwindcss/vite": "^4.0.0"
	}
}
```

### 2.3 electron.vite.config.ts

```ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
	},
	renderer: {
		resolve: {
			alias: {
				'@': resolve('src/renderer/src'),
			},
		},
		plugins: [react(), tailwindcss()],
	},
})
```

### 2.4 src/main/index.ts

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow() {
	const win = new BrowserWindow({
		width: 800,
		height: 600,
		webPreferences: {
			preload: join(__dirname, '../preload/index.js'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	})

	if (process.env.ELECTRON_RENDERER_URL) {
		win.loadURL(process.env.ELECTRON_RENDERER_URL)
	} else {
		win.loadFile(join(__dirname, '../renderer/index.html'))
	}
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit()
	}
})

app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow()
	}
})
```

### 2.5 src/preload/index.ts

```ts
import { contextBridge, ipcRenderer } from 'electron'

// 基础 API，后续 M3 扩展为 DesktopBridge
contextBridge.exposeInMainWorld('wenxue', {
	versions: {
		node: () => process.versions.node,
		chrome: () => process.versions.chrome,
		electron: () => process.versions.electron,
	},
})
```

### 2.6 src/renderer/index.html

```html
<!DOCTYPE html>
<html lang="zh-CN">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>问学 WenXue</title>
	</head>
	<body>
		<div id="root"></div>
		<script type="module" src="./src/main.tsx"></script>
	</body>
</html>
```

### 2.7 src/renderer/src/main.tsx

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
)
```

### 2.8 src/renderer/src/App.tsx

```tsx
export default function App() {
	return (
		<div className="flex h-screen items-center justify-center bg-gray-50">
			<h1 className="text-4xl font-bold text-gray-900">问学 WenXue</h1>
		</div>
	)
}
```

### 2.9 src/renderer/src/index.css

```css
@import 'tailwindcss';
```

### 2.10 tsconfig.json

```json
{
	"files": [],
	"references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]
}
```

### 2.11 tsconfig.node.json

```json
{
	"compilerOptions": {
		"composite": true,
		"module": "ESNext",
		"moduleResolution": "bundler",
		"allowSyntheticDefaultImports": true,
		"esModuleInterop": true,
		"outDir": "./out",
		"strict": true,
		"skipLibCheck": true
	},
	"include": ["electron.vite.config.ts", "src/main/**/*", "src/preload/**/*"]
}
```

### 2.12 tsconfig.web.json

```json
{
	"compilerOptions": {
		"composite": true,
		"module": "ESNext",
		"moduleResolution": "bundler",
		"jsx": "react-jsx",
		"allowSyntheticDefaultImports": true,
		"esModuleInterop": true,
		"outDir": "./out",
		"strict": true,
		"skipLibCheck": true,
		"paths": {
			"@/*": ["./src/renderer/src/*"]
		}
	},
	"include": ["src/renderer/**/*"]
}
```

### 2.13 tailwind.config.js

```js
/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/renderer/**/*.{html,tsx}'],
}
```

### 2.14 postcss.config.js

```js
export default {
	plugins: {
		tailwindcss: {},
	},
}
```

---

## 任务 3: 根聚合脚本

根 `package.json` 的 scripts 已在任务 1.2 中定义：

- `pnpm build` → `pnpm -r build`（递归执行所有子包的 build）
- `pnpm dev` → `pnpm -F desktop dev`（启动 desktop 开发模式）
- `pnpm test` → `pnpm -r test`（递归执行所有子包的测试）

---

## 执行顺序

1. 创建根配置文件（pnpm-workspace.yaml、package.json、.nvmrc、.prettierrc、eslint.config.js、.prettierignore）
2. 创建 apps/desktop/ 目录结构
3. 创建 desktop 的所有配置文件和源代码
4. 运行 `pnpm install` 安装依赖
5. 运行 `pnpm build` 验证构建
6. 运行 `pnpm dev` 验证窗口打开
7. 更新 ROADMAP.md 打勾
8. 写执行日志

## 验收检查

- [ ] `pnpm install` 成功
- [ ] `pnpm build` 成功（所有子包构建完成）
- [ ] `pnpm dev` 打开空白主窗口，显示"问学 WenXue"
- [ ] TypeScript 严格模式无报错
- [ ] Prettier 格式检查通过
