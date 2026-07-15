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
let localDataVersion = 0; // Previne race conditions de sync
let scrollPosition = 0;

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
const selectEditTaskCategory = document.getElementById("edit-task-category");
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
const btnOpenManualChecklist = document.getElementById("btn-open-manual-checklist");
const modalManualChecklist = document.getElementById("modal-manual-checklist");
const btnCloseManualChecklistModal = document.getElementById("btn-close-manual-checklist-modal");
const tabManualChecklist = document.getElementById("tab-manual-checklist");
const tabManualNotepad = document.getElementById("tab-manual-notepad");
const contentManualChecklist = document.getElementById("content-manual-checklist");
const contentManualNotepad = document.getElementById("content-manual-notepad");
const inputManualItem = document.getElementById("input-manual-item");
const btnAddManualItem = document.getElementById("btn-add-manual-item");
const manualItemsList = document.getElementById("manual-items-list");
const btnClearCompletedManual = document.getElementById("btn-clear-completed-manual");
const textareaManualNotes = document.getElementById("textarea-manual-notes");
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

    // Carrega dados offline de imediato para renderização instantânea na tela
    // enquanto a sessão do Supabase é verificada assincronamente (evita tela em branco/delay de 1s)
    loadDataOffline();
    renderCategories();
    renderChecklist();
    updateProgress();

    // Connect to Supabase
    connectSupabase();

    // Setup Auth and listen to session changes
    setupSupabaseAuth();

    // Initialize Lucide Icons
    lucide.createIcons();

    // ONE-TIME CLEANUP: Remove duplicates of "teste"
    if (!localStorage.getItem("cleanup_done_v1")) {
        setTimeout(async () => {
            if (!supabaseClient) return;
            try {
                const { data, error } = await supabaseClient
                    .from('tasks')
                    .select('id')
                    .ilike('title', 'teste')
                    .order('created_at', { ascending: true });

                if (error || !data || data.length <= 1) {
                    localStorage.setItem("cleanup_done_v1", "true");
                    return;
                }

                // Keep first, delete the rest
                const toDelete = data.slice(1).map(t => t.id);
                await supabaseClient.from('tasks').delete().in('id', toDelete);
                localStorage.setItem("cleanup_done_v1", "true");
                alert(`Limpeza concluída! Mantive 1 "teste" e removi ${toDelete.length} cópias extras.`);
                loadChecklistAndProgress();
            } catch(e) {
                console.error("Cleanup error:", e);
            }
        }, 3000);
    }

    // Check notifications badge read status
    if (localStorage.getItem("notifications_badge_read") === "true") {
        if (notificationsBadge) notificationsBadge.style.display = "none";
    }
}

// ----------------------------------------------------

