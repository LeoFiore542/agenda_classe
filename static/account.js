(function () {
    initRoleManagement();
    initCredentialsManagement();
})();

function initRoleManagement() {
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
}

function initCredentialsManagement() {
    const credentialsList = document.querySelector("#credentials-list");
    const feedback = document.querySelector("#credentials-feedback");

    if (!credentialsList || !feedback) {
        return;
    }

    let users = [];

    document.addEventListener("DOMContentLoaded", () => {
        void loadCredentialsData();
    });

    async function loadCredentialsData() {
        setFeedback("Caricamento credenziali utenti...", "info");

        try {
            const response = await fetch("/api/users/credentials");
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || "Impossibile caricare le credenziali.");
            }
            users = await response.json();
            renderCredentialsForms();
            setFeedback("", "");
        } catch (error) {
            setFeedback(error.message || "Errore nel caricamento delle credenziali.", "error");
        }
    }

    function renderCredentialsForms() {
        credentialsList.innerHTML = "";

        if (!users.length) {
            credentialsList.innerHTML = '<p class="credentials-empty">Nessun utente disponibile.</p>';
            return;
        }

        users.forEach((user) => {
            const card = document.createElement("article");
            card.className = "credential-user-card";

            const header = document.createElement("div");
            header.className = "credential-user-header";
            header.innerHTML = `<h3>${escapeHtml(user.full_name)}</h3>`;
            card.appendChild(header);

            const form = document.createElement("form");
            form.className = "credentials-form";

            const usernameLabel = document.createElement("label");
            usernameLabel.textContent = "Username";
            const usernameInput = document.createElement("input");
            usernameInput.type = "text";
            usernameInput.name = "username";
            usernameInput.value = user.username;
            usernameInput.autocomplete = "off";
            usernameInput.required = true;
            usernameLabel.appendChild(usernameInput);
            form.appendChild(usernameLabel);

            const passwordLabel = document.createElement("label");
            passwordLabel.textContent = "Nuova password";
            const passwordWrap = document.createElement("div");
            passwordWrap.className = "password-input-wrap";
            const passwordInput = document.createElement("input");
            passwordInput.type = "password";
            passwordInput.name = "new_password";
            passwordInput.placeholder = "Lascia vuoto per non cambiare";
            passwordInput.autocomplete = "new-password";
            passwordInput.dataset.passwordField = "";
            const passwordToggle = document.createElement("button");
            passwordToggle.type = "button";
            passwordToggle.className = "ghost-button password-toggle";
            passwordToggle.dataset.passwordToggle = "";
            passwordToggle.textContent = "Mostra";
            passwordWrap.appendChild(passwordInput);
            passwordWrap.appendChild(passwordToggle);
            passwordLabel.appendChild(passwordWrap);
            form.appendChild(passwordLabel);

            const mustChangeLabel = document.createElement("label");
            mustChangeLabel.className = "credential-checkbox";
            const mustChangeInput = document.createElement("input");
            mustChangeInput.type = "checkbox";
            mustChangeInput.name = "must_change_password";
            mustChangeInput.checked = Boolean(user.must_change_password);
            mustChangeLabel.appendChild(mustChangeInput);
            const mustChangeText = document.createElement("span");
            mustChangeText.textContent = "Richiedi cambio password al primo accesso";
            mustChangeLabel.appendChild(mustChangeText);
            form.appendChild(mustChangeLabel);

            const saveButton = document.createElement("button");
            saveButton.type = "submit";
            saveButton.className = "primary-button credential-save-button";
            saveButton.textContent = "Salva credenziali";
            form.appendChild(saveButton);

            form.addEventListener("submit", (event) => {
                event.preventDefault();
                void saveUserCredentials(form, user.id, user.full_name);
            });

            card.appendChild(form);
            credentialsList.appendChild(card);
            bindPasswordToggle(passwordWrap);
        });
    }

    function bindPasswordToggle(wrapper) {
        const button = wrapper.querySelector("[data-password-toggle]");
        const input = wrapper.querySelector("[data-password-field]");
        if (!(button instanceof HTMLButtonElement) || !(input instanceof HTMLInputElement)) {
            return;
        }
        button.addEventListener("click", () => {
            const isHidden = input.type === "password";
            input.type = isHidden ? "text" : "password";
            button.textContent = isHidden ? "Nascondi" : "Mostra";
        });
    }

    async function saveUserCredentials(formElement, userId, fullName) {
        const username = String(formElement.username.value || "").trim().toLowerCase();
        const newPassword = String(formElement.new_password.value || "");
        const mustChangePassword = formElement.must_change_password.checked;

        setFeedback(`Salvataggio credenziali per ${fullName}...`, "info");

        try {
            const response = await fetch(`/api/users/${userId}/credentials`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    username,
                    new_password: newPassword,
                    must_change_password: mustChangePassword,
                }),
            });

            const data = await response.json();
            if (!response.ok) {
                const message =
                    data.error ||
                    data.username ||
                    data.new_password ||
                    "Impossibile aggiornare le credenziali.";
                throw new Error(message);
            }

            const userIndex = users.findIndex((item) => item.id === userId);
            if (userIndex >= 0) {
                users[userIndex] = data;
            }

            formElement.new_password.value = "";
            setFeedback(`Credenziali aggiornate per ${fullName}.`, "success");
            renderCredentialsForms();
        } catch (error) {
            setFeedback(error.message || "Errore durante il salvataggio delle credenziali.", "error");
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
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
