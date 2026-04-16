const state = {
    events: [],
    displayedMonth: getMonthString(new Date()),
    selectedDate: getDateString(new Date()),
    editingEventId: null,
    interrogationScheduleDraft: {},
    classRoster: [],
    permissions: [],
    canEditEvents: false,
    canDeleteEvents: false,
    countdownRefreshTimeoutId: null,
    randomPicker: {
        intervalId: null,
        timeoutId: null,
        targetDate: "",
        targetDates: [],
        candidates: [],
    },
};

const elements = {
    form: document.querySelector("#event-form"),
    feedback: document.querySelector("#form-feedback"),
    calendarGrid: document.querySelector("#calendar-grid"),
    eventsList: document.querySelector("#events-list"),
    currentMonthLabel: document.querySelector("#current-month-label"),
    selectedDateLabel: document.querySelector("#selected-date-label"),
    previousMonthButton: document.querySelector("#prev-month"),
    nextMonthButton: document.querySelector("#next-month"),
    heroVerifiche: document.querySelector("#stat-verifiche"),
    heroInterrogazioni: document.querySelector("#stat-interrogazioni"),
    heroEventi: document.querySelector("#stat-eventi"),
    formTitle: document.querySelector("#form-title"),
    formSubtitle: document.querySelector("#form-subtitle"),
    submitButton: document.querySelector("#submit-button"),
    cancelEditButton: document.querySelector("#cancel-edit"),
    openFormModalButton: document.querySelector("#open-form-modal"),
    closeFormModalButton: document.querySelector("#close-form-modal"),
    formModal: document.querySelector("#form-modal"),
    modalBackdrop: document.querySelector("#modal-backdrop"),
    randomPickerModal: document.querySelector("#random-picker-modal"),
    randomPickerBackdrop: document.querySelector("#random-picker-backdrop"),
    randomPickerCloseButton: document.querySelector("#random-picker-close"),
    randomPickerDate: document.querySelector("#random-picker-date"),
    randomPickerName: document.querySelector("#random-picker-name"),
    randomPickerStatus: document.querySelector("#random-picker-status"),
    readOnlyEventModal: document.querySelector("#readonly-event-modal"),
    readOnlyEventBackdrop: document.querySelector("#readonly-event-backdrop"),
    readOnlyEventCloseButton: document.querySelector("#readonly-event-close"),
    readOnlyEventTitle: document.querySelector("#readonly-event-title"),
    readOnlyEventSubtitle: document.querySelector("#readonly-event-subtitle"),
    readOnlyEventNotes: document.querySelector("#readonly-event-notes"),
    readOnlyEventSchedule: document.querySelector("#readonly-event-schedule"),
    subjectTextField: document.querySelector("#subject-text-field"),
    subjectInput: document.querySelector("#subject-input"),
    eventSubjectField: document.querySelector("#event-subject-field"),
    eventSubjectSelect: document.querySelector("#event-subject-select"),
    scheduledForField: document.querySelector("#scheduled-for-field"),
    scheduledForLabel: document.querySelector("#scheduled-for-label"),
    interrogationFields: document.querySelector("#interrogation-fields"),
    interrogationEndField: document.querySelector("#interrogation-end-field"),
    interrogationDatesField: document.querySelector("#interrogation-dates-field"),
    interrogationScheduleBuilder: document.querySelector("#interrogation-schedule-builder"),
    notesField: document.querySelector("#notes-field"),
    notesLabel: document.querySelector("#notes-label"),
    notesInput: document.querySelector("#notes-input"),
    classRosterData: document.querySelector("#class-roster-data"),
    permissionsData: document.querySelector("#permissions-data"),
    countdownWeekdays: document.querySelector("#countdown-weekdays"),
    countdownHours: document.querySelector("#countdown-hours"),
    countdownTargetLabel: document.querySelector("#countdown-target-label"),
    countdownSettingsForm: document.querySelector("#countdown-settings-form"),
    countdownTargetInput: document.querySelector("#countdown-target-input"),
};

document.addEventListener("DOMContentLoaded", () => {
    state.classRoster = parseClassRoster();
    state.permissions = parsePermissions();
    state.canEditEvents = state.permissions.includes("edit_events");
    state.canDeleteEvents = state.permissions.includes("delete_events");
    elements.form.event_type.value = "verifica";
    elements.form.interrogation_mode.value = "period";
    elements.form.scheduled_for.value = state.selectedDate;
    updateSelectedDateLabel();
    bindEvents();
    closeFormModal({ resetState: false });
    updateInterrogationFields();
    loadCountdown();
    loadEvents();
});

