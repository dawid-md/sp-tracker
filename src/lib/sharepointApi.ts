const DEFAULT_SITE_URL = "https://xmdco.sharepoint.com/sites/Governance";
const DEFAULT_TEMPLATE_LIST_TITLE = "TaskTemplate";
const DEFAULT_TASKS_LIST_TITLE = "Tasks";

const SITE_URL = import.meta.env.VITE_SHAREPOINT_SITE_URL ?? DEFAULT_SITE_URL;
const TEMPLATE_LIST_TITLE =
  import.meta.env.VITE_SHAREPOINT_TEMPLATE_LIST_TITLE ?? import.meta.env.VITE_SHAREPOINT_LIST_TITLE ?? DEFAULT_TEMPLATE_LIST_TITLE;
const TASKS_LIST_TITLE = import.meta.env.VITE_SHAREPOINT_TASKS_LIST_TITLE ?? DEFAULT_TASKS_LIST_TITLE;

let requestDigestValue: string | null = null;
let requestDigestExpiresAt = 0;
const personIdCache = new Map<string, number>();

export interface SharePointPerson {
  Title?: string;
  EMail?: string;
  Email?: string;
}

type MultiChoiceValue = string[] | { results?: string[] } | string | null | undefined;

export interface TaskTemplateItem {
  Id: number;
  Title?: string;
  IsActive?: boolean;
  DeadlineType?: string;
  DaysOfWeek?: MultiChoiceValue;
  PersonEmail?: string;
  DayOfMonth?: number | null;
  Person?: SharePointPerson;
}

export interface TaskItem {
  Id: number;
  Period?: string | number;
  Title?: string;
  DeadlineDate?: string;
  PersonEmail?: string;
  Status?: string;
  Comment?: string;
  Person?: SharePointPerson;
}

export type TaskTemplatePayload = Record<string, unknown>;

