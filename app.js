// ----------------------------------------------------
// Supabase Configuration
// ----------------------------------------------------
const SUPABASE_URL = "https://piwsavppaabjygaolldb.supabase.co";
const SUPABASE_KEY = "sb_publishable_KTpEV6wW6w5QGJekeeCMzA_TyCJbpfV";

// Default categories/places
const DEFAULT_CATEGORIES = ["Tio Nan", "Cassol", "PUCRS"];

// Default tasks database for initial setup (offline fallback and reset option)
const DEFAULT_TASKS = [];

// App State
let tasks = [];
let allActiveTasks = [];
let categories = [];
let currentFilter = "all";
let isEditMode = false;
let isHistoryMode = false;
let currentTheme = "default";

// Selected date format YYYY-MM-DD
let selectedDate = "";
let currentCalendarMonth = new Date();

// Async transaction locks (prevents double submits)
let pendingDeletes = new Set();
let pendingToggles = new Set();

// Authentication State
let currentUser = null;
let isAuthModeLogin = true;

// Supabase Client instance
let supabaseClient = null;

// DOM Elements
const tasksListEl = document.getElementById("tasks-list");
const emptyStateEl = document.getElementById("empty-state");
const progressPercentageEl = document.getElementById("progress-percentage");
const progressTasksCountEl = document.getElementById("progress-tasks-count");
const progressCircle = document.getElementById("progress-circle");
const progressRingWrapper = document.querySelector(".progress-ring-wrapper");
const progressBarFill = document.getElementById("progress-bar-fill");
const currentDateEl = document.getElementById("current-date");
const btnOpenCalendar = document.getElementById("btn-open-calendar");
const btnPrevDay = document.getElementById("btn-prev-day");
const btnNextDay = document.getElementById("btn-next-day");
const orgTagEl = document.getElementById("org-tag");
const appContainer = document.querySelector(".app-container");

// Modals
const modalAddTask = document.getElementById("modal-add-task");
const modalManageTasks = document.getElementById("modal-manage-tasks");
const modalCalendar = document.getElementById("modal-calendar");
const modalSmartReport = document.getElementById("modal-smart-report");
const modalConfirmDelete = document.getElementById("modal-confirm-delete");
const btnSmartReport = document.getElementById("btn-smart-report");
const btnCloseSmartReportModal = document.getElementById("btn-close-smart-report-modal");

// Custom Delete Confirmation Elements
const confirmDeleteTitle = document.getElementById("confirm-delete-title");
const confirmDeleteBody = document.getElementById("confirm-delete-body");
const confirmDeleteStandardActions = document.getElementById("confirm-delete-standard-actions");
const confirmDeleteRecurringActions = document.getElementById("confirm-delete-recurring-actions");
const btnConfirmDeleteCancel = document.getElementById("btn-confirm-delete-cancel");
const btnConfirmDeleteOk = document.getElementById("btn-confirm-delete-ok");
const btnConfirmDeleteRecurringToday = document.getElementById("btn-confirm-delete-recurring-today");
const btnConfirmDeleteRecurringAll = document.getElementById("btn-confirm-delete-recurring-all");
const btnConfirmDeleteRecurringCancel = document.getElementById("btn-confirm-delete-recurring-cancel");
// Collaborators Modal Elements
const modalCollaborators = document.getElementById("modal-collaborators");
const btnCloseCollaboratorsModal = document.getElementById("btn-close-collaborators-modal");
const btnAddCollab = document.getElementById("btn-add-collab");
const inputCollabEmail = document.getElementById("input-collab-email");
const collabCategoryId = document.getElementById("collab-category-id");
const collaboratorsList = document.getElementById("collaborators-list");
const collabModalSubtitle = document.getElementById("collab-modal-subtitle");
let confirmDeleteCallback = null;
let switchReportTab = null;
let categoryShares = [];
let pendingInvites = [];

// Forms & Inputs
const formAddTask = document.getElementById("form-add-task");
const inputTaskTitle = document.getElementById("task-title");
const selectTaskCategory = document.getElementById("task-category");
const selectTaskRecurring = document.getElementById("task-recurring");
const selectTaskAssignedTo = document.getElementById("task-assigned-to");
const taskAssigneeGroup = document.getElementById("task-assignee-group");

const modalEditTask = document.getElementById("modal-edit-task");
const selectEditTaskAssignedTo = document.getElementById("edit-task-assigned-to");
const editTaskAssigneeGroup = document.getElementById("edit-task-assignee-group");

const inputOrgName = document.getElementById("input-org-name");
const inputNewCategory = document.getElementById("input-new-category");

// Action Buttons
const btnNotifications = document.getElementById("btn-notifications");
const modalNotifications = document.getElementById("modal-notifications");
const btnCloseNotificationsModal = document.getElementById("btn-close-notifications-modal");
const notificationsListContainer = document.getElementById("notifications-list-container");
const notificationsBadge = document.getElementById("notifications-badge");
const btnToggleEdit = document.getElementById("btn-toggle-edit");
const btnManageTasks = document.getElementById("btn-manage-tasks");
const btnAddTaskModal = document.getElementById("btn-add-task-modal");
const btnShareReport = document.getElementById("btn-share-report");
const btnCloseAddModal = document.getElementById("btn-close-add-modal");
const btnCloseManageModal = document.getElementById("btn-close-manage-modal");

const btnResetDefault = document.getElementById("btn-reset-default");
const btnClearAll = document.getElementById("btn-clear-all");
const btnAddCategory = document.getElementById("btn-add-category");

const btnCloseCalendar = document.getElementById("btn-close-calendar");
const btnPrevMonth = document.getElementById("btn-prev-month");
const btnNextMonth = document.getElementById("btn-next-month");
const calendarMonthYear = document.getElementById("calendar-month-year");
const calendarDaysGrid = document.getElementById("calendar-days-grid");

// ----------------------------------------------------
// Initialization
// ----------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    initApp();
    setupEventListeners();
    
    // Register Service Worker for PWA compatibility on Android
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registrado com sucesso:', reg))
            .catch(err => console.error('Erro ao registrar Service Worker:', err));
    }
});

async function initApp() {
    // Load theme
    const storedTheme = localStorage.getItem("checklist_theme") || "default";
    applyTheme(storedTheme);

    // Set initial date to today
    selectedDate = getLocalDateString(new Date());
    updateDateDisplay();

    // Load organization name
    const storedOrgName = localStorage.getItem("checklist_org_name");
    if (storedOrgName) {
        orgTagEl.textContent = storedOrgName;
        inputOrgName.value = storedOrgName;
    } else {
        inputOrgName.value = "Checklist Organizacional";
        orgTagEl.textContent = "Checklist Organizacional";
    }

    // Prefill Supabase credentials (using code constants now)

    // Connect to Supabase
    connectSupabase();

    // Setup Auth and listen to session changes
    setupSupabaseAuth();

    // Initialize Lucide Icons
    lucide.createIcons();

    // Check notifications badge read status
    if (localStorage.getItem("notifications_badge_read") === "true") {
        if (notificationsBadge) notificationsBadge.style.display = "none";
    }
}

