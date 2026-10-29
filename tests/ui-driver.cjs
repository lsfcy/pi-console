/** Drive controlled inputs with browser-native setters and bubbling DOM events. */
function evaluateSource(source) {
  return `{
    const setInputValue = (target, value) => {
      const element = typeof target === 'string' ? document.getElementById(target) : target;
      if (element instanceof HTMLInputElement && element.type === 'checkbox') {
        if (element.checked !== value) element.click();
        return;
      }
      const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype :
        element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    };
    with (window.__consoleTest || {}) {
      ${source}
    }
  }`;
}
/** Existing smoke scenarios choose responses, but still exercise the real custom dialog. */
function driveConfirmations(controller, respond) {
  const contents = controller.window.webContents;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || contents.isDestroyed()) return;
    busy = true;
    try {
      const request = await contents.executeJavaScript('window.__consoleTest?.confirmation');
      if (request) {
        const result = await respond(request);
        await contents.executeJavaScript(evaluateSource(
          'if (confirmation?.id === ' + JSON.stringify(request.id) + ') {' +
          'const checkbox=document.querySelector("#confirmation-dialog input[type=checkbox]");' +
          'if(checkbox)setInputValue(checkbox,' + Boolean(result.checkboxChecked) + ');' +
          'document.querySelector(\'#confirmation-dialog [data-confirm-response="' + result.response + '"]\')?.click();}'
        ), true);
      }
    } catch (error) { if (!contents.isDestroyed()) console.error('Confirmation driver:', error); }
    finally { busy = false; }
  }, 30);
  controller.window.once('closed', () => clearInterval(timer));
  return () => clearInterval(timer);
}
module.exports = { evaluateSource, driveConfirmations };
