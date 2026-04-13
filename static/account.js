(function () {
    const rolesList = document.querySelector("#roles-list");
    const feedback = document.querySelector("#roles-feedback");

    if (!rolesList || !feedback) {
        return;
    }

    let availableRoles = [];
    let users = [];

    document.addEventListener("DOMContentLoaded", () => {
        void loadRoleManagementData();
    });

    async function loadRoleManagementData() {
        setFeedback("Caricamento ruoli e utenti...", "info");

        try {
            const [rolesResponse, usersResponse] = await Promise.all([
                fetch("/api/roles"),
                fetch("/api/users/roles"),
            ]);

            if (!rolesResponse.ok || !usersResponse.ok) {
                throw new Error("Impossibile caricare i dati dei ruoli.");
            }

            availableRoles = await rolesResponse.json();
            users = await usersResponse.json();
            renderUsersRoles();
            setFeedback("", "");
        } catch (error) {
            setFeedback(error.message || "Errore nel caricamento dei ruoli.", "error");
        }
    }

    function renderUsersRoles() {
        rolesList.innerHTML = "";

        if (!users.length) {
            rolesList.innerHTML = '<p class="roles-empty">Nessun utente disponibile.</p>';
            return;
        }

        const roleNames = availableRoles.map((role) => role.name);

        users.forEach((user) => {
            const card = document.createElement("article");
            card.className = "role-user-card";

            const header = document.createElement("div");
            header.className = "role-user-header";
            header.innerHTML = `
                <div>
                    <h3>${escapeHtml(user.full_name)}</h3>
                    <p>@${escapeHtml(user.username)}</p>
                </div>
            `;
            card.appendChild(header);

            const form = document.createElement("form");
            form.className = "roles-form";
            form.dataset.userId = String(user.id);

            roleNames.forEach((roleName) => {
                const label = document.createElement("label");
                label.className = "role-checkbox";

                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.name = "roles";
                checkbox.value = roleName;
                checkbox.checked = user.roles.includes(roleName);
                label.appendChild(checkbox);

                const text = document.createElement("span");
                text.textContent = roleName;
                label.appendChild(text);

                form.appendChild(label);
            });

            const saveButton = document.createElement("button");
            saveButton.type = "submit";
            saveButton.className = "primary-button role-save-button";
            saveButton.textContent = "Salva ruoli";
            form.appendChild(saveButton);

            form.addEventListener("submit", (event) => {
                event.preventDefault();
                void saveUserRoles(form, user.id, user.username);
            });

            card.appendChild(form);
            rolesList.appendChild(card);
        });
    }

    async function saveUserRoles(formElement, userId, username) {
        const selectedRoles = Array.from(formElement.querySelectorAll('input[name="roles"]:checked')).map(
            (input) => input.value
        );

        setFeedback(`Salvataggio ruoli per @${username}...`, "info");

        try {
            const response = await fetch(`/api/users/${userId}/roles`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ roles: selectedRoles }),
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Impossibile aggiornare i ruoli.");
            }

            const userIndex = users.findIndex((item) => item.id === userId);
            if (userIndex >= 0) {
                users[userIndex].roles = data.roles || [];
            }

            setFeedback(`Ruoli aggiornati per @${username}.`, "success");
            renderUsersRoles();
        } catch (error) {
            setFeedback(error.message || "Errore durante il salvataggio dei ruoli.", "error");
        }
    }

    function setFeedback(message, tone) {
        feedback.textContent = message;
        feedback.classList.remove("is-success", "is-error", "is-info");
        if (!message) {
            return;
        }
        if (tone === "success") {
            feedback.classList.add("is-success");
        } else if (tone === "error") {
            feedback.classList.add("is-error");
        } else {
            feedback.classList.add("is-info");
        }
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
})();