function bindEvents() {
    elements.form.addEventListener("submit", handleCreateEvent);
    elements.cancelEditButton.addEventListener("click", () => closeFormModal());
    if (elements.openFormModalButton) {
        elements.openFormModalButton.addEventListener("click", () => {
            resetForm({ selectedDate: state.selectedDate, feedback: "" });
            openFormModal();
        });
    }
    elements.closeFormModalButton.addEventListener("click", () => closeFormModal());
    elements.modalBackdrop.addEventListener("click", () => closeFormModal());
    elements.randomPickerCloseButton.addEventListener("click", () => closeRandomPickerModal());
    elements.randomPickerBackdrop.addEventListener("click", () => closeRandomPickerModal());
    if (elements.readOnlyEventCloseButton) {
        elements.readOnlyEventCloseButton.addEventListener("click", () => closeReadOnlyEventModal());
    }
    if (elements.readOnlyEventBackdrop) {
        elements.readOnlyEventBackdrop.addEventListener("click", () => closeReadOnlyEventModal());
    }
    elements.form.scheduled_for.addEventListener("change", (event) => {
        const previousMonth = state.displayedMonth;
        selectDate(event.target.value);
        if (state.displayedMonth !== previousMonth) {
            loadEvents();
            return;
        }
        renderInterrogationScheduleBuilder();
        renderCalendar();
    });
    elements.form.event_type.addEventListener("change", () => updateInterrogationFields());
    elements.eventSubjectSelect.addEventListener("change", () => syncSubjectField());
    elements.eventSubjectSelect.addEventListener("change", () => updateInterrogationFields());
    elements.form.interrogation_mode.addEventListener("change", () => updateInterrogationFields());
    elements.form.interrogation_end.addEventListener("change", () => renderInterrogationScheduleBuilder());
    elements.form.interrogation_dates.addEventListener("input", () => renderInterrogationScheduleBuilder());
    elements.previousMonthButton.addEventListener("click", () => changeMonth(-1));
    elements.nextMonthButton.addEventListener("click", () => changeMonth(1));
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !elements.randomPickerModal.hidden) {
            closeRandomPickerModal();
        } else if (event.key === "Escape" && elements.readOnlyEventModal && !elements.readOnlyEventModal.hidden) {
            closeReadOnlyEventModal();
        } else if (event.key === "Escape" && !elements.formModal.hidden) {
            closeFormModal();
        }
    });

    if (elements.countdownSettingsForm) {
        elements.countdownSettingsForm.addEventListener("submit", handleUpdateCountdownTarget);
    }
}

async function loadCountdown() {
    if (!elements.countdownWeekdays || !elements.countdownHours || !elements.countdownTargetLabel) {
        return;
    }

    if (state.countdownRefreshTimeoutId !== null) {
        clearTimeout(state.countdownRefreshTimeoutId);
        state.countdownRefreshTimeoutId = null;
    }

    const response = await fetch("/api/countdown");
    if (!response.ok) {
        elements.countdownTargetLabel.textContent = "Impossibile caricare il conto alla rovescia.";
        scheduleCountdownRefresh();
        return;
    }

    const payload = await response.json();
    renderCountdown(payload);
    scheduleCountdownRefresh();
}

function getCountdownRefreshDelayMs() {
    const now = new Date();
    const nextRefresh = new Date(now);
    nextRefresh.setHours(14, 0, 0, 0);

    if (now >= nextRefresh) {
        nextRefresh.setDate(nextRefresh.getDate() + 1);
    }

    return nextRefresh.getTime() - now.getTime();
}

function scheduleCountdownRefresh() {
    if (state.countdownRefreshTimeoutId !== null) {
        clearTimeout(state.countdownRefreshTimeoutId);
        state.countdownRefreshTimeoutId = null;
    }

    const delayMs = getCountdownRefreshDelayMs();
    state.countdownRefreshTimeoutId = window.setTimeout(loadCountdown, delayMs);
}

function renderCountdown(payload) {
    const weekdaysRemaining = Number(payload.weekdays_remaining || 0);
    const schoolHoursRemaining = Number(payload.school_hours_remaining || 0);
    const targetDate = payload.target_date || "";

    elements.countdownWeekdays.textContent = String(weekdaysRemaining);
    elements.countdownHours.textContent = String(schoolHoursRemaining);

    if (targetDate) {
        elements.countdownTargetLabel.textContent = `Data target: ${formatLongDate(targetDate)}`;
        if (elements.countdownTargetInput) {
            elements.countdownTargetInput.value = targetDate;
        }
    } else {
        elements.countdownTargetLabel.textContent = "Data target non impostata.";
        if (elements.countdownTargetInput) {
            elements.countdownTargetInput.value = "";
        }
    }
}

async function handleUpdateCountdownTarget(event) {
    event.preventDefault();
    const targetDate = elements.countdownTargetInput?.value;
    if (!targetDate) {
        elements.countdownTargetLabel.textContent = "Inserisci una data valida.";
        return;
    }

    const response = await fetch("/api/countdown", {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ target_date: targetDate }),
    });

    if (!response.ok) {
        elements.countdownTargetLabel.textContent = "Impossibile aggiornare la data target.";
        return;
    }

    const payload = await response.json();
    renderCountdown(payload);
}

async function loadEvents() {
    const params = new URLSearchParams({ month: state.displayedMonth });
    const response = await fetch(`/api/events?${params.toString()}`);
    state.events = await response.json();
    renderMonthLabel();
    renderCalendar();
    renderEventList();
    renderSummary();
}

