import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";

type ShellNavItem = {
  id: string;
  label: string;
  description: string;
  icon: string;
  path?: string;
  match?: (pathname: string) => boolean;
};

type ShellNavEntry = {
  item: ShellNavItem;
  itemPath?: string;
  active: boolean;
  disabled: boolean;
  showClassroomSections: boolean;
  showReportSections: boolean;
};

type ClassroomSectionId =
  | "invite"
  | "weeks"
  | "files"
  | "tasks"
  | "notices"
  | "discussion"
  | "report"
  | "attendance";
type ClassroomSubSectionId = "invite" | "weeks";
type ReportSubSectionId = "students" | "criteria" | "content";

const classroomContextPattern = /^\/classrooms\/([^/]+)(?:\/|$)/;
const classroomRoutePattern = /^\/classrooms\/([^/]+)$/;
const classroomReportRoutePattern = /^\/classrooms\/[^/]+\/report$/;
const classroomReportIdPattern = /^\/classrooms\/([^/]+)\/report$/;
const examStudioRoutePattern = /^\/classrooms\/[^/]+\/weeks\/[^/]+\/exam-studio(?:\/[^/]+)?$/;
const examStudioContextPattern = /^\/classrooms\/([^/]+)\/weeks\/([^/]+)\/exam-studio(?:\/[^/]+)?$/;
const examTakingRoutePattern = /^\/exams\/[^/]+$/;
const examReportRoutePattern = /^\/exams\/[^/]+\/report$/;
const learningSessionRoutePattern = /^\/session\/[^/]+$/;

const SHELL_NAV_ITEMS: ShellNavItem[] = [
  {
    id: "classroom",
    label: "강의실",
    description: "내 수업 공간",
    icon: "classroom",
    path: "/",
    match: (pathname: string) =>
      pathname === "/" ||
      (classroomRoutePattern.test(pathname) &&
        !classroomReportRoutePattern.test(pathname) &&
        !examStudioRoutePattern.test(pathname))
  },
  {
    id: "notice",
    label: "공지사항",
    description: "수업 알림",
    icon: "notice",
    path: "/"
  },
  {
    id: "files",
    label: "자료실",
    description: "학습 자료",
    icon: "files",
    path: "/"
  },
  {
    id: "tasks",
    label: "과제/시험",
    description: "평가 관리",
    icon: "tasks",
    path: "/",
    match: (pathname: string) => examTakingRoutePattern.test(pathname) || examStudioRoutePattern.test(pathname)
  },
  {
    id: "chat",
    label: "토론",
    description: "질문과 답변",
    icon: "chat",
    path: "/"
  },
  {
    id: "grades",
    label: "성적",
    description: "학습 리포트",
    icon: "grades",
    path: "/",
    match: (pathname: string) =>
      classroomReportRoutePattern.test(pathname) || examReportRoutePattern.test(pathname)
  },
  {
    id: "calendar",
    label: "출석",
    description: "참여 현황",
    icon: "calendar",
    path: "/"
  }
];

const CLASSROOM_SECTION_ITEMS: Record<ClassroomSubSectionId, {
  label: string;
  description: string;
}> = {
  invite: {
    label: "학생 초대",
    description: "참여 명단"
  },
  weeks: {
    label: "주차 관리",
    description: "수업 공간"
  }
};

const REPORT_SECTION_ITEMS: Record<ReportSubSectionId, {
  label: string;
  description: string;
}> = {
  students: {
    label: "학생 선택",
    description: "참여 학생"
  },
  criteria: {
    label: "평가 항목",
    description: "분석 기준"
  },
  content: {
    label: "레포트 내용",
    description: "분석 결과"
  }
};

const REPORT_SECTIONS: ReportSubSectionId[] = ["students", "criteria", "content"];
const TEACHER_CLASSROOM_SECTIONS: ClassroomSubSectionId[] = ["invite", "weeks"];
const STUDENT_CLASSROOM_SECTIONS: ClassroomSubSectionId[] = ["weeks"];
const TEACHER_ALLOWED_CLASSROOM_SECTIONS: ClassroomSectionId[] = [
  "invite",
  "weeks",
  "files",
  "tasks",
  "notices",
  "discussion",
  "report",
  "attendance"
];
const STUDENT_ALLOWED_CLASSROOM_SECTIONS: ClassroomSectionId[] = [
  "weeks",
  "files",
  "tasks",
  "notices",
  "discussion",
  "attendance"
];

