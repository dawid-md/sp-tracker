function CheckBadgeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-7 w-7">
      <path
        d="M8.6 12.4 11 14.8l4.7-4.7M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
      <path
        d="M8.5 6.5h10M8.5 12h10M8.5 17.5h10M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
      <path
        d="M7 3.8v3M17 3.8v3M3.8 9.2h16.4M6.4 20.2h11.2a2.6 2.6 0 0 0 2.6-2.6V7.2a2.6 2.6 0 0 0-2.6-2.6H6.4a2.6 2.6 0 0 0-2.6 2.6v10.4a2.6 2.6 0 0 0 2.6 2.6Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
      <path
        d="M4.2 7.5c0 1.8 3.5 3.2 7.8 3.2s7.8-1.4 7.8-3.2-3.5-3.2-7.8-3.2-7.8 1.4-7.8 3.2ZM4.2 12c0 1.8 3.5 3.2 7.8 3.2s7.8-1.4 7.8-3.2M4.2 16.5c0 1.8 3.5 3.2 7.8 3.2s7.8-1.4 7.8-3.2M4.2 7.5v9M19.8 7.5v9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
      <path
        d="M12 12.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8ZM6.6 18.6a5.4 5.4 0 0 1 10.8 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type AppView = "today" | "allTasks" | "template";

interface LeftPanelProps {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
}

function getNavButtonClass(isActive: boolean): string {
  if (isActive) {
    return "flex h-14 items-center gap-4 rounded-2xl bg-[var(--accent)] px-5 text-lg font-semibold text-blue-50 transition hover:bg-[var(--accent-strong)]";
  }

  return "flex h-14 items-center gap-4 rounded-2xl px-5 text-lg font-medium text-slate-300 transition hover:bg-white/5 hover:text-slate-100";
}

export default function LeftPanel({ activeView, onSelectView }: LeftPanelProps) {
  return (
    <aside className="flex h-screen w-full max-w-80 flex-col border-r border-[var(--surface-border)] bg-[var(--sidebar-bg)] px-4 py-5 text-white">
      <div className="flex items-center gap-4 px-2">
        <div className="grid h-12 w-12 place-items-center rounded-xl bg-[var(--accent)] text-blue-100">
          <CheckBadgeIcon />
        </div>
        <div>
          <p className="text-4xl font-semibold leading-8 tracking-tight">Tracker</p>
          <p className="text-sm text-[var(--muted)]">Project Tasks</p>
        </div>
      </div>

      <nav className="mt-10 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => onSelectView("today")}
          className={getNavButtonClass(activeView === "today")}
        >
          <ListIcon />
          <span>Today</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectView("template")}
          className={getNavButtonClass(activeView === "template")}
        >
          <DatabaseIcon />
          <span>Template</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectView("allTasks")}
          className={getNavButtonClass(activeView === "allTasks")}
        >
          <ListIcon />
          <span>All Tasks</span>
        </button>

        <button
          type="button"
          className="flex h-14 items-center gap-4 rounded-2xl px-5 text-lg font-medium text-slate-300 transition hover:bg-white/5 hover:text-slate-100"
        >
          <CalendarIcon />
          <span>Month View</span>
        </button>
      </nav>

      <button
        type="button"
        className="mt-8 flex h-16 items-center gap-4 rounded-2xl border border-dashed border-blue-300/25 px-5 text-lg font-medium text-slate-300 transition hover:border-blue-200/45 hover:bg-white/5 hover:text-slate-100"
      >
        <DatabaseIcon />
        <span>Load Demo Data</span>
      </button>

      <div className="mt-auto border-t border-white/15 pt-8">
        <button type="button" className="flex w-full items-center gap-4 rounded-2xl px-2 py-2 text-left transition hover:bg-white/5">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-teal-400 text-[#0A2C33]">
            <UserIcon />
          </span>
          <span>
            <span className="block text-2xl font-semibold text-slate-100">Guest User</span>
            <span className="block text-lg text-slate-400">Edit Profile</span>
          </span>
        </button>
      </div>
    </aside>
  );
}
