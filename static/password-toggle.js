document.addEventListener("DOMContentLoaded", () => {
    const toggleButtons = document.querySelectorAll("[data-password-toggle]");

    toggleButtons.forEach((button) => {
        const wrapper = button.closest(".password-input-wrap");
        if (!wrapper) {
            return;
        }

        const input = wrapper.querySelector("[data-password-field]");
        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        button.addEventListener("click", () => {
            const isHidden = input.type === "password";
            input.type = isHidden ? "text" : "password";
            button.textContent = isHidden ? "Nascondi" : "Mostra";
            button.setAttribute("aria-pressed", String(isHidden));
        });
    });
});