async function handleCreateEvent(event) {
    event.preventDefault();
    syncSubjectField();
    const formData = new FormData(elements.form);
    const payload = Object.fromEntries(formData.entries());
    const isEditing = state.editingEventId !== null;

    elements.feedback.textContent = isEditing ? "Salvataggio modifiche in corso..." : "Salvataggio in corso...";

    const url = isEditing ? `/api/events/${state.editingEventId}` : "/api/events";
    const method = isEditing ? "PATCH" : "POST";

    const response = await fetch(url, {
        method,
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const data = await response.json();
        const fallbackMessage = isEditing ? "Impossibile modificare l'impegno." : "Impossibile aggiungere l'impegno.";
        const message = Object.values(data.errors || {}).join(" ") || fallbackMessage;
        elements.feedback.textContent = message;
        return;
    }

    const savedEvent = await response.json();
    resetForm({
        selectedDate: savedEvent.scheduled_for,
        feedback: isEditing ? "Impegno modificato correttamente." : "Impegno aggiunto correttamente.",
    });
    closeFormModal({ keepFeedback: true });

    const savedMonth = savedEvent.scheduled_for.slice(0, 7);
    if (savedMonth !== state.displayedMonth) {
        state.displayedMonth = savedMonth;
    }

    await loadEvents();
}

async function deleteEvent(eventId) {
    const shouldDelete = window.confirm("Vuoi davvero eliminare questa verifica?");
    if (!shouldDelete) {
        return;
    }

    const response = await fetch(`/api/events/${eventId}`, {
        method: "DELETE",
    });

    if (response.ok) {
        await loadEvents();
    }
}

function renderMonthLabel() {
    const [year, month] = state.displayedMonth.split("-").map(Number);
    const currentMonth = new Date(year, month - 1, 1);
    elements.currentMonthLabel.textContent = new Intl.DateTimeFormat("it-IT", {
        month: "long",
        year: "numeric",
    }).format(currentMonth);
}

function renderCalendar() {
    elements.calendarGrid.innerHTML = "";

    const weekdayLabels = ["Lun", "Mar", "Mer", "Gio", "Ven"];
    weekdayLabels.forEach((label) => {
        const heading = document.createElement("div");
        heading.className = "calendar-weekday";
        heading.textContent = label;
        elements.calendarGrid.appendChild(heading);
    });

    const [year, month] = state.displayedMonth.split("-").map(Number);
    const firstDayOfMonth = new Date(year, month - 1, 1);
    const lastDayOfMonth = new Date(year, month, 0);
    const startOffset = (firstDayOfMonth.getDay() + 6) % 7;
    const businessStartOffset = Math.min(startOffset, 5);

    for (let index = 0; index < businessStartOffset; index += 1) {
        const filler = document.createElement("div");
        filler.className = "calendar-day is-empty";
        elements.calendarGrid.appendChild(filler);
    }

    const eventsByDate = groupByDate(expandEventsByDate(state.events));

    for (let day = 1; day <= lastDayOfMonth.getDate(); day += 1) {
        const dateValue = `${state.displayedMonth}-${String(day).padStart(2, "0")}`;
        const currentDate = new Date(`${dateValue}T00:00:00`);
        if (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
            continue;
        }

        const dayCard = document.createElement("article");
        dayCard.className = "calendar-day";
        dayCard.tabIndex = 0;
        dayCard.setAttribute("role", "button");
        dayCard.setAttribute("aria-label", `Seleziona il giorno ${dateValue}`);
        dayCard.addEventListener("click", () => {
            selectDate(dateValue);
            renderCalendar();
        });
        dayCard.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                selectDate(dateValue);
                renderCalendar();
            }
        });

        if (dateValue === state.selectedDate) {
            dayCard.classList.add("is-selected");
        }

        if (dateValue === getDateString(new Date())) {
            dayCard.classList.add("is-today");
        }

        const daySelectButton = document.createElement("button");
        daySelectButton.type = "button";
        daySelectButton.className = "calendar-day-select";
        daySelectButton.addEventListener("click", (event) => {
            event.stopPropagation();
            selectDate(dateValue);
            renderCalendar();
        });

        const dayNumber = document.createElement("span");
        dayNumber.className = "calendar-day-number";
        dayNumber.textContent = String(day);
        daySelectButton.appendChild(dayNumber);
        dayCard.appendChild(daySelectButton);

        const chips = document.createElement("div");
        chips.className = "calendar-chip-list";
        const summary = document.createElement("div");
        summary.className = "calendar-day-summary";

        const items = eventsByDate.get(dateValue) || [];
        items.forEach((eventOccurrence) => {
            const eventItem = eventOccurrence.sourceEvent;
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "calendar-chip";
            chip.classList.add(getEventTypeClassName(eventItem.event_type));
            if (eventItem.id === state.editingEventId) {
                chip.classList.add("is-editing");
            }
            chip.textContent = eventItem.subject;
            chip.title = `Apri ${formatEventTypeLabel(eventItem.event_type).toLowerCase()}: ${eventItem.subject}`;
            chip.addEventListener("click", (event) => {
                event.stopPropagation();
                openReadOnlyEventModal(eventItem, dateValue);
            });
            chips.appendChild(chip);
        });

        if (items.length > 0) {
            const dots = document.createElement("div");
            dots.className = "calendar-day-dots";

            items.slice(0, 3).forEach((eventOccurrence) => {
                const dot = document.createElement("span");
                dot.className = "calendar-day-dot";
                dot.classList.add(getEventTypeClassName(eventOccurrence.sourceEvent.event_type));
                dots.appendChild(dot);
            });

            summary.appendChild(dots);

            const count = document.createElement("span");
            count.className = "calendar-day-count";
            count.textContent = String(items.length);
            summary.appendChild(count);
        }

        dayCard.appendChild(summary);
        dayCard.appendChild(chips);

        elements.calendarGrid.appendChild(dayCard);
    }
}

