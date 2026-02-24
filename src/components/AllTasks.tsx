import { useCallback, useEffect, useMemo, useState } from "react";
import { extractErrorMessage, fetchTasksItems, type TaskItem } from "../lib/sharepointApi";

interface FilterState {
  search: string;
  period: string;
  status: string;
  ownerEmail: string;
  fromDate: string;
  toDate: string;
}

const EMPTY_FILTERS: FilterState = {
  search: "",
  period: "",
  status: "",
  ownerEmail: "",
  fromDate: "",
  toDate: "",
};

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

function parseDateInput(value: string): Date | null {
  if (!value) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  return new Date(year, month, day);
}

function toDateOnlyNumber(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatDeadlineDate(value: string | undefined): string {
  const parsedDate = parseSharePointDate(value);
  if (!parsedDate) {
    return value ?? "";
  }

  return parsedDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getPersonName(item: TaskItem): string {
  return item.Person?.Title ?? "";
}

function getPersonEmail(item: TaskItem): string {
  return item.PersonEmail ?? item.Person?.EMail ?? item.Person?.Email ?? "";
}

export default function AllTasks() {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  const loadAllTasks = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const listItems = await fetchTasksItems();
      setItems(listItems);
      setLastUpdated(new Date());
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllTasks();
  }, [loadAllTasks]);

  const periodOptions = useMemo(() => {
    const values = new Set<string>();
    for (const item of items) {
      const period = item.Period;
      if (period !== undefined && period !== null && String(period).trim()) {
        values.add(String(period).trim());
      }
    }

    return Array.from(values).sort((a, b) => b.localeCompare(a));
  }, [items]);

  const statusOptions = useMemo(() => {
    const values = new Set<string>();
    for (const item of items) {
      const status = item.Status?.trim();
      if (status) {
        values.add(status);
      }
    }

    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filteredItems = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    const ownerEmailFilter = filters.ownerEmail.trim().toLowerCase();
    const fromDate = parseDateInput(filters.fromDate);
    const toDate = parseDateInput(filters.toDate);
    const fromDateValue = fromDate ? toDateOnlyNumber(fromDate) : null;
    const toDateValue = toDate ? toDateOnlyNumber(toDate) : null;

    return items.filter((item) => {
      if (filters.period && String(item.Period ?? "").trim() !== filters.period) {
        return false;
      }

      const itemStatus = item.Status?.trim() ?? "";
      if (filters.status && itemStatus !== filters.status) {
        return false;
      }

      const personEmail = getPersonEmail(item).toLowerCase();
      if (ownerEmailFilter && !personEmail.includes(ownerEmailFilter)) {
        return false;
      }

      const taskDate = parseSharePointDate(item.DeadlineDate);
      if (fromDateValue !== null) {
        if (!taskDate || toDateOnlyNumber(taskDate) < fromDateValue) {
          return false;
        }
      }

      if (toDateValue !== null) {
        if (!taskDate || toDateOnlyNumber(taskDate) > toDateValue) {
          return false;
        }
      }

      if (search) {
        const haystack = [
          String(item.Period ?? ""),
          item.Title ?? "",
          item.Status ?? "",
          item.Comment ?? "",
          getPersonName(item),
          getPersonEmail(item),
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(search)) {
          return false;
        }
      }

      return true;
    });
  }, [filters, items]);

  return (
    <section className="h-full p-8 text-slate-800">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">All Tasks</h1>
          <p className="mt-1 text-sm text-slate-500">
            Showing {filteredItems.length} of {items.length} task(s)
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadAllTasks()}
          className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isLoading}
        >
          {isLoading ? "Loading..." : "Refresh"}
        </button>
      </header>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <input
            type="text"
            value={filters.search}
            onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
            placeholder="Search title, comment, person..."
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />

          <select
            value={filters.period}
            onChange={(event) => setFilters((prev) => ({ ...prev, period: event.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">All periods</option>
            {periodOptions.map((period) => (
              <option key={period} value={period}>
                {period}
              </option>
            ))}
          </select>

          <select
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={filters.ownerEmail}
            onChange={(event) => setFilters((prev) => ({ ...prev, ownerEmail: event.target.value }))}
            placeholder="Owner email contains..."
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />

          <input
            type="date"
            value={filters.fromDate}
            onChange={(event) => setFilters((prev) => ({ ...prev, fromDate: event.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />

          <input
            type="date"
            value={filters.toDate}
            onChange={(event) => setFilters((prev) => ({ ...prev, toDate: event.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>

        <button
          type="button"
          onClick={() => setFilters(EMPTY_FILTERS)}
          className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Clear Filters
        </button>
      </div>

      {errorMessage ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Failed to load tasks: {errorMessage}
        </div>
      ) : null}

      {!errorMessage && isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading tasks...</div>
      ) : null}

      {!errorMessage && !isLoading && filteredItems.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">No tasks match selected filters.</div>
      ) : null}

      {!errorMessage && !isLoading && filteredItems.length > 0 ? (
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
              {filteredItems.map((item) => (
                <tr key={item.Id} className="border-t border-slate-200">
                  <td className="px-4 py-3">{item.Period ?? ""}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{item.Title ?? "Untitled task"}</td>
                  <td className="px-4 py-3">{formatDeadlineDate(item.DeadlineDate)}</td>
                  <td className="px-4 py-3">{getPersonName(item)}</td>
                  <td className="px-4 py-3">{getPersonEmail(item)}</td>
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
