import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createTaskItem,
  createTaskTemplateItem,
  deleteTaskTemplateItem,
  extractErrorMessage,
  fetchFieldChoices,
  fetchTaskTemplateItems,
  normalizeMultiChoiceValue,
  resolvePersonIdByEmail,
  type TaskPayload,
  type TaskTemplateItem,
  type TaskTemplatePayload,
  updateTaskTemplateItem,
} from "../lib/sharepointApi";
import { CalendarIcon, PencilIcon, SaveIcon, TrashIcon, XIcon } from "./ui/icons";

type DeadlineMode = "daily" | "weekly" | "monthly" | "wd" | "other";

const TAB_ORDER: DeadlineMode[] = ["daily", "weekly", "monthly", "wd", "other"];
const TAB_LABELS: Record<DeadlineMode, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  wd: "WD",
  other: "Other",
};

interface TaskFormState {
  title: string;
  isActive: boolean;
  deadlineType: string;
  daysOfWeek: string[];
  dayOfMonth: string;
  wd: string;
  personEmail: string;
}

const EMPTY_FORM: TaskFormState = {
  title: "",
  isActive: true,
  deadlineType: "",
  daysOfWeek: [],
  dayOfMonth: "",
  wd: "",
  personEmail: "",
};

interface PeriodOption {
  value: string;
  label: string;
  year: number;
  monthIndex: number;
}

function normalizeDeadlineMode(value: string): DeadlineMode | "" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "daily") return "daily";
  if (normalized === "weekly") return "weekly";
  if (normalized === "monthly") return "monthly";
  if (normalized === "wd") return "wd";
  if (normalized === "other") return "other";
  return "";
}

function parseDayOfMonth(dayOfMonth: string): number | null {
  const trimmed = dayOfMonth.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) {
    throw new Error("DayOfMonth must be a whole number from 1 to 31.");
  }
  return parsed;
}

function parseWorkingDayOffset(wd: string): number {
  const trimmed = wd.trim();
  if (!trimmed) {
    throw new Error("WD is required when DeadlineType is WD.");
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < -10 || parsed > 10 || parsed === 0) {
    throw new Error("WD must be a whole number from -10 to 10 and cannot be 0.");
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
    wd: item.WD ? String(item.WD) : "",
    personEmail: item.PersonEmail ?? item.Person?.EMail ?? item.Person?.Email ?? "",
  };
}

function formatPeriodValue(year: number, monthIndex: number): string {
  return `${year}${String(monthIndex + 1).padStart(2, "0")}`;
}

function buildPeriodOptions(): PeriodOption[] {
  const now = new Date();
  const currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return [
    {
      value: formatPeriodValue(currentMonthDate.getFullYear(), currentMonthDate.getMonth()),
      label: `${currentMonthDate.toLocaleString("en-US", { month: "long" })} ${currentMonthDate.getFullYear()}`,
      year: currentMonthDate.getFullYear(),
      monthIndex: currentMonthDate.getMonth(),
    },
    {
      value: formatPeriodValue(nextMonthDate.getFullYear(), nextMonthDate.getMonth()),
      label: `${nextMonthDate.toLocaleString("en-US", { month: "long" })} ${nextMonthDate.getFullYear()}`,
      year: nextMonthDate.getFullYear(),
      monthIndex: nextMonthDate.getMonth(),
    },
  ];
}

function dateToDateOnlyString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatShortDate(value: string): string {
  const parsed = parseDateInput(value);
  if (!parsed) return value;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function resolveWeekdayIndex(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  const map: Record<string, number> = {
    sunday: 0,
    sun: 0,
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    tues: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    thur: 4,
    thurs: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6,
  };
  return map[normalized] ?? null;
}

function buildDatesForMonth(year: number, monthIndex: number, predicate: (date: Date) => boolean): Date[] {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const result: Date[] = [];
  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, monthIndex, day);
    if (predicate(date)) result.push(date);
  }
  return result;
}