function renderEventList() {
    elements.eventsList.innerHTML = "";

    if (state.events.length === 0) {
        elements.eventsList.innerHTML = `
            <div class="empty-state compact-empty-state">
                <h3>Nessuna verifica nel mese</h3>
                <p>Aggiungi la prima verifica dal modulo qui accanto.</p>
            </div>
        `;
        return;
    }

    state.events.forEach((event) => {
        const article = document.createElement("article");
        article.className = "simple-event-card";
        article.classList.add(getEventTypeClassName(event.event_type));
        article.tabIndex = 0;
        article.setAttribute("role", "button");
        if (event.id === state.editingEventId) {
            article.classList.add("is-editing");
        }
        if (state.canEditEvents) {
            article.addEventListener("click", () => startEditing(event));
            article.addEventListener("keydown", (keyboardEvent) => {
                if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                    keyboardEvent.preventDefault();
                    startEditing(event);
                }
            });
        } else {
            article.addEventListener("click", () => openReadOnlyEventModal(event));
            article.addEventListener("keydown", (keyboardEvent) => {
                if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                    keyboardEvent.preventDefault();
                    openReadOnlyEventModal(event);
                }
            });
        }

        const heading = document.createElement("div");
        heading.className = "simple-event-heading";

        const title = document.createElement("h3");
        title.textContent = event.subject;
        heading.appendChild(title);

        const date = document.createElement("span");
        date.className = "simple-event-date";
        date.textContent = formatEventSchedule(event);
        heading.appendChild(date);

        article.appendChild(heading);

        const notes = document.createElement("p");
        notes.className = "simple-event-notes";
        notes.textContent = buildEventDescription(event);
        article.appendChild(notes);

        const footer = document.createElement("div");
        footer.className = "simple-event-footer";

        const badge = document.createElement("span");
        badge.className = "simple-event-badge";
        badge.classList.add(getEventTypeClassName(event.event_type));
        badge.textContent = formatEventTypeLabel(event.event_type);
        footer.appendChild(badge);

        if (state.canDeleteEvents) {
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "danger-button";
            deleteButton.textContent = "Elimina";
            deleteButton.addEventListener("click", (clickEvent) => {
                clickEvent.stopPropagation();
                deleteEvent(event.id);
            });
            footer.appendChild(deleteButton);
        }

        article.appendChild(footer);
        elements.eventsList.appendChild(article);
    });
}

function renderSummary() {
    const counts = state.events.reduce(
        (summary, event) => {
            if (event.event_type === "interrogazione") {
                summary.interrogazioni += 1;
            } else if (event.event_type === "evento") {
                summary.eventi += 1;
            } else {
                summary.verifiche += 1;
            }
            return summary;
        },
        { verifiche: 0, interrogazioni: 0, eventi: 0 }
    );

    elements.heroVerifiche.textContent = String(counts.verifiche);
    elements.heroInterrogazioni.textContent = String(counts.interrogazioni);
    elements.heroEventi.textContent = String(counts.eventi);
}

function groupByDate(events) {
    const grouped = new Map();

    events.forEach((event) => {
        const dateKey = event.scheduled_for;
        if (!grouped.has(dateKey)) {
            grouped.set(dateKey, []);
        }
        grouped.get(dateKey).push(event);
    });

    return grouped;
}

function expandEventsByDate(events) {
    const expandedEvents = [];

    events.forEach((event) => {
        const occurrenceDates = getOccurrenceDates(event);
        occurrenceDates.forEach((scheduledFor) => {
            expandedEvents.push({
                ...event,
                scheduled_for: scheduledFor,
                sourceEvent: event,
            });
        });
    });

    return expandedEvents;
}

function changeMonth(offset) {
    const [year, month] = state.displayedMonth.split("-").map(Number);
    const nextMonth = new Date(year, month - 1 + offset, 1);
    state.displayedMonth = getMonthString(nextMonth);

    if (!state.selectedDate.startsWith(state.displayedMonth)) {
        state.selectedDate = `${state.displayedMonth}-01`;
        elements.form.scheduled_for.value = state.selectedDate;
    }

    updateSelectedDateLabel();
    loadEvents();
}

function selectDate(value) {
    state.selectedDate = value;
    elements.form.scheduled_for.value = value;
    if (value.slice(0, 7) !== state.displayedMonth) {
        state.displayedMonth = value.slice(0, 7);
    }
    updateSelectedDateLabel();
}

function startEditing(event) {
    if (!state.canEditEvents) {
        return;
    }

    state.editingEventId = event.id;
    elements.form.event_type.value = event.event_type;
    elements.form.interrogation_mode.value = event.interrogation_mode || "period";
    state.interrogationScheduleDraft = parseInterrogationSchedule(event.interrogation_schedule);
    elements.subjectInput.value = event.subject;
    elements.eventSubjectSelect.value = normalizeEventSubjectOption(event.subject);
    elements.form.scheduled_for.value = event.scheduled_for;
    elements.form.interrogation_end.value = event.interrogation_end || "";
    elements.form.interrogation_dates.value = event.interrogation_dates || "";
    elements.form.notes.value = event.notes || "";
    elements.formTitle.textContent = "Modifica impegno";
    elements.formSubtitle.textContent = `Stai modificando ${formatEventTypeLabel(event.event_type).toLowerCase()} di ${event.subject}.`;
    elements.submitButton.textContent = "Salva modifiche";
    elements.cancelEditButton.hidden = false;
    elements.feedback.textContent = "";
    selectDate(event.scheduled_for);
    updateInterrogationFields();
    openFormModal();
    renderCalendar();
    renderEventList();
}

function parsePermissions() {
    const rawValue = elements.permissionsData?.textContent?.trim();
    if (!rawValue) {
        return [];
    }

    try {
        const parsedValue = JSON.parse(rawValue);
        if (!Array.isArray(parsedValue)) {
            return [];
        }
        return parsedValue.map((item) => String(item));
    } catch (error) {
        return [];
    }
}