// ----------------------------------------------------
// Event Listeners Setup
// ----------------------------------------------------
function setupEventListeners() {
    // Smart Report Modal Events
    // Smart Report Tab Switcher and Listeners
    const tabWeekly = document.getElementById("tab-report-weekly");
    const tabMonthly = document.getElementById("tab-report-monthly");
    const tabYearly = document.getElementById("tab-report-yearly");
    const reportSummaryTitle = document.getElementById("report-summary-title");
    const reportSummaryContent = document.getElementById("report-summary-content");

    switchReportTab = (days) => {
        [tabWeekly, tabMonthly, tabYearly].forEach(tab => {
            if (tab) tab.classList.remove("active");
        });
        
        if (days === 7) {
            if (tabWeekly) tabWeekly.classList.add("active");
            if (reportSummaryTitle) reportSummaryTitle.innerHTML = `<i data-lucide="sparkles" style="width: 16px; height: 16px;"></i> Resumo Semanal`;
            loadAndRenderReport(7, reportSummaryContent);
        } else if (days === 30) {
            if (tabMonthly) tabMonthly.classList.add("active");
            if (reportSummaryTitle) reportSummaryTitle.innerHTML = `<i data-lucide="sparkles" style="width: 16px; height: 16px;"></i> Resumo Mensal`;
            loadAndRenderReport(30, reportSummaryContent);
        } else if (days === 365) {
            if (tabYearly) tabYearly.classList.add("active");
            if (reportSummaryTitle) reportSummaryTitle.innerHTML = `<i data-lucide="sparkles" style="width: 16px; height: 16px;"></i> Resumo Anual`;
            loadAndRenderReport(365, reportSummaryContent);
        }
    };

    if (tabWeekly) tabWeekly.addEventListener("click", () => switchReportTab(7));
    if (tabMonthly) tabMonthly.addEventListener("click", () => switchReportTab(30));
    if (tabYearly) tabYearly.addEventListener("click", () => switchReportTab(365));

    if (btnSmartReport) {
        btnSmartReport.addEventListener("click", () => {
            switchReportTab(7); // default to weekly summary
            openModal(modalSmartReport);
        });
    }
    if (btnCloseSmartReportModal) {
        btnCloseSmartReportModal.addEventListener("click", () => {
            closeModal(modalSmartReport);
        });
    }

    // Custom Calendar Modal Events
    btnOpenCalendar.addEventListener("click", () => {
        // Initialize calendar view to the currently selected date
        currentCalendarMonth = new Date(selectedDate + "T12:00:00");
        renderCalendarGrid();
        openModal(modalCalendar);
    });

    btnCloseCalendar.addEventListener("click", () => {
        closeModal(modalCalendar);
    });

    btnPrevMonth.addEventListener("click", () => {
        currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() - 1);
        renderCalendarGrid();
    });

    btnNextMonth.addEventListener("click", () => {
        currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() + 1);
        renderCalendarGrid();
    });

    // Date Navigation Arrows (Chevron-left/right)
    async function changeDay(offset) {
        const outClass = offset > 0 ? "slide-out-left" : "slide-out-right";
        const inClass = offset > 0 ? "slide-in-right" : "slide-in-left";
        
        // Aplica transição de saída
        tasksListEl.style.transition = "transform 0.15s ease-in, opacity 0.15s ease-in";
        tasksListEl.classList.add(outClass);

        await new Promise(resolve => setTimeout(resolve, 150));

        const dateObj = new Date(selectedDate + "T12:00:00");
        dateObj.setDate(dateObj.getDate() + offset);
        
        selectedDate = getLocalDateString(dateObj);
        
        const now = new Date();
        const todayStr = getLocalDateString(now);
        isHistoryMode = (selectedDate !== todayStr);
        
        if (isHistoryMode) {
            appContainer.classList.add("history-mode");
            toggleEditMode(false);
        } else {
            appContainer.classList.remove("history-mode");
        }

        updateDateDisplay();
        await loadChecklistAndProgress();
        lucide.createIcons();

        // Configura posição de início da entrada
        tasksListEl.style.transition = "none";
        tasksListEl.classList.remove(outClass);
        tasksListEl.classList.add(inClass);

        // Força reflow para aplicar o estado sem transição
        tasksListEl.offsetHeight;

        // Ativa transição de entrada
        tasksListEl.style.transition = "transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1)";
        tasksListEl.classList.remove(inClass);
        tasksListEl.classList.add("slide-in-active");

        setTimeout(() => {
            tasksListEl.classList.remove("slide-in-active");
            tasksListEl.style.transition = "";
        }, 220);
    }

    if (btnPrevDay) {
        btnPrevDay.addEventListener("click", () => changeDay(-1));
    }
    if (btnNextDay) {
        btnNextDay.addEventListener("click", () => changeDay(1));
    }

    // Navegação por deslize nas bordas da barra de progresso
    const progressCard = document.querySelector(".progress-card-container");
    if (progressCard) {
        let touchStartX = 0;
        let touchEndX = 0;
        let startedOnEdge = false;
        let edgeType = ""; // "left" ou "right"

        progressCard.addEventListener("touchstart", (e) => {
            touchStartX = e.touches[0].clientX;
            touchEndX = touchStartX;
            const width = window.innerWidth;
            const threshold = 100;

            if (touchStartX < threshold) {
                startedOnEdge = true;
                edgeType = "left";
            } else if (touchStartX > width - threshold) {
                startedOnEdge = true;
                edgeType = "right";
            } else {
                startedOnEdge = false;
                edgeType = "";
            }

            if (startedOnEdge) {
                progressCard.style.transition = "none";
            }
        }, { passive: true });

        progressCard.addEventListener("touchmove", (e) => {
            if (!startedOnEdge) return;
            touchEndX = e.touches[0].clientX;
            const diffX = touchEndX - touchStartX;

            // Restringe a direção do arraste visual de acordo com o lado iniciado
            let dragX = diffX;
            if (edgeType === "left" && dragX < 0) dragX = 0;
            if (edgeType === "right" && dragX > 0) dragX = 0;

            progressCard.style.transform = `translateX(${dragX}px)`;
            
            if (e.cancelable) {
                e.preventDefault();
            }
        }, { passive: false });

        progressCard.addEventListener("touchend", () => {
            if (!startedOnEdge) return;

            const diffX = touchEndX - touchStartX;
            const minSwipeDistance = 40; 
            let triggered = false;

            if (edgeType === "left" && diffX > minSwipeDistance) {
                triggered = true;
                // Anima o card saindo para a direita
                progressCard.style.transition = "transform 0.15s ease-out, opacity 0.15s ease-out";
                progressCard.style.transform = "translateX(100vw)";
                progressCard.style.opacity = "0";

                setTimeout(async () => {
                    await changeDay(-1);
                    // Reposiciona na esquerda e entra
                    progressCard.style.transition = "none";
                    progressCard.style.transform = "translateX(-100vw)";
                    progressCard.offsetHeight; // Força reflow
                    progressCard.style.transition = "transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1)";
                    progressCard.style.transform = "translateX(0)";
                    progressCard.style.opacity = "1";
                }, 150);
            } else if (edgeType === "right" && diffX < -minSwipeDistance) {
                triggered = true;
                // Anima o card saindo para a esquerda
                progressCard.style.transition = "transform 0.15s ease-out, opacity 0.15s ease-out";
                progressCard.style.transform = "translateX(-100vw)";
                progressCard.style.opacity = "0";

                setTimeout(async () => {
                    await changeDay(1);
                    // Reposiciona na direita e entra
                    progressCard.style.transition = "none";
                    progressCard.style.transform = "translateX(100vw)";
                    progressCard.offsetHeight; // Força reflow
                    progressCard.style.transition = "transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1)";
                    progressCard.style.transform = "translateX(0)";
                    progressCard.style.opacity = "1";
                }, 150);
            }

            if (!triggered) {
                // Caso não tenha arrastado o suficiente, retorna de forma suave à posição original
                progressCard.style.transition = "transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)";
                progressCard.style.transform = "translateX(0)";
            }

            startedOnEdge = false;
            edgeType = "";
        });
    }

    // Toggle Task Complete (using event delegation)
    tasksListEl.addEventListener("click", (e) => {
        if (e.target.closest(".btn-task-action") || e.target.closest(".swipe-action-btn")) return;

        const item = e.target.closest(".task-item");
        if (!item) return;

        // Se o card de tarefa estiver deslizado/aberto (swiped), fecha o swipe em vez de marcar concluída
        if (item.classList.contains("swiped")) {
            e.preventDefault();
            e.stopPropagation();
            const fg = item.querySelector(".task-item-foreground");
            if (fg) {
                fg.style.transition = "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)";
                fg.style.transform = "translateX(0px)";
            }
            item.classList.remove("swiped");
            return;
        }

        if (isEditMode || isHistoryMode) return;
        
        const isCompleting = !item.classList.contains("completed");
        if (isCompleting) {
            const checkbox = item.querySelector(".task-checkbox");
            if (checkbox) {
                const rect = checkbox.getBoundingClientRect();
                const x = rect.left + rect.width / 2 + window.scrollX;
                const y = rect.top + rect.height / 2 + window.scrollY;
                createConfettiBurst(x, y);
            }
        }
        
        const taskId = parseInt(item.dataset.id) || item.dataset.id; // handle uuid string or int
        toggleTask(taskId);
    });

    // Exit edit mode on click outside categories bar
    document.addEventListener("click", (e) => {
        if (!isEditMode) return;
        
        // Se o clique for fora da barra de categorias e fora de qualquer modal/diálogo
        const clickedInsideBar = e.target.closest(".categories-bar");
        const clickedInsideModal = e.target.closest(".modal");
        
        if (!clickedInsideBar && !clickedInsideModal) {
            toggleEditMode(false);
        }
    });

    // Edit Organization Name Inline
    orgTagEl.addEventListener("click", () => {
        const currentName = orgTagEl.textContent;
        const newName = prompt("Editar nome da organização:", currentName);
        if (newName && newName.trim()) {
            const trimmed = newName.trim();
            orgTagEl.textContent = trimmed;
            inputOrgName.value = trimmed;
            localStorage.setItem("checklist_org_name", trimmed);
        }
    });

    // Settings Modal
    btnManageTasks.addEventListener("click", () => openModal(modalManageTasks));
    btnCloseManageModal.addEventListener("click", () => closeModal(modalManageTasks));

    // Save Settings Inputs
    inputOrgName.addEventListener("input", (e) => {
        const val = e.target.value.trim() || "Checklist Organizacional";
        orgTagEl.textContent = val;
        localStorage.setItem("checklist_org_name", val);
    });

    // Add New Category (Settings Modal)
    btnAddCategory.addEventListener("click", async () => {
        const val = inputNewCategory.value.trim();
        if (val) {
            if (btnAddCategory.disabled) return;
            btnAddCategory.disabled = true;
            const originalText = btnAddCategory.innerHTML;
            btnAddCategory.innerHTML = "Salvando...";

            try {
                await addCategory(val);
                inputNewCategory.value = "";
            } finally {
                btnAddCategory.disabled = false;
                btnAddCategory.innerHTML = originalText;
            }
        }
    });

    // Add Task Modal
    btnAddTaskModal.addEventListener("click", () => {
        if (isHistoryMode) {
            alert("Não é possível adicionar tarefas no histórico.");
            return;
        }
        if (categories.length === 0) {
            alert("Cadastre pelo menos uma categoria/local nas configurações antes de adicionar tarefas.");
            return;
        }

        // Pré-selecionar a categoria/local atualmente ativo na barra de filtros
        if (currentFilter !== "all") {
            selectTaskCategory.value = currentFilter;
        } else if (categories.length > 0) {
            selectTaskCategory.value = categories[0].name;
        }

        // Atualiza as opções de atribuição com base no local selecionado
        updateTaskAssigneeDropdown(selectTaskCategory.value, selectTaskAssignedTo, taskAssigneeGroup);

        // Pré-definir a data da tarefa com a data atualmente selecionada no calendário
        const taskDateInput = document.getElementById("task-date");
        if (taskDateInput) {
            taskDateInput.value = selectedDate;
        }

        openModal(modalAddTask);
    });
    btnCloseAddModal.addEventListener("click", () => closeModal(modalAddTask));

    if (selectTaskCategory) {
        selectTaskCategory.addEventListener("change", () => {
            updateTaskAssigneeDropdown(selectTaskCategory.value, selectTaskAssignedTo, taskAssigneeGroup);
        });
    }

    // Form Add Task Submit
    // Toggle repeat days visibility
    selectTaskRecurring.addEventListener("change", () => {
        const repeatGroup = document.getElementById("repeat-days-group");
        if (selectTaskRecurring.value === "repeat") {
            repeatGroup.style.display = "block";
        } else {
            repeatGroup.style.display = "none";
        }
    });

    // Day toggle buttons (only for the Add Task modal)
    document.querySelectorAll("#repeat-days-group .day-toggle").forEach(btn => {
        btn.addEventListener("click", () => {
            btn.classList.toggle("active");
        });
    });

    formAddTask.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btnSubmit = formAddTask.querySelector("button[type='submit']");
        if (!btnSubmit || btnSubmit.disabled) return;
        
        btnSubmit.disabled = true;
        const originalText = btnSubmit.innerHTML;
        btnSubmit.innerHTML = `<span class="loading-spinner"></span> Salvando...`;

        const taskDateInput = document.getElementById("task-date");
        const taskDate = taskDateInput ? taskDateInput.value : null;

        // Collect repeat days
        let repeatDays = null;
        if (selectTaskRecurring.value === "repeat") {
            const selectedDays = Array.from(document.querySelectorAll("#repeat-days-group .day-toggle.active")).map(b => parseInt(b.dataset.day));
            if (selectedDays.length === 0) {
                alert("Selecione pelo menos um dia da semana para repetir.");
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = originalText;
                return;
            }
            repeatDays = selectedDays;
        }

        try {
            const assignedTo = selectTaskAssignedTo ? selectTaskAssignedTo.value : null;
            await addTask(inputTaskTitle.value.trim(), selectTaskCategory.value, selectTaskRecurring.value, taskDate, repeatDays, assignedTo);
            inputTaskTitle.value = "";
            // Reset day toggles
            document.querySelectorAll("#repeat-days-group .day-toggle").forEach(b => b.classList.remove("active"));
            document.getElementById("repeat-days-group").style.display = "none";
            selectTaskRecurring.value = "daily";
            closeModal(modalAddTask);
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = originalText;
        }
    });

    // Edit Task Modal listeners
    const modalEditTask = document.getElementById("modal-edit-task");
    const btnCloseEditModal = document.getElementById("btn-close-edit-modal");
    const formEditTask = document.getElementById("form-edit-task");
    const editRecurringSelect = document.getElementById("edit-task-recurring");

    btnCloseEditModal.addEventListener("click", () => closeModal(modalEditTask));

    editRecurringSelect.addEventListener("change", () => {
        const group = document.getElementById("edit-repeat-days-group");
        group.style.display = editRecurringSelect.value === "repeat" ? "block" : "none";
    });

    document.querySelectorAll(".edit-day-toggle").forEach(btn => {
        btn.addEventListener("click", () => {
            btn.classList.toggle("active");
        });
    });

    formEditTask.addEventListener("submit", async (e) => {
        e.preventDefault();
        const taskId = document.getElementById("edit-task-id").value;
        const newTitle = document.getElementById("edit-task-title").value.trim();
        const recMode = editRecurringSelect.value;
        const newDate = document.getElementById("edit-task-date").value;

        if (!newTitle) return;

        const isRecurring = recMode !== "once";
        let repeatDays = null;

        if (recMode === "repeat") {
            const selectedDays = Array.from(document.querySelectorAll(".edit-day-toggle.active")).map(b => parseInt(b.dataset.day));
            if (selectedDays.length === 0) {
                alert("Selecione pelo menos um dia da semana.");
                return;
            }
            repeatDays = selectedDays;
        }

        const createdAt = newDate ? new Date(newDate + "T12:00:00").toISOString() : undefined;

        const assignedTo = selectEditTaskAssignedTo ? selectEditTaskAssignedTo.value : null;

        const updates = {
            title: newTitle,
            is_recurring: isRecurring,
            repeat_days: repeatDays,
            assigned_to: assignedTo || null
        };
        if (createdAt) updates.created_at = createdAt;

        // Parse ID (handle uuid string or int)
        const parsedId = parseInt(taskId) || taskId;
        await updateTask(parsedId, updates);
        closeModal(modalEditTask);
    });

    // Notifications Modal Events
    if (btnNotifications) {
        btnNotifications.addEventListener("click", () => {
            if (notificationsBadge) {
                notificationsBadge.style.display = "none";
                localStorage.setItem("notifications_badge_read", "true");
            }
            renderNotifications();
            openModal(modalNotifications);
        });
    }

    if (btnCloseNotificationsModal) {
        btnCloseNotificationsModal.addEventListener("click", () => {
            closeModal(modalNotifications);
        });
    }

    // Restore default database state
    btnResetDefault.addEventListener("click", async () => {
        if (confirm("Atenção: Isso restaurará as categorias (Tio Nan, Cassol, PUCRS) e tarefas padrão. O histórico anterior será mantido. Continuar?")) {
            await restoreDefaultSettings();
            closeModal(modalManageTasks);
        }
    });

    // Clear all tasks
    btnClearAll.addEventListener("click", async () => {
        if (confirm("Atenção: Isso ocultará todas as tarefas atuais. Suas categorias e histórico serão mantidos. Deseja continuar?")) {
            await clearAllTasks();
            closeModal(modalManageTasks);
        }
    });

    // Share report via WhatsApp
    btnShareReport.addEventListener("click", shareReport);

    // Theme Selection Event Listeners
    const themeBtns = document.querySelectorAll(".theme-selector-btn");
    themeBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            applyTheme(btn.dataset.theme);
            renderChecklist();
        });
    });

    // Auth Listeners & Forms
    const formAuth = document.getElementById("form-auth");
    const inputAuthEmail = document.getElementById("auth-email");
    const inputAuthPassword = document.getElementById("auth-password");
    const btnAuthSubmit = document.getElementById("btn-auth-submit");
    const btnAuthToggle = document.getElementById("btn-auth-toggle");
    const authTitle = document.getElementById("auth-title");
    const authSubtitle = document.getElementById("auth-subtitle");
    const authErrorMsg = document.getElementById("auth-error-msg");
    const btnLogout = document.getElementById("btn-logout");

    if (btnAuthToggle) {
        btnAuthToggle.addEventListener("click", () => {
            isAuthModeLogin = !isAuthModeLogin;
            authErrorMsg.style.display = "none";
            
            if (isAuthModeLogin) {
                authTitle.textContent = "Checklist Nuvem";
                authSubtitle.textContent = "Entre com seus dados para sincronizar suas tarefas e locais com segurança.";
                btnAuthSubmit.textContent = "Entrar";
                document.getElementById("auth-toggle-text").textContent = "Não tem uma conta?";
                btnAuthToggle.textContent = "Cadastre-se";
            } else {
                authTitle.textContent = "Criar Conta";
                authSubtitle.textContent = "Cadastre-se gratuitamente para manter seu checklist salvo na nuvem.";
                btnAuthSubmit.textContent = "Cadastrar Conta";
                document.getElementById("auth-toggle-text").textContent = "Já tem uma conta?";
                btnAuthToggle.textContent = "Fazer Login";
            }
        });
    }

    if (formAuth) {
        formAuth.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!supabaseClient) {
                alert("Erro: Conexão com Supabase não disponível.");
                return;
            }

            authErrorMsg.style.display = "none";
            btnAuthSubmit.disabled = true;
            const originalText = btnAuthSubmit.innerHTML;
            btnAuthSubmit.innerHTML = `<span class="loading-spinner"></span> Carregando...`;

            const email = inputAuthEmail.value.trim();
            const password = inputAuthPassword.value;

            try {
                if (isAuthModeLogin) {
                    const { error } = await supabaseClient.auth.signInWithPassword({
                        email,
                        password
                    });
                    if (error) throw error;
                } else {
                    const { data, error } = await supabaseClient.auth.signUp({
                        email,
                        password
                    });
                    if (error) throw error;
                    
                    // Se o Supabase retornar uma sessão imediatamente (confirmação desativada), loga automático!
                    if (data && data.session) {
                        // O onAuthStateChange cuidará do resto
                    } else {
                        alert("Conta criada com sucesso! Faça login para começar.");
                        isAuthModeLogin = true;
                        btnAuthToggle.click();
                    }
                }
            } catch (error) {
                console.error("Erro na autenticação:", error);
                authErrorMsg.textContent = error.message || "Erro desconhecido. Verifique suas credenciais.";
                authErrorMsg.style.display = "block";
            } finally {
                btnAuthSubmit.disabled = false;
                btnAuthSubmit.innerHTML = originalText;
            }
        });
    }

    if (btnLogout) {
        btnLogout.addEventListener("click", async () => {
            if (confirm("Deseja sair da sua conta?")) {
                if (supabaseClient) {
                    // Limpa todo o cache local do usuário anterior para evitar contaminação
                    localStorage.removeItem("offline_categories");
                    localStorage.removeItem("offline_tasks");
                    localStorage.removeItem("offline_completions");
                    
                    await supabaseClient.auth.signOut();
                    closeModal(modalManageTasks);
                }
            }
        });
    }

    // Custom Delete Confirmation Modal Actions
    const handleConfirmDeleteChoice = (choice) => {
        closeModal(modalConfirmDelete);
        if (confirmDeleteCallback) {
            confirmDeleteCallback(choice);
            confirmDeleteCallback = null;
        }
    };

    if (btnConfirmDeleteCancel) btnConfirmDeleteCancel.addEventListener("click", () => handleConfirmDeleteChoice("cancel"));
    if (btnConfirmDeleteOk) btnConfirmDeleteOk.addEventListener("click", () => handleConfirmDeleteChoice("all"));
    if (btnConfirmDeleteRecurringToday) btnConfirmDeleteRecurringToday.addEventListener("click", () => handleConfirmDeleteChoice("today"));
    if (btnConfirmDeleteRecurringAll) btnConfirmDeleteRecurringAll.addEventListener("click", () => handleConfirmDeleteChoice("all"));
    if (btnConfirmDeleteRecurringCancel) btnConfirmDeleteRecurringCancel.addEventListener("click", () => handleConfirmDeleteChoice("cancel"));

    // Collaborators Modal Events
    if (btnCloseCollaboratorsModal) {
        btnCloseCollaboratorsModal.addEventListener("click", () => {
            closeModal(modalCollaborators);
        });
    }

    if (btnAddCollab) {
        btnAddCollab.addEventListener("click", () => {
            const catId = parseInt(collabCategoryId.value) || collabCategoryId.value;
            const email = inputCollabEmail.value;
            inviteCollaborator(catId, email);
        });
    }

    if (inputCollabEmail) {
        inputCollabEmail.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                const catId = parseInt(collabCategoryId.value) || collabCategoryId.value;
                const email = inputCollabEmail.value;
                inviteCollaborator(catId, email);
            }
        });
    }

    // Habilita deslize para baixo (swipe-down-to-close) em todos os modais
    document.querySelectorAll(".modal").forEach(setupModalSwipeToClose);
}

// ----------------------------------------------------
// Connection setup
// ----------------------------------------------------
function connectSupabase() {
    if (SUPABASE_URL && SUPABASE_KEY) {
        try {
            if (typeof supabase !== 'undefined') {
                supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
                console.log("Supabase conectado com chaves fixas.");
            } else {
                console.warn("Script SDK Supabase não carregado.");
                supabaseClient = null;
            }
        } catch (e) {
            console.error("Falha ao criar cliente Supabase: ", e);
            supabaseClient = null;
        }
    } else {
        supabaseClient = null;
    }
}

// ----------------------------------------------------
// UI Logic & Rendering
// ----------------------------------------------------
function updateDateDisplay() {
    const dateObj = new Date(selectedDate + "T12:00:00"); // Evita problemas de fuso horário
    const day = dateObj.getDate();
    
    // Nomes abreviados em português
    const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const abbreviatedDay = dayNames[dateObj.getDay()];
    
    const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    const abbreviatedMonth = monthNames[dateObj.getMonth()];
    
    const year = dateObj.getFullYear();
    
    // Formato: "Ter, 14 Jul 2026"
    const dateString = `${abbreviatedDay}, ${day} ${abbreviatedMonth} ${year}`;
    currentDateEl.textContent = dateString;
}

