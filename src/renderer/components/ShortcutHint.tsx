import { useWorkspace } from '../state/AppContext.js';
import { bindings, commands, format } from '../../shared/shortcuts.js';
import { t } from '../../shared/i18n.js';
export function ShortcutHint({ command, className }: { command: string; className?: string }) {
  const app = useWorkspace();
  return <kbd className={className} data-shortcut={command}>{format(bindings(app.preferences.shortcuts)[command])}</kbd>;
}
export function useCommandTitle(command: string) {
  const app = useWorkspace(), binding = bindings(app.preferences.shortcuts)[command];
  const label = t(commands.find(item => item.id === command)?.label || command);
  return label + (binding ? t('（{shortcut}）', { shortcut: format(binding) }) : '');
}
