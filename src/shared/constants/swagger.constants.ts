export const SWAGGER_UI_DARK_THEME_CSS = `
    /* Base */
    html,
    body,
    .swagger-ui,
    .swagger-ui html,
    .swagger-ui body {
        background: #0b0f14 !important;
        color: #e6edf3 !important;
    }

    /* Main containers */
    .swagger-ui .wrapper,
    .swagger-ui .scheme-container,
    .swagger-ui .info,
    .swagger-ui .renderedMarkdown,
    .swagger-ui .markdown,
    .swagger-ui section.models {
        background: transparent !important;
        color: #e6edf3 !important;
    }

    /* Headings + description text */
    .swagger-ui .info .title,
    .swagger-ui .info h1,
    .swagger-ui .info h2,
    .swagger-ui .info h3,
    .swagger-ui .wrapper h4,
    .swagger-ui .renderedMarkdown p,
    .swagger-ui .renderedMarkdown li {
        color: #e6edf3 !important;
    }

    /* Operation block shell */
    .swagger-ui .opblock {
        background: #0f1620 !important;
        border: 1px solid #2b3645 !important;
        box-shadow: none !important;
    }

    /* Operation summary row */
    .swagger-ui .opblock .opblock-summary {
        background: #0f1620 !important;
        border-bottom: 1px solid #2b3645 !important;
    }

    .swagger-ui .opblock .opblock-summary-description,
    .swagger-ui .opblock .opblock-summary-path,
    .swagger-ui .opblock .opblock-summary-method {
        color: #e6edf3 !important;
    }

    /* The bit that is currently killing contrast in your screenshot */
    .swagger-ui .opblock .opblock-section-header {
        background: #121b26 !important;
        border-top: 1px solid #2b3645 !important;
        border-bottom: 1px solid #2b3645 !important;
    }

    .swagger-ui .opblock .opblock-section-header h4,
    .swagger-ui .opblock .opblock-section-header label,
    .swagger-ui .opblock .opblock-section-header span {
        color: #e6edf3 !important;
    }

    /* Operation body content areas */
    .swagger-ui .opblock .opblock-description-wrapper,
    .swagger-ui .opblock .opblock-external-docs-wrapper,
    .swagger-ui .opblock .opblock-body {
        background: #0f1620 !important;
        color: #e6edf3 !important;
    }

    /* Tables (Parameters/Responses) */
    .swagger-ui table thead tr th,
    .swagger-ui table thead tr td {
        background: #121b26 !important;
        color: #e6edf3 !important;
        border-bottom: 1px solid #2b3645 !important;
    }

    .swagger-ui table tbody tr td {
        background: #0f1620 !important;
        color: #e6edf3 !important;
        border-top: 1px solid #1f2a37 !important;
    }

    .swagger-ui .parameter__name,
    .swagger-ui .parameter__type,
    .swagger-ui .response-col_status,
    .swagger-ui .response-col_description {
        color: #e6edf3 !important;
    }

    /* Code blocks */
    .swagger-ui pre,
    .swagger-ui code,
    .swagger-ui .microlight {
        background: #0b0f14 !important;
        color: #e6edf3 !important;
        border: 1px solid #2b3645 !important;
    }

    /* Models section */
    .swagger-ui section.models .model-container {
        background: #0f1620 !important;
        border: 1px solid #2b3645 !important;
    }

    .swagger-ui .model-title,
    .swagger-ui .model,
    .swagger-ui .model-box {
        color: #e6edf3 !important;
    }

    /* Inputs */
    .swagger-ui input[type="text"],
    .swagger-ui input[type="password"],
    .swagger-ui input[type="search"],
    .swagger-ui textarea,
    .swagger-ui select {
        background: #0b0f14 !important;
        color: #e6edf3 !important;
        border: 1px solid #2b3645 !important;
    }

    /* Buttons (semantic + defined colours) */
    .swagger-ui .btn {
        border-radius: 6px;
        font-weight: 600;
        letter-spacing: 0.2px;
        box-shadow: none !important;
    }

    /* Primary action: Execute */
    .swagger-ui .btn.execute,
    .swagger-ui .btn.btn-execute {
        background: #0ea5e9 !important;
        color: #020617 !important;
        border: none !important;
    }

    .swagger-ui .btn.execute:hover,
    .swagger-ui .btn.btn-execute:hover {
        background: #38bdf8 !important;
    }

    /* Secondary action: Try it out */
    .swagger-ui .btn.try-out,
    .swagger-ui .btn.try-out__btn {
        background: #1e293b !important;
        color: #e6edf3 !important;
        border: 1px solid #334155 !important;
    }

    .swagger-ui .btn.try-out:hover,
    .swagger-ui .btn.try-out__btn:hover {
        background: #334155 !important;
    }

    /* Cancel / reset */
    .swagger-ui .btn.cancel {
        background: #3f1d1d !important;
        color: #fecaca !important;
        border: 1px solid #7f1d1d !important;
    }

    .swagger-ui .btn.cancel:hover {
        background: #7f1d1d !important;
        color: #fee2e2 !important;
    }

    /* Disabled state */
    .swagger-ui .btn[disabled],
    .swagger-ui .btn.disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    /* Focus ring (keyboard users) */
    .swagger-ui .btn:focus-visible {
        outline: 2px solid #38bdf8 !important;
        outline-offset: 2px;
    }


    /* Version "pills" next to the title */
    #swagger-ui > section > div.swagger-ui > div:nth-child(2) > div.information-container.wrapper > section > div > div > hgroup > h1 > span > small:nth-child(1) > pre {
        background: #7d8492 !important;
        border: none !important;
    }
    #swagger-ui > section > div.swagger-ui > div:nth-child(2) > div.information-container.wrapper > section > div > div > hgroup > h1 > span > small:nth-child(1) > pre::before {
        content: "version";
        margin-right: 0.15rem;
    }
    #swagger-ui > section > div.swagger-ui > div:nth-child(2) > div.information-container.wrapper > section > div > div > hgroup > h1 > span > small.version-stamp > pre {
        background: #38bdf8 !important;
        border: none !important;
    }
    .swagger-ui .info .title .version-stamp,
    .swagger-ui .info .title span.version-stamp,
    .swagger-ui .info .title small.version-stamp {
        background: #38bdf8 !important;
        color: #e6edf3 !important;
        border: 1px solid #38bdf8 !important;
        border-radius: 999px !important;
        padding: 2px 10px !important;
        font-weight: 700 !important;
        opacity: 1 !important;
    }

    /* Make the OAS pill pop a bit more (usually the second badge) */
    .swagger-ui .info .title .version-stamp + .version-stamp {
        background: #0ea5e9 !important;
        color: #020617 !important;
        border-color: #0ea5e9 !important;
    }

    /* Authorize button */
    .swagger-ui .auth-wrapper .authorize {
        background: #0ea5e9 !important;
        color: #020617 !important;
        border: none !important;
        opacity: 1 !important;
        box-shadow: none !important;
    }

    .swagger-ui .auth-wrapper .authorize:hover {
        background: #38bdf8 !important;
    }

    /* Authorize padlock icon */
    .swagger-ui .auth-wrapper .authorize svg,
    .swagger-ui .auth-wrapper .authorize svg path {
        fill: currentColor !important;
        opacity: 1 !important;
    }

    /* Expand/collapse chevrons (operations + models) */
    .swagger-ui .opblock-summary-control svg,
    .swagger-ui .models-control svg,
    .swagger-ui .model-toggle svg {
        fill: #8ab4f8 !important;
        opacity: 1 !important;
    }

    .swagger-ui .opblock-summary-control,
    .swagger-ui .models-control,
    .swagger-ui .model-toggle {
        opacity: 1 !important;
    }

    /* Try it out button (make it clearer as a secondary action) */
    .swagger-ui .btn.try-out,
    .swagger-ui .btn.try-out__btn {
        border-color: #38bdf8 !important;
    }

    /* Expand / collapse chevrons, icons */
    .swagger-ui svg.arrow,
    .swagger-ui svg.unlocked,
    .swagger-ui svg.locked {
        fill: #ffffff !important;
        stroke: #ffffff !important;
        opacity: 0.9;
    }
    .swagger-ui .opblock-tag {
        border-bottom: 1px solid rgba(255, 255, 255, .4);
    }

    /* Hover state for better affordance */
    .swagger-ui .opblock-summary-control:hover svg,
    .swagger-ui section.models .model-toggle:hover svg {
        opacity: 1;
    }

    /* Focus-visible (keyboard users) */
    .swagger-ui .opblock-summary-control:focus-visible svg,
    .swagger-ui section.models .model-toggle:focus-visible svg {
        outline: none;
        filter: drop-shadow(0 0 4px #38bdf8);
    }

    /* Small text and links */
    .swagger-ui a,
    .swagger-ui .link {
        color: #8ab4f8 !important;
    }

    .swagger-ui .opblock-summary-control:focus {
        outline: 2px solid #8ab4f8 !important;
        outline-offset: 2px;
    }

    /* Auth dialog (Authorize modal) */
    .swagger-ui .dialog-ux .modal-ux {
        background: #0f1620 !important;
        color: #e6edf3 !important;
        border: 1px solid #2b3645 !important;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55) !important;
    }

    /* Modal overlay (dim the page behind) */
    .swagger-ui .dialog-ux .modal-ux-overlay {
        background: rgba(0, 0, 0, 0.65) !important;
    }

    /* Header */
    .swagger-ui .dialog-ux .modal-ux-header {
        background: #121b26 !important;
        border-bottom: 1px solid #2b3645 !important;
    }

    .swagger-ui .dialog-ux .modal-ux-header h3 {
        color: #e6edf3 !important;
        font-weight: 700;
    }

    /* Close "X" */
    .swagger-ui .dialog-ux .modal-ux-header .close-modal {
        opacity: 1 !important;
    }

    .swagger-ui .dialog-ux .modal-ux-header .close-modal svg {
        fill: #ffffff !important;
        stroke: #ffffff !important;
        opacity: 0.9;
    }

    .swagger-ui .dialog-ux .modal-ux-header .close-modal:hover svg {
        opacity: 1;
    }

    /* Body + text */
    .swagger-ui .dialog-ux .modal-ux-content {
        background: #0f1620 !important;
        color: #e6edf3 !important;
    }

    .swagger-ui .dialog-ux .modal-ux-content p,
    .swagger-ui .dialog-ux .modal-ux-content label,
    .swagger-ui .dialog-ux .modal-ux-content span,
    .swagger-ui .dialog-ux .modal-ux-content code {
        color: #e6edf3 !important;
    }

    /* Scheme name + description */
    .swagger-ui .dialog-ux .modal-ux-content h4,
    .swagger-ui .dialog-ux .modal-ux-content .auth__title,
    .swagger-ui .dialog-ux .modal-ux-content .auth__section h4 {
        color: #e6edf3 !important;
    }

    /* Token input */
    .swagger-ui .dialog-ux .modal-ux-content input[type="text"],
    .swagger-ui .dialog-ux .modal-ux-content input[type="password"] {
        background: #0b0f14 !important;
        color: #e6edf3 !important;
        border: 1px solid #2b3645 !important;
        border-radius: 6px;
        box-shadow: none !important;
    }

    .swagger-ui .dialog-ux .modal-ux-content input[type="text"]:focus,
    .swagger-ui .dialog-ux .modal-ux-content input[type="password"]:focus {
        outline: 2px solid #38bdf8 !important;
        outline-offset: 2px;
        border-color: #38bdf8 !important;
    }

    /* Buttons area */
    .swagger-ui .dialog-ux .modal-ux-content .auth-btn-wrapper {
        margin-top: 12px;
    }

    /* Primary (Authorize) */
    .swagger-ui .dialog-ux .modal-ux-content .btn.authorize {
        background: #0ea5e9 !important;
        color: #020617 !important;
        border: none !important;
        border-radius: 6px;
        font-weight: 700;
        box-shadow: none !important;
    }

    .swagger-ui .dialog-ux .modal-ux-content .btn.authorize:hover {
        background: #38bdf8 !important;
    }

    /* Secondary (Close) */
    .swagger-ui .dialog-ux .modal-ux-content .btn-done {
        background: #3f1d1d !important;
        color: #e6edf3 !important;
        border: 1px solid #38bdf8 !important;
        border-radius: 6px;
        font-weight: 700;
        box-shadow: none !important;
        margin-left: 25px !important;
    }

    .swagger-ui .dialog-ux .modal-ux-content .btn.modal-btn:hover {
        background: #334155 !important;
    }

    /* Remove white badges / highlights inside modal */
    .swagger-ui .dialog-ux .modal-ux-content .auth__section {
        background: transparent !important;
    }

    /* make the "bearer (http, Bearer)" code pill readable */
    .swagger-ui .dialog-ux .modal-ux-content code {
        background: #0b0f14 !important;
        border: 1px solid #2b3645 !important;
        padding: 2px 6px;
        border-radius: 6px;
    }
`;
