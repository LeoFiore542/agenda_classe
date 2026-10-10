(() => {
    const grid = document.querySelector("#timetable-grid");
    const saveButton = document.querySelector("#save-timetable-button");
    const feedback = document.querySelector("#timetable-feedback");

    if (!grid || !saveButton || grid.dataset.editable !== "true") {
        return;
    }

    const days = Array.from(
        new Set(
            Array.from(grid.querySelectorAll(".timetable-input"))
                .map((input) => input.dataset.day)
                .filter(Boolean)
        )
    );

    function setFeedback(message, tone) {
        if (!feedback) {
            return;
        }
        feedback.textContent = message;
        feedback.classList.remove("is-success", "is-error", "is-info");
        if (tone) {
            feedback.classList.add(`is-${tone}`);
        }
    }

    function collectSlots() {
        const slots = Object.fromEntries(days.map((day) => [day, ["", "", "", "", "", ""]]));
        grid.querySelectorAll(".timetable-input").forEach((input) => {
            const day = input.dataset.day;
            const period = Number(input.dataset.period);
            if (!day || !Number.isInteger(period) || period < 1 || period > 6) {
                return;
            }
            slots[day][period - 1] = String(input.value || "").trim();
            input.closest(".timetable-slot")?.classList.toggle("is-empty", !slots[day][period - 1]);
        });
        return slots;
    }

    grid.querySelectorAll(".timetable-input").forEach((input) => {
        input.addEventListener("input", () => {
            const value = String(input.value || "").trim();
            input.title = value;
            input.closest(".timetable-slot")?.classList.toggle("is-empty", !value);
        });
    });

    saveButton.addEventListener("click", async () => {
        saveButton.disabled = true;
        setFeedback("Salvataggio in corso...", "info");

        try {
            const response = await fetch("/api/timetable", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ slots: collectSlots() }),
            });
            const payload = await response.json().catch(() => ({}));

            if (!response.ok) {
                const errorMessage =
                    payload.error ||
                    (payload.errors && Object.values(payload.errors)[0]) ||
                    "Impossibile salvare l'orario.";
                setFeedback(String(errorMessage), "error");
                return;
            }

            setFeedback("Orario salvato.", "success");
        } catch (_error) {
            setFeedback("Errore di rete durante il salvataggio.", "error");
        } finally {
            saveButton.disabled = false;
        }
    });
})();
