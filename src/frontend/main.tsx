import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Temporal } from "@js-temporal/polyfill";
import * as client from "./client";
import { assess, preview, type PlanChange } from "../core/forecast";
import { propose, promiseTitle, type Candidate } from "../core/capture";
import { customerDraft } from "../core/draft";
import { hash, type RecordState } from "../core/ledger";
import { localDay, type State, type Source } from "../core/model";
import "./style.css";

type Tab = "register" | "capture" | "impact" | "activity";
const TAB_NAMES: Record<Tab, string> = {
  register: "Promise register",
  capture: "Capture inbox",
  impact: "Change impact",
  activity: "Activity",
};
const STATE_LABELS: Record<State, string> = {
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  BROKEN: "Broken",
  KEPT: "Kept",
  UNKNOWN: "Needs evidence",
  CANCELLED: "Withdrawn",
};
const dateText = (on: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(on + "T12:00:00Z"));
const timeText = (at: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
    hour12: false,
  }).format(new Date(at));
const initials = (s: string) =>
  s
    .split(" ")
    .slice(0, 2)
    .map((x) => x[0])
    .join("");
const localInput = (at: string) => {
  const d = new Date(at);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    register: (
      <>
        <path d="M4 4h16v16H4zM4 9h16M9 9v11" />
        <path d="M12 13h5M12 16h5" />
      </>
    ),
    capture: (
      <>
        <path d="M4 4h16v13H9l-5 4zM8 8h8M8 12h5" />
      </>
    ),
    impact: (
      <>
        <path d="M4 18V6m0 12h16M7 15l4-5 4 3 5-8M16 5h4v4" />
      </>
    ),
    activity: (
      <>
        <path d="M6 16h12l-2-3V9a4 4 0 0 0-8 0v4zM10 20h4" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="8" cy="7" r="3" fill="currentColor" />
        <circle cx="16" cy="17" r="3" fill="currentColor" />
      </>
    ),
    link: (
      <>
        <path d="m10 14 4-4m-7 1-3 3a4 4 0 0 0 6 6l3-3m4-4 3-3a4 4 0 0 0-6-6l-3 3" />
      </>
    ),
    check: <path d="m5 12 4 4L20 5" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.arrow}
    </svg>
  );
}
function Status({ state }: { state: State }) {
  return (
    <span className={`status ${state.toLowerCase()}`}>
      <i />
      {STATE_LABELS[state]}
    </span>
  );
}
function Modal({
  title,
  children,
  close,
  error,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  error: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onCancel={close}
      onKeyDown={(e) => {
        if (e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey) return;
        const items = [
          ...e.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
          ),
        ].filter((item) => item.getClientRects().length > 0);
        const first = items[0],
          last = items.at(-1);
        if (!first || !last) return;
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            !e.currentTarget.contains(document.activeElement))
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            !e.currentTarget.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }}
    >
      <div className="modal-head">
        <h2 id="modal-title">{title}</h2>
        <button className="icon" aria-label="Close dialog" onClick={close}>
          <Icon name="close" />
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}
function App() {
  const [app, setApp] = useState<client.Workspace | null>(null);
  const inspectFocus = useRef(false);
  const [tab, setTab] = useState<Tab>("register");
  const [selected, setSelected] = useState("KPT-001");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<
    | "capture"
    | "deliver"
    | "amend"
    | "cancel"
    | "draft"
    | "apply-plan"
    | "settings"
    | "relink"
    | null
  >(null);
  const [capture, setCapture] = useState<{
    source: Source;
    candidate: Candidate;
    customerId: string;
  } | null>(null);
  const [title, setTitle] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [manualOwnerId, setManualOwnerId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [workKeys, setWorkKeys] = useState("");
  const [zone, setZone] = useState("Europe/Paris");
  const [at, setAt] = useState("");
  const [url, setUrl] = useState("");
  const [reason, setReason] = useState("");
  const [planKey, setPlanKey] = useState("ATL-248");
  const [newDate, setNewDate] = useState("2026-11-13");
  const [planMode, setPlanMode] = useState<"release" | "blocked">("release");
  const [draft, setDraft] = useState("");
  const [activityOwner, setActivityOwner] = useState("all");
  const [activityReview, setActivityReview] = useState("all");
  const [manual, setManual] = useState("");
  const [manualSource, setManualSource] = useState<Source | null>(null);
  const [newCustomerId, setNewCustomerId] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newRenewal, setNewRenewal] = useState("");
  const [captureProjects, setCaptureProjects] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const [commentId, setCommentId] = useState("");
  const [project, setProject] = useState("");
  const [supportProject, setSupportProject] = useState("");
  const [projects, setProjects] = useState<
    { key: string; name: string; projectTypeKey?: string }[]
  >([]);
  const [sprintField, setSprintField] = useState("");
  const [flagField, setFlagField] = useState("");
  const bound = app?.boundKey;
  const allRecords = app?.records ?? [];
  // In a work item or request panel, list only the promises tied to that item.
  const records = bound
    ? allRecords.filter(
        (r) =>
          r.data.workKeys.includes(bound) || r.data.source.issueKey === bound,
      )
    : allRecords;
  const row = records.find((r) => r.data.id === selected) ?? records[0];
  const promise = row?.data;
  const assessment =
    promise && app ? assess(promise, app.works, app.now) : null;
  const evaluated = records.map((record) => ({
    record,
    result: assess(record.data, app!.works, app!.now),
  }));
  const alerts = records
    .flatMap((record) => record.data.alerts.map((alert) => ({ alert, record })))
    .sort((a, b) => b.alert.at.localeCompare(a.alert.at));
  const unread = alerts.filter((a) => !a.alert.acknowledgedAt).length;
  const filteredAlerts = alerts.filter(
    ({ alert, record }) =>
      (activityOwner === "all" || record.data.owner.id === activityOwner) &&
      (activityReview === "all" ||
        (activityReview === "reviewed") === !!alert.acknowledgedAt),
  );
  const activeWorks =
    app?.works.filter(
      (w) =>
        planMode === "blocked" ||
        w.versions.filter((v) => !v.archived && !v.released).length === 1,
    ) ?? [];
  const change: PlanChange = {
    workKey: planKey,
    ...(planMode === "release"
      ? { releaseOn: newDate || null }
      : { blocked: true }),
  };
  let impact: ReturnType<typeof preview> | null = null;
  let impactError = "";
  if (app && activeWorks.some((w) => w.key === planKey)) {
    try {
      impact = preview(
        allRecords.map((r) => r.data),
        app.works,
        change,
        app.now,
      );
    } catch (e) {
      impactError = e instanceof Error ? e.message : String(e);
    }
  }
  const releases = [
    ...new Map(
      (app?.works ?? []).flatMap((w) => w.versions).map((v) => [v.id, v]),
    ).values(),
  ];
  const sources = app
    ? [
        ...app.sources,
        ...(manualSource
          ? [
              {
                source: manualSource,
                customer: app.customers[0] ?? {
                  id: "manual",
                  name: "Customer",
                  renewalOn: null,
                },
                suggestedKey: app.works[0]?.key ?? "",
              },
            ]
          : []),
      ]
    : [];
  const candidates = sources.flatMap((item) =>
    propose(item.source, releases, zone).map((candidate) => ({
      ...item,
      candidate,
    })),
  );
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      const issues = (e as { issues?: { path: unknown[]; message: string }[] })
        .issues;
      setError(
        issues
          ? issues.map((i) => `${i.path.join(" ")}: ${i.message}`).join(". ")
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const data = await client.bootstrap();
    setApp(data);
    if (!app && data.mode === "forge") {
      const release = data.works
        .flatMap((w) => w.versions)
        .find((v) => !v.archived && !v.released);
      setNewDate(
        Temporal.PlainDate.from(
          release?.releaseOn ?? localDay(data.now, "Europe/Paris"),
        )
          .add({ days: 7 })
          .toString(),
      );
    }
    setPlanKey((key) =>
      data.works.some((w) => w.key === key) ? key : (data.works[0]?.key ?? ""),
    );
  }
  function resolveOwner() {
    if (ownerId === "other" && manualOwnerId.trim())
      return { id: manualOwnerId.trim(), name: "Atlassian user" };
    const owner = app?.people.find((p) => p.id === ownerId);
    if (!owner) throw new Error("Choose a valid follow-up owner");
    return owner;
  }
  function openSettings() {
    setModal("settings");
    setError("");
    if (client.isForge)
      void task(async () => {
        setProjects(await client.invoke("projects"));
        const settings = await client.invoke<{
          sprintField: string;
          flagField: string;
          captureProjects: string[];
        }>("settings");
        setSprintField(settings.sprintField);
        setFlagField(settings.flagField);
        setCaptureProjects(settings.captureProjects.join(", "));
      });
  }
  useEffect(() => {
    void task(refresh);
  }, []);
  useEffect(() => {
    if (app && !activeWorks.some((w) => w.key === planKey))
      setPlanKey(activeWorks[0]?.key ?? "");
  }, [app, planMode, planKey]);
  useEffect(() => {
    if (tab !== "register" || !inspectFocus.current) return;
    inspectFocus.current = false;
    const detail = document.querySelector<HTMLElement>(".detail");
    detail?.focus({ preventScroll: true });
    if (window.innerWidth < 1100) detail?.scrollIntoView({ block: "start" });
  }, [tab, selected]);
  useEffect(() => {
    if (app?.mode !== "forge") return;
    const timer = setInterval(
      () => setApp((a) => (a ? { ...a, now: new Date().toISOString() } : a)),
      30000,
    );
    return () => clearInterval(timer);
  }, [app?.mode]);
  const close = () => {
    setModal(null);
    setError("");
  };
  const navigate = (next: Tab) => {
    setTab(next);
    setError("");
    setNotice("");
  };
  function inspect(record: RecordState) {
    inspectFocus.current = true;
    setSelected(record.data.id);
    setTab("register");
    setNotice("");
    setError("");
  }
  function begin(kind: typeof modal) {
    setReason("");
    setUrl("");
    setAt(app ? localInput(app.now) : "");
    setDueOn(promise?.dueOn ?? "");
    setWorkKeys(promise?.workKeys.join(", ") ?? "");
    setOwnerId(promise?.owner.id ?? "");
    if (kind === "draft" && promise && app)
      setDraft(customerDraft(promise, app.works, app.now));
    setError("");
    setModal(kind);
  }
  async function command(
    action: "deliver" | "amend" | "cancel" | "relink" | "acknowledge",
    values: Record<string, unknown>,
  ) {
    if (!app || !row) return;
    setApp(
      await client.mutate(row.data.id, row.version, app.generation, {
        action,
        ...values,
      }),
    );
    close();
    setNotice(
      "The reviewed change and its actor are recorded in the promise history.",
    );
  }
  function download(text: string, name: string) {
    const href = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  async function exportEvidence() {
    if (!promise) return;
    const data = await client.exportBundle(promise.id);
    download(
      JSON.stringify(data, null, 2),
      `kept-${promise.id.toLowerCase()}-evidence.json`,
    );
    setNotice(
      `Evidence exported. Retain its digest separately: ${data.bundleHash}`,
    );
  }
  const today = app ? localDay(app.now, "Europe/Paris") : "2026-11-02";
  const weekEnd = Temporal.PlainDate.from(today).add({ days: 7 }).toString();
  const filtered = evaluated.filter(
    ({ record, result }) =>
      (filter === "all" || result.state === filter) &&
      `${record.data.customer.name} ${record.data.title} ${record.data.workKeys.join(" ")} ${record.data.owner.name}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className={`shell${bound ? " bound" : ""}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      {!bound && (
        <aside className="sidebar">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              navigate("register");
            }}
          >
            <span className="brand-mark">
              k<span>·</span>
            </span>
            <span>
              kept<span className="brand-period">.</span>
            </span>
          </a>
          <div className="workspace-label">
            <span className="workspace-icon">
              {app?.mode === "forge" ? "J" : "A"}
            </span>
            <span>
              {app?.mode === "forge" ? "This Jira site" : "Atlas workspace"}
              <small>
                {app?.mode === "forge"
                  ? "Promises across projects"
                  : "Fictional product team"}
              </small>
            </span>
          </div>
          <div className="nav-label">CUSTOMER COMMITMENTS</div>
          <nav aria-label="Main navigation">
            {(Object.keys(TAB_NAMES) as Tab[]).map((key) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                aria-current={tab === key ? "page" : undefined}
                onClick={() => navigate(key)}
              >
                <Icon name={key} />
                <span>{TAB_NAMES[key]}</span>
                {key === "capture" && <small>{candidates.length}</small>}
                {key === "activity" && unread > 0 && (
                  <small className="notification-count">{unread}</small>
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-note">
            <div className="small-check">
              <Icon name="check" size={13} />
            </div>
            <p>
              The promise is the date.
              <br />
              The work is the evidence.
            </p>
          </div>
          <div className="sidebar-bottom">
            <button className="sidebar-setting" onClick={openSettings}>
              <Icon name="settings" /> Workspace settings
            </button>
            <div className="profile">
              <span className="avatar dark">
                {initials(app?.actor.name ?? "Morgan Lee")}
              </span>
              <span>
                {app?.actor.name ?? "Loading workspace"}
                <small>
                  {app?.mode === "forge"
                    ? "Atlassian account"
                    : "Customer success · demo"}
                </small>
              </span>
            </div>
          </div>
        </aside>
      )}
      <div className="content">
        {bound ? (
          <nav className="panel-tabs" aria-label="Kept views">
            {(Object.keys(TAB_NAMES) as Tab[]).map((key) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                aria-current={tab === key ? "page" : undefined}
                onClick={() => navigate(key)}
              >
                {TAB_NAMES[key]}
                {key === "capture" && candidates.length > 0 && (
                  <small>{candidates.length}</small>
                )}
              </button>
            ))}
            <button
              className="icon refresh"
              aria-label="Refresh"
              disabled={busy}
              onClick={() => void task(refresh)}
            >
              ↻
            </button>
          </nav>
        ) : (
          <header className="topbar">
            <div>
              <span className="breadcrumb">
                {app?.mode === "forge" ? "Kept" : "Atlas"}
              </span>
              <span className="crumb-slash">/</span>
              <strong>{TAB_NAMES[tab]}</strong>
            </div>
            <div className="top-right">
              <span className="mode">
                <i />
                {app?.mode === "forge" ? "FORGE SITE" : "SYNTHETIC REPLAY"}
              </span>
              <span className="today">
                {app ? timeText(app.now) : "Loading"} <small>PARIS</small>
              </span>
              <button
                className="icon mobile-settings"
                aria-label="Open workspace settings"
                onClick={openSettings}
              >
                <Icon name="settings" size={15} />
              </button>
              <button
                className="icon refresh"
                aria-label="Refresh workspace"
                disabled={busy}
                onClick={() => void task(refresh)}
              >
                ↻
              </button>
            </div>
          </header>
        )}
        <main id="main">
          {error && !modal && (
            <p className="message error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="message notice" role="status">
              {notice}
            </p>
          )}
          {!app ? (
            <section className="loading">
              <span className="eyebrow">THE CUSTOMER PROMISE REGISTER</span>
              <h1>
                {error
                  ? "The workspace needs attention."
                  : "Connecting the promise to the work."}
              </h1>
              <button className="secondary" onClick={openSettings}>
                Open settings
              </button>
            </section>
          ) : (
            <>
              {tab === "register" && bound && (
                <div className="panel-heading">
                  <strong>
                    {records.length === 0
                      ? `No customer promise is tied to ${bound} yet.`
                      : `${records.length} customer ${records.length === 1 ? "promise depends" : "promises depend"} on ${bound}`}
                  </strong>
                  <span>
                    {new Set(records.map((r) => r.data.customer.id)).size}{" "}
                    customer organisations ·{" "}
                    {
                      evaluated.filter((r) =>
                        ["AT_RISK", "BROKEN", "UNKNOWN"].includes(
                          r.result.state,
                        ),
                      ).length
                    }{" "}
                    need attention
                  </span>
                </div>
              )}
              {tab === "register" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">THE PROMISE REGISTER</span>
                      <h1>
                        Dates move.
                        <br />
                        <span>Customers remember.</span>
                      </h1>
                      <p>
                        One place for what was promised, who owns it, and the
                        work behind it.
                      </p>
                    </div>
                    <button
                      className="primary"
                      onClick={() => navigate("capture")}
                    >
                      Capture a promise <Icon name="arrow" />
                    </button>
                  </div>
                  <div className="metrics">
                    <div>
                      <span>Tracked promises</span>
                      <strong>
                        {records.length.toString().padStart(2, "0")}
                      </strong>
                      <small>
                        {new Set(records.map((r) => r.data.customer.id)).size}{" "}
                        customer organisations
                      </small>
                    </div>
                    <div>
                      <span>Need attention</span>
                      <strong className="metric-orange">
                        {evaluated
                          .filter((r) =>
                            ["AT_RISK", "BROKEN", "UNKNOWN"].includes(
                              r.result.state,
                            ),
                          )
                          .length.toString()
                          .padStart(2, "0")}
                      </strong>
                      <small>Risk, missed dates or missing evidence</small>
                    </div>
                    <div>
                      <span>Due in the next 7 days</span>
                      <strong>
                        {records
                          .filter(
                            (r) =>
                              !r.data.delivery &&
                              !r.data.cancellation &&
                              r.data.dueOn >= today &&
                              r.data.dueOn <= weekEnd,
                          )
                          .length.toString()
                          .padStart(2, "0")}
                      </strong>
                      <small>Including today's commitments</small>
                    </div>
                    <div>
                      <span>Kept, with evidence</span>
                      <strong className="metric-green">
                        {evaluated
                          .filter((r) => r.result.state === "KEPT")
                          .length.toString()
                          .padStart(2, "0")}
                      </strong>
                      <small>Confirmed customer availability</small>
                    </div>
                  </div>
                  <div className="register-toolbar">
                    <div className="filters" aria-label="Filter promises">
                      <button
                        className={filter === "all" ? "chosen" : ""}
                        aria-pressed={filter === "all"}
                        onClick={() => setFilter("all")}
                      >
                        All promises <span>{records.length}</span>
                      </button>
                      <button
                        className={filter === "AT_RISK" ? "chosen" : ""}
                        aria-pressed={filter === "AT_RISK"}
                        onClick={() => setFilter("AT_RISK")}
                      >
                        At risk{" "}
                        <span>
                          {
                            evaluated.filter(
                              (x) => x.result.state === "AT_RISK",
                            ).length
                          }
                        </span>
                      </button>
                      <button
                        className={filter === "UNKNOWN" ? "chosen" : ""}
                        aria-pressed={filter === "UNKNOWN"}
                        onClick={() => setFilter("UNKNOWN")}
                      >
                        Needs evidence
                      </button>
                      <button
                        className={filter === "BROKEN" ? "chosen" : ""}
                        aria-pressed={filter === "BROKEN"}
                        onClick={() => setFilter("BROKEN")}
                      >
                        Missed dates
                      </button>
                    </div>
                    <label className="search">
                      <Icon name="search" size={16} />
                      <input
                        aria-label="Search promises"
                        placeholder="Customer, promise or work item"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="register-grid">
                    <section
                      aria-label="Customer promise register"
                      className="register-table-wrap"
                    >
                      <table className="register-table">
                        <thead>
                          <tr>
                            <th scope="col">PROMISED</th>
                            <th scope="col">THE COMMITMENT</th>
                            <th scope="col">CUSTOMER</th>
                            <th scope="col">STATUS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map(({ record, result }) => {
                            const p = record.data;
                            return (
                              <tr
                                key={p.id}
                                className={
                                  promise?.id === p.id ? "selected" : ""
                                }
                              >
                                <td>
                                  <span className="date-day">
                                    {p.dueOn.slice(8)}
                                  </span>
                                  <span className="date-month">
                                    {dateText(p.dueOn).split(" ")[1]}
                                  </span>
                                  <span className="date-year">
                                    {p.dueOn.slice(0, 4)}
                                  </span>
                                </td>
                                <td>
                                  <button
                                    className="promise-name"
                                    onClick={() => inspect(record)}
                                  >
                                    {p.title} <span>↗</span>
                                  </button>
                                  <div className="promise-meta">
                                    <Icon name="link" size={12} />
                                    {p.workKeys.join(" + ")}
                                    <span className="meta-dot">·</span>
                                    {p.owner.name.split(" ")[0]}
                                  </div>
                                </td>
                                <td>
                                  <span className="customer-name">
                                    {p.customer.name}
                                  </span>
                                  <small className="renewal">
                                    {p.customer.renewalOn
                                      ? `Renews ${dateText(p.customer.renewalOn)}`
                                      : "Renewal not recorded"}
                                  </small>
                                </td>
                                <td>
                                  <Status state={result.state} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {!filtered.length && (
                        <div className="empty">
                          No promises match this view. Change the filter or
                          capture a reply.
                        </div>
                      )}
                      <div className="table-footer">
                        <span>
                          {filtered.length} of {records.length} promises
                        </span>
                        <span>
                          Dates are customer commitments. Status is
                          evidence-led.
                        </span>
                      </div>
                    </section>
                    {promise && assessment && (
                      <aside
                        className="detail"
                        aria-label="Selected promise"
                        tabIndex={-1}
                      >
                        <div className="detail-kicker">
                          <span>{promise.id}</span>
                          <span className="detail-chip">
                            {promise.synthetic ? "DEMO EVIDENCE" : "CONFIRMED"}
                          </span>
                        </div>
                        <h2>{promise.title}</h2>
                        <div className="detail-customer">
                          <span className="customer-monogram">
                            {promise.customer.name[0]}
                          </span>
                          <span>
                            {promise.customer.name}
                            <small>Customer organisation</small>
                          </span>
                        </div>
                        <Status state={assessment.state} />
                        <div className="date-comparison">
                          <div>
                            <small>AGREED DATE</small>
                            <strong>{dateText(promise.dueOn)}</strong>
                          </div>
                          <div>
                            <small>CURRENT PLAN</small>
                            <strong>
                              {assessment.forecastOn
                                ? dateText(assessment.forecastOn)
                                : "Not established"}
                            </strong>
                          </div>
                        </div>
                        <p className="promise-timezone">
                          Promise date uses {promise.timezone}.
                        </p>
                        <p className="reason">{assessment.reasons[0]}</p>
                        {assessment.reasons.length > 1 && (
                          <details>
                            <summary>All assessment reasons</summary>
                            <ul>
                              {assessment.reasons.slice(1).map((r) => (
                                <li key={r}>{r}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                        <div className="detail-section">
                          <h3>THE ORIGINAL WORDS</h3>
                          <blockquote>“{promise.excerpt}”</blockquote>
                          <a
                            href={promise.source.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {promise.source.issueKey} · Public reply{" "}
                            <span>↗</span>
                          </a>
                          <small>
                            {promise.source.author.name} ·{" "}
                            {timeText(promise.source.createdAt)} Paris
                          </small>
                        </div>
                        <div className="detail-section">
                          <h3>THE WORK BEHIND IT</h3>
                          {promise.workKeys.map((key) => {
                            const w = app.works.find((x) => x.key === key);
                            return (
                              <div className="linked-work" key={key}>
                                <a
                                  href={w?.url ?? promise.source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {key} ↗
                                </a>
                                <span>
                                  {w?.title ?? "Observation unavailable"}
                                </span>
                                <small>
                                  {w
                                    ? `${w.status.replace("-", " ")} · observed ${timeText(w.observedAt)} Paris`
                                    : "Access or evidence required"}
                                </small>
                              </div>
                            );
                          })}
                          <button
                            className="text-button"
                            onClick={() => begin("relink")}
                          >
                            Review linked work and owner
                          </button>
                        </div>
                        {promise.amendments.length > 0 && (
                          <div className="amendment-note">
                            <strong>
                              Original date: {dateText(promise.originalDueOn)}
                            </strong>
                            <p>
                              {promise.amendments.length} agreed amendment(s).
                              Original outcome:{" "}
                              {STATE_LABELS[assessment.originalState]}.
                            </p>
                            <a
                              href={promise.amendments.at(-1)!.agreementUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Customer agreement ↗
                            </a>
                          </div>
                        )}
                        {promise.delivery && (
                          <div className="delivery-note">
                            <strong>Customer availability recorded</strong>
                            <p>{timeText(promise.delivery.at)} Paris</p>
                            <a
                              href={promise.delivery.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Delivery evidence ↗
                            </a>
                          </div>
                        )}
                        {promise.cancellation && (
                          <div className="amendment-note">
                            <strong>Withdrawal rationale</strong>
                            <p>{promise.cancellation.reason}</p>
                            <p>
                              Original outcome:{" "}
                              {STATE_LABELS[assessment.originalState]}
                            </p>
                            <a
                              href={promise.cancellation.agreementUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Withdrawal agreement
                            </a>
                            <small>
                              {timeText(promise.cancellation.at)} Paris |{" "}
                              {promise.cancellation.actor}
                            </small>
                          </div>
                        )}
                        <div className="detail-actions">
                          <button
                            className="primary"
                            disabled={
                              busy ||
                              !!promise.delivery ||
                              !!promise.cancellation
                            }
                            onClick={() => begin("deliver")}
                          >
                            Record customer delivery{" "}
                            <Icon name="check" size={15} />
                          </button>
                          <button
                            className="secondary"
                            onClick={() => begin("draft")}
                          >
                            Prepare customer update{" "}
                            <Icon name="arrow" size={15} />
                          </button>
                          <div className="action-pair">
                            <button
                              className="text-button"
                              disabled={
                                !!promise.delivery || !!promise.cancellation
                              }
                              onClick={() => begin("amend")}
                            >
                              Agreed date change
                            </button>
                            <button
                              className="text-button"
                              disabled={
                                !!promise.delivery || !!promise.cancellation
                              }
                              onClick={() => begin("cancel")}
                            >
                              Withdraw
                            </button>
                          </div>
                          <button
                            className="text-button export"
                            disabled={busy}
                            onClick={() => void task(exportEvidence)}
                          >
                            Export evidence bundle ↗
                          </button>
                        </div>
                        <details className="history">
                          <summary>
                            {row!.events.length} recorded event(s)
                          </summary>
                          <ol>
                            {row!.events.map((e) => (
                              <li key={e.hash}>
                                <strong>{e.action.replace(/\./g, " ")}</strong>
                                <span>
                                  {timeText(e.at)} · {e.actor}
                                </span>
                                <code>{e.hash.slice(0, 18)}…</code>
                              </li>
                            ))}
                          </ol>
                          <p>
                            Hashes establish consistency. Retain the exported
                            digest separately.
                          </p>
                        </details>
                      </aside>
                    )}
                  </div>
                </>
              )}
              {tab === "capture" && (
                <>
                  <div className="page-heading compact">
                    <div>
                      <span className="eyebrow">FROM REPLY TO RECORD</span>
                      <h1>
                        A promise starts
                        <br />
                        <span>with the actual words.</span>
                      </h1>
                      <p>
                        Proposed dates are suggestions. You confirm the
                        customer, date and delivery work.
                      </p>
                    </div>
                    <span className="section-marker">01 / CAPTURE</span>
                  </div>
                  <div className="capture-explainer">
                    <Icon name="capture" />
                    <span>
                      Public replies only. English date and release recognition.
                      Quoted text and instructions never authorise a commitment.
                    </span>
                    <strong>{candidates.length} candidates</strong>
                  </div>
                  <section
                    className="candidate-list"
                    aria-label="Proposed promises"
                  >
                    {candidates.map((item) => {
                      const exists = records.some(
                        (r) =>
                          r.data.source.id === item.source.id &&
                          r.data.excerpt === item.candidate.excerpt &&
                          r.data.customer.id === item.customer.id,
                      );
                      return (
                        <article
                          className="candidate-row"
                          key={item.candidate.id}
                        >
                          <div className="candidate-source">
                            <span className="customer-monogram">
                              {item.customer.name[0]}
                            </span>
                            <strong>{item.customer.name}</strong>
                            <a
                              href={item.source.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {item.source.issueKey} ↗
                            </a>
                            <small>
                              {timeText(item.source.createdAt)} Paris
                            </small>
                          </div>
                          <div className="candidate-body">
                            <span className="mini-label">
                              PUBLIC SUPPORT REPLY
                            </span>
                            <blockquote>{item.candidate.excerpt}</blockquote>
                            <div className="detected">
                              <span>
                                {item.candidate.dueOn
                                  ? dateText(item.candidate.dueOn)
                                  : "Date needs review"}
                              </span>
                              <span>
                                <Icon name="link" size={13} />
                                {item.candidate.workKeys.join(", ") ||
                                  item.suggestedKey ||
                                  "Work link required"}
                              </span>
                            </div>
                            {item.candidate.review.map((r) => (
                              <p className="capture-warning" key={r}>
                                {r}
                              </p>
                            ))}
                          </div>
                          <button
                            className={exists ? "secondary" : "primary"}
                            disabled={busy || exists}
                            onClick={() => {
                              setCapture({
                                ...item,
                                customerId: item.customer.id,
                              });
                              setTitle(promiseTitle(item.candidate.excerpt));
                              setCustomerId(item.customer.id);
                              setDueOn(item.candidate.dueOn ?? "");
                              setWorkKeys(
                                item.candidate.workKeys.join(", ") ||
                                  item.suggestedKey,
                              );
                              setOwnerId(app.actor.id);
                              setModal("capture");
                              setError("");
                            }}
                          >
                            {exists ? (
                              "Registered ✓"
                            ) : (
                              <>
                                Review promise <Icon name="arrow" size={15} />
                              </>
                            )}
                          </button>
                        </article>
                      );
                    })}
                  </section>
                  {client.isForge && (
                    <div className="discovery-controls">
                      <p>
                        Discovery loads 20 public replies at a time. References
                        expire after 30 days; load an older reply directly by
                        request key and comment ID.
                      </p>
                      {app.sourceCursor && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void task(async () => {
                              const page = await client.loadMoreSources(
                                app.sourceCursor!,
                              );
                              setApp((current) =>
                                current
                                  ? {
                                      ...current,
                                      sourceCursor: page.sourceCursor,
                                      sources: [
                                        ...new Map(
                                          [
                                            ...current.sources,
                                            ...page.sources,
                                          ].map((s) => [
                                            `${s.source.issueKey}:${s.source.id}`,
                                            s,
                                          ]),
                                        ).values(),
                                      ],
                                      works: [
                                        ...new Map(
                                          [...current.works, ...page.works].map(
                                            (w) => [w.key, w],
                                          ),
                                        ).values(),
                                      ],
                                      customers: [
                                        ...new Map(
                                          [
                                            ...current.customers,
                                            ...page.sources.map(
                                              (s) => s.customer,
                                            ),
                                          ].map((c) => [c.id, c]),
                                        ).values(),
                                      ],
                                    }
                                  : current,
                              );
                            })
                          }
                        >
                          Load more public replies
                        </button>
                      )}
                    </div>
                  )}
                  <section className="try-reply">
                    <div>
                      <span className="eyebrow">TRY ANOTHER REPLY</span>
                      <h2>
                        {client.isForge
                          ? "Load a public JSM comment."
                          : "Bring your own example."}
                      </h2>
                      <p>
                        {client.isForge
                          ? "The server reads the source under your Atlassian permissions."
                          : "Use fictional text. This stays in your browser and calls no external service."}
                      </p>
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void task(async () => {
                          if (client.isForge) {
                            const item = await client.loadSource(
                              sourceKey,
                              commentId,
                            );
                            setApp((a) =>
                              a
                                ? {
                                    ...a,
                                    works: [
                                      ...new Map(
                                        [...a.works, ...(item.works ?? [])].map(
                                          (w) => [w.key, w],
                                        ),
                                      ).values(),
                                    ],
                                    sources: [
                                      ...a.sources.filter(
                                        (s) => s.source.id !== item.source.id,
                                      ),
                                      item,
                                    ],
                                    customers: [
                                      ...new Map(
                                        [...a.customers, item.customer].map(
                                          (c) => [c.id, c],
                                        ),
                                      ).values(),
                                    ],
                                  }
                                : a,
                            );
                          } else {
                            const s: Source = {
                              id: `manual-${(await hash(manual)).slice(0, 12)}`,
                              issueKey: "SUP-999",
                              body: manual,
                              public: true,
                              author: app.actor,
                              createdAt: app.now,
                              updatedAt: app.now,
                              url: "https://demo.example/jira/browse/SUP-999",
                            };
                            setManualSource(s);
                            const count = propose(s, releases, zone).length;
                            setNotice(
                              count
                                ? `${count} proposal(s) added above. Review the date and wording before confirmation.`
                                : "No dated outgoing commitment was recognised. Internal, quoted, negated and unsupported wording is left unclassified.",
                            );
                          }
                        });
                      }}
                    >
                      {client.isForge ? (
                        <>
                          <label htmlFor="source-key">JSM request key</label>
                          <input
                            id="source-key"
                            value={sourceKey}
                            onChange={(e) => setSourceKey(e.target.value)}
                            required
                          />
                          <label htmlFor="comment-id">Public comment ID</label>
                          <input
                            id="comment-id"
                            value={commentId}
                            onChange={(e) => setCommentId(e.target.value)}
                            required
                          />
                        </>
                      ) : (
                        <>
                          <label htmlFor="reply">Public reply text</label>
                          <textarea
                            id="reply"
                            rows={3}
                            value={manual}
                            onChange={(e) => setManual(e.target.value)}
                            maxLength={12000}
                            placeholder="We will deliver the export by 6 November 2026, tracked in ATL-248."
                            required
                          />
                        </>
                      )}
                      <button className="secondary" disabled={busy}>
                        {client.isForge
                          ? "Load source"
                          : "Find proposed promises"}{" "}
                        <Icon name="arrow" size={15} />
                      </button>
                    </form>
                  </section>
                </>
              )}
              {tab === "impact" && (
                <>
                  <div className="page-heading compact">
                    <div>
                      <span className="eyebrow">BEFORE YOU MOVE THE WORK</span>
                      <h1>
                        A release date changes.
                        <br />
                        <span>Who needs to know?</span>
                      </h1>
                      <p>
                        Preview the promises behind a planning decision. Live
                        Jira stays unchanged.
                      </p>
                    </div>
                    <span className="section-marker">02 / CHANGE IMPACT</span>
                  </div>
                  <form
                    className="plan-controls"
                    onSubmit={(e) => e.preventDefault()}
                  >
                    <div>
                      <label htmlFor="plan-work">Delivery work</label>
                      <select
                        id="plan-work"
                        value={planKey}
                        onChange={(e) => {
                          setPlanKey(e.target.value);
                          const version = app.works
                            .find((w) => w.key === e.target.value)
                            ?.versions.find((v) => !v.archived && !v.released);
                          setNewDate(
                            Temporal.PlainDate.from(
                              version?.releaseOn ??
                                localDay(app.now, "Europe/Paris"),
                            )
                              .add({ days: 7 })
                              .toString(),
                          );
                        }}
                        disabled={!activeWorks.length}
                      >
                        {activeWorks.map((w) => (
                          <option key={w.key} value={w.key}>
                            {w.key} · {w.title}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="plan-mode">Planning decision</label>
                      <select
                        id="plan-mode"
                        value={planMode}
                        onChange={(e) =>
                          setPlanMode(e.target.value as typeof planMode)
                        }
                      >
                        <option value="release">
                          Move its shared release date
                        </option>
                        <option value="blocked">Mark this work blocked</option>
                      </select>
                    </div>
                    {planMode === "release" && (
                      <div>
                        <label htmlFor="plan-date">Proposed release date</label>
                        <input
                          id="plan-date"
                          type="date"
                          value={newDate}
                          onChange={(e) => setNewDate(e.target.value)}
                        />
                      </div>
                    )}
                    <span className="read-only-tag">
                      <Icon name="check" size={14} /> Read-only preview
                    </span>
                  </form>
                  {!activeWorks.length && (
                    <div className="empty">
                      {planMode === "release"
                        ? "A release preview needs linked work with exactly one unreleased version. Choose a blocking preview to review other work."
                        : "Load a source reply and link its delivery work before previewing a change."}
                    </div>
                  )}
                  {impactError && (
                    <p className="error" role="alert">
                      {impactError}
                    </p>
                  )}
                  {impact && (
                    <>
                      <div className="impact-statement">
                        <span className="impact-number">
                          {impact.newlyAtRisk.toString().padStart(2, "0")}
                        </span>
                        <div>
                          <span className="eyebrow">
                            PROMISES NEWLY AT RISK
                          </span>
                          <h2>
                            {impact.newlyAtRisk
                              ? "The date changes for engineering.\nThe commitment stays with the customer."
                              : "Review every affected promise\nbefore changing the plan."}
                          </h2>
                          <p>
                            {impact.affected} promises to {impact.customers}{" "}
                            customers are in scope. {impact.renewals} customers
                            renew within 60 days.
                            {impact.unknownRenewals > 0
                              ? ` ${impact.unknownRenewals} renewal date(s) are unknown.`
                              : ""}
                            {impact.conflictingCustomers > 0
                              ? ` ${impact.conflictingCustomers} customer ID(s) have conflicting metadata; reconcile them before relying on the totals.`
                              : ""}
                          </p>
                        </div>
                      </div>
                      <table className="impact-table">
                        <thead>
                          <tr>
                            <th scope="col">CUSTOMER / PROMISE</th>
                            <th scope="col">PROMISED</th>
                            <th scope="col">BEFORE</th>
                            <th scope="col">AFTER</th>
                            <th scope="col">OWNER</th>
                          </tr>
                        </thead>
                        <tbody>
                          {impact.rows.map((r) => (
                            <tr key={r.promise.id}>
                              <td>
                                <strong>{r.promise.customer.name}</strong>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    inspect(
                                      records.find(
                                        (x) => x.data.id === r.promise.id,
                                      )!,
                                    )
                                  }
                                >
                                  {r.promise.title} ↗
                                </button>
                              </td>
                              <td>{dateText(r.promise.dueOn)}</td>
                              <td>
                                <Status state={r.before.state} />
                              </td>
                              <td>
                                <Status state={r.after.state} />
                              </td>
                              <td>{r.promise.owner.name}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="impact-footer">
                        <p>{impact.scope}</p>
                        <button
                          className="primary"
                          disabled={busy || !impact.rows.length}
                          onClick={() => {
                            if (client.isForge)
                              setNotice(
                                "Apply the reviewed planning decision in Jira. Its issue-change event refreshes linked promises and records in-app owner alerts.",
                              );
                            else begin("apply-plan");
                          }}
                        >
                          {client.isForge
                            ? "Review next step"
                            : "Apply synthetic plan"}{" "}
                          <Icon name="arrow" />
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
              {tab === "activity" && (
                <>
                  <div className="page-heading compact">
                    <div>
                      <span className="eyebrow">THE FOLLOW-UP QUEUE</span>
                      <h1>
                        Plans changed.
                        <br />
                        <span>Keep people in the loop.</span>
                      </h1>
                      <p>
                        Internal alerts identify the owner and promise affected.
                        Customer updates stay human-reviewed.
                      </p>
                    </div>
                    <span className="section-marker">03 / ACTIVITY</span>
                  </div>
                  <div className="activity-controls">
                    <div>
                      <label htmlFor="activity-owner">Follow-up owner</label>
                      <select
                        id="activity-owner"
                        value={activityOwner}
                        onChange={(e) => setActivityOwner(e.target.value)}
                      >
                        <option value="all">All owners</option>
                        {app.people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.id === app.actor.id ? " (me)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="activity-review">Review status</label>
                      <select
                        id="activity-review"
                        value={activityReview}
                        onChange={(e) => setActivityReview(e.target.value)}
                      >
                        <option value="all">All alerts</option>
                        <option value="unreviewed">Needs review</option>
                        <option value="reviewed">Reviewed</option>
                      </select>
                    </div>
                    <p>
                      {filteredAlerts.length} of {alerts.length} alerts
                    </p>
                  </div>
                  {!alerts.length ? (
                    <div className="activity-empty">
                      <Icon name="check" size={30} />
                      <h2>No planning alerts to review.</h2>
                      <p>
                        Preview a release change to see which promises it
                        affects.
                      </p>
                      <button
                        className="secondary"
                        onClick={() => navigate("impact")}
                      >
                        Preview a change <Icon name="arrow" />
                      </button>
                    </div>
                  ) : filteredAlerts.length ? (
                    filteredAlerts.map(({ alert, record }) => (
                      <article
                        className={`alert-row ${alert.acknowledgedAt ? "read" : ""}`}
                        key={`${record.data.id}:${alert.id}`}
                      >
                        <span className="alert-indicator" />
                        <div>
                          <span className="mini-label">
                            {timeText(alert.at)} PARIS · {alert.workKey}
                          </span>
                          <h2>
                            {record.data.customer.name} · {record.data.title}
                          </h2>
                          <p>{alert.reason}</p>
                          <small>
                            Follow-up owner: {record.data.owner.name}
                          </small>
                          <button
                            className="text-button"
                            onClick={() => inspect(record)}
                          >
                            Review promise ↗
                          </button>
                        </div>
                        <button
                          className="secondary"
                          disabled={busy || !!alert.acknowledgedAt}
                          onClick={() =>
                            void task(async () => {
                              setApp(
                                await client.mutate(
                                  record.data.id,
                                  record.version,
                                  app.generation,
                                  { action: "acknowledge", alertId: alert.id },
                                ),
                              );
                              setNotice(
                                "Alert reviewed. The reviewing actor and timestamp are recorded.",
                              );
                            })
                          }
                        >
                          {alert.acknowledgedAt
                            ? "Reviewed ✓"
                            : "Mark reviewed"}
                        </button>
                      </article>
                    ))
                  ) : (
                    <div className="empty">
                      No alerts match this owner and review status.
                    </div>
                  )}
                </>
              )}
              <footer>
                <span>
                  <i />
                  {app.mode === "replay"
                    ? "Fictional customers. Browser-local evidence. No customer messages sent."
                    : "Permission-scoped promises. Reviewed delivery evidence."}
                </span>
                <span>
                  Kept <span className="footer-dot">·</span> RULESET
                  2026-11-01.1 <span className="footer-dot">·</span>
                  <a
                    href="https://github.com/Marc-Dvci/kept"
                    target="_blank"
                    rel="noreferrer"
                  >
                    MIT ↗
                  </a>
                </span>
              </footer>
            </>
          )}
          {busy && (
            <div className="working" role="status">
              Working…
            </div>
          )}
        </main>
      </div>
      {modal === "capture" && capture && app && (
        <Modal title="Confirm the customer promise" close={close} error={error}>
          <div className="confirmation-source">
            <span className="mini-label">THE EXACT PUBLIC REPLY</span>
            <blockquote>{capture.candidate.excerpt}</blockquote>
            {capture.candidate.review.map((r) => (
              <p key={r}>{r}</p>
            ))}
            <details className="source-snapshot">
              <summary>
                Review the full reply snapshot retained with this promise
              </summary>
              <p>{capture.source.body}</p>
            </details>
            <p>
              Confirmation retains the full public reply and its author/time
              metadata. Check that it is appropriate for the workspace's data
              policy.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void task(async () => {
                const confirmed = await client.confirmPromise(
                  {
                    title,
                    customer:
                      customerId === "new"
                        ? {
                            id: newCustomerId.trim(),
                            name: newCustomerName.trim(),
                            renewalOn: newRenewal || null,
                          }
                        : app.customers.find((c) => c.id === customerId)!,
                    owner: resolveOwner(),
                    source: capture.source,
                    excerpt: capture.candidate.excerpt,
                    dueOn,
                    timezone: zone,
                    workKeys: workKeys
                      .split(",")
                      .map((k) => k.trim())
                      .filter(Boolean),
                  },
                  await hash(capture.source),
                  app.generation,
                );
                setApp(confirmed);
                setSelected(
                  confirmed.focusedId ?? confirmed.records.at(-1)!.data.id,
                );
                close();
                navigate("register");
                setNotice(
                  "Promise confirmed by the authenticated actor. Its original date and source are retained.",
                );
              });
            }}
          >
            <label htmlFor="promise-title">What was promised</label>
            <input
              id="promise-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              minLength={4}
              maxLength={200}
            />
            <div className="form-grid">
              <div>
                <label htmlFor="customer">Customer organisation</label>
                <select
                  id="customer"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  {app.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="new">Add an organisation...</option>
                </select>
                {customerId === "new" && (
                  <>
                    <label htmlFor="new-customer-id">Stable customer ID</label>
                    <input
                      id="new-customer-id"
                      value={newCustomerId}
                      onChange={(e) => setNewCustomerId(e.target.value)}
                      maxLength={100}
                      required
                    />
                    <label htmlFor="new-customer-name">Organisation name</label>
                    <input
                      id="new-customer-name"
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                      maxLength={100}
                      required
                    />
                    <label htmlFor="new-renewal">Renewal date (optional)</label>
                    <input
                      id="new-renewal"
                      type="date"
                      value={newRenewal}
                      onChange={(e) => setNewRenewal(e.target.value)}
                    />
                  </>
                )}
              </div>
              <div>
                <label htmlFor="owner">Follow-up owner</label>
                <select
                  id="owner"
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                >
                  {app.people.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                  {client.isForge && (
                    <option value="other">Another Atlassian account...</option>
                  )}
                </select>
                {client.isForge && ownerId === "other" && (
                  <>
                    <label htmlFor="manual-owner">
                      Atlassian owner account ID
                    </label>
                    <input
                      id="manual-owner"
                      value={manualOwnerId}
                      onChange={(e) => setManualOwnerId(e.target.value)}
                      required
                      maxLength={150}
                    />
                  </>
                )}
              </div>
              <div>
                <label htmlFor="due">Customer-agreed date</label>
                <input
                  id="due"
                  type="date"
                  value={dueOn}
                  onChange={(e) => setDueOn(e.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="timezone">Promise timezone</label>
                <input
                  id="timezone"
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  required
                />
              </div>
            </div>
            <label htmlFor="links">
              Required Jira work keys, separated by commas
            </label>
            <input
              id="links"
              value={workKeys}
              onChange={(e) => setWorkKeys(e.target.value.toUpperCase())}
              required
            />
            <p className="form-note">
              Confirm that this is an outgoing commitment, the customer is
              correct and every linked work item is required. Quarter and
              tentative wording need your explicit date review.
            </p>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={close}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                Confirm promise <Icon name="check" />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "deliver" && app && (
        <Modal title="Record customer availability" close={close} error={error}>
          <p>
            A Jira task being Done is not delivery evidence. Record when the
            promised outcome was available to this customer.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void task(() =>
                command("deliver", {
                  at: new Date(at).toISOString(),
                  url,
                  note: reason,
                }),
              );
            }}
          >
            <label htmlFor="delivery-at">
              Available to the customer (
              {Intl.DateTimeFormat().resolvedOptions().timeZone})
            </label>
            <input
              id="delivery-at"
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
              required
            />
            <label htmlFor="delivery-url">Delivery evidence URL</label>
            <input
              id="delivery-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            <label htmlFor="delivery-note">What was verified</label>
            <textarea
              id="delivery-note"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={12}
              maxLength={1000}
              required
            />
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={close}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                Record delivery
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "amend" && (
        <Modal title="Record an agreed date change" close={close} error={error}>
          <p>
            The original date stays in the record. A new engineering plan alone
            does not change what the customer agreed.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void task(() =>
                command("amend", { dueOn, agreementUrl: url, reason }),
              );
            }}
          >
            <label htmlFor="new-due">New customer-agreed date</label>
            <input
              id="new-due"
              type="date"
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
              required
            />
            <label htmlFor="agreement-url">
              Customer agreement evidence URL
            </label>
            <input
              id="agreement-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            <label htmlFor="agreement-reason">
              Reason and agreement context
            </label>
            <textarea
              id="agreement-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={12}
              maxLength={1000}
              required
            />
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={close}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                Record agreed amendment
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "cancel" && (
        <Modal title="Withdraw this promise" close={close} error={error}>
          <p>
            The source, original date and history remain available for review.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void task(() => command("cancel", { reason, agreementUrl: url }));
            }}
          >
            <label htmlFor="withdraw-url">
              Withdrawal agreement evidence URL
            </label>
            <input
              id="withdraw-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            <label htmlFor="withdraw-reason">Withdrawal rationale</label>
            <textarea
              id="withdraw-reason"
              rows={3}
              minLength={12}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={close}>
                Keep promise active
              </button>
              <button className="primary" disabled={busy}>
                Record withdrawal
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "relink" && app && (
        <Modal title="Review work links and owner" close={close} error={error}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void task(() =>
                command("relink", {
                  workKeys: workKeys
                    .split(",")
                    .map((k) => k.trim())
                    .filter(Boolean),
                  owner: resolveOwner(),
                  reason,
                }),
              );
            }}
          >
            <label htmlFor="relink-keys">Required delivery work keys</label>
            <input
              id="relink-keys"
              value={workKeys}
              onChange={(e) => setWorkKeys(e.target.value.toUpperCase())}
              required
            />
            <label htmlFor="relink-owner">Follow-up owner</label>
            <select
              id="relink-owner"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              {app.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {client.isForge && (
                <option value="other">Another Atlassian account...</option>
              )}
            </select>
            {client.isForge && ownerId === "other" && (
              <>
                <label htmlFor="manual-owner">Atlassian owner account ID</label>
                <input
                  id="manual-owner"
                  value={manualOwnerId}
                  onChange={(e) => setManualOwnerId(e.target.value)}
                  required
                  maxLength={150}
                />
              </>
            )}
            <label htmlFor="relink-reason">Reason for this correction</label>
            <textarea
              id="relink-reason"
              rows={3}
              minLength={12}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={close}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                Save links and owner
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "draft" && promise && app && (
        <Modal title="Prepare a customer update" close={close} error={error}>
          <p>
            The draft uses the recorded promise and observed plan. Review the
            wording and send it through your approved channel.
          </p>
          <label htmlFor="customer-draft">Reviewable update</label>
          <textarea
            id="customer-draft"
            className="draft-text"
            rows={13}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="draft-evidence">
            <strong>Internal review references</strong>
            <p>
              These references stay outside the copied message. Check the
              status, recipient and wording before sending.
            </p>
            <a href={promise.source.url} target="_blank" rel="noreferrer">
              Original public reply ↗
            </a>
            <p>
              Required work: {promise.workKeys.join(", ")}. Current assessment:{" "}
              {STATE_LABELS[assessment!.state]}.
            </p>
          </div>
          <div className="modal-actions">
            <button className="secondary" onClick={close}>
              Close
            </button>
            <button
              className="primary"
              onClick={() =>
                void task(async () => {
                  await navigator.clipboard.writeText(draft);
                  setNotice(
                    "Draft copied. Review it before sending through your customer channel.",
                  );
                })
              }
            >
              Copy reviewed draft
            </button>
          </div>
        </Modal>
      )}
      {modal === "apply-plan" && impact && app && (
        <Modal
          title="Apply the synthetic planning change"
          close={close}
          error={error}
        >
          <p>
            This changes only the browser replay. {impact.affected} promises are
            in scope; {impact.newlyAtRisk} become at risk. Internal owner alerts
            will be recorded.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={close}>
              Keep current plan
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void task(async () => {
                  setApp(
                    await client.applySyntheticPlan(
                      change,
                      app.version,
                      app.generation,
                    ),
                  );
                  close();
                  setNotice(
                    "Synthetic planning change applied. Open Activity to review the affected promise owners.",
                  );
                })
              }
            >
              Confirm synthetic change
            </button>
          </div>
        </Modal>
      )}
      {modal === "settings" && (
        <Modal title="Workspace settings" close={close} error={error}>
          {client.isForge ? (
            <>
              <p>
                Jira administrator permission is required. Live configuration
                and synthetic demo seeding use your site permissions.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void task(async () => {
                    await client.invoke("saveSettings", {
                      sprintField,
                      flagField,
                      captureProjects: captureProjects
                        .split(",")
                        .map((p) => p.trim())
                        .filter(Boolean),
                    });
                    setNotice("Jira field mapping saved.");
                    close();
                  });
                }}
              >
                <label htmlFor="sprint-field">
                  Sprint custom field ID (optional)
                </label>
                <input
                  id="sprint-field"
                  value={sprintField}
                  onChange={(e) => setSprintField(e.target.value)}
                  placeholder="customfield_10020"
                />
                <label htmlFor="flag-field">
                  Flagged custom field ID (optional)
                </label>
                <input
                  id="flag-field"
                  value={flagField}
                  onChange={(e) => setFlagField(e.target.value)}
                  placeholder="customfield_10021"
                />
                <label htmlFor="capture-projects">
                  Capture projects, separated by commas
                </label>
                <input
                  id="capture-projects"
                  value={captureProjects}
                  onChange={(e) =>
                    setCaptureProjects(e.target.value.toUpperCase())
                  }
                  placeholder="SUP, HELP"
                />
                <button className="secondary" disabled={busy}>
                  Save field mapping
                </button>
              </form>
              <hr />
              <h3>Load the demo</h3>
              <p>
                Creates the Atlas releases and delivery work in a software
                project, and customer requests answered by a public reply in a
                service project.
              </p>
              <label htmlFor="demo-project">Delivery work project</label>
              <select
                id="demo-project"
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                <option value="">Choose a project</option>
                {projects.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.key} · {p.name}
                  </option>
                ))}
              </select>
              <label htmlFor="demo-support">
                Support project (Jira Service Management)
              </label>
              <select
                id="demo-support"
                value={supportProject}
                onChange={(e) => setSupportProject(e.target.value)}
              >
                <option value="">None: replies go in the work project</option>
                {projects
                  .filter((p) => p.projectTypeKey === "service_desk")
                  .map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.key} · {p.name}
                    </option>
                  ))}
              </select>
              <button
                className="primary"
                disabled={busy || !project}
                onClick={() =>
                  void task(async () => {
                    for (let step = 0; step < 12; step++) {
                      const result = await client.invoke<{ done: boolean }>(
                        "loadDemo",
                        { project, support: supportProject || undefined },
                      );
                      if (result.done) break;
                      setNotice("Creating the demo in Jira…");
                    }
                    await refresh();
                    close();
                    setNotice(
                      "Synthetic demo records created in the selected Jira project.",
                    );
                  })
                }
              >
                Load synthetic demo
              </button>
              <hr />
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void task(async () => {
                    const result = await client.invoke<{ accepted: number }>(
                      "syncGraph",
                    );
                    await refresh();
                    setNotice(
                      `${result.accepted} synthetic promise documents accepted by Teamwork Graph.`,
                    );
                    close();
                  })
                }
              >
                Sync synthetic graph documents
              </button>
            </>
          ) : (
            <>
              <p>
                This workspace uses fictional customers and a fixed Paris clock.
                Evidence is saved only in this browser. The Forge deployment
                gate remains locked until provider billing protection is
                verified.
              </p>
              <div className="settings-row">
                <div>
                  <strong>Advance the replay clock</strong>
                  <small>
                    Show elapsed plans, stale evidence and missed promises.
                  </small>
                </div>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void task(async () => {
                      setApp(await client.advance(1));
                      close();
                      setNotice(
                        "Replay advanced by one day. Observation age is included in every assessment.",
                      );
                    })
                  }
                >
                  Advance one day
                </button>
              </div>
              <div className="settings-row">
                <div>
                  <strong>Retain a local backup</strong>
                  <small>
                    Download saved replay data before a reset, including an
                    unreadable saved workspace.
                  </small>
                </div>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void task(async () => {
                      const raw = client.replayBackup();
                      if (!raw)
                        throw new Error("There is no saved replay to download");
                      download(raw, "kept-replay-backup.json");
                      setNotice(
                        "Saved replay downloaded. Keep it before resetting the workspace.",
                      );
                    })
                  }
                >
                  Download saved replay
                </button>
              </div>
              <div className="settings-row">
                <div>
                  <strong>Reset synthetic workspace</strong>
                  <small>
                    Restore the original eight promises and remove local edits.
                  </small>
                </div>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void task(async () => {
                      setApp(await client.reset());
                      setSelected("KPT-001");
                      close();
                      setNotice("The synthetic workspace has been reset.");
                    })
                  }
                >
                  Reset replay
                </button>
              </div>
            </>
          )}
          <div className="settings-about">
            <strong>Kept · MIT licensed</strong>
            <a
              href="https://github.com/Marc-Dvci/kept"
              target="_blank"
              rel="noreferrer"
            >
              Source and documentation ↗
            </a>
            <p>
              Planning signals are evidence, not guarantees. Customer
              availability and agreed amendments require review.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
