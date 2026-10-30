import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { projectOrderAfterMove } from '../../shared/view-model.js';
import type { WorkspaceController } from '../state/workspace-controller.js';

type Target = { id: string; edge: 'before' | 'after' };
type Drag = { source: string; target: Target | null };
type Gesture = { source: string; pointerId: number; element: HTMLElement; x: number; y: number; startX: number; startY: number; active: boolean };

/** One pointer gesture, one validated drop; no native HTML drag or persistent UI state. */
export function useProjectDrag(app: WorkspaceController) {
  const gesture = useRef<Gesture | null>(null), feedback = useRef<Drag | null>(null), suppressClick = useRef(false);
  const [state, setState] = useState<Drag | null>(null);
  const update = (next: Drag | null) => {
    const previous = feedback.current;
    if (previous?.source === next?.source && previous?.target?.id === next?.target?.id && previous?.target?.edge === next?.target?.edge) return;
    feedback.current = next; setState(next);
  };
  useEffect(() => {
    let frame = 0;
    const targetFor = (drag: Gesture): Target | null => {
      const group = document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>('[data-project-group-id]');
      const id = group?.dataset.projectGroupId;
      const source = app.projects.find(project => project.id === drag.source), target = app.projects.find(project => project.id === id);
      if (!group || !source || !target || source.id === id || Boolean(source.pinned) !== Boolean(target.pinned)) return null;
      const rect = group.querySelector('.project-row')!.getBoundingClientRect();
      return { id: target.id, edge: drag.y < rect.top + rect.height / 2 ? 'before' : 'after' };
    };
    const showTarget = (drag: Gesture) => update({ source: drag.source, target: targetFor(drag) });
    const stop = () => {
      cancelAnimationFrame(frame); frame = 0;
      const drag = gesture.current; gesture.current = null;
      if (drag?.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
      update(null);
    };
    const scroll = () => {
      frame = 0;
      const drag = gesture.current, list = document.querySelector('.sidebar-library');
      if (!drag?.active || !list) return;
      const rect = list.getBoundingClientRect();
      if (drag.x < rect.left || drag.x > rect.right || drag.y < rect.top - 24 || drag.y > rect.bottom + 24) return;
      const speed = drag.y < rect.top + 28 ? -8 : drag.y > rect.bottom - 28 ? 8 : 0;
      if (!speed) return;
      const before = list.scrollTop; list.scrollTop += speed;
      showTarget(drag);
      if (list.scrollTop !== before) frame = requestAnimationFrame(scroll);
    };
    const move = (event: globalThis.PointerEvent) => {
      const drag = gesture.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.element.isConnected || !(event.buttons & 1)) { stop(); return; }
      drag.x = event.clientX; drag.y = event.clientY;
      if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) return;
      if (!drag.active) {
        drag.active = true; suppressClick.current = true;
        drag.element.setPointerCapture(drag.pointerId);
      }
      event.preventDefault(); showTarget(drag);
      cancelAnimationFrame(frame); frame = requestAnimationFrame(scroll);
    };
    const finish = (event: globalThis.PointerEvent) => {
      const drag = gesture.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.x = event.clientX; drag.y = event.clientY;
      const target = drag.active ? targetFor(drag) : null;
      stop();
      if (!target) return;
      const ids = projectOrderAfterMove(app.projects, drag.source, target.id, target.edge);
      if (ids) app.safely(async () => app.applySnapshot(await app.bridge.reorderProjects(ids)));
    };
    const cancel = (event: globalThis.PointerEvent) => { if (gesture.current?.pointerId === event.pointerId) stop(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') stop(); };
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel); window.addEventListener('lostpointercapture', cancel); window.addEventListener('blur', stop); window.addEventListener('keydown', escape, true);
    return () => {
      stop(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('lostpointercapture', cancel); window.removeEventListener('blur', stop); window.removeEventListener('keydown', escape, true);
    };
  }, [app]);
  return {
    state,
    start(event: PointerEvent<HTMLElement>, source: string) {
      if (event.button !== 0 || !event.isPrimary || gesture.current) return;
      suppressClick.current = false;
      if (event.target instanceof Element && event.target.closest('.project-new-pi')) return;
      gesture.current = { source, pointerId: event.pointerId, element: event.currentTarget, x: event.clientX, y: event.clientY,
        startX: event.clientX, startY: event.clientY, active: false };
    },
    click(event: MouseEvent<HTMLElement>) {
      if (event.detail > 0 && suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
    }
  };
}