function buildWorkingDaysForMonth(year: number, monthIndex: number): Date[] {
  return buildDatesForMonth(year, monthIndex, (date) => {
    const day = date.getDay();
    return day >= 1 && day <= 5;
  });
}

function isWorkingDay(date: Date): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function resolveWorkingDayDate(year: number, monthIndex: number, wd: number): Date | null {
  if (wd > 0) {
    const workingDays = buildWorkingDaysForMonth(year, monthIndex);
    const index = wd - 1;
    if (index < 0 || index >= workingDays.length) return null;
    return workingDays[index];
  }

  const targetCount = Math.abs(wd);
  let counted = 0;
  let cursor = new Date(year, monthIndex, 1);
  while (counted < targetCount) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
    if (isWorkingDay(cursor)) counted += 1;
  }
  return cursor;
}

function dedupeDateStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function dedupeDates(dates: Date[]): Date[] {
  const seen = new Set<string>();
  const unique: Date[] = [];
  for (const date of dates) {
    const key = dateToDateOnlyString(date);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(date);
    }
  }
  return unique;
}

function buildTaskDatesForTemplate(template: TaskTemplateItem, period: PeriodOption, selectedOtherDate: Date | null): Date[] {
  const mode = normalizeDeadlineMode(template.DeadlineType ?? "");

  if (mode === "daily") {
    return buildWorkingDaysForMonth(period.year, period.monthIndex);
  }

  if (mode === "weekly") {
    const selectedDays = new Set(
      normalizeMultiChoiceValue(template.DaysOfWeek)
        .map(resolveWeekdayIndex)
        .filter((value): value is number => value !== null),
    );
    if (selectedDays.size === 0) return [];
    return buildDatesForMonth(period.year, period.monthIndex, (date) => selectedDays.has(date.getDay()));
  }

  if (mode === "monthly") {
    const rawDay = Number(template.DayOfMonth);
    if (!Number.isInteger(rawDay) || rawDay < 1) return [];
    const lastDay = new Date(period.year, period.monthIndex + 1, 0).getDate();
    return [new Date(period.year, period.monthIndex, Math.min(rawDay, lastDay))];
  }

  if (mode === "wd") {
    const wd = Number(template.WD);
    if (!Number.isInteger(wd) || wd < -10 || wd > 10 || wd === 0) return [];
    const resolved = resolveWorkingDayDate(period.year, period.monthIndex, wd);
    return resolved ? [resolved] : [];
  }

  if (mode === "other") {
    return selectedOtherDate ? [selectedOtherDate] : [];
  }

  return [];
}