function isTemporaryId(id) {
    const str = String(id);
    return /^\d+$/.test(str);
}
// Event Listeners Setup
// ----------------------------------------------------
function setupEventListeners() {
    let initialScrollY = 0;
    let initialTasksScrollTop = 0;
    let lastAddTaskInteractionTime = 0;
    let lastShareInteractionTime = 0;

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

    // Lógica pura de dados — sem animação. Compartilhada entre setas e swipe.
    async function changeDayData(offset) {
        const dateObj = new Date(selectedDate + "T12:00:00");
        dateObj.setDate(dateObj.getDate() + offset);
        selectedDate = getLocalDateString(dateObj);

        updateDateDisplay();
        await loadChecklistAndProgress();
        lucide.createIcons();
    }

    // Para os botões de seta — crossfade + leve escala (sem slide horizontal)
    async function changeDay(offset) {
        const categoriesBar = document.getElementById("categories-bar");

        // Fade out
        const fadeOut = "opacity 0.12s ease-out, transform 0.12s ease-out";
        tasksListEl.style.transition    = fadeOut;
        if (categoriesBar) categoriesBar.style.transition = fadeOut;

        tasksListEl.style.opacity    = "0";
        tasksListEl.style.transform  = `scale(0.97) translateX(${offset > 0 ? "-12px" : "12px"})`;
        if (categoriesBar) {
            categoriesBar.style.opacity   = "0";
            categoriesBar.style.transform = `translateX(${offset > 0 ? "-8px" : "8px"})`;
        }

        await Promise.all([
            new Promise(resolve => setTimeout(resolve, 120)),
            changeDayData(offset)
        ]);

        // Reposiciona do lado oposto (sem transição)
        const inX = offset > 0 ? "12px" : "-12px";
        tasksListEl.style.transition    = "none";
        if (categoriesBar) categoriesBar.style.transition = "none";
        tasksListEl.style.transform     = `scale(0.97) translateX(${inX})`;
        tasksListEl.style.opacity       = "0";
        if (categoriesBar) {
            categoriesBar.style.opacity   = "0";
            categoriesBar.style.transform = `translateX(${offset > 0 ? "8px" : "-8px"})`;
        }
        tasksListEl.offsetHeight; // reflow

        // Fade in
        const fadeIn = "opacity 0.2s ease-out, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)";
        tasksListEl.style.transition    = fadeIn;
        if (categoriesBar) categoriesBar.style.transition = fadeIn;
        tasksListEl.style.opacity       = "1";
        tasksListEl.style.transform     = "scale(1) translateX(0)";
        if (categoriesBar) {
            categoriesBar.style.opacity   = "1";
            categoriesBar.style.transform = "translateX(0)";
        }

        setTimeout(() => {
            tasksListEl.style.transition   = "";
            tasksListEl.style.transform    = "";
            if (categoriesBar) {
                categoriesBar.style.transition = "";
                categoriesBar.style.transform  = "";
            }
        }, 200);
    }

    if (btnPrevDay) {
        btnPrevDay.addEventListener("click", () => changeDay(-1));
    }
    if (btnNextDay) {
        btnNextDay.addEventListener("click", () => changeDay(1));
    }

    // Navegação por deslize em qualquer parte da barra de progresso
    const progressCard = document.querySelector(".progress-card-container");
    if (progressCard) {
        let pcTouchStartX = 0;
        let pcTouchCurrX  = 0;
        let pcActive      = false;
        let pcStartY      = 0;
        let pcLocked      = false;

        const SWIPE_THRESHOLD = 50;
        const DRAG_RESIST     = 0.45;
        const categoriesBar = document.getElementById("categories-bar");

        function applyDrag(dx) {
            // Só o card de progresso se move fisicamente
            const resist = dx * DRAG_RESIST;
            progressCard.style.transform = `translateX(${resist}px)`;

            // Lista e guias apenas fazem fade proporcional ao arraste
            const progress = Math.min(Math.abs(dx) / 120, 1);
            const fadeVal  = 1 - progress * 0.6;
            tasksListEl.style.opacity   = fadeVal;
            if (categoriesBar) categoriesBar.style.opacity = fadeVal + 0.2 > 1 ? 1 : fadeVal + 0.2;
        }

        function resetDrag(animate = true) {
            const t = animate ? "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)" : "none";
            progressCard.style.transition = t;
            progressCard.style.transform  = "translateX(0)";
            progressCard.style.opacity    = "1";

            const tFade = animate ? "opacity 0.25s ease-out" : "none";
            tasksListEl.style.transition  = tFade;
            tasksListEl.style.opacity     = "1";
            tasksListEl.style.transform   = "";
            if (categoriesBar) {
                categoriesBar.style.transition = tFade;
                categoriesBar.style.opacity    = "1";
                categoriesBar.style.transform  = "";
            }
        }

        function throwOut(direction) {
            const offset = direction === "left" ? 1 : -1;
            const outX   = direction === "left" ? "-100vw" : "100vw";
            const inXpx  = offset > 0 ? "12px" : "-12px";

            // Card de progresso sai deslizando
            progressCard.style.transition = "transform 0.15s ease-in, opacity 0.15s ease-in";
            progressCard.style.transform  = `translateX(${outX})`;
            progressCard.style.opacity    = "0";

            // Conteúdo (guias + lista) faz fade out suave
            const contentFade = "opacity 0.12s ease-out, transform 0.12s ease-out";
            tasksListEl.style.transition    = contentFade;
            tasksListEl.style.opacity       = "0";
            tasksListEl.style.transform     = `scale(0.97) translateX(${offset > 0 ? "-8px" : "8px"})`;
            if (categoriesBar) {
                categoriesBar.style.transition = contentFade;
                categoriesBar.style.opacity    = "0";
                categoriesBar.style.transform  = `translateX(${offset > 0 ? "-6px" : "6px"})`;
            }

            // Saída + dados em paralelo
            Promise.all([
                new Promise(resolve => setTimeout(resolve, 150)),
                changeDayData(offset)
            ]).then(() => {
                // Posiciona tudo sem transição
                progressCard.style.transition = "none";
                tasksListEl.style.transition  = "none";
                if (categoriesBar) categoriesBar.style.transition = "none";

                progressCard.style.transform  = `translateX(${direction === "left" ? "100vw" : "-100vw"})`;
                progressCard.style.opacity    = "0";
                tasksListEl.style.opacity     = "0";
                tasksListEl.style.transform   = `scale(0.97) translateX(${inXpx})`;
                if (categoriesBar) {
                    categoriesBar.style.opacity   = "0";
                    categoriesBar.style.transform = `translateX(${offset > 0 ? "6px" : "-6px"})`;
                }

                progressCard.offsetHeight; // reflow

                // Tudo entra junto com spring
                const enterT = "transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease-out";
                progressCard.style.transition = enterT;
                tasksListEl.style.transition  = enterT;
                if (categoriesBar) categoriesBar.style.transition = enterT;

                progressCard.style.transform  = "translateX(0)";
                progressCard.style.opacity    = "1";
                tasksListEl.style.opacity     = "1";
                tasksListEl.style.transform   = "scale(1) translateX(0)";
                if (categoriesBar) {
                    categoriesBar.style.opacity   = "1";
                    categoriesBar.style.transform = "translateX(0)";
                }

                setTimeout(() => {
                    tasksListEl.style.transition   = "";
                    tasksListEl.style.transform    = "";
                    if (categoriesBar) {
                        categoriesBar.style.transition = "";
                        categoriesBar.style.transform  = "";
                    }
                }, 280);
            });
        }

        progressCard.addEventListener("touchstart", (e) => {
            pcTouchStartX = e.touches[0].clientX;
            pcTouchCurrX  = pcTouchStartX;
            pcStartY      = e.touches[0].clientY;
            pcActive      = true;
            pcLocked      = false;

            progressCard.style.transition = "none";
            tasksListEl.style.transition  = "none";
            if (categoriesBar) categoriesBar.style.transition = "none";
        }, { passive: true });

        progressCard.addEventListener("touchmove", (e) => {
            if (!pcActive) return;

            const dx = e.touches[0].clientX - pcTouchStartX;
            const dy = e.touches[0].clientY - pcStartY;

            if (!pcLocked && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;

            if (!pcLocked) {
                if (Math.abs(dy) > Math.abs(dx)) {
                    pcActive = false;
                    resetDrag(true);
                    return;
                }
                pcLocked = true;
            }

            pcTouchCurrX = e.touches[0].clientX;
            applyDrag(dx);

            if (e.cancelable) e.preventDefault();
        }, { passive: false });

        progressCard.addEventListener("touchend", () => {
            if (!pcActive) return;
            pcActive = false;

            const dx = pcTouchCurrX - pcTouchStartX;

            if (dx < -SWIPE_THRESHOLD) {
                throwOut("left");
            } else if (dx > SWIPE_THRESHOLD) {
                throwOut("right");
            } else {
                resetDrag(true);
            }
        });

        progressCard.addEventListener("touchcancel", () => {
            pcActive = false;
            resetDrag(true);
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

        const todayStr = getLocalDateString(new Date());
        const isFutureDate = selectedDate > todayStr;
        if (isEditMode || isHistoryMode || isFutureDate) return;
        
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
        
        const taskId = String(item.dataset.id).match(/^\d+$/) ? parseInt(item.dataset.id, 10) : item.dataset.id; // handle uuid string or int
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

    // Add Task Modal (FAB menu trigger)
    const handleAddTaskTrigger = (e) => {
        const now = Date.now();
        // Cooldown de 300ms para evitar duplo acionamento (pointerdown + click)
        if (now - lastAddTaskInteractionTime < 300) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        lastAddTaskInteractionTime = now;

        e.preventDefault();
        e.stopPropagation();
        const fabMenu = document.getElementById("fab-menu");
        if (fabMenu && !fabMenu.classList.contains("open")) {
            fabMenu.classList.add("open");
            initialScrollY = window.scrollY;
            if (tasksListEl) initialTasksScrollTop = tasksListEl.scrollTop;
            return;
        }

        if (fabMenu) fabMenu.classList.remove("open");

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

        selectTaskRecurring.value = "once";

        // Atualiza as opções de atribuição com base no local selecionado
        updateTaskAssigneeDropdown(selectTaskCategory.value, selectTaskAssignedTo, taskAssigneeGroup);

        // Pré-definir a data da tarefa com a data atualmente selecionada no calendário
        const taskDateInput = document.getElementById("task-date");
        if (taskDateInput) {
            taskDateInput.value = selectedDate;
        }

        // Limpar seleção de turnos
        const shiftButtons = document.querySelectorAll("#add-shift-selector .shift-toggle-btn");
        shiftButtons.forEach(btn => btn.classList.remove("active"));

        openModal(modalAddTask);
    };

    btnAddTaskModal.addEventListener("pointerdown", handleAddTaskTrigger);
    btnAddTaskModal.addEventListener("click", handleAddTaskTrigger);
    btnCloseAddModal.addEventListener("click", () => closeModal(modalAddTask));

    if (selectTaskCategory) {
        selectTaskCategory.addEventListener("change", () => {
            updateTaskAssigneeDropdown(selectTaskCategory.value, selectTaskAssignedTo, taskAssigneeGroup);
        });
    }

    if (selectEditTaskCategory) {
        selectEditTaskCategory.addEventListener("change", () => {
            updateTaskAssigneeDropdown(selectEditTaskCategory.value, selectEditTaskAssignedTo, editTaskAssigneeGroup);
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

    // Turno toggle buttons (for Add and Edit modals)
    document.querySelectorAll(".shift-toggle-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            btn.classList.toggle("active");
        });
    });

    const requestNotificationPermission = async () => {
        if ("Notification" in window) {
            if (Notification.permission === "default") {
                const permission = await Notification.requestPermission();
                if (permission === "granted") {
                    console.log("Permissão de notificação concedida.");
                }
            }
        }
    };

    const chkImportant = document.getElementById("task-important");
    if (chkImportant) {
        chkImportant.addEventListener("change", () => {
            if (chkImportant.checked) requestNotificationPermission();
        });
    }

    const chkEditImportant = document.getElementById("edit-task-important");
    if (chkEditImportant) {
        chkEditImportant.addEventListener("change", () => {
            if (chkEditImportant.checked) requestNotificationPermission();
        });
    }

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

        // Collect selected shifts (turnos)
        const shifts = Array.from(document.querySelectorAll("#add-shift-selector .shift-toggle-btn.active")).map(b => b.dataset.shift);

        try {
            const assignedTo = selectTaskAssignedTo ? selectTaskAssignedTo.value : null;
            const chkImp = document.getElementById("task-important");
            const important = chkImp ? chkImp.checked : false;
            
            await addTask(inputTaskTitle.value.trim(), selectTaskCategory.value, selectTaskRecurring.value, taskDate, repeatDays, assignedTo, shifts, important);
            inputTaskTitle.value = "";
            // Reset day toggles
            document.querySelectorAll("#repeat-days-group .day-toggle").forEach(b => b.classList.remove("active"));
            document.getElementById("repeat-days-group").style.display = "none";
            // Limpa seleção de turnos
            document.querySelectorAll("#add-shift-selector .shift-toggle-btn").forEach(b => b.classList.remove("active"));
            if (chkImp) chkImp.checked = false;
            selectTaskRecurring.value = "once";
            closeModal(modalAddTask);
        } catch (error) {
            console.error("Erro ao adicionar tarefa: ", error);
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
        const newCategory = selectEditTaskCategory ? selectEditTaskCategory.value : null;
        const editShifts = Array.from(document.querySelectorAll("#edit-shift-selector .shift-toggle-btn.active")).map(b => b.dataset.shift);

        // Mescla turnos no context existente (evita bugs caso seja string stringificada)
        const existingTask = tasks.find(t => String(t.id) === String(taskId));
        let context = {};
        if (existingTask && existingTask.context) {
            if (typeof existingTask.context === 'string') {
                try {
                    context = JSON.parse(existingTask.context);
                } catch (e) {
                    context = {};
                }
            } else {
                context = { ...existingTask.context };
            }
        }
        context.turnos = editShifts;
        const chkEditImp = document.getElementById("edit-task-important");
        if (chkEditImp) {
            context.important = chkEditImp.checked;
        }

        const updates = {
            title: newTitle,
            is_recurring: isRecurring,
            repeat_days: repeatDays,
            assigned_to: assignedTo || null,
            context: context
        };
        if (newCategory) updates.category = newCategory;
        if (createdAt) updates.created_at = createdAt;

        // Parse ID (handle uuid string or int)
        const parsedId = String(taskId).match(/^\d+$/) ? parseInt(taskId, 10) : taskId;
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

    // Manual Checklist / Notepad Events
    if (btnOpenManualChecklist) {
        btnOpenManualChecklist.addEventListener("click", () => {
            closeModal(modalNotifications);
            openModal(modalManualChecklist);
            loadManualChecklist();
            loadManualNotes();
        });
    }

    if (btnCloseManualChecklistModal) {
        btnCloseManualChecklistModal.addEventListener("click", () => {
            closeModal(modalManualChecklist);
        });
    }

    // Tabs switcher for manual checklist
    if (tabManualChecklist && tabManualNotepad) {
        tabManualChecklist.addEventListener("click", () => {
            tabManualChecklist.style.background = "var(--bg-surface-solid)";
            tabManualChecklist.style.color = "var(--text-primary)";
            tabManualNotepad.style.background = "transparent";
            tabManualNotepad.style.color = "var(--text-secondary)";
            contentManualChecklist.style.display = "flex";
            contentManualNotepad.style.display = "none";
        });
        
        tabManualNotepad.addEventListener("click", () => {
            tabManualNotepad.style.background = "var(--bg-surface-solid)";
            tabManualNotepad.style.color = "var(--text-primary)";
            tabManualChecklist.style.background = "transparent";
            tabManualChecklist.style.color = "var(--text-secondary)";
            contentManualChecklist.style.display = "none";
            contentManualNotepad.style.display = "flex";
        });
    }

    // Add manual item
    if (btnAddManualItem) {
        btnAddManualItem.addEventListener("click", () => {
            const text = inputManualItem.value.trim();
            if (text) {
                addManualItem(text);
                inputManualItem.value = "";
            }
        });
    }

    if (inputManualItem) {
        inputManualItem.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                const text = inputManualItem.value.trim();
                if (text) {
                    addManualItem(text);
                    inputManualItem.value = "";
                }
            }
        });
    }

    // Clear completed manual items
    if (btnClearCompletedManual) {
        btnClearCompletedManual.addEventListener("click", () => {
            clearCompletedManualItems();
        });
    }

    // Notepad auto save
    if (textareaManualNotes) {
        textareaManualNotes.addEventListener("input", (e) => {
            localStorage.setItem("checklist_manual_notes", e.target.value);
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
    const handleShareReport = (e) => {
        const now = Date.now();
        // Cooldown de 300ms para evitar duplo acionamento (pointerdown + click)
        if (now - lastShareInteractionTime < 300) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        lastShareInteractionTime = now;

        e.preventDefault();
        e.stopPropagation();
        const fabMenu = document.getElementById("fab-menu");
        if (fabMenu) fabMenu.classList.remove("open");
        shareReport();
    };

    btnShareReport.addEventListener("pointerdown", handleShareReport);
    btnShareReport.addEventListener("click", handleShareReport);

    // Close FAB menu when clicking outside, scrolling, or swiping past a threshold
    const closeFabMenu = () => {
        const fabMenu = document.getElementById("fab-menu");
        if (fabMenu && fabMenu.classList.contains("open")) {
            fabMenu.classList.remove("open");
        }
    };

    document.addEventListener("click", (e) => {
        const fabMenu = document.getElementById("fab-menu");
        if (fabMenu && fabMenu.classList.contains("open")) {
            if (!fabMenu.contains(e.target)) {
                closeFabMenu();
            }
        }
    });



    // Fecha se arrastar o dedo na tela principal (fora do menu)
    document.addEventListener("touchmove", (e) => {
        const fabMenu = document.getElementById("fab-menu");
        if (fabMenu && fabMenu.classList.contains("open")) {
            if (!fabMenu.contains(e.target)) {
                // Apenas se arrastar mais de 15px
                const currentScrollY = window.scrollY;
                const currentTasksScroll = tasksListEl ? tasksListEl.scrollTop : 0;
                if (Math.abs(currentScrollY - initialScrollY) > 15 || Math.abs(currentTasksScroll - initialTasksScrollTop) > 15) {
                    closeFabMenu();
                }
            }
        }
    }, { passive: true });

    // Theme Selection Event Listeners
    const themeBtns = document.querySelectorAll(".theme-selector-btn");
    themeBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            applyTheme(btn.dataset.theme);
            renderChecklist();
        });
    });

    // Sincroniza dados locais com a nuvem quando a conexão com a internet é restaurada
    window.addEventListener("online", () => {
        console.log("Internet restaurada! Sincronizando dados offline...");
        syncOfflineDataToCloud();
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
            const catId = String(collabCategoryId.value).match(/^\d+$/) ? parseInt(collabCategoryId.value, 10) : collabCategoryId.value;
            const email = inputCollabEmail.value;
            inviteCollaborator(catId, email);
        });
    }

    if (inputCollabEmail) {
        inputCollabEmail.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                const catId = String(collabCategoryId.value).match(/^\d+$/) ? parseInt(collabCategoryId.value, 10) : collabCategoryId.value;
                const email = inputCollabEmail.value;
                inviteCollaborator(catId, email);
            }
        });
    }

    // Info Notificar Modal Events
    const modalNotificationInfo = document.getElementById("modal-notification-info");
    const btnCloseNotificationInfo = document.getElementById("btn-close-notification-info");
    if (btnCloseNotificationInfo) {
        btnCloseNotificationInfo.addEventListener("click", () => {
            closeModal(modalNotificationInfo);
        });
    }

    document.querySelectorAll(".btn-notification-info").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            openModal(modalNotificationInfo);
        });
    });

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
    
    updateDateState();
}