async function loadChecklistAndProgress() {
    await loadData();
    renderCategories();
    renderChecklist();
    updateProgress();
    checkAutomaticReports();

    if (pendingInvites.length > 0 && notificationsBadge) {
        notificationsBadge.style.display = "block";
    }
}

async function loadData() {
    if (supabaseClient && currentUser) {
        try {
            // Executa as consultas ao banco de dados em paralelo usando Promise.all para máxima velocidade de carregamento
            const [
                catsResult,
                countResult,
                tasksResult,
                compTodayResult,
                compBeforeResult,
                sharesResult
            ] = await Promise.all([
                supabaseClient.from('categories').select('*').eq('is_active', true),
                supabaseClient.from('categories').select('*', { count: 'exact', head: true }),
                supabaseClient.from('tasks').select('*').eq('is_active', true),
                supabaseClient.from('completions').select('*').eq('date', selectedDate),
                supabaseClient.from('completions').select('task_id').lt('date', selectedDate),
                supabaseClient.from('category_shares').select('*').or(`owner_id.eq.${currentUser.id},collaborator_email.eq.${currentUser.email}`).then(r => r, err => {
                    console.warn("Tabela 'category_shares' não encontrada ou inacessível.", err);
                    return { data: [], error: null };
                })
            ]);

            let dbCats = catsResult.data || [];
            const errCats = catsResult.error;
            
            const count = countResult.count;
            const errCount = countResult.error;
            
            const dbTasks = tasksResult.data || [];
            const errTasks = tasksResult.error;
            
            const dbCompletionsToday = compTodayResult.data || [];
            const errCompToday = compTodayResult.error;
            
            const dbCompletionsBefore = compBeforeResult.data || [];
            const errCompBefore = compBeforeResult.error;

            if (errCats) throw errCats;
            if (errTasks) throw errTasks;
            if (errCompToday) throw errCompToday;
            if (errCompBefore) throw errCompBefore;

            // Salva os compartilhamentos carregados na sessão
            categoryShares = (sharesResult && sharesResult.data) ? sharesResult.data : [];
            localStorage.setItem("offline_category_shares", JSON.stringify(categoryShares));

            // Filtra os convites pendentes recebidos
            pendingInvites = categoryShares.filter(s => s.collaborator_email === currentUser.email && s.accepted !== true);

            // Busca as categorias compartilhadas comigo (aceitas e pendentes)
            const allSharedShares = categoryShares.filter(s => s.collaborator_email === currentUser.email && s.owner_id !== currentUser.id);
            const allSharedCatIds = allSharedShares.map(s => s.category_id);
            
            if (allSharedCatIds.length > 0) {
                try {
                    const { data: sharedCats, error: errSharedCats } = await supabaseClient
                        .from('categories')
                        .select('*')
                        .in('id', allSharedCatIds)
                        .eq('is_active', true);
                    if (!errSharedCats && sharedCats) {
                        // 1. Vincula o nome da categoria nos convites pendentes
                        pendingInvites.forEach(invite => {
                            const catObj = sharedCats.find(c => c.id === invite.category_id);
                            invite.category_name = catObj ? catObj.name : "Guia Compartilhada";
                        });

                        // 2. Mescla apenas as categorias que já foram aceitas
                        const acceptedCatIds = collaboratorShares.map(s => s.category_id);
                        sharedCats.forEach(sc => {
                            if (acceptedCatIds.includes(sc.id) && !dbCats.some(c => c.id === sc.id)) {
                                dbCats.push(sc);
                            }
                        });
                    }
                } catch (err) {
                    console.error("Erro ao carregar categorias compartilhadas:", err);
                }
            }
            
            // Seed default categories ONLY if the user has absolutely ZERO categories in their account (active or inactive)
            if (!errCount && count === 0) {
                const seedCats = DEFAULT_CATEGORIES.map(name => ({ 
                    name, 
                    is_active: true,
                    user_id: currentUser ? currentUser.id : null
                }));
                const { data: seededCats, error: errSeedCats } = await supabaseClient
                    .from('categories')
                    .upsert(seedCats, { onConflict: 'name,user_id' })
                    .select();
                if (errSeedCats) throw errSeedCats;
                dbCats = seededCats;

                // Seed default tasks (in our case it's empty by default, but kept for structure)
                if (DEFAULT_TASKS.length > 0) {
                    const seedTasks = DEFAULT_TASKS.map(t => ({
                        title: t.title,
                        category: t.category,
                        is_recurring: t.is_recurring,
                        is_active: true,
                        user_id: currentUser ? currentUser.id : null
                    }));
                    await supabaseClient.from('tasks').insert(seedTasks);
                }
            }
            categories = dbCats;
            allActiveTasks = dbTasks || [];

            const completedBeforeIds = new Set(dbCompletionsBefore.map(c => c.task_id));
            const completedTodayIds = new Set(dbCompletionsToday.filter(c => c.completed === true).map(c => c.task_id));
            const excludedTodayIds = new Set(dbCompletionsToday.filter(c => c.completed === false).map(c => c.task_id));

            // Map tasks with Rollover and Recurrence
            tasks = dbTasks.filter(task => {
                if (excludedTodayIds.has(task.id)) return false;
                
                const taskCreatedDate = extractDateFromTimestamp(task.created_at);
                
                if (task.is_recurring) {
                    if (task.repeat_days && task.repeat_days.length > 0) {
                        // Tarefas com dias específicos de repetição
                        const viewDate = new Date(selectedDate + 'T12:00:00');
                        const dayOfWeek = viewDate.getDay(); // 0=Dom, 1=Seg...
                        const repeatDaysNum = task.repeat_days.map(Number);
                        return taskCreatedDate <= selectedDate && repeatDaysNum.includes(dayOfWeek);
                    }
                    // Tarefas diárias aparecem a partir da data de criação
                    return taskCreatedDate <= selectedDate;
                } else {
                    // Tarefas únicas aparecem estritamente no dia para o qual foram programadas
                    return taskCreatedDate === selectedDate;
                }
            }).map(task => ({
                id: task.id,
                title: task.title,
                category: task.category,
                is_recurring: task.is_recurring,
                repeat_days: task.repeat_days || null,
                context: task.context || null,
                assigned_to: task.assigned_to || null,
                completed: completedTodayIds.has(task.id)
            }));

        } catch (error) {
            console.error("Erro ao consultar Supabase. Usando fallback offline.", error);
            loadDataOffline();
        }
    } else {
        loadDataOffline();
    }
}

function loadDataOffline() {
    categoryShares = JSON.parse(localStorage.getItem("offline_category_shares")) || [];
    pendingInvites = [];
    let localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    const isSeeded = localStorage.getItem("checklist_categories_seeded");
    if (localCats.length === 0 && !isSeeded) {
        localCats = DEFAULT_CATEGORIES.map((name, i) => ({
            id: i + 1,
            name: name,
            is_active: true
        }));
        localStorage.setItem("checklist_categories_seeded", "true");
        localStorage.setItem("offline_categories", JSON.stringify(localCats));
    }
    categories = localCats.filter(c => c.is_active);

    // 2. Fetch tasks offline
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    if (localTasks.length === 0) {
        localTasks = DEFAULT_TASKS.map((t, i) => ({
            id: i + 1,
            title: t.title,
            category: t.category,
            is_recurring: true,
            is_active: true,
            created_at: new Date().toISOString()
        }));
        localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
    }
    allActiveTasks = localTasks || [];

    // 3. Fetch completions
    let localCompletions = JSON.parse(localStorage.getItem("offline_completions")) || [];

    const completedBeforeIds = new Set(
        localCompletions.filter(c => c.date < selectedDate && c.completed === true).map(c => c.task_id)
    );
    const completedTodayIds = new Set(
        localCompletions.filter(c => c.date === selectedDate && c.completed === true).map(c => c.task_id)
    );
    const excludedTodayIds = new Set(
        localCompletions.filter(c => c.date === selectedDate && c.completed === false).map(c => c.task_id)
    );

    // Map tasks
    tasks = localTasks.filter(task => {
        if (!task.is_active) return false;
        if (excludedTodayIds.has(task.id)) return false;
        
        const taskCreatedDate = extractDateFromTimestamp(task.created_at);
        
        if (task.is_recurring) {
            if (task.repeat_days && task.repeat_days.length > 0) {
                const viewDate = new Date(selectedDate + 'T12:00:00');
                const dayOfWeek = viewDate.getDay();
                const repeatDaysNum = task.repeat_days.map(Number);
                return taskCreatedDate <= selectedDate && repeatDaysNum.includes(dayOfWeek);
            }
            return taskCreatedDate <= selectedDate;
        } else {
            return taskCreatedDate === selectedDate;
        }
    }).map(task => ({
        id: task.id,
        title: task.title,
        category: task.category,
        is_recurring: task.is_recurring,
        repeat_days: task.repeat_days || null,
        context: task.context || null,
        assigned_to: task.assigned_to || null,
        completed: completedTodayIds.has(task.id)
    }));
}

function renderCategories() {
    const bar = document.getElementById("categories-bar");
    const select = document.getElementById("task-category");
    const manageList = document.getElementById("manage-categories-list");

    // 1. Render Category Filter Chips
    const activeCategory = currentFilter;
    bar.innerHTML = "";

    const allChip = document.createElement("button");
    allChip.className = `category-chip ${activeCategory === 'all' ? 'active' : ''}`;
    allChip.dataset.category = "all";
    allChip.innerHTML = `
        <i data-lucide="layers" class="chip-icon"></i>
        <span>Todos</span>
    `;
    
    allChip.addEventListener("click", () => {
        if (isEditMode) {
            toggleEditMode(false);
        }
        document.querySelectorAll(".category-chip").forEach(c => c.classList.remove("active"));
        allChip.classList.add("active");
        currentFilter = "all";
        renderChecklist();
    });
    bar.appendChild(allChip);

    categories.forEach(cat => {
        const chip = document.createElement("button");
        chip.className = `category-chip ${activeCategory === cat.name ? 'active' : ''}`;
        chip.dataset.category = cat.name;
        chip.innerHTML = `
            <i data-lucide="map-pin" class="chip-icon"></i>
            <span>${escapeHTML(cat.name)}</span>
        `;

        if (isEditMode) {
            chip.setAttribute("draggable", "true");
            setupDragAndDrop(chip, cat);
        }
        
        // Detecta gesto de segurar (Long-press de 800ms) para ativar a reordenação das guias
        let pressTimer;
        const startPress = () => {
            if (isEditMode) return;
            pressTimer = setTimeout(() => {
                toggleEditMode(true);
            }, 800);
        };
        const cancelPress = () => {
            if (pressTimer) clearTimeout(pressTimer);
        };

        chip.addEventListener("mousedown", startPress);
        chip.addEventListener("mouseup", cancelPress);
        chip.addEventListener("mouseleave", cancelPress);
        chip.addEventListener("touchstart", startPress, { passive: true });
        chip.addEventListener("touchend", cancelPress, { passive: true });
        chip.addEventListener("touchmove", cancelPress, { passive: true });
        
        chip.addEventListener("click", () => {
            if (isEditMode) {
                // Clicar em qualquer guia durante a edição conclui e filtra
                toggleEditMode(false);
            }
            document.querySelectorAll(".category-chip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            currentFilter = cat.name;
            renderChecklist();
        });
        bar.appendChild(chip);
    });

    // 2. Render options in task category dropdown
    select.innerHTML = "";
    categories.forEach(cat => {
        const opt = document.createElement("option");
        opt.value = cat.name;
        opt.textContent = cat.name;
        select.appendChild(opt);
    });

    // 3. Render categories list in Settings Modal
    manageList.innerHTML = "";
    if (categories.length === 0) {
        manageList.innerHTML = `<p style="font-size:0.8rem; color:var(--text-muted); text-align:center; padding: 10px;">Nenhum local cadastrado.</p>`;
    } else {
        categories.forEach(cat => {
            const item = document.createElement("div");
            item.className = "manage-item";
            item.style.cssText = "background:rgba(255,255,255,0.02); border:1px solid var(--border-color); padding:10px 14px; border-radius:var(--radius-sm); display:flex; justify-content:space-between; align-items:center;";
            
            const isOwner = currentUser && cat.user_id === currentUser.id;
            let collabBtnHtml = "";
            if (currentUser) {
                collabBtnHtml = `
                    <button class="btn-collab-cat" data-id="${cat.id}" style="background:transparent; border:none; color:var(--primary); cursor:pointer; padding:4px; border-radius:4px; transition:var(--transition-smooth); display:flex; align-items:center; justify-content:center; margin-right: 8px;" title="Colaboradores">
                        <i data-lucide="users" style="width:14px; height:14px; color: var(--primary);"></i>
                    </button>
                `;
            }

            item.innerHTML = `
                <span style="font-size:0.88rem; font-weight:600;">${escapeHTML(cat.name)}</span>
                <div style="display:flex; align-items:center;">
                    ${collabBtnHtml}
                    <button class="btn-delete-cat" data-id="${cat.id}" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:4px; border-radius:4px; transition:var(--transition-smooth); display:flex; align-items:center; justify-content:center;">
                        <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
                    </button>
                </div>
            `;
            
            const btnDel = item.querySelector(".btn-delete-cat");
            btnDel.addEventListener("click", (e) => {
                e.stopPropagation();
                deleteCategory(cat.id);
            });

            if (currentUser) {
                const btnCollab = item.querySelector(".btn-collab-cat");
                if (btnCollab) {
                    btnCollab.addEventListener("click", (e) => {
                        e.stopPropagation();
                        openCollaboratorsModal(cat);
                    });
                }
            }
            
            manageList.appendChild(item);
        });
    }
}

function renderChecklist() {
    tasksListEl.innerHTML = "";
    
    // Filter tasks
    const filteredTasks = tasks.filter(task => {
        if (currentFilter === "all") return true;
        return task.category === currentFilter;
    });

    if (isEditMode) {
        tasksListEl.classList.add("edit-mode");
    } else {
        tasksListEl.classList.remove("edit-mode");
    }

    if (filteredTasks.length === 0) {
        emptyStateEl.classList.remove("hidden");
        tasksListEl.classList.add("hidden");
    } else {
        emptyStateEl.classList.add("hidden");
        tasksListEl.classList.remove("hidden");

        // Sort: unchecked first, completed last. Within groups, sort by ID
        const sortedTasks = isEditMode
            ? [...filteredTasks].sort((a, b) => {
                const idA = typeof a.id === 'number' ? a.id : parseFloat(a.id) || 0;
                const idB = typeof b.id === 'number' ? b.id : parseFloat(b.id) || 0;
                return idA - idB;
            })
            : [...filteredTasks].sort((a, b) => {
                if (a.completed !== b.completed) {
                    return a.completed ? 1 : -1;
                }
                const idA = typeof a.id === 'number' ? a.id : parseFloat(a.id) || 0;
                const idB = typeof b.id === 'number' ? b.id : parseFloat(b.id) || 0;
                return idA - idB;
            });

        sortedTasks.forEach(task => {
            const taskEl = document.createElement("div");
            taskEl.className = `task-item ${task.completed ? 'completed' : ''}`;
            taskEl.dataset.id = task.id;

            // Generate premium dynamic tag style based on category name
            const colorStyle = getCategoryColorStyle(task.category);
            const tagStyle = `color: ${colorStyle.color}; background: ${colorStyle.bg}; border: 1px solid rgba(255,255,255,0.03);`;

            taskEl.innerHTML = `
                <!-- Actions revealed on swipe (underneath) -->
                <div class="task-swipe-actions">
                    <button class="swipe-action-btn rename-btn" title="Renomear">
                        <i data-lucide="pencil"></i>
                    </button>
                    <button class="swipe-action-btn delete-btn" title="Excluir">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
                <!-- Main content of the task (on top) -->
                <div class="task-item-foreground">
                    <div class="task-checkbox-wrapper">
                        <div class="task-checkbox">
                            <i data-lucide="check"></i>
                        </div>
                    </div>
                    <div class="task-content">
                        <span class="task-title">${escapeHTML(task.title)}</span>
                        <div class="task-meta">
                            <span class="task-tag" style="${tagStyle}">${escapeHTML(task.category)}</span>
                            <span class="task-tag" style="background: rgba(255,255,255,0.02);">${getRecurrenceLabel(task)}</span>
                            ${task.assigned_to ? (() => {
                                const initials = task.assigned_to.split('@')[0].substring(0, 2).toUpperCase();
                                const isMe = currentUser && task.assigned_to.toLowerCase() === currentUser.email.toLowerCase();
                                return `<span class="task-assignee-avatar ${isMe ? '' : 'partner'}" title="Atribuído a: ${escapeHTML(task.assigned_to)}">${escapeHTML(initials)}</span>`;
                            })() : ''}
                        </div>
                    </div>
                    <!-- Global edit mode actions -->
                    <div class="task-edit-actions">
                        <button class="btn-task-action rename" title="Renomear">
                            <i data-lucide="pencil"></i>
                        </button>
                        <button class="btn-task-action delete" title="Excluir">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
            `;

            // Setup static button event listeners (visible in global edit mode)
            const btnDelete = taskEl.querySelector(".task-edit-actions .btn-task-action.delete");
            btnDelete.addEventListener("click", (e) => {
                e.stopPropagation();
                showConfirmDelete(task, (choice) => {
                    if (choice !== "cancel") {
                        taskEl.classList.add("deleting");
                        setTimeout(() => {
                            if (choice === "all") {
                                deleteTask(task.id);
                            } else if (choice === "today") {
                                excludeTaskForToday(task.id);
                            }
                        }, 400);
                    }
                });
            });

            const btnRename = taskEl.querySelector(".task-edit-actions .btn-task-action.rename");
            btnRename.addEventListener("click", (e) => {
                e.stopPropagation();
                openEditTaskModal(task);
            });

            // Setup swipe actions buttons (visible on swipe underneath)
            const btnSwipeDelete = taskEl.querySelector(".task-swipe-actions .delete-btn");
            const handleDeleteAction = (e) => {
                e.preventDefault();
                e.stopPropagation();
                showConfirmDelete(task, (choice) => {
                    if (choice === "cancel") {
                        // Se cancelar, fecha o swipe lateral suavemente
                        const fg = taskEl.querySelector(".task-item-foreground");
                        if (fg) {
                            fg.style.transition = "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)";
                            fg.style.transform = "translateX(0px)";
                        }
                        taskEl.classList.remove("swiped");
                    } else {
                        taskEl.classList.add("deleting");
                        setTimeout(() => {
                            if (choice === "all") {
                                deleteTask(task.id);
                            } else if (choice === "today") {
                                excludeTaskForToday(task.id);
                            }
                        }, 400);
                    }
                });
            };
            btnSwipeDelete.addEventListener("click", handleDeleteAction);
            btnSwipeDelete.addEventListener("touchend", handleDeleteAction, { passive: false });

            const btnSwipeRename = taskEl.querySelector(".task-swipe-actions .rename-btn");
            const handleRenameAction = (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Close swipe panel
                const fg = taskEl.querySelector(".task-item-foreground");
                if (fg) {
                    fg.style.transition = "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)";
                    fg.style.transform = "translateX(0px)";
                }
                taskEl.classList.remove("swiped");
                openEditTaskModal(task);
            };
            btnSwipeRename.addEventListener("click", handleRenameAction);
            btnSwipeRename.addEventListener("touchend", handleRenameAction, { passive: false });

            // Attach swipe-to-reveal gestures
            setupSwipeToReveal(taskEl);

            tasksListEl.appendChild(taskEl);
        });
        
        lucide.createIcons();
    }

}

function renderChecklistWithAnimation() {
    // 1. FIRST
    const items = Array.from(tasksListEl.children);
    const firstPositions = {};
    items.forEach(item => {
        const id = item.dataset.id;
        if (id) {
            firstPositions[id] = item.getBoundingClientRect();
        }
    });

    // 2. State change (render DOM)
    renderChecklist();

    // 3. LAST, INVERT & PLAY
    const newItems = Array.from(tasksListEl.children);
    newItems.forEach(item => {
        const id = item.dataset.id;
        if (id && firstPositions[id]) {
            const firstRect = firstPositions[id];
            const lastRect = item.getBoundingClientRect();
            const deltaY = firstRect.top - lastRect.top;

            if (deltaY !== 0) {
                item.style.transition = 'none';
                item.style.transform = `translateY(${deltaY}px)`;
                item.offsetHeight; // force reflow

                item.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
                item.style.transform = 'translateY(0)';
                
                item.addEventListener('transitionend', function cleanup() {
                    item.style.transition = '';
                    item.style.transform = '';
                    item.removeEventListener('transitionend', cleanup);
                });
            }
        }
    });
}

function updateProgress() {
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);

    // Update text
    progressPercentageEl.textContent = `${percentage}%`;
    progressTasksCountEl.textContent = `${completed} de ${total} concluídos`;

    // Update Linear progress bar
    progressBarFill.style.width = `${percentage}%`;

    // Update Circular progress ring
    const radius = 32;
    const circumference = 2 * Math.PI * radius;
    progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
    
    const offset = circumference - (percentage / 100) * circumference;
    progressCircle.style.strokeDashoffset = offset;

    if (percentage === 100 && total > 0) {
        progressRingWrapper.classList.add("completed");
    } else {
        progressRingWrapper.classList.remove("completed");
    }
}

