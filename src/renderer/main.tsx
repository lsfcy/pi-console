import { createRoot } from 'react-dom/client';
import { StartupError } from './components/StartupError.js';
import { App } from './App.js';
import { WorkspaceController } from './state/workspace-controller.js';
import { setLanguage, t } from '../shared/i18n.js';
import '@xterm/xterm/css/xterm.css';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Application root is missing');
const query = new URLSearchParams(window.location.search), startupError = query.get('startup-error');
const startupLanguage = query.get('language');
if (startupLanguage === 'zh-CN' || startupLanguage === 'en-US') setLanguage(startupLanguage);
createRoot(container).render(startupError !== null ? <StartupError title={new URLSearchParams(window.location.search).get('startup-error-title') || t('启动失败')} message={startupError} /> : <App controller={new WorkspaceController(window.piGui)} />);
