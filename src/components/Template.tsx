import { useCallback, useEffect, useState } from "react";
import {
  createTaskTemplateItem,
  deleteTaskTemplateItem,
  extractErrorMessage,
  fetchFieldChoices,
  fetchTaskTemplateItems,
  normalizeMultiChoiceValue,
  resolvePersonIdByEmail,
  updateTaskTemplateItem,
  type TaskTemplateItem,
  type TaskTemplatePayload,
} from "../lib/sharepointApi";

interface TaskFormState {
  title: string;
  isActive: boolean;
  deadlineType: string;
  daysOfWeek: string[];
  dayOfMonth: string;
  personEmail: string;
}

const EMPTY_FORM: TaskFormState = {
  title: "",
  isActive: true,
  deadlineType: "",
  daysOfWeek: [],
  dayOfMonth: "",
  personEmail: "",
};

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

function normalizeDeadlineMode(value: string): "weekly" | "monthly" | "" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "weekly") {
    return "weekly";
  }

  if (normalized === "monthly") {
    return "monthly";
  }

  return "";
}

function parseDayOfMonth(dayOfMonth: string): number | null {
  const trimmed = dayOfMonth.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) {
    throw new Error("DayOfMonth must be a whole number from 1 to 31.");
  }

  return parsed;
}

function formatDaysOfWeek(item: TaskTemplateItem): string {
  const days = normalizeMultiChoiceValue(item.DaysOfWeek);
  return days.length ? days.join(", ") : "";
}

function toFormState(item: TaskTemplateItem): TaskFormState {
  return {
    title: item.Title ?? "",
    isActive: item.IsActive !== false,
    deadlineType: item.DeadlineType ?? "",
    daysOfWeek: normalizeMultiChoiceValue(item.DaysOfWeek),
    dayOfMonth: item.DayOfMonth ? String(item.DayOfMonth) : "",
    personEmail: item.PersonEmail ?? item.Person?.EMail ?? item.Person?.Email ?? "",
  };
}

async function buildPayload(form: TaskFormState): Promise<TaskTemplatePayload> {
  const title = form.title.trim();
  const deadlineType = form.deadlineType.trim();
  const mode = normalizeDeadlineMode(deadlineType);
  const personEmail = form.personEmail.trim();

  if (!title) {
    throw new Error("Title is required.");
  }

  if (!deadlineType) {
    throw new Error("DeadlineType is required.");
  }

  const payload: TaskTemplatePayload = {
    Title: title,
    IsActive: form.isActive,
    DeadlineType: deadlineType,
    PersonEmail: personEmail || null,
  };

  if (mode === "weekly") {
    payload.DaysOfWeek = form.daysOfWeek;
    payload.DayOfMonth = null;
  } else if (mode === "monthly") {
    const parsedDayOfMonth = parseDayOfMonth(form.dayOfMonth);
    if (parsedDayOfMonth !== null) {
      payload.DayOfMonth = parsedDayOfMonth;
    } else {
      payload.DayOfMonth = null;
    }
    payload.DaysOfWeek = [];
  } else {
    payload.DaysOfWeek = [];
    payload.DayOfMonth = null;
  }

  if (personEmail) {
    payload.PersonId = await resolvePersonIdByEmail(personEmail);
  } else {
    payload.PersonId = null;
  }

  return payload;
}

function FormCheckboxes({
  choices,
  values,
  onToggle,
  disabled,
}: {
  choices: string[];
  values: string[];
  onToggle: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className={`flex flex-wrap gap-2 rounded-lg border border-slate-200 p-2 ${disabled ? "bg-slate-50" : "bg-white"}`}>
      {choices.map((choice) => (
        <label key={choice} className="inline-flex items-center gap-1 text-xs text-slate-700">
          <input type="checkbox" checked={values.includes(choice)} onChange={() => onToggle(choice)} disabled={disabled} />
          <span>{choice}</span>
        </label>
      ))}
    </div>
  );
}