function resetForm(options = {}) {
    const { selectedDate = state.selectedDate, feedback = "" } = options;

    state.editingEventId = null;
    state.interrogationScheduleDraft = {};
    elements.form.reset();
    elements.form.event_type.value = "verifica";
    elements.form.interrogation_mode.value = "period";
    elements.subjectInput.value = "";
    elements.eventSubjectSelect.value = "";
    elements.form.interrogation_end.value = "";
    elements.form.interrogation_dates.value = "";
    elements.form.notes.value = "";
    elements.formTitle.textContent = "Aggiungi impegno";
    elements.formSubtitle.textContent = "Inserisci verifica, interrogazione o evento con data e argomenti.";
    elements.submitButton.textContent = "Aggiungi impegno";
    elements.cancelEditButton.hidden = true;
    elements.feedback.textContent = feedback;
    updateInterrogationFields();
    selectDate(selectedDate);
    renderCalendar();
    renderEventList();
}

function openFormModal() {
    elements.formModal.hidden = false;
    elements.formModal.setAttribute("aria-hidden", "false");
    elements.formModal.classList.add("is-open");
    document.body.classList.add("modal-open");
    window.requestAnimationFrame(() => {
        elements.subjectInput.focus();
    });
}

function closeFormModal(options = {}) {
    const { keepFeedback = false, resetState = true } = options;

    closeRandomPickerModal();
    elements.formModal.classList.remove("is-open");
    elements.formModal.hidden = true;
    elements.formModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    if (resetState && !keepFeedback) {
        resetForm({ feedback: "" });
    }
}

function openReadOnlyEventModal(event, focusedDate = "") {
    if (!elements.readOnlyEventModal) {
        return;
    }

    const scheduleRows = buildInterrogationScheduleRows(event);
    elements.readOnlyEventTitle.textContent = `${formatEventTypeLabel(event.event_type)}: ${event.subject}`;
    elements.readOnlyEventSubtitle.textContent = formatEventSchedule(event);
    elements.readOnlyEventNotes.textContent = buildEventDescription(event);
    renderReadOnlyScheduleRows(scheduleRows, focusedDate);

    elements.readOnlyEventModal.hidden = false;
    elements.readOnlyEventModal.classList.add("is-open");
}

function closeReadOnlyEventModal() {
    if (!elements.readOnlyEventModal) {
        return;
    }

    elements.readOnlyEventModal.classList.remove("is-open");
    elements.readOnlyEventModal.hidden = true;
    if (elements.readOnlyEventSchedule) {
        elements.readOnlyEventSchedule.innerHTML = "";
    }
}

function renderReadOnlyScheduleRows(rows, focusedDate = "") {
    if (!elements.readOnlyEventSchedule) {
        return;
    }

    elements.readOnlyEventSchedule.innerHTML = "";
    if (rows.length === 0) {
        const empty = document.createElement("p");
        empty.className = "field-help";
        empty.textContent = "Nessun interrogato assegnato.";
        elements.readOnlyEventSchedule.appendChild(empty);
        return;
    }

    const title = document.createElement("p");
    title.className = "schedule-builder-title";
    title.textContent = "Interrogati giorno per giorno";
    elements.readOnlyEventSchedule.appendChild(title);

    rows.forEach((row) => {
        const rowSection = document.createElement("section");
        rowSection.className = "schedule-row";
        if (focusedDate && row.date === focusedDate) {
            rowSection.classList.add("is-focused");
        }

        const rowHeader = document.createElement("div");
        rowHeader.className = "schedule-row-header";

        const dateLabel = document.createElement("span");
        dateLabel.className = "schedule-row-title";
        dateLabel.textContent = formatDate(row.date);
        rowHeader.appendChild(dateLabel);

        rowSection.appendChild(rowHeader);

        const studentsGrid = document.createElement("div");
        studentsGrid.className = "schedule-student-grid";
        row.students.forEach((studentName) => {
            const studentBadge = document.createElement("span");
            studentBadge.className = "student-pill is-readonly";
            if (focusedDate && row.date === focusedDate) {
                studentBadge.classList.add("is-focused");
            }
            studentBadge.textContent = studentName;
            studentsGrid.appendChild(studentBadge);
        });

        rowSection.appendChild(studentsGrid);
        elements.readOnlyEventSchedule.appendChild(rowSection);
    });
}

function updateSelectedDateLabel() {
    elements.selectedDateLabel.textContent = `Data selezionata: ${state.selectedDate}`;
}

function formatDate(value) {
    return new Intl.DateTimeFormat("it-IT", {
        weekday: "short",
        day: "2-digit",
        month: "short",
    }).format(new Date(`${value}T00:00:00`));
}

function formatLongDate(value) {
    return new Intl.DateTimeFormat("it-IT", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
    }).format(new Date(`${value}T00:00:00`));
}

function formatShortDate(value) {
    return new Intl.DateTimeFormat("it-IT", {
        day: "2-digit",
        month: "short",
    }).format(new Date(`${value}T00:00:00`));
}

function formatEventTypeLabel(eventType) {
    if (eventType === "interrogazione") {
        return "Interrogazione";
    }
    if (eventType === "evento") {
        return "Evento";
    }
    return "Verifica";
}

function getEventTypeClassName(eventType) {
    if (eventType === "interrogazione") {
        return "event-type-interrogazione";
    }
    if (eventType === "evento") {
        return "event-type-evento";
    }
    return "event-type-verifica";
}