// ----------------------------------------------------
// State Management & Storage
// ----------------------------------------------------
async function toggleTask(id) {
    if (isHistoryMode) return;
    
    // Prevent duplicate triggers if request is already in progress
    if (pendingToggles.has(id)) return;
    pendingToggles.add(id);

    // Toggle local state immediately for visual response
    tasks = tasks.map(t => {
        if (String(t.id) === String(id)) return { ...t, completed: !t.completed };
        return t;
    });
    updateProgress();
    renderChecklistWithAnimation();
    
    if (navigator.vibrate) {
        navigator.vibrate(12);
    }

    const task = tasks.find(t => String(t.id) === String(id));
    if (!task) {
        pendingToggles.delete(id);
        return;
    }

    if (supabaseClient) {
        try {
            if (task.completed) {
                const { error } = await supabaseClient
                    .from('completions')
                    .upsert({
                        task_id: id,
                        date: selectedDate,
                        completed: true
                    }, { onConflict: 'task_id,date' });
                if (error) throw error;
            } else {
                const { error } = await supabaseClient
                    .from('completions')
                    .delete()
                    .eq('task_id', id)
                    .eq('date', selectedDate);
                if (error) throw error;
            }
        } catch (error) {
            console.error("Erro ao atualizar conclusão no Supabase. Salvando offline.", error);
            saveCompletionOffline(id, selectedDate, task.completed);
        } finally {
            pendingToggles.delete(id);
        }
    } else {
        saveCompletionOffline(id, selectedDate, task.completed);
        pendingToggles.delete(id);
    }
}

function saveCompletionOffline(taskId, date, completed) {
    let localCompletions = JSON.parse(localStorage.getItem("offline_completions")) || [];
    localCompletions = localCompletions.filter(c => !(String(c.task_id) === String(taskId) && c.date === date));
    
    if (completed) {
        localCompletions.push({
            task_id: taskId,
            date: date,
            completed: true
        });
    }
    localStorage.setItem("offline_completions", JSON.stringify(localCompletions));
}

async function addTask(title, category, recurrenceMode, customDate, repeatDays, assignedTo) {
    if (!title) return;
    const isRecurring = recurrenceMode !== "once";
    const tempId = Date.now();
    
    // Evita problemas de fuso horário definindo a data ao meio-dia
    const createdAtDate = customDate ? new Date(customDate + "T12:00:00") : new Date();
    const createdAt = createdAtDate.toISOString();

    const context = analyzeTaskContext(title, category, tasks);
    console.log(`%c[Motor de Contexto] Tarefa: "${title}" na guia "${category}"`, "color: #8b5cf6; font-weight: bold;", context);

    const newTask = {
        title: title,
        category: category,
        is_recurring: isRecurring,
        is_active: true,
        created_at: createdAt
    };
    if (repeatDays) {
        newTask.repeat_days = repeatDays;
    }
    if (context) {
        newTask.context = context;
    }
    if (assignedTo) {
        newTask.assigned_to = assignedTo;
    }
    if (currentUser) {
        newTask.user_id = currentUser.id;
    }

    if (supabaseClient) {
        try {
            let { error } = await supabaseClient
                .from('tasks')
                .insert(newTask);
            
            if (error) {
                console.warn("Falha ao inserir tarefa completa no Supabase. Tentando fallbacks...", error.message);
                const fallbackTask = { ...newTask };
                
                // 1. Tenta sem o campo assigned_to (se ele existia)
                if (fallbackTask.assigned_to !== undefined) {
                    delete fallbackTask.assigned_to;
                    const res = await supabaseClient.from('tasks').insert(fallbackTask);
                    error = res.error;
                }

                // 2. Tenta sem o campo context (se ele existia)
                if (error && fallbackTask.context) {
                    delete fallbackTask.context;
                    const res = await supabaseClient.from('tasks').insert(fallbackTask);
                    error = res.error;
                }
                
                // 3. Se ainda falhar e tiver repeat_days, tenta sem repeat_days
                if (error && fallbackTask.repeat_days) {
                    delete fallbackTask.repeat_days;
                    const res = await supabaseClient.from('tasks').insert(fallbackTask);
                    error = res.error;
                }
                
                if (error) throw error;
            }
            
            await loadChecklistAndProgress();
        } catch (error) {
            console.error("Erro ao inserir no Supabase.", error);
            // Adicionar à lista em memória SEM substituir as tarefas existentes
            const inMemoryTask = {
                id: tempId,
                title: title,
                category: category,
                is_recurring: isRecurring,
                repeat_days: repeatDays || null,
                context: context || null,
                completed: false
            };
            if (assignedTo) {
                inMemoryTask.assigned_to = assignedTo;
            }
            tasks.push(inMemoryTask);
            renderChecklist();
            updateProgress();
        }
    } else {
        addTaskOffline(title, category, isRecurring, tempId, createdAt, repeatDays, context, assignedTo);
    }
}

function addTaskOffline(title, category, isRecurring, id, createdAt, repeatDays, context, assignedTo) {
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    const task = {
        id: id,
        title: title,
        category: category,
        is_recurring: isRecurring,
        is_active: true,
        created_at: createdAt
    };
    if (repeatDays) {
        task.repeat_days = repeatDays;
    }
    if (context) {
        task.context = context;
    }
    if (assignedTo) {
        task.assigned_to = assignedTo;
    }
    localTasks.push(task);
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
    
    loadDataOffline();
    renderChecklist();
    updateProgress();
}

async function renameTask(id, newTitle) {
    if (!newTitle) return;

    const existingTask = tasks.find(t => String(t.id) === String(id));
    const category = existingTask ? existingTask.category : "";
    const context = analyzeTaskContext(newTitle, category, tasks);

    // Atualização otimista local imediata
    tasks = tasks.map(t => {
        if (String(t.id) === String(id)) return { ...t, title: newTitle, context: context || null };
        return t;
    });
    renderChecklist();

    if (supabaseClient) {
        try {
            const updates = { title: newTitle };
            if (context) updates.context = context;
            
            let { error } = await supabaseClient
                .from('tasks')
                .update(updates)
                .eq('id', id);
            
            if (error) {
                // Se falhar com context, tentar sem
                if (updates.context) {
                    delete updates.context;
                    const res = await supabaseClient.from('tasks').update(updates).eq('id', id);
                    error = res.error;
                }
                if (error) throw error;
            }
            
            await loadChecklistAndProgress();
        } catch (error) {
            console.error("Erro ao renomear no Supabase. Renomeando offline.", error);
            renameTaskOffline(id, newTitle, context);
        }
    } else {
        renameTaskOffline(id, newTitle, context);
    }
}

function renameTaskOffline(id, newTitle, context) {
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    localTasks = localTasks.map(t => {
        if (String(t.id) === String(id)) {
            const updated = { ...t, title: newTitle };
            if (context) updated.context = context;
            return updated;
        }
        return t;
    });
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
    
    loadDataOffline();
    renderChecklist();
}

// Full task update (title, date, recurrence, repeat_days)
async function updateTask(id, updates) {
    const existingTask = tasks.find(t => String(t.id) === String(id));
    
    // Analyze new context if title is being updated
    if (updates.title !== undefined) {
        const category = existingTask ? existingTask.category : "";
        const context = analyzeTaskContext(updates.title, category, tasks);
        console.log(`%c[Motor de Contexto] Edição da Tarefa: "${updates.title}" na guia "${category}"`, "color: #10b981; font-weight: bold;", context);
        if (context) {
            updates.context = context;
        }
    }

    // Otimista local
    tasks = tasks.map(t => {
        if (String(t.id) === String(id)) return { ...t, ...updates };
        return t;
    });
    renderChecklist();
    updateProgress();

    if (supabaseClient) {
        try {
            const dbUpdates = {};
            if (updates.title !== undefined) dbUpdates.title = updates.title;
            if (updates.is_recurring !== undefined) dbUpdates.is_recurring = updates.is_recurring;
            if (updates.repeat_days !== undefined) dbUpdates.repeat_days = updates.repeat_days;
            if (updates.created_at !== undefined) dbUpdates.created_at = updates.created_at;
            if (updates.context !== undefined) dbUpdates.context = updates.context;
            if (updates.assigned_to !== undefined) dbUpdates.assigned_to = updates.assigned_to;

            let { error } = await supabaseClient
                .from('tasks')
                .update(dbUpdates)
                .eq('id', id);
            
            if (error) {
                console.warn("Falha ao atualizar com todos os campos. Tentando fallbacks...", error.message);
                const dbUpdatesFallback = { ...dbUpdates };
                
                // 1. Tenta sem o campo assigned_to se ele existia
                if (dbUpdatesFallback.assigned_to !== undefined) {
                    delete dbUpdatesFallback.assigned_to;
                    const res = await supabaseClient.from('tasks').update(dbUpdatesFallback).eq('id', id);
                    error = res.error;
                }

                // 2. Tenta sem o campo context se ele existia
                if (error && dbUpdatesFallback.context !== undefined) {
                    delete dbUpdatesFallback.context;
                    const res = await supabaseClient.from('tasks').update(dbUpdatesFallback).eq('id', id);
                    error = res.error;
                }
                
                // 3. Se ainda falhar e tiver repeat_days, tenta sem repeat_days
                if (error && dbUpdatesFallback.repeat_days !== undefined) {
                    delete dbUpdatesFallback.repeat_days;
                    const res = await supabaseClient.from('tasks').update(dbUpdatesFallback).eq('id', id);
                    error = res.error;
                }
                
                if (error) throw error;
            }
            
            await loadChecklistAndProgress();
        } catch (error) {
            console.error("Erro ao atualizar tarefa no Supabase.", error);
            // A atualização otimista já mantém o estado visual correto
        }
    } else {
        let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
        localTasks = localTasks.map(t => {
            if (String(t.id) === String(id)) return { ...t, ...updates };
            return t;
        });
        localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
        loadDataOffline();
        renderChecklist();
        updateProgress();
    }
}