async function buildPayload(form: TaskFormState): Promise<TaskTemplatePayload> {
  const title = form.title.trim();
  const deadlineType = form.deadlineType.trim();
  const mode = normalizeDeadlineMode(deadlineType);
  const personEmail = form.personEmail.trim();

  if (!title) throw new Error("Title is required.");
  if (!deadlineType) throw new Error("DeadlineType is required.");

  const payload: TaskTemplatePayload = {
    Title: title,
    IsActive: form.isActive,
    DeadlineType: deadlineType,
    PersonEmail: personEmail || null,
  };

  if (mode === "weekly") {
    payload.DaysOfWeek = form.daysOfWeek;
    payload.DayOfMonth = null;
    payload.WD = null;
  } else if (mode === "monthly") {
    payload.DayOfMonth = parseDayOfMonth(form.dayOfMonth);
    payload.DaysOfWeek = [];
    payload.WD = null;
  } else if (mode === "wd") {
    payload.WD = parseWorkingDayOffset(form.wd);
    payload.DaysOfWeek = [];
    payload.DayOfMonth = null;
  } else {
    payload.DaysOfWeek = [];
    payload.DayOfMonth = null;
    payload.WD = null;
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

function MonthCalendar({
  year,
  monthIndex,
  selectedDateStrings,
  onToggleDate,
  allowMonthChange,
}: {
  year: number;
  monthIndex: number;
  selectedDateStrings: string[];
  onToggleDate: (value: string) => void;
  allowMonthChange: boolean;
}) {
  const [navigatedMonth, setNavigatedMonth] = useState(() => {
    const selected = parseDateInput(selectedDateStrings[0] ?? "");
    if (selected) {
      return new Date(selected.getFullYear(), selected.getMonth(), 1);
    }
    return new Date(year, monthIndex, 1);
  });

  const displayedMonth = allowMonthChange ? navigatedMonth : new Date(year, monthIndex, 1);
  const selectedSet = useMemo(() => {
    const normalized = new Set<string>();
    for (const value of selectedDateStrings) {
      const parsed = parseDateInput(value);
      if (!parsed) continue;
      normalized.add(dateToDateOnlyString(parsed));
    }
    return normalized;
  }, [selectedDateStrings]);

  const displayedYear = displayedMonth.getFullYear();
  const displayedMonthIndex = displayedMonth.getMonth();
  const firstDay = new Date(displayedYear, displayedMonthIndex, 1);
  const daysInMonth = new Date(displayedYear, displayedMonthIndex + 1, 0).getDate();
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const cells: Array<{ key: string; date: Date | null }> = [];

  for (let i = 0; i < mondayOffset; i += 1) {
    cells.push({ key: `blank-start-${i}`, date: null });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ key: `day-${displayedYear}-${displayedMonthIndex}-${day}`, date: new Date(displayedYear, displayedMonthIndex, day) });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `blank-end-${cells.length}`, date: null });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() =>
            setNavigatedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
          }
          disabled={!allowMonthChange}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          title="Previous month"
        >
          {"<"}
        </button>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {displayedMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </p>
        <button
          type="button"
          onClick={() =>
            setNavigatedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
          }
          disabled={!allowMonthChange}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          title="Next month"
        >
          {">"}
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-slate-400">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          if (!cell.date) return <div key={cell.key} className="h-8 rounded-md bg-slate-50" />;

          const dateValue = dateToDateOnlyString(cell.date);
          const isSelected = selectedSet.has(dateValue);

          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => onToggleDate(dateValue)}
              className={`h-8 rounded-md text-xs font-medium transition ${
                isSelected ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-strong)]" : "bg-slate-50 text-slate-700 hover:bg-slate-100"
              }`}
              title={dateValue}
            >
              {cell.date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Template() {
  const periodOptions = useMemo(() => buildPeriodOptions(), []);
  const [items, setItems] = useState<TaskTemplateItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [deadlineTypeChoices, setDeadlineTypeChoices] = useState<string[]>([]);
  const [daysOfWeekChoices, setDaysOfWeekChoices] = useState<string[]>([]);
  const [createForm, setCreateForm] = useState<TaskFormState>(EMPTY_FORM);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<TaskFormState>(EMPTY_FORM);

  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [generatePeriod, setGeneratePeriod] = useState<string>(periodOptions[0]?.value ?? "");
  const [activeGenerateTab, setActiveGenerateTab] = useState<DeadlineMode>("daily");
  const [expandedCalendarTemplateId, setExpandedCalendarTemplateId] = useState<number | null>(null);
  const [generateDateMap, setGenerateDateMap] = useState<Record<number, string[]>>({});

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
      setDeadlineTypeChoices(deadlineTypes.length ? deadlineTypes : ["Daily", "Weekly", "Monthly", "WD", "Other"]);
      setDaysOfWeekChoices(days.length ? days : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
    } catch {
      setDeadlineTypeChoices(["Daily", "Weekly", "Monthly", "WD", "Other"]);
      setDaysOfWeekChoices(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
    }
  }, []);

  useEffect(() => {
    void loadTemplateItems();
    void loadChoices();
  }, [loadChoices, loadTemplateItems]);

  const activeTemplates = useMemo(() => items.filter((item) => item.IsActive !== false), [items]);

  const templatesByMode = useMemo(() => {
    const grouped: Record<DeadlineMode, TaskTemplateItem[]> = { daily: [], weekly: [], monthly: [], wd: [], other: [] };
    for (const template of activeTemplates) {
      const mode = normalizeDeadlineMode(template.DeadlineType ?? "");
      if (mode) grouped[mode].push(template);
    }
    return grouped;
  }, [activeTemplates]);

  const availableTabs = useMemo(() => TAB_ORDER.filter((mode) => templatesByMode[mode].length > 0), [templatesByMode]);

  useEffect(() => {
    if (!isGenerateModalOpen || availableTabs.length === 0) return;
    if (!availableTabs.includes(activeGenerateTab)) {
      setActiveGenerateTab(availableTabs[0]);
    }
  }, [activeGenerateTab, availableTabs, isGenerateModalOpen]);

  const selectedPeriodOption = useMemo(
    () => periodOptions.find((option) => option.value === generatePeriod) ?? periodOptions[0],
    [generatePeriod, periodOptions],
  );

  const initializeGenerateSelections = useCallback(
    (periodValue: string) => {
      const selectedPeriod = periodOptions.find((option) => option.value === periodValue);
      if (!selectedPeriod) return;

      const defaultOtherDate = new Date(selectedPeriod.year, selectedPeriod.monthIndex, 1);
      const nextMap: Record<number, string[]> = {};
      for (const template of activeTemplates) {
        const defaultDates = dedupeDates(buildTaskDatesForTemplate(template, selectedPeriod, defaultOtherDate)).map(dateToDateOnlyString);
        nextMap[template.Id] = dedupeDateStrings(defaultDates);
      }
      setGenerateDateMap(nextMap);
      setExpandedCalendarTemplateId(null);
    },
    [activeTemplates, periodOptions],
  );

  function openGenerateModal(): void {
    setIsGenerateModalOpen(true);
    setErrorMessage(null);
    setStatusMessage(null);
    initializeGenerateSelections(generatePeriod);
    if (availableTabs.length > 0) {
      setActiveGenerateTab(availableTabs[0]);
    }
  }

  function closeGenerateModal(): void {
    setIsGenerateModalOpen(false);
    setExpandedCalendarTemplateId(null);
  }

  function handleGeneratePeriodChange(value: string): void {
    setGeneratePeriod(value);
    initializeGenerateSelections(value);
  }

  function toggleGenerateDate(template: TaskTemplateItem, dateValue: string): void {
    const mode = normalizeDeadlineMode(template.DeadlineType ?? "");

    setGenerateDateMap((prev) => {
      const current = prev[template.Id] ?? [];
      const exists = current.includes(dateValue);
      let next: string[];

      if (mode === "other" || mode === "monthly" || mode === "wd") {
        next = exists ? [] : [dateValue];
      } else {
        next = exists ? current.filter((value) => value !== dateValue) : [...current, dateValue];
      }

      return { ...prev, [template.Id]: dedupeDateStrings(next) };
    });
  }

  function setSingleDate(templateId: number, dateValue: string): void {
    setGenerateDateMap((prev) => ({ ...prev, [templateId]: dateValue ? [dateValue] : [] }));
  }

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
      setCreateForm((prev) => ({ ...EMPTY_FORM, deadlineType: prev.deadlineType }));
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
    setErrorMessage(null);
    setStatusMessage(null);
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
    if (!confirmed) return;

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

  async function handleGenerateTasks(): Promise<void> {
    setIsGenerating(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      if (activeTemplates.length === 0) {
        throw new Error("No active template tasks found.");
      }

      const selectedPeriod = periodOptions.find((option) => option.value === generatePeriod);
      if (!selectedPeriod) {
        throw new Error("Please choose a valid period.");
      }

      const tasksToCreate: Array<{ template: TaskTemplateItem; deadlineDate: string }> = [];
      for (const template of activeTemplates) {
        const selectedDates = dedupeDateStrings(generateDateMap[template.Id] ?? []);
        for (const dateValue of selectedDates) {
          const parsed = parseDateInput(dateValue);
          if (parsed) {
            tasksToCreate.push({ template, deadlineDate: dateToDateOnlyString(parsed) });
          }
        }
      }

      if (tasksToCreate.length === 0) {
        throw new Error("No tasks were selected for generation.");
      }

      let createdCount = 0;
      let failedCount = 0;
      const errors: string[] = [];

      for (const task of tasksToCreate) {
        const personEmail = (task.template.PersonEmail ?? task.template.Person?.EMail ?? task.template.Person?.Email ?? "").trim();
        const payload: TaskPayload = {
          Period: Number(selectedPeriod.value),
          Title: (task.template.Title ?? "").trim() || "Untitled task",
          DeadlineDate: task.deadlineDate,
          PersonEmail: personEmail || null,
        };

        if (personEmail) {
          try {
            const personId = await resolvePersonIdByEmail(personEmail);
            if (personId !== null) {
              payload.PersonId = personId;
            }
          } catch {
            if (errors.length < 6) {
              errors.push(`Could not resolve user for "${personEmail}" (${task.template.Title ?? "Untitled"}).`);
            }
          }
        }

        try {
          await createTaskItem(payload);
          createdCount += 1;
        } catch (error) {
          failedCount += 1;
          if (errors.length < 6) {
            errors.push(`Failed to create "${String(payload.Title)}" (${task.deadlineDate}): ${extractErrorMessage(error)}`);
          }
        }
      }

      closeGenerateModal();
      setStatusMessage(`Generated ${createdCount} task(s) for period ${selectedPeriod.value}.${failedCount ? ` ${failedCount} failed.` : ""}`);
      if (errors.length > 0) {
        setErrorMessage(errors.join(" "));
      }
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    } finally {
      setIsGenerating(false);
    }
  }

  const createMode = normalizeDeadlineMode(createForm.deadlineType);
  const editMode = normalizeDeadlineMode(editForm.deadlineType);
  const activeTabTemplates = templatesByMode[activeGenerateTab] ?? [];

  return (
    <section className="h-full p-8 text-slate-800">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Template</h1>
          <p className="mt-1 text-sm text-slate-500">Manage all tasks from the TaskTemplate list.</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openGenerateModal}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isLoading || isSaving || isGenerating}
          >
            Generate
          </button>
          <button
            type="button"
            onClick={() => void loadTemplateItems()}
            className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isLoading || isSaving || isGenerating}
          >
            {isLoading ? "Loading..." : "Refresh"}
          </button>
        </div>
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
            onChange={(event) => {
              const mode = normalizeDeadlineMode(event.target.value);
              setCreateForm((prev) => ({
                ...prev,
                deadlineType: event.target.value,
                daysOfWeek: mode === "weekly" ? prev.daysOfWeek : [],
                dayOfMonth: mode === "monthly" ? prev.dayOfMonth : "",
                wd: mode === "wd" ? prev.wd : "",
              }));
            }}
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

        <div className="mt-3 grid gap-3 md:grid-cols-3">
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
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">WD (-10..10, no 0)</p>
            <input
              type="number"
              min={-10}
              max={10}
              step={1}
              value={createForm.wd}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, wd: event.target.value }))}
              disabled={createMode !== "wd"}
              placeholder="-1, 1, 2..."
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
                <th className="px-4 py-3">WD</th>
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
                          onChange={(event) => {
                            const mode = normalizeDeadlineMode(event.target.value);
                            setEditForm((prev) => ({
                              ...prev,
                              deadlineType: event.target.value,
                              daysOfWeek: mode === "weekly" ? prev.daysOfWeek : [],
                              dayOfMonth: mode === "monthly" ? prev.dayOfMonth : "",
                              wd: mode === "wd" ? prev.wd : "",
                            }));
                          }}
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
                          type="number"
                          min={-10}
                          max={10}
                          step={1}
                          value={editForm.wd}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, wd: event.target.value }))}
                          disabled={editMode !== "wd"}
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
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                            title="Save"
                          >
                            <SaveIcon />
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
                    <td className="px-4 py-3">{item.WD ?? ""}</td>
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

      {isGenerateModalOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/45 p-4">
          <div className="w-full max-w-6xl rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Generate Tasks</h2>
                <p className="mt-1 text-sm text-slate-500">Select period, review templates by deadline type, and adjust assignment dates.</p>
              </div>
              <button
                type="button"
                onClick={closeGenerateModal}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100"
                title="Close"
              >
                <XIcon />
              </button>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
              <aside className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <label htmlFor="generate-period" className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Period
                </label>
                <select
                  id="generate-period"
                  value={generatePeriod}
                  onChange={(event) => handleGeneratePeriodChange(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  {periodOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} ({option.value})
                    </option>
                  ))}
                </select>

                <div className="mt-4 flex flex-col gap-1">
                  {TAB_ORDER.map((mode) => {
                    const count = templatesByMode[mode].length;
                    if (count === 0) return null;

                    const isActive = activeGenerateTab === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setActiveGenerateTab(mode)}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                          isActive ? "bg-[var(--accent)] text-white" : "bg-white text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        <span>{TAB_LABELS[mode]}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${isActive ? "bg-blue-900/35 text-blue-50" : "bg-slate-100 text-slate-600"}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-slate-500">Use the calendar icon on each task to open date selection and toggle specific days.</p>
              </aside>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                {selectedPeriodOption && activeTabTemplates.length > 0 ? (
                  <ul className="max-h-[55vh] space-y-3 overflow-auto pr-1">
                    {activeTabTemplates.map((template) => {
                      const selectedDates = generateDateMap[template.Id] ?? [];
                      const summary = selectedDates.length ? selectedDates.slice(0, 5).map(formatShortDate).join(", ") : "No selected days";
                      const isCalendarOpen = expandedCalendarTemplateId === template.Id;
                      const mode = normalizeDeadlineMode(template.DeadlineType ?? "");

                      return (
                        <li key={template.Id} className="rounded-xl border border-slate-200 bg-slate-50/40 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-900">{template.Title ?? "Untitled template"}</p>
                              <p className="mt-0.5 text-xs uppercase tracking-wide text-slate-500">{TAB_LABELS[activeGenerateTab]}</p>
                              <p className="mt-1 text-sm text-slate-600">{summary}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {mode === "other" ? (
                                <input
                                  type="date"
                                  value={selectedDates[0] ?? ""}
                                  onChange={(event) => setSingleDate(template.Id, event.target.value)}
                                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                                />
                              ) : null}
                              <button
                                type="button"
                                onClick={() => setExpandedCalendarTemplateId((prev) => (prev === template.Id ? null : template.Id))}
                                className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition ${
                                  isCalendarOpen
                                    ? "border-blue-300 bg-blue-100 text-blue-800"
                                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                                }`}
                                title="Toggle calendar"
                              >
                                <CalendarIcon />
                              </button>
                            </div>
                          </div>

                          {isCalendarOpen ? (
                            <div className="mt-3">
                              <MonthCalendar
                                year={selectedPeriodOption.year}
                                monthIndex={selectedPeriodOption.monthIndex}
                                selectedDateStrings={selectedDates}
                                onToggleDate={(value) => toggleGenerateDate(template, value)}
                                allowMonthChange={mode === "wd"}
                              />
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="grid min-h-[220px] place-items-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                    No active templates in this deadline type.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeGenerateModal}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                disabled={isGenerating}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleGenerateTasks()}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isGenerating}
              >
                {isGenerating ? "Generating..." : "Generate"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