function updateInterrogationFields() {
    const isInterrogation = elements.form.event_type.value === "interrogazione";
    const isGenericEvent = elements.form.event_type.value === "evento";
    const selectedEventCategory = elements.eventSubjectSelect.value;
    const eventNeedsNotes = isGenericEvent && ["Uscita didattica", "Compleanni", "Altro"].includes(selectedEventCategory);
    const isSpecificDays = elements.form.interrogation_mode.value === "specific_days";

    elements.interrogationFields.hidden = !isInterrogation;
    elements.subjectTextField.hidden = isGenericEvent;
    elements.eventSubjectField.hidden = !isGenericEvent;
    elements.notesField.hidden = isGenericEvent && !eventNeedsNotes;
    elements.interrogationEndField.hidden = !isInterrogation || isSpecificDays;
    elements.interrogationDatesField.hidden = !isInterrogation || !isSpecificDays;
    elements.scheduledForField.hidden = isInterrogation && isSpecificDays;
    elements.scheduledForLabel.textContent = isInterrogation ? "Dal" : "Data";
    elements.notesLabel.textContent = isInterrogation
        ? "Argomenti / pagine"
        : selectedEventCategory === "Uscita didattica"
            ? "Note sulla gita"
            : selectedEventCategory === "Compleanni"
                ? "Chi compie gli anni"
                : selectedEventCategory === "Altro"
                    ? "Dettagli evento"
            : "Argomenti";
    elements.notesInput.placeholder = isInterrogation
        ? "Capitolo 5, pagine 120-134, rivoluzione francese..."
        : selectedEventCategory === "Uscita didattica"
            ? "Orario, luogo, materiale da portare..."
            : selectedEventCategory === "Compleanni"
                ? "Nome e cognome della persona festeggiata..."
                : selectedEventCategory === "Altro"
                    ? "Specifica che evento e, orario e informazioni utili..."
            : "Equazioni, capitolo 3, teoremi...";
    elements.notesInput.disabled = isGenericEvent && !eventNeedsNotes;
    if (isGenericEvent && !eventNeedsNotes) {
        elements.notesInput.value = "";
    }

    elements.form.scheduled_for.required = !isInterrogation || !isSpecificDays;
    elements.form.interrogation_end.required = isInterrogation && !isSpecificDays;
    elements.form.interrogation_dates.required = isInterrogation && isSpecificDays;
    if (!isInterrogation) {
        state.interrogationScheduleDraft = {};
    }
    syncSubjectField();
    renderInterrogationScheduleBuilder();
}

function syncSubjectField() {
    if (elements.form.event_type.value === "evento") {
        elements.subjectInput.value = elements.eventSubjectSelect.value;
        return;
    }

    if (normalizeEventSubjectOption(elements.subjectInput.value)) {
        elements.eventSubjectSelect.value = "";
    }
}

function normalizeEventSubjectOption(subjectValue) {
    const normalizedValue = String(subjectValue || "").trim().toLowerCase();
    if (normalizedValue === "uscita didattica") {
        return "Uscita didattica";
    }
    if (normalizedValue === "assemblea" || normalizedValue === "assemblea di classe") {
        return "Assemblea";
    }
    if (normalizedValue === "compleanni") {
        return "Compleanni";
    }
    if (normalizedValue === "altro") {
        return "Altro";
    }
    return "";
}