// Recurrence label helper
function getRecurrenceLabel(task) {
    if (!task.is_recurring) return 'Única';
    if (task.repeat_days && task.repeat_days.length > 0) {
        const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        if (task.repeat_days.length === 7) return 'Diária';
        return task.repeat_days.map(d => dayNames[Number(d)]).join(', ');
    }
    return 'Diária';
}

// Edit Task Modal
function openEditTaskModal(task) {
    const modalEditTask = document.getElementById("modal-edit-task");
    
    document.getElementById("edit-task-id").value = task.id;
    document.getElementById("edit-task-title").value = task.title;
    
    // Determine recurrence mode
    const editRecurring = document.getElementById("edit-task-recurring");
    const editRepeatGroup = document.getElementById("edit-repeat-days-group");
    
    if (!task.is_recurring) {
        editRecurring.value = "once";
        editRepeatGroup.style.display = "none";
    } else if (task.repeat_days && task.repeat_days.length > 0 && task.repeat_days.length < 7) {
        editRecurring.value = "repeat";
        editRepeatGroup.style.display = "block";
    } else {
        editRecurring.value = "daily";
        editRepeatGroup.style.display = "none";
    }
    
    // Set day toggles
    document.querySelectorAll(".edit-day-toggle").forEach(btn => {
        const day = parseInt(btn.dataset.day);
        if (task.repeat_days && task.repeat_days.map(Number).includes(day)) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
    
    // Set date from created_at
    const editDate = document.getElementById("edit-task-date");
    // We need the original created_at; find from the full task data if available
    // For now use selectedDate as fallback
    editDate.value = selectedDate;

    // Configura e pré-seleciona a atribuição do colaborador
    updateTaskAssigneeDropdown(task.category, selectEditTaskAssignedTo, editTaskAssigneeGroup);
    if (selectEditTaskAssignedTo) {
        selectEditTaskAssignedTo.value = task.assigned_to || "";
    }
    
    openModal(modalEditTask);
    lucide.createIcons();
}

async function deleteTask(id) {
    if (pendingDeletes.has(id)) return;
    pendingDeletes.add(id);

    // Atualização otimista local imediata (remove da lista local antes de bater no banco)
    tasks = tasks.filter(t => String(t.id) !== String(id));
    updateProgress();

    if (supabaseClient) {
        try {
            const { error } = await supabaseClient
                .from('tasks')
                .update({ is_active: false })
                .eq('id', id);
            if (error) throw error;
            
            await loadChecklistAndProgress();
        } catch (error) {
            console.error("Erro ao deletar no Supabase. Deletando offline.", error);
            deleteTaskOffline(id);
        } finally {
            pendingDeletes.delete(id);
        }
    } else {
        deleteTaskOffline(id);
        pendingDeletes.delete(id);
    }
}

function deleteTaskOffline(id) {
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    localTasks = localTasks.map(t => {
        if (String(t.id) === String(id)) return { ...t, is_active: false };
        return t;
    });
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
    
    loadDataOffline();
    renderChecklist();
    updateProgress();
}

async function excludeTaskForToday(id) {
    if (pendingDeletes.has(id)) return;
    pendingDeletes.add(id);

    // Atualização otimista local imediata
    tasks = tasks.filter(t => String(t.id) !== String(id));
    updateProgress();

    if (supabaseClient) {
        try {
            // Insere na tabela 'completions' um registro com completed: false para marcar como excluído hoje
            const { error } = await supabaseClient
                .from('completions')
                .upsert({
                    task_id: id,
                    date: selectedDate,
                    completed: false
                }, { onConflict: 'task_id,date' });
            if (error) throw error;
            
            await loadChecklistAndProgress();
        } catch (error) {
            console.error("Erro ao excluir do dia atual no Supabase. Fazendo offline.", error);
            excludeTaskForTodayOffline(id);
        } finally {
            pendingDeletes.delete(id);
        }
    } else {
        excludeTaskForTodayOffline(id);
        pendingDeletes.delete(id);
    }
}

function excludeTaskForTodayOffline(id) {
    let localCompletions = JSON.parse(localStorage.getItem("offline_completions")) || [];
    localCompletions = localCompletions.filter(c => !(String(c.task_id) === String(id) && c.date === selectedDate));
    
    localCompletions.push({
        task_id: id,
        date: selectedDate,
        completed: false
    });
    localStorage.setItem("offline_completions", JSON.stringify(localCompletions));
    
    loadDataOffline();
    renderChecklist();
    updateProgress();
}

function showConfirmDelete(task, onChoice) {
    if (!modalConfirmDelete) return;
    
    confirmDeleteTitle.textContent = "Excluir Tarefa";
    confirmDeleteBody.textContent = task.is_recurring 
        ? `"${task.title}" é uma tarefa recorrente. Como deseja excluí-la?`
        : `Deseja realmente excluir a tarefa "${task.title}"?`;
        
    if (task.is_recurring) {
        confirmDeleteStandardActions.classList.add("hidden");
        confirmDeleteRecurringActions.classList.remove("hidden");
    } else {
        confirmDeleteStandardActions.classList.remove("hidden");
        confirmDeleteRecurringActions.classList.add("hidden");
    }
    
    confirmDeleteCallback = onChoice;
    openModal(modalConfirmDelete);
}

function setupModalSwipeToClose(modal) {
    const content = modal.querySelector(".modal-content");
    if (!content) return;

    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    
    content.addEventListener("touchstart", (e) => {
        // Ignora gestos de deslize iniciados em campos interativos (inputs, selects, botões, etc.)
        if (e.target.closest("input") || e.target.closest("select") || e.target.closest("button") || e.target.closest("textarea") || e.target.closest(".day-toggle") || e.target.closest(".edit-day-toggle")) {
            return;
        }
        
        // Se o toque começou dentro de algum elemento interno que está com scroll ativo (ex: listas com max-height)
        let hasActiveScrollParent = false;
        let parent = e.target;
        while (parent && parent !== content) {
            if (parent.scrollHeight > parent.clientHeight) {
                const overflowY = window.getComputedStyle(parent).overflowY;
                if ((overflowY === "auto" || overflowY === "scroll") && parent.scrollTop > 0) {
                    hasActiveScrollParent = true;
                    break;
                }
            }
            parent = parent.parentElement;
        }

        if (hasActiveScrollParent) {
            return;
        }
        
        // Só arrasta se começar a deslizar do cabeçalho ou se o scroll interno estiver no topo (scrollTop === 0)
        const scrollContainer = content.querySelector(".manage-tasks-body") || content.querySelector(".modal-body") || content;
        const isScrollAtTop = scrollContainer.scrollTop === 0;
        const touchedHeader = e.target.closest(".modal-header") || (e.touches[0].clientY - content.getBoundingClientRect().top < 60);
        
        if (touchedHeader || isScrollAtTop) {
            startY = e.touches[0].clientY;
            currentY = startY;
            isDragging = true;
            content.style.transition = "none";
        }
    }, { passive: true });

    content.addEventListener("touchmove", (e) => {
        if (!isDragging) return;
        currentY = e.touches[0].clientY;
        let diffY = currentY - startY;
        
        // Se o movimento for para cima (dedo subindo / scroll para baixo), cancelamos o arrastar do modal
        if (diffY < 0) {
            isDragging = false;
            content.style.transform = "";
            return;
        } else if (diffY > 5) {
            // Se de fato está arrastando para baixo, cancela a ação padrão do navegador (Pull-to-Refresh do iOS/Safari)
            if (e.cancelable) {
                e.preventDefault();
            }
        }
        
        content.style.transform = `translateY(${diffY}px)`;
    }, { passive: false });

    content.addEventListener("touchend", () => {
        if (!isDragging) return;
        isDragging = false;
        
        const diffY = currentY - startY;
        
        // Se arrastou para baixo mais de 120 pixels, fecha o modal
        if (diffY > 120) {
            closeModal(modal);
            // Reseta a animação/estilo após a transição de fechar terminar
            setTimeout(() => {
                content.style.transform = "";
                content.style.transition = "";
            }, 350);
        } else {
            // Caso contrário, volta de forma elástica para a posição original (0)
            content.style.transition = "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)";
            content.style.transform = "translateY(0px)";
            setTimeout(() => {
                content.style.transition = "";
            }, 300);
        }
    });
}

function openCollaboratorsModal(cat) {
    if (!modalCollaborators) return;
    
    collabCategoryId.value = cat.id;
    collabModalSubtitle.textContent = `Compartilhar a guia "${cat.name}"`;
    inputCollabEmail.value = "";
    
    renderCollaborators(cat);
    openModal(modalCollaborators);
}

function renderCollaborators(cat) {
    if (!collaboratorsList) return;
    
    const isOwner = currentUser && cat.user_id === currentUser.id;
    const inviteSection = document.getElementById("collab-invite-section");
    
    if (inviteSection) {
        inviteSection.style.display = isOwner ? "block" : "none";
    }
    
    collaboratorsList.innerHTML = "";
    
    // Mostra o Dono (dono da categoria)
    const ownerItem = document.createElement("div");
    ownerItem.className = "manage-item";
    ownerItem.style.cssText = "background:rgba(255,255,255,0.01); border:1px solid var(--border-color); padding:10px 14px; border-radius:var(--radius-sm); display:flex; justify-content:space-between; align-items:center;";
    ownerItem.innerHTML = `
        <span style="font-size:0.85rem; font-weight:700; color:var(--text-secondary);">${escapeHTML(isOwner ? currentUser.email : 'Dono da Guia')} (Criador)</span>
    `;
    collaboratorsList.appendChild(ownerItem);
    
    // Lista os colaboradores da categoria
    const shares = categoryShares.filter(s => s.category_id === cat.id);
    shares.forEach(share => {
        const item = document.createElement("div");
        item.className = "manage-item";
        item.style.cssText = "background:rgba(255,255,255,0.02); border:1px solid var(--border-color); padding:10px 14px; border-radius:var(--radius-sm); display:flex; justify-content:space-between; align-items:center;";
        
        let removeBtn = "";
        if (isOwner) {
            removeBtn = `
                <button class="btn-remove-collab" data-id="${share.id}" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:4px; border-radius:4px; transition:var(--transition-smooth); display:flex; align-items:center; justify-content:center;">
                    <i data-lucide="x" style="width:14px; height:14px; color: var(--text-muted);"></i>
                </button>
            `;
        }
        
        item.innerHTML = `
            <span style="font-size:0.85rem; font-weight:600; color:var(--text-primary);">${escapeHTML(share.collaborator_email)}</span>
            ${removeBtn}
        `;
        
        if (isOwner) {
            const btnRemove = item.querySelector(".btn-remove-collab");
            if (btnRemove) {
                btnRemove.addEventListener("click", (e) => {
                    e.stopPropagation();
                    removeCollaborator(share.id, cat);
                });
            }
        }
        
        collaboratorsList.appendChild(item);
    });
    
    lucide.createIcons();
}

async function inviteCollaborator(catId, email) {
    if (!email) return;
    if (!supabaseClient) {
        alert("Conexão online indisponível.");
        return;
    }
    
    const cat = categories.find(c => c.id === catId);
    if (!cat) return;
    
    const cleanEmail = email.trim().toLowerCase();
    
    // Evita convidar a si mesmo ou convidar duplicado
    if (cleanEmail === currentUser.email.toLowerCase()) {
        alert("Você já é o dono e participa desta guia.");
        return;
    }
    
    const exists = categoryShares.some(s => s.category_id === catId && s.collaborator_email === cleanEmail);
    if (exists) {
        alert("Este e-mail já foi convidado para esta guia.");
        return;
    }
    
    const newShare = {
        category_id: catId,
        owner_id: currentUser.id,
        owner_email: currentUser.email,
        collaborator_email: cleanEmail
    };
    
    try {
        const { error } = await supabaseClient
            .from('category_shares')
            .insert(newShare);
        if (error) throw error;
        
        alert("Colaborador convidado com sucesso!");
        if (inputCollabEmail) inputCollabEmail.value = "";
        
        await loadChecklistAndProgress();
        renderCollaborators(cat);
    } catch (err) {
        console.error("Erro ao convidar colaborador:", err);
        alert("Erro ao convidar: " + err.message);
    }
}

async function removeCollaborator(shareId, cat) {
    if (!supabaseClient) {
        alert("Conexão online indisponível.");
        return;
    }
    
    if (confirm("Deseja realmente remover este colaborador da guia?")) {
        try {
            const { error } = await supabaseClient
                .from('category_shares')
                .delete()
                .eq('id', shareId);
            if (error) throw error;
            
            alert("Colaborador removido com sucesso!");
            await loadChecklistAndProgress();
            renderCollaborators(cat);
        } catch (err) {
            console.error("Erro ao remover colaborador:", err);
            alert("Erro ao remover: " + err.message);
        }
    }
}

function renderNotifications() {
    if (!notificationsListContainer) return;

    notificationsListContainer.innerHTML = "";

    // 1. Renderizar convites pendentes de colaboração
    if (pendingInvites && pendingInvites.length > 0) {
        pendingInvites.forEach(invite => {
            const item = document.createElement("div");
            item.style.cssText = "display: flex; gap: 12px; padding: 14px; background: rgba(139, 92, 246, 0.05); border: 1.5px solid var(--primary); border-radius: 12px; flex-direction: column;";
            item.innerHTML = `
                <div style="display: flex; gap: 12px;">
                    <div style="background: rgba(139, 92, 246, 0.15); color: var(--primary); width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <i data-lucide="users" style="width: 18px; height: 18px; color: var(--primary);"></i>
                    </div>
                    <div style="flex: 1;">
                        <h4 style="margin: 0 0 4px 0; font-size: 0.85rem; font-weight: 800; color: var(--text-primary);">Convite de Colaboração</h4>
                        <p style="margin: 0; font-size: 0.78rem; color: var(--text-secondary); line-height: 1.4;">
                            <strong>${escapeHTML(invite.owner_email || 'Um usuário')}</strong> convidou você para compartilhar a guia <strong>${escapeHTML(invite.category_name || 'Compartilhada')}</strong>.
                        </p>
                    </div>
                </div>
                <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px;">
                    <button class="btn btn-secondary btn-accept-invite" data-id="${invite.id}" style="padding: 6px 12px; font-size: 0.75rem; font-weight: 700; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-surface-solid); color: #fff; cursor: pointer;">Aceitar</button>
                    <button class="btn btn-danger-outline btn-decline-invite" data-id="${invite.id}" style="padding: 6px 12px; font-size: 0.75rem; font-weight: 700; border-radius: var(--radius-sm); cursor: pointer;">Recusar</button>
                </div>
            `;

            const btnAccept = item.querySelector(".btn-accept-invite");
            const btnDecline = item.querySelector(".btn-decline-invite");

            btnAccept.addEventListener("click", async () => {
                btnAccept.disabled = true;
                btnAccept.textContent = "...";
                await acceptInvitation(invite.id);
            });

            btnDecline.addEventListener("click", async () => {
                btnDecline.disabled = true;
                btnDecline.textContent = "...";
                await declineInvitation(invite.id);
            });

            notificationsListContainer.appendChild(item);
        });
    }

    // 2. Renderizar notificações estáticas do sistema
    const staticNotifications = [
        {
            icon: "cloud-lightning",
            iconBg: "rgba(16, 185, 129, 0.1)",
            iconColor: "#10b981",
            title: "Sincronização Ativa",
            body: "Seu checklist está sincronizado com segurança na nuvem do Supabase."
        },
        {
            icon: "brain-circuit",
            iconBg: "rgba(139, 92, 246, 0.1)",
            iconColor: "var(--primary)",
            title: "Dica de Produtividade",
            body: "Tente completar primeiro as tarefas mais pesadas da manhã para ativar o efeito Momentum."
        },
        {
            icon: "sparkles",
            iconBg: "rgba(59, 130, 246, 0.1)",
            iconColor: "#3b82f6",
            title: "Gestos de Deslizar",
            body: "Agora você pode fechar qualquer janela do app deslizando-a para baixo! Experimente!"
        }
    ];

    staticNotifications.forEach(notif => {
        const item = document.createElement("div");
        item.style.cssText = "display: flex; gap: 12px; padding: 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 12px;";
        item.innerHTML = `
            <div style="background: ${notif.iconBg}; color: ${notif.iconColor}; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <i data-lucide="${notif.icon}" style="width: 18px; height: 18px; color: ${notif.iconColor};"></i>
            </div>
            <div>
                <h4 style="margin: 0 0 4px 0; font-size: 0.85rem; font-weight: 700; color: var(--text-primary);">${escapeHTML(notif.title)}</h4>
                <p style="margin: 0; font-size: 0.78rem; color: var(--text-secondary); line-height: 1.4;">${escapeHTML(notif.body)}</p>
            </div>
        `;
        notificationsListContainer.appendChild(item);
    });

    lucide.createIcons();
}

async function acceptInvitation(shareId) {
    if (!supabaseClient) return;
    try {
        const { error } = await supabaseClient
            .from('category_shares')
            .update({ accepted: true })
            .eq('id', shareId);

        if (error) throw error;

        alert("Convite aceito! A guia compartilhada agora está disponível.");
        await loadChecklistAndProgress();
        renderNotifications();
    } catch (err) {
        console.error("Erro ao aceitar convite:", err);
        alert("Erro ao aceitar convite: " + err.message);
    }
}

async function declineInvitation(shareId) {
    if (!supabaseClient) return;
    if (confirm("Deseja realmente recusar este convite?")) {
        try {
            const { error } = await supabaseClient
                .from('category_shares')
                .delete()
                .eq('id', shareId);

            if (error) throw error;

            alert("Convite recusado.");
            await loadChecklistAndProgress();
            renderNotifications();
        } catch (err) {
            console.error("Erro ao recusar convite:", err);
            alert("Erro ao recusar convite: " + err.message);
        }
    }
}

function updateTaskAssigneeDropdown(categoryName, selectEl, groupEl) {
    if (!selectEl || !groupEl) return;

    const cat = categories.find(c => c.name === categoryName);
    if (!cat || !currentUser) {
        groupEl.style.display = "none";
        return;
    }

    const shares = categoryShares.filter(s => s.category_id === cat.id);
    if (shares.length === 0) {
        // Not a shared category
        groupEl.style.display = "none";
        selectEl.innerHTML = '<option value="">Todos (Sem atribuição)</option>';
        return;
    }

    // Shared category! Show assignment group
    groupEl.style.display = "block";
    
    // Clear and rebuild options
    const currentValue = selectEl.value;
    selectEl.innerHTML = "";
    
    // Todos Option
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "Todos (Sem atribuição)";
    selectEl.appendChild(optAll);
    
    // Owner Option (Creator)
    const isOwnerMe = cat.user_id === currentUser.id;
    const ownerEmail = isOwnerMe ? currentUser.email : (shares[0].owner_email || "Dono da Guia");
    const optOwner = document.createElement("option");
    optOwner.value = ownerEmail;
    optOwner.textContent = `${ownerEmail} (Dono)`;
    selectEl.appendChild(optOwner);
    
    // Collaborator Options
    shares.forEach(share => {
        const optCollab = document.createElement("option");
        optCollab.value = share.collaborator_email;
        optCollab.textContent = share.collaborator_email;
        selectEl.appendChild(optCollab);
    });
    
    // Restore value if still exists
    selectEl.value = currentValue;
}

async function addCategory(name) {
    if (!name) return;

    const newCat = {
        name: name,
        is_active: true
    };
    if (currentUser) {
        newCat.user_id = currentUser.id;
    }

    if (supabaseClient) {
        try {
            const { error } = await supabaseClient
                .from('categories')
                .insert(newCat);
            if (error) throw error;
            
            await loadChecklistAndProgress();
        } catch (e) {
            console.error("Erro ao inserir categoria no Supabase: ", e);
            addCategoryOffline(name);
        }
    } else {
        addCategoryOffline(name);
    }
}

function addCategoryOffline(name) {
    let localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    if (localCats.some(c => c.name.toLowerCase() === name.toLowerCase() && c.is_active)) {
        alert("Este local/categoria já existe.");
        return;
    }
    localCats.push({
        id: Date.now(),
        name: name,
        is_active: true
    });
    localStorage.setItem("offline_categories", JSON.stringify(localCats));
    
    loadCategoriesOffline();
    renderCategories();
}

async function deleteCategory(id) {
    if (confirm("Deseja mesmo excluir este local? As tarefas dele não aparecerão hoje. O histórico passado será mantido.")) {
        if (supabaseClient) {
            try {
                const { error } = await supabaseClient
                    .from('categories')
                    .update({ is_active: false })
                    .eq('id', id);
                if (error) throw error;
                
                await loadChecklistAndProgress();
            } catch (e) {
                console.error("Erro ao deletar categoria no Supabase: ", e);
                deleteCategoryOffline(id);
            }
        } else {
            deleteCategoryOffline(id);
        }
    }
}

function deleteCategoryOffline(id) {
    let localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    localCats = localCats.map(c => {
        if (String(c.id) === String(id)) return { ...c, is_active: false };
        return c;
    });
    localStorage.setItem("offline_categories", JSON.stringify(localCats));
    
    loadCategoriesOffline();
    renderCategories();
    
    const cat = categories.find(c => String(c.id) === String(id));
    if (cat && currentFilter === cat.name) {
        currentFilter = "all";
    }
    
    loadChecklistAndProgress();
}

async function resetChecklistProgress() {
    if (supabaseClient) {
        try {
            const { error } = await supabaseClient
                .from('completions')
                .delete()
                .eq('date', selectedDate);
            if (error) throw error;
            
            await loadChecklistAndProgress();
        } catch (e) {
            console.error("Erro ao resetar progresso no Supabase.", e);
            resetChecklistProgressOffline();
        }
    } else {
        resetChecklistProgressOffline();
    }
}

function resetChecklistProgressOffline() {
    let localCompletions = JSON.parse(localStorage.getItem("offline_completions")) || [];
    localCompletions = localCompletions.filter(c => c.date !== selectedDate);
    localStorage.setItem("offline_completions", JSON.stringify(localCompletions));
    
    loadDataOffline();
    renderChecklist();
    updateProgress();
}

async function restoreDefaultSettings() {
    if (supabaseClient) {
        try {
            // Soft-delete current categories and tasks
            await supabaseClient.from('tasks').update({ is_active: false }).eq('is_active', true);
            await supabaseClient.from('categories').update({ is_active: false }).eq('is_active', true);
            
            // Insert default categories
            const seedCats = DEFAULT_CATEGORIES.map(name => ({ 
                name, 
                is_active: true,
                user_id: currentUser ? currentUser.id : null
            }));
            const { data: seededCats, error: errSeedCats } = await supabaseClient
                .from('categories')
                .upsert(seedCats, { onConflict: 'name,user_id' })
                .select();
            if (errSeedCats) throw errSeedCats;
            
            // Insert default tasks
            const seedTasks = DEFAULT_TASKS.map(t => ({
                title: t.title,
                category: t.category,
                is_recurring: t.is_recurring,
                is_active: true,
                user_id: currentUser ? currentUser.id : null
            }));
            await supabaseClient.from('tasks').insert(seedTasks);
            
            await loadChecklistAndProgress();
        } catch (e) {
            console.error("Erro ao restaurar padrões online. Restaurando offline.", e);
            restoreDefaultSettingsOffline();
        }
    } else {
        restoreDefaultSettingsOffline();
    }
}

function restoreDefaultSettingsOffline() {
    // Categories
    localStorage.removeItem("checklist_categories_seeded");
    let localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    localCats = localCats.map(c => ({ ...c, is_active: false }));
    DEFAULT_CATEGORIES.forEach((name, i) => {
        localCats.push({
            id: Date.now() + i,
            name: name,
            is_active: true
        });
    });
    localStorage.setItem("checklist_categories_seeded", "true");
    localStorage.setItem("offline_categories", JSON.stringify(localCats));

    // Tasks
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    localTasks = localTasks.map(t => ({ ...t, is_active: false }));
    const createdAt = new Date().toISOString();
    DEFAULT_TASKS.forEach((t, i) => {
        localTasks.push({
            id: Date.now() + i + 100,
            title: t.title,
            category: t.category,
            is_recurring: t.is_recurring,
            is_active: true,
            created_at: createdAt
        });
    });
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));

    loadDataOffline();
    renderCategories();
    renderChecklist();
    updateProgress();
}