function buildListApiUrl(listTitle: string, pathSuffix: string): string {
  return `${SITE_URL}/_api/web/lists/getByTitle('${encodeURIComponent(listTitle)}')${pathSuffix}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

async function ensureOkResponse(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }

  const body = await response.text();
  throw new Error(`HTTP ${response.status} ${response.statusText}: ${body}`);
}

export function normalizeMultiChoiceValue(value: MultiChoiceValue): string[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    return value ? [value] : [];
  }

  if (value && Array.isArray(value.results)) {
    return value.results;
  }

  return [];
}

export async function fetchTaskTemplateItems(): Promise<TaskTemplateItem[]> {
  const endpoint =
    `${buildListApiUrl(TEMPLATE_LIST_TITLE, "/items")}` +
    "?$select=Id,Title,IsActive,DeadlineType,DaysOfWeek,PersonEmail,DayOfMonth,Person/Title,Person/EMail" +
    "&$expand=Person&$orderby=Id asc&$top=100";

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json;odata=nometadata",
    },
    credentials: "include",
  });

  await ensureOkResponse(response);

  const data = (await response.json()) as { value?: TaskTemplateItem[] };
  return Array.isArray(data.value) ? data.value : [];
}

export async function fetchTasksItems(): Promise<TaskItem[]> {
  const endpoint =
    `${buildListApiUrl(TASKS_LIST_TITLE, "/items")}` +
    "?$select=Id,Period,Title,DeadlineDate,PersonEmail,Status,Comment,Person/Title,Person/EMail" +
    "&$expand=Person&$orderby=DeadlineDate asc,Id asc&$top=300";

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json;odata=nometadata",
    },
    credentials: "include",
  });

  await ensureOkResponse(response);

  const data = (await response.json()) as { value?: TaskItem[] };
  return Array.isArray(data.value) ? data.value : [];
}

export async function fetchFieldChoices(internalName: string): Promise<string[]> {
  const endpoint =
    `${buildListApiUrl(TEMPLATE_LIST_TITLE, "/fields")}` +
    `/getByInternalNameOrTitle('${encodeURIComponent(internalName)}')?$select=Choices`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json;odata=nometadata",
    },
    credentials: "include",
  });

  await ensureOkResponse(response);

  const data = (await response.json()) as { Choices?: string[] | { results?: string[] } };
  if (Array.isArray(data.Choices)) {
    return data.Choices;
  }

  if (data.Choices && Array.isArray(data.Choices.results)) {
    return data.Choices.results;
  }

  return [];
}

async function getRequestDigest(): Promise<string> {
  const now = Date.now();
  if (requestDigestValue && now < requestDigestExpiresAt) {
    return requestDigestValue;
  }

  const response = await fetch(`${SITE_URL}/_api/contextinfo`, {
    method: "POST",
    headers: {
      Accept: "application/json;odata=verbose",
    },
    credentials: "include",
  });

  await ensureOkResponse(response);

  const data = (await response.json()) as {
    d?: {
      GetContextWebInformation?: {
        FormDigestValue?: string;
        FormDigestTimeoutSeconds?: number | string;
      };
    };
  };

  const info = data.d?.GetContextWebInformation;
  requestDigestValue = info?.FormDigestValue ?? null;
  const timeoutSeconds = Number(info?.FormDigestTimeoutSeconds ?? 1200);
  requestDigestExpiresAt = now + Math.max(timeoutSeconds - 30, 60) * 1000;

  if (!requestDigestValue) {
    throw new Error("SharePoint request digest is missing in contextinfo response.");
  }

  return requestDigestValue;
}

export async function resolvePersonIdByEmail(email: string): Promise<number | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  if (personIdCache.has(normalizedEmail)) {
    return personIdCache.get(normalizedEmail) ?? null;
  }

  const digest = await getRequestDigest();
  const endpoint = `${SITE_URL}/_api/web/ensureuser`;
  const logonCandidates = [`i:0#.f|membership|${normalizedEmail}`, normalizedEmail];

  let lastErrorMessage = "";
  for (const logonName of logonCandidates) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json;odata=nometadata",
        "Content-Type": "application/json;odata=nometadata",
        "X-RequestDigest": digest,
      },
      credentials: "include",
      body: JSON.stringify({ logonName }),
    });

    if (!response.ok) {
      lastErrorMessage = await response.text();
      continue;
    }

    const data = (await response.json()) as { Id?: number; d?: { Id?: number } };
    const personId = Number(data.Id ?? data.d?.Id);

    if (!Number.isFinite(personId)) {
      throw new Error(`SharePoint returned an invalid user ID for "${normalizedEmail}".`);
    }

    personIdCache.set(normalizedEmail, personId);
    return personId;
  }

  throw new Error(`Could not resolve SharePoint user for "${normalizedEmail}". ${lastErrorMessage}`.trim());
}

export async function createTaskTemplateItem(payload: TaskTemplatePayload): Promise<TaskTemplateItem> {
  const digest = await getRequestDigest();
  const endpoint = buildListApiUrl(TEMPLATE_LIST_TITLE, "/items");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json;odata=nometadata",
      "Content-Type": "application/json;odata=nometadata",
      "X-RequestDigest": digest,
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  await ensureOkResponse(response);
  return (await response.json()) as TaskTemplateItem;
}

export async function updateTaskTemplateItem(itemId: number, payload: TaskTemplatePayload): Promise<void> {
  const digest = await getRequestDigest();
  const endpoint = buildListApiUrl(TEMPLATE_LIST_TITLE, `/items(${itemId})`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json;odata=nometadata",
      "Content-Type": "application/json;odata=nometadata",
      "X-RequestDigest": digest,
      "X-HTTP-Method": "MERGE",
      "IF-MATCH": "*",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  await ensureOkResponse(response);
}

export async function deleteTaskTemplateItem(itemId: number): Promise<void> {
  const digest = await getRequestDigest();
  const endpoint = buildListApiUrl(TEMPLATE_LIST_TITLE, `/items(${itemId})`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json;odata=nometadata",
      "X-RequestDigest": digest,
      "X-HTTP-Method": "DELETE",
      "IF-MATCH": "*",
    },
    credentials: "include",
  });

  await ensureOkResponse(response);
}

export function extractErrorMessage(error: unknown): string {
  return getErrorMessage(error);
}