function getOccurrenceDates(event) {
    if (event.event_type !== "interrogazione") {
        return [event.scheduled_for];
    }

    if (event.interrogation_mode === "specific_days") {
        const explicitDates = parseMultilineList(event.interrogation_dates);
        return explicitDates.length > 0 ? explicitDates : [event.scheduled_for];
    }

    if (!event.interrogation_end || event.interrogation_end < event.scheduled_for) {
        return [event.scheduled_for];
    }

    const occurrenceDates = [];
    let currentDate = new Date(`${event.scheduled_for}T00:00:00`);
    const finalDate = new Date(`${event.interrogation_end}T00:00:00`);

    while (currentDate <= finalDate) {
        occurrenceDates.push(getDateString(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return occurrenceDates;
}

function renderInterrogationScheduleBuilder() {
    if (elements.form.event_type.value !== "interrogazione") {
        elements.interrogationScheduleBuilder.innerHTML = "";
        elements.form.interrogation_schedule.value = "";
        return;
    }

    elements.interrogationScheduleBuilder.innerHTML = "";
    const targetDates = getInterrogationTargetDatesFromForm();
    normalizeInterrogationScheduleDraft(targetDates);

    if (targetDates.length === 0) {
        const helper = document.createElement("p");
        helper.className = "field-help";
        helper.textContent = "Seleziona le date dell'interrogazione per inserire gli interrogati di ogni giorno.";
        elements.interrogationScheduleBuilder.appendChild(helper);
        elements.form.interrogation_schedule.value = "";
        return;
    }

    const scheduleLabel = document.createElement("p");
    scheduleLabel.className = "schedule-builder-title";
    scheduleLabel.textContent = "Interrogati per ciascun giorno";
    elements.interrogationScheduleBuilder.appendChild(scheduleLabel);

    const assignedStudents = new Set();

    targetDates.forEach((dateValue) => {
        const row = document.createElement("section");
        row.className = "schedule-row";

        const rowHeader = document.createElement("div");
        rowHeader.className = "schedule-row-header";

        const title = document.createElement("span");
        title.className = "schedule-row-title";
        title.textContent = formatDate(dateValue);
        rowHeader.appendChild(title);

        const selectedStudents = getDraftStudentsForDate(dateValue);
        const randomCandidates = availableStudentsForDate(dateValue, assignedStudents).filter(
            (studentName) => !selectedStudents.includes(studentName)
        );

        const randomButton = document.createElement("button");
        randomButton.type = "button";
        randomButton.className = "ghost-button random-wheel-button";
        randomButton.textContent = "Ruota un nome";
        randomButton.disabled = randomCandidates.length === 0;
        randomButton.addEventListener("click", () => {
            openRandomPickerModal(dateValue, randomCandidates, targetDates);
        });
        rowHeader.appendChild(randomButton);

        row.appendChild(rowHeader);

        const selectedSummary = document.createElement("p");
        selectedSummary.className = "schedule-row-summary";
        selectedSummary.textContent = selectedStudents.length > 0
            ? `Selezionati: ${selectedStudents.join(", ")}`
            : "Nessuna persona selezionata.";
        selectedSummary.title = selectedSummary.textContent;
        row.appendChild(selectedSummary);

        const studentGrid = document.createElement("div");
        studentGrid.className = "schedule-student-grid";

        const availableStudents = availableStudentsForDate(dateValue, assignedStudents);

        availableStudents.forEach((studentName) => {
            const studentButton = document.createElement("button");
            studentButton.type = "button";
            studentButton.className = "student-pill";
            studentButton.textContent = studentName;
            studentButton.title = studentName;
            if (selectedStudents.includes(studentName)) {
                studentButton.classList.add("is-selected");
            }
            studentButton.addEventListener("click", () => {
                toggleStudentForDate(dateValue, studentName, targetDates);
            });
            studentGrid.appendChild(studentButton);
        });

        row.appendChild(studentGrid);

        elements.interrogationScheduleBuilder.appendChild(row);
        selectedStudents.forEach((studentName) => assignedStudents.add(studentName));
    });

    syncInterrogationScheduleField(targetDates);
}

function syncInterrogationScheduleField(targetDates = getInterrogationTargetDatesFromForm()) {
    normalizeInterrogationScheduleDraft(targetDates);
    const normalizedSchedule = {};
    targetDates.forEach((dateValue) => {
        normalizedSchedule[dateValue] = getDraftStudentsForDate(dateValue);
    });
    elements.form.interrogation_schedule.value = JSON.stringify(normalizedSchedule);
}

function getInterrogationTargetDatesFromForm() {
    const mode = elements.form.interrogation_mode.value;
    if (mode === "specific_days") {
        return parseMultilineList(elements.form.interrogation_dates.value)
            .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
            .filter((value) => {
                const weekday = new Date(`${value}T00:00:00`).getDay();
                return weekday !== 0 && weekday !== 6;
            })
            .sort();
    }

    const startValue = elements.form.scheduled_for.value;
    const endValue = elements.form.interrogation_end.value;
    if (!startValue || !endValue) {
        return [];
    }

    const startDate = new Date(`${startValue}T00:00:00`);
    const endDate = new Date(`${endValue}T00:00:00`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
        return [];
    }

    const dates = [];
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
        if (currentDate.getDay() !== 0 && currentDate.getDay() !== 6) {
            dates.push(getDateString(currentDate));
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }
    return dates;
}

function parseInterrogationSchedule(value) {
    if (!value) {
        return {};
    }

    try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== "object") {
            return {};
        }

        const normalized = {};
        Object.entries(parsed).forEach(([dateValue, students]) => {
            if (Array.isArray(students)) {
                normalized[dateValue] = students
                    .map((student) => String(student).trim())
                    .filter(Boolean);
            } else if (typeof students === "string") {
                normalized[dateValue] = students
                    .split("\n")
                    .map((student) => student.trim())
                    .filter(Boolean);
            }
        });
        return normalized;
    } catch {
        return {};
    }
}

function parseMultilineList(value) {
    return value
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
}

function formatEventSchedule(event) {
    if (event.event_type !== "interrogazione") {
        return formatDate(event.scheduled_for);
    }

    if (event.interrogation_mode === "specific_days") {
        const explicitDates = parseMultilineList(event.interrogation_dates);
        const shortDates = explicitDates.slice(0, 3).map((value) => formatShortDate(value));
        const suffix = explicitDates.length > 3 ? ` +${explicitDates.length - 3}` : "";
        return `Giorni: ${shortDates.join(", ")}${suffix}`;
    }

    return `Dal ${formatShortDate(event.scheduled_for)} al ${formatShortDate(event.interrogation_end || event.scheduled_for)}`;
}

function buildEventDescription(event) {
    if (event.notes) {
        return event.notes;
    }

    if (event.event_type === "interrogazione") {
        return "Argomenti o pagine non inseriti.";
    }

    return "Nessun dettaglio inserito.";
}

function buildInterrogationScheduleRows(event) {
    if (event.event_type !== "interrogazione") {
        return [];
    }

    const parsedSchedule = parseInterrogationSchedule(event.interrogation_schedule || "");
    const rows = Object.entries(parsedSchedule)
        .map(([dateValue, students]) => ({
            date: dateValue,
            students,
        }))
        .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.students.length > 0)
        .sort((left, right) => left.date.localeCompare(right.date));

    if (rows.length > 0) {
        return rows;
    }

    const legacyStudents = parseMultilineList(event.interrogated_students || "");
    if (legacyStudents.length === 0) {
        return [];
    }

    return [
        {
            date: event.scheduled_for,
            students: legacyStudents,
        },
    ];
}

function parseClassRoster() {
    try {
        const parsed = JSON.parse(elements.classRosterData.textContent || "[]");
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.map((student) => String(student).trim()).filter(Boolean);
    } catch {
        return [];
    }
}

