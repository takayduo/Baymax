// Creator Couple Daily Schedule View — styled to match Coucou's cards.
import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, type ScheduleItem } from "../core/bridge";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import type { ViewActions, ViewHost } from "./views";

function getScheduleRoleInfo() {
  const isMe = (State.settings.userRole || "me") === "me";
  const currentUserRole: "me" | "her" = isMe ? "me" : "her";
  const partnerRole: "me" | "her" = isMe ? "her" : "me";
  const rawMe = isMe ? (State.settings.userName || "You") : (State.settings.partnerName || "Partner");
  const rawPartner = isMe ? (State.settings.partnerName || "Partner") : (State.settings.userName || "You");
  const currentUserName = (rawMe.charAt(0).toUpperCase() + rawMe.slice(1)) || "Me";
  const partnerUserName = (rawPartner.charAt(0).toUpperCase() + rawPartner.slice(1)) || "Partner";
  const currentUserIcon = isMe ? "👤" : "💖";
  const partnerIcon = isMe ? "💖" : "👤";
  return {
    isMe,
    currentUserRole,
    partnerRole,
    currentUserName,
    partnerUserName,
    currentUserIcon,
    partnerIcon,
  };
}

export function buildSchedule(actions: ViewActions): ViewHost {
  const info0 = getScheduleRoleInfo();
  // Active user's tab is ALWAYS first, partner's tab is ALWAYS second
  const toggleUser = h("button", { class: "sched-toggle active", text: `${info0.currentUserName} ${info0.currentUserIcon}` });
  const togglePartner = h("button", { class: "sched-toggle", text: `${info0.partnerUserName} ${info0.partnerIcon}` });
  const toggleBar = h("div", { class: "sched-toggles" }, toggleUser, togglePartner);

  const headerTitle = h("div", { class: "sched-title", text: "Tasks" });
  const presenceBadge = h("span", {
    class: "sched-presence-badge",
    style: "font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:10px;margin-left:auto;margin-right:10px;background:rgba(34,197,94,0.15);color:#22c55e;display:none;align-items:center;gap:4px;",
    text: "🟢 Online",
  });
  const topRow = h("div", { class: "sched-header-row" }, headerTitle, presenceBadge, toggleBar);

  const listEl = h("div", { class: "sched-list" });

  const inputTitle = h("input", {
    type: "text",
    class: "sched-input",
    placeholder: "What needs to get done?", "aria-label": "Task title",
  }) as HTMLInputElement;

  const inputTime = h("input", {
    type: "text",
    class: "sched-time-input",
    placeholder: "Time",
    title: "Time (optional)",
    "aria-label": "Task time",
    value: "",
  }) as HTMLInputElement;

  const addBtn = h("button", { class: "sched-add-btn", title: "Add Task" }, svg(ICONS.plus, 12));

  const addRow = h("div", { class: "sched-add-row" }, inputTitle, inputTime, addBtn);

  const errorStatus = h("div", { class: "chat-error", role: "alert", hidden: true });
  const cardBody = h("div", { class: "sched-body" }, topRow, listEl, errorStatus, addRow);
  let busy = false;
  function setBusy(value: boolean) {
    busy = value;
    addBtn.disabled = value;
    inputTitle.disabled = value;
    inputTime.disabled = value;
    listEl.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.disabled = value);
  }
  function showError(error: unknown) {
    errorStatus.textContent = `Could not save this change. ${error instanceof Error ? error.message : error}`;
    errorStatus.hidden = false;
  }
  const el = h("div", { class: "view schedule-view" }, h("div", { class: "card wash" }, cardBody));
  (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", "rgba(244, 80, 94, 0.28)");

  let lastUserRole = State.settings.userRole || "me";
  let currentFilter: "me" | "her" = State.scheduleFilter || info0.currentUserRole;

  function updateToggles() {
    const info = getScheduleRoleInfo();
    toggleUser.textContent = `${info.currentUserName} ${info.currentUserIcon}`;
    togglePartner.textContent = `${info.partnerUserName} ${info.partnerIcon}`;
    toggleUser.classList.toggle("active", currentFilter === info.currentUserRole);
    togglePartner.classList.toggle("active", currentFilter === info.partnerRole);

    if (currentFilter === info.currentUserRole) {
      inputTitle.placeholder = "Add a task for yourself…";
    } else {
      inputTitle.placeholder = `Add a task for ${info.partnerUserName}…`;
    }
  }

  function setFilter(filter: "me" | "her") {
    currentFilter = filter;
    State.scheduleFilter = filter;
    updateToggles();
    Sound.play("blip");
    renderList();
  }

  toggleUser.addEventListener("click", () => {
    const info = getScheduleRoleInfo();
    setFilter(info.currentUserRole);
  });
  togglePartner.addEventListener("click", () => {
    const info = getScheduleRoleInfo();
    setFilter(info.partnerRole);
  });

  async function addTask() {
    const title = inputTitle.value.trim();
    if (!title || busy) return;
    const newItem: ScheduleItem = {
      id: crypto.randomUUID(), title, time: inputTime.value.trim(), assignee: currentFilter,
      assignedBy: getScheduleRoleInfo().currentUserRole, completed: false, createdAt: Date.now(),
    };
    setBusy(true); errorStatus.hidden = true;
    try {
      const updated = await Bridge.saveScheduleItem(newItem);
      State.schedule = updated;
      inputTitle.value = "";
      Sound.play("pop");
      State.notify(); renderList();
    } catch (error) { showError(error); }
    finally { setBusy(false); inputTitle.focus(); }
  }
  addBtn.addEventListener("click", () => void addTask());
  inputTitle.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void addTask(); }
  });
  async function toggleDone(task: ScheduleItem) {
    if (busy) return;
    setBusy(true); errorStatus.hidden = true;
    try {
      State.schedule = await Bridge.toggleScheduleItem(task.id);
      Sound.play("blip"); State.notify(); renderList();
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }
  async function deleteTask(id: string) {
    if (busy) return;
    setBusy(true); errorStatus.hidden = true;
    try {
      State.schedule = await Bridge.deleteScheduleItem(id);
      Sound.play("blip"); State.notify(); renderList();
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }

  function renderList() {
    clear(listEl);
    const info = getScheduleRoleInfo();
    const items = State.schedule.filter((s) => s.assignee === currentFilter);

    if (items.length === 0) {
      const empty = h(
        "div",
        { class: "sched-empty" },
        h("span", {
          text: currentFilter === info.currentUserRole
            ? "Your list is clear. Add something you want to do."
            : `No shared tasks for ${info.partnerUserName} yet.`,
        })
      );
      listEl.append(empty);
      return;
    }

    for (const item of items) {
      const checkBtn = h(
        "button",
        { class: item.completed ? "sched-check checked" : "sched-check", disabled: busy, "aria-label": `${item.completed ? "Mark incomplete" : "Complete"}: ${item.title}`, "aria-pressed": String(item.completed) },
        item.completed ? svg(ICONS.check, 10, { stroke: 3 }) : null
      );
      checkBtn.addEventListener("click", () => void toggleDone(item));

      const timeEl = h("span", { class: "sched-item-time", text: item.time });
      const titleEl = h("span", { class: "sched-item-title", text: item.title });

      // Task attribution badge:
      // If task was added by the person currently looking at this PC, show "By You ✨"
      // If task was added by the partner, show "By <PartnerName> <Icon>"
      const assignedLabel =
        item.assignedBy && item.assignedBy !== item.assignee
          ? h("span", {
              class: "sched-item-badge",
              text: item.assignedBy === info.currentUserRole ? "By You ✨" : `By ${info.partnerUserName} ${info.partnerIcon}`,
            })
          : null;

      const delBtn = h(
        "button",
        { class: "sched-del-btn", title: "Delete", disabled: busy, "aria-label": `Delete ${item.title}` },
        svg(ICONS.xmark, 8)
      );
      delBtn.addEventListener("click", () => void deleteTask(item.id));

      const row = h(
        "div",
        { class: item.completed ? "sched-item done" : "sched-item" },
        checkBtn,
        timeEl,
        titleEl,
        assignedLabel,
        delBtn
      );
      listEl.append(row);
    }
  }

  return {
    el,
    sync() {
      const info = getScheduleRoleInfo();

      // If user profile switched in settings, prioritize the newly active user!
      const currentRole = State.settings.userRole || "me";
      if (lastUserRole !== currentRole) {
        lastUserRole = currentRole;
        currentFilter = info.currentUserRole;
        State.scheduleFilter = currentFilter;
      }

      updateToggles();

      if (State.partnerOnline) {
        presenceBadge.style.display = "inline-flex";
        presenceBadge.textContent = `🟢 ${info.partnerUserName} Online`;
        togglePartner.title = `${info.partnerUserName} is currently online!`;
      } else {
        presenceBadge.style.display = "none";
        togglePartner.title = `${info.partnerUserName} is offline`;
      }

      renderList();
    },
    focus() {
      inputTitle.focus();
    },
  };
}
