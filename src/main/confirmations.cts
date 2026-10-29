import { t } from '../shared/i18n.js';
import { randomUUID } from 'node:crypto';
import type { Confirm, ConfirmationRequest, ConfirmationResult } from '../shared/contracts.js';

/** One application-owned confirmation surface; cancellation never authorizes a mutation. */
export class Confirmations {
  private queue: { request: ConfirmationRequest; resolve: (result: ConfirmationResult) => void }[] = [];
  constructor(private show: (request: ConfirmationRequest | null) => void) {}
  publish() { this.show(this.queue[0]?.request || null); }
  ask: Confirm = options => new Promise(resolve => {
    if (this.queue.length >= 20) { resolve({ response: options.cancelId ?? 0, checkboxChecked: false }); return; }
    this.queue.push({ request: { ...options, id: randomUUID() }, resolve });
    if (this.queue.length === 1) this.publish();
  });
  answer(id: string, result: ConfirmationResult) {
    const pending = this.queue[0];
    if (!pending || pending.request.id !== id) throw new Error(t('此提醒已关闭，请重新操作。'));
    if (!result || !Number.isInteger(result.response) || result.response < 0 ||
        result.response >= pending.request.buttons.length || typeof result.checkboxChecked !== 'boolean') throw new Error(t('无效的提醒响应。'));
    this.queue.shift(); this.publish();
    pending.resolve({ response: result.response, checkboxChecked: Boolean(pending.request.checkboxLabel && result.checkboxChecked) });
  }
  cancelAll() {
    const pending = this.queue.splice(0); this.publish();
    for (const item of pending) item.resolve({ response: item.request.cancelId ?? 0, checkboxChecked: false });
  }
}
