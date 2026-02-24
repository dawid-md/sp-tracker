import { useCallback, useEffect, useMemo, useState } from "react";
import { extractErrorMessage, fetchTasksItems, type TaskItem } from "../lib/sharepointApi";

function parseSharePointDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const trimmedValue = value.trim();
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmedValue);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]) - 1;
    const day = Number(dateOnlyMatch[3]);
    return new Date(year, month, day);
  }

  const parsed = new Date(trimmedValue);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function isDueToday(deadlineDate: string | undefined, today: Date): boolean {
  const parsedDate = parseSharePointDate(deadlineDate);
  if (!parsedDate) {
    return false;
  }

  return (
    parsedDate.getFullYear() === today.getFullYear() &&
    parsedDate.getMonth() === today.getMonth() &&
    parsedDate.getDate() === today.getDate()
  );
}

function formatDeadlineDate(value: string | undefined): string {
  const parsedDate = parseSharePointDate(value);
  if (!parsedDate) {
    return value ?? "";
  }

  return parsedDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getAssignee(item: TaskItem): string {
  return item.Person?.Title ?? "";
}

export default function Today() {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const todayLabel = useMemo(() => {
    return new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, []);

  const loadTodayItems = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const now = new Date();
      const listItems = await fetchTasksItems();
      const dueTodayItems = listItems.filter((item) => isDueToday(item.DeadlineDate, now));
      setItems(dueTodayItems);
      setLastUpdated(new Date());
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTodayItems();
  }, [loadTodayItems]);

  return (
    <section className="h-full p-8 text-slate-800">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Today</h1>
          <p className="mt-1 text-sm text-slate-500">Tasks due on {todayLabel}</p>
        </div>

        <button
          type="button"
          onClick={() => void loadTodayItems()}
          className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isLoading}
        >
          {isLoading ? "Loading..." : "Refresh"}
        </button>
      </header>

      {errorMessage ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Failed to load tasks: {errorMessage}
        </div>
      ) : null}

      {!errorMessage && isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading today&apos;s tasks...</div>
      ) : null}

      {!errorMessage && !isLoading && items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">No tasks with deadline date today.</div>
      ) : null}

      {!errorMessage && !isLoading && items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm text-slate-700">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Deadline Date</th>
                <th className="px-4 py-3">Person</th>
                <th className="px-4 py-3">Person Email</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Comment</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.Id} className="border-t border-slate-200">
                  <td className="px-4 py-3">{item.Period ?? ""}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{item.Title ?? "Untitled task"}</td>
                  <td className="px-4 py-3">{formatDeadlineDate(item.DeadlineDate)}</td>
                  <td className="px-4 py-3">{getAssignee(item)}</td>
                  <td className="px-4 py-3">{item.PersonEmail ?? item.Person?.EMail ?? item.Person?.Email ?? ""}</td>
                  <td className="px-4 py-3">{item.Status ?? ""}</td>
                  <td className="px-4 py-3">{item.Comment ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {lastUpdated ? <p className="mt-4 text-xs text-slate-400">Last updated: {lastUpdated.toLocaleTimeString()}</p> : null}
    </section>
  );
}