function availableStudentsForDate(dateValue, assignedStudents) {
    const selectedStudents = getDraftStudentsForDate(dateValue);
    return state.classRoster.filter(
        (studentName) => !assignedStudents.has(studentName) || selectedStudents.includes(studentName)
    );
}

function getDraftStudentsForDate(dateValue) {
    const students = state.interrogationScheduleDraft[dateValue];
    if (!Array.isArray(students)) {
        return [];
    }
    return students;
}

function normalizeInterrogationScheduleDraft(targetDates) {
    const seenStudents = new Set();
    const normalizedDraft = {};

    targetDates.forEach((dateValue) => {
        const uniqueStudents = [];
        getDraftStudentsForDate(dateValue).forEach((studentName) => {
            if (!seenStudents.has(studentName)) {
                seenStudents.add(studentName);
                uniqueStudents.push(studentName);
            }
        });
        normalizedDraft[dateValue] = uniqueStudents;
    });

    state.interrogationScheduleDraft = normalizedDraft;
}

function toggleStudentForDate(dateValue, studentName, targetDates) {
    const currentStudents = getDraftStudentsForDate(dateValue);
    if (currentStudents.includes(studentName)) {
        state.interrogationScheduleDraft[dateValue] = currentStudents.filter(
            (student) => student !== studentName
        );
    } else {
        state.interrogationScheduleDraft[dateValue] = [...currentStudents, studentName].sort();
    }

    renderInterrogationScheduleBuilder();
    syncInterrogationScheduleField(targetDates);
}

function openRandomPickerModal(dateValue, candidateStudents, targetDates) {
    if (candidateStudents.length === 0) {
        return;
    }

    stopRandomPickerAnimation();
    state.randomPicker.targetDate = dateValue;
    state.randomPicker.targetDates = [...targetDates];
    state.randomPicker.candidates = [...candidateStudents];

    elements.randomPickerDate.textContent = `Giorno: ${formatDate(dateValue)}`;
    elements.randomPickerStatus.textContent = "Estrazione in corso...";
    elements.randomPickerModal.hidden = false;
    elements.randomPickerModal.classList.add("is-open");
    const winner = candidateStudents[Math.floor(Math.random() * candidateStudents.length)];
    const totalSteps = Math.max(16, candidateStudents.length * 4);
    const winnerIndex = candidateStudents.indexOf(winner);
    const startIndex = Math.floor(Math.random() * candidateStudents.length);
    const indexOffset = (winnerIndex - startIndex + candidateStudents.length) % candidateStudents.length;
    const fullCycles = Math.max(3, Math.ceil((totalSteps - indexOffset - 1) / candidateStudents.length));
    const finalStep = fullCycles * candidateStudents.length + indexOffset;

    setRandomPickerName(candidateStudents[startIndex]);
    runRandomPickerSequence({
        candidateStudents,
        currentIndex: startIndex,
        currentStep: 0,
        finalStep,
        winner,
        dateValue,
        targetDates,
    });
}

function runRandomPickerSequence({
    candidateStudents,
    currentIndex,
    currentStep,
    finalStep,
    winner,
    dateValue,
    targetDates,
}) {
    if (currentStep >= finalStep) {
        stopRandomPickerAnimation();
        setRandomPickerName(winner);
        elements.randomPickerStatus.textContent = `${winner} inserito automaticamente tra gli interrogati.`;
        addRandomStudentToDate(dateValue, winner, targetDates);
        return;
    }

    const nextIndex = (currentIndex + 1) % candidateStudents.length;
    const progress = currentStep / Math.max(finalStep - 1, 1);
    const delay = Math.round(45 + (progress ** 2.2) * 240);

    state.randomPicker.timeoutId = window.setTimeout(() => {
        setRandomPickerName(candidateStudents[nextIndex]);
        runRandomPickerSequence({
            candidateStudents,
            currentIndex: nextIndex,
            currentStep: currentStep + 1,
            finalStep,
            winner,
            dateValue,
            targetDates,
        });
    }, delay);
}

function stopRandomPickerAnimation() {
    if (state.randomPicker.intervalId !== null) {
        window.clearInterval(state.randomPicker.intervalId);
        state.randomPicker.intervalId = null;
    }
    if (state.randomPicker.timeoutId !== null) {
        window.clearTimeout(state.randomPicker.timeoutId);
        state.randomPicker.timeoutId = null;
    }
}

function closeRandomPickerModal() {
    stopRandomPickerAnimation();
    elements.randomPickerModal.classList.remove("is-open");
    elements.randomPickerModal.hidden = true;
    setRandomPickerName("-");
    elements.randomPickerDate.textContent = "";
    elements.randomPickerStatus.textContent = "Premi il pulsante nella scheda del giorno per avviare l'estrazione.";
    state.randomPicker.targetDate = "";
    state.randomPicker.targetDates = [];
    state.randomPicker.candidates = [];
}

function setRandomPickerName(value) {
    elements.randomPickerName.textContent = value;
    elements.randomPickerName.title = value;
}

function addRandomStudentToDate(dateValue, studentName, targetDates) {
    const currentStudents = getDraftStudentsForDate(dateValue);
    if (currentStudents.includes(studentName)) {
        return;
    }

    state.interrogationScheduleDraft[dateValue] = [...currentStudents, studentName].sort();
    renderInterrogationScheduleBuilder();
    syncInterrogationScheduleField(targetDates);
}

function getMonthString(value) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function getDateString(value) {
    return `${getMonthString(value)}-${String(value.getDate()).padStart(2, "0")}`;
}