function updateDateState() {
    const now = new Date();
    const todayStr = getLocalDateString(now);
    const historyBadge = document.getElementById("history-badge");

    if (selectedDate < todayStr) {
        isHistoryMode = true;
        appContainer.classList.add("history-mode");
        appContainer.classList.remove("planning-mode", "today-mode");
        toggleEditMode(false);
        if (historyBadge) historyBadge.innerHTML = "Histórico";
    } else if (selectedDate > todayStr) {
        isHistoryMode = false;
        appContainer.classList.add("planning-mode");
        appContainer.classList.remove("history-mode", "today-mode");
        if (historyBadge) historyBadge.innerHTML = "Planejamento";
    } else {
        isHistoryMode = false;
        appContainer.classList.add("today-mode");
        appContainer.classList.remove("history-mode", "planning-mode");
        if (historyBadge) historyBadge.innerHTML = '<span class="pulse-dot"></span>Hoje';
    }
}

async function loadChecklistAndProgress(skipOfflineReload = false) {
    // 1. Recarrega dados do localStorage, exceto quando chamado após uma mutação otimista local
    // (toggle, drag, delete) — nesses casos, tasks já está correto e recarregar causaria flash de 0%
    if (!skipOfflineReload) {
        loadDataOffline();
    }

    renderCategories();
    renderChecklist();
    updateProgress();
    checkAutomaticReports();
    if (typeof checkImportantTaskNotifications === "function") {
        checkImportantTaskNotifications();
    }

    if (pendingInvites.length > 0 && notificationsBadge) {
        notificationsBadge.style.display = "block";
    }

    // 2. Revalida com o Supabase em segundo plano sem travar a interface do usuário
    if (supabaseClient && currentUser) {
        // Guarda fingerprint dos dados atuais para comparar depois
        const fingerprintBefore = JSON.stringify(tasks.map(t => t.id + '|' + t.title + '|' + t.completed + '|' + JSON.stringify(t.context)));
        const catFingerprintBefore = JSON.stringify(categories.map(c => c.id + '|' + c.name));

        loadData().then((didUpdate) => {
            if (!didUpdate) return; // Se o fetch foi abortado (ex: o usuário arrastou uma tarefa), não re-renderiza nada

            // Só re-renderiza se os dados realmente mudaram — evita flash desnecessário
            const fingerprintAfter = JSON.stringify(tasks.map(t => t.id + '|' + t.title + '|' + t.completed + '|' + JSON.stringify(t.context)));
            const catFingerprintAfter = JSON.stringify(categories.map(c => c.id + '|' + c.name));

            if (fingerprintAfter !== fingerprintBefore) {
                renderChecklist();
                updateProgress();
            }
            if (catFingerprintAfter !== catFingerprintBefore) {
                renderCategories();
            }
            if (pendingInvites.length > 0 && notificationsBadge) {
                notificationsBadge.style.display = "block";
            }
        }).catch(err => {
            console.warn("Erro silencioso ao revalidar dados do Supabase:", err);
        });
    }
}