function getClassroomId(pathname: string) {
  const match = pathname.match(classroomContextPattern);
  return match?.[1] ?? "";
}

function getClassroomReportId(pathname: string) {
  const match = pathname.match(classroomReportIdPattern);
  return match?.[1] ?? "";
}

function getExamStudioContext(pathname: string) {
  const match = pathname.match(examStudioContextPattern);
  if (!match?.[1] || !match[2]) return null;
  return {
    classroomId: match[1],
    weekId: match[2]
  };
}

function getSafeQueryPathSegment(value: string | null) {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.includes("/")) return "";
  return normalized;
}

function getDefaultClassroomSection(role: "teacher" | "student"): ClassroomSubSectionId {
  return role === "teacher" ? "invite" : "weeks";
}

function getActiveReportSection(rawSection: string | null): ReportSubSectionId {
  return REPORT_SECTIONS.includes(rawSection as ReportSubSectionId)
    ? rawSection as ReportSubSectionId
    : "content";
}

function getActiveClassroomSection(
  rawSection: string | null,
  role: "teacher" | "student"
): ClassroomSectionId {
  const allowed =
    role === "teacher" ? TEACHER_ALLOWED_CLASSROOM_SECTIONS : STUDENT_ALLOWED_CLASSROOM_SECTIONS;
  if (allowed.includes(rawSection as ClassroomSectionId)) {
    return rawSection as ClassroomSectionId;
  }
  return role === "teacher" ? "invite" : "weeks";
}