async function clearAllTasks() {
    if (supabaseClient) {
        try {
            await supabaseClient.from('tasks').update({ is_active: false }).eq('is_active', true);
            await loadChecklistAndProgress();
        } catch (e) {
            console.error("Erro ao limpar tarefas online. Limpando offline.", e);
            clearAllTasksOffline();
        }
    } else {
        clearAllTasksOffline();
    }
}

function clearAllTasksOffline() {
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    localTasks = localTasks.map(t => ({ ...t, is_active: false }));
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
    
    loadDataOffline();
    renderChecklist();
    updateProgress();
}

// ----------------------------------------------------
// Helper Utilities
// ----------------------------------------------------
function getLocalDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Extrair a parte da data de um timestamp (suporta formato ISO com 'T' e formato Supabase com espaço)
function extractDateFromTimestamp(timestamp) {
    if (!timestamp) return '';
    // Supabase pode retornar com 'T' ou com espaço. Pegar os primeiros 10 chars (YYYY-MM-DD)
    return String(timestamp).substring(0, 10);
}

function capitalize(str) {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHTML(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function shareReport() {
    if (tasks.length === 0) {
        alert("Adicione tarefas antes de exportar um relatório.");
        return;
    }

    const dateObj = new Date(selectedDate + "T12:00:00");
    const formattedDateStr = dateObj.toLocaleDateString('pt-BR');
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);

    let reportText = `📋 *RELATÓRIO CHECKLIST DIÁRIO*\n`;
    reportText += `📅 *Data:* ${formattedDateStr}\n`;
    reportText += `📊 *Progresso:* ${percentage}% (${completed} de ${total} concluídos)\n\n`;

    // Agrupar tarefas pelas categorias ativas no checklist de hoje
    const activeCatsInTasks = [...new Set(tasks.map(t => t.category))];
    
    activeCatsInTasks.forEach(catName => {
        const catTasks = tasks.filter(t => t.category === catName);
        if (catTasks.length > 0) {
            reportText += `*${catName}:*\n`;
            catTasks.forEach(task => {
                const mark = task.completed ? "✅" : "❌";
                reportText += `${mark} ${task.title}\n`;
            });
            reportText += `\n`;
        }
    });

    navigator.clipboard.writeText(reportText).then(() => {
        const encodedText = encodeURIComponent(reportText);
        const whatsappUrl = `https://api.whatsapp.com/send?text=${encodedText}`;
        alert("Relatório copiado para a área de transferência! Abrindo o WhatsApp...");
        window.open(whatsappUrl, "_blank");
    }).catch(err => {
        console.error("Falha ao copiar relatório: ", err);
        const encodedText = encodeURIComponent(reportText);
        const whatsappUrl = `https://api.whatsapp.com/send?text=${encodedText}`;
        window.open(whatsappUrl, "_blank");
    });
}

function createConfettiBurst(x, y) {
    const particleCount = 10;
    const colors = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ec4899'];
    
    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement("span");
        particle.className = "confetti-particle";
        
        const color = colors[Math.floor(Math.random() * colors.length)];
        particle.style.background = color;
        particle.style.boxShadow = `0 0 6px ${color}`;
        
        particle.style.left = `${x}px`;
        particle.style.top = `${y}px`;
        
        const angle = (i / particleCount) * 2 * Math.PI + (Math.random() * 0.4 - 0.2);
        const distance = 20 + Math.random() * 20;
        const tx = Math.cos(angle) * distance;
        const ty = Math.sin(angle) * distance;
        
        particle.style.setProperty('--tx', `${tx}px`);
        particle.style.setProperty('--ty', `${ty}px`);
        
        document.body.appendChild(particle);
        
        setTimeout(() => {
            particle.remove();
        }, 700);
    }
}

function getCategoryColorStyle(categoryName) {
    const name = categoryName || "Outros";
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    const color = `hsl(${hue}, 80%, 65%)`;
    const bg = `hsla(${hue}, 80%, 65%, 0.12)`;
    return { color, bg };
}

// Modal Helpers
function openModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.add("active");
    document.body.style.overflow = "hidden";
}

function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove("active");
    document.body.style.overflow = "";
}

// Theme Helper
function applyTheme(themeName) {
    currentTheme = themeName;
    localStorage.setItem("checklist_theme", themeName);

    // Remove active classes
    document.body.classList.remove("theme-light", "theme-girly");

    // Add selected theme class
    if (themeName === "light") {
        document.body.classList.add("theme-light");
    } else if (themeName === "girly") {
        document.body.classList.add("theme-girly");
    }

    // Update active state on buttons inside Settings modal
    document.querySelectorAll(".theme-selector-btn").forEach(btn => {
        if (btn.dataset.theme === themeName) {
            btn.classList.add("active");
            btn.style.borderColor = "var(--primary)";
        } else {
            btn.classList.remove("active");
            btn.style.borderColor = "var(--border-color)";
        }
    });

    // Salva o tema na nuvem se o usuário estiver logado
    saveUserThemeCloud(themeName);
}

// Helper para gerenciar o estado global de edição das categorias
function toggleEditMode(forceState) {
    isEditMode = forceState !== undefined ? forceState : !isEditMode;
    
    const btnToggleEdit = document.getElementById("btn-toggle-edit");
    if (isEditMode) {
        appContainer.classList.add("edit-mode-active");
        if (btnToggleEdit) {
            btnToggleEdit.classList.add("active");
            btnToggleEdit.innerHTML = '<i data-lucide="check"></i>';
            btnToggleEdit.title = "Finalizar Edição";
        }
    } else {
        appContainer.classList.remove("edit-mode-active");
        if (btnToggleEdit) {
            btnToggleEdit.classList.remove("active");
            btnToggleEdit.innerHTML = '<i data-lucide="edit-3"></i>';
            btnToggleEdit.title = "Editar Checklist";
        }
    }
    
    renderCategories();
    renderChecklist();
    lucide.createIcons();
}

async function saveUserThemeCloud(themeName) {
    if (!supabaseClient || !currentUser) return;
    try {
        await supabaseClient
            .from('profiles')
            .upsert({ 
                id: currentUser.id, 
                theme: themeName, 
                updated_at: new Date().toISOString() 
            });
    } catch (e) {
        console.error("Erro ao salvar tema no Supabase:", e);
    }
}

