import { t } from '../shared/i18n.js';
import { startApp, showStartupError } from './app.cjs';
import { message } from '../shared/errors.js';

void startApp().catch(async error => {
  console.error(error);
  await showStartupError(t('Pi Console 启动失败'), message(error));
});
