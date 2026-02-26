import { CalendarIcon, CheckBadgeIcon, DatabaseIcon, ListIcon } from "./ui/icons";

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
          <CalendarIcon className="h-5 w-5" />
          <span>Month View</span>
        </button>
      </nav>
    </aside>
  );
}