export default function Template() {
  const [items, setItems] = useState<TaskTemplateItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [deadlineTypeChoices, setDeadlineTypeChoices] = useState<string[]>([]);
  const [daysOfWeekChoices, setDaysOfWeekChoices] = useState<string[]>([]);
  const [createForm, setCreateForm] = useState<TaskFormState>(EMPTY_FORM);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<TaskFormState>(EMPTY_FORM);

  const loadTemplateItems = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const listItems = await fetchTaskTemplateItems();
      setItems(listItems);
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadChoices = useCallback(async () => {
    try {
      const [deadlineTypes, days] = await Promise.all([fetchFieldChoices("DeadlineType"), fetchFieldChoices("DaysOfWeek")]);
      setDeadlineTypeChoices(deadlineTypes.length ? deadlineTypes : ["Weekly", "Monthly"]);
      setDaysOfWeekChoices(days.length ? days : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
    } catch {
      setDeadlineTypeChoices(["Weekly", "Monthly"]);
      setDaysOfWeekChoices(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
    }
  }, []);

  useEffect(() => {
    void loadTemplateItems();
    void loadChoices();
  }, [loadChoices, loadTemplateItems]);

  function toggleCreateDay(day: string): void {
    setCreateForm((prev) => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(day) ? prev.daysOfWeek.filter((x) => x !== day) : [...prev.daysOfWeek, day],
    }));
  }

  function toggleEditDay(day: string): void {
    setEditForm((prev) => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(day) ? prev.daysOfWeek.filter((x) => x !== day) : [...prev.daysOfWeek, day],
    }));
  }

  async function handleCreate(): Promise<void> {
    setIsSaving(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const payload = await buildPayload(createForm);
      await createTaskTemplateItem(payload);
      setStatusMessage("Template task created.");
      setCreateForm((prev) => ({
        ...EMPTY_FORM,
        deadlineType: prev.deadlineType,
      }));
      await loadTemplateItems();
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  function startEdit(item: TaskTemplateItem): void {
    setEditingItemId(item.Id);
    setEditForm(toFormState(item));
    setStatusMessage(null);
    setErrorMessage(null);
  }

  function cancelEdit(): void {
    setEditingItemId(null);
    setEditForm(EMPTY_FORM);
  }

  async function handleSaveEdit(itemId: number): Promise<void> {
    setIsSaving(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const payload = await buildPayload(editForm);
      await updateTaskTemplateItem(itemId, payload);
      setEditingItemId(null);
      setStatusMessage(`Item ${itemId} updated.`);
      await loadTemplateItems();
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(itemId: number): Promise<void> {
    const confirmed = window.confirm(`Delete template item ${itemId}?`);
    if (!confirmed) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      await deleteTaskTemplateItem(itemId);
      if (editingItemId === itemId) {
        setEditingItemId(null);
      }
      setStatusMessage(`Item ${itemId} deleted.`);
      await loadTemplateItems();
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  const createMode = normalizeDeadlineMode(createForm.deadlineType);
  const editMode = normalizeDeadlineMode(editForm.deadlineType);

  return (
    <section className="h-full p-8 text-slate-800">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Template</h1>
          <p className="mt-1 text-sm text-slate-500">Manage all tasks from the TaskTemplate list.</p>
        </div>

        <button
          type="button"
          onClick={() => void loadTemplateItems()}
          className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isLoading || isSaving}
        >
          {isLoading ? "Loading..." : "Refresh"}
        </button>
      </header>

      {errorMessage ? (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{errorMessage}</div>
      ) : null}
      {statusMessage ? (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{statusMessage}</div>
      ) : null}

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-900">Add New Task Template</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input
            type="text"
            value={createForm.title}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="Title"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <select
            value={createForm.isActive ? "true" : "false"}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, isActive: event.target.value === "true" }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
          <select
            value={createForm.deadlineType}
            onChange={(event) =>
              setCreateForm((prev) => ({
                ...prev,
                deadlineType: event.target.value,
                daysOfWeek: normalizeDeadlineMode(event.target.value) === "weekly" ? prev.daysOfWeek : [],
                dayOfMonth: normalizeDeadlineMode(event.target.value) === "monthly" ? prev.dayOfMonth : "",
              }))
            }
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Deadline Type</option>
            {deadlineTypeChoices.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={createForm.personEmail}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, personEmail: event.target.value }))}
            placeholder="Person Email"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Days of week</p>
            <FormCheckboxes choices={daysOfWeekChoices} values={createForm.daysOfWeek} onToggle={toggleCreateDay} disabled={createMode !== "weekly"} />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Day of month</p>
            <input
              type="number"
              min={1}
              max={31}
              value={createForm.dayOfMonth}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, dayOfMonth: event.target.value }))}
              disabled={createMode !== "monthly"}
              placeholder="1-31"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={isSaving}
          className="mt-4 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Add Task"}
        </button>
      </div>

      {isLoading ? <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading template tasks...</div> : null}

      {!isLoading && items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">No items found in TaskTemplate.</div>
      ) : null}

      {!isLoading && items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm text-slate-700">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Deadline Type</th>
                <th className="px-4 py-3">Days Of Week</th>
                <th className="px-4 py-3">Day Of Month</th>
                <th className="px-4 py-3">Person Email</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isEditing = editingItemId === item.Id;

                if (isEditing) {
                  return (
                    <tr key={item.Id} className="border-t border-slate-200 align-top">
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={editForm.title}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, title: event.target.value }))}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={editForm.isActive ? "true" : "false"}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, isActive: event.target.value === "true" }))}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        >
                          <option value="true">Active</option>
                          <option value="false">Inactive</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={editForm.deadlineType}
                          onChange={(event) =>
                            setEditForm((prev) => ({
                              ...prev,
                              deadlineType: event.target.value,
                              daysOfWeek: normalizeDeadlineMode(event.target.value) === "weekly" ? prev.daysOfWeek : [],
                              dayOfMonth: normalizeDeadlineMode(event.target.value) === "monthly" ? prev.dayOfMonth : "",
                            }))
                          }
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        >
                          <option value="">Deadline Type</option>
                          {deadlineTypeChoices.map((choice) => (
                            <option key={choice} value={choice}>
                              {choice}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <FormCheckboxes choices={daysOfWeekChoices} values={editForm.daysOfWeek} onToggle={toggleEditDay} disabled={editMode !== "weekly"} />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min={1}
                          max={31}
                          value={editForm.dayOfMonth}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, dayOfMonth: event.target.value }))}
                          disabled={editMode !== "monthly"}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={editForm.personEmail}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, personEmail: event.target.value }))}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleSaveEdit(item.Id)}
                            disabled={isSaving}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100"
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
                    <td className="px-4 py-3 font-medium text-slate-900">{item.Title ?? "Untitled task"}</td>
                    <td className="px-4 py-3">{item.IsActive === false ? "No" : "Yes"}</td>
                    <td className="px-4 py-3">{item.DeadlineType ?? ""}</td>
                    <td className="px-4 py-3">{formatDaysOfWeek(item)}</td>
                    <td className="px-4 py-3">{item.DayOfMonth ?? ""}</td>
                    <td className="px-4 py-3">{item.PersonEmail ?? item.Person?.EMail ?? item.Person?.Email ?? ""}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
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
    </section>
  );
}