function ShellNavIcon({ name }: { name: string }) {
  if (name === "classroom") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="m3.5 8.5 8.5-4 8.5 4-8.5 4-8.5-4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M6.5 10.3v5.1c0 1.2 2.5 2.6 5.5 2.6s5.5-1.4 5.5-2.6v-5.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "notice") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="M4 13.3h3.5l8.2 4.7V6L7.5 10.7H4v2.6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M18.5 9.3a4 4 0 0 1 0 5.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "files") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="M4.5 7.5h6l1.8 2h7.2v8.8c0 .9-.6 1.5-1.5 1.5H6c-.9 0-1.5-.6-1.5-1.5V7.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M4.5 7.5V5.7c0-.9.6-1.5 1.5-1.5h4.3l1.7 1.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "tasks") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="M8.5 5.5h7M8.5 12h7M8.5 18.5h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="m4 5.5.8.8L6.6 4.5M4 12l.8.8 1.8-1.8M4 18.5l.8.8 1.8-1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "chat") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="M5 6.8c0-1.1.8-1.9 1.9-1.9h10.2c1.1 0 1.9.8 1.9 1.9v6.6c0 1.1-.8 1.9-1.9 1.9H11l-4.4 3.2v-3.2A1.8 1.8 0 0 1 5 13.4V6.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "grades") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="M5 19V9M12 19V5M19 19v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M4 19.5h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (name === "calendar") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="M5 6.5h14v12H5v-12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8 4.5v4M16 4.5v4M5 10h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="m8.2 14 2 2 4.2-4.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "logout") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="M10.5 5H6.8c-1 0-1.8.8-1.8 1.8v10.4c0 1 .8 1.8 1.8 1.8h3.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M14 8.2 17.8 12 14 15.8M8.8 12h8.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "settings") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M19.2 13.2v-2.4l-2-.5a6.5 6.5 0 0 0-.8-1.9l1.1-1.8-1.7-1.7-1.8 1.1a6.5 6.5 0 0 0-2-.8l-.4-2H9.2l-.5 2a6.5 6.5 0 0 0-1.9.8L5 4.9 3.3 6.6l1.1 1.8a6.5 6.5 0 0 0-.8 1.9l-2 .5v2.4l2 .5c.2.7.5 1.3.8 1.9l-1.1 1.8L5 19.1l1.8-1.1c.6.4 1.2.6 1.9.8l.5 2h2.4l.4-2c.7-.2 1.4-.5 2-.8l1.8 1.1 1.7-1.7-1.1-1.8c.4-.6.6-1.2.8-1.9l2-.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="M12 12.2a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.8 20c.9-3.7 3.5-5.6 7.2-5.6s6.3 1.9 7.2 5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function AppTopBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const profileMenuId = "topbar-profile-menu";
  const mobileDrawerId = "app-mobile-nav-drawer";

  function closeDrawer(restoreFocus = true) {
    setDrawerOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => drawerTriggerRef.current?.focus());
    }
  }

  useEffect(() => {
    setMenuOpen(false);
    setDrawerOpen(false);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!drawerOpen) return;

    document.body.classList.add("mobile-nav-lock");
    drawerCloseRef.current?.focus({ preventScroll: true });

    const getFocusableElements = () => {
      if (!drawerRef.current) return [];
      return Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          [
            "button:not([disabled])",
            "a[href]",
            "input:not([disabled])",
            "select:not([disabled])",
            "textarea:not([disabled])",
            "[tabindex]:not([tabindex='-1'])"
          ].join(",")
        )
      ).filter((element) => !element.hasAttribute("aria-hidden"));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (!drawerRef.current?.contains(activeElement)) {
        event.preventDefault();
        firstElement.focus();
        return;
      }

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("mobile-nav-lock");
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 981px)");
    const closeDrawerOnDesktop = () => {
      if (desktopQuery.matches) {
        setDrawerOpen(false);
      }
    };

    closeDrawerOnDesktop();
    desktopQuery.addEventListener("change", closeDrawerOnDesktop);
    return () => {
      desktopQuery.removeEventListener("change", closeDrawerOnDesktop);
    };
  }, []);

  if (!user) return null;

  async function onLogout() {
    setMenuOpen(false);
    try {
      await logout();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  const userRole = user.role;
  const roleLabel = userRole === "teacher" ? "선생님" : "학생";
  const userInitial = user.displayName.trim().charAt(0).toUpperCase() || "U";
  const routeSearchParams = new URLSearchParams(location.search);
  const classroomId = getClassroomId(location.pathname);
  const classroomReportId = getClassroomReportId(location.pathname);
  const examStudioContext = getExamStudioContext(location.pathname);
  const isExamStudioRoute = examStudioRoutePattern.test(location.pathname);
  const isLearningSessionRoute = learningSessionRoutePattern.test(location.pathname);
  const sessionClassroomId = isLearningSessionRoute
    ? getSafeQueryPathSegment(routeSearchParams.get("classroomId"))
    : "";
  const sessionWeekId = isLearningSessionRoute
    ? getSafeQueryPathSegment(routeSearchParams.get("week"))
    : "";
  const isContextualLearningSession = Boolean(isLearningSessionRoute && sessionClassroomId);
  const classroomContextId =
    classroomId || classroomReportId || sessionClassroomId || examStudioContext?.classroomId || "";
  const classroomSections = userRole === "teacher"
    ? TEACHER_CLASSROOM_SECTIONS
    : STUDENT_CLASSROOM_SECTIONS;
  const activeReportSection = getActiveReportSection(routeSearchParams.get("reportSection"));
  const activeClassroomSection = isExamStudioRoute || isContextualLearningSession
    ? "weeks"
    : getActiveClassroomSection(routeSearchParams.get("section"), userRole);

  function getClassroomSectionPath(section: ClassroomSubSectionId) {
    const targetClassroomId = classroomId || sessionClassroomId;
    if (!targetClassroomId) return "";
    const next = new URLSearchParams();
    next.set("section", section);
    const activeWeekId = sessionWeekId || examStudioContext?.weekId || "";
    if (section === "weeks" && activeWeekId) {
      next.set("week", activeWeekId);
    }
    return `/classrooms/${encodeURIComponent(targetClassroomId)}?${next.toString()}`;
  }

  function getClassroomHomePath() {
    if (!classroomContextId) return "/";

    if (isContextualLearningSession || examStudioContext) {
      return getClassroomSectionPath("weeks") || "/";
    }

    const next = new URLSearchParams();
    next.set("section", getDefaultClassroomSection(userRole));
    return `/classrooms/${encodeURIComponent(classroomContextId)}?${next.toString()}`;
  }

  function navigateClassroomSection(section: ClassroomSubSectionId) {
    const nextPath = getClassroomSectionPath(section);
    if (!nextPath) return;
    navigate(nextPath);
  }

  function navigateReportSection(section: ReportSubSectionId) {
    if (!classroomReportId) return;
    const next = new URLSearchParams(location.search);
    next.set("reportSection", section);
    navigate(`/classrooms/${classroomReportId}/report?${next.toString()}`);
  }

  const navEntries: ShellNavEntry[] = SHELL_NAV_ITEMS.map((item) => {
    const itemPath =
      item.id === "classroom"
        ? getClassroomHomePath()
        : item.id === "notice" && classroomContextId
          ? `/classrooms/${encodeURIComponent(classroomContextId)}?section=notices`
        : item.id === "files" && classroomContextId
          ? `/classrooms/${encodeURIComponent(classroomContextId)}?section=files`
        : item.id === "tasks" && classroomContextId
          ? `/classrooms/${encodeURIComponent(classroomContextId)}?section=tasks`
        : item.id === "chat" && classroomContextId
          ? `/classrooms/${encodeURIComponent(classroomContextId)}?section=discussion`
        : item.id === "calendar" && classroomContextId
          ? `/classrooms/${encodeURIComponent(classroomContextId)}?section=attendance`
        : item.id === "grades" && classroomContextId
          ? `/classrooms/${encodeURIComponent(classroomContextId)}/report`
          : item.path;
    const active =
      item.id === "notice"
        ? Boolean(classroomId && activeClassroomSection === "notices")
        : item.id === "files"
          ? Boolean(classroomId && activeClassroomSection === "files")
        : item.id === "tasks"
          ? Boolean(classroomId && activeClassroomSection === "tasks") ||
            Boolean(item.match?.(location.pathname))
        : item.id === "calendar"
          ? Boolean(classroomId && activeClassroomSection === "attendance")
        : item.id === "chat"
          ? Boolean(classroomId && activeClassroomSection === "discussion")
        : item.id === "classroom"
          ? (isContextualLearningSession || Boolean(item.match?.(location.pathname))) &&
            activeClassroomSection !== "notices" &&
            activeClassroomSection !== "files" &&
            activeClassroomSection !== "tasks" &&
            activeClassroomSection !== "discussion" &&
            activeClassroomSection !== "attendance"
          : item.match?.(location.pathname) ?? false;
    const showClassroomSections =
      item.id === "classroom" &&
      Boolean(classroomContextId) &&
      !classroomReportRoutePattern.test(location.pathname) &&
      !isExamStudioRoute;
    const showReportSections =
      item.id === "grades" && Boolean(classroomReportId) && userRole === "teacher";
    return {
      item,
      itemPath,
      active,
      disabled: !itemPath,
      showClassroomSections,
      showReportSections
    };
  });
  const mobileTitle = navEntries.find((entry) => entry.active)?.item.label ?? "EduPilot";

  function navigateFromDrawer(path?: string) {
    if (!path) return;
    setDrawerOpen(false);
    navigate(path);
  }

  function navigateClassroomSectionFromDrawer(section: ClassroomSubSectionId) {
    setDrawerOpen(false);
    navigateClassroomSection(section);
  }

  function navigateReportSectionFromDrawer(section: ReportSubSectionId) {
    setDrawerOpen(false);
    navigateReportSection(section);
  }

  return (
    <header className="app-topbar" data-testid="app-shell-nav">
      <div className="topbar-shell-head">
        <button className="topbar-brand" data-testid="app-brand" onClick={() => navigate("/")}>
          <span className="topbar-brand-mark" aria-hidden="true" />
          <span>EduPilot</span>
        </button>
      </div>

      <div className="mobile-topbar" data-testid="mobile-topbar">
        <button
          ref={drawerTriggerRef}
          type="button"
          className="mobile-nav-open"
          data-testid="mobile-nav-open"
          aria-label="메뉴 열기"
          aria-controls={mobileDrawerId}
          aria-expanded={drawerOpen}
          onClick={() => {
            setMenuOpen(false);
            setDrawerOpen(true);
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <span className="mobile-topbar-title" data-testid="mobile-topbar-title">{mobileTitle}</span>
        <span aria-hidden="true" />
      </div>

      <nav className="topbar-nav" aria-label="주요 메뉴">
        {navEntries.map(({ item, itemPath, active, disabled, showClassroomSections, showReportSections }) => {
          return (
            <div
              key={item.id}
              className={`topbar-nav-group${showClassroomSections || showReportSections ? " expanded" : ""}`}
            >
              <button
                type="button"
                className={`topbar-nav-item${active ? " active" : ""}`}
                data-testid={`topbar-nav-${item.id}`}
                aria-current={active ? "page" : undefined}
                aria-disabled={disabled ? true : undefined}
                onClick={() => {
                  if (itemPath) {
                    navigate(itemPath);
                  }
                }}
              >
                <span className="topbar-nav-icon">
                  <ShellNavIcon name={item.icon} />
                </span>
                <span className="topbar-nav-text">
                  <span>{item.label}</span>
                  <small>{item.description}</small>
                </span>
              </button>
              {showClassroomSections ? (
                <div
                  className="topbar-subnav classroom-section-nav"
                  data-testid="classroom-section-nav"
                  aria-label="강의실 메뉴"
                >
                  {classroomSections.map((section) => {
                    const meta = CLASSROOM_SECTION_ITEMS[section];
                    const activeSection = activeClassroomSection === section;
                    return (
                      <button
                        key={section}
                        type="button"
                        className={`topbar-subnav-item classroom-section-nav-btn${activeSection ? " active" : ""}`}
                        data-testid={`classroom-nav-${section}`}
                        aria-current={activeSection ? "page" : undefined}
                        onClick={() => navigateClassroomSection(section)}
                      >
                        <span>{meta.label}</span>
                        <small>{meta.description}</small>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {showReportSections ? (
                <div
                  className="topbar-subnav report-section-nav"
                  data-testid="report-section-nav"
                  aria-label="성적 리포트 메뉴"
                >
                  {REPORT_SECTIONS.map((section) => {
                    const meta = REPORT_SECTION_ITEMS[section];
                    const activeSection = activeReportSection === section;
                    return (
                      <button
                        key={section}
                        type="button"
                        className={`topbar-subnav-item report-section-nav-btn${activeSection ? " active" : ""}`}
                        data-testid={`report-nav-${section}`}
                        aria-current={activeSection ? "page" : undefined}
                        onClick={() => navigateReportSection(section)}
                      >
                        <span>{meta.label}</span>
                        <small>{meta.description}</small>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="topbar-user" ref={profileRef}>
        <button
          ref={triggerRef}
          type="button"
          className="profile-disclosure"
          data-testid="profile-disclosure"
          aria-label="회원 메뉴"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? profileMenuId : undefined}
          onClick={() => {
            setDrawerOpen(false);
            setMenuOpen((open) => !open);
          }}
        >
          <span className="profile-avatar" aria-hidden="true">{userInitial}</span>
          <span className="topbar-user-copy">
            <span className="topbar-display-name">{user.displayName}</span>
            <span className="topbar-role">{roleLabel}</span>
            {user.role === "student" ? (
              <span className="topbar-invite">#{user.inviteCode}</span>
            ) : null}
          </span>
          <span className="profile-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="m7.5 9.5 4.5 4.5 4.5-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
        {menuOpen ? (
          <div
            id={profileMenuId}
            className="profile-menu card"
            data-testid="profile-popover"
            aria-label="회원 메뉴"
          >
            <div className="profile-menu-content">
              <button
                type="button"
                className="profile-menu-item"
                data-testid="profile-account-action"
                onClick={() => {
                  setMenuOpen(false);
                  navigate("/account");
                }}
              >
                <span className="profile-menu-icon">
                  <ShellNavIcon name="account" />
                </span>
                <span>회원 정보 수정</span>
              </button>
              <span
                className="profile-menu-divider"
                data-testid="profile-menu-divider"
                role="separator"
                aria-hidden="true"
              />
              <button
                type="button"
                className="profile-menu-item danger"
                data-testid="profile-logout-action"
                onClick={onLogout}
              >
                <span className="profile-menu-icon">
                  <ShellNavIcon name="logout" />
                </span>
                <span>로그아웃</span>
              </button>
            </div>
            <span
              className="profile-menu-arrow"
              data-testid="profile-menu-arrow"
              aria-hidden="true"
            />
          </div>
        ) : null}
      </div>

      {drawerOpen ? (
        <div className="mobile-nav-layer" data-testid="mobile-nav-layer">
          <button
            type="button"
            className="mobile-nav-backdrop"
            data-testid="mobile-nav-backdrop"
            aria-label="메뉴 닫기"
            onClick={() => closeDrawer()}
          />
          <aside
            ref={drawerRef}
            id={mobileDrawerId}
            className="mobile-nav-drawer"
            data-testid="mobile-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="모바일 메뉴"
          >
            <div className="mobile-nav-drawer-head">
              <button
                type="button"
                className="topbar-brand mobile-nav-brand"
                data-testid="mobile-nav-brand"
                onClick={() => navigateFromDrawer("/")}
              >
                <span className="topbar-brand-mark" aria-hidden="true" />
                <span>EduPilot</span>
              </button>
              <button
                ref={drawerCloseRef}
                type="button"
                className="mobile-nav-close"
                data-testid="mobile-nav-close"
                aria-label="메뉴 닫기"
                onClick={() => closeDrawer()}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                  <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <nav className="mobile-nav-list" aria-label="주요 메뉴">
              {navEntries.map(({ item, itemPath, active, disabled, showClassroomSections, showReportSections }) => (
                <div
                  key={item.id}
                  className={`mobile-nav-group${showClassroomSections || showReportSections ? " expanded" : ""}`}
                >
                  <button
                    type="button"
                    className={`mobile-nav-item${active ? " active" : ""}`}
                    data-testid={`mobile-nav-${item.id}`}
                    aria-current={active ? "page" : undefined}
                    aria-disabled={disabled ? true : undefined}
                    onClick={() => navigateFromDrawer(itemPath)}
                  >
                    <span className="mobile-nav-icon">
                      <ShellNavIcon name={item.icon} />
                    </span>
                    <span>{item.label}</span>
                  </button>
                  {showClassroomSections ? (
                    <div
                      className="mobile-nav-subnav mobile-classroom-section-nav"
                      data-testid="mobile-classroom-section-nav"
                      aria-label="강의실 메뉴"
                    >
                      {classroomSections.map((section) => {
                        const meta = CLASSROOM_SECTION_ITEMS[section];
                        const activeSection = activeClassroomSection === section;
                        return (
                          <button
                            key={section}
                            type="button"
                            className={`mobile-nav-subitem${activeSection ? " active" : ""}`}
                            data-testid={`mobile-classroom-nav-${section}`}
                            aria-current={activeSection ? "page" : undefined}
                            onClick={() => navigateClassroomSectionFromDrawer(section)}
                          >
                            <span>{meta.label}</span>
                            <small>{meta.description}</small>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {showReportSections ? (
                    <div
                      className="mobile-nav-subnav mobile-report-section-nav"
                      data-testid="mobile-report-section-nav"
                      aria-label="성적 리포트 메뉴"
                    >
                      {REPORT_SECTIONS.map((section) => {
                        const meta = REPORT_SECTION_ITEMS[section];
                        const activeSection = activeReportSection === section;
                        return (
                          <button
                            key={section}
                            type="button"
                            className={`mobile-nav-subitem${activeSection ? " active" : ""}`}
                            data-testid={`mobile-report-nav-${section}`}
                            aria-current={activeSection ? "page" : undefined}
                            onClick={() => navigateReportSectionFromDrawer(section)}
                          >
                            <span>{meta.label}</span>
                            <small>{meta.description}</small>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
            </nav>
            <div className="mobile-nav-footer">
              <button
                type="button"
                className="mobile-nav-settings"
                data-testid="mobile-nav-settings"
                onClick={() => navigateFromDrawer("/account")}
              >
                <span className="mobile-nav-icon">
                  <ShellNavIcon name="settings" />
                </span>
                <span>설정</span>
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </header>
  );
}