async function loadUserProfile() {
    if (!supabaseClient || !currentUser) return;
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('theme')
            .eq('id', currentUser.id)
            .maybeSingle();
            
        if (!error && data && data.theme) {
            // Aplica o tema sem chamar o saveUserThemeCloud para evitar requisição em loop
            currentTheme = data.theme;
            localStorage.setItem("checklist_theme", data.theme);
            
            document.body.classList.remove("theme-light", "theme-girly");
            if (data.theme === "light") {
                document.body.classList.add("theme-light");
            } else if (data.theme === "girly") {
                document.body.classList.add("theme-girly");
            }

            document.querySelectorAll(".theme-selector-btn").forEach(btn => {
                if (btn.dataset.theme === data.theme) {
                    btn.classList.add("active");
                    btn.style.borderColor = "var(--primary)";
                } else {
                    btn.classList.remove("active");
                    btn.style.borderColor = "var(--border-color)";
                }
            });
        }
    } catch (e) {
        console.error("Erro ao carregar perfil do Supabase:", e);
    }
}

// Supabase Auth and Sync helpers
function setupSupabaseAuth() {
    if (!supabaseClient) {
        document.getElementById("auth-container").style.display = "none";
        document.querySelector(".app-container").style.display = "flex";
        loadChecklistAndProgress();
        return;
    }

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        console.log("Supabase Auth Change:", event, session);
        if (session) {
            currentUser = session.user;
            document.getElementById("auth-container").style.display = "none";
            document.querySelector(".app-container").style.display = "flex";
            
            // Sync local data to cloud
            await syncOfflineDataToCloud();
            
            // Carrega as configurações de perfil (como o tema do usuário)
            await loadUserProfile();
            
            await loadChecklistAndProgress();
            lucide.createIcons();
        } else {
            currentUser = null;
            document.getElementById("auth-container").style.display = "flex";
            document.querySelector(".app-container").style.display = "none";
            
            // Limpa o cache local ao deslogar para evitar contaminação
            localStorage.removeItem("offline_categories");
            localStorage.removeItem("offline_tasks");
            localStorage.removeItem("offline_completions");
            
            tasks = [];
            categories = [];
            renderCategories();
            renderChecklist();
        }
    });
}

async function syncOfflineDataToCloud() {
    if (!supabaseClient || !currentUser) return;
    
    const offlineCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    const offlineTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    
    if (offlineCats.length === 0 && offlineTasks.length === 0) return;
    
    try {
        console.log("Sincronizando dados locais com o Supabase Auth...");
        
        for (const cat of offlineCats) {
            const { data } = await supabaseClient
                .from('categories')
                .select('id')
                .eq('name', cat.name)
                .maybeSingle();
                
            if (!data) {
                await supabaseClient
                    .from('categories')
                    .insert({ name: cat.name, is_active: cat.is_active });
            }
        }
        
        for (const task of offlineTasks) {
            const { data } = await supabaseClient
                .from('tasks')
                .select('id')
                .eq('title', task.title)
                .eq('category', task.category)
                .maybeSingle();
                
            if (!data) {
                await supabaseClient
                    .from('tasks')
                    .insert({
                        title: task.title,
                        category: task.category,
                        is_recurring: task.is_recurring,
                        is_active: task.is_active
                    });
            }
        }
        
        localStorage.removeItem("offline_categories");
        localStorage.removeItem("offline_tasks");
        console.log("Sincronização concluída.");
    } catch (e) {
        console.error("Erro na sincronização:", e);
    }
}

function renderCalendarGrid() {
    calendarDaysGrid.innerHTML = "";

    const year = currentCalendarMonth.getFullYear();
    const month = currentCalendarMonth.getMonth();

    // Set month and year title
    const monthNames = [
        "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
        "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
    ];
    calendarMonthYear.textContent = `${monthNames[month]} ${year}`;

    // First day of the month
    const firstDayIndex = new Date(year, month, 1).getDay();

    // Last day of the current month
    const lastDay = new Date(year, month + 1, 0).getDate();

    // Last day of the previous month
    const prevLastDay = new Date(year, month, 0).getDate();

    // Days from previous month (to fill the start grid gap)
    for (let i = firstDayIndex; i > 0; i--) {
        const dayNum = prevLastDay - i + 1;
        const btn = document.createElement("button");
        btn.className = "calendar-day other-month";
        btn.disabled = true;
        btn.textContent = dayNum;
        calendarDaysGrid.appendChild(btn);
    }

    // Days of the current month
    const todayStr = getLocalDateString(new Date());
    for (let i = 1; i <= lastDay; i++) {
        const btn = document.createElement("button");
        btn.className = "calendar-day";
        
        // Format this date
        const dayStr = String(i).padStart(2, '0');
        const monthStr = String(month + 1).padStart(2, '0');
        const dateStr = `${year}-${monthStr}-${dayStr}`;

        // Highlights
        if (dateStr === selectedDate) {
            btn.classList.add("selected");
        }
        if (dateStr === todayStr) {
            btn.classList.add("today");
        }

        btn.textContent = i;

        btn.addEventListener("click", async () => {
            selectedDate = dateStr;
            
            // Check if viewing history
            isHistoryMode = (selectedDate !== todayStr);
            
            if (isHistoryMode) {
                appContainer.classList.add("history-mode");
                toggleEditMode(false); // Turn off editing when viewing history
            } else {
                appContainer.classList.remove("history-mode");
            }

            updateDateDisplay();
            await loadChecklistAndProgress();
            closeModal(modalCalendar);
            lucide.createIcons();
        });

        calendarDaysGrid.appendChild(btn);
    }

    // Fill remaining grid space (days of next month to make a nice grid)
    const totalCells = firstDayIndex + lastDay;
    const nextMonthCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= nextMonthCells; i++) {
        const btn = document.createElement("button");
        btn.className = "calendar-day other-month";
        btn.disabled = true;
        btn.textContent = i;
        calendarDaysGrid.appendChild(btn);
    }
}

// Drag & Drop Category Reordering logic
let draggedElement = null;

function setupDragAndDrop(chip, cat) {
    // Mouse dragging
    chip.addEventListener("dragstart", (e) => {
        if (!isEditMode) {
            e.preventDefault();
            return;
        }
        draggedElement = chip;
        chip.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
    });

    chip.addEventListener("dragover", (e) => {
        if (!isEditMode || !draggedElement) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        
        const rect = chip.getBoundingClientRect();
        const midpoint = rect.left + rect.width / 2;
        
        if (e.clientX < midpoint) {
            chip.parentNode.insertBefore(draggedElement, chip);
        } else {
            chip.parentNode.insertBefore(draggedElement, chip.nextSibling);
        }
    });

    chip.addEventListener("dragend", () => {
        if (!isEditMode) return;
        chip.classList.remove("dragging");
        draggedElement = null;
        saveCategoryOrder();
    });

    // Touch support for mobile dragging
    chip.addEventListener("touchstart", (e) => {
        if (!isEditMode) return;
        draggedElement = chip;
        chip.classList.add("dragging");
    });

    chip.addEventListener("touchmove", (e) => {
        if (!isEditMode || !draggedElement) return;
        
        const touch = e.touches[0];
        const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
        if (!elementUnderTouch) return;

        const targetChip = elementUnderTouch.closest(".category-chip");
        if (targetChip && targetChip !== draggedElement && targetChip.dataset.category !== "all") {
            const rect = targetChip.getBoundingClientRect();
            const midpoint = rect.left + rect.width / 2;
            
            if (touch.clientX < midpoint) {
                targetChip.parentNode.insertBefore(draggedElement, targetChip);
            } else {
                targetChip.parentNode.insertBefore(draggedElement, targetChip.nextSibling);
            }
            e.preventDefault(); // Prevent scroll while dragging
        }
    });

    chip.addEventListener("touchend", () => {
        if (!isEditMode || !draggedElement) return;
        draggedElement.classList.remove("dragging");
        draggedElement = null;
        saveCategoryOrder();
    });
}

async function saveCategoryOrder() {
    const bar = document.getElementById("categories-bar");
    const chips = Array.from(bar.querySelectorAll(".category-chip"));
    
    // Extract names in order
    const orderedNames = chips
        .map(c => c.dataset.category)
        .filter(name => name !== "all");

    // Reorder state array
    const reorderedCategories = [];
    orderedNames.forEach(name => {
        const cat = categories.find(c => c.name === name);
        if (cat) {
            reorderedCategories.push(cat);
        }
    });

    categories.forEach(cat => {
        if (!reorderedCategories.some(c => c.id === cat.id)) {
            reorderedCategories.push(cat);
        }
    });

    categories = reorderedCategories;

    // Save offline
    let localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    const orderedLocalCats = [];
    categories.forEach(cat => {
        const localCat = localCats.find(c => String(c.id) === String(cat.id));
        if (localCat) orderedLocalCats.push(localCat);
    });
    localCats.forEach(localCat => {
        if (!orderedLocalCats.some(c => String(c.id) === String(localCat.id))) {
            orderedLocalCats.push(localCat);
        }
    });
    localStorage.setItem("offline_categories", JSON.stringify(orderedLocalCats));

    // Save order online to Supabase if order column is available
    if (supabaseClient) {
        try {
            const promises = categories.map((cat, index) => {
                return supabaseClient
                    .from('categories')
                    .update({ sort_order: index })
                    .eq('id', cat.id);
            });
            await Promise.all(promises);
            console.log("Ordem de categorias atualizada no Supabase.");
        } catch (e) {
            console.warn("Dica: Adicione a coluna 'sort_order' na tabela 'categories' para salvar a ordem online!");
        }
    }
}

// Swipe to Reveal actions (WhatsApp iOS style gesture handler)
function setupSwipeToReveal(taskEl) {
    const foreground = taskEl.querySelector(".task-item-foreground");
    if (!foreground) return;

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;
    let isDragging = false;
    let isSwipeConfirmed = false;
    let isScrollConfirmed = false;
    const maxSwipe = 136; // Width of revealed action buttons (rename + delete) + offsets

    function setTranslate(x, animate = false) {
        if (animate) {
            foreground.style.transition = "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)";
        } else {
            foreground.style.transition = "none";
        }
        foreground.style.transform = `translateX(${x}px)`;
    }

    function closeAllOtherSwipes() {
        document.querySelectorAll(".task-item").forEach(item => {
            if (item !== taskEl && item.classList.contains("swiped")) {
                item.classList.remove("swiped");
                const fg = item.querySelector(".task-item-foreground");
                if (fg) {
                    fg.style.transition = "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)";
                    fg.style.transform = "translateX(0px)";
                }
            }
        });
    }

    // Touch events (Mobile)
    foreground.addEventListener("touchstart", (e) => {
        if (isEditMode) return;
        closeAllOtherSwipes();
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isDragging = true;
        isSwipeConfirmed = false;
        isScrollConfirmed = false;
        if (taskEl.classList.contains("swiped")) {
            startX += maxSwipe;
        }
    }, { passive: true });

    foreground.addEventListener("touchmove", (e) => {
        if (!isDragging) return;
        currentX = e.touches[0].clientX;
        currentY = e.touches[0].clientY;
        let diffX = currentX - startX;
        let diffY = currentY - startY;

        // Detectar se o usuário quer rolar verticalmente a página
        if (!isSwipeConfirmed && !isScrollConfirmed) {
            if (Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 8) {
                isScrollConfirmed = true;
                isDragging = false; // Cancela o gesto de deslizar, liberando a rolagem vertical
                return;
            } else if (Math.abs(diffX) > 8) {
                isSwipeConfirmed = true;
            }
        }

        // Se a rolagem foi confirmada ou o deslize lateral ainda não atingiu o limite de confirmação, não traduz o elemento
        if (isScrollConfirmed || !isSwipeConfirmed) return;

        // Swiping only to the left
        if (diffX > 0) diffX = 0;
        if (diffX < -maxSwipe - 20) {
            // Elastic resistance effect
            diffX = -maxSwipe - 20 + (diffX + maxSwipe + 20) * 0.25;
        }

        setTranslate(diffX, false);
    }, { passive: true });

    foreground.addEventListener("touchend", () => {
        if (!isDragging) return;
        isDragging = false;
        
        if (isScrollConfirmed) return;
        
        // Extract matrix value
        const style = window.getComputedStyle(foreground);
        const matrix = new WebKitCSSMatrix(style.transform);
        const currentTransform = matrix.m41;

        if (currentTransform < -maxSwipe / 2) {
            setTranslate(-maxSwipe, true);
            taskEl.classList.add("swiped");
        } else {
            setTranslate(0, true);
            taskEl.classList.remove("swiped");
        }
    });

    // Mouse events (Desktop testing support)
    foreground.addEventListener("mousedown", (e) => {
        if (isEditMode) return;
        closeAllOtherSwipes();
        startX = e.clientX;
        isDragging = true;
        if (taskEl.classList.contains("swiped")) {
            startX += maxSwipe;
        }
        document.body.style.userSelect = "none";
    });

    window.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        currentX = e.clientX;
        let diffX = currentX - startX;

        if (diffX > 0) diffX = 0;
        if (diffX < -maxSwipe - 20) {
            diffX = -maxSwipe - 20 + (diffX + maxSwipe + 20) * 0.25;
        }

        setTranslate(diffX, false);
    });

    window.addEventListener("mouseup", () => {
        if (!isDragging) return;
        isDragging = false;
        document.body.style.userSelect = "";

        const style = window.getComputedStyle(foreground);
        const matrix = new WebKitCSSMatrix(style.transform);
        const currentTransform = matrix.m41;

        if (currentTransform < -maxSwipe / 2) {
            setTranslate(-maxSwipe, true);
            taskEl.classList.add("swiped");
        } else {
            setTranslate(0, true);
            taskEl.classList.remove("swiped");
        }
    });
}

