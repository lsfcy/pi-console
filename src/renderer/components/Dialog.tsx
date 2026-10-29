import { useLayoutEffect, useRef, type ReactNode, type SyntheticEvent } from 'react';
export function Dialog({ id, className = '', open, onDismiss, onCancel, labelledBy, describedBy, children }: {
  id: string; className?: string; open: boolean; labelledBy?: string; describedBy?: string; onDismiss: () => void; onCancel?: (event: SyntheticEvent<HTMLDialogElement>) => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog id={id} className={'dialog ' + className} ref={ref} aria-labelledby={labelledBy} aria-describedby={describedBy} onClose={onDismiss} onCancel={onCancel}>{children}</dialog>;
}
