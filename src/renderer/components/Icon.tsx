export function Icon({ name }: { name: string }) {
  return <svg className="icon" aria-hidden="true"><use href={'#i-' + name} /></svg>;
}
export function IconDefinitions() {
  return <svg className="svg-defs" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>

    <symbol id="i-grip" viewBox="0 0 24 24"><circle cx="8" cy="5" r="1"/><circle cx="16" cy="5" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="19" r="1"/><circle cx="16" cy="19" r="1"/></symbol>
    <symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></symbol>
    <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
    <symbol id="i-search" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></symbol>
    <symbol id="i-terminal" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="4"/><path d="m7 9 3 3-3 3m6 0h4"/></symbol>
    <symbol id="i-folder" viewBox="0 0 24 24"><path d="M3 8V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></symbol>
    <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14m-5-5 5 5-5 5"/></symbol>
    <symbol id="i-close" viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6"/></symbol>
    <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3"/></symbol>
    <symbol id="i-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></symbol>
    <symbol id="i-history" viewBox="0 0 24 24"><path d="M3 4v5h5M4 9a9 9 0 1 1 0 7M12 7v5l3 2"/></symbol>
    <symbol id="i-star" viewBox="0 0 24 24"><path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4-5.7-3-5.7 3 1.1-6.4-4.6-4.5 6.4-.9Z"/></symbol>
    <symbol id="i-pin" viewBox="0 0 24 24"><path d="m16 3 5 5-4 1-3 5v3l-7-7h3l5-3 1-4ZM10 14l-6 6"/></symbol>
    <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></symbol>
    <symbol id="i-sessions" viewBox="0 0 24 24"><path d="M4 3h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 1-2Z"/><path d="M18 8h2a1 1 0 0 1 1 1v12l-5-3h-5a2 2 0 0 1-2-2v-1"/></symbol>
    <symbol id="i-chat" viewBox="0 0 24 24"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3H3V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h7"/></symbol>
    <symbol id="i-settings" viewBox="0 0 24 24"><path d="m9 3-1 3-3 1-2 4 2 2v3l4 3 3-1 3 1 4-3v-3l2-2-2-4-3-1-1-3Z"/><circle cx="12" cy="11" r="3"/></symbol>
    <symbol id="i-external" viewBox="0 0 24 24"><path d="M14 4h6v6m0-6L10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></symbol>
    <symbol id="i-download" viewBox="0 0 24 24"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/></symbol>
    <symbol id="i-minus" viewBox="0 0 24 24"><path d="M5 12h14"/></symbol>
    <symbol id="i-list" viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M3 6h1M3 12h1M3 18h1"/></symbol>
    <symbol id="i-sidebar" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></symbol>
    <symbol id="i-activity" viewBox="0 0 24 24"><path d="M4 19V5m0 14h16"/><path d="m7 15 4-5 3 3 4-6"/></symbol>
    <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.1"/></symbol>
    <symbol id="i-folder-open" viewBox="0 0 24 24"><path d="M3 10V6a2 2 0 0 1 2-2h5l2 3h6a2 2 0 0 1 2 2v1M3 10h19l-4 10H3Z"/></symbol>
    <symbol id="i-chevron" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></symbol>
    <symbol id="i-alert" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17v.1"/></symbol>
    <symbol id="i-pause" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9 8v8M15 8v8"/></symbol>

  </defs></svg>;
}
