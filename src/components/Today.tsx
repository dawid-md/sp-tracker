import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteTaskItem, extractErrorMessage, fetchTasksItems, resolvePersonIdByEmail, type TaskItem, type TaskPayload, updateTaskItem } from "../lib/sharepointApi";

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

function normalizeDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function isSameDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

interface TaskEditForm {
  period: string;
  title: string;
  deadlineDate: string;
  personEmail: string;
  status: string;
  comment: string;
}

const EMPTY_EDIT_FORM: TaskEditForm = {
  period: "",
  title: "",
  deadlineDate: "",
  personEmail: "",
  status: "",
  comment: "",
};

const STATUS_OPTIONS = ["", "In Progress", "Completed", "Missed"] as const;

function normalizeStatusValue(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return STATUS_OPTIONS.includes(trimmed as (typeof STATUS_OPTIONS)[number]) ? trimmed : "";
}

function toDateInputValue(value: string | undefined): string {
  const parsedDate = parseSharePointDate(value);
  if (!parsedDate) {
    return "";
  }

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toEditForm(item: TaskItem): TaskEditForm {
  return {
    period: item.Period !== undefined && item.Period !== null ? String(item.Period) : "",
    title: item.Title ?? "",
    deadlineDate: toDateInputValue(item.DeadlineDate),
    personEmail: item.PersonEmail ?? item.Person?.EMail ?? item.Person?.Email ?? "",
    status: normalizeStatusValue(item.Status),
    comment: item.Comment ?? "",
  };
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="m4.2 16.8-.9 4 4-.9 10-10-3.1-3.1-10 10ZM12.6 6l3.1 3.1M15.5 4.8l.6-.6a1.8 1.8 0 0 1 2.6 2.6l-.6.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M4.7 6.7h14.6M9.2 6.7v-1a1.5 1.5 0 0 1 1.5-1.5h2.6a1.5 1.5 0 0 1 1.5 1.5v1M8.2 19.8a1.5 1.5 0 0 0 1.5 1.4h4.6a1.5 1.5 0 0 0 1.5-1.4l.8-13.1H7.4l.8 13.1Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="m5 12 4.4 4.4L19 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M20 6v5h-5M4 18v-5h5M6.7 9.2A7 7 0 0 1 20 11M17.3 14.8A7 7 0 0 1 4 13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Today() {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(() => normalizeDate(new Date()));
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<TaskEditForm>(EMPTY_EDIT_FORM);

  const todayLabel = useMemo(() => {
    return selectedDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, [selectedDate]);

  const headerTitle = useMemo(() => {
    const now = new Date();
    if (isSameDate(selectedDate, now)) {
      return "Today";
    }

    return selectedDate.toLocaleDateString("en-US", { weekday: "long" });
  }, [selectedDate]);

  const loadTodayItems = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const listItems = await fetchTasksItems();
      const dueTodayItems = listItems.filter((item) => isDueToday(item.DeadlineDate, selectedDate));
      setItems(dueTodayItems);
      setEditingItemId(null);
      setLastUpdated(new Date());
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    void loadTodayItems();
  }, [loadTodayItems]);

  function startEdit(item: TaskItem): void {
    setEditingItemId(item.Id);
    setEditForm(toEditForm(item));
    setErrorMessage(null);
  }

  function cancelEdit(): void {
    setEditingItemId(null);
    setEditForm(EMPTY_EDIT_FORM);
  }

  async function handleSaveEdit(itemId: number): Promise<void> {
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const title = editForm.title.trim();
      if (!title) {
        throw new Error("Title is required.");
      }

      const payload: TaskPayload = {
        Period: editForm.period.trim() ? Number(editForm.period.trim()) : null,
        Title: title,
        DeadlineDate: editForm.deadlineDate || null,
        PersonEmail: editForm.personEmail.trim() || null,
        Status: normalizeStatusValue(editForm.status) || null,
        Comment: editForm.comment.trim() || null,
      };

      const personEmail = editForm.personEmail.trim();
      if (personEmail) {
        payload.PersonId = await resolvePersonIdByEmail(personEmail);
      } else {
        payload.PersonId = null;
      }

      await updateTaskItem(itemId, payload);
      setEditingItemId(null);
      await loadTodayItems();
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleCompleted(item: TaskItem): Promise<void> {
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const status = normalizeStatusValue(item.Status).toLowerCase();
      const nextStatus = status === "completed" ? null : "Completed";
      await updateTaskItem(item.Id, { Status: nextStatus });
      await loadTodayItems();
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(itemId: number): Promise<void> {
    const confirmed = window.confirm(`Delete task ${itemId}?`);
    if (!confirmed) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      await deleteTaskItem(itemId);
      if (editingItemId === itemId) {
        setEditingItemId(null);
      }
      await loadTodayItems();
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="h-full p-8 text-slate-800">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{headerTitle}</h1>
          <p className="mt-1 text-sm text-slate-500">Tasks due on {todayLabel}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedDate((prev) => addDays(prev, -1))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            aria-label="Previous day"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setSelectedDate((prev) => addDays(prev, 1))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            aria-label="Next day"
          >
            →
          </button>
          <button
            type="button"
            onClick={() => void loadTodayItems()}
            className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isLoading}
          >
            {isLoading ? "Loading..." : "Refresh"}
          </button>
        </div>
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
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isEditing = editingItemId === item.Id;
                const isCompleted = (item.Status ?? "").trim().toLowerCase() === "completed";

                if (isEditing) {
                  return (
                    <tr key={item.Id} className="border-t border-slate-200">
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          value={editForm.period}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, period: event.target.value }))}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={editForm.title}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, title: event.target.value }))}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="date"
                          value={editForm.deadlineDate}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, deadlineDate: event.target.value }))}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </td>
                      <td className="px-4 py-3">{getAssignee(item)}</td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={editForm.personEmail}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, personEmail: event.target.value }))}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={editForm.status}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, status: event.target.value }))}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        >
                          <option value="">None</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Completed">Completed</option>
                          <option value="Missed">Missed</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={editForm.comment}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, comment: event.target.value }))}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleSaveEdit(item.Id)}
                            disabled={isSaving}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                            title="Save"
                          >
                            <CheckIcon />
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100"
                            title="Cancel"
                          >
                            <XIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={item.Id} className="border-t border-slate-200">
                    <td className="px-4 py-3">{item.Period ?? ""}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{item.Title ?? "Untitled task"}</td>
                    <td className="px-4 py-3">{formatDeadlineDate(item.DeadlineDate)}</td>
                    <td className="px-4 py-3">{getAssignee(item)}</td>
                    <td className="px-4 py-3">{item.PersonEmail ?? item.Person?.EMail ?? item.Person?.Email ?? ""}</td>
                    <td className="px-4 py-3">{item.Status ?? ""}</td>
                    <td className="px-4 py-3">{item.Comment ?? ""}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleToggleCompleted(item)}
                          disabled={isSaving}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition disabled:cursor-not-allowed disabled:opacity-60 ${
                            isCompleted
                              ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          }`}
                          title={isCompleted ? "Reset status" : "Mark completed"}
                        >
                          {isCompleted ? <RefreshIcon /> : <CheckIcon />}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-700 transition hover:bg-blue-100"
                          title="Edit"
                        >
                          <PencilIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(item.Id)}
                          disabled={isSaving}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                          title="Delete"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {lastUpdated ? <p className="mt-4 text-xs text-slate-400">Last updated: {lastUpdated.toLocaleTimeString()}</p> : null}
    </section>
  );
}