async function loadData() {
    const versionAtFetchStart = localDataVersion;
    if (supabaseClient && currentUser) {
        try {
            // Executa as consultas ao banco de dados em paralelo usando Promise.all para máxima velocidade de carregamento
            const [
                catsResult,
                countResult,
                tasksResult,
                compTodayResult,
                compBeforeResult,
                sharesOwnerResult,
                sharesCollabResult
            ] = await Promise.all([
                supabaseClient.from('categories').select('*').eq('is_active', true),
                supabaseClient.from('categories').select('*', { count: 'exact', head: true }),
                supabaseClient.from('tasks').select('*').eq('is_active', true),
                supabaseClient.from('completions').select('*').eq('date', selectedDate),
                supabaseClient.from('completions').select('task_id, date, completed').lt('date', selectedDate),
                supabaseClient.from('category_shares').select('*').eq('owner_id', currentUser.id).then(r => r, err => {
                    console.warn("Tabela 'category_shares' não encontrada ou inacessível ao buscar proprietário.", err);
                    return { data: [], error: null };
                }),
                supabaseClient.from('category_shares').select('*').ilike('collaborator_email', currentUser.email.trim()).then(r => r, err => {
                    console.warn("Tabela 'category_shares' não encontrada ou inacessível ao buscar colaborador.", err);
                    return { data: [], error: null };
                })
            ]);

            let dbCats = catsResult.data || [];
            const errCats = catsResult.error;
            
            const count = countResult.count;
            const errCount = countResult.error;
            
            let dbTasks = tasksResult.data || [];
            const errTasks = tasksResult.error;
            
            const dbCompletionsToday = compTodayResult.data || [];
            const errCompToday = compTodayResult.error;
            
            const dbCompletionsBefore = compBeforeResult.data || [];
            const errCompBefore = compBeforeResult.error;

            if (errCats) throw errCats;
            if (errTasks) throw errTasks;
            if (errCompToday) throw errCompToday;
            if (errCompBefore) throw errCompBefore;

            // Mescla compartilhamentos únicos
            const sharesOwner = sharesOwnerResult.data || [];
            const sharesCollab = sharesCollabResult.data || [];
            const mergedSharesMap = new Map();
            sharesOwner.forEach(s => mergedSharesMap.set(String(s.id), s));
            sharesCollab.forEach(s => mergedSharesMap.set(String(s.id), s));
            categoryShares = Array.from(mergedSharesMap.values());
            localStorage.setItem("offline_category_shares", JSON.stringify(categoryShares));

            // Filtra os convites pendentes recebidos
            pendingInvites = categoryShares.filter(s => s.collaborator_email === currentUser.email && s.accepted !== true);
            const collaboratorShares = categoryShares.filter(s => s.collaborator_email === currentUser.email && s.accepted === true);

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
            if (localDataVersion !== versionAtFetchStart) {
                console.warn("Usuário modificou dados durante o carregamento assíncrono. Descartando fetch para evitar flash/zerada da tela.");
                return false;
            }

            // Aplica as atualizações offline na listagem do Supabase antes de renderizar
            let taskUpdatesQueue = JSON.parse(localStorage.getItem("offline_task_updates_queue")) || {};
            if (dbTasks) {
                const existingLocal = JSON.parse(localStorage.getItem("offline_tasks")) || [];
                dbTasks = dbTasks.map(dbTask => {
                    // Garantir que context seja um objeto se vier como string
                    let currentContext = {};
                    if (dbTask.context) {
                        if (typeof dbTask.context === 'string') {
                            try { currentContext = JSON.parse(dbTask.context); } catch (e) { currentContext = {}; }
                        } else {
                            currentContext = { ...dbTask.context };
                        }
                    }

                    // Tenta recuperar a posição da versão local correspondente
                    const localEquiv = existingLocal.find(lt => String(lt.id) === String(dbTask.id));
                    if (localEquiv && localEquiv.context && typeof localEquiv.context.position === 'number') {
                        currentContext.position = localEquiv.context.position;
                    }
                    
                    return { ...dbTask, context: currentContext };
                });

                // Aplica a fila de atualizações pendentes por cima
                Object.keys(taskUpdatesQueue).forEach(id => {
                    const dbUpdates = taskUpdatesQueue[id];
                    const taskIndex = dbTasks.findIndex(t => String(t.id) === String(id));
                    if (taskIndex !== -1) {
                        dbTasks[taskIndex] = { ...dbTasks[taskIndex], ...dbUpdates };
                    }
                });
            }

            categories = dbCats;
            allActiveTasks = dbTasks || [];

            const completedBeforeIds = new Set(dbCompletionsBefore.map(c => c.task_id));
            
            let queue = JSON.parse(localStorage.getItem("offline_completions_queue")) || {};
            Object.keys(queue).forEach(key => {
                const [taskIdStr, dateStr] = key.split('_');
                if (dateStr === selectedDate) {
                    const completed = queue[key];
                    const existingIndex = dbCompletionsToday.findIndex(c => String(c.task_id) === taskIdStr);
                    if (completed) {
                        if (existingIndex !== -1) {
                            dbCompletionsToday[existingIndex].completed = true;
                        } else {
                            dbCompletionsToday.push({ task_id: taskIdStr, date: selectedDate, completed: true });
                        }
                    } else {
                        // Uncheck action: remove from completions if it exists
                        if (existingIndex !== -1 && dbCompletionsToday[existingIndex].completed === true) {
                            dbCompletionsToday.splice(existingIndex, 1);
                        }
                    }
                }
            });

            const completedTodayIds = new Set(dbCompletionsToday.filter(c => c.completed === true).map(c => String(c.task_id)));
            const excludedTodayIds = new Set(dbCompletionsToday.filter(c => c.completed === false).map(c => String(c.task_id)));

            // Map tasks with Rollover and Recurrence
            tasks = dbTasks.filter(task => {
                if (excludedTodayIds.has(String(task.id))) return false;
                
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
                context: typeof task.context === 'string' ? ( () => { try { return JSON.parse(task.context); } catch(e) { return {}; } } )() : task.context || null,
                assigned_to: task.assigned_to || null,
                completed: completedTodayIds.has(String(task.id))
            }));

            // Salva os dados mais recentes carregados do Supabase no cache local.
            // MERGE: Preserva tarefas com tempId pendentes (ainda não confirmadas pelo Supabase)
            // para evitar race condition onde loadData sobrescreve o localStorage antes
            // do addTask background insert concluir e atualizar o tempId para UUID real.
            localStorage.setItem("offline_categories", JSON.stringify(dbCats));
            const existingLocal = JSON.parse(localStorage.getItem("offline_tasks")) || [];
            const pendingLocalTasks = existingLocal.filter(t => isTemporaryId(t.id) && t.is_active !== false);
            
            // mergedTasks já é dbTasks com as posições locais mescladas
            const mergedTasks = [...dbTasks];
            for (const pending of pendingLocalTasks) {
                // Só inclui se não existe uma tarefa idêntica (mesmo titulo+categoria) já no Supabase
                const alreadyExists = mergedTasks.some(d => d.title === pending.title && d.category === pending.category);
                if (!alreadyExists) mergedTasks.push(pending);
            }
            localStorage.setItem("offline_tasks", JSON.stringify(mergedTasks));

            let localCompletions = JSON.parse(localStorage.getItem("offline_completions")) || [];
            
            // Remove conclusões locais obsoletas para a data de hoje e as datas do histórico recebido
            const dbCompBeforeIds = new Set(dbCompletionsBefore.map(c => String(c.task_id)));
            localCompletions = localCompletions.filter(c => {
                const qKey = `${c.task_id}_${c.date}`;
                // Preserva o estado local se esta tarefa estiver com sincronização pendente para a nuvem
                if (pendingToggles.has(c.task_id) || pendingToggles.has(String(c.task_id)) || pendingToggles.has(Number(c.task_id)) || queue.hasOwnProperty(qKey)) {
                    return true;
                }
                if (c.date === selectedDate) return false;
                if (dbCompBeforeIds.has(String(c.task_id)) && c.date < selectedDate) return false;
                return true;
            });

            // Adiciona as conclusões do Supabase para hoje (ignorando as que estão com sync pendente localmente)
            dbCompletionsToday.forEach(c => {
                const qKey = `${c.task_id}_${c.date}`;
                const isPending = pendingToggles.has(c.task_id) || pendingToggles.has(String(c.task_id)) || pendingToggles.has(Number(c.task_id)) || queue.hasOwnProperty(qKey);
                if (!isPending) {
                    localCompletions.push({
                        task_id: c.task_id,
                        date: c.date,
                        completed: c.completed
                    });
                }
            });

            // Adiciona as conclusões do Supabase para o histórico
            dbCompletionsBefore.forEach(c => {
                localCompletions.push({
                    task_id: c.task_id,
                    date: c.date,
                    completed: c.completed
                });
            });

            localStorage.setItem("offline_completions", JSON.stringify(localCompletions));
            return true;
        } catch (err) {
            console.error("Erro ao consultar Supabase. Usando fallback offline.", err);
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
        localCompletions.filter(c => c.date < selectedDate && c.completed === true).map(c => String(c.task_id))
    );
    const completedTodayIds = new Set(
        localCompletions.filter(c => c.date === selectedDate && c.completed === true).map(c => String(c.task_id))
    );
    const excludedTodayIds = new Set(
        localCompletions.filter(c => c.date === selectedDate && c.completed === false).map(c => String(c.task_id))
    );

    // Map tasks
    tasks = localTasks.filter(task => {
        if (!task.is_active) return false;
        if (excludedTodayIds.has(String(task.id))) return false;
        
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
        context: typeof task.context === 'string' ? ( () => { try { return JSON.parse(task.context); } catch(e) { return {}; } } )() : task.context || null,
        assigned_to: task.assigned_to || null,
        completed: completedTodayIds.has(String(task.id))
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

        chip.setAttribute("draggable", "true");
        setupDragAndDrop(chip, cat);

        chip.addEventListener("click", (e) => {
            if (window.wasCategoryDragged) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
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

    // 2. Render options in task category dropdowns (Add and Edit)
    select.innerHTML = "";
    if (selectEditTaskCategory) selectEditTaskCategory.innerHTML = "";
    categories.forEach(cat => {
        const opt = document.createElement("option");
        opt.value = cat.name;
        opt.textContent = cat.name;
        select.appendChild(opt);

        if (selectEditTaskCategory) {
            const optEdit = document.createElement("option");
            optEdit.value = cat.name;
            optEdit.textContent = cat.name;
            selectEditTaskCategory.appendChild(optEdit);
        }
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
    
    // Atualiza os ícones após renderizar as guias e listas
    lucide.createIcons();
}

function renderChecklist() {
    // Aborta a renderização se o usuário estiver arrastando uma tarefa para não causar flash/zerar a tela
    if (isDraggingTask) return;

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

        // Sort: unchecked first, completed last. Within groups, sort by custom order position
        const sortedTasks = isEditMode
            ? [...filteredTasks].sort((a, b) => getTaskOrder(a) - getTaskOrder(b))
            : [...filteredTasks].sort((a, b) => {
                if (a.completed !== b.completed) {
                    return a.completed ? 1 : -1;
                }
                return getTaskOrder(a) - getTaskOrder(b);
            });

        if (currentFilter === "all") {
            // Separa tarefas por turnos para a aba "TODOS"
            const manhaTasks = [];
            const tardeTasks = [];
            const noiteTasks = [];
            const semTurnoTasks = [];

            sortedTasks.forEach(task => {
                const turnos = (task.context && task.context.turnos) ? task.context.turnos : [];
                if (turnos.length === 0) {
                    semTurnoTasks.push(task);
                } else {
                    if (turnos.includes("Manhã")) manhaTasks.push(task);
                    if (turnos.includes("Tarde")) tardeTasks.push(task);
                    if (turnos.includes("Noite")) noiteTasks.push(task);
                }
            });

            const renderGroup = (title, iconName, groupTasks) => {
                if (groupTasks.length === 0) return;
                
                // Div principal do grupo de turno
                const groupContainer = document.createElement("div");
                groupContainer.className = "shift-group";
                groupContainer.dataset.shift = title;

                // Cabeçalho de divisão de Turno
                const header = document.createElement("div");
                header.className = "shift-group-header";
                header.innerHTML = `
                    <div class="shift-group-title">
                        <i data-lucide="${iconName}"></i>
                        <span>${title}</span>
                    </div>
                    <span class="shift-group-count">${groupTasks.length} ${groupTasks.length === 1 ? 'tarefa' : 'tarefas'}</span>
                `;
                groupContainer.appendChild(header);

                // Contêiner das tarefas do turno
                const tasksContainer = document.createElement("div");
                tasksContainer.className = "shift-group-tasks";
                
                // Insere os elementos das tarefas
                groupTasks.forEach(task => {
                    tasksContainer.appendChild(createTaskDOMElement(task));
                });
                
                groupContainer.appendChild(tasksContainer);
                tasksListEl.appendChild(groupContainer);
                
                // Ativa a reordenação por pressionamento tátil (Hold and Drag) neste contêiner
                setupTaskDragAndDrop(tasksContainer, title);
            };

            // Determina o turno atual com base no horário local do dispositivo
            const getCurrentShift = () => {
                const hour = new Date().getHours();
                if (hour >= 5 && hour < 12) return "Manhã";
                if (hour >= 12 && hour < 18) return "Tarde";
                return "Noite";
            };

            const currentShift = getCurrentShift();
            const groupDefinitions = [
                { name: "Manhã", icon: "sunrise", tasks: manhaTasks },
                { name: "Tarde", icon: "sun", tasks: tardeTasks },
                { name: "Noite", icon: "moon", tasks: noiteTasks },
                { name: "Sem Turno / Geral", icon: "archive", tasks: semTurnoTasks }
            ];

            let orderedGroups = [];
            const now = new Date();
            const todayStr = getLocalDateString(now);
            const isToday = (selectedDate === todayStr);

            if (isToday) {
                const currentShift = getCurrentShift();
                const currentGroup = groupDefinitions.find(g => g.name === currentShift);
                if (currentGroup) orderedGroups.push(currentGroup);

                const shiftsOrder = {
                    "Manhã": ["Tarde", "Noite"],
                    "Tarde": ["Noite", "Manhã"],
                    "Noite": ["Tarde", "Manhã"]
                };
                const nextShifts = shiftsOrder[currentShift] || ["Manhã", "Tarde", "Noite"];
                nextShifts.forEach(shiftName => {
                    const group = groupDefinitions.find(g => g.name === shiftName);
                    if (group) orderedGroups.push(group);
                });
            } else {
                // Ordem fixa (cronológica normal) para outros dias
                ["Manhã", "Tarde", "Noite"].forEach(shiftName => {
                    const group = groupDefinitions.find(g => g.name === shiftName);
                    if (group) orderedGroups.push(group);
                });
            }

            const semTurnoGroup = groupDefinitions.find(g => g.name === "Sem Turno / Geral");
            if (semTurnoGroup) orderedGroups.push(semTurnoGroup);

            // Renderiza na ordem de prioridade
            orderedGroups.forEach(group => {
                renderGroup(group.name, group.icon, group.tasks);
            });
        } else {
            // Renderização plana para guias de categorias específicas
            sortedTasks.forEach(task => {
                tasksListEl.appendChild(createTaskDOMElement(task));
            });
        }
        
        lucide.createIcons();
    }
}

// Cria e configura o elemento DOM de um card de tarefa reutilizável
function createTaskDOMElement(task) {
    const taskEl = document.createElement("div");
    taskEl.className = `task-item ${task.completed ? 'completed' : ''}`;
    taskEl.dataset.id = task.id;

    // Estilo dinâmico da categoria
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
                    ${task.context && (task.context.important === true || task.context.important === "true") ? `
                        <span class="task-tag" style="background: rgba(239, 68, 68, 0.12); color: #ef4444; font-weight: 800; display: inline-flex; align-items: center; gap: 3px; border: 1px solid rgba(239, 68, 68, 0.2);"><i data-lucide="star" style="width: 10px; height: 10px; fill: #ef4444;"></i> Importante</span>
                    ` : ''}
                    ${task.context && task.context.turnos && task.context.turnos.length > 0 ? task.context.turnos.map(t => {
                        let iconName = 'sun';
                        if (t === 'Tarde') iconName = 'sunset';
                        if (t === 'Noite') iconName = 'moon';
                        return `<span class="task-tag shift-tag" style="background: rgba(139, 92, 246, 0.06); color: var(--primary); font-weight: 700; display: inline-flex; align-items: center; gap: 3px;"><i data-lucide="${iconName}" style="width: 10px; height: 10px;"></i>${escapeHTML(t)}</span>`;
                    }).join('') : ''}
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

    // Configura botões de ação estáticos (Modo Edição global)
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

    // Configura botões de swipe (WhatsApp/iOS style)
    const btnSwipeDelete = taskEl.querySelector(".task-swipe-actions .delete-btn");
    const handleDeleteAction = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showConfirmDelete(task, (choice) => {
            if (choice === "cancel") {
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

    // Configura o gesto físico de deslize
    setupSwipeToReveal(taskEl);

    return taskEl;
}

// Retorna a posição personalizada de ordenação da tarefa
function getTaskOrder(task) {
    if (task.context && typeof task.context.position === 'number') {
        return task.context.position;
    }
    // Fallback: usar o ID numérico ou string
    const idVal = typeof task.id === 'number' ? task.id : parseFloat(task.id) || 0;
    return idVal;
}

// Configura o sistema de arrastar e soltar (Drag and Drop) para as tarefas dentro de um turno
function setupTaskDragAndDrop(container, shiftName) {
    let dragItem = null;
    let pressTimer = null;
    let isDragging = false;
    let startY = 0;

    container.addEventListener("touchstart", onStart, { passive: false });
    container.addEventListener("mousedown", onStart);
    container.addEventListener("touchend", cancelPress, { passive: true });
    container.addEventListener("touchcancel", cancelPress, { passive: true });
    container.addEventListener("mouseup", cancelPress);
    container.addEventListener("touchmove", (e) => {
        if (!isDragging) {
            cancelPress();
        }
    }, { passive: true });

    function onStart(e) {
        const item = e.target.closest(".task-item");
        if (!item) return;

        // Não arrasta se clicar em botões de ação ou checkbox
        if (e.target.closest(".btn-task-action") || e.target.closest(".swipe-action-btn") || e.target.closest(".task-checkbox-wrapper")) return;

        const touch = e.touches ? e.touches[0] : e;
        startY = touch.clientY;

        // Long press de 600ms
        pressTimer = setTimeout(() => {
            isDragging = true;
            isDraggingTask = true;
            dragItem = item;
            dragItem.classList.add("dragging");

            // Feedback háptico de toque longo
            if (navigator.vibrate) {
                navigator.vibrate(20);
            }

            if (e.touches) {
                window.addEventListener("touchmove", onMove, { passive: false });
                window.addEventListener("touchend", onEnd);
                window.addEventListener("touchcancel", onEnd);
            } else {
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onEnd);
            }
        }, 600);
    }

    function onMove(e) {
        if (!isDragging || !dragItem) return;

        // Bloqueia scroll do navegador
        e.preventDefault();

        const touch = e.touches ? e.touches[0] : e;
        const currentY = touch.clientY;

        const siblings = [...container.querySelectorAll(".task-item:not(.dragging)")];
        let nextSibling = siblings.find(sibling => {
            const box = sibling.getBoundingClientRect();
            const offset = currentY - box.top - box.height / 2;
            return offset < 0;
        });

        if (nextSibling) {
            container.insertBefore(dragItem, nextSibling);
        } else {
            container.appendChild(dragItem);
        }
    }

    function onEnd() {
        cancelPress();
        window.removeEventListener("touchmove", onMove);
        window.removeEventListener("touchend", onEnd);
        window.removeEventListener("touchcancel", onEnd);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onEnd);

        if (isDragging && dragItem) {
            dragItem.classList.remove("dragging");
            saveNewTasksOrder(container);
        }

        isDragging = false;
        isDraggingTask = false;
        dragItem = null;
    }

    function cancelPress() {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    }
}

// Salva a nova ordenação no cache local e dispara update para o banco
function saveNewTasksOrder(container) {
    try {
        localDataVersion++;
        const items = [...container.querySelectorAll(".task-item")];

        // Cria um mapa rápido de realId -> index para este container
        const positionMap = {};
        items.forEach((item, index) => {
            const idString = String(item.dataset.id);
            const realId = idString.includes("_") ? idString.split("_")[0] : idString;
            positionMap[realId] = index;
        });

        // Helper para atualizar o contexto de uma tarefa
        const updateTaskContext = (t) => {
            const realId = String(t.id);
            if (positionMap[realId] !== undefined) {
                let currentContext = {};
                if (t.context) {
                    if (typeof t.context === 'string') {
                        try { currentContext = JSON.parse(t.context); } catch (e) { currentContext = {}; }
                    } else {
                        currentContext = { ...t.context };
                    }
                }
                currentContext.position = positionMap[realId];
                return { ...t, context: currentContext };
            }
            return t;
        };

        // 1. Atualiza memória (tasks e allActiveTasks)
        tasks = tasks.map(updateTaskContext);
        allActiveTasks = allActiveTasks.map(updateTaskContext);

        // 2. Atualiza offline_tasks (localStorage)
        let localTasksFinal = JSON.parse(localStorage.getItem("offline_tasks")) || [];
        localTasksFinal = localTasksFinal.map(updateTaskContext);
        localStorage.setItem("offline_tasks", JSON.stringify(localTasksFinal));

        // 3. Atualiza banco de dados (Supabase) e fila offline
        if (supabaseClient && currentUser) {
            Object.keys(positionMap).forEach(realId => {
                if (isTemporaryId(realId)) return;
                
                const task = tasks.find(t => String(t.id) === realId);
                if (task && task.context) {
                    const dbUpdates = { context: task.context };
                    
                    let updatesQueue = JSON.parse(localStorage.getItem("offline_task_updates_queue")) || {};
                    updatesQueue[realId] = { ...(updatesQueue[realId] || {}), ...dbUpdates };
                    localStorage.setItem("offline_task_updates_queue", JSON.stringify(updatesQueue));

                    supabaseClient.from('tasks').update(dbUpdates).eq('id', realId)
                        .then(({ error }) => {
                            if (error) {
                                console.warn("Erro ao reordenar tarefa " + realId, error);
                            } else {
                                let queue = JSON.parse(localStorage.getItem("offline_task_updates_queue")) || {};
                                delete queue[realId];
                                localStorage.setItem("offline_task_updates_queue", JSON.stringify(queue));
                            }
                        })
                        .catch(err => console.error("Erro assíncrono ao salvar ordenação:", err));
                }
            });
        }

        // Tenta disparar uma sincronização silenciosa para garantir que o banco seja atualizado se possível
        if (navigator.onLine && typeof syncOfflineData === 'function') {
            setTimeout(syncOfflineData, 1000);
        }

    } catch(err) { 
        alert("Erro de ordenação: " + err.message); 
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
    localDataVersion++;
    if (isHistoryMode) return;
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

    // Salva sempre no LocalStorage primeiro para resiliência e velocidade
    saveCompletionOffline(id, selectedDate, task.completed);

    // Se estiver conectado, envia para a nuvem em segundo plano sem bloquear a interface
    if (supabaseClient && currentUser && !isTemporaryId(id)) {
        const query = task.completed
            ? supabaseClient.from('completions').upsert({ task_id: id, date: selectedDate, completed: true }, { onConflict: 'task_id,date' })
            : supabaseClient.from('completions').delete().eq('task_id', id).eq('date', selectedDate);

        query.then(({ error }) => {
            if (error) {
                console.warn("Erro ao salvar conclusão no Supabase. Mantido offline.", error.message);
            } else {
                let queue = JSON.parse(localStorage.getItem("offline_completions_queue")) || {};
                delete queue[`${id}_${selectedDate}`];
                localStorage.setItem("offline_completions_queue", JSON.stringify(queue));
            }
            pendingToggles.delete(id);
        }).catch(err => {
            console.error("Erro assíncrono ao salvar conclusão:", err);
            pendingToggles.delete(id);
        });
    } else {
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

    let queue = JSON.parse(localStorage.getItem("offline_completions_queue")) || {};
    queue[`${taskId}_${date}`] = completed;
    localStorage.setItem("offline_completions_queue", JSON.stringify(queue));
}

async function addTask(title, category, recurrenceMode, customDate, repeatDays, assignedTo, shifts, important = false) {
    if (!title) return;
    const isRecurring = recurrenceMode !== "once";
    const tempId = Date.now();
    
    // Evita problemas de fuso horário definindo a data ao meio-dia
    const createdAtDate = customDate ? new Date(customDate + "T12:00:00") : new Date();
    const createdAt = createdAtDate.toISOString();

    const context = analyzeTaskContext(title, category, tasks) || {};
    if (shifts && shifts.length > 0) {
        context.turnos = shifts;
    }
    if (important) {
        context.important = true;
    }
    console.log(`%c[Motor de Contexto] Tarefa: "${title}" na guia "${category}"`, "color: #8b5cf6; font-weight: bold;", context);

    const newTask = {
        title: title,
        category: category,
        is_recurring: isRecurring,
        is_active: true,
        created_at: createdAt
    };
    if (repeatDays) newTask.repeat_days = repeatDays;
    if (context && Object.keys(context).length > 0) newTask.context = context;
    if (assignedTo) newTask.assigned_to = assignedTo;
    if (currentUser) newTask.user_id = currentUser.id;

    // Salva no local storage offline_tasks
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    localTasks.push({ ...newTask, id: tempId });
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));

    // Reconstrói tasks[] via fluxo centralizado (respeita data, recorrência, filtros)
    loadDataOffline();
    renderChecklist();
    updateProgress();

    // 2. ENVIA PARA A NUVEM EM SEGUNDO PLANO (Sem bloquear a interface do usuário!)
    if (supabaseClient && currentUser) {
        supabaseClient.from('tasks').insert(newTask).select()
            .then(({ data, error }) => {
                if (error) {
                    console.warn("Falha ao salvar tarefa na nuvem. Mantendo localmente.", error.message);
                    return;
                }
                if (data && data.length > 0) {
                    const realTask = data[0];
                    // Atualiza ID na memória
                    tasks = tasks.map(t => String(t.id) === String(tempId) ? { ...t, id: realTask.id } : t);
                    allActiveTasks = allActiveTasks.map(t => String(t.id) === String(tempId) ? realTask : t);
                    // Atualiza local storage removendo o temporário e salvando o real
                    let currentLocalTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
                    currentLocalTasks = currentLocalTasks.map(t => String(t.id) === String(tempId) ? realTask : t);
                    localStorage.setItem("offline_tasks", JSON.stringify(currentLocalTasks));
                }
            })
            .catch(err => {
                console.error("Erro assíncrono ao adicionar tarefa:", err);
            });
    }
}

async function addTaskOffline(title, category, isRecurring, id, createdAt, repeatDays, context, assignedTo) {
    localDataVersion++;
    const now = new Date();
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

async function renameTask(id, newTitle, context) {
    localDataVersion++;
    if (!newTitle) return;

    const existingTask = tasks.find(t => String(t.id) === String(id));
    const category = existingTask ? existingTask.category : "";
    const nlpContext = analyzeTaskContext(newTitle, category, tasks);
    const finalContext = context || nlpContext;

    // Salva no LocalStorage e reconstrói memória via fluxo central
    renameTaskOffline(id, newTitle, finalContext);
    loadDataOffline();
    renderChecklist();

    // 2. ENVIAR PARA O SUPABASE EM SEGUNDO PLANO
    if (supabaseClient && currentUser && !isTemporaryId(id)) {
        const updates = { title: newTitle };
        if (finalContext) updates.context = finalContext;

        let updatesQueue = JSON.parse(localStorage.getItem("offline_task_updates_queue")) || {};
        updatesQueue[id] = { ...(updatesQueue[id] || {}), ...updates };
        localStorage.setItem("offline_task_updates_queue", JSON.stringify(updatesQueue));

        supabaseClient.from('tasks').update(updates).eq('id', id)
            .then(({ error }) => {
                if (error) {
                    console.warn("Erro ao renomear no Supabase. Mantido localmente.", error.message);
                } else {
                    let queue = JSON.parse(localStorage.getItem("offline_task_updates_queue")) || {};
                    delete queue[id];
                    localStorage.setItem("offline_task_updates_queue", JSON.stringify(queue));
                }
            })
            .catch(err => {
                console.error("Erro assíncrono ao renomear:", err);
            });
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
    // Não chama loadDataOffline nem render aqui — renameTask já faz isso
}

// Full task update (title, date, recurrence, repeat_days)
async function updateTask(id, updates) {
    localDataVersion++;
    const existingTask = tasks.find(t => String(t.id) === String(id));
    
    // Analyze new context if title is being updated
    if (updates.title !== undefined) {
        const category = existingTask ? existingTask.category : "";
        const nlpContext = analyzeTaskContext(updates.title, category, tasks) || {};
        // Mescla o contexto analisado com o que já foi enviado (como os turnos selecionados)
        updates.context = { ...(updates.context || {}), ...nlpContext };
    }

    // 1. ATUALIZAÇÃO OTIMISTA LOCAL IMEDIATA
    // Salva no LocalStorage primeiro
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    localTasks = localTasks.map(t => {
        if (String(t.id) === String(id)) return { ...t, ...updates };
        return t;
    });
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));

    // Reconstrói a memória através do fluxo central que aplica as regras de data e filtro corretamente
    loadDataOffline();

    renderChecklist();
    updateProgress();

    // 2. ENVIAR PARA O SUPABASE EM SEGUNDO PLANO
    if (supabaseClient && currentUser && !isTemporaryId(id)) {
        const dbUpdates = {};
        if (updates.title !== undefined) dbUpdates.title = updates.title;
        if (updates.is_recurring !== undefined) dbUpdates.is_recurring = updates.is_recurring;
        if (updates.repeat_days !== undefined) dbUpdates.repeat_days = updates.repeat_days;
        if (updates.created_at !== undefined) dbUpdates.created_at = updates.created_at;
        if (updates.context !== undefined) dbUpdates.context = updates.context;
        if (updates.assigned_to !== undefined) dbUpdates.assigned_to = updates.assigned_to;

        let updatesQueue = JSON.parse(localStorage.getItem("offline_task_updates_queue")) || {};
        updatesQueue[id] = { ...(updatesQueue[id] || {}), ...dbUpdates };
        localStorage.setItem("offline_task_updates_queue", JSON.stringify(updatesQueue));

        supabaseClient.from('tasks').update(dbUpdates).eq('id', id)
            .then(({ error }) => {
                if (error) {
                    console.warn("Erro ao atualizar tarefa no Supabase. Mantido localmente.", error.message);
                } else {
                    let queue = JSON.parse(localStorage.getItem("offline_task_updates_queue")) || {};
                    delete queue[id];
                    localStorage.setItem("offline_task_updates_queue", JSON.stringify(queue));
                }
            })
            .catch(err => {
                console.error("Erro assíncrono ao editar tarefa:", err);
            });
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

    // Configura a categoria
    if (selectEditTaskCategory) {
        selectEditTaskCategory.value = task.category || "";
    }

    // Configura os turnos selecionados
    document.querySelectorAll("#edit-shift-selector .shift-toggle-btn").forEach(btn => {
        const shiftVal = btn.dataset.shift;
        const taskShifts = (task.context && task.context.turnos) ? task.context.turnos : [];
        if (taskShifts.includes(shiftVal)) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });

    // Configura e pré-seleciona a atribuição do colaborador
    updateTaskAssigneeDropdown(task.category, selectEditTaskAssignedTo, editTaskAssigneeGroup);
    if (selectEditTaskAssignedTo) {
        selectEditTaskAssignedTo.value = task.assigned_to || "";
    }

    const chkEditImp = document.getElementById("edit-task-important");
    if (chkEditImp) {
        chkEditImp.checked = task.context && (task.context.important === true || task.context.important === "true");
    }
    
    openModal(modalEditTask);
    lucide.createIcons();
}

async function deleteTask(id) {
    localDataVersion++;
    if (pendingDeletes.has(id)) return;
    pendingDeletes.add(id);

    // 1. ATUALIZAÇÃO OTIMISTA LOCAL IMEDIATA
    tasks = tasks.filter(t => String(t.id) !== String(id));
    allActiveTasks = allActiveTasks.filter(t => String(t.id) !== String(id));
    
    // Salva no LocalStorage
    deleteTaskOffline(id);

    renderChecklist();
    updateProgress();

    // 2. ENVIAR PARA O SUPABASE EM SEGUNDO PLANO
    if (supabaseClient && currentUser) {
        supabaseClient.from('tasks').update({ is_active: false }).eq('id', id)
            .then(({ error }) => {
                if (error) {
                    console.warn("Erro ao deletar no Supabase. Mantido localmente.", error.message);
                }
                pendingDeletes.delete(id);
            })
            .catch(err => {
                console.error("Erro assíncrono ao deletar:", err);
                pendingDeletes.delete(id);
            });
    } else {
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
    // Não chama loadDataOffline nem render aqui — deleteTask já faz isso
}

async function excludeTaskForToday(id) {
    localDataVersion++;
    if (pendingDeletes.has(id)) return;
    pendingDeletes.add(id);

    // 1. ATUALIZAÇÃO OTIMISTA LOCAL IMEDIATA
    tasks = tasks.filter(t => String(t.id) !== String(id));
    
    // Salva no LocalStorage
    excludeTaskForTodayOffline(id);

    renderChecklist();
    updateProgress();

    // 2. ENVIAR PARA O SUPABASE EM SEGUNDO PLANO
    if (supabaseClient && currentUser) {
        supabaseClient.from('completions').upsert({
            task_id: id,
            date: selectedDate,
            completed: false
        }, { onConflict: 'task_id,date' })
            .then(({ error }) => {
                if (error) {
                    console.warn("Erro ao excluir do dia no Supabase. Mantido localmente.", error.message);
                }
                pendingDeletes.delete(id);
            })
            .catch(err => {
                console.error("Erro assíncrono ao excluir do dia:", err);
                pendingDeletes.delete(id);
            });
    } else {
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
    // Não chama loadDataOffline nem render aqui — excludeTaskForToday já faz isso
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
    const btn = document.getElementById("btn-add-collab");
    if (btn && btn.disabled) return; // Evita envio duplo em cliques rápidos
    
    if (!email || !email.trim()) {
        alert("Por favor, digite um e-mail válido.");
        return;
    }
    if (!supabaseClient) {
        alert("Conexão online indisponível.");
        return;
    }
    
    const cat = categories.find(c => String(c.id) === String(catId));
    if (!cat) {
        alert("Erro: Categoria não encontrada nas guias ativas.");
        return;
    }
    
    const cleanEmail = email.trim().toLowerCase();
    
    // Evita convidar a si mesmo ou convidar duplicado
    if (cleanEmail === currentUser.email.toLowerCase()) {
        alert("Você já é o dono e participa desta guia.");
        return;
    }
    
    const exists = categoryShares.some(s => String(s.category_id) === String(catId) && String(s.collaborator_email).trim().toLowerCase() === cleanEmail);
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
    
    if (btn) {
        btn.disabled = true;
        btn.textContent = "Convidando...";
    }
    
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
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = "Convidar";
        }
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

    // 1. ATUALIZAÇÃO OTIMISTA LOCAL IMEDIATA
    const tempId = Date.now();
    const newCat = {
        id: tempId,
        name: name,
        is_active: true
    };
    if (currentUser) {
        newCat.user_id = currentUser.id;
    }

    // Adiciona na memória e local storage
    let localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    if (localCats.some(c => c.name.toLowerCase() === name.toLowerCase() && c.is_active)) {
        alert("Este local/categoria já existe.");
        return;
    }
    categories.push(newCat);
    localCats.push(newCat);
    localStorage.setItem("offline_categories", JSON.stringify(localCats));

    renderCategories();

    // 2. ENVIAR PARA O SUPABASE EM SEGUNDO PLANO
    if (supabaseClient && currentUser) {
        supabaseClient.from('categories').insert({ name: name, is_active: true }).select()
            .then(({ data, error }) => {
                if (error) {
                    console.warn("Erro ao sincronizar nova categoria no Supabase:", error.message);
                    return;
                }
                if (data && data.length > 0) {
                    const realCat = data[0];
                    // Atualiza ID temporário para o real na memória
                    categories = categories.map(c => String(c.id) === String(tempId) ? realCat : c);
                    let currentLocalCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
                    currentLocalCats = currentLocalCats.map(c => String(c.id) === String(tempId) ? realCat : c);
                    localStorage.setItem("offline_categories", JSON.stringify(currentLocalCats));
                }
            })
            .catch(err => {
                console.error("Erro assíncrono ao adicionar categoria:", err);
            });
    }
}

function addCategoryOffline(name) {
    localDataVersion++;
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
    
    loadDataOffline();
    renderCategories();
}

async function deleteCategory(id) {
    localDataVersion++;
    if (confirm("Deseja mesmo excluir este local? As tarefas dele não aparecerão hoje. O histórico passado será mantido.")) {
        // 1. ATUALIZAÇÃO OTIMISTA LOCAL IMEDIATA
        const cat = categories.find(c => String(c.id) === String(id));
        categories = categories.filter(c => String(c.id) !== String(id));
        
        let localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
        localCats = localCats.map(c => {
            if (String(c.id) === String(id)) return { ...c, is_active: false };
            return c;
        });
        localStorage.setItem("offline_categories", JSON.stringify(localCats));

        if (cat && currentFilter === cat.name) {
            currentFilter = "all";
        }
        renderCategories();
        renderChecklist();
        updateProgress();

        // 2. ENVIAR PARA O SUPABASE EM SEGUNDO PLANO
        if (supabaseClient && currentUser && !isTemporaryId(id)) {
            supabaseClient.from('categories').update({ is_active: false }).eq('id', id)
                .then(({ error }) => {
                    if (error) {
                        console.warn("Erro ao deletar categoria no Supabase:", error.message);
                    }
                })
                .catch(err => {
                    console.error("Erro assíncrono ao deletar categoria:", err);
                });
        }
    }
}

function deleteCategoryOffline(id) {
    localDataVersion++;
    let localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    localCats = localCats.map(c => {
        if (String(c.id) === String(id)) return { ...c, is_active: false };
        return c;
    });
    localStorage.setItem("offline_categories", JSON.stringify(localCats));
    
    loadDataOffline();
    renderCategories();
    
    const cat = categories.find(c => String(c.id) === String(id));
    if (cat && currentFilter === cat.name) {
        currentFilter = "all";
    }
    
    loadDataOffline();
    renderChecklist();
    updateProgress();
}

async function resetChecklistProgress() {
    localDataVersion++;
    // 1. ATUALIZAÇÃO OTIMISTA LOCAL IMEDIATA
    tasks = tasks.map(t => ({ ...t, completed: false }));
    resetChecklistProgressOffline();

    // 2. ENVIAR PARA O SUPABASE EM SEGUNDO PLANO
    if (supabaseClient && currentUser) {
        supabaseClient.from('completions').delete().eq('date', selectedDate)
            .then(({ error }) => {
                if (error) console.error("Erro ao resetar progresso no Supabase:", error);
            })
            .catch(err => {
                console.error("Erro assíncrono ao resetar progresso:", err);
            });
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
    // 1. ATUALIZAÇÃO OTIMISTA LOCAL IMEDIATA
    tasks = [];
    allActiveTasks = allActiveTasks.map(t => ({ ...t, is_active: false }));
    clearAllTasksOffline();

    // 2. ENVIAR PARA O SUPABASE EM SEGUNDO PLANO
    if (supabaseClient && currentUser) {
        supabaseClient.from('tasks').update({ is_active: false }).eq('is_active', true)
            .then(({ error }) => {
                if (error) console.error("Erro ao limpar tarefas no Supabase:", error);
            })
            .catch(err => {
                console.error("Erro assíncrono ao limpar tarefas:", err);
            });
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

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(reportText).then(() => {
            const encodedText = encodeURIComponent(reportText);
            const whatsappUrl = `https://api.whatsapp.com/send?text=${encodedText}`;
            alert("Relatório copiado para a área de transferência! Abrindo o WhatsApp...");
            window.location.href = whatsappUrl;
        }).catch(err => {
            console.error("Falha ao copiar relatório: ", err);
            const encodedText = encodeURIComponent(reportText);
            const whatsappUrl = `https://api.whatsapp.com/send?text=${encodedText}`;
            window.location.href = whatsappUrl;
        });
    } else {
        // Fallback direto se o clipboard não for suportado ou não estiver em contexto seguro (HTTPS)
        console.warn("Clipboard API indisponível (HTTP ou restrição). Abrindo WhatsApp direto.");
        const encodedText = encodeURIComponent(reportText);
        const whatsappUrl = `https://api.whatsapp.com/send?text=${encodedText}`;
        window.location.href = whatsappUrl;
    }
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
    
    // Se não há nenhum modal ativo ainda, salva a posição do scroll e trava o body
    const activeModals = document.querySelectorAll(".modal.active");
    if (activeModals.length === 0) {
        scrollPosition = window.pageYOffset || document.documentElement.scrollTop;
        document.body.style.overflow = "hidden";
        document.body.style.position = "fixed";
        document.body.style.top = `-${scrollPosition}px`;
        document.body.style.width = "100%";
    }
    
    modalEl.classList.add("active");
}

function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove("active");
    
    // Se não restou nenhum modal ativo, restaura o scroll
    const activeModals = document.querySelectorAll(".modal.active");
    if (activeModals.length === 0) {
        document.body.style.removeProperty("position");
        document.body.style.removeProperty("top");
        document.body.style.removeProperty("width");
        document.body.style.overflow = "";
        window.scrollTo(0, scrollPosition);
    }
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

        // Ignora renovações de token e eventos secundários para evitar re-renderizações desnecessárias
        if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
            if (session) currentUser = session.user;
            return;
        }

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
    let queue = JSON.parse(localStorage.getItem("offline_completions_queue")) || {};
    let hasChanges = false;
    for (const key of Object.keys(queue)) {
        const [taskId, date] = key.split('_');
        if (isTemporaryId(taskId)) continue; // Can't sync yet

        const completed = queue[key];
        const query = completed
            ? supabaseClient.from('completions').upsert({ task_id: taskId, date: date, completed: true }, { onConflict: 'task_id,date' })
            : supabaseClient.from('completions').delete().eq('task_id', taskId).eq('date', date);
        
        try {
            const { error } = await query;
            if (!error) {
                delete queue[key];
                hasChanges = true;
            }
        } catch(e) {
            console.warn("Erro ao sync", e);
        }
    }
    if (hasChanges) {
        localStorage.setItem("offline_completions_queue", JSON.stringify(queue));
    }

    // Sync task updates
    let taskUpdatesQueue = JSON.parse(localStorage.getItem("offline_task_updates_queue")) || {};
    let hasTaskUpdates = false;
    for (const id of Object.keys(taskUpdatesQueue)) {
        if (isTemporaryId(id)) continue;
        const dbUpdates = taskUpdatesQueue[id];
        try {
            const { error } = await supabaseClient.from('tasks').update(dbUpdates).eq('id', id);
            if (!error) {
                delete taskUpdatesQueue[id];
                hasTaskUpdates = true;
            }
        } catch(e) {
            console.warn("Erro ao sync updateTask", e);
        }
    }
    if (hasTaskUpdates) {
        localStorage.setItem("offline_task_updates_queue", JSON.stringify(taskUpdatesQueue));
    }
}

// Functions for Manual Checklist & Notepad
function loadManualNotes() {
    if (textareaManualNotes) {
        textareaManualNotes.value = localStorage.getItem("checklist_manual_notes") || "";
    }
}

function loadManualChecklist() {
    const items = JSON.parse(localStorage.getItem("checklist_manual_items")) || [];
    renderManualChecklist(items);
}

function renderManualChecklist(items) {
    if (!manualItemsList) return;
    manualItemsList.innerHTML = "";

    if (items.length === 0) {
        manualItemsList.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 20px 0;">
                Nenhum item criado. Digite um item acima!
            </div>
        `;
        return;
    }

    items.forEach(item => {
        const itemEl = document.createElement("div");
        itemEl.className = "manual-task-item";
        if (item.completed) {
            itemEl.classList.add("completed");
        }

        const checkboxWrapper = document.createElement("div");
        checkboxWrapper.style.cssText = "display: flex; align-items: center; gap: 12px; flex: 1;";
        
        const customCheckbox = document.createElement("div");
        customCheckbox.className = "task-checkbox";
        if (item.completed) {
            customCheckbox.innerHTML = '<i data-lucide="check" style="width: 12px; height: 12px; color: white;"></i>';
        }

        const textSpan = document.createElement("span");
        textSpan.className = "task-text";
        textSpan.textContent = item.text;

        checkboxWrapper.appendChild(customCheckbox);
        checkboxWrapper.appendChild(textSpan);
        
        itemEl.addEventListener("click", () => {
            toggleManualItem(item.id);
        });

        const btnDelete = document.createElement("button");
        btnDelete.className = "icon-button";
        btnDelete.style.cssText = "padding: 6px; color: var(--text-muted); opacity: 0.7; z-index: 5;";
        btnDelete.innerHTML = '<i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>';
        btnDelete.addEventListener("click", (e) => {
            e.stopPropagation();
            deleteManualItem(item.id);
        });

        itemEl.appendChild(checkboxWrapper);
        itemEl.appendChild(btnDelete);
        manualItemsList.appendChild(itemEl);
    });

    lucide.createIcons();
}

function addManualItem(text) {
    const items = JSON.parse(localStorage.getItem("checklist_manual_items")) || [];
    items.push({
        id: Date.now(),
        text: text,
        completed: false
    });
    localStorage.setItem("checklist_manual_items", JSON.stringify(items));
    renderManualChecklist(items);
}

function toggleManualItem(id) {
    let items = JSON.parse(localStorage.getItem("checklist_manual_items")) || [];
    items = items.map(item => {
        if (item.id === id) {
            return { ...item, completed: !item.completed };
        }
        return item;
    });
    localStorage.setItem("checklist_manual_items", JSON.stringify(items));
    renderManualChecklist(items);
}

function deleteManualItem(id) {
    let items = JSON.parse(localStorage.getItem("checklist_manual_items")) || [];
    items = items.filter(item => item.id !== id);
    localStorage.setItem("checklist_manual_items", JSON.stringify(items));
    renderManualChecklist(items);
}

function clearCompletedManualItems() {
    let items = JSON.parse(localStorage.getItem("checklist_manual_items")) || [];
    items = items.filter(item => !item.completed);
    localStorage.setItem("checklist_manual_items", JSON.stringify(items));
    renderManualChecklist(items);
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
let isDraggingTask = false; // Lock global: bloqueia re-renders durante drag de tarefa
window.wasCategoryDragged = false; // Bloqueia clique indesejado após arrastar

function setupDragAndDrop(chip, cat) {
    let pressTimer = null;
    let isDragging = false;

    // Mouse dragging (HTML5 native)
    chip.addEventListener("dragstart", (e) => {
        draggedElement = chip;
        chip.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
    });

    chip.addEventListener("dragover", (e) => {
        if (!draggedElement) return;
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
        chip.classList.remove("dragging");
        draggedElement = null;
        saveCategoryOrder();
    });

    // Touch support para mobile - long-press de 350ms para iniciar drag
    let touchStartX = 0;
    let touchStartY = 0;

    chip.addEventListener("touchstart", (e) => {
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;

        pressTimer = setTimeout(() => {
            isDragging = true;
            draggedElement = chip;
            chip.classList.add("dragging");
            if (navigator.vibrate) navigator.vibrate(20);

            // Agora que o drag começou, escuta movimentos na window toda
            window.addEventListener("touchmove", onWindowTouchMove, { passive: false });
            window.addEventListener("touchend", onWindowTouchEnd, { passive: true });
            window.addEventListener("touchcancel", onWindowTouchEnd, { passive: true });
        }, 500);
    }, { passive: true });

    chip.addEventListener("touchmove", (e) => {
        if (isDragging) return; // Já está gerenciado pelo listener da window
        
        // Cancela o timer apenas se o dedo se mover mais de 18px (distância euclidiana)
        // 8px era muito sensível — o iOS deriva naturalmente ao segurar quieto
        const touch = e.touches[0];
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 18) {
            cancelPress();
        }
    }, { passive: true });

    // Cancela o timer num tap rápido (sem iniciar drag)
    // Se o drag já começou (isDragging=true), não faz nada — onWindowTouchEnd cuida disso
    chip.addEventListener("touchend", () => {
        if (!isDragging) cancelPress();
    });
    chip.addEventListener("touchcancel", () => {
        if (!isDragging) cancelPress();
    });

    function onWindowTouchMove(e) {
        if (!isDragging || !draggedElement) return;
        e.preventDefault();

        const touch = e.touches[0];
        
        // Esconde temporariamente o chip arrastado para achar o elemento por baixo
        draggedElement.style.pointerEvents = 'none';
        const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
        draggedElement.style.pointerEvents = '';

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
        }
    }

    function onWindowTouchEnd() {
        window.removeEventListener("touchmove", onWindowTouchMove);
        window.removeEventListener("touchend", onWindowTouchEnd);
        window.removeEventListener("touchcancel", onWindowTouchEnd);

        // Cancela timer se ainda não disparou
        cancelPress();

        if (isDragging && draggedElement) {
            draggedElement.classList.remove("dragging");
            // Remove foco/borda residual do iOS
            if (draggedElement.blur) draggedElement.blur();
            draggedElement = null;
            saveCategoryOrder();
            
            // Bloqueia clique indesejado logo após arrastar
            window.wasCategoryDragged = true;
            setTimeout(() => {
                window.wasCategoryDragged = false;
            }, 200);
        }
        isDragging = false;
    }

    const cancelPress = () => {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    };
}

async function saveCategoryOrder() {
    localDataVersion++;
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

// ----------------------------------------------------
// Sistema de Notificações de Tarefas Importantes ("Estilo iFood")
// ----------------------------------------------------
function checkImportantTaskNotifications() {
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const now = new Date();
    const todayStr = getLocalDateString(now);

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = getLocalDateString(tomorrow);

    const shownAlerts = JSON.parse(localStorage.getItem("shown_notifications")) || {};
    let updated = false;

    // Helper para buscar tarefas ativas de uma data específica
    const getActiveTasksForDate = (dateStr) => {
        let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
        let localCompletions = JSON.parse(localStorage.getItem("offline_completions")) || [];
        
        const completedIds = new Set(
            localCompletions.filter(c => c.date === dateStr && c.completed === true).map(c => String(c.task_id))
        );
        const excludedIds = new Set(
            localCompletions.filter(c => c.date === dateStr && c.completed === false).map(c => String(c.task_id))
        );

        return localTasks.filter(task => {
            if (!task.is_active) return false;
            if (excludedIds.has(String(task.id))) return false;
            if (completedIds.has(String(task.id))) return false; // Se já concluiu, ignora
            
            const taskCreatedDate = extractDateFromTimestamp(task.created_at);
            
            if (task.is_recurring) {
                if (task.repeat_days && task.repeat_days.length > 0) {
                    const viewDate = new Date(dateStr + 'T12:00:00');
                    const dayOfWeek = viewDate.getDay();
                    const repeatDaysNum = task.repeat_days.map(Number);
                    return taskCreatedDate <= dateStr && repeatDaysNum.includes(dayOfWeek);
                }
                return taskCreatedDate <= dateStr;
            } else {
                return taskCreatedDate === dateStr;
            }
        });
    };

    const todayTasks = getActiveTasksForDate(todayStr);
    const tomorrowTasks = getActiveTasksForDate(tomorrowStr);

    const checkTask = (task, targetDateStr) => {
        const isImportant = task.context && (task.context.important === true || task.context.important === "true");
        if (!isImportant) return;

        const turnos = task.context.turnos || [];
        
        // Horas de início dos turnos: Manhã (05h), Tarde (12h), Noite (18h), Geral (08h)
        let earliestHour = 8;
        if (turnos.includes("Manhã")) earliestHour = 5;
        else if (turnos.includes("Tarde")) earliestHour = 12;
        else if (turnos.includes("Noite")) earliestHour = 18;

        const targetDateTime = new Date(`${targetDateStr}T${String(earliestHour).padStart(2, '0')}:00:00`);

        // 1. Notificação de 1 dia antes
        const oneDayBeforeTime = new Date(targetDateTime.getTime() - 24 * 60 * 60 * 1000);
        const dayBeforeKey = `task_${task.id}_${targetDateStr}_dayBefore`;
        
        if (now >= oneDayBeforeTime && now < targetDateTime && !shownAlerts[dayBeforeKey]) {
            showWebNotification(
                "⚠️ Tarefa Importante Amanhã!",
                `A tarefa "${task.title}" está agendada para amanhã no turno da ${turnos.join(', ') || 'Geral'}.`,
                task.id
            );
            shownAlerts[dayBeforeKey] = true;
            updated = true;
        }

        // 2. Notificação de 1 turno antes
        let shiftBeforeTime;
        if (turnos.includes("Tarde")) {
            shiftBeforeTime = new Date(`${targetDateStr}T05:00:00`);
        } else if (turnos.includes("Noite")) {
            shiftBeforeTime = new Date(`${targetDateStr}T12:00:00`);
        } else if (turnos.includes("Manhã")) {
            const prevDay = new Date(targetDateTime);
            prevDay.setDate(prevDay.getDate() - 1);
            const prevDayStr = getLocalDateString(prevDay);
            shiftBeforeTime = new Date(`${prevDayStr}T18:00:00`);
        } else {
            shiftBeforeTime = new Date(targetDateTime.getTime() - 4 * 60 * 60 * 1000); // 4h antes para Geral
        }

        const shiftBeforeKey = `task_${task.id}_${targetDateStr}_shiftBefore`;
        if (now >= shiftBeforeTime && now < targetDateTime && !shownAlerts[shiftBeforeKey]) {
            let shiftMsg = "";
            if (turnos.includes("Tarde")) shiftMsg = "no turno da Tarde (próximo turno)";
            else if (turnos.includes("Noite")) shiftMsg = "no turno da Noite (próximo turno)";
            else if (turnos.includes("Manhã")) shiftMsg = "amanhã de Manhã (próximo turno)";
            else shiftMsg = "em breve (daqui a 4 horas)";

            showWebNotification(
                "⏰ Próxima tarefa importante!",
                `A tarefa "${task.title}" está agendada para ${shiftMsg}.`,
                task.id
            );
            shownAlerts[shiftBeforeKey] = true;
            updated = true;
        }
    };

    todayTasks.forEach(task => checkTask(task, todayStr));
    tomorrowTasks.forEach(task => checkTask(task, tomorrowStr));

    if (updated) {
        localStorage.setItem("shown_notifications", JSON.stringify(shownAlerts));
    }
}

function showWebNotification(title, body, taskId) {
    if (Notification.permission === "granted") {
        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
            navigator.serviceWorker.ready.then(registration => {
                registration.showNotification(title, {
                    body: body,
                    icon: './icon-192.png',
                    badge: './icon-192.png',
                    vibrate: [200, 100, 200],
                    data: { taskId: taskId },
                    tag: `task-important-${taskId}`
                });
            });
        } else {
            new Notification(title, {
                body: body,
                icon: './icon-192.png'
            });
        }
    }
}

// Verifica as notificações de tarefas importantes a cada 60 segundos
setInterval(checkImportantTaskNotifications, 60000);
