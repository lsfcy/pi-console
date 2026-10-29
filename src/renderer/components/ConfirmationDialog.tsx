import { t } from '../../shared/i18n.js';
import { useLayoutEffect, useRef, useState } from 'react';
import { useWorkspace } from '../state/AppContext.js';
import { Dialog } from './Dialog.js';
import { Icon } from './Icon.js';

export function ConfirmationDialog() {
  const app = useWorkspace(), request = app.confirmation;
  return request ? <Confirmation key={request.id} /> : null;
}
function Confirmation() {
  const app = useWorkspace(), request = app.confirmation!;
  const [checked, setChecked] = useState(Boolean(request.checkboxChecked));
  const [answering, setAnswering] = useState(false);
  const defaultAction = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { defaultAction.current?.focus(); }, []);
  const answer = async (response: number) => {
    if (answering) return;
    setAnswering(true);
    try { await app.bridge.answerConfirmation(request.id, { response, checkboxChecked: checked }); }
    catch (error) { setAnswering(false); app.notify(t(String(error))); }
  };
  const cancel = () => { void answer(request.cancelId ?? 0); };
  const buttonClass = (index: number) => {
    if (index === (request.cancelId ?? 0)) return 'button-secondary';
    const destructive = request.destructiveId === undefined ? request.type === 'warning' : index === request.destructiveId;
    if (destructive) return 'button-danger';
    return request.type === 'warning' ? 'button-accent' : 'button-primary';
  };
  return <Dialog id="confirmation-dialog" className="confirmation-dialog" open onDismiss={cancel}
    labelledBy="confirmation-title" describedBy="confirmation-detail" onCancel={event => { event.preventDefault(); cancel(); }}>
    <div className="dialog-heading"><h2 id="confirmation-title"><Icon name={request.type === 'question' ? 'info' : 'alert'} />{t(request.message)}</h2>
      <button className="icon-button" aria-label={t("取消")} disabled={answering} onClick={cancel}><Icon name="close" /></button></div>
    <p id="confirmation-detail" className="confirmation-detail">{t(request.detail ?? '')}</p>
    {request.checkboxLabel && <label className="checkbox-label"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} disabled={answering} />{t(request.checkboxLabel)}</label>}
    <div className="dialog-actions" onKeyDown={event => {
      if (answering || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey ||
          !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (current < 0) return;
      event.preventDefault(); event.stopPropagation();
      buttons[(current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }}>{request.buttons.map((label, index) => <button key={index} type="button"
      ref={index === (request.defaultId ?? 0) ? defaultAction : undefined} disabled={answering} data-confirm-response={index}
      className={'button ' + buttonClass(index)}
      onClick={() => void answer(index)}>{t(label)}</button>)}</div>
  </Dialog>;
}