// ----------------------------------------------------
// Task Context Engine (Semantic Analysis)
// ----------------------------------------------------
function analyzeTaskContext(title, category, existingTasks = []) {
    if (!title) return null;
    
    const lowerTitle = title.toLowerCase().trim();
    const cleanCategory = (category || "").toLowerCase().trim();
    
    // Normalization helper
    const removeAccents = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const normalizedTitle = removeAccents(lowerTitle);
    
    let activityType = null;
    let semanticCategory = null;
    let confidence = 0;
    
    const entities = {
        people: [],
        clients: [],
        projects: []
    };

    // 1. Identify Activity Type and Semantic Category based on patterns and category context
    const rules = [
        // Marketing
        {
            type: "marketing",
            category: "marketing_divulgacao",
            match: /(public|stori|post|feed|insta|whats|rede.*social|divulg|anunci|campanh)/i,
            weight: 0.6
        },
        // Estudo
        {
            type: "estudo",
            category: "educacao_desenvolvimento",
            match: /(estud|ler|revis|aula|videoaula|livro|capitul|artig)/i,
            weight: 0.6
        },
        // Trabalho Acadêmico
        {
            type: "trabalho_academico",
            category: "educacao_desenvolvimento",
            match: /(entreg.*trabalh|fazer.*tcc|tcc|apresent|seminari|prova|trabalh)/i,
            weight: 0.7
        },
        // Entrega
        {
            type: "entrega",
            category: "logistica_operacoes",
            match: /(entreg|envi|despach|motoboy|delivery)/i,
            weight: 0.6
        },
        // Atendimento
        {
            type: "atendimento",
            category: "atendimento_suporte",
            match: /(atend|respond|ligar|mensag|falar|whats.*com|telefon|cham)/i,
            weight: 0.6
        },
        // Financeiro
        {
            type: "financeiro",
            category: "financeiro_adm",
            match: /(pagar|cobrar|orcament|financeir|transfer|pix|bolet|nota.*fiscal|nf|caix|vend)/i,
            weight: 0.6
        },
        // Compras
        {
            type: "compras",
            category: "suprimentos",
            match: /(compr|adquir|supermercad|mercado)/i,
            weight: 0.6
        },
        // Limpeza/Organização
        {
            type: "limpeza",
            category: "manutencao_casa",
            match: /(limp|organiz|arrum|lavar|passar|faxin)/i,
            weight: 0.6
        },
        // Reunião
        {
            type: "reuniao",
            category: "reunioes_comunicacao",
            match: /(reuniao|meeting|call|encontr|alinhament|brainstorm)/i,
            weight: 0.7
        },
        // Compromisso Pessoal / Treino / Saúde
        {
            type: "compromisso_pessoal",
            category: "pessoal_social",
            match: /(present|aniversari|namora|mae|pai|filh|amig|medic|consult|academi|trein|musculac|gym|exercic)/i,
            weight: 0.6
        },
        // Administrativo
        {
            type: "administrativo",
            category: "financeiro_adm",
            match: /(agend|cadastr|planilh|document|contrat)/i,
            weight: 0.6
        },
        // Produção
        {
            type: "producao",
            category: "producao_operacoes",
            match: /(prepar|mont|fabric|produz|embal|etiquet)/i,
            weight: 0.6
        }
    ];

    let maxWeight = 0;
    let matchedRule = null;
    for (const rule of rules) {
        if (rule.match.test(normalizedTitle)) {
            let weight = rule.weight;
            
            // Adjust based on category context
            if (rule.type === "entrega" && cleanCategory.includes("tio nan")) {
                weight += 0.2;
            }
            if (rule.type === "trabalho_academico" && (cleanCategory.includes("faculdade") || cleanCategory.includes("pucrs"))) {
                weight += 0.25;
            }
            if (rule.type === "estudo" && (cleanCategory.includes("faculdade") || cleanCategory.includes("pucrs"))) {
                weight += 0.2;
            }
            if (rule.type === "compromisso_pessoal" && cleanCategory.includes("pessoal")) {
                weight += 0.25;
            }
            if (rule.type === "marketing" && cleanCategory.includes("tio nan")) {
                weight += 0.25;
            }

            if (weight > maxWeight) {
                maxWeight = weight;
                matchedRule = rule;
            }
        }
    }

    if (matchedRule) {
        activityType = matchedRule.type;
        semanticCategory = matchedRule.category;
        confidence = Math.min(maxWeight, 1.0);
    }

    // Context resolution fallback or refinement by category if no regex matches perfectly but category is strongly suggestive
    if (!matchedRule) {
        if (cleanCategory.includes("tio nan")) {
            if (normalizedTitle.includes("entregar")) {
                activityType = "entrega";
                semanticCategory = "logistica_operacoes";
                confidence = 0.55;
            }
        } else if (cleanCategory.includes("pucrs") || cleanCategory.includes("faculdade")) {
            if (normalizedTitle.includes("entregar")) {
                activityType = "trabalho_academico";
                semanticCategory = "educacao_desenvolvimento";
                confidence = 0.65;
            }
        } else if (cleanCategory.includes("pessoal")) {
            if (normalizedTitle.includes("entregar")) {
                activityType = "compromisso_pessoal";
                semanticCategory = "pessoal_social";
                confidence = 0.55;
            }
        }
    }

    // 2. Entity Extraction (People, Clients, Projects)
    const words = title.split(/\s+/);
    const ignoreStartWords = new Set([
        "Entregar", "Enviar", "Despachar", "Publicar", "Estudar", "Ler", "Revisar", 
        "Assistir", "Fazer", "Apresentar", "Atender", "Responder", "Ligar", "Falar", 
        "Pagar", "Cobrar", "Comprar", "Limpar", "Organizar", "Arrumar", "Lavar", 
        "Passar", "Agendar", "Cadastrar", "Atualizar", "Alimentar", "Preparar", 
        "Montar", "Fabricar", "Produzir", "Embalar", "Etiquetar", "O", "A", "Os", 
        "As", "Um", "Uma", "Estes", "Esta", "E", "De", "Para", "Com", "Em", "No", "Na"
    ]);

    words.forEach((word, idx) => {
        const cleanWord = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "");
        if (!cleanWord) return;
        
        if (cleanWord[0] === cleanWord[0].toUpperCase() && cleanWord[0] !== cleanWord[0].toLowerCase()) {
            if (idx === 0 && ignoreStartWords.has(cleanWord)) {
                return;
            }
            if (ignoreStartWords.has(cleanWord)) {
                return;
            }

            if (cleanWord === cleanWord.toUpperCase() && cleanWord.length > 2 && isNaN(cleanWord)) {
                entities.projects.push(cleanWord);
            } else {
                entities.people.push(cleanWord);
            }
        }
    });

    if (cleanCategory.includes("tio nan") || cleanCategory.includes("trabalho") || cleanCategory.includes("cassol")) {
        entities.clients = [...entities.people];
    }

    // 3. Similar Tasks Context Matching
    if (existingTasks && existingTasks.length > 0) {
        let bestMatch = null;
        let bestSim = 0;
        
        const getWords = str => new Set(removeAccents(str.toLowerCase()).split(/\W+/).filter(w => w.length > 2));
        const currentWords = getWords(title);
        
        for (const t of existingTasks) {
            if (t.id === title) continue;
            if (!t.context || !t.context.activity_type) continue;
            
            const otherWords = getWords(t.title);
            let intersection = 0;
            for (const w of currentWords) {
                if (otherWords.has(w)) intersection++;
            }
            const union = currentWords.size + otherWords.size - intersection;
            const sim = union > 0 ? intersection / union : 0;
            
            if (sim > bestSim) {
                bestSim = sim;
                bestMatch = t;
            }
        }
        
        if (bestSim > 0.4 && bestMatch) {
            if (!activityType) {
                activityType = bestMatch.context.activity_type;
                semanticCategory = bestMatch.context.semantic_category;
                confidence = Math.max(0.4, bestSim * bestMatch.context.confidence);
            } else if (activityType === bestMatch.context.activity_type) {
                confidence = Math.min(1.0, confidence + 0.1);
            }
        }
    }

    const finalActivityType = confidence >= 0.4 ? activityType : null;
    const finalSemanticCategory = confidence >= 0.4 ? semanticCategory : null;

    return {
        activity_type: finalActivityType,
        semantic_category: finalSemanticCategory,
        entities: entities,
        confidence: Number(confidence.toFixed(2)),
        analyzed_at: new Date().toISOString()
    };
}

async function loadAndRenderReport(days, containerEl) {
    const now = new Date();
    let isExpired = false;
    let daysRemaining = 0;

    // Calcula expiração (limite de 3 dias incluindo o dia de conclusão)
    if (days === 7) {
        const daysSinceSat = (now.getDay() === 6) ? 0 : (now.getDay() + 1);
        if (daysSinceSat >= 2) {
            isExpired = true;
        } else {
            daysRemaining = 2 - daysSinceSat;
        }
    } else if (days === 30) {
        const date = now.getDate();
        if (date > 3) {
            isExpired = true;
        } else {
            daysRemaining = 4 - date;
        }
    } else if (days === 365) {
        const isJanuary = now.getMonth() === 0;
        const date = now.getDate();
        if (!isJanuary || date > 3) {
            isExpired = true;
        } else {
            daysRemaining = 4 - date;
        }
    }

    if (isExpired) {
        const periodLabel = days === 7 ? "semanal" : days === 30 ? "mensal" : "anual";
        containerEl.innerHTML = `
            <div style="text-align: center; padding: 32px 16px; color: var(--text-secondary);">
                <div style="background: rgba(239, 68, 68, 0.05); color: #ef4444; width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; border: 1px solid rgba(239, 68, 68, 0.15);">
                    <i data-lucide="clock" style="width: 22px; height: 22px;"></i>
                </div>
                <h5 style="margin: 0 0 6px 0; font-size: 1rem; font-weight: 800; color: var(--text-primary);">Relatório Expirado</h5>
                <p style="margin: 0; font-size: 0.82rem; line-height: 1.5; max-width: 260px; margin: 0 auto;">Este relatório ${periodLabel} já expirou. Os resumos ficam disponíveis por apenas 3 dias após o encerramento do período.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    containerEl.innerHTML = `<span style="font-size: 0.8rem; color: var(--text-secondary);"><span class="loading-spinner" style="display:inline-block; vertical-align:middle; margin-right:6px; width:12px; height:12px; border:2px solid var(--primary); border-top-color:transparent; border-radius:50%; animation:spin 1s linear infinite;"></span> Carregando resumo...</span>`;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = getLocalDateString(startDate);

    let completionsList = [];
    if (supabaseClient && currentUser) {
        try {
            const { data, error } = await supabaseClient
                .from('completions')
                .select('*')
                .gte('date', startDateStr)
                .eq('completed', true);
            if (!error && data) {
                completionsList = data;
            }
        } catch (e) {
            console.error("Erro ao carregar conclusões do Supabase", e);
        }
    }
    
    // Fallback offline or merged
    if (completionsList.length === 0) {
        let localCompletions = JSON.parse(localStorage.getItem("offline_completions")) || [];
        completionsList = localCompletions.filter(c => c.date >= startDateStr && c.completed);
    }

    const completionCounts = {};
    completionsList.forEach(c => {
        completionCounts[c.task_id] = (completionCounts[c.task_id] || 0) + 1;
    });

    let storiesCount = 0;
    let collegeWorksCount = 0;
    let studiesCount = 0;
    let deliveriesCount = 0;
    let financialCount = 0;
    let meetingsCount = 0;
    let cleaningCount = 0;
    let fitnessCount = 0;

    Object.entries(completionCounts).forEach(([taskId, count]) => {
        const task = allActiveTasks.find(t => String(t.id) === String(taskId));
        if (!task) return;
        
        const ctx = task.context || analyzeTaskContext(task.title, task.category, allActiveTasks);
        if (!ctx) return;

        const titleLower = task.title.toLowerCase();
        const categoryLower = task.category.toLowerCase();

        if ((titleLower.includes("storie") || titleLower.includes("video") || titleLower.includes("stories") || titleLower.includes("post")) 
            && (categoryLower.includes("tio nan") || titleLower.includes("tio nan") || categoryLower.includes("marketing"))) {
            storiesCount += count;
        }
        else if (titleLower.includes("trein") || titleLower.includes("musculac") || titleLower.includes("academia") || titleLower.includes("gym") || titleLower.includes("corrida") || titleLower.includes("correr") || titleLower.includes("futebol")) {
            fitnessCount += count;
        }
        else if (ctx.activity_type === "trabalho_academico" || categoryLower.includes("pucrs") || categoryLower.includes("faculdade")) {
            collegeWorksCount += count;
        }
        else if (ctx.activity_type === "estudo") {
            studiesCount += count;
        }
        else if (ctx.activity_type === "entrega") {
            deliveriesCount += count;
        }
        else if (ctx.activity_type === "financeiro") {
            financialCount += count;
        }
        else if (ctx.activity_type === "reuniao") {
            meetingsCount += count;
        }
        else if (ctx.activity_type === "limpeza") {
            cleaningCount += count;
        }
    });

    const summarySentences = [];
    if (storiesCount > 0) {
        summarySentences.push(`Subiu <strong>${storiesCount}</strong> stories para o Tio Nan.`);
    }
    if (collegeWorksCount > 0) {
        summarySentences.push(`Fez <strong>${collegeWorksCount}</strong> trabalhos da faculdade.`);
    }
    if (fitnessCount > 0) {
        summarySentences.push(`Realizou <strong>${fitnessCount}</strong> treinos / exercícios físicos.`);
    }
    if (studiesCount > 0) {
        summarySentences.push(`Realizou <strong>${studiesCount}</strong> sessões de estudo.`);
    }
    if (deliveriesCount > 0) {
        summarySentences.push(`Concluiu <strong>${deliveriesCount}</strong> entregas ou envios.`);
    }
    if (financialCount > 0) {
        summarySentences.push(`Lançou/pagou <strong>${financialCount}</strong> movimentações financeiras.`);
    }
    if (meetingsCount > 0) {
        summarySentences.push(`Participou de <strong>${meetingsCount}</strong> reuniões.`);
    }
    if (cleaningCount > 0) {
        summarySentences.push(`Completou <strong>${cleaningCount}</strong> tarefas de limpeza e organização.`);
    }

    const labelPeriod = days === 7 ? "esta semana" : days === 30 ? "este mês" : "este ano";
    const warningLabel = daysRemaining === 1 ? "amanhã" : `em ${daysRemaining} dias`;

    const warningHtml = `
        <div style="background: rgba(245, 158, 11, 0.07); border: 1px solid rgba(245, 158, 11, 0.2); color: #eab308; padding: 12px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 0.82rem; font-weight: 600; display: flex; align-items: center; gap: 8px; line-height: 1.4;">
            <i data-lucide="camera" style="width: 18px; height: 18px; flex-shrink: 0; color: #eab308;"></i>
            <span>📸 Tire print! Este relatório expirará e sumirá do app ${warningLabel}.</span>
        </div>
    `;

    if (summarySentences.length > 0) {
        containerEl.innerHTML = `
            ${warningHtml}
            <p style="margin: 0 0 12px 0; font-weight: bold; color: var(--text-primary);">Aqui está o que você concluiu ${labelPeriod}:</p>
            <ul style="margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px;">
                ${summarySentences.map(s => `<li>${s}</li>`).join("")}
            </ul>
        `;
    } else {
        containerEl.innerHTML = `
            ${warningHtml}
            <p style="margin: 0; color: var(--text-secondary); font-style: italic;">Nenhuma rotina ou tarefa concluída ${labelPeriod}.</p>
        `;
    }
    lucide.createIcons();
}

function checkAutomaticReports() {
    const now = new Date();
    const todayStr = getLocalDateString(now);
    const currentMonthYearStr = `${now.getFullYear()}-${now.getMonth() + 1}`;
    const currentYearStr = `${now.getFullYear()}`;

    // 1. Relatório Anual (Disponível de 1 a 3 de Janeiro)
    if (now.getMonth() === 0 && now.getDate() <= 3) {
        const lastYearlyShown = localStorage.getItem("last_yearly_summary_shown");
        if (lastYearlyShown !== currentYearStr) {
            localStorage.setItem("last_yearly_summary_shown", currentYearStr);
            setTimeout(() => {
                if (typeof switchReportTab === "function") {
                    switchReportTab(365);
                }
                openModal(modalSmartReport);
            }, 1200);
            return;
        }
    }

    // 2. Relatório Mensal (Disponível de 1 a 3 de qualquer mês)
    if (now.getDate() <= 3) {
        const lastMonthlyShown = localStorage.getItem("last_monthly_summary_shown");
        if (lastMonthlyShown !== currentMonthYearStr) {
            localStorage.setItem("last_monthly_summary_shown", currentMonthYearStr);
            setTimeout(() => {
                if (typeof switchReportTab === "function") {
                    switchReportTab(30);
                }
                openModal(modalSmartReport);
            }, 1200);
            return;
        }
    }

    // 3. Relatório Semanal (Sábado, Domingo)
    const day = now.getDay();
    if (day === 6 || day === 0) { // 6 = Sábado, 0 = Domingo
        const lastWeeklyShown = localStorage.getItem("last_weekly_summary_shown");
        
        // Calcula a data do sábado de referência para este ciclo de 2 dias
        const saturday = new Date(now);
        const diffToSaturday = (day === 6) ? 0 : -1;
        saturday.setDate(saturday.getDate() + diffToSaturday);
        const satStr = getLocalDateString(saturday);

        if (lastWeeklyShown !== satStr) {
            localStorage.setItem("last_weekly_summary_shown", satStr);
            setTimeout(() => {
                if (typeof switchReportTab === "function") {
                    switchReportTab(7);
                }
                openModal(modalSmartReport);
            }, 1200);
        }
    }
}
