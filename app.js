(function() {
// ----------------------------------------------------
// Supabase Configuration
// ----------------------------------------------------
const SUPABASE_URL = "https://piwsavppaabjygaolldb.supabase.co";
const SUPABASE_KEY = "sb_publishable_KTpEV6wW6w5QGJekeeCMzA_TyCJbpfV";
const VAPID_PUBLIC_KEY = "BDMZZmJLbDTsdx-q5iUosoKiFxXvF_f58Yzjs2nndWWdo-bgspEIyXlTIjkl9uD6blOyD33T43hrKy1fPHuMwFs";
const SERVICE_WORKER_URL = "./sw.js?v=10.22";
// O tipo acompanha a categoria na nuvem para que regras especiais, como a
// visualização colaborativa de treinos, sejam iguais em todos os aparelhos.
const CATEGORIES_CLOUD_SUPPORTS_TYPE = true;

// Camada persistente isolada em storage.js para manter este arquivo focado nas regras do app.
const { dbCache, idb, localPrefs, localStorage } = window.ChecklistStorage.create({
    onStorageChange: () => scheduleSyncStatusRefresh(),
    onCloudQueueChange: () => scheduleCloudSync("fila-local", 450)
});

// Novas contas e restaurações começam sem categorias pessoais pré-cadastradas.
const DEFAULT_CATEGORIES = [];
const LEGACY_AUTO_SEEDED_CATEGORIES = ["Tio Nan", "Cassol", "PUCRS"];

// Default tasks database for initial setup (offline fallback and reset option)
const DEFAULT_TASKS = [];

function dedupeCategories(list) {
    const byId = new Map();
    (Array.isArray(list) ? list : []).forEach(category => {
        if (!category) return;
        const idKey = category.id !== undefined && category.id !== null ? String(category.id) : `missing-${byId.size}`;
        const previous = byId.get(idKey);
        byId.set(idKey, previous ? { ...previous, ...category, type: category.type || previous.type || null } : category);
    });
    // A mesma categoria compartilhada pode chegar pela consulta do proprietário e
    // pela consulta de compartilhamentos. Além disso, versões antigas permitiam
    // que cada participante criasse seu próprio "Treino". Exibimos apenas uma
    // categoria por nome, mas preservamos todos os IDs para consultar o histórico.
    const byNormalizedName = new Map();
    [...byId.values()].forEach(category => {
        const normalizedName = normalizeCategoryName(category.name);
        const ownerId = category.user_id ? String(category.user_id) : "";
        const stableKey = isTrainingCategory(category.name)
            ? `training::${normalizedName}`
            : (ownerId && normalizedName ? `${ownerId}::${normalizedName}` : `id::${String(category.id)}`);
        const previous = byNormalizedName.get(stableKey);
        if (!previous) {
            return byNormalizedName.set(stableKey, { ...category, merged_category_ids: [category.id] });
        }
        const previousTemporary = isTemporaryId(previous.id);
        const currentTemporary = isTemporaryId(category.id);
        const previousShared = (categoryShares || []).some(share => String(share.category_id) === String(previous.id) && share.accepted === true);
        const currentShared = (categoryShares || []).some(share => String(share.category_id) === String(category.id) && share.accepted === true);
        const canonical = previousTemporary && !currentTemporary
            ? category
            : (!previousShared && currentShared ? category : previous);
        const supplemental = canonical === category ? previous : category;
        const mergedIds = [...new Set([
            ...(previous.merged_category_ids || [previous.id]),
            ...(category.merged_category_ids || [category.id])
        ].filter(id => id !== undefined && id !== null))];
        byNormalizedName.set(stableKey, {
            ...supplemental,
            ...canonical,
            type: canonical.type || supplemental.type || null,
            merged_category_ids: mergedIds
        });
    });
    return [...byNormalizedName.values()];
}

function normalizeCategoryName(value) {
    return String(value || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}

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
let currentTrainingCalendarMonth = new Date();
let currentTrainingCalendarRecords = [];
let trainingThumbnailCacheJob = null;

// Async transaction locks (prevents double submits)
let pendingDeletes = new Set();
let pendingToggles = new Set();

// Authentication State
let currentUser = null;
let currentUsername = "";
const collaborationIdentityByEmail = new Map();
const collaborationAvatarByEmail = new Map();
const collaborationIdentityByUserId = new Map();
const collaborationAvatarByUserId = new Map();
const persistentAvatarByUrl = new Map();
const pendingAvatarCacheUrls = new Set();
let identifierSetupResolver = null;
function getCurrentReminderTime() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function updateTaskReminderSummary(mode, enabled, time, offsetDays) {
    const element = document.getElementById(mode === "edit" ? "edit-task-reminder-summary" : "task-reminder-summary");
    if (!element) return;
    element.textContent = enabled
        ? `${Number(offsetDays) === 1 ? "1 dia antes" : "No mesmo dia"} às ${time}`
        : "Lembrar sobre esta tarefa";
    element.classList.toggle("configured", enabled);
}

let addTaskReminderTime = getCurrentReminderTime();
let editTaskReminderTime = getCurrentReminderTime();
let addTaskReminderOffsetDays = 0;
let editTaskReminderOffsetDays = 0;

function chooseTaskReminderTime(currentValue = "08:00", currentOffsetDays = 0) {
    return new Promise(resolve => {
        const layer = document.createElement("div");
        layer.className = "reminder-picker-layer";
        const presets = [{ time: "08:00", label: "Início da manhã", icon: "sunrise" }, { time: "12:00", label: "Hora do almoço", icon: "sun" }, { time: "18:00", label: "Fim da tarde", icon: "sunset" }, { time: "21:00", label: "À noite", icon: "moon" }];
        layer.innerHTML = `<div class="reminder-picker-backdrop"></div><div class="reminder-picker-card" role="dialog" aria-modal="true"><div class="reminder-picker-icon"><i data-lucide="alarm-clock"></i></div><h3>Quando deseja ser lembrado?</h3><p>Escolha o dia e o horário do lembrete.</p><div class="reminder-day-choice"><button type="button" data-offset="0" class="${currentOffsetDays === 0 ? "selected" : ""}">No mesmo dia</button><button type="button" data-offset="1" class="${currentOffsetDays === 1 ? "selected" : ""}">1 dia antes</button></div><div class="reminder-preset-grid">${presets.map(item => `<button type="button" data-time="${item.time}" class="${currentValue === item.time ? "selected" : ""}"><i data-lucide="${item.icon}"></i><strong>${item.time}</strong><span>${item.label}</span></button>`).join("")}</div><label class="reminder-custom-label">Outro horário<input class="reminder-custom-time" type="time" value="${escapeHTML(currentValue)}"></label><div class="reminder-picker-actions"><button type="button" class="btn reminder-cancel">Cancelar</button><button type="button" class="btn btn-primary reminder-confirm">Salvar lembrete</button></div></div>`;
        document.body.appendChild(layer);
        if (window.lucide) window.lucide.createIcons();
        let selectedTime = currentValue;
        let selectedOffsetDays = currentOffsetDays;
        const customInput = layer.querySelector(".reminder-custom-time");
        layer.querySelectorAll("[data-time]").forEach(button => button.addEventListener("click", () => {
            selectedTime = button.dataset.time;
            customInput.value = selectedTime;
            layer.querySelectorAll("[data-time]").forEach(item => item.classList.toggle("selected", item === button));
        }));
        customInput.addEventListener("input", () => { selectedTime = customInput.value; layer.querySelectorAll("[data-time]").forEach(item => item.classList.toggle("selected", item.dataset.time === selectedTime)); });
        layer.querySelectorAll("[data-offset]").forEach(button => button.addEventListener("click", () => {
            selectedOffsetDays = Number(button.dataset.offset);
            layer.querySelectorAll("[data-offset]").forEach(item => item.classList.toggle("selected", item === button));
        }));
        const finish = value => { layer.classList.remove("visible"); setTimeout(() => layer.remove(), 240); resolve(value); };
        layer.querySelector(".reminder-cancel").addEventListener("click", () => finish(null));
        layer.querySelector(".reminder-picker-backdrop").addEventListener("click", () => finish(null));
        layer.querySelector(".reminder-confirm").addEventListener("click", () => finish({ time: selectedTime || "08:00", offsetDays: selectedOffsetDays }));
        requestAnimationFrame(() => layer.classList.add("visible"));
    });
}
let isAuthModeLogin = true;
let localDataVersion = 0; // Previne race conditions de sync
let dataLoadRequestVersion = 0; // Impede respostas antigas de outra data de sobrescreverem a tela
let pendingCompletionAnimationTaskId = null;
let renderCompletionAnimationTaskId = null;

function beginOptimisticMutation() {
    localDataVersion += 1;
    // Invalida imediatamente qualquer leitura iniciada antes da ação do usuário.
    // Assim uma resposta antiga nunca repinta a tarefa que acabou de mudar.
    dataLoadRequestVersion += 1;
}
let scrollPosition = 0;
let learningCloudState = "idle";
let reportsCloudState = "idle";
let currentReportCorrectionTasks = {};
let pendingAutocompleteDetailsTask = null;
let collaborationRealtimeChannel = null;
let categoryOnboardingTimer = null;
let categoryOnboardingSlide = 0;
let lastStartupInteractionAt = 0;
let isSwipeRevealInteracting = false;
let pendingSwipeSafeRender = null;
let activePushFocusTaskId = null;
let activePushFocusUntil = 0;
let pendingPushFocusRender = null;

function registerStartupInteraction() {
    lastStartupInteractionAt = Date.now();
}

async function waitForStartupInteractionToSettle() {
    if (document.body.dataset.hasChecklistCache !== "true") return;
    const observationEndsAt = Date.now() + 850;
    while (Date.now() < observationEndsAt || Date.now() - lastStartupInteractionAt < 450) {
        await new Promise(resolve => setTimeout(resolve, 90));
    }
}

function getNoticeKind(message) {
    const text = String(message || "").toLowerCase();
    if (/erro|não foi possível|indisponível|bloquead|inválid/.test(text)) return "error";
    if (/sucesso|concluíd|copiado|aceito|enviado|saiu|removido|criada/.test(text)) return "success";
    if (/atenção|selecione|cadastre|adicione|aguarde/.test(text)) return "warning";
    return "info";
}

function showAppNotice(message, kind = getNoticeKind(message)) {
    let stack = document.getElementById("app-notice-stack");
    if (!stack) {
        stack = document.createElement("div");
        stack.id = "app-notice-stack";
        stack.className = "app-notice-stack";
        document.body.appendChild(stack);
    }
    const icons = { success: "circle-check", error: "circle-x", warning: "triangle-alert", info: "info" };
    const notice = document.createElement("div");
    notice.className = `app-notice ${kind}`;
    notice.setAttribute("role", kind === "error" ? "alert" : "status");
    notice.innerHTML = `<span class="app-notice-icon"><i data-lucide="${icons[kind] || icons.info}"></i></span><div><strong>${kind === "success" ? "Tudo certo" : kind === "error" ? "Algo deu errado" : kind === "warning" ? "Atenção" : "Checklist"}</strong><p>${escapeHTML(String(message))}</p></div><button type="button" aria-label="Fechar"><i data-lucide="x"></i></button>`;
    stack.appendChild(notice);
    if (window.lucide) window.lucide.createIcons();
    const close = () => { notice.classList.remove("visible"); setTimeout(() => notice.remove(), 260); };
    notice.querySelector("button").addEventListener("click", close);
    requestAnimationFrame(() => notice.classList.add("visible"));
    setTimeout(close, kind === "error" ? 6000 : 4200);
}

async function showAppConfirm(message, options = {}) {
    return new Promise(resolve => {
        const layer = document.createElement("div");
        layer.className = "app-confirm-layer";
        layer.innerHTML = `<div class="app-confirm-backdrop"></div><div class="app-confirm-card" role="alertdialog" aria-modal="true"><span class="app-confirm-icon"><i data-lucide="${options.danger ? "trash-2" : "circle-help"}"></i></span><h3>${escapeHTML(options.title || "Confirmar ação")}</h3><p>${escapeHTML(String(message))}</p><div class="app-confirm-actions"><button class="btn app-confirm-cancel">${escapeHTML(options.cancelText || "Cancelar")}</button><button class="btn ${options.danger ? "app-confirm-danger" : "btn-primary"} app-confirm-ok">${escapeHTML(options.confirmText || "Confirmar")}</button></div></div>`;
        document.body.appendChild(layer);
        if (window.lucide) window.lucide.createIcons();
        const finish = value => { layer.classList.remove("visible"); setTimeout(() => layer.remove(), 260); resolve(value); };
        layer.querySelector(".app-confirm-cancel").addEventListener("click", () => finish(false));
        layer.querySelector(".app-confirm-backdrop").addEventListener("click", () => finish(false));
        layer.querySelector(".app-confirm-ok").addEventListener("click", () => finish(true));
        requestAnimationFrame(() => layer.classList.add("visible"));
    });
}

// Mantém chamadas informativas antigas dentro da identidade visual do app.
window.alert = message => showAppNotice(message);

// Supabase Client instance
let supabaseClient = null;

// DOM Elements
const tasksListEl = document.getElementById("tasks-list");
const emptyStateEl = document.getElementById("empty-state");
const btnOnboardingCreateCategory = document.getElementById("btn-onboarding-create-category");
const taskCreationOnboarding = document.getElementById("task-creation-onboarding");
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
const appSessionLoader = document.getElementById("app-session-loader");
const syncStatusEl = document.getElementById("sync-status");
const syncStatusLabelEl = document.getElementById("sync-status-label");

let syncStatusRefreshTimer = null;

function setSyncStatus(state, label, title = label) {
    if (!syncStatusEl || !syncStatusLabelEl) return;
    syncStatusEl.dataset.state = state;
    syncStatusLabelEl.textContent = label;
    syncStatusEl.title = title;
}

function hasPendingSyncData() {
    const pendingCategories = (dbCache.offline_categories || []).some(c => isTemporaryId(c.id) && c.is_active !== false);
    const pendingTasks = (dbCache.offline_tasks || []).some(t => isTemporaryId(t.id) && t.is_active !== false);
    const pendingCompletions = Object.keys(dbCache.offline_completions_queue || {}).length > 0;
    const pendingUpdates = Object.keys(dbCache.offline_task_updates_queue || {}).length > 0;
    const pendingInvites = (JSON.parse(localStorage.getItem("offline_collaboration_invites_queue")) || []).length > 0;
    const pendingTrainingPhotos = Number(localPrefs.getItem("pending_training_photo_uploads") || 0) > 0;
    return pendingCategories || pendingTasks || pendingCompletions || pendingUpdates || pendingInvites || pendingTrainingPhotos;
}

function refreshSyncStatusFromQueues() {
    if (!syncStatusEl) return;
    const hasPending = hasPendingSyncData();
    const pendingCount = getPendingSyncCount();

    if (!navigator.onLine) {
        setSyncStatus("offline", hasPending ? `Offline — ${pendingCount} pendente${pendingCount === 1 ? "" : "s"}` : "Offline", hasPending ? "Sem internet; toque para tentar quando a conexão voltar" : "Sem conexão com a internet");
    } else if (isSyncing) {
        setSyncStatus("syncing", pendingCount ? `Salvando ${pendingCount}…` : "Confirmando…", "Enviando alterações para a nuvem");
    } else if (hasPending) {
        setSyncStatus("pending", `${pendingCount} pendente${pendingCount === 1 ? "" : "s"}`, cloudSyncLastError ? `Última tentativa: ${cloudSyncLastError}. Toque para tentar novamente.` : "Toque para sincronizar agora");
    } else {
        const lastSuccess = cloudSyncLastSuccessAt ? new Date(cloudSyncLastSuccessAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
        setSyncStatus("synced", "Sincronizado", lastSuccess ? `Última confirmação às ${lastSuccess}` : "Todos os dados estão sincronizados");
    }
}

function scheduleSyncStatusRefresh(delay = 0) {
    clearTimeout(syncStatusRefreshTimer);
    syncStatusRefreshTimer = setTimeout(refreshSyncStatusFromQueues, delay);
}

let cloudSyncTimer = null;
let cloudSyncRerunRequested = false;
let cloudSyncRetryCount = 0;
let cloudSyncLastError = "";
let cloudSyncLastSuccessAt = 0;

function getPendingSyncCount() {
    const pendingCategories = (dbCache.offline_categories || []).filter(item => isTemporaryId(item.id) && item.is_active !== false).length;
    const pendingTasks = (dbCache.offline_tasks || []).filter(item => isTemporaryId(item.id) && item.is_active !== false).length;
    const pendingCompletions = Object.keys(dbCache.offline_completions_queue || {}).length;
    const pendingUpdates = Object.keys(dbCache.offline_task_updates_queue || {}).length;
    const pendingInvites = (JSON.parse(localPrefs.getItem("offline_collaboration_invites_queue") || "[]") || []).length;
    const pendingTrainingPhotos = Number(localPrefs.getItem("pending_training_photo_uploads") || 0);
    return pendingCategories + pendingTasks + pendingCompletions + pendingUpdates + pendingInvites + pendingTrainingPhotos;
}

function scheduleCloudSync(reason = "alteração-local", delay = 350) {
    if (!supabaseClient || !currentUser || !navigator.onLine) return;
    if (isSyncing) {
        cloudSyncRerunRequested = true;
        return;
    }
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(() => {
        cloudSyncTimer = null;
        if (!hasPendingSyncData()) {
            refreshSyncStatusFromQueues();
            return;
        }
        syncOfflineDataToCloud(reason);
    }, Math.max(0, delay));
}

function scheduleCloudSyncRetry() {
    if (!navigator.onLine || !hasPendingSyncData()) return;
    cloudSyncRetryCount = Math.min(cloudSyncRetryCount + 1, 6);
    const delay = Math.min(30000, 1200 * (2 ** (cloudSyncRetryCount - 1)));
    scheduleCloudSync("tentativa-automática", delay);
}

function clearQueuedEntryIfCurrent(queueName, entryKey, expectedValue) {
    const queue = JSON.parse(localStorage.getItem(queueName)) || {};
    if (!Object.prototype.hasOwnProperty.call(queue, entryKey)) return true;
    if (JSON.stringify(queue[entryKey]) !== JSON.stringify(expectedValue)) return false;
    delete queue[entryKey];
    localStorage.setItem(queueName, JSON.stringify(queue));
    return true;
}

// Modals
const modalAddTask = document.getElementById("modal-add-task");
const modalManageTasks = document.getElementById("modal-manage-tasks");
const modalCalendar = document.getElementById("modal-calendar");
const modalSmartReport = document.getElementById("modal-smart-report");
const modalConfirmDelete = document.getElementById("modal-confirm-delete");
const modalGesturesTutorial = document.getElementById("modal-gestures-tutorial");
const btnSmartReport = document.getElementById("btn-smart-report");
const btnCloseSmartReportModal = document.getElementById("btn-close-smart-report-modal");
const btnSaveSmartReport = document.getElementById("btn-save-smart-report");
let activeSmartReportDays = 7;

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
let sharedTaskNotifications = [];
let notificationPreviewTimer = null;
let lastNotificationPreviewKey = "";

// Forms & Inputs
const formAddTask = document.getElementById("form-add-task");
const inputTaskTitle = document.getElementById("task-title");
let suppressTaskAutocompleteSubmit = false;
const selectTaskCategory = document.getElementById("task-category");
const selectEditTaskCategory = document.getElementById("edit-task-category");
const selectTaskRecurring = document.getElementById("task-recurring");
const selectTaskAssignedTo = document.getElementById("task-assigned-to");
const taskAssigneeGroup = document.getElementById("task-assignee-group");

const modalEditTask = document.getElementById("modal-edit-task");
const selectEditTaskAssignedTo = document.getElementById("edit-task-assigned-to");
const editTaskAssigneeGroup = document.getElementById("edit-task-assignee-group");

const inputOrgName = document.getElementById("input-org-name");
const inputProfileAvatar = document.getElementById("input-profile-avatar");
const settingsProfileAvatar = document.getElementById("settings-profile-avatar");
const inputNewCategory = document.getElementById("input-new-category");

// Action Buttons
const btnNotifications = document.getElementById("btn-notifications");
const modalNotifications = document.getElementById("modal-notifications");
const btnCloseNotificationsModal = document.getElementById("btn-close-notifications-modal");
const notificationsListContainer = document.getElementById("notifications-list-container");
const notificationsBadge = document.getElementById("notifications-badge");
const collabInviteReadyLabel = document.getElementById("collab-invite-ready-label");
const notificationsEnabledToggle = document.getElementById("notifications-enabled-toggle");
const notificationsPermissionStatus = document.getElementById("notifications-permission-status");
const btnRepairTestPush = document.getElementById("btn-repair-test-push");
const modalCreateIdentifier = document.getElementById("modal-create-identifier");
const formCreateIdentifier = document.getElementById("form-create-identifier");
const inputUserIdentifier = document.getElementById("input-user-identifier");
const identifierError = document.getElementById("identifier-error");
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
const btnToggleSummary = document.getElementById("btn-toggle-summary");
const btnShareReport = document.getElementById("btn-share-report");
const btnCloseAddModal = document.getElementById("btn-close-add-modal");
const btnCloseManageModal = document.getElementById("btn-close-manage-modal");
const modalManageCategories = document.getElementById("modal-manage-categories");
const btnOpenManageCategories = document.getElementById("btn-open-manage-categories");
const btnCloseManageCategoriesModal = document.getElementById("btn-close-manage-categories-modal");
const btnOpenGesturesTutorial = document.getElementById("btn-open-gestures-tutorial");
const btnCloseGesturesTutorial = document.getElementById("btn-close-gestures-tutorial");

const btnAddCategory = document.getElementById("btn-add-category");

const btnCloseCalendar = document.getElementById("btn-close-calendar");
const btnPrevMonth = document.getElementById("btn-prev-month");
const btnNextMonth = document.getElementById("btn-next-month");
const calendarMonthYear = document.getElementById("calendar-month-year");
const calendarDaysGrid = document.getElementById("calendar-days-grid");
const modalTrainingPhoto = document.getElementById("modal-training-photo");
const inputTrainingPhoto = document.getElementById("input-training-photo");
const modalTrainingReport = document.getElementById("modal-training-report");
let pendingTrainingCompletionId = null;
let pendingTrainingPastNightException = false;

// ----------------------------------------------------
// Initialization
// ----------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    document.addEventListener("pointerdown", registerStartupInteraction, { passive: true, capture: true });
    document.addEventListener("touchstart", registerStartupInteraction, { passive: true, capture: true });
    setSyncStatus(navigator.onLine ? "checking" : "offline", navigator.onLine ? "Verificando…" : "Offline");
    initApp();
    setupEventListeners();
    
    // Register Service Worker for PWA compatibility on Android
    if ('serviceWorker' in navigator) {
        let reloadingForServiceWorkerUpdate = false;

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloadingForServiceWorkerUpdate) return;
            // Não interrompe um destino aberto por push. A nova versão do
            // worker já está ativa e pode ser usada sem recarregar esta tela.
            if (modalTrainingReport?.classList.contains("active")) return;
            reloadingForServiceWorkerUpdate = true;
            window.location.reload();
        });

        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data && event.data.type === 'OPEN_TRAINING_REPORT') {
                openTrainingCalendarFromPush(event.data.taskId, event.data.trainingDate);
            } else if (event.data && event.data.type === 'OPEN_SHARED_TASK' && event.data.taskId) {
                focusSharedTaskFromNotification({ task_id: event.data.taskId });
            } else if (event.data && event.data.type === 'OPEN_TASK_REMINDER' && event.data.taskId) {
                openTaskReminderAction(event.data.taskId);
            } else if (event.data && event.data.type === 'OPEN_COLLABORATION_INVITE' && event.data.inviteId) {
                promptCollaborationInviteNavigation(event.data.inviteId);
            } else if (event.data && event.data.type === 'OPEN_NOTIFICATIONS') {
                renderNotifications();
                openModal(modalNotifications);
                markCurrentInvitesAsSeen();
            }
        });

        let serviceWorkerRegistration = null;
        const activateWaitingWorker = registration => {
            if (registration && registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        };
        const checkPwaUpdate = () => {
            if (!serviceWorkerRegistration || !navigator.onLine) return;
            serviceWorkerRegistration.update()
                .then(() => activateWaitingWorker(serviceWorkerRegistration))
                .catch(error => console.warn('Verificação de atualização do PWA indisponível:', error.message));
        };

        // A versão na própria URL evita que Chrome/WebAPK reutilize uma
        // validação antiga do sw.js ao retomar o PWA no Android.
        navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: './', updateViaCache: 'none' })
            .then(reg => {
                serviceWorkerRegistration = reg;
                console.log('Service Worker registrado com sucesso:', reg);
                activateWaitingWorker(reg);
                reg.addEventListener('updatefound', () => {
                    const installing = reg.installing;
                    if (!installing) return;
                    installing.addEventListener('statechange', () => {
                        if (installing.state === 'installed') activateWaitingWorker(reg);
                    });
                });
                return reg.update();
            })
            .catch(err => console.error('Erro ao registrar Service Worker:', err));

        window.addEventListener('pageshow', checkPwaUpdate);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') checkPwaUpdate();
        });
        window.addEventListener('online', checkPwaUpdate);
    }
});

async function initApp() {
    // Inicializa o IndexedDB e carrega o cache
    try {
        await idb.init();
        await idb.loadAllToCache();
        const savedAvatars = await idb.get("priority_profile_avatars") || {};
        Object.entries(savedAvatars).forEach(([url, dataUrl]) => {
            if (url && dataUrl) persistentAvatarByUrl.set(url, dataUrl);
        });
    } catch (e) {
        console.error("Falha ao inicializar IndexedDB:", e);
    }

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

    // Com cache útil, abre o checklist imediatamente e revalida silenciosamente.
    // Sem cache, mantém a tela curta até a primeira carga da conta terminar.
    const cachedCategories = JSON.parse(localStorage.getItem("offline_categories")) || [];
    const cachedTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    const hasUsefulCache = cachedCategories.some(category => category.is_active !== false)
        || cachedTasks.some(task => task.is_active !== false);
    const isWarmDevice = localPrefs.getItem("checklist_device_cache_ready") === "true";
    document.body.dataset.hasChecklistCache = hasUsefulCache ? "true" : "false";
    if (hasUsefulCache || isWarmDevice) {
        loadDataOffline();
        renderCategories();
        renderChecklist();
        updateProgress();
        updateSmartReportButtonVisibility();
        appContainer.style.display = "flex";
        if (appSessionLoader) appSessionLoader.classList.add("hidden");
    } else {
        appContainer.style.display = "none";
    }

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
    
    // O destaque do relatório é controlado junto da disponibilidade do botão.
}

// ----------------------------------------------------

function isTemporaryId(id) {
    const str = String(id);
    return str.startsWith("temp-") || (/^\d{13,}$/.test(str));
}
// Event Listeners Setup
// ----------------------------------------------------
function setupEventListeners() {
    let initialScrollY = 0;
    let initialTasksScrollTop = 0;
    let lastAddTaskInteractionTime = 0;
    let lastShareInteractionTime = 0;

    setupTaskTitleAutocomplete();
    setupAiTaskCreator();

    const showTrainingReportLoading = () => {
        const grid = document.getElementById("training-calendar-grid");
        const summary = document.getElementById("training-report-summary");
        if (grid) grid.innerHTML = '<div class="training-calendar-loading"><span class="loading-spinner"></span><strong>Carregando treinos…</strong></div>';
        if (summary) summary.innerHTML = '<small>Buscando fotos e dias treinados</small>';
    };
    const openContextualTrainingReport = async () => {
        if (currentFilter === "all" || !isTrainingCategory(currentFilter)) return;
        currentTrainingCalendarMonth = new Date(selectedDate + "T12:00:00");
        openModal(modalTrainingReport);
        renderTrainingReport();
    };
    document.getElementById("btn-open-training-calendar")?.addEventListener("click", openContextualTrainingReport);
    document.getElementById("btn-training-calendar-prev")?.addEventListener("click", async () => {
        currentTrainingCalendarMonth.setMonth(currentTrainingCalendarMonth.getMonth() - 1);
        renderTrainingReport();
    });
    document.getElementById("btn-training-calendar-next")?.addEventListener("click", async () => {
        currentTrainingCalendarMonth.setMonth(currentTrainingCalendarMonth.getMonth() + 1);
        renderTrainingReport();
    });
    document.getElementById("btn-close-training-report")?.addEventListener("click", () => closeModal(modalTrainingReport));
    modalTrainingReport?.querySelector(".modal-overlay")?.addEventListener("click", () => closeModal(modalTrainingReport));
    const finishTrainingWithoutPhoto = () => finishPendingTrainingCompletion(null);
    const cancelPendingTrainingCompletion = () => {
        if (pendingTrainingCompletionId === null) return;
        pendingTrainingCompletionId = null;
        pendingTrainingPastNightException = false;
        inputTrainingPhoto.value = "";
        closeModal(modalTrainingPhoto);
    };
    document.getElementById("btn-skip-training-photo")?.addEventListener("click", finishTrainingWithoutPhoto);
    document.getElementById("btn-complete-without-photo")?.addEventListener("click", finishTrainingWithoutPhoto);
    document.getElementById("btn-cancel-training-completion")?.addEventListener("click", cancelPendingTrainingCompletion);
    inputTrainingPhoto?.addEventListener("change", async () => {
        const file = inputTrainingPhoto.files?.[0];
        if (!file) return;
        try {
            const photo = await compressTrainingPhoto(file);
            await finishPendingTrainingCompletion(photo);
        } catch (error) {
            console.error("Erro ao preparar foto do treino:", error);
            showAppNotice("Não foi possível salvar essa foto. Tente novamente.", "error");
        } finally {
            inputTrainingPhoto.value = "";
        }
    });

    // Smart Report Modal Events
    // Smart Report Tab Switcher and Listeners
    const tabWeekly = document.getElementById("tab-report-weekly");
    const tabMonthly = document.getElementById("tab-report-monthly");
    const tabYearly = document.getElementById("tab-report-yearly");
    const tabHistory = document.getElementById("tab-report-history");
    const reportSummaryTitle = document.getElementById("report-summary-title");
    const reportSummaryContent = document.getElementById("report-summary-content");

    switchReportTab = (days) => {
        activeSmartReportDays = days;
        [tabWeekly, tabMonthly, tabYearly, tabHistory].forEach(tab => {
            if (tab) tab.classList.remove("active");
        });
        
        if (days === 7) {
            if (btnSaveSmartReport) btnSaveSmartReport.style.display = "inline-flex";
            if (tabWeekly) tabWeekly.classList.add("active");
            if (reportSummaryTitle) reportSummaryTitle.innerHTML = `<i data-lucide="sparkles" style="width: 16px; height: 16px;"></i> Resumo Semanal`;
            loadAndRenderReport(7, reportSummaryContent);
        } else if (days === 30) {
            if (btnSaveSmartReport) btnSaveSmartReport.style.display = "inline-flex";
            if (tabMonthly) tabMonthly.classList.add("active");
            if (reportSummaryTitle) reportSummaryTitle.innerHTML = `<i data-lucide="sparkles" style="width: 16px; height: 16px;"></i> Resumo Mensal`;
            loadAndRenderReport(30, reportSummaryContent);
        } else if (days === 365) {
            if (btnSaveSmartReport) btnSaveSmartReport.style.display = "inline-flex";
            if (tabYearly) tabYearly.classList.add("active");
            if (reportSummaryTitle) reportSummaryTitle.innerHTML = `<i data-lucide="sparkles" style="width: 16px; height: 16px;"></i> Resumo Anual`;
            loadAndRenderReport(365, reportSummaryContent);
        } else if (days === "history") {
            if (btnSaveSmartReport) btnSaveSmartReport.style.display = "none";
            if (tabHistory) tabHistory.classList.add("active");
            if (reportSummaryTitle) reportSummaryTitle.innerHTML = `<i data-lucide="archive" style="width: 16px; height: 16px;"></i> Histórico de Relatórios`;
            loadAndRenderReportHistory(reportSummaryContent, reportSummaryTitle);
        }
    };

    if (tabWeekly) tabWeekly.addEventListener("click", () => switchReportTab(7));
    if (tabMonthly) tabMonthly.addEventListener("click", () => switchReportTab(30));
    if (tabYearly) tabYearly.addEventListener("click", () => switchReportTab(365));
    if (tabHistory) tabHistory.addEventListener("click", () => switchReportTab("history"));

    const modalReportCorrection = document.getElementById("modal-report-correction");
    const selectCorrectionTask = document.getElementById("select-report-correction-task");
    const selectCorrectionFunction = document.getElementById("select-report-correction-function");
    const btnSaveCorrection = document.getElementById("btn-save-report-correction");
    const closeCorrection = () => closeModal(modalReportCorrection);
    document.getElementById("btn-close-report-correction")?.addEventListener("click", closeCorrection);
    modalReportCorrection?.querySelector(".modal-overlay")?.addEventListener("click", closeCorrection);
    document.addEventListener("click", event => {
        const correctionButton = event.target.closest(".btn-correct-report-function");
        if (!correctionButton || !selectCorrectionTask) return;
        const categoryName = decodeURIComponent(correctionButton.dataset.category || "");
        const correctionTasks = currentReportCorrectionTasks[categoryName] || [];
        selectCorrectionTask.innerHTML = correctionTasks.map(task => `<option value="${encodeURIComponent(String(task.id))}">${escapeHTML(task.title)}</option>`).join("");
        selectCorrectionFunction.value = "";
        openModal(modalReportCorrection);
    });
    btnSaveCorrection?.addEventListener("click", async () => {
        if (!selectCorrectionTask?.value || !selectCorrectionFunction?.value) return;
        const taskId = decodeURIComponent(selectCorrectionTask.value);
        const task = Object.values(currentReportCorrectionTasks).flat().find(item => String(item.id) === taskId);
        if (!task) return;
        saveLearnedFunctionAssociation(task.title, selectCorrectionFunction.value);
        btnSaveCorrection.textContent = "Correção aprendida ✓";
        btnSaveCorrection.disabled = true;
        setTimeout(() => {
            btnSaveCorrection.textContent = "Salvar correção";
            btnSaveCorrection.disabled = false;
            closeCorrection();
            if (typeof activeSmartReportDays === "number") switchReportTab(activeSmartReportDays);
        }, 700);
    });

    if (btnSmartReport) {
        btnSmartReport.addEventListener("click", () => {
            const attentionKey = getSmartReportAttentionKey();
            if (attentionKey) localStorage.setItem(attentionKey, "true");
            btnSmartReport.classList.remove("report-attention");
            const now = new Date();
            const defaultPeriod = (now.getMonth() === 0 && now.getDate() <= 3)
                ? 365
                : (now.getDate() <= 3 ? 30 : 7);
            switchReportTab(defaultPeriod);
            openModal(modalSmartReport);
        });
    }
    if (btnSaveSmartReport) {
        btnSaveSmartReport.addEventListener("click", saveCurrentSmartReport);
    }
    if (btnCloseSmartReportModal) {
        btnCloseSmartReportModal.addEventListener("click", () => {
            closeModal(modalSmartReport);
        });
    }

    // Toggle Summary blocks
    const summaryBlockContainer = document.querySelector(".progress-card-container.compact-header-section");
    const miniDateContainer = document.getElementById("header-mini-date-container");

    const updateSummaryVisibility = (isCollapsed) => {
        if (isCollapsed) {
            if (summaryBlockContainer) summaryBlockContainer.classList.add("hidden");
            if (miniDateContainer) miniDateContainer.style.display = "flex";
            if (btnToggleSummary) {
                btnToggleSummary.innerHTML = `<i data-lucide="eye-off"></i>`;
                btnToggleSummary.title = "Mostrar Resumo";
            }
        } else {
            if (summaryBlockContainer) summaryBlockContainer.classList.remove("hidden");
            if (miniDateContainer) miniDateContainer.style.display = "none";
            if (btnToggleSummary) {
                btnToggleSummary.innerHTML = `<i data-lucide="eye"></i>`;
                btnToggleSummary.title = "Ocultar Resumo";
            }
        }
        if (window.lucide) window.lucide.createIcons();
    };

    // Load initial preference
    const summaryCollapsed = localStorage.getItem("summary_collapsed") === "true";
    updateSummaryVisibility(summaryCollapsed);

    if (btnToggleSummary) {
        btnToggleSummary.addEventListener("click", () => {
            const currentlyCollapsed = summaryBlockContainer && summaryBlockContainer.classList.contains("hidden");
            const newCollapsed = !currentlyCollapsed;
            localStorage.setItem("summary_collapsed", newCollapsed);
            updateSummaryVisibility(newCollapsed);
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
        btnPrevDay.addEventListener("click", (e) => {
            e.stopPropagation();
            changeDay(-1);
        });
    }
    if (btnNextDay) {
        btnNextDay.addEventListener("click", (e) => {
            e.stopPropagation();
            changeDay(1);
        });
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

    // Permite trocar o dia deslizando apenas nas faixas vazias junto às
    // bordas, com o resumo aberto ou recolhido. Assim o gesto não disputa
    // com os swipes dos blocos nem das tarefas (editar/excluir).
    if (appContainer) {
        const EDGE_SWIPE_ZONE = 28;
        const EDGE_SWIPE_THRESHOLD = 70;
        const EDGE_DIRECTION_RATIO = 1.5;
        let edgeSwipeActive = false;
        let edgeSwipeLocked = false;
        let edgeSwipeStartX = 0;
        let edgeSwipeStartY = 0;
        let edgeSwipeCurrentX = 0;
        let edgeSwipeCurrentY = 0;
        let edgeSwipeChangingDay = false;

        const isInteractiveSwipeTarget = (target) =>
            target.closest(".progress-card-container, .task-item, .categories-bar, .app-header, .fab-menu-container, button, input, select, textarea, a, .modal");

        appContainer.addEventListener("touchstart", (e) => {
            edgeSwipeActive = false;
            edgeSwipeLocked = false;

            if (edgeSwipeChangingDay || e.touches.length !== 1) return;
            if (isInteractiveSwipeTarget(e.target)) return;

            const touch = e.touches[0];
            const appRect = appContainer.getBoundingClientRect();
            const distanceFromLeft = touch.clientX - appRect.left;
            const distanceFromRight = appRect.right - touch.clientX;
            const startedAtEdge = distanceFromLeft <= EDGE_SWIPE_ZONE || distanceFromRight <= EDGE_SWIPE_ZONE;

            if (!startedAtEdge) return;

            edgeSwipeStartX = edgeSwipeCurrentX = touch.clientX;
            edgeSwipeStartY = edgeSwipeCurrentY = touch.clientY;
            edgeSwipeActive = true;
        }, { passive: true });

        appContainer.addEventListener("touchmove", (e) => {
            if (!edgeSwipeActive || e.touches.length !== 1) return;

            edgeSwipeCurrentX = e.touches[0].clientX;
            edgeSwipeCurrentY = e.touches[0].clientY;
            const dx = edgeSwipeCurrentX - edgeSwipeStartX;
            const dy = edgeSwipeCurrentY - edgeSwipeStartY;

            if (!edgeSwipeLocked && Math.abs(dx) < 10 && Math.abs(dy) < 10) return;

            if (!edgeSwipeLocked) {
                if (Math.abs(dx) < Math.abs(dy) * EDGE_DIRECTION_RATIO) {
                    edgeSwipeActive = false;
                    return;
                }
                edgeSwipeLocked = true;
            }

            if (e.cancelable) e.preventDefault();
        }, { passive: false });

        appContainer.addEventListener("touchend", async () => {
            if (!edgeSwipeActive) return;
            edgeSwipeActive = false;

            const dx = edgeSwipeCurrentX - edgeSwipeStartX;
            const dy = edgeSwipeCurrentY - edgeSwipeStartY;
            const isDeliberateHorizontalSwipe =
                edgeSwipeLocked &&
                Math.abs(dx) >= EDGE_SWIPE_THRESHOLD &&
                Math.abs(dx) >= Math.abs(dy) * EDGE_DIRECTION_RATIO;

            if (!isDeliberateHorizontalSwipe) return;

            edgeSwipeChangingDay = true;
            try {
                await changeDay(dx < 0 ? 1 : -1);
            } finally {
                edgeSwipeChangingDay = false;
            }
        }, { passive: true });

        appContainer.addEventListener("touchcancel", () => {
            edgeSwipeActive = false;
            edgeSwipeLocked = false;
        }, { passive: true });
    }


    // Toggle Task Complete (using event delegation)
    tasksListEl.addEventListener("click", async (e) => {
        if (e.target.closest(".btn-task-action") || e.target.closest(".swipe-action-btn") || e.target.closest(".task-description-toggle") || e.target.closest(".task-description-panel")) return;

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

        const now = new Date();
        const todayStr = getLocalDateString(now);
        const isFutureDate = selectedDate > todayStr;
        
        let isPastNightShiftException = false;
        const yesterdayDate = new Date(now);
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterdayStr = getLocalDateString(yesterdayDate);
        
        if (selectedDate === yesterdayStr && now.getHours() < 12) {
            const taskId = String(item.dataset.id).match(/^\d+$/) ? parseInt(item.dataset.id, 10) : item.dataset.id;
            const task = tasks.find(t => String(t.id) === String(taskId));
            const turnos = (task && task.context && task.context.turnos) ? task.context.turnos : [];
            if (turnos.includes("Noite")) {
                isPastNightShiftException = true;
            }
        }

        if (isEditMode || (isHistoryMode && !isPastNightShiftException)) return;

        const taskId = String(item.dataset.id).match(/^\d+$/) ? parseInt(item.dataset.id, 10) : item.dataset.id;
        const selectedTask = tasks.find(task => String(task.id) === String(taskId));
        if (!canCurrentUserCheckTask(selectedTask)) {
            if (navigator.vibrate) navigator.vibrate([18, 35, 18]);
            showTaskCheckPermissionNotice(selectedTask);
            return;
        }

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
        
        await toggleTask(taskId, { completeAtCurrentMoment: isFutureDate });
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
    btnManageTasks.addEventListener("click", () => {
        updateNotificationsSettingUI();
        openModal(modalManageTasks);
    });
    btnCloseManageModal.addEventListener("click", () => closeModal(modalManageTasks));

    // Gestures tutorial carousel
    if (modalGesturesTutorial && btnOpenGesturesTutorial) {
        const carousel = document.getElementById("gestures-carousel");
        const carouselTrack = document.getElementById("gestures-carousel-track");
        const carouselDots = document.getElementById("gestures-carousel-dots");
        const carouselCounter = document.getElementById("gesture-slide-counter");
        const btnGesturePrev = document.getElementById("btn-gesture-prev");
        const btnGestureNext = document.getElementById("btn-gesture-next");
        const slides = Array.from(carouselTrack.querySelectorAll(".gesture-slide"));
        let currentGestureSlide = 0;
        let carouselTouchStartX = 0;
        let carouselTouchStartY = 0;

        const dots = slides.map((_, index) => {
            const dot = document.createElement("button");
            dot.type = "button";
            dot.className = "gesture-dot";
            dot.setAttribute("aria-label", `Ir para o gesto ${index + 1}`);
            dot.addEventListener("click", () => updateGestureSlide(index));
            carouselDots.appendChild(dot);
            return dot;
        });

        function updateGestureSlide(index) {
            currentGestureSlide = Math.max(0, Math.min(index, slides.length - 1));
            carouselTrack.style.transform = `translateX(-${currentGestureSlide * 100}%)`;
            carouselCounter.textContent = `${currentGestureSlide + 1} de ${slides.length}`;
            btnGesturePrev.disabled = currentGestureSlide === 0;
            btnGestureNext.disabled = currentGestureSlide === slides.length - 1;
            dots.forEach((dot, dotIndex) => {
                dot.classList.toggle("active", dotIndex === currentGestureSlide);
                dot.setAttribute("aria-current", dotIndex === currentGestureSlide ? "step" : "false");
            });
        }

        const closeGesturesTutorial = () => {
            closeModal(modalGesturesTutorial);
            openModal(modalManageTasks);
        };

        btnOpenGesturesTutorial.addEventListener("click", () => {
            closeModal(modalManageTasks);
            updateGestureSlide(0);
            openModal(modalGesturesTutorial);
        });
        btnCloseGesturesTutorial.addEventListener("click", closeGesturesTutorial);
        document.getElementById("overlay-gestures-tutorial").addEventListener("click", closeGesturesTutorial);
        btnGesturePrev.addEventListener("click", () => updateGestureSlide(currentGestureSlide - 1));
        btnGestureNext.addEventListener("click", () => updateGestureSlide(currentGestureSlide + 1));

        carousel.addEventListener("touchstart", (e) => {
            if (e.touches.length !== 1) return;
            carouselTouchStartX = e.touches[0].clientX;
            carouselTouchStartY = e.touches[0].clientY;
        }, { passive: true });

        carousel.addEventListener("touchend", (e) => {
            if (e.changedTouches.length !== 1) return;
            const dx = e.changedTouches[0].clientX - carouselTouchStartX;
            const dy = e.changedTouches[0].clientY - carouselTouchStartY;
            if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy)) return;
            updateGestureSlide(currentGestureSlide + (dx < 0 ? 1 : -1));
        }, { passive: true });

        updateGestureSlide(0);
    }

    // Categories Management Modal
    if (btnOnboardingCreateCategory) {
        btnOnboardingCreateCategory.addEventListener("click", () => {
            openModal(modalManageCategories);
            renderCategories();
            setTimeout(() => document.getElementById("input-new-category")?.focus(), 380);
        });
    }

    if (btnOpenManageCategories) {
        btnOpenManageCategories.addEventListener("click", () => {
            closeModal(modalManageTasks);
            openModal(modalManageCategories);
            renderCategories();
        });
    }
    if (btnCloseManageCategoriesModal) {
        btnCloseManageCategoriesModal.addEventListener("click", () => {
            closeModal(modalManageCategories);
            openModal(modalManageTasks);
        });
    }
    const overlayManageCategories = document.getElementById("overlay-manage-categories");
    if (overlayManageCategories) {
        overlayManageCategories.addEventListener("click", () => {
            closeModal(modalManageCategories);
        });
    }

    // Save Settings Inputs
    inputOrgName.addEventListener("input", (e) => {
        const val = e.target.value.trim() || "Checklist Organizacional";
        orgTagEl.textContent = val;
        localStorage.setItem("checklist_org_name", val);
    });

    // Toggle custom type input wrapper on select change
    const selectNewCategoryType = document.getElementById("select-new-category-type");
    const wrapperCustomType = document.getElementById("wrapper-custom-type");
    const inputNewCategoryCustomType = document.getElementById("input-new-category-custom-type");
    const categoryTypeRow = document.getElementById("category-type-row");

    if (selectNewCategoryType && wrapperCustomType) {
        selectNewCategoryType.addEventListener("change", () => {
            if (selectNewCategoryType.value === "Outro") {
                wrapperCustomType.style.display = "flex";
                if (categoryTypeRow) categoryTypeRow.classList.add("has-custom-type");
            } else {
                wrapperCustomType.style.display = "none";
                if (categoryTypeRow) categoryTypeRow.classList.remove("has-custom-type");
                if (inputNewCategoryCustomType) inputNewCategoryCustomType.value = "";
            }
        });
    }

    const inputManualLearning = document.getElementById("input-manual-learning-term");
    const selectManualLearning = document.getElementById("select-manual-learning-function");
    const btnSaveManualLearning = document.getElementById("btn-save-manual-learning");
    if (inputManualLearning && selectManualLearning && btnSaveManualLearning) {
        btnSaveManualLearning.addEventListener("click", () => {
            const term = inputManualLearning.value.trim();
            if (!term) {
                inputManualLearning.focus();
                return;
            }
            if (!selectManualLearning.value) {
                selectManualLearning.focus();
                return;
            }
            saveLearnedFunctionAssociation(term, selectManualLearning.value);
            inputManualLearning.value = "";
            const originalText = btnSaveManualLearning.textContent;
            btnSaveManualLearning.textContent = "Aprendido ✓";
            btnSaveManualLearning.disabled = true;
            setTimeout(() => {
                btnSaveManualLearning.textContent = originalText;
                btnSaveManualLearning.disabled = false;
                renderCategories();
            }, 800);
        });
    }

    // Add New Category (Settings Modal)
    btnAddCategory.addEventListener("click", async () => {
        const val = inputNewCategory.value.trim();
        let typeVal = selectNewCategoryType ? selectNewCategoryType.value : "";
        if (typeVal === "Outro" && inputNewCategoryCustomType) {
            typeVal = inputNewCategoryCustomType.value.trim();
        }

        if (!val) {
            alert("Por favor, insira o nome da categoria.");
            return;
        }
        if (!typeVal) {
            alert("Por favor, selecione ou digite o tipo da categoria.");
            return;
        }

        if (btnAddCategory.disabled) return;
        btnAddCategory.disabled = true;
        const originalText = btnAddCategory.innerHTML;
        btnAddCategory.innerHTML = "Salvando...";

        try {
            const categoryCreated = await addCategory(val, typeVal);
            if (!categoryCreated) return;
            inputNewCategory.value = "";
            if (inputNewCategoryCustomType) inputNewCategoryCustomType.value = "";
            if (selectNewCategoryType) {
                selectNewCategoryType.value = "Trabalho"; // reset
                wrapperCustomType.style.display = "none";
                document.getElementById("category-type-row")?.classList.remove("has-custom-type");
            }
        } finally {
            btnAddCategory.disabled = false;
            btnAddCategory.innerHTML = originalText;
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
                    localStorage.setItem(getNotificationsPreferenceKey(), "true");
                    ensurePushSubscription().catch(error => console.warn("Não foi possível registrar o push do lembrete:", error.message));
                }
            } else if (Notification.permission === "granted") {
                localStorage.setItem(getNotificationsPreferenceKey(), "true");
                ensurePushSubscription().catch(error => console.warn("Não foi possível registrar o push do lembrete:", error.message));
            }
        }
    };

    const chkImportant = document.getElementById("task-important");
    if (chkImportant) {
        chkImportant.addEventListener("change", async () => {
            if (chkImportant.checked) {
                requestNotificationPermission();
                addTaskReminderTime = getCurrentReminderTime();
                const reminder = await chooseTaskReminderTime(addTaskReminderTime, addTaskReminderOffsetDays);
                if (!reminder) chkImportant.checked = false;
                else { addTaskReminderTime = reminder.time; addTaskReminderOffsetDays = reminder.offsetDays; }
            }
            updateTaskReminderSummary("add", chkImportant.checked, addTaskReminderTime, addTaskReminderOffsetDays);
        });
    }

    const chkEditImportant = document.getElementById("edit-task-important");
    if (chkEditImportant) {
        chkEditImportant.addEventListener("change", async () => {
            if (chkEditImportant.checked) {
                requestNotificationPermission();
                const reminder = await chooseTaskReminderTime(editTaskReminderTime, editTaskReminderOffsetDays);
                if (!reminder) chkEditImportant.checked = false;
                else { editTaskReminderTime = reminder.time; editTaskReminderOffsetDays = reminder.offsetDays; }
            }
            updateTaskReminderSummary("edit", chkEditImportant.checked, editTaskReminderTime, editTaskReminderOffsetDays);
        });
    }

    const setupDescriptionField = (buttonId, groupId, inputId) => {
        const button = document.getElementById(buttonId);
        const group = document.getElementById(groupId);
        const input = document.getElementById(inputId);
        if (!button || !group || !input) return;
        button.addEventListener("click", () => {
            group.hidden = false;
            button.hidden = true;
            input.focus();
        });
    };
    setupDescriptionField("btn-add-task-description", "task-description-group", "task-description");
    setupDescriptionField("btn-edit-task-description", "edit-task-description-group", "edit-task-description");

    formAddTask.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (suppressTaskAutocompleteSubmit) {
            suppressTaskAutocompleteSubmit = false;
            return;
        }
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
            const assignedTo = isTrainingCollaborativeCategory(selectTaskCategory.value) ? null : (selectTaskAssignedTo ? selectTaskAssignedTo.value : null);
            const chkImp = document.getElementById("task-important");
            const important = chkImp ? chkImp.checked : false;
            
            const queuedSharedTask = Boolean(assignedTo) && !navigator.onLine;
            const description = document.getElementById("task-description")?.value.trim() || "";
            await addTask(inputTaskTitle.value.trim(), selectTaskCategory.value, selectTaskRecurring.value, taskDate, repeatDays, assignedTo, shifts, important, null, 0, description);
            if (queuedSharedTask) {
                showAppNotice("Tarefa salva neste celular, mas ainda não enviada ao responsável. Para a outra pessoa receber, este celular precisa recuperar a internet e sincronizar o app.", "warning");
            }
            inputTaskTitle.value = "";
            const descriptionInput = document.getElementById("task-description");
            const descriptionGroup = document.getElementById("task-description-group");
            const descriptionButton = document.getElementById("btn-add-task-description");
            if (descriptionInput) descriptionInput.value = "";
            if (descriptionGroup) descriptionGroup.hidden = true;
            if (descriptionButton) descriptionButton.hidden = false;
            // Reset day toggles
            document.querySelectorAll("#repeat-days-group .day-toggle").forEach(b => b.classList.remove("active"));
            document.getElementById("repeat-days-group").style.display = "none";
            // Limpa seleção de turnos
            document.querySelectorAll("#add-shift-selector .shift-toggle-btn").forEach(b => b.classList.remove("active"));
            if (chkImp) chkImp.checked = false;
            addTaskReminderTime = getCurrentReminderTime();
            addTaskReminderOffsetDays = 0;
            updateTaskReminderSummary("add", false, addTaskReminderTime, addTaskReminderOffsetDays);
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

        const newCategory = selectEditTaskCategory ? selectEditTaskCategory.value : null;
        const editShifts = Array.from(document.querySelectorAll("#edit-shift-selector .shift-toggle-btn.active")).map(b => b.dataset.shift);

        // Mescla turnos no context existente (evita bugs caso seja string stringificada)
        const existingTask = tasks.find(t => String(t.id) === String(taskId));
        if (existingTask && isTrainingCategory(existingTask.category) && !isTrainingTaskOwnedByCurrentUser(existingTask)) {
            showAppNotice("Somente o dono pode editar esta tarefa de treino.", "warning");
            closeModal(modalEditTask);
            return;
        }
        const assignedTo = newCategory && isTrainingCollaborativeCategory(newCategory) ? null : (selectEditTaskAssignedTo ? selectEditTaskAssignedTo.value : null);
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
        const editedDescription = document.getElementById("edit-task-description")?.value.trim() || "";
        // O valor vazio precisa ser explícito: updateTask mescla o contexto
        // anterior para preservar lembretes e turnos, portanto apenas apagar a
        // propriedade faria a descrição antiga reaparecer nessa mesclagem.
        context.description = editedDescription;
        const chkEditImp = document.getElementById("edit-task-important");
        if (chkEditImp) {
            context.important = chkEditImp.checked;
            if (chkEditImp.checked) {
                context.reminder_time = editTaskReminderTime;
                context.reminder_offset_days = editTaskReminderOffsetDays;
                context.reminder_timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
            } else {
                delete context.reminder_time;
                delete context.reminder_offset_days;
                delete context.reminder_timezone;
            }
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
            markCurrentInvitesAsSeen();
            renderNotifications();
            openModal(modalNotifications);
            markSharedTaskNotificationsAsRead();
        });
    }

    if (notificationsEnabledToggle) {
        notificationsEnabledToggle.addEventListener("click", toggleNotificationsPreference);
        updateNotificationsSettingUI();
    }
    btnRepairTestPush?.addEventListener("click", repairAndTestPushNotifications);
    if (inputProfileAvatar) {
        inputProfileAvatar.addEventListener("change", async () => {
            const file = inputProfileAvatar.files && inputProfileAvatar.files[0];
            if (!file) return;
            inputProfileAvatar.disabled = true;
            try {
                await uploadProfileAvatar(file);
                showAppNotice("Foto do perfil atualizada.", "success");
            } catch (error) {
                showAppNotice(`Não foi possível salvar a foto: ${error.message}`, "warning");
            } finally {
                inputProfileAvatar.value = "";
                inputProfileAvatar.disabled = false;
            }
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

    // Compartilhar checklist pelo menu nativo do aparelho
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
        setSyncStatus("syncing", "Salvando…", "Conexão restaurada; sincronizando alterações");
        cloudSyncRetryCount = 0;
        scheduleCloudSync("conexão-restaurada", 50);
    });

    window.addEventListener("offline", () => {
        refreshSyncStatusFromQueues();
    });

    syncStatusEl?.addEventListener("click", () => {
        if (!navigator.onLine) {
            showAppNotice("Sem conexão. Suas alterações permanecem guardadas neste aparelho.", "warning");
            return;
        }
        if (!hasPendingSyncData() && !cloudSyncLastError) {
            loadChecklistAndProgress().then(() => refreshSyncStatusFromQueues());
            return;
        }
        cloudSyncRetryCount = 0;
        scheduleCloudSync("toque-do-usuário", 0);
    });
    syncStatusEl?.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        syncStatusEl.click();
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && hasPendingSyncData()) scheduleCloudSync("app-retomado", 120);
    });
    window.addEventListener("focus", () => {
        if (hasPendingSyncData()) scheduleCloudSync("janela-em-foco", 180);
    });
    setInterval(() => {
        if (document.visibilityState === "visible" && navigator.onLine && hasPendingSyncData()) scheduleCloudSync("verificação-periódica", 0);
    }, 30000);

    // Auth Listeners & Forms
    const formAuth = document.getElementById("form-auth");
    const inputAuthEmail = document.getElementById("auth-email");
    const inputAuthPassword = document.getElementById("auth-password");
    const btnAuthSubmit = document.getElementById("btn-auth-submit");
    const btnAuthToggle = document.getElementById("btn-auth-toggle");
    const authTitle = document.getElementById("auth-title");
    const authSubtitle = document.getElementById("auth-subtitle");
    const authErrorMsg = document.getElementById("auth-error-msg");
    const authIdentityLabel = document.getElementById("auth-identity-label");
    const btnLogout = document.getElementById("btn-logout");

    if (inputUserIdentifier) {
        inputUserIdentifier.addEventListener("input", () => {
            const normalized = normalizeUserIdentifier(inputUserIdentifier.value);
            if (inputUserIdentifier.value !== normalized) inputUserIdentifier.value = normalized;
            if (identifierError) identifierError.textContent = "";
        });
    }

    if (formCreateIdentifier) {
        formCreateIdentifier.addEventListener("submit", async event => {
            event.preventDefault();
            const desiredUsername = normalizeUserIdentifier(inputUserIdentifier.value);
            if (!/^[a-z0-9._-]{3,24}$/.test(desiredUsername)) {
                identifierError.textContent = "Use 3 a 24 caracteres válidos e não coloque espaços.";
                return;
            }
            const button = document.getElementById("btn-confirm-identifier");
            button.disabled = true;
            button.textContent = "Confirmando…";
            const { data, error } = await supabaseClient.rpc("claim_user_identifier", { desired_username: desiredUsername });
            if (error) {
                identifierError.textContent = error.message.includes("já está") ? "Este ID já está em uso. Escolha outro." : error.message;
                button.disabled = false;
                button.textContent = "Confirmar meu ID";
                return;
            }
            currentUsername = data || desiredUsername;
            collaborationIdentityByEmail.set(normalizeAccountEmail(currentUser.email), currentUsername);
            modalCreateIdentifier.classList.remove("active");
            modalCreateIdentifier.setAttribute("aria-hidden", "true");
            button.disabled = false;
            button.textContent = "Confirmar meu ID";
            if (identifierSetupResolver) identifierSetupResolver();
            identifierSetupResolver = null;
        });
    }

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
                authIdentityLabel.textContent = "E-mail ou ID";
                inputAuthEmail.type = "text";
                inputAuthEmail.placeholder = "seu_id ou nome@exemplo.com";
            } else {
                authTitle.textContent = "Criar Conta";
                authSubtitle.textContent = "Cadastre-se gratuitamente para manter seu checklist salvo na nuvem.";
                btnAuthSubmit.textContent = "Cadastrar Conta";
                document.getElementById("auth-toggle-text").textContent = "Já tem uma conta?";
                btnAuthToggle.textContent = "Fazer Login";
                authIdentityLabel.textContent = "E-mail";
                inputAuthEmail.type = "email";
                inputAuthEmail.placeholder = "nome@exemplo.com";
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

            let email = inputAuthEmail.value.trim();
            const password = inputAuthPassword.value;

            try {
                if (isAuthModeLogin) {
                    if (!email.includes("@")) {
                        const { data: resolvedEmail, error: resolveError } = await supabaseClient.rpc("resolve_login_email", { login_identifier: normalizeUserIdentifier(email) });
                        if (resolveError || !resolvedEmail) throw new Error("ID ou senha incorretos.");
                        email = resolvedEmail;
                    }
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
            if (await showAppConfirm("Deseja sair da sua conta?", { title: "Encerrar sessão", confirmText: "Sair" })) {
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

    const modalPastNightInfo = document.getElementById("modal-past-night-info");
    const btnClosePastNightInfo = document.getElementById("btn-close-past-night-info");
    if (btnClosePastNightInfo) {
        btnClosePastNightInfo.addEventListener("click", () => closeModal(modalPastNightInfo));
    }
    const overlayPastNightInfo = modalPastNightInfo?.querySelector(".modal-overlay");
    if (overlayPastNightInfo) {
        overlayPastNightInfo.addEventListener("click", () => closeModal(modalPastNightInfo));
    }
    document.addEventListener("click", event => {
        const infoButton = event.target.closest(".btn-past-night-info");
        if (!infoButton) return;
        event.preventDefault();
        event.stopPropagation();
        openModal(modalPastNightInfo);
    });

    // Habilita deslize para baixo (swipe-down-to-close) em todos os modais
    document.querySelectorAll(".modal:not(.identifier-modal)").forEach(setupModalSwipeToClose);
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
    // Identidade isolada para testes locais de interface. Não cria sessão nem
    // concede acesso à nuvem e é ignorada fora de localhost.
    if (!supabaseClient && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && window.__CHECKLIST_E2E_USER__) {
        currentUser = { ...window.__CHECKLIST_E2E_USER__ };
        currentUsername = String(currentUser.email || "teste").split("@")[0];
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
    
    // Novos elementos compactos quadrados
    const dayNumEl = document.getElementById("current-date-day-num");
    const dayMonthEl = document.getElementById("current-date-day-month");
    const dayWeekdayEl = document.getElementById("current-date-day-weekday");
    
    if (dayNumEl) dayNumEl.textContent = day;
    if (dayMonthEl) dayMonthEl.textContent = `${abbreviatedMonth} ${year}`;
    if (dayWeekdayEl) dayWeekdayEl.textContent = abbreviatedDay;
    
    const miniDateTextEl = document.getElementById("header-mini-date-text");
    if (miniDateTextEl) {
        const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
        const fullDateString = dateObj.toLocaleDateString('pt-BR', options);
        miniDateTextEl.textContent = fullDateString.charAt(0).toUpperCase() + fullDateString.slice(1);
    }
    
    updateDateState();
}

function updateDateState() {
    const now = new Date();
    const todayStr = getLocalDateString(now);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateString(yesterday);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = getLocalDateString(tomorrow);
    const historyBadge = document.getElementById("history-badge");
    const miniDateBadge = document.getElementById("header-mini-date-badge");

    if (selectedDate < todayStr) {
        isHistoryMode = true;
        appContainer.classList.add("history-mode");
        appContainer.classList.remove("planning-mode", "today-mode", "tomorrow-mode");
        appContainer.classList.toggle("yesterday-mode", selectedDate === yesterdayStr);
        toggleEditMode(false);
        const pastLabel = selectedDate === yesterdayStr ? "Ontem" : "Histórico";
        if (historyBadge) historyBadge.innerHTML = pastLabel;
        if (miniDateBadge) miniDateBadge.innerHTML = pastLabel;
    } else if (selectedDate > todayStr) {
        isHistoryMode = false;
        appContainer.classList.add("planning-mode");
        appContainer.classList.remove("history-mode", "today-mode", "yesterday-mode");
        appContainer.classList.toggle("tomorrow-mode", selectedDate === tomorrowStr);
        const futureLabel = selectedDate === tomorrowStr ? "Amanhã" : "Planejamento";
        if (historyBadge) historyBadge.innerHTML = futureLabel;
        if (miniDateBadge) miniDateBadge.innerHTML = futureLabel;
    } else {
        isHistoryMode = false;
        appContainer.classList.add("today-mode");
        appContainer.classList.remove("history-mode", "planning-mode", "yesterday-mode", "tomorrow-mode");
        if (historyBadge) historyBadge.innerHTML = '<span class="pulse-dot"></span>Hoje';
        if (miniDateBadge) miniDateBadge.innerHTML = '<span class="pulse-dot"></span>Hoje';
    }
}

function getTaskRenderFingerprint(taskList = tasks) {
    return JSON.stringify(taskList.map(task => [
        String(task.id), task.title, task.category, String(task.category_id || ""),
        Boolean(task.completed), Boolean(task.is_recurring), JSON.stringify(task.repeat_days || []),
        String(task.assigned_to || ""), task.created_at, JSON.stringify(task.context || {})
    ].join("|")).sort());
}

function getCategoryRenderFingerprint(categoryList = categories) {
    return JSON.stringify(categoryList.map(category => [
        String(category.id), category.name, category.type || "", category.is_active !== false,
        JSON.stringify(category.merged_category_ids || [])
    ].join("|")));
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

    updateCollaborationInviteAttention();

    // 2. Revalida com o Supabase em segundo plano sem travar a interface do usuário
    if (supabaseClient && currentUser) {
        // Se houver qualquer sincronização pendente na fila offline, não busca dados do servidor ainda.
        // Isso impede que dados antigos do servidor sobrescrevam alterações locais que ainda não foram enviadas.
        const localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
        const hasPendingCats = localCats.some(c => isTemporaryId(c.id) && c.is_active !== false);
        
        const localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
        const hasPendingTasks = localTasks.some(t => isTemporaryId(t.id) && t.is_active !== false);
        
        const compQueue = JSON.parse(localStorage.getItem("offline_completions_queue")) || {};
        const hasPendingCompletions = Object.keys(compQueue).length > 0;
        
        const updatesQueue = JSON.parse(localStorage.getItem("offline_task_updates_queue")) || {};
        const hasPendingUpdates = Object.keys(updatesQueue).length > 0;

        if (hasPendingCats || hasPendingTasks || hasPendingCompletions || hasPendingUpdates) {
            console.log("[Sync] Revalidação com o servidor adiada: existem alterações locais pendentes de envio.");
            return;
        }

        // Guarda fingerprint dos dados atuais para comparar depois
        const fingerprintBefore = getTaskRenderFingerprint();
        const catFingerprintBefore = getCategoryRenderFingerprint();

        loadData().then((didUpdate) => {
            if (!didUpdate) return; // Se o fetch foi abortado (ex: o usuário arrastou uma tarefa), não re-renderiza nada

            // Só re-renderiza se os dados realmente mudaram — evita flash desnecessário
            const fingerprintAfter = getTaskRenderFingerprint();
            const catFingerprintAfter = getCategoryRenderFingerprint();

            if (fingerprintAfter !== fingerprintBefore) {
                renderChecklist();
                updateProgress();
            }
            if (catFingerprintAfter !== catFingerprintBefore) {
                renderCategories();
            }
            updateCollaborationInviteAttention();
        }).catch(err => {
            console.warn("Erro silencioso ao revalidar dados do Supabase:", err);
        });
    }
}

function normalizeAccountEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function normalizeUserIdentifier(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function getIdentityLabel(email) {
    const normalized = normalizeAccountEmail(email);
    if (currentUser && normalized === normalizeAccountEmail(currentUser.email) && currentUsername) return `@${currentUsername}`;
    const username = collaborationIdentityByEmail.get(normalized);
    return username ? `@${username}` : normalized;
}

function getPlainIdentityLabel(email) {
    return getIdentityLabel(email).replace(/^@/, "");
}

function getIdentityAvatar(email) {
    return getCachedAvatarUrl(collaborationAvatarByEmail.get(normalizeAccountEmail(email)) || "");
}

function getIdentityLabelByUserId(userId) {
    const username = collaborationIdentityByUserId.get(String(userId || ""));
    return username ? `@${username}` : "";
}

function getIdentityAvatarByUserId(userId) {
    return getCachedAvatarUrl(collaborationAvatarByUserId.get(String(userId || "")) || "");
}

function getCachedAvatarUrl(url) {
    return url ? (persistentAvatarByUrl.get(url) || url) : "";
}

async function createProfileAvatarThumbnail(url) {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) throw new Error("avatar indisponível");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
        const image = await new Promise((resolve, reject) => {
            const candidate = new Image();
            candidate.onload = () => resolve(candidate);
            candidate.onerror = () => reject(new Error("avatar inválido"));
            candidate.src = objectUrl;
        });
        const size = 128;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        const scale = Math.max(size / image.width, size / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        return canvas.toDataURL("image/jpeg", .76);
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

function cachePriorityAvatars(urls) {
    const uniqueUrls = [...new Set((urls || []).filter(url => url && !persistentAvatarByUrl.has(url) && !pendingAvatarCacheUrls.has(url)))];
    if (!uniqueUrls.length) return;
    const prioritizedUrls = uniqueUrls.slice(0, 12);
    prioritizedUrls.forEach(url => pendingAvatarCacheUrls.add(url));
    Promise.all(prioritizedUrls.map(async url => {
        try {
            persistentAvatarByUrl.set(url, await createProfileAvatarThumbnail(url));
        } catch (_) {
            // O endereço original continua sendo usado se a cópia local falhar.
        } finally {
            pendingAvatarCacheUrls.delete(url);
        }
    })).then(async () => {
        const compactCache = Object.fromEntries([...persistentAvatarByUrl.entries()].slice(-40));
        await idb.put("priority_profile_avatars", compactCache);
        renderChecklist();
        if (modalTrainingReport?.classList.contains("active")) paintTrainingReport(currentFilter !== "all" ? currentFilter : null);
    }).catch(() => {});
}

function renderSettingsProfileAvatar() {
    if (!settingsProfileAvatar) return;
    const avatarUrl = currentUser ? getIdentityAvatar(currentUser.email) : "";
    settingsProfileAvatar.innerHTML = avatarUrl ? `<img src="${escapeHTML(avatarUrl)}" alt="Foto do perfil">` : '<i data-lucide="user-round"></i>';
    if (!avatarUrl && window.lucide) window.lucide.createIcons();
}

async function uploadProfileAvatar(file) {
    if (!supabaseClient || !currentUser || !file) return;
    if (file.size > 5 * 1024 * 1024) throw new Error("Escolha uma imagem de até 5 MB.");
    const extension = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${currentUser.id}/avatar.${extension}`;
    const { error: uploadError } = await supabaseClient.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) throw uploadError;
    const { data } = supabaseClient.storage.from("avatars").getPublicUrl(path);
    const avatarUrl = `${data.publicUrl}?v=${Date.now()}`;
    const { error: profileError } = await supabaseClient.from("profiles").upsert({ id: currentUser.id, email: normalizeAccountEmail(currentUser.email), avatar_url: avatarUrl, updated_at: new Date().toISOString() });
    if (profileError) throw profileError;
    collaborationAvatarByEmail.set(normalizeAccountEmail(currentUser.email), avatarUrl);
    collaborationAvatarByUserId.set(String(currentUser.id), avatarUrl);
    cachePriorityAvatars([avatarUrl]);
    renderSettingsProfileAvatar();
    renderChecklist();
}

async function loadCollaborationIdentityLabels() {
    if (!supabaseClient || !currentUser) return;
    const emails = new Set([currentUser.email]);
    (categoryShares || []).forEach(share => {
        if (share.owner_email) emails.add(share.owner_email);
        if (share.collaborator_email) emails.add(share.collaborator_email);
    });
    (allActiveTasks || []).forEach(task => { if (task.assigned_to) emails.add(task.assigned_to); });
    const { data, error } = await supabaseClient.rpc("resolve_collaboration_identifiers", { lookup_emails: [...emails] });
    if (error) console.warn("Não foi possível carregar IDs públicos por e-mail:", error.message);
    else {
        collaborationIdentityByEmail.clear();
        collaborationAvatarByEmail.clear();
        (data || []).forEach(item => {
            collaborationIdentityByEmail.set(normalizeAccountEmail(item.email), item.username);
            if (item.avatar_url) collaborationAvatarByEmail.set(normalizeAccountEmail(item.email), item.avatar_url);
        });
    }
    const userIds = new Set([currentUser.id]);
    (categories || []).forEach(category => { if (category.user_id) userIds.add(category.user_id); });
    (allActiveTasks || []).forEach(task => { if (task.user_id) userIds.add(task.user_id); });
    const { data: profiles, error: profilesError } = await supabaseClient.rpc("resolve_collaboration_profiles", { lookup_user_ids: [...userIds] });
    if (profilesError) console.warn("Não foi possível carregar perfis pelo usuário:", profilesError.message);
    else {
        collaborationIdentityByUserId.clear();
        collaborationAvatarByUserId.clear();
        (profiles || []).forEach(profile => {
            const userId = String(profile.user_id);
            if (profile.username) collaborationIdentityByUserId.set(userId, profile.username);
            if (profile.avatar_url) collaborationAvatarByUserId.set(userId, profile.avatar_url);
            if (profile.email) {
                collaborationIdentityByEmail.set(normalizeAccountEmail(profile.email), profile.username);
                if (profile.avatar_url) collaborationAvatarByEmail.set(normalizeAccountEmail(profile.email), profile.avatar_url);
            }
        });
    }
    renderSettingsProfileAvatar();
    cachePriorityAvatars([
        ...collaborationAvatarByEmail.values(),
        ...collaborationAvatarByUserId.values(),
        ...(allActiveTasks || []).map(task => task.context?.creator_avatar_url)
    ]);
}

async function ensureCollaborationProfile(userId) {
    const normalizedId = String(userId || "");
    if (!normalizedId || collaborationIdentityByUserId.has(normalizedId) || !supabaseClient) return;
    const { data, error } = await supabaseClient.rpc("resolve_collaboration_profiles", { lookup_user_ids: [normalizedId] });
    if (error || !data?.[0]) return;
    const profile = data[0];
    if (profile.username) collaborationIdentityByUserId.set(normalizedId, profile.username);
    if (profile.avatar_url) {
        collaborationAvatarByUserId.set(normalizedId, profile.avatar_url);
        cachePriorityAvatars([profile.avatar_url]);
    }
}

async function ensureUserIdentifier() {
    if (!supabaseClient || !currentUser) return;
    const { data, error } = await supabaseClient.rpc("get_my_identifier");
    if (error) throw new Error("A migração de ID ainda não foi aplicada no Supabase: " + error.message);
    if (data) {
        currentUsername = data;
        collaborationIdentityByEmail.set(normalizeAccountEmail(currentUser.email), data);
        return;
    }
    modalCreateIdentifier.classList.add("active");
    modalCreateIdentifier.setAttribute("aria-hidden", "false");
    setTimeout(() => inputUserIdentifier && inputUserIdentifier.focus(), 250);
    await new Promise(resolve => { identifierSetupResolver = resolve; });
}

function getNotificationsPreferenceKey() {
    return `notifications_enabled_${currentUser ? currentUser.id : "local"}`;
}

function urlBase64ToUint8Array(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(character => character.charCodeAt(0)));
}

async function savePushSubscription(subscription) {
    if (!supabaseClient || !currentUser || !subscription) return;
    const json = subscription.toJSON();
    // Mantém somente a assinatura atual deste navegador. Reinstalações e
    // renovações do Web Push podem deixar endpoints antigos associados à conta.
    const { error: cleanupError } = await supabaseClient.from("push_subscriptions")
        .delete()
        .eq("user_id", currentUser.id)
        .eq("user_agent", navigator.userAgent)
        .neq("endpoint", json.endpoint);
    if (cleanupError) console.warn("Não foi possível remover assinaturas antigas deste navegador:", cleanupError.message);
    const { error } = await supabaseClient.from("push_subscriptions").upsert({
        user_id: currentUser.id,
        endpoint: json.endpoint,
        p256dh: json.keys && json.keys.p256dh,
        auth: json.keys && json.keys.auth,
        user_agent: navigator.userAgent,
        updated_at: new Date().toISOString()
    }, { onConflict: "endpoint" });
    if (error) throw error;
}

let pushSubscriptionInFlight = null;
let pushSubscriptionGeneration = 0;
function awaitPushStep(promise, milliseconds, timeoutMessage) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), milliseconds)),
    ]);
}

async function createOrRepairPushSubscription({ forceRefresh = false, onProgress = null } = {}) {
    const reportProgress = (title, detail) => {
        if (typeof onProgress === "function") onProgress(title, detail);
    };
    const operationGeneration = pushSubscriptionGeneration;
    const assertCurrentOperation = () => {
        if (operationGeneration !== pushSubscriptionGeneration) throw new Error("Cadastro substituído por uma nova tentativa.");
    };
    if (!areNotificationsEnabled() || !currentUser || Notification.permission !== "granted") return null;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("Este navegador não oferece suporte a Web Push.");
    }
    // `serviceWorker.ready` pode nunca resolver no Safari durante uma troca de
    // versão, mesmo quando já existe um worker ativo controlando o PWA. Usa o
    // registro atual diretamente e deixa `ready` apenas como último recurso.
    reportProgress("Registrando aplicativo…", "Preparando o serviço de notificações");
    let registration;
    try {
        registration = await awaitPushStep(
            navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "./", updateViaCache: "none" }),
            15000,
            "ETAPA 1: o Safari não respondeu ao registrar o service worker.",
        );
    } catch (error) {
        throw new Error(`ETAPA 1: falha ao registrar o service worker (${error.message}).`);
    }
    if (!registration.active) {
        reportProgress("Atualizando aplicativo…", "Ativando o serviço de notificações");
        if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
        registration = await awaitPushStep(navigator.serviceWorker.ready, 20000, "ETAPA 1: o service worker foi registrado, mas não ficou ativo.");
    }
    assertCurrentOperation();
    reportProgress("Consultando iPhone…", "Procurando uma assinatura push existente");
    let subscription = await awaitPushStep(
        registration.pushManager.getSubscription(),
        12000,
        "ETAPA 2: o iPhone não respondeu ao consultar a assinatura push.",
    );
    assertCurrentOperation();
    if (subscription && forceRefresh) {
        if (supabaseClient && currentUser) {
            await supabaseClient.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
        }
        await awaitPushStep(
            subscription.unsubscribe().catch(() => false),
            10000,
            "ETAPA 3: o iPhone não conseguiu remover a assinatura expirada.",
        );
        assertCurrentOperation();
        subscription = null;
    }
    if (!subscription) {
        reportProgress("Cadastrando iPhone…", "Criando a assinatura Web Push");
        subscription = await awaitPushStep(
            registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            }),
            25000,
            "ETAPA 3: o iPhone não respondeu ao criar a assinatura Web Push.",
        );
        assertCurrentOperation();
    }
    reportProgress("Salvando aparelho…", "Registrando a assinatura no Supabase");
    await awaitPushStep(
        savePushSubscription(subscription),
        15000,
        "ETAPA 4: o Supabase não respondeu ao salvar este aparelho.",
    );
    assertCurrentOperation();
    return subscription;
}

function ensurePushSubscription(options = {}) {
    // Login, retomada do PWA e botão de configurações podem pedir o registro
    // quase juntos no iOS. Uma única operação evita que uma chamada cancele
    // o endpoint recém-criado pela outra.
    if (pushSubscriptionInFlight) return pushSubscriptionInFlight;
    const operation = createOrRepairPushSubscription(options);
    let wrappedOperation = null;
    wrappedOperation = operation.finally(() => {
        if (pushSubscriptionInFlight === wrappedOperation) pushSubscriptionInFlight = null;
    });
    pushSubscriptionInFlight = wrappedOperation;
    return wrappedOperation;
}

async function removePushSubscription({ unsubscribeDevice = false } = {}) {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    if (supabaseClient && currentUser) {
        const { error } = await supabaseClient.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
        if (error) console.warn("Não foi possível remover a inscrição push do banco:", error.message);
    }
    // Desativar no app remove o destino do servidor, mas preserva a assinatura
    // do navegador. Assim, reativar no iOS apenas cadastra o mesmo endpoint de
    // novo, sem depender de uma nova chamada instável ao PushManager.subscribe.
    if (unsubscribeDevice) await subscription.unsubscribe();
}

function areNotificationsEnabled() {
    const storedPreference = localStorage.getItem(getNotificationsPreferenceKey());
    if (storedPreference !== null) return storedPreference === "true";
    return "Notification" in window && Notification.permission === "granted";
}

function updateNotificationsSettingUI() {
    if (!notificationsEnabledToggle) return;
    const enabled = areNotificationsEnabled();
    notificationsEnabledToggle.classList.toggle("is-on", enabled);
    notificationsEnabledToggle.setAttribute("aria-checked", enabled ? "true" : "false");

    if (!notificationsPermissionStatus) return;
    if (!("Notification" in window)) {
        notificationsPermissionStatus.textContent = "Este navegador não oferece notificações do dispositivo.";
    } else if (!enabled) {
        notificationsPermissionStatus.textContent = "Os avisos push estão desativados neste aparelho.";
    } else if (Notification.permission === "denied") {
        notificationsPermissionStatus.textContent = "Permissão bloqueada pelo navegador. Libere-a nas configurações do site.";
    } else if (Notification.permission === "granted") {
        notificationsPermissionStatus.textContent = "Notificações permitidas neste aparelho.";
    } else {
        notificationsPermissionStatus.textContent = "Toque no botão para autorizar as notificações.";
    }
}

let notificationsPreferenceRequestId = 0;
async function toggleNotificationsPreference() {
    const requestId = ++notificationsPreferenceRequestId;
    const shouldEnable = !areNotificationsEnabled();
    if (!shouldEnable) {
        localStorage.setItem(getNotificationsPreferenceKey(), "false");
        updateNotificationsSettingUI();
        removePushSubscription().catch(error => console.warn("Erro ao desativar Web Push:", error));
        return;
    }

    if (!("Notification" in window)) {
        localStorage.setItem(getNotificationsPreferenceKey(), "false");
        updateNotificationsSettingUI();
        return;
    }

    // Salva primeiro a intenção do usuário. Se a permissão ainda não existe,
    // o pedido ocorre dentro deste clique (exigência de iOS/Chrome).
    localStorage.setItem(getNotificationsPreferenceKey(), "true");
    updateNotificationsSettingUI();
    let permission = Notification.permission;
    if (permission === "default") permission = await Notification.requestPermission();
    if (permission !== "granted") {
        localStorage.setItem(getNotificationsPreferenceKey(), "false");
        updateNotificationsSettingUI();
        if (permission === "denied") {
            alert("As notificações estão bloqueadas pelo navegador. Abra as configurações deste site ou web app, permita Notificações e tente novamente.");
        }
    } else {
        // Atualiza o botão assim que o iOS concede a permissão. O registro de
        // rede continua em segundo plano e não bloqueia a resposta visual.
        updateNotificationsSettingUI();
        ensurePushSubscription().catch(error => {
            if (requestId !== notificationsPreferenceRequestId) return;
            updateNotificationsSettingUI();
            alert("Não foi possível registrar este aparelho para notificações: " + error.message);
        });
    }
}

async function repairAndTestPushNotifications() {
    if (!btnRepairTestPush || !supabaseClient || !currentUser) return;
    const original = btnRepairTestPush.innerHTML;
    btnRepairTestPush.disabled = true;
    btnRepairTestPush.innerHTML = '<span class="loading-spinner"></span><span><strong>Configurando…</strong><small>Aguarde alguns segundos</small></span>';
    const setRepairStatus = (title, detail) => {
        btnRepairTestPush.innerHTML = `<span class="loading-spinner"></span><span><strong>${title}</strong><small>${detail}</small></span>`;
    };
    const withTimeout = (promise, milliseconds, message) => Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(message)), milliseconds)),
    ]);
    try {
        if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Este navegador não oferece Web Push.");
        let permission = Notification.permission;
        if (permission === "default") {
            setRepairStatus("Aguardando permissão…", "Confirme o aviso do aparelho");
            permission = await withTimeout(Notification.requestPermission(), 30000, "O aparelho não respondeu ao pedido de permissão.");
        }
        if (permission !== "granted") throw new Error("As notificações estão bloqueadas nos Ajustes do aparelho.");
        localStorage.setItem(getNotificationsPreferenceKey(), "true");
        // O reparo explícito tem prioridade. Invalida qualquer tentativa
        // automática anterior sem ficar esperando uma Promise presa no iOS.
        pushSubscriptionGeneration += 1;
        pushSubscriptionInFlight = null;
        setRepairStatus("Recuperando aparelho…", "Validando a assinatura atual do iPhone");
        let subscription = await withTimeout(
            ensurePushSubscription({ forceRefresh: false, onProgress: setRepairStatus }),
            65000,
            "O iPhone não concluiu o cadastro push. Feche e abra o app e tente novamente.",
        );
        if (!subscription?.endpoint) throw new Error("O aparelho não criou uma assinatura push.");
        setRepairStatus("Enviando teste…", "Confirmando a comunicação com o servidor");
        let result = await withTimeout(
            supabaseClient.functions.invoke("send-task-push", { body: { test_push: true, endpoint: subscription.endpoint } }),
            20000,
            "O servidor demorou demais para responder ao teste.",
        );
        if (result.error) throw result.error;
        let failure = Array.isArray(result.data?.failures) ? result.data.failures[0] : null;
        if (Number(result.data?.sent || 0) < 1 && [404, 410].includes(Number(failure?.status))) {
            setRepairStatus("Renovando aparelho…", "A assinatura antiga expirou; criando outra");
            pushSubscriptionGeneration += 1;
            pushSubscriptionInFlight = null;
            subscription = await withTimeout(
                ensurePushSubscription({ forceRefresh: true, onProgress: setRepairStatus }),
                65000,
                "O iPhone não conseguiu renovar a assinatura push.",
            );
            if (!subscription?.endpoint) throw new Error("O aparelho não criou uma assinatura push nova.");
            setRepairStatus("Enviando novo teste…", "Confirmando a assinatura renovada");
            result = await withTimeout(
                supabaseClient.functions.invoke("send-task-push", { body: { test_push: true, endpoint: subscription.endpoint } }),
                20000,
                "O servidor demorou demais para responder ao novo teste.",
            );
            if (result.error) throw result.error;
            failure = Array.isArray(result.data?.failures) ? result.data.failures[0] : null;
        }
        if (Number(result.data?.sent || 0) < 1) {
            throw new Error(failure ? `O serviço recusou a assinatura (${failure.status || "sem código"}).` : "O servidor não encontrou este aparelho.");
        }
        updateNotificationsSettingUI();
        showAppNotice("Push enviado. Este aparelho está configurado corretamente.", "success");
    } catch (error) {
        showAppNotice(`Não foi possível configurar o push: ${error.message}`, "error");
    } finally {
        btnRepairTestPush.disabled = false;
        btnRepairTestPush.innerHTML = original;
        if (window.lucide) window.lucide.createIcons();
    }
}

function canCurrentUserCheckTask(task) {
    if (task && isTrainingCategory(task.category)) return isTrainingTaskOwnedByCurrentUser(task);
    if (!task || !normalizeAccountEmail(task.assigned_to)) return true;
    return Boolean(currentUser) && normalizeAccountEmail(task.assigned_to) === normalizeAccountEmail(currentUser.email);
}

function isTrainingTaskOwnedByCurrentUser(task) {
    if (!task || !currentUser) return false;
    if (task.user_id) return String(task.user_id) === String(currentUser.id);
    return canManageTrainingCollaborativeCategory(task.category);
}

function getTrainingTaskOwnerEmail(task) {
    if (!task) return "";
    if (currentUser && String(task.user_id || "") === String(currentUser.id)) return currentUser.email || "";
    const category = categories.find(cat => cat.name === task.category);
    const ownerShare = (categoryShares || []).find(share => String(share.category_id) === String(category?.id) && share.owner_email);
    if (category && String(task.user_id || category.user_id || "") === String(category.user_id || "")) return ownerShare?.owner_email || "";
    return "";
}

function showTaskCheckPermissionNotice(task) {
    const trainingViewOnly = task && isTrainingCategory(task.category) && !isTrainingTaskOwnedByCurrentUser(task);
    const responsible = task && task.assigned_to ? getIdentityLabel(task.assigned_to) : "o responsável";
    const toast = document.createElement("div");
    toast.className = "shared-task-toast task-check-permission-toast";
    toast.setAttribute("role", "status");
    toast.innerHTML = trainingViewOnly
        ? `<i data-lucide="eye"></i><div><strong>Tarefa somente para visualização</strong><span>Somente a pessoa dona desta tarefa de treino pode dar check.</span></div>`
        : `<i data-lucide="lock-keyhole"></i><div><strong>Check restrito</strong><span>Esta tarefa foi atribuída a ${escapeHTML(responsible)}. Somente essa pessoa pode dar check.</span></div>`;
    document.body.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();
    requestAnimationFrame(() => toast.classList.add("active"));
    setTimeout(() => {
        toast.classList.remove("active");
        setTimeout(() => toast.remove(), 300);
    }, 4200);
}

function getInviteSeenKey(inviteId) {
    const account = currentUser ? currentUser.id : "anonymous";
    return `collab_invite_seen_${account}_${inviteId}`;
}

function updateCollaborationInviteAttention() {
    if (!btnNotifications) return;
    const unseenInvites = (pendingInvites || []).filter(invite => localStorage.getItem(getInviteSeenKey(invite.id)) !== "true");
    const unreadTasks = (sharedTaskNotifications || []).filter(notification => !notification.read_at);
    const needsAttention = unseenInvites.length > 0 || unreadTasks.length > 0;
    if (notificationsBadge) notificationsBadge.style.display = needsAttention ? "block" : "none";
    if (collabInviteReadyLabel) {
        const unreadTrainingOnly = unreadTasks.length > 0 && unreadTasks.every(notification => isTrainingCategory(notification.category_name));
        const latestTrainingActor = unreadTrainingOnly ? (getIdentityLabelByUserId(unreadTasks[0]?.actor_id) || "Participante").replace(/^@/, "") : "";
        collabInviteReadyLabel.textContent = unseenInvites.length > 0
            ? "Você recebeu um convite"
            : unreadTrainingOnly ? `${latestTrainingActor} adicionou um novo treino` : "Você recebeu uma nova tarefa";
    }
    const previewKey = needsAttention
        ? [...unseenInvites.map(item => `invite:${item.id}`), ...unreadTasks.map(item => `task:${item.id}`)].sort().join("|")
        : "";
    if (!needsAttention) {
        clearTimeout(notificationPreviewTimer);
        notificationPreviewTimer = null;
        lastNotificationPreviewKey = "";
        btnNotifications.classList.remove("invite-attention");
        collabInviteReadyLabel?.setAttribute("aria-hidden", "true");
    } else if (previewKey !== lastNotificationPreviewKey) {
        lastNotificationPreviewKey = previewKey;
        clearTimeout(notificationPreviewTimer);
        btnNotifications.classList.add("invite-attention");
        collabInviteReadyLabel?.setAttribute("aria-hidden", "false");
        notificationPreviewTimer = setTimeout(() => {
            btnNotifications?.classList.remove("invite-attention");
            collabInviteReadyLabel?.setAttribute("aria-hidden", "true");
            notificationPreviewTimer = null;
        }, 3000);
    }
}

function markCurrentInvitesAsSeen() {
    (pendingInvites || []).forEach(invite => localStorage.setItem(getInviteSeenKey(invite.id), "true"));
    if (btnNotifications) btnNotifications.classList.remove("invite-attention");
    if (collabInviteReadyLabel) collabInviteReadyLabel.setAttribute("aria-hidden", "true");
    clearTimeout(notificationPreviewTimer);
    notificationPreviewTimer = null;
}

async function markSharedTaskNotificationsAsRead() {
    const unreadIds = (sharedTaskNotifications || []).filter(item => !item.read_at).map(item => item.id);
    if (!unreadIds.length) return;
    const readAt = new Date().toISOString();
    sharedTaskNotifications = sharedTaskNotifications.map(item => unreadIds.includes(item.id) ? { ...item, read_at: readAt } : item);
    updateCollaborationInviteAttention();
    if (!supabaseClient || !currentUser) return;
    const { error } = await supabaseClient.from("shared_task_notifications").update({ read_at: readAt }).in("id", unreadIds);
    if (error) console.warn("Não foi possível marcar as notificações como lidas:", error.message);
}

function subscribeToCollaborationUpdates() {
    if (!supabaseClient || !currentUser) return;
    if (collaborationRealtimeChannel) supabaseClient.removeChannel(collaborationRealtimeChannel);
    const email = normalizeAccountEmail(currentUser.email);
    let refreshTimer = null;
    const refreshSharedTrainingData = () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(async () => {
            await loadChecklistAndProgress();
            await loadCollaborationIdentityLabels();
            renderChecklist();
            if (modalTrainingReport?.classList.contains("active")) await renderTrainingReport();
        }, 220);
    };
    collaborationRealtimeChannel = supabaseClient
        .channel(`collaboration-invites-${currentUser.id}`)
        .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: "category_shares",
            filter: `collaborator_email=eq.${email}`
        }, () => loadChecklistAndProgress())
        .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: "category_shares",
            filter: `owner_id=eq.${currentUser.id}`
        }, () => loadChecklistAndProgress())
        .on("postgres_changes", {
            event: "INSERT",
            schema: "public",
            table: "shared_task_notifications",
            filter: `recipient_id=eq.${currentUser.id}`
        }, async payload => {
            const notification = payload.new || {};
            await ensureCollaborationProfile(notification.actor_id);
            if (!sharedTaskNotifications.some(item => String(item.id) === String(notification.id))) {
                sharedTaskNotifications.unshift(notification);
            }
            updateCollaborationInviteAttention();
            if (areNotificationsEnabled()) showSharedTaskAlert(notification);
            loadChecklistAndProgress();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, refreshSharedTrainingData)
        .on("postgres_changes", { event: "*", schema: "public", table: "completions" }, refreshSharedTrainingData)
        .on("postgres_changes", { event: "*", schema: "public", table: "training_photos" }, () => {
            refreshSharedTrainingData();
            setTimeout(warmTrainingPhotoCache, 300);
        })
        .subscribe();
}

function showSharedTaskAlert(notification) {
    const trainingNotification = isTrainingCategory(notification.category_name);
    const actorLabel = (getIdentityLabelByUserId(notification.actor_id) || "Participante").replace(/^@/, "");
    const title = trainingNotification ? `${actorLabel} adicionou um novo treino` : "Nova tarefa compartilhada";
    const categoryText = notification.category_name ? ` em ${notification.category_name}` : "";
    const body = trainingNotification
        ? `“${notification.task_title || "Treino"}” foi adicionado${categoryText}. Disponível somente para visualização.`
        : `“${notification.task_title || "Nova tarefa"}” foi adicionada${categoryText}.`;

    const toast = document.createElement("div");
    toast.className = "shared-task-toast";
    toast.setAttribute("role", "status");
    toast.innerHTML = `<i data-lucide="users"></i><div><strong>${escapeHTML(title)}</strong><span>${escapeHTML(body)}</span></div>`;
    document.body.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();
    requestAnimationFrame(() => toast.classList.add("active"));
    setTimeout(() => {
        toast.classList.remove("active");
        setTimeout(() => toast.remove(), 300);
    }, 5200);

    showWebNotification(title, body, notification.task_id, `shared-task-${notification.id || notification.task_id}`);
}

async function loadData() {
    const versionAtFetchStart = localDataVersion;
    const selectedDateAtFetchStart = selectedDate;
    const requestVersionAtFetchStart = ++dataLoadRequestVersion;
    if (supabaseClient && currentUser) {
        try {
            await loadFunctionAssociationsFromCloud();
            // Executa as consultas ao banco de dados em paralelo usando Promise.all para máxima velocidade de carregamento
            const [
                catsResult,
                countResult,
                tasksResult,
                compTodayResult,
                compBeforeResult,
                sharesOwnerResult,
                sharesCollabResult,
                sharedNotificationsResult
            ] = await Promise.all([
                supabaseClient.from('categories').select('*').eq('is_active', true),
                supabaseClient.from('categories').select('*', { count: 'exact', head: true }),
                supabaseClient.from('tasks').select('*').eq('is_active', true),
                supabaseClient.from('completions').select('*').eq('date', selectedDateAtFetchStart),
                supabaseClient.from('completions').select('task_id, date, completed').lt('date', selectedDateAtFetchStart),
                supabaseClient.from('category_shares').select('*').eq('owner_id', currentUser.id).then(r => r, err => {
                    console.warn("Tabela 'category_shares' não encontrada ou inacessível ao buscar proprietário.", err);
                    return { data: [], error: null };
                }),
                supabaseClient.from('category_shares').select('*').ilike('collaborator_email', currentUser.email.trim()).then(r => r, err => {
                    console.warn("Tabela 'category_shares' não encontrada ou inacessível ao buscar colaborador.", err);
                    return { data: [], error: null };
                }),
                supabaseClient.from('shared_task_notifications').select('*').eq('recipient_id', currentUser.id).order('created_at', { ascending: false }).limit(50).then(r => r, err => {
                    console.warn("Tabela de notificações compartilhadas não encontrada ou inacessível.", err);
                    return { data: [], error: null };
                })
            ]);

            // A navegação pode iniciar outro carregamento antes deste terminar.
            // Nesse caso, a resposta pertence a uma tela antiga e deve ser ignorada.
            if (requestVersionAtFetchStart !== dataLoadRequestVersion || selectedDateAtFetchStart !== selectedDate) {
                console.log("[Data] Resposta obsoleta ignorada após troca de data.");
                return false;
            }

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

            // Remove o antigo conjunto pessoal que versões anteriores copiavam
            // automaticamente para contas vazias. A condição estrita evita
            // tocar em contas que já criaram categorias ou tarefas próprias.
            const ownedActiveCats = dbCats.filter(cat => String(cat.user_id) === String(currentUser.id));
            const ownedNames = ownedActiveCats.map(cat => cat.name).sort();
            const legacyNames = [...LEGACY_AUTO_SEEDED_CATEGORIES].sort();
            const isUntouchedLegacyAccount = dbTasks.length === 0
                && ownedNames.length === legacyNames.length
                && ownedNames.every((name, index) => name === legacyNames[index]);
            if (isUntouchedLegacyAccount) {
                const legacyIds = ownedActiveCats.map(cat => cat.id);
                const { error: cleanupError } = await supabaseClient
                    .from('categories')
                    .update({ is_active: false })
                    .in('id', legacyIds);
                if (!cleanupError) dbCats = dbCats.filter(cat => !legacyIds.some(id => String(id) === String(cat.id)));
                else console.warn("Não foi possível limpar categorias legadas desta conta:", cleanupError.message);
            }

            // Mescla compartilhamentos únicos
            const sharesOwner = sharesOwnerResult.data || [];
            const sharesCollab = sharesCollabResult.data || [];
            sharedTaskNotifications = sharedNotificationsResult.data || [];
            const mergedSharesMap = new Map();
            sharesOwner.forEach(s => mergedSharesMap.set(String(s.id), s));
            sharesCollab.forEach(s => mergedSharesMap.set(String(s.id), s));
            categoryShares = Array.from(mergedSharesMap.values());
            localStorage.setItem("offline_category_shares", JSON.stringify(categoryShares));

            // Filtra os convites pendentes recebidos
            const signedInEmail = normalizeAccountEmail(currentUser.email);
            pendingInvites = categoryShares.filter(s => normalizeAccountEmail(s.collaborator_email) === signedInEmail && s.accepted !== true);
            const collaboratorShares = categoryShares.filter(s => normalizeAccountEmail(s.collaborator_email) === signedInEmail && s.accepted === true);
            const acceptedSharedCategoryIds = new Set(collaboratorShares.map(share => String(share.category_id)));

            // A política do banco permite ler a categoria de um convite pendente
            // para exibir seu nome no sininho. Isso não significa que ela já
            // deva entrar na navegação: somente categorias próprias ou aceitas.
            dbCats = dbCats.filter(cat =>
                String(cat.user_id) === String(currentUser.id)
                || acceptedSharedCategoryIds.has(String(cat.id))
            );

            // Busca as categorias compartilhadas comigo (aceitas e pendentes)
            const allSharedShares = categoryShares.filter(s => normalizeAccountEmail(s.collaborator_email) === signedInEmail && s.owner_id !== currentUser.id);
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
                        const acceptedCatIds = collaboratorShares.map(s => String(s.category_id));
                        sharedCats.forEach(sc => {
                            if (acceptedCatIds.includes(String(sc.id)) && !dbCats.some(c => String(c.id) === String(sc.id))) {
                                dbCats.push(sc);
                            }
                        });
                    }
                } catch (err) {
                    console.error("Erro ao carregar categorias compartilhadas:", err);
                }
            }
            dbCats = dedupeCategories(dbCats);
            const cachedCategoryOrder = JSON.parse(localStorage.getItem("offline_categories")) || [];
            const cachedOrderById = new Map(cachedCategoryOrder.map((cat, index) => [String(cat.id), index]));
            const cachedOrderByName = new Map(cachedCategoryOrder.map((cat, index) => [cat.name, index]));
            dbCats.sort((a, b) => {
                const aLocal = cachedOrderById.get(String(a.id)) ?? cachedOrderByName.get(a.name);
                const bLocal = cachedOrderById.get(String(b.id)) ?? cachedOrderByName.get(b.name);
                if (aLocal !== undefined && bLocal !== undefined) return aLocal - bLocal;
                if (aLocal !== undefined) return -1;
                if (bLocal !== undefined) return 1;
                const aCloud = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : Number.MAX_SAFE_INTEGER;
                const bCloud = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : Number.MAX_SAFE_INTEGER;
                return aCloud - bCloud;
            });
            
            // Contas novas começam vazias. Os padrões só são criados quando o
            // usuário escolhe explicitamente "Restaurar Padrões do App".
            if (
                localDataVersion !== versionAtFetchStart ||
                requestVersionAtFetchStart !== dataLoadRequestVersion ||
                selectedDateAtFetchStart !== selectedDate
            ) {
                console.warn("Dados ou data mudaram durante o carregamento assíncrono. Descartando resposta obsoleta.");
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

                const recentDeletionCutoff = Date.now() - 24 * 60 * 60 * 1000;
                const localDeletionIds = new Set(existingLocal
                    .filter(task => task.is_active === false && (!task.local_deleted_at || new Date(task.local_deleted_at).getTime() >= recentDeletionCutoff))
                    .map(task => String(task.id)));
                const pendingDeleteIds = new Set([...pendingDeletes].map(String));
                dbTasks = dbTasks.filter(task =>
                    task.is_active !== false
                    && !localDeletionIds.has(String(task.id))
                    && !pendingDeleteIds.has(String(task.id))
                );
            }

            categories = dbCats;
            allActiveTasks = dbTasks || [];

            const completedBeforeIds = new Set(dbCompletionsBefore.map(c => String(c.task_id)));
            
            let queue = JSON.parse(localStorage.getItem("offline_completions_queue")) || {};
            Object.keys(queue).forEach(key => {
                const [taskIdStr, dateStr] = key.split('_');
                if (dateStr === selectedDate) {
                    const completed = queue[key];
                    const existingIndex = dbCompletionsToday.findIndex(c => String(c.task_id) === taskIdStr);
                    if (completed === true) {
                        if (existingIndex !== -1) {
                            dbCompletionsToday[existingIndex].completed = true;
                        } else {
                            dbCompletionsToday.push({ task_id: taskIdStr, date: selectedDate, completed: true });
                        }
                    } else if (completed === "excluded") {
                        if (existingIndex !== -1) dbCompletionsToday.splice(existingIndex, 1);
                        dbCompletionsToday.push({ task_id: taskIdStr, date: selectedDate, completed: false });
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

            const todayStr = getLocalDateString(new Date());

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
                    if (selectedDate === todayStr) {
                        return taskCreatedDate === selectedDate || (taskCreatedDate < selectedDate && !completedBeforeIds.has(String(task.id)));
                    } else if (selectedDate < todayStr) {
                        return completedTodayIds.has(String(task.id));
                    } else {
                        return taskCreatedDate === selectedDate;
                    }
                }
            }).map(task => ({
                id: task.id,
                title: task.title,
                category: task.category,
                category_id: task.category_id || null,
                is_recurring: task.is_recurring,
                repeat_days: task.repeat_days || null,
                context: typeof task.context === 'string' ? ( () => { try { return JSON.parse(task.context); } catch(e) { return {}; } } )() : task.context || null,
                assigned_to: task.assigned_to || null,
                user_id: task.user_id || null,
                created_at: task.created_at,
                completed: completedTodayIds.has(String(task.id))
            }));

            // Salva os dados mais recentes carregados do Supabase no cache local.
            // MERGE: Preserva tarefas com tempId pendentes (ainda não confirmadas pelo Supabase)
            // para evitar race condition onde loadData sobrescreve o localStorage antes
            // do addTask background insert concluir e atualizar o tempId para UUID real.
            const localCatsBefore = JSON.parse(localStorage.getItem("offline_categories")) || [];
            dbCats = dbCats.map(dbCat => {
                const localCat = localCatsBefore.find(lc => String(lc.id) === String(dbCat.id) || lc.name === dbCat.name);
                if (localCat && localCat.type && !dbCat.type) {
                    if (CATEGORIES_CLOUD_SUPPORTS_TYPE && String(dbCat.user_id) === String(currentUser.id) && !isTemporaryId(dbCat.id)) {
                        supabaseClient.from("categories").update({ type: localCat.type }).eq("id", dbCat.id)
                            .then(({ error }) => { if (error) console.warn("Tipo da categoria ainda não pôde ser sincronizado:", error.message); });
                    }
                    return { ...dbCat, type: localCat.type };
                }
                return dbCat;
            });
            dbCats = dedupeCategories(dbCats);
            localStorage.setItem("offline_categories", JSON.stringify(dbCats));
            // Usa imediatamente os tipos recuperados do cache local. Antes eles
            // eram salvos, mas a lista em memória continuava desatualizada.
            categories = dbCats;

            const existingLocal = JSON.parse(localStorage.getItem("offline_tasks")) || [];
            const pendingLocalTasks = existingLocal.filter(t => isTemporaryId(t.id) && t.is_active !== false);
            const recentLocalDeletions = existingLocal.filter(task =>
                task.is_active === false
                && task.local_deleted_at
                && Date.now() - new Date(task.local_deleted_at).getTime() < 24 * 60 * 60 * 1000
            );
            
            // mergedTasks já é dbTasks com as posições locais mescladas
            const mergedTasks = [...dbTasks];
            for (const pending of pendingLocalTasks) {
                // Só inclui se não existe uma tarefa idêntica (mesmo titulo+categoria) já no Supabase
                const alreadyExists = mergedTasks.some(d => d.title === pending.title && d.category === pending.category);
                if (!alreadyExists) mergedTasks.push(pending);
            }
            recentLocalDeletions.forEach(deleted => {
                if (!mergedTasks.some(task => String(task.id) === String(deleted.id))) mergedTasks.push(deleted);
            });
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
    let localCats = dedupeCategories(JSON.parse(localStorage.getItem("offline_categories")) || []);
    localStorage.setItem("offline_categories", JSON.stringify(localCats));
    categories = localCats.filter(c => c.is_active);

    // 2. Fetch tasks offline
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    allActiveTasks = localTasks.filter(task => task.is_active !== false);

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
    const todayStr = getLocalDateString(new Date());

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
            if (selectedDate === todayStr) {
                return taskCreatedDate === selectedDate || (taskCreatedDate < selectedDate && !completedBeforeIds.has(String(task.id)));
            } else if (selectedDate < todayStr) {
                return completedTodayIds.has(String(task.id));
            } else {
                return taskCreatedDate === selectedDate;
            }
        }
    }).map(task => ({
        id: task.id,
        title: task.title,
        category: task.category,
        category_id: task.category_id || null,
        is_recurring: task.is_recurring,
        repeat_days: task.repeat_days || null,
        context: typeof task.context === 'string' ? ( () => { try { return JSON.parse(task.context); } catch(e) { return {}; } } )() : task.context || null,
        assigned_to: task.assigned_to || null,
        user_id: task.user_id || null,
        created_at: task.created_at,
        completed: completedTodayIds.has(String(task.id))
    }));
}

let categoriesOverflowEventsBound = false;

function updateCategoriesOverflowFade() {
    const bar = document.getElementById("categories-bar");
    if (!bar) return;

    const maxScrollLeft = Math.max(0, bar.scrollWidth - bar.clientWidth);
    bar.classList.toggle("has-overflow-left", bar.scrollLeft > 3);
    bar.classList.toggle("has-overflow-right", bar.scrollLeft < maxScrollLeft - 3);
}

function setupCategoriesOverflowFade() {
    const bar = document.getElementById("categories-bar");
    if (!bar || categoriesOverflowEventsBound) return;
    categoriesOverflowEventsBound = true;
    bar.addEventListener("scroll", updateCategoriesOverflowFade, { passive: true });
    window.addEventListener("resize", updateCategoriesOverflowFade, { passive: true });
}

function renderCategories() {
    categories = dedupeCategories(categories);
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

    setupCategoriesOverflowFade();
    requestAnimationFrame(updateCategoriesOverflowFade);

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
            item.className = "manage-item category-manager-card";
            
            const hasType = !!cat.type;
            item.style.cssText = `
                background: rgba(255, 255, 255, 0.02);
                border: 1px solid ${hasType ? 'var(--border-color)' : 'rgba(245, 158, 11, 0.3)'};
                padding: 12px;
                border-radius: var(--radius-md);
                display: flex;
                flex-direction: column;
                gap: 8px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                transition: border-color 0.2s, background-color 0.2s;
                box-sizing: border-box;
                width: 100%;
            `;
            if (!hasType) {
                item.style.backgroundColor = "rgba(245, 158, 11, 0.02)";
            }
            
            const isOwner = currentUser && cat.user_id === currentUser.id;
            item.classList.toggle("shared-category-readonly", !isOwner);
            let collabBtnHtml = "";
            if (currentUser) {
                collabBtnHtml = `
                    <button class="btn-collab-cat" data-id="${cat.id}" style="background: transparent; border: none; color: var(--primary); cursor: pointer; padding: 6px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s, color 0.2s;" onmouseover="this.style.backgroundColor='rgba(139,92,246,0.1)';" onmouseout="this.style.backgroundColor='transparent';" title="Colaboradores">
                        <i data-lucide="users" style="width: 14px; height: 14px; color: var(--primary);"></i>
                    </button>
                `;
            }

            const typeOptions = ["Trabalho", "Empresa", "Faculdade/Estudos", "Projeto", "Pessoal", "Saúde", "Finanças", "Casa", "Lazer", "Outro"];
            const isCustomType = cat.type && !typeOptions.slice(0, -1).includes(cat.type);
            const selectedType = isCustomType ? "Outro" : (cat.type || "");

            item.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;">
                    <input type="text" class="input-edit-cat-name" value="${escapeHTML(cat.name)}" ${isOwner ? "" : "readonly"} style="flex: 1; min-width: 0; padding: 7px 10px; font-size: 0.82rem; font-weight: 600; background: rgba(0,0,0,0.15); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; outline: none; transition: border-color 0.2s;" placeholder="Nome da Categoria">
                    <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                        ${collabBtnHtml}
                        <button class="btn-delete-cat ${isOwner ? "" : "btn-leave-shared-category"}" data-id="${cat.id}" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 6px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s, color 0.2s;" title="${isOwner ? "Excluir" : "Sair da categoria"}">
                            <i data-lucide="${isOwner ? "trash-2" : "log-out"}" style="width: 14px; height: 14px;"></i>
                        </button>
                    </div>
                </div>
                <div style="display: flex; gap: 8px; width: 100%; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
                        <span style="font-size: 0.65rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.02em;">Tipo:</span>
                        <select class="select-edit-cat-type" ${isOwner ? "" : "disabled"} style="flex: 1; padding: 6px 10px; font-size: 0.78rem; background: rgba(0,0,0,0.15); color: var(--text-primary); border: 1px solid ${hasType ? 'var(--border-color)' : '#f59e0b'}; border-radius: 6px; outline: none; cursor: pointer; font-weight: 500;">
                            <option value="" disabled ${!selectedType ? "selected" : ""}>Não classificada</option>
                            ${typeOptions.map(t => `<option value="${t}" ${selectedType === t ? "selected" : ""}>${t}</option>`).join("")}
                        </select>
                    </div>
                </div>
                <div class="edit-custom-type-wrapper" style="display: ${selectedType === "Outro" ? "flex" : "none"}; align-items: center; gap: 6px; width: 100%;">
                    <span style="font-size: 0.65rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.02em;">Custom:</span>
                    <input type="text" class="input-edit-cat-custom-type" value="${escapeHTML(isCustomType ? cat.type : "")}" ${isOwner ? "" : "readonly"} placeholder="Ex: Viagens" style="flex: 1; padding: 6px 10px; font-size: 0.78rem; background: rgba(0,0,0,0.15); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; outline: none;">
                </div>
            `;
            
            const btnDel = item.querySelector(".btn-delete-cat");
            btnDel.addEventListener("click", (e) => {
                e.stopPropagation();
                if (isOwner) deleteCategory(cat.id);
                else leaveSharedCategory(cat);
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

            const inputName = item.querySelector(".input-edit-cat-name");
            const selectType = item.querySelector(".select-edit-cat-type");
            const inputCustom = item.querySelector(".input-edit-cat-custom-type");
            const customWrapper = item.querySelector(".edit-custom-type-wrapper");

            const triggerUpdate = async () => {
                const nameVal = inputName.value.trim();
                let typeVal = selectType.value;
                if (typeVal === "Outro") {
                    typeVal = inputCustom.value.trim();
                }
                if (!nameVal) return;
                await updateCategoryFields(cat.id, nameVal, typeVal);
            };

            if (isOwner) selectType.addEventListener("change", () => {
                if (selectType.value === "Outro") {
                    customWrapper.style.display = "flex";
                } else {
                    customWrapper.style.display = "none";
                    triggerUpdate();
                }
            });

            if (isOwner) {
                inputName.addEventListener("change", triggerUpdate);
                inputCustom.addEventListener("change", triggerUpdate);
            }
            
            manageList.appendChild(item);
        });
    }

    // 3.1. Render Classificar Categorias Antigas (if any unclassified)
    const settingsClassifyWrapper = document.getElementById("settings-classify-unclassified-cats-wrapper");
    const settingsClassifyList = document.getElementById("settings-unclassified-cats-list");
    
    if (settingsClassifyWrapper && settingsClassifyList) {
        const unclassifiedCats = categories.filter(c => !c.type && c.is_active && currentUser && String(c.user_id) === String(currentUser.id));
        if (unclassifiedCats.length > 0) {
            settingsClassifyWrapper.style.display = "block";
            settingsClassifyList.innerHTML = unclassifiedCats.map(cat => `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; background: rgba(0,0,0,0.15); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(245, 158, 11, 0.2); box-sizing: border-box; width: 100%;">
                    <span style="font-weight: 700; color: var(--text-primary); font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px;">"${escapeHTML(cat.name)}"</span>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <select class="settings-classify-cat-select" data-id="${cat.id}" style="background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-color); padding: 4px 6px; border-radius: 4px; font-size: 0.76rem;">
                            <option value="Trabalho">Trabalho</option>
                            <option value="Empresa">Empresa</option>
                            <option value="Faculdade/Estudos">Faculdade/Estudos</option>
                            <option value="Projeto">Projeto</option>
                            <option value="Pessoal">Pessoal</option>
                            <option value="Saúde">Saúde</option>
                            <option value="Finanças">Finanças</option>
                            <option value="Casa">Casa</option>
                            <option value="Lazer">Lazer</option>
                            <option value="Outro">Outro...</option>
                        </select>
                        <button class="btn-save-settings-cat-type" data-id="${cat.id}" style="background: #eab308; color: black; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.76rem; font-weight: bold; cursor: pointer;">Salvar</button>
                    </div>
                </div>
            `).join("");
            
            // Add click listeners
            settingsClassifyList.querySelectorAll(".btn-save-settings-cat-type").forEach(btn => {
                btn.addEventListener("click", () => {
                    const catId = btn.dataset.id;
                    const select = settingsClassifyList.querySelector(`.settings-classify-cat-select[data-id="${catId}"]`);
                    if (select) {
                        const typeVal = select.value;
                        const cat = categories.find(c => String(c.id) === String(catId));
                        if (cat) {
                            updateCategoryFields(cat.id, cat.name, typeVal);
                        }
                    }
                });
            });
        } else {
            settingsClassifyWrapper.style.display = "none";
        }
    }

    // 3.2. Render Ensine o App (funções ainda não reconhecidas)
    const settingsTeachWrapper = document.getElementById("settings-teach-app-wrapper");
    const settingsTeachList = document.getElementById("settings-teach-app-list");
    
    if (settingsTeachWrapper && settingsTeachList) {
        const unclassifiedTerms = getRecentUnclassifiedTerms();
        if (unclassifiedTerms.length > 0) {
            settingsTeachWrapper.style.display = "block";
            settingsTeachList.innerHTML = unclassifiedTerms.map(term => `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; background: rgba(0,0,0,0.15); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); box-sizing: border-box; width: 100%;">
                    <span style="font-weight: 700; color: var(--text-primary); font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px;">"${escapeHTML(term)}"</span>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <select class="settings-teach-term-select" data-term="${encodeURIComponent(term.toLowerCase())}" style="background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-color); padding: 4px 6px; border-radius: 4px; font-size: 0.76rem; max-width: 150px;">
                            <option value="" selected disabled>Selecionar…</option>
                            <option value="delivery">Entrega</option>
                            <option value="billing">Cobrança/Financeiro</option>
                            <option value="production">Produção/Operação</option>
                            <option value="marketing">Divulgação</option>
                            <option value="sales">Vendas/Comercial</option>
                            <option value="service">Atendimento</option>
                            <option value="supply">Compra/Abastecimento</option>
                            <option value="assessment">Avaliação/Prova</option>
                            <option value="academic_work">Trabalho acadêmico</option>
                            <option value="study">Estudo/Revisão</option>
                            <option value="exercise">Atividade física</option>
                            <option value="self_care">Saúde/Autocuidado</option>
                            <option value="home">Casa/Organização</option>
                            <option value="personal_learning">Aprendizado</option>
                            <option value="planning">Rotina/Planejamento</option>
                            <option value="other">Outra atividade</option>
                        </select>
                        <button class="btn-save-settings-teach-term" data-term="${encodeURIComponent(term.toLowerCase())}" style="background: var(--primary); color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.76rem; font-weight: bold; cursor: pointer;">Salvar</button>
                    </div>
                </div>
            `).join("");
            
            // Add click listeners
            settingsTeachList.querySelectorAll(".btn-save-settings-teach-term").forEach(btn => {
                btn.addEventListener("click", () => {
                    const encodedTerm = btn.dataset.term;
                    const term = decodeURIComponent(encodedTerm);
                    const select = settingsTeachList.querySelector(`.settings-teach-term-select[data-term="${encodedTerm}"]`);
                    if (select) {
                        if (!select.value) {
                            select.focus();
                            return;
                        }
                        saveLearnedFunctionAssociation(term, select.value);
                        btn.textContent = "Aprendido ✓";
                        btn.disabled = true;
                        setTimeout(() => renderCategories(), 650);
                    }
                });
            });
        } else {
            settingsTeachWrapper.style.display = "block";
            settingsTeachList.innerHTML = '<p style="margin:0; color:var(--text-muted); font-size:.72rem; text-align:center;">Nenhuma sugestão pendente. Você ainda pode ensinar um termo manualmente acima.</p>';
        }
    }

    const learnedWrapper = document.getElementById("settings-learned-functions-wrapper");
    const learnedList = document.getElementById("settings-learned-functions-list");
    if (learnedWrapper && learnedList) {
        const learned = JSON.parse(localStorage.getItem("user_function_associations")) || {};
        const learnedEntries = Object.entries(learned).filter(([, functionId]) => REPORT_FUNCTION_CATALOG[functionId]);
        if (learnedEntries.length > 0) {
            learnedWrapper.style.display = "block";
            learnedList.innerHTML = learnedEntries.map(([term, functionId]) => {
                const encodedTerm = encodeURIComponent(term);
                return `
                    <div style="display:flex; align-items:center; gap:7px; padding:7px 9px; border-radius:7px; background:rgba(255,255,255,.025); border:1px solid var(--border-color);">
                        <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; font-size:.76rem; font-weight:700; color:var(--text-primary);">${escapeHTML(term)}</span>
                        <span style="font-size:.7rem; color:var(--text-secondary);">${escapeHTML(REPORT_FUNCTION_CATALOG[functionId].singular)}</span>
                        <button class="btn-remove-learned-function" data-term="${encodedTerm}" title="Remover aprendizado" style="display:flex; padding:4px; border:0; background:transparent; color:#ef4444; cursor:pointer;"><i data-lucide="x" style="width:14px;height:14px;"></i></button>
                    </div>`;
            }).join("");
            learnedList.querySelectorAll(".btn-remove-learned-function").forEach(button => {
                button.addEventListener("click", () => {
                    const term = decodeURIComponent(button.dataset.term);
                    const latestLearned = JSON.parse(localStorage.getItem("user_function_associations")) || {};
                    delete latestLearned[term];
                    localStorage.setItem("user_function_associations", JSON.stringify(latestLearned));
                    syncFunctionAssociationsToCloud(latestLearned);
                    renderCategories();
                });
            });
        } else {
            learnedWrapper.style.display = "none";
            learnedList.innerHTML = "";
        }
    }
    
    // Atualiza os ícones após renderizar as guias e listas
    lucide.createIcons();
}

function getRecentUnclassifiedTerms() {
    const associations = JSON.parse(localStorage.getItem("user_function_associations")) || {};
    const unclassifiedCandidates = new Set();
    const stopWords = ["para", "com", "uma", "uns", "das", "dos", "pelo", "pela", "seus", "suas", "como", "mais", "fazer", "cada", "toda", "todo", "hoje", "ontem", "amanha", "amanhã", "tarefa", "editar"];
    
    // Analisa conclusões dos últimos 30 dias para aprender com mais histórico.
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 30);
    const startStr = getLocalDateString(sevenDaysAgo);
    
    let localCompletions = JSON.parse(localStorage.getItem("offline_completions")) || [];
    const recentCompletions = localCompletions.filter(c => c.date >= startStr && c.completed === true);
    
    recentCompletions.forEach(c => {
        const task = allActiveTasks.find(t => String(t.id) === String(c.task_id));
        if (task) {
            if (classifyTaskFunction(task).singular !== "Outra atividade") return;
            const words = task.title.split(/\s+/);
            words.forEach((word, idx) => {
                    const cleaned = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
                    if (cleaned.length > 3 && !stopWords.includes(cleaned.toLowerCase())) {
                        const isCapitalized = cleaned[0] === cleaned[0].toUpperCase() && cleaned[0] !== cleaned[0].toLowerCase();
                        const wLower = cleaned.toLowerCase();
                        
                        // Não transforma verbos comuns terminados em 'ar', 'er', 'ir' em termos aprendidos
                        if (wLower.match(/(ar|er|ir)$/) && wLower.length <= 8) {
                            return;
                        }
                        
                        if (!associations[normalizeReportText(wLower)]) {
                            if (isCapitalized || idx > 0) {
                                unclassifiedCandidates.add(cleaned);
                            }
                        }
                    }
                });
        }
    });
    
    return Array.from(unclassifiedCandidates).slice(0, 8);
}

function taskTitleEditDistance(first, second) {
    const a = normalizeReportText(first);
    const b = normalizeReportText(second);
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
        let previousDiagonal = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const previousAbove = row[j];
            row[j] = Math.min(
                row[j] + 1,
                row[j - 1] + 1,
                previousDiagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
            previousDiagonal = previousAbove;
        }
    }
    return row[b.length];
}

function getTaskTitleSuggestions(query) {
    const normalizedQuery = normalizeReportText(query).trim();
    if (normalizedQuery.length < 2) return [];
    const queryLastWord = normalizedQuery.split(/\s+/).pop();
    const selectedCategory = document.getElementById("task-category")?.value;
    const uniqueTitles = new Map();

    allActiveTasks.forEach(task => {
        if (!task?.title) return;
        const normalizedTitle = normalizeReportText(task.title).trim();
        const existing = uniqueTitles.get(normalizedTitle);
        if (!existing || task.category === selectedCategory) uniqueTitles.set(normalizedTitle, task);
    });

    return Array.from(uniqueTitles.values()).map(task => {
        const normalizedTitle = normalizeReportText(task.title);
        const titleWords = normalizedTitle.split(/\s+/);
        let score = Infinity;
        if (normalizedTitle.startsWith(normalizedQuery)) score = 0;
        else if (titleWords.some(word => word.startsWith(queryLastWord))) score = 1;
        else if (normalizedTitle.includes(normalizedQuery) || normalizedTitle.includes(queryLastWord)) score = 2;
        else {
            const closestDistance = Math.min(...titleWords.map(word => taskTitleEditDistance(queryLastWord, word)));
            const allowedDistance = Math.max(1, Math.floor(queryLastWord.length * 0.34));
            if (closestDistance <= allowedDistance) score = 3 + (closestDistance / 10);
        }
        if (task.category === selectedCategory) score -= 0.25;
        return { task, score };
    }).filter(item => Number.isFinite(item.score))
        .sort((a, b) => a.score - b.score || a.task.title.localeCompare(b.task.title, "pt-BR"))
        .slice(0, 6)
        .map(item => item.task);
}

function setupTaskTitleAutocomplete() {
    const input = document.getElementById("task-title");
    const dropdown = document.getElementById("task-title-autocomplete");
    if (!input || !dropdown || input.dataset.autocompleteReady === "true") return;
    input.dataset.autocompleteReady = "true";
    let suggestions = [];
    let activeIndex = -1;
    const autofillOffer = document.getElementById("task-autofill-offer");
    const btnTitleOnly = document.getElementById("btn-autofill-title-only");
    const btnAutofillDetails = document.getElementById("btn-autofill-details");

    const hideAutofillOffer = () => {
        autofillOffer?.classList.remove("open");
        pendingAutocompleteDetailsTask = null;
    };

    const applyTaskDetails = task => {
        if (!task) return;
        const categorySelect = document.getElementById("task-category");
        if (categorySelect && Array.from(categorySelect.options).some(option => option.value === task.category)) {
            categorySelect.value = task.category;
        }
        const recurringSelect = document.getElementById("task-recurring");
        const repeatDays = Array.isArray(task.repeat_days) ? task.repeat_days.map(Number) : [];
        if (recurringSelect) {
            recurringSelect.value = repeatDays.length > 0 ? "repeat" : (task.is_recurring ? "daily" : "once");
            recurringSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
        document.querySelectorAll("#repeat-days-group .day-toggle").forEach(button => {
            button.classList.toggle("active", repeatDays.includes(Number(button.dataset.day)));
        });
        let context = task.context || {};
        if (typeof context === "string") {
            try { context = JSON.parse(context); } catch (error) { context = {}; }
        }
        const shifts = Array.isArray(context.turnos) ? context.turnos : [];
        document.querySelectorAll("#add-shift-selector .shift-toggle-btn").forEach(button => {
            button.classList.toggle("active", shifts.includes(button.dataset.shift));
        });
        const importantInput = document.getElementById("task-important");
        if (importantInput) importantInput.checked = context.important === true || context.important === "true";
    };

    btnTitleOnly?.addEventListener("click", hideAutofillOffer);
    btnAutofillDetails?.addEventListener("click", () => {
        applyTaskDetails(pendingAutocompleteDetailsTask);
        hideAutofillOffer();
    });

    const closeSuggestions = () => {
        dropdown.classList.remove("open");
        dropdown.innerHTML = "";
        input.setAttribute("aria-expanded", "false");
        activeIndex = -1;
    };

    const chooseSuggestion = index => {
        const task = suggestions[index];
        if (!task) return;
        input.value = task.title;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        closeSuggestions();
        pendingAutocompleteDetailsTask = task;
        autofillOffer?.classList.add("open");
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    };

    const updateActiveSuggestion = () => {
        dropdown.querySelectorAll(".task-title-suggestion").forEach((button, index) => {
            button.classList.toggle("active", index === activeIndex);
            button.setAttribute("aria-selected", index === activeIndex ? "true" : "false");
            if (index === activeIndex) button.scrollIntoView({ block: "nearest" });
        });
    };

    const renderSuggestions = () => {
        suggestions = getTaskTitleSuggestions(input.value);
        activeIndex = -1;
        if (suggestions.length === 0) {
            closeSuggestions();
            return;
        }
        dropdown.innerHTML = suggestions.map((task, index) => `
            <button type="button" class="task-title-suggestion" role="option" aria-selected="false" data-index="${index}">
                <i data-lucide="history"></i>
                <span class="task-title-suggestion-text">
                    <span class="task-title-suggestion-title">${escapeHTML(task.title)}</span>
                    <span class="task-title-suggestion-meta">${escapeHTML(task.category || "Sem categoria")}</span>
                </span>
            </button>`).join("");
        dropdown.classList.add("open");
        input.setAttribute("aria-expanded", "true");
        dropdown.querySelectorAll(".task-title-suggestion").forEach(button => {
            button.addEventListener("pointerdown", event => event.preventDefault());
            button.addEventListener("click", () => chooseSuggestion(Number(button.dataset.index)));
        });
        if (window.lucide) window.lucide.createIcons();
    };

    input.addEventListener("input", renderSuggestions);
    input.addEventListener("input", () => {
        if (pendingAutocompleteDetailsTask && input.value !== pendingAutocompleteDetailsTask.title) hideAutofillOffer();
    });
    input.addEventListener("focus", () => {
        if (input.value.trim().length >= 2) renderSuggestions();
    });
    input.addEventListener("blur", () => setTimeout(closeSuggestions, 120));
    input.addEventListener("keydown", event => {
        if (!dropdown.classList.contains("open")) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            activeIndex = (activeIndex + 1) % suggestions.length;
            updateActiveSuggestion();
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            activeIndex = activeIndex <= 0 ? suggestions.length - 1 : activeIndex - 1;
            updateActiveSuggestion();
        } else if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            suppressTaskAutocompleteSubmit = true;
            chooseSuggestion(activeIndex >= 0 ? activeIndex : 0);
            setTimeout(() => { suppressTaskAutocompleteSubmit = false; }, 250);
        } else if (event.key === "Escape") {
            closeSuggestions();
        }
    });
}

function renderChecklist() {
    updateTrainingProgressMode();
    // Aborta a renderização se o usuário estiver arrastando uma tarefa para não causar flash/zerar a tela
    if (isDraggingTask) return;

    // Não recria o cartão enquanto o destaque do push está em andamento.
    // Recriações reiniciavam a animação e causavam o efeito travado no Android.
    if (activePushFocusUntil > Date.now() && tasksListEl.querySelector(".task-item.shared-task-focus")) {
        clearTimeout(pendingPushFocusRender);
        pendingPushFocusRender = setTimeout(renderChecklist, Math.max(80, activePushFocusUntil - Date.now() + 40));
        return;
    }

    // A sincronização inicial pode terminar durante o primeiro swipe. Nesse caso,
    // aguarda o gesto acabar para não substituir o cartão sob o dedo.
    if (isSwipeRevealInteracting) {
        clearTimeout(pendingSwipeSafeRender);
        pendingSwipeSafeRender = setTimeout(renderChecklist, 180);
        return;
    }

    // A animação do check é consumida somente pelo primeiro render após a ação.
    // Renderizações posteriores de sincronização não devem pulsar checks antigos.
    renderCompletionAnimationTaskId = pendingCompletionAnimationTaskId;
    pendingCompletionAnimationTaskId = null;

    // Preserva as ações abertas caso uma atualização em segundo plano realmente
    // precise reconstruir a lista logo após o gesto.
    const openSwipeTask = tasksListEl.querySelector(".task-item.swiped");
    const openSwipeTaskId = openSwipeTask ? String(openSwipeTask.dataset.id) : null;
    const protectedPushFocusId = activePushFocusUntil > Date.now() ? String(activePushFocusTaskId) : null;

    tasksListEl.innerHTML = "";
    
    // Filter tasks
    const filteredTasks = tasks.filter(task => {
        if (currentFilter === "all") {
            // Treinos de outros participantes ficam disponíveis somente dentro
            // da categoria Treino; não ocupam a rotina pessoal da aba Todos.
            return !isTrainingCategory(task.category) || isTrainingTaskOwnedByCurrentUser(task);
        }
        return task.category === currentFilter;
    });

    if (isEditMode) {
        tasksListEl.classList.add("edit-mode");
    } else {
        tasksListEl.classList.remove("edit-mode");
    }

    const needsCategoryOnboarding = categories.length === 0;
    emptyStateEl.classList.toggle("category-onboarding-active", needsCategoryOnboarding);
    updateCategoryOnboardingPlayback(needsCategoryOnboarding);
    updateTaskCreationOnboarding();

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
            const now = new Date();
            const yesterdayDate = new Date(now);
            yesterdayDate.setDate(yesterdayDate.getDate() - 1);
            const yesterdayStr = getLocalDateString(yesterdayDate);
            const isPastNightShiftExceptionPeriod = (selectedDate === yesterdayStr && now.getHours() < 12);

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
                
                let shiftLabelExtra = "";
                if (title === "Noite" && isPastNightShiftExceptionPeriod) {
                    shiftLabelExtra = `
                        <span class="past-night-check-window" title="A noite anterior permanece aberta para marcar tarefas até 12h" aria-label="A noite anterior permanece aberta para marcar tarefas até 12h">
                            <i data-lucide="clock"></i>
                            <span class="past-night-check-full">aberto para check até 12h</span>
                            <span class="past-night-check-compact">até 12h</span>
                            <button type="button" class="btn-past-night-info" aria-label="Entenda por que a noite anterior fica aberta até 12h" title="Como funciona?">
                                <i data-lucide="circle-alert"></i>
                            </button>
                        </span>`;
                }
                
                header.innerHTML = `
                    <div class="shift-group-title" style="display: flex; align-items: center; flex-wrap: wrap;">
                        <i data-lucide="${iconName}"></i>
                        <span>${title}</span>
                        ${shiftLabelExtra}
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

            // Determina o turno que deve liderar a lista do dia selecionado.
            // Entre 00h e 04h59 a data já mudou: a "Noite" dessa nova data ainda
            // acontecerá mais tarde, por isso a hierarquia começa pela Manhã.
            const getCurrentShift = () => {
                const hour = new Date().getHours();
                if (hour < 5) return "Manhã";
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
                // Ordem fixa para outros dias
                // EXCEÇÃO: Se for a manhã do dia seguinte e estivermos visualizando ontem, colocar Noite primeiro!
                if (isPastNightShiftExceptionPeriod) {
                    const nightGroup = groupDefinitions.find(g => g.name === "Noite");
                    if (nightGroup) orderedGroups.push(nightGroup);
                    
                    ["Manhã", "Tarde"].forEach(shiftName => {
                        const group = groupDefinitions.find(g => g.name === shiftName);
                        if (group) orderedGroups.push(group);
                    });
                } else {
                    ["Manhã", "Tarde", "Noite"].forEach(shiftName => {
                        const group = groupDefinitions.find(g => g.name === shiftName);
                        if (group) orderedGroups.push(group);
                    });
                }
            }

            const semTurnoGroup = groupDefinitions.find(g => g.name === "Sem Turno / Geral");
            if (semTurnoGroup) orderedGroups.push(semTurnoGroup);

            // Renderiza na ordem de prioridade
            orderedGroups.forEach(group => {
                renderGroup(group.name, group.icon, group.tasks);
            });
        } else {
            // Categorias específicas permanecem em uma lista plana, sem
            // subtítulos, mas seguem a cronologia natural do dia.
            const getChronologicalShiftRank = (task) => {
                const shifts = (task.context && Array.isArray(task.context.turnos))
                    ? task.context.turnos
                    : [];
                if (shifts.includes("Manhã")) return 0;
                if (shifts.includes("Tarde")) return 1;
                if (shifts.includes("Noite")) return 2;
                return 3;
            };

            const categoryChronologicalTasks = [...filteredTasks].sort((a, b) => {
                const shiftDifference = getChronologicalShiftRank(a) - getChronologicalShiftRank(b);
                if (shiftDifference !== 0) return shiftDifference;
                if (!isEditMode && a.completed !== b.completed) return a.completed ? 1 : -1;
                return getTaskOrder(a) - getTaskOrder(b);
            });

            categoryChronologicalTasks.forEach(task => {
                tasksListEl.appendChild(createTaskDOMElement(task));
            });
        }
        
        if (openSwipeTaskId) {
            const restoredSwipe = Array.from(tasksListEl.querySelectorAll(".task-item"))
                .find(item => String(item.dataset.id) === openSwipeTaskId);
            if (restoredSwipe) {
                restoredSwipe.classList.add("swiped");
                const foreground = restoredSwipe.querySelector(".task-item-foreground");
                if (foreground) {
                    foreground.style.transition = "none";
                    foreground.style.transform = "translateX(-136px)";
                }
            }
        }

        if (protectedPushFocusId) {
            const restoredFocus = Array.from(tasksListEl.querySelectorAll(".task-item"))
                .find(item => String(item.dataset.id) === protectedPushFocusId);
            if (restoredFocus) restoredFocus.classList.add("shared-task-focus");
        }

        lucide.createIcons();
    }
    renderCompletionAnimationTaskId = null;
}

function updateTrainingProgressMode() {
    const block = document.querySelector(".compact-progress-block");
    if (!block) return;
    const trainingSelected = currentFilter !== "all" && isTrainingCategory(currentFilter);
    if (trainingSelected && block.classList.contains("completed")) block.dataset.progressWasCompleted = "true";
    block.classList.toggle("training-report-mode", trainingSelected);
    if (trainingSelected) block.classList.remove("completed");
    else if (block.dataset.progressWasCompleted === "true") {
        block.classList.add("completed");
        delete block.dataset.progressWasCompleted;
    }
    if (trainingSelected) {
        block.querySelector(".training-report-shortcut")?.setAttribute("aria-hidden", "false");
    } else {
        block.querySelector(".training-report-shortcut")?.setAttribute("aria-hidden", "true");
    }
    if (window.lucide) window.lucide.createIcons();
}

function showCategoryOnboardingSlide(index) {
    const slides = Array.from(document.querySelectorAll(".category-onboarding-slide"));
    const dots = Array.from(document.querySelectorAll(".category-onboarding-dots span"));
    if (!slides.length) return;
    categoryOnboardingSlide = ((index % slides.length) + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => slide.classList.toggle("active", slideIndex === categoryOnboardingSlide));
    dots.forEach((dot, dotIndex) => dot.classList.toggle("active", dotIndex === categoryOnboardingSlide));
}

function updateCategoryOnboardingPlayback(shouldPlay) {
    if (!shouldPlay) {
        if (categoryOnboardingTimer) clearInterval(categoryOnboardingTimer);
        categoryOnboardingTimer = null;
        categoryOnboardingSlide = 0;
        return;
    }
    showCategoryOnboardingSlide(categoryOnboardingSlide);
    if (!categoryOnboardingTimer) {
        categoryOnboardingTimer = setInterval(() => showCategoryOnboardingSlide(categoryOnboardingSlide + 1), 3200);
    }
}

function updateTaskCreationOnboarding() {
    if (!taskCreationOnboarding) return;
    const hasActiveTask = (allActiveTasks || []).some(task => task.is_active !== false);
    const shouldShow = categories.length > 0 && !hasActiveTask && !isHistoryMode;
    taskCreationOnboarding.hidden = !shouldShow;
    document.body.classList.toggle("task-onboarding-visible", shouldShow);
}

function getTaskReminderDateTime(task, occurrenceDate = selectedDate) {
    const reminderTime = task?.context?.reminder_time;
    if (!reminderTime || !occurrenceDate) return null;
    const reminderAt = new Date(`${occurrenceDate}T${reminderTime}:00`);
    if (Number(task.context.reminder_offset_days) === 1) reminderAt.setDate(reminderAt.getDate() - 1);
    return Number.isNaN(reminderAt.getTime()) ? null : reminderAt;
}

function hasPendingTaskReminder(task, occurrenceDate = selectedDate) {
    const important = task?.context?.important === true || task?.context?.important === "true";
    const reminderAt = getTaskReminderDateTime(task, occurrenceDate);
    return important && reminderAt && reminderAt.getTime() > Date.now();
}

function refreshExpiredReminderIndicators() {
    const now = Date.now();
    document.querySelectorAll(".task-reminder-indicator[data-reminder-at]").forEach(indicator => {
        if (Number(indicator.dataset.reminderAt) <= now) indicator.remove();
    });
}

// Cria e configura o elemento DOM de um card de tarefa reutilizável
function createTaskDOMElement(task) {
    const taskEl = document.createElement("div");
    const canCheckTask = canCurrentUserCheckTask(task);
    const trainingCollaborative = isTrainingCategory(task.category);
    const trainingViewOnly = trainingCollaborative && !isTrainingTaskOwnedByCurrentUser(task);
    const trainingOwnerEmail = trainingCollaborative ? getTrainingTaskOwnerEmail(task) : "";
    const trainingOwnerLabel = task.context?.creator_label || getIdentityLabelByUserId(task.user_id) || (trainingOwnerEmail ? getIdentityLabel(trainingOwnerEmail) : "Dono da tarefa");
    const trainingOwnerAvatar = getIdentityAvatarByUserId(task.user_id) || getCachedAvatarUrl(task.context?.creator_avatar_url || "") || (trainingOwnerEmail ? getIdentityAvatar(trainingOwnerEmail) : "");
    const trainingOwnerInitials = trainingOwnerLabel.replace("@", "").substring(0, 2).toUpperCase() || "DT";
    const taskDescription = String(task.context?.description || "").trim();
    const reminderAt = getTaskReminderDateTime(task);
    const showReminderIndicator = hasPendingTaskReminder(task);
    
    // Exception for completing night shift tasks of the previous day during the morning (before 12 PM)
    const now = new Date();
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = getLocalDateString(yesterdayDate);
    
    let isPastNightShiftException = false;
    const turnos = (task.context && task.context.turnos) ? task.context.turnos : [];
    if (selectedDate === yesterdayStr && now.getHours() < 12 && turnos.includes("Noite")) {
        isPastNightShiftException = true;
    }
    
    const animateCompletion = task.completed && String(task.id) === String(renderCompletionAnimationTaskId);
    taskEl.className = `task-item ${task.completed ? 'completed' : ''} ${animateCompletion ? 'just-completed' : ''} ${isPastNightShiftException ? 'editable-past-night' : ''} ${canCheckTask ? '' : 'check-locked'} ${taskDescription ? 'has-description' : ''}`;
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
            <div class="task-checkbox-wrapper" ${canCheckTask ? '' : `title="${trainingViewOnly ? 'Somente a pessoa dona desta tarefa de treino pode dar check' : `Somente ${escapeHTML(getIdentityLabel(task.assigned_to))} pode dar check`}" aria-disabled="true"`}>
                <div class="task-checkbox">
                    <i data-lucide="${task.completed || canCheckTask ? 'check' : 'lock-keyhole'}"></i>
                </div>
            </div>
            <div class="task-content">
                <span class="task-title">${escapeHTML(task.title)}</span>
                <div class="task-meta">
                    <span class="task-tag" style="${tagStyle}">${escapeHTML(task.category)}</span>
                    <span class="task-tag" style="background: rgba(255,255,255,0.02);">${getRecurrenceLabel(task)}</span>
                    ${showReminderIndicator ? `
                        <span class="task-reminder-indicator" data-reminder-at="${reminderAt.getTime()}" title="Lembrete programado para ${escapeHTML(task.context.reminder_time)}" aria-label="Lembrete programado para ${escapeHTML(task.context.reminder_time)}">
                            <i data-lucide="alarm-clock"></i>
                        </span>
                    ` : ''}
                    ${task.context && task.context.turnos && task.context.turnos.length > 0 ? task.context.turnos.map(t => {
                        let iconName = 'sun';
                        if (t === 'Tarde') iconName = 'sunset';
                        if (t === 'Noite') iconName = 'moon';
                        return `<span class="task-tag shift-tag" style="background: rgba(139, 92, 246, 0.06); color: var(--primary); font-weight: 700; display: inline-flex; align-items: center; gap: 3px;"><i data-lucide="${iconName}" style="width: 10px; height: 10px;"></i>${escapeHTML(t)}</span>`;
                    }).join('') : ''}
                    ${task.assigned_to && !isTrainingCollaborativeCategory(task.category) ? (() => {
                        const identityLabel = getIdentityLabel(task.assigned_to);
                        const initials = identityLabel.replace('@', '').substring(0, 2).toUpperCase();
                        const avatarUrl = getIdentityAvatar(task.assigned_to);
                        const isMe = currentUser && task.assigned_to.toLowerCase() === currentUser.email.toLowerCase();
                        return `<span class="task-assignee-avatar ${isMe ? '' : 'partner'} ${avatarUrl ? 'has-photo' : ''}" title="Atribuído a: ${escapeHTML(identityLabel)}">${avatarUrl ? `<img src="${escapeHTML(avatarUrl)}" alt="">` : escapeHTML(initials)}</span>`;
                    })() : ''}
                    ${trainingCollaborative ? `<span class="task-assignee-avatar owner ${trainingOwnerAvatar ? 'has-photo' : ''}" title="Tarefa de ${escapeHTML(trainingOwnerLabel)}" aria-label="Tarefa de ${escapeHTML(trainingOwnerLabel)}">${trainingOwnerAvatar ? `<img src="${escapeHTML(trainingOwnerAvatar)}" alt="Foto de ${escapeHTML(trainingOwnerLabel)}" loading="eager" decoding="async" fetchpriority="high">` : escapeHTML(trainingOwnerInitials)}</span>` : ''}
                </div>
            </div>
            ${taskDescription ? `<button type="button" class="task-description-toggle" aria-expanded="false" aria-label="Mostrar descrição" title="Mostrar descrição"><i data-lucide="align-left"></i></button>` : ''}
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
        ${taskDescription ? `<div class="task-description-panel" hidden><p>${escapeHTML(taskDescription)}</p></div>` : ''}
    `;

    const descriptionToggle = taskEl.querySelector(".task-description-toggle");
    const descriptionPanel = taskEl.querySelector(".task-description-panel");
    descriptionToggle?.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        const opening = descriptionPanel.hidden;
        descriptionPanel.hidden = !opening;
        taskEl.classList.toggle("description-open", opening);
        const foreground = taskEl.querySelector(".task-item-foreground");
        if (opening && foreground) taskEl.style.setProperty("--task-actions-center", `${foreground.offsetHeight / 2}px`);
        else taskEl.style.removeProperty("--task-actions-center");
        descriptionToggle.setAttribute("aria-expanded", String(opening));
        descriptionToggle.setAttribute("aria-label", opening ? "Ocultar descrição" : "Mostrar descrição");
        descriptionToggle.title = opening ? "Ocultar descrição" : "Mostrar descrição";
    });

    if (trainingViewOnly) {
        taskEl.classList.add("training-view-only");
        taskEl.querySelectorAll(".task-edit-actions, .task-swipe-actions").forEach(element => { element.style.display = "none"; });
    }

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
    if (!trainingViewOnly) setupSwipeToReveal(taskEl);

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
        if (e.target.closest(".btn-task-action") || e.target.closest(".swipe-action-btn") || e.target.closest(".task-checkbox-wrapper") || e.target.closest(".task-description-toggle") || e.target.closest(".task-description-panel")) return;

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
        beginOptimisticMutation();
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
                    const queuedUpdate = updatesQueue[realId];
                    localStorage.setItem("offline_task_updates_queue", JSON.stringify(updatesQueue));

                    supabaseClient.from('tasks').update(dbUpdates).eq('id', realId)
                        .then(({ error }) => {
                            if (error) {
                                console.warn("Erro ao reordenar tarefa " + realId, error);
                            } else {
                                clearQueuedEntryIfCurrent("offline_task_updates_queue", realId, queuedUpdate);
                            }
                        })
                        .catch(err => console.error("Erro assíncrono ao salvar ordenação:", err));
                }
            });
        }

        // Tenta disparar uma sincronização silenciosa para garantir que o banco seja atualizado se possível
        if (navigator.onLine && typeof syncOfflineDataToCloud === 'function') {
            setTimeout(syncOfflineDataToCloud, 1000);
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
    if (percentage >= 100) {
        progressPercentageEl.classList.add("long-text");
    } else {
        progressPercentageEl.classList.remove("long-text");
    }
    progressTasksCountEl.innerHTML = `${completed} de ${total}<br>concluídos`;

    // Update Linear progress bar
    progressBarFill.style.width = `${percentage}%`;

    // Update Circular progress ring
    const radius = 32;
    const circumference = 2 * Math.PI * radius;
    progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
    
    const offset = circumference - (percentage / 100) * circumference;
    progressCircle.style.strokeDashoffset = offset;

    const compactProgressBlock = document.querySelector(".compact-progress-block");
    if (percentage === 100 && total > 0) {
        progressRingWrapper.classList.add("completed");
        if (compactProgressBlock?.classList.contains("training-report-mode")) {
            compactProgressBlock.dataset.progressWasCompleted = "true";
            compactProgressBlock.classList.remove("completed");
        } else if (compactProgressBlock) compactProgressBlock.classList.add("completed");
    } else {
        progressRingWrapper.classList.remove("completed");
        if (compactProgressBlock) {
            compactProgressBlock.classList.remove("completed");
            compactProgressBlock.dataset.progressWasCompleted = "false";
        }
    }
}

// ----------------------------------------------------
// State Management & Storage
// ----------------------------------------------------
function getCurrentShiftName(date = new Date()) {
    const hour = date.getHours();
    if (hour >= 12 && hour < 18) return "Tarde";
    if (hour >= 18) return "Noite";
    return "Manhã";
}

async function moveFutureTaskToCurrentMoment(id) {
    beginOptimisticMutation();
    const now = new Date();
    const todayStr = getLocalDateString(now);
    const task = tasks.find(item => String(item.id) === String(id)) || allActiveTasks.find(item => String(item.id) === String(id));
    if (!task) return false;
    let context = {};
    if (typeof task.context === "string") {
        try { context = JSON.parse(task.context); } catch (_) { context = {}; }
    } else context = { ...(task.context || {}) };
    context.turnos = [getCurrentShiftName(now)];
    const updates = { created_at: now.toISOString(), context };
    const applyUpdates = item => String(item.id) === String(id) ? { ...item, ...updates, completed: false } : item;
    tasks = tasks.map(applyUpdates);
    allActiveTasks = allActiveTasks.map(applyUpdates);
    const localTasks = (JSON.parse(localStorage.getItem("offline_tasks")) || []).map(applyUpdates);
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
    if (supabaseClient && currentUser && !isTemporaryId(id)) {
        const queue = JSON.parse(localStorage.getItem("offline_task_updates_queue")) || {};
        queue[id] = { ...(queue[id] || {}), ...updates };
        const queuedUpdate = queue[id];
        localStorage.setItem("offline_task_updates_queue", JSON.stringify(queue));
        supabaseClient.from("tasks").update(updates).eq("id", id).then(({ error }) => {
            if (error) return console.warn("A tarefa foi movida para hoje apenas neste aparelho por enquanto:", error.message);
            clearQueuedEntryIfCurrent("offline_task_updates_queue", id, queuedUpdate);
        }).catch(error => console.warn("Não foi possível sincronizar a nova data da tarefa:", error.message));
    }
    selectedDate = todayStr;
    updateDateDisplay();
    loadDataOffline();
    // Uma recorrência planejada para outro dia da semana também precisa
    // aparecer hoje como ocorrência excepcional quando foi realizada agora.
    if (!tasks.some(item => String(item.id) === String(id))) {
        const movedTask = allActiveTasks.find(item => String(item.id) === String(id));
        if (movedTask) tasks.push({ ...movedTask, completed: false });
    }
    renderChecklist();
    updateProgress();
    showAppNotice(`Tarefa movida para hoje, no turno da ${getCurrentShiftName(now)}.`, "success");
    return true;
}

async function toggleTask(id, options = {}) {
    if (options.completeAtCurrentMoment && selectedDate > getLocalDateString(new Date())) {
        const futureTask = tasks.find(item => String(item.id) === String(id)) || allActiveTasks.find(item => String(item.id) === String(id));
        if (futureTask && isTrainingCategory(futureTask.category)) {
            showAppNotice("Tarefas de treino só podem ser finalizadas no dia programado.", "warning");
            return;
        }
        const moved = await moveFutureTaskToCurrentMoment(id);
        if (!moved) return;
    }
    // Exception for completing night shift tasks of the previous day during the morning (before 12 PM)
    const now = new Date();
    const todayStr = getLocalDateString(now);
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = getLocalDateString(yesterdayDate);
    
    let isPastNightShiftException = false;
    let task = tasks.find(t => String(t.id) === String(id));
    if (task?.completed && isTrainingCategory(task.category)) {
        showAppNotice("Um treino finalizado não pode ser desmarcado.", "warning");
        return;
    }
    if (!canCurrentUserCheckTask(task)) {
        showTaskCheckPermissionNotice(task);
        return;
    }
    const turnos = (task && task.context && task.context.turnos) ? task.context.turnos : [];
    
    if (selectedDate === yesterdayStr && now.getHours() < 12 && turnos.includes("Noite")) {
        isPastNightShiftException = true;
    }
    
    if (isHistoryMode && !isPastNightShiftException) return;
    if (pendingToggles.has(id) || pendingTrainingCompletionId !== null) return;

    if (task && !task.completed && isTrainingCategory(task.category)) {
        pendingTrainingCompletionId = id;
        pendingTrainingPastNightException = isPastNightShiftException;
        openModal(modalTrainingPhoto);
        return;
    }
    await commitTaskToggle(id, isPastNightShiftException);
}

async function commitTaskToggle(id, isPastNightShiftException = false) {
    beginOptimisticMutation();
    if (isHistoryMode && !isPastNightShiftException) return;
    if (pendingToggles.has(id)) return;
    pendingToggles.add(id);

    // Toggle local state immediately for visual response
    const wasCompleted = tasks.find(t => String(t.id) === String(id))?.completed === true;
    if (!wasCompleted) pendingCompletionAnimationTaskId = id;
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
    const completionQueueKey = `${id}_${selectedDate}`;
    const queuedCompletion = (JSON.parse(localStorage.getItem("offline_completions_queue")) || {})[completionQueueKey];

    // Se estiver conectado, envia para a nuvem em segundo plano sem bloquear a interface
    if (supabaseClient && currentUser && !isTemporaryId(id)) {
        const query = task.completed
            ? supabaseClient.from('completions').upsert({ task_id: id, date: selectedDate, completed: true }, { onConflict: 'task_id,date' })
            : supabaseClient.from('completions').delete().eq('task_id', id).eq('date', selectedDate);

        query.then(({ error }) => {
            if (error) {
                console.warn("Erro ao salvar conclusão no Supabase. Mantido offline.", error.message);
            } else {
                clearQueuedEntryIfCurrent("offline_completions_queue", completionQueueKey, queuedCompletion);
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

function isTrainingCategory(categoryName) {
    const category = categories.find(cat => cat.name === categoryName);
    const value = `${category?.type || ""} ${category?.name || categoryName || ""}`
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return /(^|\s)(treino|academia|gym|musculacao)(\s|$)/.test(value);
}

async function finishPendingTrainingCompletion(photoDataUrl) {
    const id = pendingTrainingCompletionId;
    if (id === null) return;
    const pendingTask = tasks.find(item => String(item.id) === String(id))
        || allActiveTasks.find(item => String(item.id) === String(id))
        || (JSON.parse(localStorage.getItem("offline_tasks")) || []).find(item => String(item.id) === String(id));
    const pastNightException = pendingTrainingPastNightException;
    const trainingDate = selectedDate;
    pendingTrainingCompletionId = null;
    pendingTrainingPastNightException = false;
    closeModal(modalTrainingPhoto);
    await commitTaskToggle(id, pastNightException);
    const notifyCompletion = taskId => {
        if (pendingTask && (isCollaborativeCategory(pendingTask.category_id) || isTrainingCollaborativeCategory(pendingTask.category))) {
            requestSharedTaskPush(taskId, true, "training_completed", trainingDate);
        }
    };
    if (!photoDataUrl) {
        notifyCompletion(id);
        return;
    }
    const records = await idb.get("training_photo_records") || [];
    const record = { id: `${id}_${trainingDate}_${Date.now()}`, taskId: id, taskTitle: pendingTask?.title || "Treino", category: pendingTask?.category || currentFilter || "Treino", date: trainingDate, photo: photoDataUrl, createdBy: currentUser?.id || null, createdAt: new Date().toISOString() };
    records.unshift(record);
    await idb.put("training_photo_records", records.slice(0, 120));
    updatePendingTrainingPhotoFlag(records.slice(0, 120));
    scheduleTrainingThumbnailCache([record]);
    const uploadResult = await uploadTrainingPhotoRecord(record);
    showAppNotice(uploadResult.ok ? "Foto compartilhada no relatório de treinos." : `Foto salva neste aparelho. Falha na nuvem: ${uploadResult.error}`, uploadResult.ok ? "success" : "warning");
    if (uploadResult.ok) notifyCompletion(record.taskId);
    else scheduleCloudSync("foto-de-treino-pendente", 1200);
}

function updatePendingTrainingPhotoFlag(records) {
    const pendingCount = currentUser
        ? (records || []).filter(record => record.photo && !record.photoPath && String(record.createdBy || "") === String(currentUser.id)).length
        : 0;
    if (pendingCount) localPrefs.setItem("pending_training_photo_uploads", String(pendingCount));
    else localPrefs.removeItem("pending_training_photo_uploads");
    scheduleSyncStatusRefresh();
}

async function uploadTrainingPhotoRecord(record) {
    if (!supabaseClient) return { ok: false, error: "Supabase indisponível" };
    if (!currentUser) return { ok: false, error: "sessão não encontrada" };
    if (!navigator.onLine) return { ok: false, error: "aparelho sem internet" };
    const category = categories.find(cat => cat.name === record.category);
    if (!category) return { ok: false, error: "categoria não encontrada" };
    if (isTemporaryId(category.id)) return { ok: false, error: "categoria ainda não sincronizada" };
    try {
        if (isTemporaryId(record.taskId)) {
            for (let attempt = 0; attempt < 12 && isTemporaryId(record.taskId); attempt++) {
                if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 500));
                const { data: cloudTask, error: lookupError } = await supabaseClient.from("tasks")
                    .select("id")
                    .eq("category_id", category.id)
                    .eq("user_id", currentUser.id)
                    .eq("title", record.taskTitle)
                    .order("created_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();
                if (lookupError) throw lookupError;
                if (cloudTask?.id) record.taskId = cloudTask.id;
            }
            if (isTemporaryId(record.taskId)) throw new Error("A tarefa ainda não terminou de sincronizar.");
        }
        const blob = await (await fetch(record.photo)).blob();
        const safeRecordId = String(record.id).replace(/[^a-zA-Z0-9_-]/g, "-");
        const path = `${category.id}/${currentUser.id}/${safeRecordId}.jpg`;
        const { error: uploadError } = await supabaseClient.storage.from("training-photos").upload(path, blob, { contentType: "image/jpeg", upsert: true });
        if (uploadError) throw new Error(`envio do arquivo: ${uploadError.message}`);
        const { error: metadataError } = await supabaseClient.from("training_photos").upsert({
            id: record.id,
            category_id: category.id,
            task_id: String(record.taskId),
            task_title: record.taskTitle,
            training_date: record.date,
            photo_path: path,
            created_by: currentUser.id,
            creator_label: getIdentityLabel(currentUser.email),
            creator_avatar_url: getIdentityAvatar(currentUser.email) || null
        }, { onConflict: "id" });
        if (metadataError) throw new Error(`registro da foto: ${metadataError.message}`);
        const cachedRecords = await idb.get("training_photo_records") || [];
        const updatedRecords = cachedRecords.map(item => String(item.id) === String(record.id) ? { ...item, taskId: record.taskId, photoPath: path } : item);
        await idb.put("training_photo_records", updatedRecords);
        updatePendingTrainingPhotoFlag(updatedRecords);
        return { ok: true };
    } catch (error) {
        console.warn("A foto do treino ficou apenas no aparelho:", error.message);
        return { ok: false, error: error.message || "erro desconhecido" };
    }
}

async function syncPendingTrainingPhotoUploads() {
    const records = await idb.get("training_photo_records") || [];
    const pending = records.filter(record => record.photo && !record.photoPath && String(record.createdBy || "") === String(currentUser?.id || ""));
    updatePendingTrainingPhotoFlag(records);
    if (!pending.length) return;
    const failures = [];
    for (const record of pending) {
        const result = await uploadTrainingPhotoRecord(record);
        if (result.ok) {
            const task = getTaskById(record.taskId) || allActiveTasks.find(item => item.title === record.taskTitle && item.category === record.category);
            if (task && (isCollaborativeCategory(task.category_id) || isTrainingCollaborativeCategory(task.category))) {
                await requestSharedTaskPush(task.id, true, "training_completed", record.date);
            }
        } else {
            failures.push(result.error);
        }
    }
    if (failures.length) throw new Error(`Fotos pendentes: ${failures[0]}`);
}

async function deleteTrainingPhotosForTask(task) {
    if (!task || !isTrainingCategory(task.category)) return { ok: true };
    const localRecords = await idb.get("training_photo_records") || [];
    const recordsToRemove = localRecords.filter(record => String(record.taskId) === String(task.id));
    const retainedRecords = localRecords.filter(record => String(record.taskId) !== String(task.id));
    await idb.put("training_photo_records", retainedRecords);
    updatePendingTrainingPhotoFlag(retainedRecords);
    await removeTrainingThumbnailCache(recordsToRemove.map(record => record.id));
    if (!supabaseClient || !currentUser || isTemporaryId(task.id) || !navigator.onLine) {
        return { ok: true, localOnly: true };
    }
    try {
        const { data, error: lookupError } = await supabaseClient.from("training_photos")
            .select("id,photo_path")
            .eq("task_id", String(task.id));
        if (lookupError) throw lookupError;
        const paths = (data || []).map(item => item.photo_path).filter(Boolean);
        const { data: deletedRows, error: metadataError } = await supabaseClient.from("training_photos")
            .delete()
            .eq("task_id", String(task.id))
            .select("id");
        if (metadataError) throw metadataError;
        if ((data || []).length && !(deletedRows || []).length) {
            throw new Error("a permissão do Supabase não autorizou excluir o registro da foto");
        }
        if (paths.length) {
            const { error: storageError } = await supabaseClient.storage.from("training-photos").remove(paths);
            if (storageError) throw storageError;
        }
        await removeTrainingThumbnailCache((data || []).map(item => item.id));
        return { ok: true, removed: Math.max(recordsToRemove.length, (data || []).length) };
    } catch (error) {
        console.warn("A tarefa foi excluída, mas a foto não pôde ser removida da nuvem:", error.message);
        return { ok: false, error: error.message || "erro desconhecido" };
    }
}

async function deleteTrainingCompletionsForTask(task) {
    if (!task || !isTrainingCategory(task.category)) return { ok: true };
    const taskId = String(task.id);
    const localCompletions = JSON.parse(localStorage.getItem("offline_completions")) || [];
    localStorage.setItem("offline_completions", JSON.stringify(
        localCompletions.filter(item => String(item.task_id) !== taskId)
    ));
    const completionQueue = JSON.parse(localStorage.getItem("offline_completions_queue")) || {};
    Object.keys(completionQueue).forEach(key => {
        if (key.startsWith(`${taskId}_`)) delete completionQueue[key];
    });
    localStorage.setItem("offline_completions_queue", JSON.stringify(completionQueue));
    if (!supabaseClient || !currentUser || isTemporaryId(task.id) || !navigator.onLine) {
        return { ok: true, localOnly: true };
    }
    const { error } = await supabaseClient.from("completions").delete().eq("task_id", task.id);
    return error ? { ok: false, error: error.message } : { ok: true };
}

let trainingOrphanCleanupPromise = null;
async function cleanupOrphanedTrainingPhotos() {
    if (trainingOrphanCleanupPromise) return trainingOrphanCleanupPromise;
    trainingOrphanCleanupPromise = (async () => {
        const cachedTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
        const activeTaskIds = new Set(cachedTasks.filter(task => task.is_active !== false).map(task => String(task.id)));
        const localRecords = await idb.get("training_photo_records") || [];
        await idb.put("training_photo_records", localRecords.filter(record => activeTaskIds.has(String(record.taskId))));

        if (!supabaseClient || !currentUser || !navigator.onLine) return;
        const { data: ownPhotos, error: photoError } = await supabaseClient.from("training_photos")
            .select("id,task_id,photo_path")
            .eq("created_by", currentUser.id);
        if (photoError) throw photoError;
        if (!ownPhotos?.length) return;

        const taskIds = [...new Set(ownPhotos.map(photo => String(photo.task_id)).filter(Boolean))];
        const { data: linkedTasks, error: taskError } = taskIds.length
            ? await supabaseClient.from("tasks").select("id,is_active").in("id", taskIds)
            : { data: [], error: null };
        if (taskError) throw taskError;
        const activeCloudTaskIds = new Set((linkedTasks || []).filter(task => task.is_active !== false).map(task => String(task.id)));
        const orphanedPhotos = ownPhotos.filter(photo => !activeCloudTaskIds.has(String(photo.task_id)));
        if (!orphanedPhotos.length) return;

        const orphanIds = orphanedPhotos.map(photo => photo.id);
        const orphanPaths = orphanedPhotos.map(photo => photo.photo_path).filter(Boolean);
        const { error: metadataError } = await supabaseClient.from("training_photos").delete().in("id", orphanIds);
        if (metadataError) throw metadataError;
        if (orphanPaths.length) {
            const { error: storageError } = await supabaseClient.storage.from("training-photos").remove(orphanPaths);
            if (storageError) throw storageError;
        }
        console.log(`[Treino] ${orphanedPhotos.length} foto(s) antiga(s) sem tarefa foram removidas.`);
    })().catch(error => {
        console.warn("Não foi possível limpar fotos antigas sem tarefa:", error.message);
    }).finally(() => {
        trainingOrphanCleanupPromise = null;
    });
    return trainingOrphanCleanupPromise;
}

async function getTrainingPhotoRecords(categoryName = null) {
    cleanupOrphanedTrainingPhotos();
    const allLocalRecords = await idb.get("training_photo_records") || [];
    const localRecords = currentUser ? allLocalRecords.filter(record => String(record.createdBy || "") === String(currentUser.id)) : [];
    const filteredLocal = categoryName ? localRecords.filter(record => record.category === categoryName) : localRecords;
    if (!supabaseClient || !currentUser || !navigator.onLine) return filteredLocal;
    const visibleCategories = categories.filter(category => isTrainingCategory(category.name) && (!categoryName || normalizeCategoryName(category.name) === normalizeCategoryName(categoryName)));
    const visibleCategoryIds = [...new Set(visibleCategories.flatMap(category => category.merged_category_ids || [category.id]).filter(id => !isTemporaryId(id)))];
    if (!visibleCategoryIds.length) return filteredLocal;
    try {
        const categoryNameById = new Map(visibleCategories.flatMap(category =>
            (category.merged_category_ids || [category.id]).map(id => [String(id), category.name])
        ));
        const { data: feedData, error: feedError } = await supabaseClient.functions.invoke("training-photo-feed", {
            body: { category_ids: visibleCategoryIds }
        });
        if (!feedError && Array.isArray(feedData?.photos)) {
            const cloudRecords = feedData.photos.map(item => ({
                id: item.id, taskId: item.task_id, taskTitle: item.task_title || "Treino",
                category: categoryNameById.get(String(item.category_id)) || "Treino",
                date: item.training_date, photo: item.signed_url, createdBy: item.created_by,
                creatorLabel: item.creator_label, creatorAvatar: item.creator_avatar_url, createdAt: item.created_at
            })).filter(record => record.photo);
            const merged = new Map(cloudRecords.map(record => [String(record.id), record]));
            filteredLocal.forEach(record => { if (!merged.has(String(record.id))) merged.set(String(record.id), record); });
            const result = [...merged.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
            saveTrainingPhotoFeedCache(result);
            prefetchRecentTrainingPhotos(result);
            return result;
        }
        if (feedError) console.warn("Leitura protegida de fotos indisponível; tentando acesso direto:", feedError.message);
        const { data, error } = await supabaseClient.from("training_photos")
            .select("id,category_id,task_id,task_title,training_date,photo_path,created_by,creator_label,creator_avatar_url,created_at")
            .in("category_id", visibleCategoryIds)
            .order("created_at", { ascending: false });
        if (error) throw error;
        const photoTaskIds = [...new Set((data || []).map(item => String(item.task_id)).filter(Boolean))];
        const { data: linkedPhotoTasks, error: linkedTasksError } = photoTaskIds.length
            ? await supabaseClient.from("tasks").select("id,is_active").in("id", photoTaskIds)
            : { data: [], error: null };
        if (linkedTasksError) throw linkedTasksError;
        const activeTaskIds = new Set((linkedPhotoTasks || []).filter(task => task.is_active !== false).map(task => String(task.id)));
        const visiblePhotoRows = (data || []).filter(item => activeTaskIds.has(String(item.task_id)));
        const paths = visiblePhotoRows.map(item => item.photo_path);
        const signedByPath = new Map();
        if (paths.length) {
            const { data: signed, error: signedError } = await supabaseClient.storage.from("training-photos").createSignedUrls(paths, 3600);
            if (signedError) throw signedError;
            (signed || []).forEach(item => signedByPath.set(item.path, item.signedUrl));
        }
        const cloudRecords = visiblePhotoRows.map(item => ({
            id: item.id,
            taskId: item.task_id,
            taskTitle: item.task_title || "Treino",
            category: categoryNameById.get(String(item.category_id)) || "Treino",
            date: item.training_date,
            photo: signedByPath.get(item.photo_path),
            createdBy: item.created_by,
            creatorLabel: item.creator_label,
            creatorAvatar: item.creator_avatar_url,
            createdAt: item.created_at
        })).filter(record => record.photo);
        const merged = new Map(cloudRecords.map(record => [String(record.id), record]));
        filteredLocal.forEach(record => { if (!merged.has(String(record.id))) merged.set(String(record.id), record); });
        const result = [...merged.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
        saveTrainingPhotoFeedCache(result);
        prefetchRecentTrainingPhotos(result);
        return result;
    } catch (error) {
        console.warn("Não foi possível carregar fotos compartilhadas de treino:", error.message);
        return filteredLocal;
    }
}

function compressTrainingPhoto(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error("Não foi possível abrir a foto."));
            image.onload = () => {
                const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(image.width * scale);
                canvas.height = Math.round(image.height * scale);
                canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL("image/jpeg", .78));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function getTrainingCompletionDates(categoryName = null) {
    const trainingTaskIds = new Set(allActiveTasks
        .filter(task =>
            isTrainingCategory(task.category)
            && (!categoryName || normalizeCategoryName(task.category) === normalizeCategoryName(categoryName))
            && isTrainingTaskOwnedByCurrentUser(task)
        )
        .map(task => String(task.id)));
    return new Set((JSON.parse(localStorage.getItem("offline_completions")) || [])
        .filter(item => item.completed === true && trainingTaskIds.has(String(item.task_id)))
        .map(item => item.date));
}

function isTrainingRecordOwnedByCurrentUser(record) {
    if (!record || !currentUser) return false;
    if (record.createdBy) return String(record.createdBy) === String(currentUser.id);
    const linkedTask = allActiveTasks.find(task => String(task.id) === String(record.taskId));
    return Boolean(linkedTask && isTrainingTaskOwnedByCurrentUser(linkedTask));
}

function getCurrentTrainingStreak(dates) {
    let streak = 0;
    const cursor = new Date();
    cursor.setHours(12, 0, 0, 0);
    if (!dates.has(getLocalDateString(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (dates.has(getLocalDateString(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
    return streak;
}

function getTrainingRecordOwner(record) {
    if (record.creatorLabel) return { label: record.creatorLabel, avatar: getCachedAvatarUrl(record.creatorAvatar || "") };
    const task = allActiveTasks.find(item => String(item.id) === String(record.taskId));
    const email = task ? getTrainingTaskOwnerEmail(task) : "";
    if (email) return { label: getIdentityLabel(email), avatar: getIdentityAvatar(email) };
    if (currentUser && String(record.createdBy || "") === String(currentUser.id)) {
        return { label: getIdentityLabel(currentUser.email), avatar: getIdentityAvatar(currentUser.email) };
    }
    return { label: "Participante", avatar: "" };
}

function renderTrainingDayGallery(dateStr) {
    const heading = document.getElementById("training-day-gallery-heading");
    const list = document.getElementById("training-report-list");
    if (!heading || !list) return;
    const records = currentTrainingCalendarRecords.filter(record => record.date === dateStr);
    const dateLabel = new Date(dateStr + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
    heading.innerHTML = `<div><span>REGISTROS DO DIA</span><strong>${escapeHTML(dateLabel)}</strong></div><b>${records.length} ${records.length === 1 ? "foto" : "fotos"}</b>`;
    list.innerHTML = records.length ? records.map(record => {
        const owner = getTrainingRecordOwner(record);
        const initials = owner.label.replace("@", "").substring(0, 2).toUpperCase() || "P";
        return `<article class="training-day-photo-card"><img class="training-day-photo" data-training-photo-id="${escapeHTML(String(record.id))}" src="${record.photo}" alt="Foto do treino de ${escapeHTML(owner.label)}" title="Ampliar foto"><div class="training-day-photo-caption"><span class="task-assignee-avatar ${owner.avatar ? 'has-photo' : ''}">${owner.avatar ? `<img src="${escapeHTML(owner.avatar)}" alt="">` : escapeHTML(initials)}</span><div><strong>${escapeHTML(owner.label)}</strong><small>${escapeHTML(record.taskTitle)}</small></div></div></article>`;
    }).join("") : `<div class="training-report-empty compact"><i data-lucide="camera-off"></i><strong>Nenhuma foto neste dia</strong><span>O fogo indica que houve treino, mesmo sem registro fotográfico.</span></div>`;
    document.querySelectorAll(".training-calendar-day").forEach(day => day.classList.toggle("selected", day.dataset.date === dateStr));
    renderTrainingSelectedDayInfo(dateStr, records);
    list.querySelectorAll(".training-day-photo[data-training-photo-id]").forEach(image => image.addEventListener("click", () => {
        const record = currentTrainingCalendarRecords.find(item => String(item.id) === String(image.dataset.trainingPhotoId));
        if (record) openTrainingPhotoViewer(record);
    }));
    lucide.createIcons();
}

function renderTrainingSelectedDayInfo(dateStr, records) {
    const info = document.getElementById("training-selected-day-info");
    if (!info) return;
    const trained = records.length > 0 || getTrainingCompletionDates(currentFilter !== "all" ? currentFilter : null).has(dateStr);
    if (!trained) { info.hidden = true; return; }
    const owners = new Map();
    records.forEach(record => {
        const owner = getTrainingRecordOwner(record);
        if (!owners.has(owner.label)) owners.set(owner.label, owner);
    });
    const avatars = [...owners.values()].map(owner => {
        const initials = owner.label.replace("@", "").substring(0, 2).toUpperCase() || "P";
        return `<span class="task-assignee-avatar ${owner.avatar ? "has-photo" : ""}" title="${escapeHTML(owner.label)}">${owner.avatar ? `<img src="${escapeHTML(owner.avatar)}" alt="" loading="eager" decoding="async" fetchpriority="high">` : escapeHTML(initials)}</span>`;
    }).join("");
    const count = records.length;
    info.innerHTML = `<strong>${count || 1} ${count === 1 ? "treino realizado" : "treinos realizados"}</strong><span class="training-selected-day-avatars">${avatars}</span>`;
    info.hidden = false;
}

function openTrainingPhotoViewer(record) {
    const owner = getTrainingRecordOwner(record);
    const dateLabel = new Date(record.date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
    const viewer = document.createElement("div");
    viewer.className = "training-photo-viewer";
    viewer.innerHTML = `<div class="training-photo-viewer-backdrop"></div><article class="training-photo-viewer-card" role="dialog" aria-modal="true" aria-label="Foto do treino"><button type="button" class="training-photo-viewer-close" aria-label="Fechar"><i data-lucide="x"></i></button><img src="${escapeHTML(record.photo)}" alt="Foto do treino de ${escapeHTML(owner.label)}"><footer class="training-photo-viewer-caption"><div><strong>${escapeHTML(owner.label)} · ${escapeHTML(record.taskTitle)}</strong><span>${escapeHTML(dateLabel)}</span></div></footer></article>`;
    document.body.appendChild(viewer);
    if (window.lucide) window.lucide.createIcons();
    const close = () => { viewer.classList.remove("visible"); document.removeEventListener("keydown", onKey); setTimeout(() => viewer.remove(), 210); };
    const onKey = event => { if (event.key === "Escape") close(); };
    viewer.querySelector(".training-photo-viewer-close").addEventListener("click", close);
    viewer.querySelector(".training-photo-viewer-backdrop").addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => viewer.classList.add("visible"));
}

async function renderTrainingReport() {
    const categoryName = currentFilter !== "all" && isTrainingCategory(currentFilter) ? currentFilter : null;
    if (!currentTrainingCalendarRecords.length) currentTrainingCalendarRecords = getTrainingPhotoFeedCache();
    currentTrainingCalendarRecords = currentTrainingCalendarRecords.filter(record => !categoryName || normalizeCategoryName(record.category) === normalizeCategoryName(categoryName));
    currentTrainingCalendarRecords = await applyPersistentTrainingThumbnails(currentTrainingCalendarRecords);
    paintTrainingReport(categoryName);
    const refreshedRecords = await getTrainingPhotoRecords(categoryName);
    const currentById = new Map(currentTrainingCalendarRecords.map(record => [String(record.id), record]));
    const stableRecords = refreshedRecords.map(record => {
        const current = currentById.get(String(record.id));
        // O Supabase gera uma URL assinada diferente a cada consulta. Enquanto a
        // foto for o mesmo registro, mantemos a URL que o navegador já carregou.
        return current?.photo ? { ...record, photo: current.photo, thumbnail: current.thumbnail || record.thumbnail } : record;
    });
    const signature = records => records.map(record => [
        String(record.id), String(record.taskId), record.date, record.taskTitle,
        record.createdBy, record.creatorLabel, record.creatorAvatar
    ].join("|")).sort().join("\n");
    if (signature(stableRecords) === signature(currentTrainingCalendarRecords)) return;
    currentTrainingCalendarRecords = stableRecords;
    paintTrainingReport(categoryName);
}

function getTrainingPhotoFeedCache() {
    if (!currentUser) return [];
    try {
        const cached = JSON.parse(localStorage.getItem(`training_photo_feed_${currentUser.id}`)) || {};
        if (!cached.savedAt || Date.now() - cached.savedAt > 50 * 60 * 1000) return [];
        return Array.isArray(cached.records) ? cached.records : [];
    } catch (_) {
        return [];
    }
}

function saveTrainingPhotoFeedCache(records) {
    if (!currentUser) return;
    const lightweightRecords = records.slice(0, 120).map(record => ({
        id: record.id, taskId: record.taskId, taskTitle: record.taskTitle, category: record.category,
        date: record.date, photo: record.photo, createdBy: record.createdBy, creatorLabel: record.creatorLabel,
        creatorAvatar: record.creatorAvatar, createdAt: record.createdAt
    }));
    localStorage.setItem(`training_photo_feed_${currentUser.id}`, JSON.stringify({ savedAt: Date.now(), records: lightweightRecords }));
    cachePriorityAvatars(records.map(record => record.creatorAvatar));
    scheduleTrainingThumbnailCache(records);
}

function getTrainingThumbnailCacheKey() {
    return currentUser ? `training_photo_thumbnails_${currentUser.id}` : "";
}

async function applyPersistentTrainingThumbnails(records) {
    const key = getTrainingThumbnailCacheKey();
    if (!key || !records.length) return records;
    try {
        const cache = await idb.get(key) || {};
        return records.map(record => cache[String(record.id)]?.dataUrl
            ? { ...record, thumbnail: cache[String(record.id)].dataUrl }
            : record);
    } catch (_) {
        return records;
    }
}

function createTrainingThumbnail(photoUrl) {
    return new Promise(async (resolve, reject) => {
        try {
            const response = await fetch(photoUrl);
            if (!response.ok) throw new Error("foto indisponível");
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const image = new Image();
            image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("miniatura inválida")); };
            image.onload = () => {
                const scale = Math.min(1, 360 / Math.max(image.width, image.height));
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(objectUrl);
                resolve(canvas.toDataURL("image/jpeg", .68));
            };
            image.src = objectUrl;
        } catch (error) {
            reject(error);
        }
    });
}

function scheduleTrainingThumbnailCache(records) {
    if (!currentUser || !Array.isArray(records) || !records.length || trainingThumbnailCacheJob) return;
    const cacheKey = getTrainingThumbnailCacheKey();
    const snapshot = records.filter(record => record.id && record.photo).slice(0, 180);
    const run = async () => {
        if (!cacheKey) return;
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - 1);
        const cutoffDate = getLocalDateString(cutoff);
        const existing = await idb.get(cacheKey) || {};
        const retained = Object.fromEntries(Object.entries(existing)
            .filter(([, item]) => item?.date >= cutoffDate)
            .sort((a, b) => String(b[1].savedAt || "").localeCompare(String(a[1].savedAt || "")))
            .slice(0, 180));
        let created = 0;
        for (const record of snapshot) {
            const id = String(record.id);
            if (retained[id]?.dataUrl) continue;
            if (created >= 12) break;
            try {
                retained[id] = { dataUrl: await createTrainingThumbnail(record.photo), date: record.date, savedAt: new Date().toISOString() };
                created++;
            } catch (_) { /* A foto completa continua disponível pela nuvem. */ }
        }
        if (created || Object.keys(retained).length !== Object.keys(existing).length) await idb.put(cacheKey, retained);
    };
    const start = () => {
        trainingThumbnailCacheJob = run().catch(error => console.warn("Não foi possível guardar miniaturas:", error.message))
            .finally(() => { trainingThumbnailCacheJob = null; });
    };
    trainingThumbnailCacheJob = { scheduled: true };
    if ("requestIdleCallback" in window) window.requestIdleCallback(start, { timeout: 2500 });
    else setTimeout(start, 1200);
}

async function removeTrainingThumbnailCache(ids) {
    const key = getTrainingThumbnailCacheKey();
    if (!key || !ids.length) return;
    try {
        const cache = await idb.get(key) || {};
        ids.forEach(id => delete cache[String(id)]);
        await idb.put(key, cache);
    } catch (_) { /* limpeza não deve impedir a exclusão da tarefa */ }
}

function prefetchRecentTrainingPhotos(records) {
    const monthPrefix = getLocalDateString(new Date()).slice(0, 7);
    const recentPhotos = records.filter(record => record.photo && String(record.date || "").startsWith(monthPrefix)).slice(0, 6);
    const prefetch = () => recentPhotos.forEach(record => {
        const image = new Image();
        image.decoding = "async";
        image.src = record.photo;
    });
    if ("requestIdleCallback" in window) window.requestIdleCallback(prefetch, { timeout: 2200 });
    else setTimeout(prefetch, 900);
}

async function warmTrainingPhotoCache() {
    if (!supabaseClient || !currentUser || !navigator.onLine || !categories.some(category => isTrainingCategory(category.name))) return;
    const records = await getTrainingPhotoRecords();
    currentTrainingCalendarRecords = records;
}

function paintTrainingReport(categoryName) {
    const dates = getTrainingCompletionDates(categoryName);
    currentTrainingCalendarRecords
        .filter(isTrainingRecordOwnedByCurrentUser)
        .forEach(record => dates.add(record.date));
    const summary = document.getElementById("training-report-summary");
    const grid = document.getElementById("training-calendar-grid");
    const monthYear = document.getElementById("training-calendar-month-year");
    if (!summary || !grid || !monthYear) return;
    const year = currentTrainingCalendarMonth.getFullYear();
    const month = currentTrainingCalendarMonth.getMonth();
    const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    monthYear.textContent = `${monthNames[month]} ${year}`;
    grid.innerHTML = "";
    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();
    for (let i = 0; i < firstDayIndex; i++) grid.insertAdjacentHTML("beforeend", '<span class="training-calendar-day-spacer"></span>');
    const todayStr = getLocalDateString(new Date());
    let initialGalleryDate = "";
    let firstTrainedDate = "";
    for (let day = 1; day <= lastDay; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const dayRecords = currentTrainingCalendarRecords.filter(record => record.date === dateStr);
        const trained = dates.has(dateStr);
        const button = document.createElement("button");
        button.type = "button";
        button.className = `training-calendar-day ${trained ? "trained" : ""} ${dayRecords.length ? "has-photos" : ""} ${dateStr === todayStr ? "today" : ""}`;
        button.dataset.date = dateStr;
        const participantPhotos = [];
        const participantKeys = new Set();
        dayRecords.forEach(record => {
            const owner = getTrainingRecordOwner(record);
            const key = String(record.createdBy || owner.label);
            if (!participantKeys.has(key) && (record.thumbnail || record.photo)) {
                participantKeys.add(key);
                participantPhotos.push(record.thumbnail || record.photo);
            }
        });
        const hasTwoParticipants = participantPhotos.length > 1;
        const calendarPhoto = participantPhotos[0] || dayRecords[0]?.thumbnail || dayRecords[0]?.photo;
        if (calendarPhoto && !hasTwoParticipants) button.style.setProperty("background-image", `linear-gradient(rgba(8,12,22,.18),rgba(8,12,22,.52)),url("${calendarPhoto}")`, "important");
        const additionalCount = hasTwoParticipants ? Math.max(0, dayRecords.length - 2) : Math.max(0, dayRecords.length - 1);
        button.innerHTML = `${hasTwoParticipants ? '<i class="training-calendar-participant-photos" aria-label="Fotos de dois participantes"><u></u><u></u></i>' : ''}<span>${day}</span>${trained ? '<b aria-label="Treino realizado">🔥</b>' : ''}${additionalCount ? `<em>+${additionalCount}</em>` : ''}`;
        if (hasTwoParticipants) {
            button.querySelectorAll(".training-calendar-participant-photos > u").forEach((photo, index) => {
                photo.style.backgroundImage = `url("${participantPhotos[index]}")`;
            });
        }
        button.addEventListener("click", () => renderTrainingDayGallery(dateStr));
        grid.appendChild(button);
        if (!initialGalleryDate && dayRecords.length) initialGalleryDate = dateStr;
        if (!firstTrainedDate && trained) firstTrainedDate = dateStr;
    }
    const participantCount = new Set(currentTrainingCalendarRecords.map(record => record.createdBy || getTrainingRecordOwner(record).label)).size;
    const recordCount = currentTrainingCalendarRecords.length;
    summary.classList.toggle("no-own-training", dates.size === 0);
    summary.innerHTML = `${dates.size ? '<span aria-label="Seus dias de treino">🔥</span>' : ''}<strong>${dates.size} ${dates.size === 1 ? "dia" : "dias"} de treino • ${participantCount} ${participantCount === 1 ? "participante" : "participantes"} • ${recordCount} ${recordCount === 1 ? "registro" : "registros"}</strong>`;
    renderTrainingDayGallery(initialGalleryDate || firstTrainedDate || todayStr);
    lucide.createIcons();
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

async function addTask(title, category, recurrenceMode, customDate, repeatDays, assignedTo, shifts, important = false, reminderTime = null, reminderOffsetDays = 0, description = "") {
    if (!title) return;
    beginOptimisticMutation();
    if (isTrainingCollaborativeCategory(category)) {
        assignedTo = null;
    }
    const isRecurring = recurrenceMode !== "once";
    const tempId = Date.now();
    
    // Evita problemas de fuso horário definindo a data ao meio-dia
    const createdAtDate = customDate ? new Date(customDate + "T12:00:00") : new Date();
    const createdAt = createdAtDate.toISOString();

    const context = analyzeTaskContext(title, category, tasks) || {};
    // Identificador estável permite recuperar a mesma criação se a internet
    // cair depois do insert, mas antes de o aparelho receber a resposta.
    context.sync_token = context.sync_token || `task-${currentUser?.id || "local"}-${tempId}`;
    if (shifts && shifts.length > 0) {
        context.turnos = shifts;
    }
    if (description && description.trim()) context.description = description.trim();
    if (important) {
        context.important = true;
        context.reminder_time = reminderTime || addTaskReminderTime;
        context.reminder_offset_days = reminderTime ? (Number(reminderOffsetDays) === 1 ? 1 : 0) : addTaskReminderOffsetDays;
        context.reminder_timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
    }
    if (currentUser) {
        context.creator_user_id = currentUser.id;
        context.creator_label = getIdentityLabel(currentUser.email) || currentUser.email?.split("@")[0] || "Participante";
        context.creator_avatar_url = getIdentityAvatarByUserId(currentUser.id) || getIdentityAvatar(currentUser.email) || "";
    }
    console.log(`%c[Motor de Contexto] Tarefa: "${title}" na guia "${category}"`, "color: #8b5cf6; font-weight: bold;", context);

    const newTask = {
        title: title,
        category: category,
        is_recurring: isRecurring,
        is_active: true,
        created_at: createdAt
    };
    const selectedCategory = categories.find(cat => cat.name === category);
    if (selectedCategory && !isTemporaryId(selectedCategory.id)) newTask.category_id = selectedCategory.id;
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

    // Toda criação usa o mesmo coordenador. Isso elimina a corrida entre o
    // insert direto e a fila offline quando a conexão oscila.
    scheduleCloudSync("nova-tarefa", 80);
}

async function insertTaskWithCategoryFallback(taskPayload) {
    let result = await supabaseClient.from('tasks').insert(taskPayload).select();
    if (result.error && taskPayload.category_id && /category_id|schema cache/i.test(result.error.message || "")) {
        const legacyPayload = { ...taskPayload };
        delete legacyPayload.category_id;
        console.warn("A migração de colaboração ainda não foi aplicada; salvando a tarefa no formato antigo.");
        result = await supabaseClient.from('tasks').insert(legacyPayload).select();
    }
    return result;
}

function isCollaborativeCategory(categoryId) {
    if (!categoryId) return false;
    const category = categories.find(item =>
        String(item.id) === String(categoryId)
        || (item.merged_category_ids || []).some(id => String(id) === String(categoryId))
    );
    const relatedIds = new Set((category?.merged_category_ids || [categoryId]).map(String));
    return (categoryShares || []).some(share => relatedIds.has(String(share.category_id)) && share.accepted === true);
}

function isTrainingCollaborativeCategory(categoryName) {
    const category = categories.find(cat => cat.name === categoryName);
    return Boolean(category && isTrainingCategory(category.name) && isCollaborativeCategory(category.id));
}

function canManageTrainingCollaborativeCategory(categoryName) {
    const category = categories.find(cat => cat.name === categoryName);
    if (!category || !currentUser) return false;
    if (String(category.user_id || "") === String(currentUser.id)) return true;
    const myEmail = normalizeAccountEmail(currentUser.email);
    const participantShare = (categoryShares || []).find(share =>
        (category.merged_category_ids || [category.id]).some(id => String(share.category_id) === String(id))
        && normalizeAccountEmail(share.collaborator_email) === myEmail
        && share.accepted === true
    );
    return !participantShare;
}

async function requestSharedTaskPush(taskId, silent = false, eventType = "training_created", trainingDate = null) {
    if (!supabaseClient || !taskId) return false;
    try {
        const { data, error } = await supabaseClient.functions.invoke("send-task-push", { body: { task_id: taskId, event_type: eventType, training_date: trainingDate } });
        if (error) throw error;
        const sent = Number(data && data.sent || 0);
        const recipients = Number(data && data.recipients || 0);
        const subscriptions = Number(data && data.subscriptions || 0);
        if (sent > 0) return true;
        if (!silent) {
            if (recipients === 0) {
                showAppNotice("A tarefa foi criada, mas nenhum colaborador aceito foi encontrado para receber o push.", "warning");
            } else if (subscriptions === 0) {
                showAppNotice("A tarefa foi compartilhada, mas o aparelho do destinatário ainda não está registrado para notificações push. Ele precisa ativar Notificações nas Configurações do app.", "warning");
            } else {
                showAppNotice("A tarefa foi compartilhada, mas o serviço push não confirmou a entrega ao aparelho.", "warning");
            }
        }
        return false;
    } catch (error) {
        console.warn("A tarefa foi salva, mas o push não pôde ser enviado:", error.message);
        if (!silent) showAppNotice(`Tarefa salva, mas o push falhou: ${error.message}`, "warning");
        return false;
    }
}

async function addTaskOffline(title, category, isRecurring, id, createdAt, repeatDays, context, assignedTo) {
    beginOptimisticMutation();
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
    beginOptimisticMutation();
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
        const queuedUpdate = updatesQueue[id];
        localStorage.setItem("offline_task_updates_queue", JSON.stringify(updatesQueue));

        supabaseClient.from('tasks').update(updates).eq('id', id)
            .then(({ error }) => {
                if (error) {
                    console.warn("Erro ao renomear no Supabase. Mantido localmente.", error.message);
                } else {
                    clearQueuedEntryIfCurrent("offline_task_updates_queue", id, queuedUpdate);
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
    beginOptimisticMutation();
    const existingTask = tasks.find(t => String(t.id) === String(id));
    if (existingTask && isTrainingCategory(existingTask.category)) {
        if (!isTrainingTaskOwnedByCurrentUser(existingTask)) {
            showAppNotice("Somente o dono pode editar esta tarefa de treino.", "warning");
            return;
        }
        updates.assigned_to = null;
    }
    
    // Analyze new context if title is being updated
    if (updates.title !== undefined) {
        const category = existingTask ? existingTask.category : "";
        const nlpContext = analyzeTaskContext(updates.title, category, tasks) || {};
        
        // Get existing context
        let existingContext = {};
        if (existingTask && existingTask.context) {
            if (typeof existingTask.context === 'string') {
                try {
                    existingContext = JSON.parse(existingTask.context);
                } catch (e) {
                    existingContext = {};
                }
            } else {
                existingContext = { ...existingTask.context };
            }
        }
        
        // Mescla o contexto existente, o contexto atualizado enviado no updates, e o nlpContext analisado
        updates.context = { ...existingContext, ...(updates.context || {}), ...nlpContext };
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
        const queuedUpdate = updatesQueue[id];
        localStorage.setItem("offline_task_updates_queue", JSON.stringify(updatesQueue));

        supabaseClient.from('tasks').update(dbUpdates).eq('id', id)
            .then(({ error }) => {
                if (error) {
                    console.warn("Erro ao atualizar tarefa no Supabase. Mantido localmente.", error.message);
                } else {
                    clearQueuedEntryIfCurrent("offline_task_updates_queue", id, queuedUpdate);
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
    if (isTrainingCategory(task.category) && !isTrainingTaskOwnedByCurrentUser(task)) {
        showAppNotice("Somente o dono pode editar esta tarefa de treino.", "warning");
        return;
    }
    
    document.getElementById("edit-task-id").value = task.id;
    document.getElementById("edit-task-title").value = task.title;
    const descriptionInput = document.getElementById("edit-task-description");
    const descriptionGroup = document.getElementById("edit-task-description-group");
    const descriptionButton = document.getElementById("btn-edit-task-description");
    const taskDescription = String(task.context?.description || "");
    if (descriptionInput) descriptionInput.value = taskDescription;
    if (descriptionGroup) descriptionGroup.hidden = true;
    if (descriptionButton) {
        descriptionButton.hidden = false;
        const label = descriptionButton.querySelector("span");
        if (label) label.textContent = taskDescription ? "Ver descrição" : "Adicionar descrição";
    }
    
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
    const taskDate = (task && task.created_at) ? extractDateFromTimestamp(task.created_at) : selectedDate;
    editDate.value = taskDate;

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
        editTaskReminderTime = task.context && task.context.reminder_time ? task.context.reminder_time : getCurrentReminderTime();
        editTaskReminderOffsetDays = task.context && Number(task.context.reminder_offset_days) === 1 ? 1 : 0;
        updateTaskReminderSummary("edit", chkEditImp.checked, editTaskReminderTime, editTaskReminderOffsetDays);
    }
    
    openModal(modalEditTask);
    lucide.createIcons();
}

async function deleteTask(id) {
    beginOptimisticMutation();
    const existingTask = tasks.find(task => String(task.id) === String(id));
    if (existingTask && isTrainingCategory(existingTask.category) && !isTrainingTaskOwnedByCurrentUser(existingTask)) {
        showAppNotice("Somente o dono pode excluir esta tarefa de treino.", "warning");
        return;
    }
    const taskId = String(id);
    if ([...pendingDeletes].some(pendingId => String(pendingId) === taskId)) return;
    pendingDeletes.add(taskId);

    // 1. ATUALIZAÇÃO OTIMISTA LOCAL IMEDIATA
    tasks = tasks.filter(t => String(t.id) !== String(id));
    allActiveTasks = allActiveTasks.filter(t => String(t.id) !== String(id));
    
    // Salva no LocalStorage
    deleteTaskOffline(id);

    let updatesQueue = JSON.parse(localStorage.getItem("offline_task_updates_queue")) || {};
    updatesQueue[taskId] = { ...(updatesQueue[taskId] || {}), is_active: false };
    const queuedDeletion = updatesQueue[taskId];
    localStorage.setItem("offline_task_updates_queue", JSON.stringify(updatesQueue));

    renderChecklist();
    updateProgress();

    // Fotos e conclusões são limpas em paralelo; nenhuma dessas operações pode
    // atrasar ou desfazer a remoção visual do cartão.
    const cleanupPromise = Promise.all([
        deleteTrainingPhotosForTask(existingTask),
        deleteTrainingCompletionsForTask(existingTask)
    ]).then(([photoDeletion, completionDeletion]) => {
        if (!photoDeletion.ok) showAppNotice(`Tarefa removida deste aparelho, mas a foto ainda aguarda exclusão na nuvem: ${photoDeletion.error}`, "warning");
        if (!completionDeletion.ok) showAppNotice(`Tarefa removida deste aparelho, mas o histórico de conclusão ainda aguarda exclusão na nuvem: ${completionDeletion.error}`, "warning");
    }).catch(error => console.warn("Limpeza complementar da tarefa pendente:", error.message));

    // 2. ENVIAR PARA O SUPABASE EM SEGUNDO PLANO
    if (supabaseClient && currentUser) {
        // Mantém a ordem segura na nuvem (fotos antes da tarefa), mas toda a
        // sequência ocorre fora do caminho de renderização da interface.
        cleanupPromise.then(() => supabaseClient.from('tasks').update({ is_active: false }).eq('id', id))
            .then(({ error }) => {
                if (error) {
                    console.warn("Erro ao deletar no Supabase. Mantido localmente.", error.message);
                } else {
                    clearQueuedEntryIfCurrent("offline_task_updates_queue", taskId, queuedDeletion);
                }
                pendingDeletes.delete(taskId);
            })
            .catch(err => {
                console.error("Erro assíncrono ao deletar:", err);
                pendingDeletes.delete(taskId);
            });
    } else {
        pendingDeletes.delete(taskId);
    }
}

function deleteTaskOffline(id) {
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    localTasks = localTasks.map(t => {
        if (String(t.id) === String(id)) return { ...t, is_active: false, local_deleted_at: new Date().toISOString() };
        return t;
    });
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
    // Não chama loadDataOffline nem render aqui — deleteTask já faz isso
}

async function excludeTaskForToday(id) {
    const existingTask = tasks.find(task => String(task.id) === String(id));
    if (existingTask && isTrainingCategory(existingTask.category) && !isTrainingTaskOwnedByCurrentUser(existingTask)) {
        showAppNotice("Somente o dono pode alterar esta tarefa de treino.", "warning");
        return;
    }
    beginOptimisticMutation();
    const taskId = String(id);
    const actionDate = selectedDate;
    if ([...pendingDeletes].some(pendingId => String(pendingId) === taskId)) return;
    pendingDeletes.add(taskId);

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
            date: actionDate,
            completed: false
        }, { onConflict: 'task_id,date' })
            .then(({ error }) => {
                if (error) {
                    console.warn("Erro ao excluir do dia no Supabase. Mantido localmente.", error.message);
                } else {
                    clearQueuedEntryIfCurrent("offline_completions_queue", `${taskId}_${actionDate}`, "excluded");
                }
                pendingDeletes.delete(taskId);
            })
            .catch(err => {
                console.error("Erro assíncrono ao excluir do dia:", err);
                pendingDeletes.delete(taskId);
            });
    } else {
        pendingDeletes.delete(taskId);
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
    let queue = JSON.parse(localStorage.getItem("offline_completions_queue")) || {};
    queue[`${id}_${selectedDate}`] = "excluded";
    localStorage.setItem("offline_completions_queue", JSON.stringify(queue));
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
    const overlay = modal.querySelector(".modal-overlay");
    if (!content) return;

    let startY = 0;
    let startX = 0;
    let currentY = 0;
    let lastY = 0;
    let lastMoveAt = 0;
    let velocityY = 0;
    let isDragging = false;
    let directionLocked = false;
    let animationFrame = 0;

    const clearGestureStyles = () => {
        cancelAnimationFrame(animationFrame);
        content.classList.remove("is-swipe-dragging");
        content.style.removeProperty("transform");
        content.style.removeProperty("transition");
        overlay?.style.removeProperty("opacity");
        overlay?.style.removeProperty("transition");
    };

    const renderDrag = distance => {
        cancelAnimationFrame(animationFrame);
        animationFrame = requestAnimationFrame(() => {
            content.style.transform = `translate3d(0, ${distance}px, 0)`;
            if (overlay) {
                const progress = Math.min(distance / Math.max(content.offsetHeight, 1), 0.75);
                overlay.style.opacity = String(1 - progress * 0.72);
            }
        });
    };
    
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
        
        // O gesto de fechar começa somente no cabeçalho/alça. Iniciá-lo em
        // qualquer ponto quando a lista está no topo faz o Safari capturar o
        // primeiro movimento e, de forma intermitente, perder o scroll nativo.
        const touchedHeader = e.target.closest(".modal-header") || (e.touches[0].clientY - content.getBoundingClientRect().top < 60);
        
        if (touchedHeader) {
            startY = e.touches[0].clientY;
            startX = e.touches[0].clientX;
            currentY = startY;
            lastY = startY;
            lastMoveAt = performance.now();
            velocityY = 0;
            isDragging = true;
            directionLocked = false;
            content.classList.add("is-swipe-dragging");
            content.style.transition = "none";
            if (overlay) overlay.style.transition = "none";
        }
    }, { passive: true });

    content.addEventListener("touchmove", (e) => {
        if (!isDragging) return;
        currentY = e.touches[0].clientY;
        const currentX = e.touches[0].clientX;
        const diffY = currentY - startY;
        const diffX = currentX - startX;

        if (!directionLocked && Math.max(Math.abs(diffY), Math.abs(diffX)) > 8) {
            if (Math.abs(diffX) > Math.abs(diffY) || diffY < 0) {
                isDragging = false;
                clearGestureStyles();
                return;
            }
            directionLocked = true;
        }
        if (!directionLocked) return;

        const now = performance.now();
        const elapsed = Math.max(now - lastMoveAt, 1);
        velocityY = velocityY * 0.65 + ((currentY - lastY) / elapsed) * 0.35;
        lastY = currentY;
        lastMoveAt = now;
        
        if (diffY < 0) {
            isDragging = false;
            clearGestureStyles();
            return;
        }
        if (e.cancelable) e.preventDefault();
        renderDrag(diffY);
    }, { passive: false });

    const finishGesture = cancelled => {
        if (!isDragging) return;
        isDragging = false;
        cancelAnimationFrame(animationFrame);
        const distance = Math.max(0, currentY - startY);
        const shouldClose = !cancelled && (distance > Math.min(120, content.offsetHeight * 0.22) || (distance > 34 && velocityY > 0.55));
        content.classList.remove("is-swipe-dragging");

        if (shouldClose) {
            const remaining = Math.max(content.offsetHeight - distance, 0);
            const duration = Math.max(150, Math.min(260, remaining / Math.max(velocityY, 1.2)));
            content.style.transition = `transform ${duration}ms cubic-bezier(.22,.8,.3,1)`;
            if (overlay) overlay.style.transition = `opacity ${duration}ms ease-out`;
            requestAnimationFrame(() => {
                content.style.transform = "translate3d(0, calc(100dvh + 40px), 0)";
                if (overlay) overlay.style.opacity = "0";
            });
            setTimeout(() => {
                closeModal(modal);
                clearGestureStyles();
            }, duration);
        } else {
            content.style.transition = "transform 220ms cubic-bezier(.2,.85,.25,1)";
            if (overlay) overlay.style.transition = "opacity 180ms ease-out";
            content.style.transform = "translate3d(0, 0, 0)";
            if (overlay) overlay.style.opacity = "1";
            setTimeout(() => {
                clearGestureStyles();
            }, 230);
        }
    };

    content.addEventListener("touchend", () => finishGesture(false), { passive: true });
    content.addEventListener("touchcancel", () => finishGesture(true), { passive: true });
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
        <span style="font-size:0.85rem; font-weight:700; color:var(--text-secondary);">${escapeHTML(isOwner ? `@${currentUsername}` : getIdentityLabel(categoryShares.find(share => String(share.category_id) === String(cat.id))?.owner_email || ''))} (Criador)</span>
    `;
    collaboratorsList.appendChild(ownerItem);
    
    // Lista os colaboradores da categoria
    const shares = categoryShares.filter(s => String(s.category_id) === String(cat.id) && s.accepted === true);
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
            <span style="font-size:0.85rem; font-weight:600; color:var(--text-primary);">${escapeHTML(getIdentityLabel(share.collaborator_email))}</span>
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

    if (!navigator.onLine) {
        const queue = JSON.parse(localStorage.getItem("offline_collaboration_invites_queue")) || [];
        const identifier = normalizeUserIdentifier(email.replace(/^@/, ""));
        if (!queue.some(item => String(item.category_id) === String(catId) && item.identifier === identifier)) {
            queue.push({ category_id: catId, category_name: cat.name, identifier, queued_at: new Date().toISOString() });
        }
        localStorage.setItem("offline_collaboration_invites_queue", JSON.stringify(queue));
        if (inputCollabEmail) inputCollabEmail.value = "";
        showAppNotice("Convite salvo neste celular, mas ainda não enviado. Para a outra pessoa receber, este celular precisa recuperar a internet e sincronizar o app.", "warning");
        scheduleSyncStatusRefresh();
        return;
    }
    
    const enteredIdentity = email.includes("@") && !email.trim().startsWith("@")
        ? normalizeAccountEmail(email)
        : normalizeUserIdentifier(email.replace(/^@/, ""));
    let cleanEmail = enteredIdentity;
    if (!enteredIdentity.includes("@")) {
        const { data: resolvedEmail, error: resolveError } = await supabaseClient.rpc("resolve_collaboration_email", { identifier: enteredIdentity });
        if (resolveError || !resolvedEmail) {
            alert("Nenhuma conta foi encontrada com esse ID.");
            return;
        }
        cleanEmail = resolvedEmail;
    }
    
    // Evita convidar a si mesmo ou convidar duplicado
    if (normalizeAccountEmail(cleanEmail) === normalizeAccountEmail(currentUser.email)) {
        alert("Você já é o dono e participa desta guia.");
        return;
    }
    
    requestCollaborationNotificationPermission();
    
    if (btn) {
        btn.disabled = true;
        btn.textContent = "Convidando...";
    }
    
    try {
        // O ID guardado pelo PWA pode ficar obsoleto após uma categoria ser
        // excluída/recriada. Confirma sempre a categoria real antes do convite.
        let remoteCategory = null;
        let remoteCategoryError = null;

        // IDs temporários são timestamps locais. Nunca os envia como filtro de
        // uma coluna UUID/bigint no banco, pois a consulta falharia antes da
        // recuperação pelo nome ou da criação da categoria real.
        if (!isTemporaryId(catId)) {
            const remoteById = await supabaseClient
                .from("categories")
                .select("*")
                .eq("id", catId)
                .eq("user_id", currentUser.id)
                .maybeSingle();
            remoteCategory = remoteById.data;
            remoteCategoryError = remoteById.error;
        }

        if (!remoteCategory && !remoteCategoryError) {
            const fallbackResult = await supabaseClient
                .from("categories")
                .select("*")
                .eq("user_id", currentUser.id)
                .ilike("name", cat.name.trim())
                .order("id", { ascending: false })
                .limit(1)
                .maybeSingle();
            remoteCategory = fallbackResult.data;
            remoteCategoryError = fallbackResult.error;
            if (remoteCategory && remoteCategory.is_active === false) {
                const reactivatedResult = await supabaseClient
                    .from("categories")
                    .update({ is_active: true })
                    .eq("id", remoteCategory.id)
                    .select()
                    .single();
                remoteCategory = reactivatedResult.data;
                remoteCategoryError = reactivatedResult.error;
            }
        }
        if (remoteCategoryError) throw remoteCategoryError;
        if (!remoteCategory) {
            // Se a criação otimista ainda estiver apenas no aparelho, conclui a
            // sincronização aqui e continua o convite com o ID real retornado.
            try {
                remoteCategory = await insertOwnedCategoryInCloud({ name: cat.name, type: cat.type });
                updateLocalCatId(catId, remoteCategory);
                refreshSyncStatusFromQueues();
            } catch (categorySyncError) {
                throw new Error(`Não foi possível sincronizar a categoria antes do convite: ${categorySyncError.message}`);
            }
        }

        const realCategoryId = remoteCategory.id;
        if (String(realCategoryId) !== String(catId)) {
            updateLocalCatId(catId, remoteCategory);
            if (collabCategoryId) collabCategoryId.value = realCategoryId;
        }

        const exists = categoryShares.some(share =>
            String(share.category_id) === String(realCategoryId)
            && normalizeAccountEmail(share.collaborator_email) === normalizeAccountEmail(cleanEmail)
        );
        if (exists) throw new Error("Este ID já foi convidado para esta categoria.");

        const newShare = {
            category_id: realCategoryId,
            owner_id: currentUser.id,
            owner_email: currentUser.email,
            collaborator_email: cleanEmail
        };
        const { data: createdShares, error } = await supabaseClient
            .from('category_shares')
            .insert(newShare)
            .select("id");
        if (error) throw error;

        const createdInvite = createdShares && createdShares[0];
        if (createdInvite) {
            supabaseClient.functions.invoke("send-task-push", { body: { invite_id: createdInvite.id } })
                .then(({ error: pushError }) => {
                    if (pushError) console.warn("Convite salvo, mas o push não pôde ser enviado:", pushError.message);
                })
                .catch(pushError => console.warn("Erro ao solicitar push do convite:", pushError));
        }
        
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
    
    if (await showAppConfirm("Deseja realmente remover este colaborador da categoria?", { title: "Remover colaborador", confirmText: "Remover", danger: true })) {
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
                            <strong>${escapeHTML(invite.owner_email ? getIdentityLabel(invite.owner_email) : 'Um usuário')}</strong> convidou você para compartilhar a guia <strong>${escapeHTML(invite.category_name || 'Compartilhada')}</strong>.
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
                await acceptInvitation(invite.id, true);
            });

            btnDecline.addEventListener("click", async () => {
                btnDecline.disabled = true;
                btnDecline.textContent = "...";
                await declineInvitation(invite.id);
            });

            item.addEventListener("click", async event => {
                if (event.target.closest("button")) return;
                const shouldAccept = await showAppConfirm(`Aceitar o convite e abrir a categoria “${invite.category_name || "Compartilhada"}”?`, { title: "Abrir categoria", confirmText: "Aceitar e abrir" });
                if (shouldAccept) await acceptInvitation(invite.id, true);
            });
            item.style.cursor = "pointer";

            notificationsListContainer.appendChild(item);
        });
    }

    // 2. Tarefas recebidas em categorias compartilhadas
    (sharedTaskNotifications || []).forEach(notification => {
        const item = document.createElement("div");
        const isUnread = !notification.read_at;
        const createdAt = notification.created_at ? new Date(notification.created_at) : null;
        const timeLabel = createdAt && !Number.isNaN(createdAt.getTime())
            ? createdAt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
            : "";
        item.className = `shared-task-notification-item ${isUnread ? "unread" : ""}`;
        const trainingNotification = isTrainingCategory(notification.category_name);
        item.innerHTML = `
            <div class="shared-task-notification-icon"><i data-lucide="list-checks"></i></div>
            <div class="shared-task-notification-copy">
                <strong>${trainingNotification ? `${escapeHTML((getIdentityLabelByUserId(notification.actor_id) || "Participante").replace(/^@/, ""))} adicionou um novo treino` : "Nova tarefa compartilhada"}</strong>
                <span>“${escapeHTML(notification.task_title || (trainingNotification ? "Treino" : "Nova tarefa"))}” foi adicionad${trainingNotification ? "o" : "a"}${notification.category_name ? ` em <b>${escapeHTML(notification.category_name)}</b>` : ""}.${trainingNotification ? " Somente para visualização." : ""}</span>
                ${notification.assigned_to ? `<small>Atribuída a ${escapeHTML(getIdentityLabel(notification.assigned_to))}${timeLabel ? ` • ${escapeHTML(timeLabel)}` : ""}</small>` : (timeLabel ? `<small>${escapeHTML(timeLabel)}</small>` : "")}
            </div>
        `;
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");
        item.title = "Abrir esta tarefa no checklist";
        const openTask = () => focusSharedTaskFromNotification(notification);
        item.addEventListener("click", openTask);
        item.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openTask();
            }
        });
        notificationsListContainer.appendChild(item);
    });

    // 3. Renderizar notificações estáticas do sistema
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

function findRenderedTaskElement(taskId) {
    return Array.from(tasksListEl.querySelectorAll(".task-item"))
        .find(item => String(item.dataset.id) === String(taskId)) || null;
}

function highlightRenderedTask(taskId) {
    const taskElement = findRenderedTaskElement(taskId);
    if (!taskElement) return false;
    taskElement.scrollIntoView({ behavior: "smooth", block: "center" });
    activePushFocusTaskId = String(taskId);
    activePushFocusUntil = Date.now() + 2500;
    taskElement.classList.remove("shared-task-focus");
    void taskElement.offsetWidth;
    taskElement.classList.add("shared-task-focus");
    setTimeout(() => {
        const currentTaskElement = findRenderedTaskElement(taskId);
        if (currentTaskElement) currentTaskElement.classList.remove("shared-task-focus");
        if (String(activePushFocusTaskId) === String(taskId)) {
            activePushFocusTaskId = null;
            activePushFocusUntil = 0;
        }
    }, 2500);
    return true;
}

async function primeTaskFromPush(taskId) {
    if (!taskId) return null;
    let targetTask = (allActiveTasks || []).find(task => String(task.id) === String(taskId)) || null;
    if (supabaseClient && currentUser) {
        const { data } = await supabaseClient.from("tasks").select("*").eq("id", taskId).maybeSingle();
        if (data) targetTask = data;
    }
    if (!targetTask) return null;

    const cachedTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    const taskIndex = cachedTasks.findIndex(task => String(task.id) === String(targetTask.id));
    if (taskIndex >= 0) cachedTasks[taskIndex] = targetTask;
    else cachedTasks.push(targetTask);
    localStorage.setItem("offline_tasks", JSON.stringify(cachedTasks));

    if (targetTask.category_id && supabaseClient && currentUser) {
        const cachedCategories = JSON.parse(localStorage.getItem("offline_categories")) || [];
        if (!cachedCategories.some(category => String(category.id) === String(targetTask.category_id))) {
            const { data: targetCategory } = await supabaseClient.from("categories").select("*").eq("id", targetTask.category_id).maybeSingle();
            if (targetCategory) {
                cachedCategories.push(targetCategory);
                localStorage.setItem("offline_categories", JSON.stringify(cachedCategories));
            }
        }
    }

    selectedDate = extractDateFromTimestamp(targetTask.created_at);
    currentFilter = "all";
    loadDataOffline();
    updateDateDisplay();
    renderCategories();
    renderChecklist();
    updateProgress();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    highlightRenderedTask(taskId);
    return targetTask;
}

async function focusSharedTaskFromNotification(notification) {
    if (!notification || !notification.task_id) return;
    closeModal(modalNotifications);
    currentFilter = "all";
    renderCategories();
    renderChecklist();

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (highlightRenderedTask(notification.task_id)) return;

    let targetTask = await primeTaskFromPush(notification.task_id);

    if (targetTask && targetTask.created_at) {
        selectedDate = extractDateFromTimestamp(targetTask.created_at);
        updateDateDisplay();
        loadDataOffline();
        renderCategories();
        renderChecklist();
        updateProgress();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (highlightRenderedTask(notification.task_id)) {
            // Revalida o restante somente depois do destaque, sem atrasar nem
            // substituir o cartão que acabou de aparecer.
            setTimeout(() => loadChecklistAndProgress().catch(error => console.warn("Revalidação após push indisponível:", error)), 2200);
            return;
        }
    }

    // Tarefas pendentes não recorrentes podem ter rolado para o dia atual.
    selectedDate = getLocalDateString(new Date());
    updateDateDisplay();
    loadChecklistAndProgress().then(() => highlightRenderedTask(notification.task_id));
}

async function refreshTrainingPushDay(taskId, trainingDate, categoryName = null) {
    if (!supabaseClient || !currentUser || !navigator.onLine) return false;
    const visibleCategories = categories.filter(category => isTrainingCategory(category.name) && (!categoryName || normalizeCategoryName(category.name) === normalizeCategoryName(categoryName)));
    const categoryIds = [...new Set(visibleCategories.flatMap(category => category.merged_category_ids || [category.id]).filter(id => !isTemporaryId(id)))];
    if (!categoryIds.length) return false;
    const categoryNameById = new Map(visibleCategories.flatMap(category => (category.merged_category_ids || [category.id]).map(id => [String(id), category.name])));
    try {
        const { data, error } = await supabaseClient.functions.invoke("training-photo-feed", {
            body: { category_ids: categoryIds, task_id: taskId || null, training_date: trainingDate }
        });
        if (error || !Array.isArray(data?.photos)) throw new Error(error?.message || "Fotos indisponíveis");
        const pushedRecords = data.photos.map(item => ({
            id: item.id, taskId: item.task_id, taskTitle: item.task_title || "Treino",
            category: categoryNameById.get(String(item.category_id)) || categoryName || "Treino",
            date: item.training_date, photo: item.signed_url, createdBy: item.created_by,
            creatorLabel: item.creator_label, creatorAvatar: item.creator_avatar_url, createdAt: item.created_at
        })).filter(record => record.photo);
        const merged = new Map([...getTrainingPhotoFeedCache(), ...currentTrainingCalendarRecords].map(record => [String(record.id), record]));
        pushedRecords.forEach(record => merged.set(String(record.id), record));
        currentTrainingCalendarRecords = [...merged.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
        saveTrainingPhotoFeedCache(currentTrainingCalendarRecords);
        paintTrainingReport(categoryName);
        renderTrainingDayGallery(trainingDate);
        return true;
    } catch (error) {
        console.warn("Não foi possível priorizar a foto aberta pelo push:", error.message);
        return false;
    }
}

async function openTrainingCalendarFromPush(taskId, trainingDate) {
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(String(trainingDate || ""))
        ? String(trainingDate)
        : getLocalDateString(new Date());
    let targetTask = taskId ? getTaskById(taskId) : null;
    const trainingCategory = targetTask && isTrainingCategory(targetTask.category)
        ? targetTask.category
        : categories.find(category => isTrainingCategory(category.name))?.name;
    if (trainingCategory) currentFilter = trainingCategory;
    selectedDate = validDate;
    currentTrainingCalendarMonth = new Date(`${validDate}T12:00:00`);
    updateDateDisplay();
    loadDataOffline();
    renderCategories();
    renderChecklist();
    updateProgress();
    currentTrainingCalendarRecords = getTrainingPhotoFeedCache();
    openModal(modalTrainingReport);
    paintTrainingReport(trainingCategory || null);
    renderTrainingDayGallery(validDate);
    if (appSessionLoader) appSessionLoader.classList.add("hidden");
    setAppContainerVisible(true);

    // Miniaturas persistentes entram sem bloquear a abertura do modal.
    applyPersistentTrainingThumbnails(currentTrainingCalendarRecords).then(records => {
        currentTrainingCalendarRecords = records;
        if (!modalTrainingReport?.classList.contains("active")) return;
        paintTrainingReport(trainingCategory || null);
        renderTrainingDayGallery(validDate);
    }).catch(() => {});

    const targetedLoaded = await refreshTrainingPushDay(taskId, validDate, trainingCategory || null);
    if (!targetedLoaded) renderTrainingReport().then(() => renderTrainingDayGallery(validDate));
    if (!targetTask && taskId) {
        primeTaskFromPush(taskId).then(task => {
            if (!task || !isTrainingCategory(task.category) || !modalTrainingReport?.classList.contains("active")) return;
            currentFilter = task.category;
            renderCategories();
            paintTrainingReport(task.category);
            renderTrainingDayGallery(validDate);
        }).catch(() => {});
    }
}

function getTaskById(taskId) {
    return (allActiveTasks || []).find(task => String(task.id) === String(taskId))
        || (tasks || []).find(task => String(task.id) === String(taskId))
        || null;
}

async function updateTaskReminderContext(taskId, updater) {
    let task = getTaskById(taskId);
    if (!task && supabaseClient && currentUser) {
        const { data } = await supabaseClient.from("tasks").select("*").eq("id", taskId).maybeSingle();
        task = data || null;
    }
    if (!task) throw new Error("Tarefa não encontrada.");

    let context = task.context || {};
    if (typeof context === "string") {
        try { context = JSON.parse(context); } catch (_) { context = {}; }
    }
    context = updater({ ...context });
    task.context = context;
    renderChecklist();

    if (!supabaseClient || !currentUser || !navigator.onLine || isTemporaryId(taskId)) {
        const queue = JSON.parse(localStorage.getItem("offline_task_updates_queue")) || {};
        queue[taskId] = { ...(queue[taskId] || {}), context };
        localStorage.setItem("offline_task_updates_queue", JSON.stringify(queue));
        return;
    }
    const { error } = await supabaseClient.from("tasks").update({ context }).eq("id", taskId);
    if (error) throw error;
}

async function openTaskReminderAction(taskId) {
    focusSharedTaskFromNotification({ task_id: taskId });
    const task = getTaskById(taskId);
    const snoozeDefault = new Date(Date.now() + 30 * 60 * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false });
    const layer = document.createElement("div");
    layer.className = "task-reminder-action-layer";
    layer.innerHTML = `<div class="task-reminder-action-backdrop"></div><div class="task-reminder-action-card" role="dialog" aria-modal="true"><span class="task-reminder-action-icon"><i data-lucide="alarm-clock"></i></span><small>Lembrete de tarefa</small><h3>${escapeHTML(task ? task.title : "Hora da sua tarefa")}</h3><p>Quer começar agora ou prefere receber um novo lembrete?</p><div class="task-reminder-action-buttons"><button type="button" class="btn task-reminder-do-now"><i data-lucide="check"></i><span><strong>Vou fazer agora</strong><small>Encerrar este lembrete</small></span></button><button type="button" class="btn btn-primary task-reminder-snooze"><i data-lucide="clock-3"></i><span><strong>Adiar lembrete</strong><small>Escolher outro horário</small></span></button></div><div class="task-reminder-snooze-panel" hidden><strong>Adiar por quanto tempo?</strong><div class="task-reminder-snooze-presets"><button type="button" data-minutes="10">+10 min</button><button type="button" data-minutes="30" class="selected">+30 min</button><button type="button" data-minutes="60">+1 hora</button></div><label>Escolher horário<input type="time" class="task-reminder-snooze-time" value="${snoozeDefault}"></label><button type="button" class="btn btn-primary task-reminder-snooze-save">Salvar novo horário</button></div></div>`;
    document.body.appendChild(layer);
    requestAnimationFrame(() => layer.classList.add("visible"));
    if (window.lucide) lucide.createIcons();

    const close = () => { layer.classList.remove("visible"); setTimeout(() => layer.remove(), 220); };
    layer.querySelector(".task-reminder-do-now").addEventListener("click", async () => {
        const button = layer.querySelector(".task-reminder-do-now");
        button.disabled = true;
        try {
            await updateTaskReminderContext(taskId, context => {
                context.important = false;
                delete context.reminder_time;
                delete context.reminder_offset_days;
                delete context.reminder_timezone;
                return context;
            });
            close();
            showAppNotice("Lembrete encerrado. Esta tarefa não enviará outro aviso.", "success");
        } catch (error) {
            button.disabled = false;
            showAppNotice(`Não foi possível encerrar o lembrete: ${error.message}`, "error");
        }
    });
    const snoozePanel = layer.querySelector(".task-reminder-snooze-panel");
    const snoozeInput = layer.querySelector(".task-reminder-snooze-time");
    layer.querySelector(".task-reminder-snooze").addEventListener("click", () => {
        snoozePanel.hidden = false;
        layer.querySelector(".task-reminder-action-buttons").hidden = true;
        snoozeInput.focus();
    });
    layer.querySelectorAll(".task-reminder-snooze-presets button").forEach(button => button.addEventListener("click", () => {
        const date = new Date(Date.now() + Number(button.dataset.minutes) * 60 * 1000);
        snoozeInput.value = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false });
        layer.querySelectorAll(".task-reminder-snooze-presets button").forEach(item => item.classList.toggle("selected", item === button));
    }));
    snoozeInput.addEventListener("input", () => layer.querySelectorAll(".task-reminder-snooze-presets button").forEach(item => item.classList.remove("selected")));
    layer.querySelector(".task-reminder-snooze-save").addEventListener("click", async () => {
        const reminderTime = snoozeInput.value;
        const [hours, minutes] = reminderTime.split(":").map(Number);
        const scheduledAt = new Date();
        scheduledAt.setHours(hours, minutes, 0, 0);
        if (!reminderTime || scheduledAt.getTime() <= Date.now()) {
            showAppNotice("Escolha um horário posterior ao atual para adiar.", "warning");
            return;
        }
        try {
            await updateTaskReminderContext(taskId, context => {
                context.important = true;
                context.reminder_time = reminderTime;
                context.reminder_offset_days = 0;
                context.reminder_timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
                return context;
            });
            close();
            showAppNotice(`Novo lembrete programado para ${reminderTime}.`, "success");
        } catch (error) {
            showAppNotice(`Não foi possível adiar o lembrete: ${error.message}`, "error");
        }
    });
}

async function acceptInvitation(shareId, openCategory = false) {
    if (!supabaseClient) return;
    requestCollaborationNotificationPermission();
    try {
        const invite = pendingInvites.find(item => String(item.id) === String(shareId));
        const { error } = await supabaseClient
            .from('category_shares')
            .update({ accepted: true })
            .eq('id', shareId);

        if (error) throw error;

        alert("Convite aceito! A guia compartilhada agora está disponível.");
        await loadChecklistAndProgress();
        if (openCategory && invite) {
            const category = categories.find(item => String(item.id) === String(invite.category_id));
            if (category) {
                closeModal(modalNotifications);
                currentFilter = category.name;
                renderCategories();
                renderChecklist();
                requestAnimationFrame(() => document.querySelector(`.category-chip[data-category="${CSS.escape(category.name)}"]`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }));
            }
        }
        renderNotifications();
    } catch (err) {
        console.error("Erro ao aceitar convite:", err);
        alert("Erro ao aceitar convite: " + err.message);
    }
}

async function promptCollaborationInviteNavigation(inviteId) {
    await loadChecklistAndProgress();
    const invite = pendingInvites.find(item => String(item.id) === String(inviteId));
    if (!invite) {
        renderNotifications();
        openModal(modalNotifications);
        return;
    }
    const shouldAccept = await showAppConfirm(`Aceitar o convite e abrir a categoria “${invite.category_name || "Compartilhada"}”?`, { title: "Convite de colaboração", confirmText: "Aceitar e abrir" });
    if (shouldAccept) await acceptInvitation(invite.id, true);
}

function requestCollaborationNotificationPermission() {
    if (areNotificationsEnabled() && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
    }
}

async function declineInvitation(shareId) {
    if (!supabaseClient) return;
    if (await showAppConfirm("Deseja realmente recusar este convite?", { title: "Recusar convite", confirmText: "Recusar", danger: true })) {
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

    // Categorias colaborativas de treino nunca distribuem responsabilidade:
    // o criador gerencia as tarefas e os participantes apenas acompanham.
    if (isTrainingCategory(categoryName) && isCollaborativeCategory(cat.id)) {
        groupEl.style.display = "none";
        selectEl.innerHTML = '<option value="">Sem atribuição</option>';
        selectEl.value = "";
        return;
    }

    const shares = categoryShares.filter(s => String(s.category_id) === String(cat.id));
    if (shares.length === 0) {
        // Not a shared category
        groupEl.style.display = "none";
        selectEl.innerHTML = '<option value="">Ambos</option>';
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
    optAll.textContent = "Ambos";
    selectEl.appendChild(optAll);
    
    // Owner Option (Creator)
    const isOwnerMe = cat.user_id === currentUser.id;
    const ownerEmail = isOwnerMe ? currentUser.email : (shares[0].owner_email || "Dono da Guia");
    const optOwner = document.createElement("option");
    optOwner.value = ownerEmail;
    optOwner.textContent = `${getPlainIdentityLabel(ownerEmail)} (Dono)`;
    selectEl.appendChild(optOwner);
    
    // Collaborator Options
    const addedEmails = new Set([normalizeAccountEmail(ownerEmail)]);
    shares.forEach(share => {
        const normalizedEmail = normalizeAccountEmail(share.collaborator_email);
        if (!normalizedEmail || addedEmails.has(normalizedEmail)) return;
        addedEmails.add(normalizedEmail);
        const optCollab = document.createElement("option");
        optCollab.value = share.collaborator_email;
        optCollab.textContent = getPlainIdentityLabel(share.collaborator_email);
        selectEl.appendChild(optCollab);
    });
    
    // Restore value if still exists
    selectEl.value = currentValue;
}

async function addCategory(name, type) {
    if (!name) return false;

    const normalizedName = name.trim();

    // Valida primeiro a memória/cache para não criar um segundo registro
    // temporário com um nome que já está visível no aparelho.
    const localExisting = categories.find(category =>
        category.is_active !== false
        && normalizeCategoryName(category.name) === normalizeCategoryName(normalizedName)
    );
    if (localExisting) {
        showAppNotice(`A categoria “${localExisting.name}” já existe.`, "warning");
        return false;
    }

    // Quando estiver online, consulta também a nuvem antes da atualização
    // otimista. Isso evita o erro de chave duplicada por cache desatualizado.
    if (supabaseClient && currentUser && navigator.onLine) {
        const existingResult = await supabaseClient
            .from("categories")
            .select("*")
            .eq("user_id", currentUser.id)
            .ilike("name", normalizedName)
            .order("id", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (existingResult.error) {
            showAppNotice(`Não foi possível verificar a categoria: ${existingResult.error.message}`, "error");
            return false;
        }
        if (existingResult.data && existingResult.data.is_active !== false) {
            showAppNotice(`A categoria “${existingResult.data.name}” já existe.`, "warning");
            await loadChecklistAndProgress();
            return false;
        }
    }

    // 1. ATUALIZAÇÃO OTIMISTA LOCAL IMEDIATA
    const tempId = Date.now();
    const newCat = {
        id: tempId,
        name: normalizedName,
        type: type || null,
        is_active: true
    };
    if (currentUser) {
        newCat.user_id = currentUser.id;
    }

    // Adiciona na memória e local storage
    let localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    categories.push(newCat);
    localCats.push(newCat);
    localStorage.setItem("offline_categories", JSON.stringify(localCats));

    renderCategories();

    // A mesma fila atende criações online e offline. Assim não existem dois
    // inserts concorrentes para a categoria quando a conexão oscila.
    scheduleCloudSync("nova-categoria", 80);
    return true;
}

async function insertOwnedCategoryInCloud({ name, type }) {
    if (!supabaseClient || !currentUser) throw new Error("Sessão indisponível.");
    const payload = {
        name,
        is_active: true,
        user_id: currentUser.id
    };
    if (CATEGORIES_CLOUD_SUPPORTS_TYPE) payload.type = type || null;
    let result = await supabaseClient.from("categories").insert(payload).select().single();

    // Compatibilidade apenas para instalações antigas que ainda não tenham a
    // coluna type. O proprietário continua explícito nas duas tentativas.
    if (CATEGORIES_CLOUD_SUPPORTS_TYPE && result.error && /type|column/i.test(result.error.message || "")) {
        const { type: _ignoredType, ...legacyPayload } = payload;
        result = await supabaseClient.from("categories").insert(legacyPayload).select().single();
        if (!result.error && result.data) result.data.type = type || null;
    }
    if (result.error && (result.error.code === "23505" || /duplicate key|categories_name_user_id_key/i.test(result.error.message || ""))) {
        const existingResult = await supabaseClient
            .from("categories")
            .select("*")
            .eq("user_id", currentUser.id)
            .ilike("name", name.trim())
            .order("id", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (existingResult.error) throw existingResult.error;
        if (!existingResult.data) throw result.error;
        if (existingResult.data.is_active !== false) return existingResult.data;
        const reactivated = await supabaseClient
            .from("categories")
            .update({ is_active: true })
            .eq("id", existingResult.data.id)
            .select()
            .single();
        if (reactivated.error) throw reactivated.error;
        result = reactivated;
    }
    if (result.error) throw result.error;
    if (!result.data) throw new Error("O servidor não retornou a categoria criada.");
    if (!CATEGORIES_CLOUD_SUPPORTS_TYPE) result.data.type = type || null;
    return result.data;
}

function updateLocalCatId(tempId, realCat) {
    categories = categories.map(c => String(c.id) === String(tempId) ? realCat : c);
    let currentLocalCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    currentLocalCats = currentLocalCats.map(c => String(c.id) === String(tempId) ? realCat : c);
    localStorage.setItem("offline_categories", JSON.stringify(currentLocalCats));
    renderCategories();
}

function addCategoryOffline(name, type) {
    beginOptimisticMutation();
    let localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    if (localCats.some(c => c.name.toLowerCase() === name.toLowerCase() && c.is_active)) {
        alert("Este local/categoria já existe.");
        return;
    }
    localCats.push({
        id: Date.now(),
        name: name,
        type: type || null,
        is_active: true
    });
    localStorage.setItem("offline_categories", JSON.stringify(localCats));
    
    loadDataOffline();
    renderCategories();
}

async function updateCategoryFields(id, newName, newType) {
    beginOptimisticMutation();
    const oldCat = categories.find(c => String(c.id) === String(id));
    if (!oldCat) return;
    const oldName = oldCat.name;
    
    // 1. Update category local state
    categories = categories.map(c => String(c.id) === String(id) ? { ...c, name: newName, type: newType } : c);
    
    let localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
    localCats = localCats.map(c => String(c.id) === String(id) ? { ...c, name: newName, type: newType } : c);
    localStorage.setItem("offline_categories", JSON.stringify(localCats));

    // 2. Update tasks associated with this category
    if (oldName !== newName) {
        allActiveTasks = allActiveTasks.map(t => t.category === oldName ? { ...t, category: newName } : t);
        tasks = tasks.map(t => t.category === oldName ? { ...t, category: newName } : t);
        
        let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
        localTasks = localTasks.map(t => t.category === oldName ? { ...t, category: newName } : t);
        localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
        
        // Update currentFilter if it matched the old name
        if (currentFilter === oldName) {
            currentFilter = newName;
        }
    }

    renderCategories();
    renderChecklist();
    updateProgress();

    // 3. Sync to Supabase if logged in
    if (supabaseClient && currentUser && !isTemporaryId(id)) {
        supabaseClient.from('categories').update({ name: newName, type: newType }).eq('id', id)
            .then(({ error }) => {
                if (error) {
                    console.warn("Erro ao atualizar categoria no Supabase. Tentando apenas nome:", error.message);
                    supabaseClient.from('categories').update({ name: newName }).eq('id', id);
                }
            });
            
        if (oldName !== newName) {
            supabaseClient.from('tasks').update({ category: newName }).eq('category', oldName)
                .then(({ error }) => {
                    if (error) console.warn("Erro ao atualizar categoria nas tarefas no Supabase:", error.message);
                });
        }
    }
}

async function deleteCategory(id) {
    beginOptimisticMutation();
    const cat = categories.find(c => String(c.id) === String(id));
    if (!cat) return;
    if (!await showAppConfirm(`Deseja excluir a categoria “${cat.name}”? Todas as tarefas e conclusões relacionadas também serão excluídas permanentemente.`, { title: "Excluir categoria", confirmText: "Excluir tudo", danger: true })) return;

    try {
        if (supabaseClient && currentUser && !isTemporaryId(id)) {
            // Remove tarefas legadas que ainda não possuem category_id.
            const { error: legacyTasksError } = await supabaseClient
                .from("tasks")
                .delete()
                .is("category_id", null)
                .eq("user_id", currentUser.id)
                .eq("category", cat.name);
            if (legacyTasksError) throw legacyTasksError;

            // Remove convites/participações antes da categoria para funcionar
            // também em bancos antigos cuja FK ainda não possua cascade.
            const { error: sharesError } = await supabaseClient
                .from("category_shares")
                .delete()
                .eq("category_id", id);
            if (sharesError) throw sharesError;

            // A FK tasks.category_id usa ON DELETE CASCADE: ao remover a
            // categoria, tarefas vinculadas e seus registros dependentes saem juntos.
            const { error: categoryError } = await supabaseClient
                .from("categories")
                .delete()
                .eq("id", id);
            if (categoryError) throw categoryError;
        }

        removeCategoryAndTasksFromLocalState(cat);
        renderCategories();
        renderChecklist();
        updateProgress();
    } catch (error) {
        console.error("Erro ao excluir categoria e tarefas:", error);
        alert("Não foi possível excluir a categoria: " + error.message);
        await loadChecklistAndProgress();
    }
}

function removeCategoryAndTasksFromLocalState(cat) {
    const belongsToCategory = task =>
        String(task.category_id || "") === String(cat.id)
        || (!task.category_id && task.category === cat.name);
    const affectedIds = new Set(
        (JSON.parse(localStorage.getItem("offline_tasks")) || [])
            .filter(belongsToCategory)
            .map(task => String(task.id))
    );

    categories = categories.filter(item => String(item.id) !== String(cat.id));
    tasks = tasks.filter(task => !belongsToCategory(task));
    allActiveTasks = allActiveTasks.filter(task => !belongsToCategory(task));

    const localCats = (JSON.parse(localStorage.getItem("offline_categories")) || [])
        .filter(item => String(item.id) !== String(cat.id));
    const localTasks = (JSON.parse(localStorage.getItem("offline_tasks")) || [])
        .filter(task => !belongsToCategory(task));
    const localCompletions = (JSON.parse(localStorage.getItem("offline_completions")) || [])
        .filter(completion => !affectedIds.has(String(completion.task_id)));
    localStorage.setItem("offline_categories", JSON.stringify(localCats));
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
    localStorage.setItem("offline_completions", JSON.stringify(localCompletions));

    const completionQueue = JSON.parse(localStorage.getItem("offline_completions_queue")) || {};
    Object.keys(completionQueue).forEach(key => {
        if ([...affectedIds].some(taskId => key.startsWith(`${taskId}_`))) delete completionQueue[key];
    });
    localStorage.setItem("offline_completions_queue", JSON.stringify(completionQueue));

    const updatesQueue = JSON.parse(localStorage.getItem("offline_task_updates_queue")) || {};
    affectedIds.forEach(taskId => delete updatesQueue[taskId]);
    localStorage.setItem("offline_task_updates_queue", JSON.stringify(updatesQueue));

    if (currentFilter === cat.name) currentFilter = "all";
}

async function leaveSharedCategory(cat) {
    if (!supabaseClient || !currentUser || !cat) return;
    const myEmail = normalizeAccountEmail(currentUser.email);
    const share = categoryShares.find(item =>
        String(item.category_id) === String(cat.id)
        && normalizeAccountEmail(item.collaborator_email) === myEmail
    );
    if (!share) {
        alert("Não foi possível localizar sua participação nesta categoria.");
        return;
    }
    if (!await showAppConfirm(`Deseja sair da categoria “${cat.name}”? Você poderá ser convidado novamente pelo administrador.`, { title: "Sair da categoria", confirmText: "Sair", danger: true })) return;

    try {
        const { error } = await supabaseClient
            .from("category_shares")
            .delete()
            .eq("id", share.id);
        if (error) throw error;

        categoryShares = categoryShares.filter(item => String(item.id) !== String(share.id));
        categories = categories.filter(item => String(item.id) !== String(cat.id));
        if (currentFilter === cat.name) currentFilter = "all";

        const localCats = (JSON.parse(localStorage.getItem("offline_categories")) || [])
            .filter(item => String(item.id) !== String(cat.id));
        localStorage.setItem("offline_categories", JSON.stringify(localCats));
        localStorage.setItem("offline_category_shares", JSON.stringify(categoryShares));

        renderCategories();
        renderChecklist();
        updateProgress();
        alert("Você saiu da categoria compartilhada.");
        await loadChecklistAndProgress();
    } catch (error) {
        console.error("Erro ao sair da categoria compartilhada:", error);
        alert("Não foi possível sair da categoria: " + error.message);
    }
}

function deleteCategoryOffline(id) {
    beginOptimisticMutation();
    const cat = categories.find(c => String(c.id) === String(id));
    if (!cat) return;
    removeCategoryAndTasksFromLocalState(cat);
    renderCategories();
    renderChecklist();
    updateProgress();
}

async function resetChecklistProgress() {
    beginOptimisticMutation();
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

async function shareReport() {
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

    const shareData = {
        title: `Checklist de ${formattedDateStr}`,
        text: reportText.trim()
    };

    if (typeof navigator.share === "function") {
        try {
            await navigator.share(shareData);
            return;
        } catch (error) {
            // Fechar o menu nativo não é um erro e não deve disparar o fallback.
            if (error?.name === "AbortError") return;
            console.warn("Compartilhamento nativo indisponível; usando cópia como alternativa.", error);
        }
    }

    // Alternativa para computadores e navegadores sem suporte ao Web Share.
    try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard API indisponível");
        await navigator.clipboard.writeText(shareData.text);
        alert("Checklist copiado! Agora você pode colar onde desejar.");
    } catch (error) {
        console.error("Não foi possível compartilhar ou copiar o checklist:", error);
        alert("Seu navegador não permite compartilhar diretamente. Tente abrir o app instalado ou usar HTTPS.");
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

function setupAiTaskCreator() {
    const modal = document.getElementById("modal-ai-tasks");
    const openButton = document.getElementById("btn-open-ai-tasks-fab");
    const closeButton = document.getElementById("btn-close-ai-tasks");
    const recordButton = document.getElementById("btn-ai-record");
    const recordTitle = document.getElementById("ai-record-title");
    const recordStatus = document.getElementById("ai-record-status");
    const promptInput = document.getElementById("ai-task-prompt");
    const generateButton = document.getElementById("btn-ai-generate");
    const review = document.getElementById("ai-tasks-review");
    const reviewList = document.getElementById("ai-tasks-review-list");
    const confirmButton = document.getElementById("btn-ai-confirm");
    if (!modal || !openButton || !recordButton || !generateButton || !reviewList || !confirmButton) return;

    let recorder = null;
    let audioChunks = [];
    let recordedAudio = null;
    let stopTimer = null;
    let suggestions = [];
    let liveSocket = null;
    let liveAudioContext = null;
    let liveSource = null;
    let liveProcessor = null;
    let liveTranscript = "";
    let liveAutoSubmitted = false;
    let deviceRecognition = null;
    let deviceTranscript = "";
    let deviceInterimTranscript = "";
    let pendingVoicePrompt = "";
    let isRefiningSuggestions = false;
    let discardRecordingOnStop = false;
    let aiSessionId = 0;

    const bytesToBase64 = bytes => {
        let binary = "";
        const step = 0x8000;
        for (let index = 0; index < bytes.length; index += step) binary += String.fromCharCode(...bytes.subarray(index, index + step));
        return btoa(binary);
    };
    const downsampleToPcm16 = (samples, inputRate) => {
        const ratio = inputRate / 16000;
        const length = Math.max(1, Math.floor(samples.length / ratio));
        const output = new Int16Array(length);
        for (let index = 0; index < length; index++) {
            const start = Math.floor(index * ratio);
            const end = Math.min(samples.length, Math.floor((index + 1) * ratio));
            let sum = 0;
            for (let cursor = start; cursor < end; cursor++) sum += samples[cursor];
            const value = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
            output[index] = value < 0 ? value * 32768 : value * 32767;
        }
        return new Uint8Array(output.buffer);
    };
    const stopLiveAudio = () => {
        try { liveProcessor?.disconnect(); } catch (_) {}
        try { liveSource?.disconnect(); } catch (_) {}
        if (liveAudioContext && liveAudioContext.state !== "closed") liveAudioContext.close().catch(() => {});
        liveProcessor = null;
        liveSource = null;
        liveAudioContext = null;
    };
    const submitLiveTranscript = () => {
        const transcript = (liveTranscript || deviceTranscript || deviceInterimTranscript).trim();
        if (liveAutoSubmitted) return;
        if (!transcript) {
            if (recorder?.state !== "recording" && recordedAudio) {
                liveAutoSubmitted = true;
                recordTitle.textContent = "Áudio pronto";
                recordStatus.textContent = "Criando a prévia das tarefas…";
                setTimeout(() => generateButton.click(), 80);
            }
            return;
        }
        liveAutoSubmitted = true;
        pendingVoicePrompt = transcript;
        recordedAudio = null;
        recordTitle.textContent = "Fala interpretada";
        recordStatus.textContent = "Criando a prévia das tarefas…";
        setTimeout(() => generateButton.click(), 80);
    };
    const startDeviceTranscription = () => {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) return;
        try {
            deviceTranscript = "";
            deviceInterimTranscript = "";
            deviceRecognition = new Recognition();
            deviceRecognition.lang = "pt-BR";
            deviceRecognition.continuous = true;
            deviceRecognition.interimResults = true;
            deviceRecognition.onresult = event => {
                let finalText = "";
                let interimText = "";
                for (let index = event.resultIndex; index < event.results.length; index++) {
                    const text = event.results[index][0]?.transcript || "";
                    if (event.results[index].isFinal) finalText += `${text} `;
                    else interimText += text;
                }
                if (finalText) deviceTranscript += finalText;
                deviceInterimTranscript = interimText;
                const preview = (interimText || deviceTranscript).trim();
                if (preview) recordStatus.textContent = preview.slice(0, 72);
            };
            deviceRecognition.onerror = error => console.warn("Transcrição rápida do aparelho indisponível", error.error);
            deviceRecognition.start();
        } catch (error) {
            console.warn("Não foi possível iniciar a transcrição do aparelho", error);
        }
    };
    const startGeminiLive = async stream => {
        try {
            recordStatus.textContent = "Conectando ao modo ao vivo…";
            const { data, error } = await supabaseClient.functions.invoke("create-gemini-live-token", { body: {} });
            if (error || !data?.token) throw new Error(data?.error || error?.message || "Token ao vivo indisponível");
            liveTranscript = "";
            liveAutoSubmitted = false;
            const endpoint = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(data.token)}`;
            liveSocket = new WebSocket(endpoint);
            liveSocket.onopen = () => {
                liveSocket.send(JSON.stringify({ setup: {
                    model: `models/${data.model || "gemini-3.1-flash-live-preview"}`,
                    generationConfig: { responseModalities: ["AUDIO"], temperature: 0 },
                    inputAudioTranscription: {},
                    systemInstruction: { parts: [{ text: "Transcreva fielmente a fala do usuário em português do Brasil. Responda somente com a transcrição, sem comentários." }] },
                } }));
            };
            liveSocket.onmessage = async event => {
                const message = JSON.parse(event.data);
                if (message.setupComplete && !liveProcessor && stream.active) {
                    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                    liveAudioContext = new AudioContextClass();
                    await liveAudioContext.resume();
                    liveSource = liveAudioContext.createMediaStreamSource(stream);
                    liveProcessor = liveAudioContext.createScriptProcessor(2048, 1, 1);
                    liveProcessor.onaudioprocess = audioEvent => {
                        if (liveSocket?.readyState !== WebSocket.OPEN) return;
                        const pcm = downsampleToPcm16(audioEvent.inputBuffer.getChannelData(0), liveAudioContext.sampleRate);
                        liveSocket.send(JSON.stringify({ realtimeInput: { audio: { data: bytesToBase64(pcm), mimeType: "audio/pcm;rate=16000" } } }));
                    };
                    liveSource.connect(liveProcessor);
                    liveProcessor.connect(liveAudioContext.destination);
                    recordStatus.textContent = "Transcrevendo ao vivo…";
                }
                const transcription = message.serverContent?.inputTranscription?.text;
                if (transcription) liveTranscript += `${transcription} `;
                if (message.serverContent?.turnComplete && recorder?.state !== "recording") submitLiveTranscript();
            };
            liveSocket.onerror = event => {
                console.warn("WebSocket Gemini Live falhou", event);
                stopLiveAudio();
                if (recorder?.state === "recording") recordStatus.textContent = "Gravando no modo compatível…";
            };
            liveSocket.onclose = event => {
                console.warn("WebSocket Gemini Live encerrado", event.code, event.reason);
                stopLiveAudio();
                if (recorder?.state === "recording" && !liveTranscript.trim()) recordStatus.textContent = "Gravando no modo compatível…";
            };
        } catch (error) {
            console.warn("Gemini Live indisponível; mantendo gravação normal.", error);
            if (recorder?.state === "recording") recordStatus.textContent = "Gravando no modo compatível…";
        }
    };

    const resetRecorderLabel = () => {
        recordButton.classList.remove("recording");
        if (suggestions.length) {
            recordTitle.textContent = "Complementar com áudio";
            recordStatus.textContent = "Ajuste as tarefas encontradas";
        } else {
            recordTitle.textContent = recordedAudio ? "Áudio pronto" : "Toque para falar";
            recordStatus.textContent = recordedAudio ? "Toque novamente para regravar" : "Até 60 segundos";
        }
    };
    const resetAiTaskCreator = () => {
        promptInput.value = "";
        recordedAudio = null;
        audioChunks = [];
        suggestions = [];
        pendingVoicePrompt = "";
        isRefiningSuggestions = false;
        liveTranscript = "";
        liveAutoSubmitted = false;
        deviceTranscript = "";
        deviceInterimTranscript = "";
        reviewList.innerHTML = "";
        review.hidden = true;
        localStorage.removeItem(`ai_task_draft_${currentUser?.id || "local"}`);
        localStorage.removeItem("ai_task_draft_local");
        resetRecorderLabel();
    };
    const close = () => {
        aiSessionId += 1;
        if (recorder && recorder.state === "recording") {
            discardRecordingOnStop = true;
            recorder.stop();
        }
        try { deviceRecognition?.stop(); } catch (_) {}
        try { liveSocket?.close(); } catch (_) {}
        stopLiveAudio();
        resetAiTaskCreator();
        closeModal(modal);
    };
    openButton.addEventListener("click", () => {
        document.getElementById("fab-menu")?.classList.remove("open");
        closeModal(modalAddTask);
        openModal(modal);
    });
    closeButton?.addEventListener("click", close);
    modal.querySelector(".modal-overlay")?.addEventListener("click", close);

    recordButton.addEventListener("click", async () => {
        if (recorder && recorder.state === "recording") {
            stopLiveAudio();
            if (liveSocket?.readyState === WebSocket.OPEN) liveSocket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
            try { deviceRecognition?.stop(); } catch (_) {}
            recorder.stop();
            setTimeout(submitLiveTranscript, (deviceTranscript || deviceInterimTranscript).trim() ? 250 : 1200);
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
            showAppNotice("A gravação de voz não está disponível neste navegador. Você ainda pode digitar o pedido.", "warning");
            return;
        }
        try {
            // Se já há uma prévia, o mesmo botão superior passa automaticamente
            // a complementar essas tarefas em vez de iniciar uma lista nova.
            isRefiningSuggestions = suggestions.length > 0;
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const preferredTypes = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
            const mimeType = preferredTypes.find(type => MediaRecorder.isTypeSupported(type)) || "";
            recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            audioChunks = [];
            discardRecordingOnStop = false;
            recorder.ondataavailable = event => { if (event.data?.size) audioChunks.push(event.data); };
            recorder.onstop = () => {
                clearTimeout(stopTimer);
                recordedAudio = discardRecordingOnStop ? null : new Blob(audioChunks, { type: recorder.mimeType || audioChunks[0]?.type || "audio/webm" });
                discardRecordingOnStop = false;
                audioChunks = [];
                stream.getTracks().forEach(track => track.stop());
                resetRecorderLabel();
            };
            recorder.start();
            recordedAudio = null;
            recordButton.classList.add("recording");
            recordTitle.textContent = "Ouvindo… toque para parar";
            recordStatus.textContent = isRefiningSuggestions ? "Descreva o que deseja alterar" : "Conectando ao reconhecimento rápido…";
            startDeviceTranscription();
            startGeminiLive(stream);
            stopTimer = setTimeout(() => { if (recorder?.state === "recording") recorder.stop(); }, 60000);
        } catch (error) {
            showAppNotice(error.name === "NotAllowedError" ? "Autorize o acesso ao microfone para usar a criação por voz." : `Não foi possível gravar: ${error.message}`, "warning");
        }
    });

    const blobToBase64 = blob => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
    const renderSuggestions = tasksToRender => {
        suggestions = tasksToRender;
        reviewList.innerHTML = tasksToRender.map((task, index) => {
            const today = getLocalDateString(new Date());
            const reminderDayLabel = task.reminder_date === today ? "Hoje" : task.reminder_date ? task.reminder_date.split("-").reverse().join("/") : (task.reminder_offset_days === 1 ? "1 dia antes" : "No mesmo dia");
            const reminderLabel = task.reminder_enabled ? `Lembrete: ${reminderDayLabel} às ${task.reminder_time}` : "";
            const meta = [task.category, task.date?.split("-").reverse().join("/"), task.recurrence === "daily" ? "Diária" : task.recurrence === "repeat" ? `Repete: ${(task.repeat_days || []).join(", ")}` : "Única", ...(task.shifts || []), task.assignee_label, reminderLabel].filter(Boolean).join(" • ");
            return `<label class="ai-review-item"><input type="checkbox" data-index="${index}" checked><span><strong>${escapeHTML(task.title)}</strong><small>${escapeHTML(meta)}</small></span></label>`;
        }).join("");
        review.hidden = false;
    };
    generateButton.addEventListener("click", async () => {
        if (!supabaseClient || !currentUser) return showAppNotice("Entre na sua conta para usar a criação com IA.", "warning");
        const prompt = pendingVoicePrompt || promptInput.value.trim();
        pendingVoicePrompt = "";
        if (!recordedAudio && !prompt) return showAppNotice("Grave um áudio ou escreva o que deseja criar.", "warning");
        const original = generateButton.innerHTML;
        const requestSessionId = aiSessionId;
        generateButton.disabled = true;
        generateButton.innerHTML = '<span class="loading-spinner"></span> Entendendo seu pedido…';
        if (!isRefiningSuggestions) review.hidden = true;
        try {
            const reminderFallback = new Date(Date.now() + 5 * 60000);
            const body = { prompt, today: getLocalDateString(new Date()), default_reminder_time: `${String(reminderFallback.getHours()).padStart(2, "0")}:${String(reminderFallback.getMinutes()).padStart(2, "0")}`, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo" };
            if (isRefiningSuggestions && suggestions.length) body.existing_tasks = suggestions;
            if (recordedAudio) {
                body.audio_base64 = await blobToBase64(recordedAudio);
                body.audio_mime_type = recordedAudio.type.split(";")[0] || "audio/webm";
            }
            const { data, error } = await supabaseClient.functions.invoke("create-tasks-with-ai", { body });
            if (error) {
                let detail = "";
                try {
                    const errorBody = error.context && typeof error.context.json === "function" ? await error.context.json() : null;
                    detail = errorBody?.error || "";
                } catch (_) {}
                throw new Error(detail || error.message);
            }
            if (data?.error) throw new Error(data.error);
            if (!data?.tasks?.length) throw new Error("Não encontrei nenhuma tarefa clara nesse pedido.");
            if (requestSessionId !== aiSessionId) return;
            renderSuggestions(data.tasks);
            recordedAudio = null;
            liveTranscript = "";
            deviceTranscript = "";
            deviceInterimTranscript = "";
            isRefiningSuggestions = false;
            resetRecorderLabel();
        } catch (error) {
            if (requestSessionId !== aiSessionId) return;
            showAppNotice(`A IA não conseguiu interpretar o pedido: ${error.message}`, "error");
        } finally {
            generateButton.disabled = false;
            generateButton.innerHTML = original;
            if (window.lucide) window.lucide.createIcons();
        }
    });
    confirmButton.addEventListener("click", async () => {
        const selected = [...reviewList.querySelectorAll('input[type="checkbox"]:checked')].map(input => suggestions[Number(input.dataset.index)]).filter(Boolean);
        if (!selected.length) return showAppNotice("Selecione pelo menos uma tarefa.", "warning");
        const original = confirmButton.textContent;
        confirmButton.disabled = true;
        confirmButton.textContent = "Criando…";
        let created = 0;
        try {
            for (const task of selected) {
                const validCategory = categories.find(category => category.is_active !== false && String(category.name).toLowerCase() === String(task.category).toLowerCase());
                if (!validCategory) continue;
                await addTask(task.title, validCategory.name, ["once", "daily", "repeat"].includes(task.recurrence) ? task.recurrence : "once", task.date || getLocalDateString(new Date()), task.recurrence === "repeat" ? task.repeat_days || [] : null, task.assigned_to || null, task.shifts || [], Boolean(task.important), task.reminder_enabled ? task.reminder_time : null, task.reminder_offset_days || 0);
                created += 1;
            }
            if (!created) throw new Error("Nenhuma categoria sugerida existe mais no checklist.");
            showAppNotice(`${created} ${created === 1 ? "tarefa criada" : "tarefas criadas"} com sucesso.`, "success");
            resetAiTaskCreator();
            closeModal(modal);
        } catch (error) {
            showAppNotice(`Não foi possível concluir: ${error.message}`, "error");
        } finally {
            confirmButton.disabled = false;
            confirmButton.textContent = original;
        }
    });
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
    
    // Sincroniza a cor da bolinha de status do cabeçalho
    updateDateState();
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
function setAppContainerVisible(visible) {
    const appContainerElement = document.querySelector(".app-container");
    if (!appContainerElement) return;
    if (visible) appContainerElement.style.removeProperty("display");
    else appContainerElement.style.display = "none";
}

function setupSupabaseAuth() {
    if (!supabaseClient) {
        document.getElementById("auth-container").style.display = "none";
        setAppContainerVisible(true);
        loadChecklistAndProgress();
        if (appSessionLoader) appSessionLoader.classList.add("hidden");
        return;
    }

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        console.log("Supabase Auth Change:", event, session);

        // Ignora renovações de token e eventos secundários para evitar re-renderizações desnecessárias
        if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
            if (session) {
                currentUser = session.user;
                learningCloudState = "idle";
                reportsCloudState = "idle";
            }
            return;
        }

        if (session) {
            const restoredFromCache = document.body.dataset.hasChecklistCache === "true";
            currentUser = session.user;
            learningCloudState = "idle";
            reportsCloudState = "idle";
            updatePendingTrainingPhotoFlag(await idb.get("training_photo_records") || []);
            document.getElementById("auth-container").style.display = "none";
            if (!restoredFromCache) setAppContainerVisible(false);

            const startupParams = new URLSearchParams(window.location.search);
            const earlyNotificationTaskId = startupParams.get("notification_task");
            const earlyTrainingDate = startupParams.get("training_date");
            const earlyTrainingPush = startupParams.get("training_calendar") === "1";
            let earlyTrainingPromise = null;
            if (earlyTrainingPush) {
                // O destino do push aparece antes de sincronizações, perfil e
                // realtime. O cache pinta o modal; a foto nova entra em seguida.
                history.replaceState({}, "", window.location.pathname);
                earlyTrainingPromise = openTrainingCalendarFromPush(earlyNotificationTaskId, earlyTrainingDate);
            }

            // Um push de tarefa tem prioridade sobre a sincronização completa:
            // mostra o cartão imediatamente e continua o carregamento depois.
            let earlyNotificationTaskHandled = false;
            if (earlyNotificationTaskId && !earlyTrainingPush) {
                const primedTask = await primeTaskFromPush(earlyNotificationTaskId);
                if (primedTask) {
                    earlyNotificationTaskHandled = true;
                    if (appSessionLoader) appSessionLoader.classList.add("hidden");
                    setAppContainerVisible(true);
                }
            }

            // Com cache visível, não substitui os cartões enquanto o usuário
            // inicia um swipe, toque ou edição logo após abrir o PWA.
            await waitForStartupInteractionToSettle();
            
            // Sync local data to cloud
            await syncOfflineDataToCloud();
            
            // Carrega as configurações de perfil (como o tema do usuário)
            await loadUserProfile();
            
            await loadChecklistAndProgress();
            await loadCollaborationIdentityLabels();
            renderChecklist();
            renderNotifications();
            localPrefs.setItem("checklist_device_cache_ready", "true");
            document.documentElement.classList.add("checklist-device-ready");

            // Sem cache, encerra completamente a tela curta antes de revelar
            // o checklist ou o tutorial de primeira categoria.
            if (!restoredFromCache) {
                if (appSessionLoader) appSessionLoader.classList.add("hidden");
                await new Promise(resolve => setTimeout(resolve, 280));
                setAppContainerVisible(true);
            }

            // Toda conta precisa definir um ID público antes de continuar.
            await ensureUserIdentifier();
            subscribeToCollaborationUpdates();
            if ("requestIdleCallback" in window) window.requestIdleCallback(warmTrainingPhotoCache, { timeout: 3000 });
            else setTimeout(warmTrainingPhotoCache, 1800);
            updateNotificationsSettingUI();
            if (areNotificationsEnabled() && "Notification" in window && Notification.permission === "granted") {
                // Nunca cancela uma assinatura válida automaticamente ao abrir
                // o app. Apenas recupera e sincroniza o endpoint existente.
                ensurePushSubscription({ forceRefresh: false })
                    .catch(error => console.warn("Não foi possível restaurar a inscrição Web Push:", error.message));
            }
            const notificationTaskId = earlyNotificationTaskId;
            const shouldOpenTrainingCalendar = earlyTrainingPush;
            const notificationTrainingDate = earlyTrainingDate;
            const reminderTaskId = new URLSearchParams(window.location.search).get("reminder_task");
            const shouldOpenNotifications = new URLSearchParams(window.location.search).get("open_notifications") === "1";
            const collaborationInviteId = new URLSearchParams(window.location.search).get("collaboration_invite");
            if (shouldOpenTrainingCalendar) {
                // Revalida o modal que já foi aberto pelo caminho rápido, sem
                // fechá-lo nem reiniciar suas fotos.
                earlyTrainingPromise?.catch(error => console.warn("Abertura rápida do treino indisponível:", error));
                setTimeout(() => {
                    if (!modalTrainingReport?.classList.contains("active")) return;
                    renderTrainingReport().then(() => renderTrainingDayGallery(notificationTrainingDate || getLocalDateString(new Date())));
                }, 50);
            } else if (reminderTaskId) {
                history.replaceState({}, "", window.location.pathname);
                setTimeout(() => openTaskReminderAction(reminderTaskId), 250);
            } else if (notificationTaskId) {
                history.replaceState({}, "", window.location.pathname);
                if (!earlyNotificationTaskHandled) {
                    setTimeout(() => focusSharedTaskFromNotification({ task_id: notificationTaskId }), 250);
                }
            } else if (collaborationInviteId) {
                history.replaceState({}, "", window.location.pathname);
                setTimeout(() => promptCollaborationInviteNavigation(collaborationInviteId), 250);
            } else if (shouldOpenNotifications) {
                history.replaceState({}, "", window.location.pathname);
                setTimeout(() => {
                    renderNotifications();
                    openModal(modalNotifications);
                    markCurrentInvitesAsSeen();
                }, 250);
            }
            lucide.createIcons();
            if (restoredFromCache && appSessionLoader) appSessionLoader.classList.add("hidden");
        } else {
            if (collaborationRealtimeChannel && supabaseClient) {
                supabaseClient.removeChannel(collaborationRealtimeChannel);
                collaborationRealtimeChannel = null;
            }
            if (currentUser) await removePushSubscription().catch(() => {});
            currentUser = null;
            currentUsername = "";
            collaborationIdentityByEmail.clear();
            learningCloudState = "idle";
            reportsCloudState = "idle";
            document.getElementById("auth-container").style.display = "flex";
            setAppContainerVisible(false);
            if (appSessionLoader) appSessionLoader.classList.add("hidden");
            
            // Limpa o cache local ao deslogar para evitar contaminação
            localStorage.removeItem("offline_categories");
            localStorage.removeItem("offline_tasks");
            localStorage.removeItem("offline_completions");
            localStorage.removeItem("offline_category_shares");
            localStorage.removeItem("offline_completions_queue");
            localStorage.removeItem("offline_task_updates_queue");
            localStorage.removeItem("offline_collaboration_invites_queue");
            localPrefs.removeItem("checklist_device_cache_ready");
            localPrefs.removeItem("pending_training_photo_uploads");
            document.documentElement.classList.remove("checklist-device-ready");
            
            tasks = [];
            categories = [];
            renderCategories();
            renderChecklist();
        }
    });
}

let isSyncing = false;

async function syncOfflineDataToCloud(reason = "manual", lockAcquired = false) {
    if (!supabaseClient || !currentUser) {
        refreshSyncStatusFromQueues();
        return;
    }
    if (!navigator.onLine) {
        refreshSyncStatusFromQueues();
        return;
    }
    if (!lockAcquired && navigator.locks?.request) {
        const lockName = `checklist-cloud-sync-${currentUser.id}`;
        return navigator.locks.request(lockName, { ifAvailable: true }, lock => {
            if (!lock) {
                scheduleCloudSync("aguardando-outra-aba", 900);
                return;
            }
            return syncOfflineDataToCloud(reason, true);
        });
    }
    if (isSyncing) {
        cloudSyncRerunRequested = true;
        return;
    }
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = null;
    isSyncing = true;
    cloudSyncRerunRequested = false;
    let syncSucceeded = false;
    setSyncStatus("syncing", "Salvando…", "Enviando alterações para a nuvem");

    try {
        console.log(`[Sync] Iniciando sincronização sequencial (${reason})...`);

        // 1. Sincronizar novas categorias criadas offline
        let localCats = JSON.parse(localStorage.getItem("offline_categories")) || [];
        const pendingInsertCats = localCats.filter(c => isTemporaryId(c.id) && c.is_active !== false);
        for (const pending of pendingInsertCats) {
            const realCat = await insertOwnedCategoryInCloud({ name: pending.name, type: pending.type });
            const tempId = pending.id;
            categories = categories.map(c => String(c.id) === String(tempId) ? realCat : c);
            localCats = (JSON.parse(localStorage.getItem("offline_categories")) || [])
                .map(c => String(c.id) === String(tempId) ? realCat : c);
            localStorage.setItem("offline_categories", JSON.stringify(localCats));
        }

        // 2. Sincronizar novas tarefas criadas offline
        let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
        const pendingInsertTasks = localTasks.filter(t => isTemporaryId(t.id) && t.is_active !== false);
        for (const pending of pendingInsertTasks) {
            let pendingContext = typeof pending.context === "string" ? (() => { try { return JSON.parse(pending.context); } catch (_) { return {}; } })() : { ...(pending.context || {}) };
            pendingContext.sync_token = pendingContext.sync_token || `task-${currentUser.id}-${pending.id}`;
            if (JSON.stringify(pending.context || {}) !== JSON.stringify(pendingContext)) {
                pending.context = pendingContext;
                localTasks = (JSON.parse(localStorage.getItem("offline_tasks")) || [])
                    .map(task => String(task.id) === String(pending.id) ? { ...task, context: pendingContext } : task);
                localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
            }
            const newTaskPayload = {
                title: pending.title,
                category: pending.category,
                is_recurring: pending.is_recurring,
                is_active: true,
                created_at: pending.created_at || new Date().toISOString(),
                context: pendingContext
            };
            if (pending.repeat_days) newTaskPayload.repeat_days = pending.repeat_days;
            if (pending.assigned_to) newTaskPayload.assigned_to = pending.assigned_to;
            if (pending.category_id) newTaskPayload.category_id = pending.category_id;
            const matchingCategory = categories.find(cat => cat.name === pending.category && !isTemporaryId(cat.id));
            // O cache pode apontar para uma categoria já excluída. O nome é a
            // referência segura para reparar o vínculo antes do insert.
            if (matchingCategory) newTaskPayload.category_id = matchingCategory.id;
            else delete newTaskPayload.category_id;
            newTaskPayload.user_id = currentUser.id;

            // Recupera um insert cuja resposta possa ter se perdido. O token
            // torna a criação idempotente sem depender do título da tarefa.
            const recovered = await supabaseClient.from("tasks")
                .select("*")
                .eq("user_id", currentUser.id)
                .contains("context", { sync_token: pendingContext.sync_token })
                .limit(1)
                .maybeSingle();
            if (recovered.error) throw recovered.error;
            let realTask = recovered.data || null;
            let createdNow = false;
            if (!realTask) {
                const { data, error } = await insertTaskWithCategoryFallback(newTaskPayload);
                if (error) throw error;
                realTask = data?.[0] || null;
                createdNow = Boolean(realTask);
            }
            if (realTask) {
                const tempId = pending.id;
                
                tasks = tasks.map(t => String(t.id) === String(tempId) ? { ...t, id: realTask.id } : t);
                allActiveTasks = allActiveTasks.map(t => String(t.id) === String(tempId) ? realTask : t);
                localTasks = (JSON.parse(localStorage.getItem("offline_tasks")) || [])
                    .map(t => String(t.id) === String(tempId) ? realTask : t);
                localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
                document.querySelectorAll(".task-item[data-id]").forEach(taskElement => {
                    if (String(taskElement.dataset.id) === String(tempId)) taskElement.dataset.id = realTask.id;
                });
                if (createdNow && isCollaborativeCategory(realTask.category_id)) await requestSharedTaskPush(realTask.id);
                
                let compQueue = JSON.parse(localStorage.getItem("offline_completions_queue")) || {};
                let updatedCompQueue = {};
                Object.keys(compQueue).forEach(key => {
                    const [tid, date] = key.split('_');
                    if (String(tid) === String(tempId)) {
                        updatedCompQueue[`${realTask.id}_${date}`] = compQueue[key];
                    } else {
                        updatedCompQueue[key] = compQueue[key];
                    }
                });
                localStorage.setItem("offline_completions_queue", JSON.stringify(updatedCompQueue));
            }
        }

        // 3. Enviar convites criados enquanto o aparelho estava offline.
        let inviteQueue = JSON.parse(localStorage.getItem("offline_collaboration_invites_queue")) || [];
        for (const pendingInvite of [...inviteQueue]) {
            const category = categories.find(cat =>
                String(cat.id) === String(pendingInvite.category_id)
                || cat.name === pendingInvite.category_name
            );
            if (!category || isTemporaryId(category.id)) continue;

            let collaboratorEmail = pendingInvite.identifier;
            if (!collaboratorEmail.includes("@")) {
                const { data: resolvedEmail, error: resolveError } = await supabaseClient.rpc("resolve_collaboration_email", { identifier: collaboratorEmail });
                if (resolveError) throw resolveError;
                if (!resolvedEmail) {
                    showAppNotice(`O convite para “${pendingInvite.identifier}” não foi enviado porque esse ID não foi encontrado.`, "error");
                    inviteQueue = inviteQueue.filter(item => item !== pendingInvite);
                    localStorage.setItem("offline_collaboration_invites_queue", JSON.stringify(inviteQueue));
                    continue;
                }
                collaboratorEmail = resolvedEmail;
            }

            const { data: createdShares, error: inviteError } = await supabaseClient.from("category_shares").insert({
                category_id: category.id,
                owner_id: currentUser.id,
                owner_email: currentUser.email,
                collaborator_email: collaboratorEmail
            }).select("id");
            if (inviteError && !/duplicate|unique/i.test(inviteError.message || "")) throw inviteError;
            const createdInvite = createdShares && createdShares[0];
            if (createdInvite) {
                const { error: pushError } = await supabaseClient.functions.invoke("send-task-push", { body: { invite_id: createdInvite.id } });
                if (pushError) console.warn("Convite sincronizado, mas o push ficou indisponível:", pushError.message);
            }
            inviteQueue = inviteQueue.filter(item => item !== pendingInvite);
            localStorage.setItem("offline_collaboration_invites_queue", JSON.stringify(inviteQueue));
            showAppNotice(`Convite para ${pendingInvite.identifier} enviado após a conexão ser restaurada.`, "success");
        }

        // 4. Sincronizar conclusões (completions)
        let queue = JSON.parse(localStorage.getItem("offline_completions_queue")) || {};
        let queueKeys = Object.keys(queue);
        for (const key of queueKeys) {
            const [taskId, date] = key.split('_');
            if (isTemporaryId(taskId)) continue;
            const queuedValue = queue[key];

            // Descarta conclusões órfãs deixadas no cache quando uma categoria
            // e todas as suas tarefas foram removidas em cascata.
            const { data: queuedTaskExists, error: queuedTaskCheckError } = await supabaseClient
                .from("tasks")
                .select("id")
                .eq("id", taskId)
                .maybeSingle();
            if (queuedTaskCheckError) throw queuedTaskCheckError;
            if (!queuedTaskExists) {
                clearQueuedEntryIfCurrent("offline_completions_queue", key, queuedValue);
                let cachedCompletions = JSON.parse(localStorage.getItem("offline_completions")) || [];
                cachedCompletions = cachedCompletions.filter(item => String(item.task_id) !== String(taskId));
                localStorage.setItem("offline_completions", JSON.stringify(cachedCompletions));
                continue;
            }

            const completed = queuedValue;
            const query = completed === "excluded"
                ? supabaseClient.from('completions').upsert({ task_id: taskId, date: date, completed: false }, { onConflict: 'task_id,date' })
                : completed
                ? supabaseClient.from('completions').upsert({ task_id: taskId, date: date, completed: true }, { onConflict: 'task_id,date' })
                : supabaseClient.from('completions').delete().eq('task_id', taskId).eq('date', date);
            
            const { error } = await query;
            if (error) throw error;

            clearQueuedEntryIfCurrent("offline_completions_queue", key, queuedValue);
        }

        // 4. Sincronizar atualizações e exclusões de tarefas
        let taskUpdatesQueue = JSON.parse(localStorage.getItem("offline_task_updates_queue")) || {};
        let updateKeys = Object.keys(taskUpdatesQueue);
        for (const id of updateKeys) {
            if (isTemporaryId(id)) continue;
            const queuedUpdates = taskUpdatesQueue[id];
            const dbUpdates = { ...queuedUpdates };
            if (dbUpdates.category_id) {
                const queuedTask = localTasks.find(task => String(task.id) === String(id));
                const matchingCategory = queuedTask && categories.find(cat => cat.name === queuedTask.category && !isTemporaryId(cat.id));
                if (matchingCategory) dbUpdates.category_id = matchingCategory.id;
                else delete dbUpdates.category_id;
            }
            
            const { error } = await supabaseClient.from('tasks').update(dbUpdates).eq('id', id);
            if (error) throw error;

            clearQueuedEntryIfCurrent("offline_task_updates_queue", id, queuedUpdates);
        }

        // 5. Reenvia fotos que ficaram somente no aparelho. As tarefas já
        // receberam seus IDs definitivos nas etapas anteriores.
        await syncPendingTrainingPhotoUploads();

        console.log("[Sync] Sincronização concluída com sucesso. Baixando dados mais recentes...");
        
        await loadChecklistAndProgress(false); // Busca dados e revalida
        syncSucceeded = true;
        cloudSyncRetryCount = 0;
        cloudSyncLastError = "";
        cloudSyncLastSuccessAt = Date.now();
        
    } catch (e) {
        console.warn("[Sync] Falha durante a sincronização. Alterações pendentes mantidas no IndexedDB:", e);
        if (navigator.onLine) {
            const errorDetail = e && e.message ? e.message : "Falha desconhecida";
            cloudSyncLastError = errorDetail;
            setSyncStatus("error", "Erro ao sincronizar", `Não foi possível sincronizar: ${errorDetail}`);
        } else {
            refreshSyncStatusFromQueues();
        }
    } finally {
        isSyncing = false;
        if (syncSucceeded) {
            refreshSyncStatusFromQueues();
            if ((cloudSyncRerunRequested || hasPendingSyncData()) && navigator.onLine) scheduleCloudSync("alterações-durante-sync", 180);
        } else if (navigator.onLine) {
            scheduleCloudSyncRetry();
        }
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

async function renderCalendarGrid() {
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
    const calendarBody = calendarDaysGrid.closest(".calendar-body");
    calendarBody?.querySelector(".calendar-streak-summary")?.remove();
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
    beginOptimisticMutation();
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
            const results = await Promise.all(promises);
            const firstError = results.find(result => result.error)?.error;
            if (firstError) throw firstError;
            console.log("Ordem de categorias atualizada no Supabase.");
        } catch (e) {
            console.warn("A ordem foi salva neste aparelho, mas não pôde ser atualizada no Supabase:", e.message);
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
        isSwipeRevealInteracting = true;
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
        if (!isDragging) {
            isSwipeRevealInteracting = false;
            return;
        }
        isDragging = false;
        isSwipeRevealInteracting = false;
        
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
        isSwipeRevealInteracting = true;
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
        isSwipeRevealInteracting = false;
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

    foreground.addEventListener("touchcancel", () => {
        isDragging = false;
        isSwipeRevealInteracting = false;
    }, { passive: true });
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

function classifyWordContext(word, associations) {
    const w = word.toLowerCase();
    
    // 1. Check user associations first (takes priority)
    if (associations && associations[w]) {
        return associations[w];
    }
    
    // 2. Classify by radicals
    if (w.match(/estud|faculd|aula|curs|prov|leit|livr|unisinos|pucrs|escola|faculdade/)) return "Estudos/Aprendizado";
    if (w.match(/trabalh|reunia|meet|post|client|entreg|relator|venda|comercial/)) return "Trabalho/Profissional";
    if (w.match(/trein|academ|exercic|corr|saud|medic|gym|futebol|correr/)) return "Saúde/Bem-estar";
    if (w.match(/pag|receb|financ|dinheir|compr|limp|organiz|mercado|casa/)) return "Rotina/Organização";
    
    return null;
}

function getSmartReportPeriods(days, referenceDate = new Date()) {
    const atNoon = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
    const addDays = (date, amount) => {
        const result = atNoon(date);
        result.setDate(result.getDate() + amount);
        return result;
    };

    const now = atNoon(referenceDate);
    let currentStart;
    let currentEnd;
    let previousStart;
    let previousEnd;

    if (days === 7) {
        // O ciclo semanal fecha na sexta-feira e fica disponível no sábado/domingo.
        const daysSinceFriday = (now.getDay() + 2) % 7;
        currentEnd = addDays(now, -daysSinceFriday);
        currentStart = addDays(currentEnd, -6);
        previousEnd = addDays(currentStart, -1);
        previousStart = addDays(previousEnd, -6);
    } else if (days === 30) {
        // Mês civil anterior e o mês imediatamente anterior a ele.
        currentStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 12);
        currentEnd = new Date(now.getFullYear(), now.getMonth(), 0, 12);
        previousStart = new Date(now.getFullYear(), now.getMonth() - 2, 1, 12);
        previousEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0, 12);
    } else {
        // Ano civil anterior e o ano imediatamente anterior a ele.
        currentStart = new Date(now.getFullYear() - 1, 0, 1, 12);
        currentEnd = new Date(now.getFullYear() - 1, 11, 31, 12);
        previousStart = new Date(now.getFullYear() - 2, 0, 1, 12);
        previousEnd = new Date(now.getFullYear() - 2, 11, 31, 12);
    }

    return {
        currentStart,
        currentEnd,
        previousStart,
        previousEnd,
        currentStartStr: getLocalDateString(currentStart),
        currentEndStr: getLocalDateString(currentEnd),
        previousStartStr: getLocalDateString(previousStart),
        previousEndStr: getLocalDateString(previousEnd)
    };
}

function getSmartReportPreviewPeriods(days, referenceDate = new Date()) {
    const atNoon = date => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
    const addDays = (date, amount) => {
        const result = atNoon(date);
        result.setDate(result.getDate() + amount);
        return result;
    };
    const now = atNoon(referenceDate);
    let currentStart;

    if (days === 7) {
        const daysSinceSaturday = (now.getDay() + 1) % 7;
        currentStart = addDays(now, -daysSinceSaturday);
    } else if (days === 30) {
        currentStart = new Date(now.getFullYear(), now.getMonth(), 1, 12);
    } else {
        currentStart = new Date(now.getFullYear(), 0, 1, 12);
    }

    const currentEnd = now;
    const elapsedDays = Math.round((currentEnd - currentStart) / 86400000) + 1;
    const previousEnd = addDays(currentStart, -1);
    const previousStart = addDays(previousEnd, -(elapsedDays - 1));

    return {
        currentStart,
        currentEnd,
        previousStart,
        previousEnd,
        currentStartStr: getLocalDateString(currentStart),
        currentEndStr: getLocalDateString(currentEnd),
        previousStartStr: getLocalDateString(previousStart),
        previousEndStr: getLocalDateString(previousEnd)
    };
}

function taskWasPlannedOnDate(task, dateObj, dateStr) {
    if (!task || task.is_active === false) return false;
    const createdDate = task.created_at ? extractDateFromTimestamp(task.created_at) : null;
    if (createdDate && createdDate > dateStr) return false;

    if (!task.is_recurring) {
        return createdDate === dateStr;
    }

    if (Array.isArray(task.repeat_days) && task.repeat_days.length > 0) {
        return task.repeat_days.map(Number).includes(dateObj.getDay());
    }

    return true;
}

function buildPlannedOccurrences(tasksList, startDate, endDate) {
    const occurrences = [];
    const cursor = new Date(startDate);
    cursor.setHours(12, 0, 0, 0);

    while (cursor <= endDate) {
        const dateStr = getLocalDateString(cursor);
        tasksList.forEach(task => {
            if (taskWasPlannedOnDate(task, cursor, dateStr)) {
                occurrences.push({ task, date: dateStr, key: `${task.id}_${dateStr}` });
            }
        });
        cursor.setDate(cursor.getDate() + 1);
    }

    return occurrences;
}

function classifyTaskContext(title, categoryName, associations) {
    // 1. Get category type from the registered category object (highest priority)
    const catObj = categories.find(c => c.name === categoryName);
    if (catObj && catObj.type) {
        return normalizeCategoryType(catObj.type);
    }
    
    // 2. Check user term associations for categoryName
    if (categoryName) {
        const catClass = classifyWordContext(categoryName, associations);
        if (catClass) return catClass;
    }
    
    // 3. Check words in task title
    const words = title.split(/\s+/);
    for (const word of words) {
        const cleaned = word.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
        if (cleaned.length > 3) {
            let wordClass = classifyWordContext(cleaned, associations);
            if (wordClass) return wordClass;
        }
    }
    
    return "Pessoal/Outros";
}

function normalizeCategoryType(type) {
    const t = type.toLowerCase();
    if (t.match(/estud|faculd|aula|curs|prov|leit|livr|unisinos|pucrs|escola|faculdade/)) return "Estudos/Aprendizado";
    if (t.match(/trabalh|reunia|meet|post|client|entreg|relator|venda|comercial|empresa/)) return "Trabalho/Profissional";
    if (t.match(/trein|academ|exercic|corr|saud|medic|gym|futebol|correr/)) return "Saúde/Bem-estar";
    if (t.match(/pag|receb|financ|dinheir|compr|limp|organiz|mercado|casa/)) return "Rotina/Organização";
    return type; // Retorna tipo customizado
}

function normalizeReportText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function matchesReportFunction(text, patterns) {
    return patterns.some(pattern => pattern.test(text));
}

const REPORT_FUNCTION_CATALOG = {
    delivery: { singular: "Entrega", plural: "Entregas" },
    billing: { singular: "Cobrança e financeiro", plural: "Cobranças e financeiro" },
    production: { singular: "Produção e operação", plural: "Produção e operação" },
    marketing: { singular: "Divulgação", plural: "Ações de divulgação" },
    sales: { singular: "Venda e comercial", plural: "Vendas e ações comerciais" },
    service: { singular: "Atendimento", plural: "Atendimentos" },
    supply: { singular: "Compra e abastecimento", plural: "Compras e abastecimento" },
    assessment: { singular: "Avaliação", plural: "Avaliações" },
    academic_work: { singular: "Trabalho acadêmico", plural: "Trabalhos acadêmicos" },
    study: { singular: "Estudo e revisão", plural: "Estudos e revisões" },
    exercise: { singular: "Atividade física", plural: "Atividades físicas" },
    self_care: { singular: "Saúde e autocuidado", plural: "Saúde e autocuidado" },
    home: { singular: "Casa e organização", plural: "Casa e organização" },
    personal_learning: { singular: "Aprendizado", plural: "Aprendizados" },
    planning: { singular: "Rotina e planejamento", plural: "Rotina e planejamento" },
    other: { singular: "Outra atividade", plural: "Outras atividades" }
};

function saveLearnedFunctionAssociation(term, functionId) {
    if (!REPORT_FUNCTION_CATALOG[functionId]) return false;
    const normalizedTerm = normalizeReportText(term).trim();
    if (!normalizedTerm) return false;
    const learned = JSON.parse(localStorage.getItem("user_function_associations")) || {};
    learned[normalizedTerm] = functionId;
    localStorage.setItem("user_function_associations", JSON.stringify(learned));
    syncFunctionAssociationsToCloud(learned);
    return true;
}

async function loadFunctionAssociationsFromCloud() {
    if (!supabaseClient || !currentUser || learningCloudState !== "idle") return;
    learningCloudState = "loading";
    try {
        const { data, error } = await supabaseClient
            .from("user_preferences")
            .select("function_associations")
            .eq("user_id", currentUser.id)
            .maybeSingle();
        if (error) throw error;
        const local = JSON.parse(localStorage.getItem("user_function_associations")) || {};
        const cloud = data?.function_associations || {};
        const merged = { ...cloud, ...local };
        localStorage.setItem("user_function_associations", JSON.stringify(merged));
        learningCloudState = "ready";
        if (Object.keys(local).length > 0) syncFunctionAssociationsToCloud(merged);
    } catch (error) {
        learningCloudState = "unavailable";
        console.warn("Sincronização de aprendizados indisponível; usando armazenamento local.", error.message);
    }
}

async function syncFunctionAssociationsToCloud(associations) {
    if (!supabaseClient || !currentUser || learningCloudState === "unavailable") return;
    try {
        const { error } = await supabaseClient.from("user_preferences").upsert({
            user_id: currentUser.id,
            function_associations: associations,
            updated_at: new Date().toISOString()
        }, { onConflict: "user_id" });
        if (error) throw error;
        learningCloudState = "ready";
    } catch (error) {
        learningCloudState = "unavailable";
        console.warn("Não foi possível enviar os aprendizados para a nuvem.", error.message);
    }
}

function getLearnedTaskFunction(normalizedTitle) {
    const learned = JSON.parse(localStorage.getItem("user_function_associations")) || {};
    const learnedTerms = Object.keys(learned).sort((a, b) => b.length - a.length);
    for (const term of learnedTerms) {
        const normalizedTerm = normalizeReportText(term);
        if (!normalizedTerm || !normalizedTitle.includes(normalizedTerm)) continue;
        const functionInfo = REPORT_FUNCTION_CATALOG[learned[term]];
        if (functionInfo) return functionInfo;
    }
    return null;
}

function classifyTaskFunction(task) {
    const title = normalizeReportText(task.title);
    const learnedFunction = getLearnedTaskFunction(title);
    if (learnedFunction) return learnedFunction;
    const category = categories.find(cat => cat.name === task.category);
    const rawCategoryType = category?.type || "";
    const categoryType = normalizeReportText(normalizeCategoryType(rawCategoryType));
    const isStudy = /estud|aprend|faculd|escola|curso/.test(categoryType);
    const isHealth = /saud|bem-estar|academ|esport/.test(categoryType);
    const isWork = /trabalh|profission|empresa|comercial|projeto/.test(categoryType);
    const isPersonal = /pessoal|rotina|organiz|casa|financ|lazer/.test(categoryType);

    if (isStudy) {
        if (matchesReportFunction(title, [/\bprova\b/, /\bteste\b/, /avaliacao/, /simulado/, /\bg[12]\b/])) return { singular: "Avaliação", plural: "Avaliações" };
        if (matchesReportFunction(title, [/trabalho/, /projeto/, /atividade/, /exercicio/, /entregar/])) return { singular: "Trabalho acadêmico", plural: "Trabalhos acadêmicos" };
        if (matchesReportFunction(title, [/estud/, /revis/, /resum/, /pesquis/, /pratic/])) return { singular: "Estudo e revisão", plural: "Estudos e revisões" };
        if (matchesReportFunction(title, [/\baula\b/, /assistir/, /palestra/, /laboratorio/])) return { singular: "Aula", plural: "Aulas" };
        if (matchesReportFunction(title, [/\bler\b/, /leitur/, /livro/, /artigo/, /capitulo/])) return { singular: "Leitura", plural: "Leituras" };
    }

    if (isWork) {
        if (matchesReportFunction(title, [/entreg/, /despach/, /enviar produto/, /levar produto/, /distribu/])) return { singular: "Entrega", plural: "Entregas" };
        if (matchesReportFunction(title, [/cobrar/, /cobranca/, /pagamento/, /receber/, /boleto/, /nota fiscal/])) return { singular: "Cobrança e financeiro", plural: "Cobranças e financeiro" };
        if (matchesReportFunction(title, [/envas/, /produz/, /fabric/, /embal/, /separar pedido/, /estoque/])) return { singular: "Produção e operação", plural: "Produção e operação" };
        if (matchesReportFunction(title, [/storie/, /story/, /post/, /instagram/, /whatsapp/, /divulg/, /anuncio/, /conteudo/])) return { singular: "Divulgação", plural: "Ações de divulgação" };
        if (matchesReportFunction(title, [/vender/, /venda/, /oferta/, /orcamento/, /proposta/, /comercial/])) return { singular: "Venda e comercial", plural: "Vendas e ações comerciais" };
        if (matchesReportFunction(title, [/atender/, /atendimento/, /reuniao/, /cliente/, /visita/])) return { singular: "Atendimento", plural: "Atendimentos" };
        if (matchesReportFunction(title, [/comprar/, /buscar/, /retirar/, /fornecedor/, /abastec/])) return { singular: "Compra e abastecimento", plural: "Compras e abastecimento" };
    }

    if (isHealth || isPersonal) {
        if (matchesReportFunction(title, [/treino/, /academ/, /corrida/, /correr/, /caminh/, /exercicio/, /futebol/, /bike/, /pedalar/])) return { singular: "Atividade física", plural: "Atividades físicas" };
        if (matchesReportFunction(title, [/tratamento/, /medic/, /terapia/, /consulta/, /cabelo/, /capilar/, /saude/])) return { singular: "Saúde e autocuidado", plural: "Saúde e autocuidado" };
        if (matchesReportFunction(title, [/limpar/, /lavar/, /arrumar/, /organizar/, /mercado/, /cozinhar/, /roupa/, /casa/])) return { singular: "Casa e organização", plural: "Casa e organização" };
        if (matchesReportFunction(title, [/pagar/, /conta/, /banco/, /dinheiro/, /orcamento/, /economizar/])) return { singular: "Finanças pessoais", plural: "Finanças pessoais" };
        if (matchesReportFunction(title, [/duolingo/, /estud/, /curso/, /ler/, /leitur/, /aprender/])) return { singular: "Aprendizado pessoal", plural: "Aprendizados pessoais" };
        if (matchesReportFunction(title, [/habito/, /rotina/, /planejar/, /checklist/, /agenda/])) return { singular: "Rotina e planejamento", plural: "Rotina e planejamento" };
    }

    // Ações suficientemente claras continuam reconhecíveis mesmo em categorias
    // customizadas ou ainda não classificadas.
    if (matchesReportFunction(title, [/entreg/, /despach/, /distribu/])) return { singular: "Entrega", plural: "Entregas" };
    if (matchesReportFunction(title, [/cobrar/, /cobranca/, /pagamento/, /receber/, /boleto/])) return { singular: "Cobrança e financeiro", plural: "Cobranças e financeiro" };
    if (matchesReportFunction(title, [/envas/, /produz/, /fabric/, /embal/, /separar pedido/, /estoque/])) return { singular: "Produção e operação", plural: "Produção e operação" };
    if (matchesReportFunction(title, [/storie/, /story/, /post/, /instagram/, /divulg/, /anuncio/, /conteudo/])) return { singular: "Divulgação", plural: "Ações de divulgação" };
    if (matchesReportFunction(title, [/vender/, /venda/, /oferta/, /orcamento/, /proposta/])) return { singular: "Venda e comercial", plural: "Vendas e ações comerciais" };
    if (matchesReportFunction(title, [/reuniao/, /atender/, /atendimento/])) return { singular: "Atendimento", plural: "Atendimentos" };
    if (matchesReportFunction(title, [/comprar/, /buscar/, /retirar/])) return { singular: "Compra ou retirada", plural: "Compras ou retiradas" };
    if (matchesReportFunction(title, [/\bprova\b/, /\bteste\b/, /avaliacao/, /simulado/, /\bg[12]\b/])) return { singular: "Avaliação", plural: "Avaliações" };
    if (matchesReportFunction(title, [/treino/, /academ/, /corrida/, /correr/, /caminh/, /exercicio/, /futebol/])) return { singular: "Atividade física", plural: "Atividades físicas" };
    if (matchesReportFunction(title, [/tratamento/, /medic/, /terapia/, /consulta/, /capilar/, /saude/])) return { singular: "Saúde e autocuidado", plural: "Saúde e autocuidado" };
    if (matchesReportFunction(title, [/duolingo/, /estud/, /curso/, /leitur/, /aprender/])) return { singular: "Aprendizado", plural: "Aprendizados" };
    if (matchesReportFunction(title, [/limpar/, /lavar/, /arrumar/, /organizar/, /mercado/, /roupa/])) return { singular: "Casa e organização", plural: "Casa e organização" };
    return { singular: "Outra atividade", plural: "Outras atividades" };
}

function formatReportFunctionCount(functionInfo, count) {
    return `**${count} ${count === 1 ? functionInfo.singular : functionInfo.plural}**`;
}

function getReportPeriodType(days) {
    return days === 365 ? "yearly" : (days === 30 ? "monthly" : "weekly");
}

function getReportPeriodLabel(days) {
    return days === 365 ? "Anual" : (days === 30 ? "Mensal" : "Semanal");
}

function getLocalReportHistory() {
    const history = JSON.parse(localStorage.getItem("smart_report_history")) || [];
    return Array.isArray(history) ? history : [];
}

async function saveSmartReportSnapshot({ days, periods, html, rate, completed, planned }) {
    const periodType = getReportPeriodType(days);
    const key = `${periodType}_${periods.currentStartStr}_${periods.currentEndStr}`;
    const snapshot = {
        key,
        days,
        periodType,
        periodLabel: getReportPeriodLabel(days),
        periodStart: periods.currentStartStr,
        periodEnd: periods.currentEndStr,
        generatedAt: new Date().toISOString(),
        rate,
        completed,
        planned,
        html
    };
    const history = getLocalReportHistory().filter(report => report.key !== key);
    history.unshift(snapshot);
    localStorage.setItem("smart_report_history", JSON.stringify(history.slice(0, 30)));

    if (!supabaseClient || !currentUser || reportsCloudState === "unavailable") return;
    try {
        const { error } = await supabaseClient.from("smart_reports").upsert({
            user_id: currentUser.id,
            period_type: periodType,
            period_start: periods.currentStartStr,
            period_end: periods.currentEndStr,
            report_html: html,
            report_data: { days, rate, completed, planned, periodLabel: snapshot.periodLabel },
            generated_at: snapshot.generatedAt
        }, { onConflict: "user_id,period_type,period_start,period_end" });
        if (error) throw error;
        reportsCloudState = "ready";
    } catch (error) {
        reportsCloudState = "unavailable";
        console.warn("Histórico de relatórios indisponível na nuvem; mantendo cópia local.", error.message);
    }
}

async function loadReportHistoryFromCloud() {
    let history = getLocalReportHistory();
    if (supabaseClient && currentUser && reportsCloudState !== "unavailable") {
        try {
            const { data, error } = await supabaseClient
                .from("smart_reports")
                .select("period_type,period_start,period_end,report_html,report_data,generated_at")
                .order("generated_at", { ascending: false })
                .limit(30);
            if (error) throw error;
            const cloudHistory = (data || []).map(report => ({
                key: `${report.period_type}_${report.period_start}_${report.period_end}`,
                days: report.report_data?.days || (report.period_type === "yearly" ? 365 : report.period_type === "monthly" ? 30 : 7),
                periodType: report.period_type,
                periodLabel: report.report_data?.periodLabel || report.period_type,
                periodStart: report.period_start,
                periodEnd: report.period_end,
                generatedAt: report.generated_at,
                rate: report.report_data?.rate || 0,
                completed: report.report_data?.completed || 0,
                planned: report.report_data?.planned || 0,
                html: report.report_html
            }));
            const merged = new Map();
            [...cloudHistory, ...history].forEach(report => {
                if (!merged.has(report.key)) merged.set(report.key, report);
            });
            history = Array.from(merged.values()).sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt)).slice(0, 30);
            localStorage.setItem("smart_report_history", JSON.stringify(history));
            reportsCloudState = "ready";
        } catch (error) {
            reportsCloudState = "unavailable";
            console.warn("Carregamento do histórico na nuvem indisponível; usando cópias locais.", error.message);
        }
    }
    return history;
}

async function loadAndRenderReportHistory(containerEl, titleEl) {
    containerEl.innerHTML = '<span style="color:var(--text-secondary);font-size:.8rem;">Carregando histórico…</span>';
    const history = await loadReportHistoryFromCloud();
    if (history.length === 0) {
        containerEl.innerHTML = '<div class="report-history-empty"><i data-lucide="archive"></i><strong>Nenhum relatório arquivado</strong><span>Os próximos relatórios oficiais serão salvos automaticamente aqui.</span></div>';
        if (window.lucide) window.lucide.createIcons();
        return;
    }
    containerEl.innerHTML = `<div class="report-history-list">${history.map((report, index) => `
        <button type="button" class="report-history-item" data-index="${index}">
            <span><strong>${escapeHTML(report.periodLabel)}</strong><small>${escapeHTML(report.periodStart.split('-').reverse().join('/'))} a ${escapeHTML(report.periodEnd.split('-').reverse().join('/'))}</small></span>
            <span class="report-history-rate">${report.rate}%<i data-lucide="chevron-right"></i></span>
        </button>`).join("")}</div>`;
    containerEl.querySelectorAll(".report-history-item").forEach(button => {
        button.addEventListener("click", () => {
            const report = history[Number(button.dataset.index)];
            if (!report) return;
            activeSmartReportDays = report.days;
            if (btnSaveSmartReport) btnSaveSmartReport.style.display = "inline-flex";
            currentReportCorrectionTasks = {};
            if (titleEl) titleEl.innerHTML = `<i data-lucide="archive" style="width:16px;height:16px;"></i> Relatório ${escapeHTML(report.periodLabel)} Arquivado`;
            containerEl.innerHTML = report.html;
            if (window.lucide) window.lucide.createIcons();
        });
    });
    if (window.lucide) window.lucide.createIcons();
}

function getReportTaskContext(task) {
    const category = categories.find(item => item.name === task.category || String(item.id) === String(task.category_id));
    return category?.type || "Não classificada";
}

function getReportTaskDescription(task) {
    let context = task.context || {};
    if (typeof context === "string") {
        try { context = JSON.parse(context); } catch (_) { context = {}; }
    }
    return String(task.description || context.description || "").trim();
}

async function generateHumanSmartReport(facts, cacheKey) {
    const storageKey = `human_smart_report_v2_${currentUser?.id || "local"}_${cacheKey}`;
    try {
        const cached = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (cached?.analysis && cached?.fingerprint === JSON.stringify(facts)) return cached.analysis;
    } catch (_) {}
    if (!supabaseClient || !currentUser || facts.completed === 0) return null;
    try {
        const { data, error } = await supabaseClient.functions.invoke("generate-smart-report", { body: { facts } });
        if (error || data?.error || !data?.analysis) throw new Error(data?.error || error?.message || "Análise indisponível");
        localStorage.setItem(storageKey, JSON.stringify({ fingerprint: JSON.stringify(facts), analysis: data.analysis, savedAt: Date.now() }));
        return data.analysis;
    } catch (error) {
        console.warn("Análise humana do relatório indisponível; exibindo fatos calculados pelo app.", error.message);
        return null;
    }
}

function renderHumanSmartReport(analysis) {
    if (!analysis) return "";
    const achievements = Array.isArray(analysis.achievements) ? analysis.achievements.slice(0, 3) : [];
    return `
        <section class="human-report-story">
            <header><span><i data-lucide="sparkles"></i></span><div><small>RETROSPECTIVA COM IA</small><h6>O que marcou este período</h6></div></header>
            <p class="human-report-overview">${escapeHTML(analysis.overview || "")}</p>
            ${achievements.length ? `<div class="human-report-achievements">${achievements.map(item => `<article><strong>${escapeHTML(item.title || "Realização")}</strong><p>${escapeHTML(item.detail || "")}</p></article>`).join("")}</div>` : ""}
            ${analysis.rhythm ? `<div class="human-report-note"><i data-lucide="calendar-days"></i><div><strong>Seu ritmo</strong><p>${escapeHTML(analysis.rhythm)}</p></div></div>` : ""}
            ${analysis.pending ? `<div class="human-report-note attention"><i data-lucide="circle-dashed"></i><div><strong>O que ficou aberto</strong><p>${escapeHTML(analysis.pending)}</p></div></div>` : ""}
            ${analysis.closing ? `<p class="human-report-closing">${escapeHTML(analysis.closing)}</p>` : ""}
            <small class="human-report-source"><i data-lucide="shield-check"></i> Texto criado somente a partir das tarefas e conclusões registradas.</small>
        </section>`;
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

    // Bypass expirations if debug parameter is present in URL
    const isDebugMode = new URLSearchParams(window.location.search).has("debug");
    if (isDebugMode) {
        isExpired = false;
        daysRemaining = 999;
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

    containerEl.innerHTML = `<span style="font-size: 0.8rem; color: var(--text-secondary);"><span class="loading-spinner" style="display:inline-block; vertical-align:middle; margin-right:6px; width:12px; height:12px; border:2px solid var(--primary); border-top-color:transparent; border-radius:50%; animation:spin 1s linear infinite;"></span> Analisando histórico...</span>`;

    // 1. Calcular dois períodos civis fechados e comparáveis.
    const periods = isDebugMode
        ? getSmartReportPreviewPeriods(days, now)
        : getSmartReportPeriods(days, now);

    // 2. Carregar conclusões do Supabase ou Local
    let completionsList = [];
    let cloudHistoryLoaded = false;
    if (supabaseClient && currentUser) {
        try {
            const { data, error } = await supabaseClient
                .from('completions')
                .select('*')
                .gte('date', periods.previousStartStr)
                .lte('date', periods.currentEndStr);
            if (!error && data) {
                completionsList = data;
                cloudHistoryLoaded = true;
            }
        } catch (e) {
            console.error("Erro ao carregar conclusões do Supabase", e);
        }
    }
    
    // Fallback local somente quando a consulta à nuvem não foi concluída.
    if (!cloudHistoryLoaded) {
        let localCompletions = JSON.parse(localStorage.getItem("offline_completions")) || [];
        completionsList = localCompletions.filter(c =>
            c.date >= periods.previousStartStr && c.date <= periods.currentEndStr
        );
    }

    // 3. Separar e deduplicar conclusões por tarefa + data.
    const uniqueCompletedRecords = (startStr, endStr) => {
        const recordsByKey = new Map();
        completionsList.forEach(completion => {
            if (completion.completed !== true || completion.date < startStr || completion.date > endStr) return;
            recordsByKey.set(`${completion.task_id}_${completion.date}`, completion);
        });
        return Array.from(recordsByKey.values());
    };

    const currentCompletions = uniqueCompletedRecords(periods.currentStartStr, periods.currentEndStr);
    const prevCompletions = uniqueCompletedRecords(periods.previousStartStr, periods.previousEndStr);
    const currentCompletionKeys = new Set(currentCompletions.map(c => `${c.task_id}_${c.date}`));
    const previousCompletionKeys = new Set(prevCompletions.map(c => `${c.task_id}_${c.date}`));

    // 4. Gerar as ocorrências realmente planejadas conforme data e recorrência.
    const reportTasks = allActiveTasks.filter(task => task.is_active !== false);
    const currentPlannedOccurrences = buildPlannedOccurrences(reportTasks, periods.currentStart, periods.currentEnd);
    const previousPlannedOccurrences = buildPlannedOccurrences(reportTasks, periods.previousStart, periods.previousEnd);
    const currentPlannedCount = currentPlannedOccurrences.length;
    const previousPlannedCount = previousPlannedOccurrences.length;
    const currentCount = currentCompletions.length;
    const prevCount = prevCompletions.length;
    const currentCompletedPlannedCount = currentPlannedOccurrences.filter(o => currentCompletionKeys.has(o.key)).length;
    const previousCompletedPlannedCount = previousPlannedOccurrences.filter(o => previousCompletionKeys.has(o.key)).length;
    const currentRate = currentPlannedCount > 0 ? Math.round((currentCompletedPlannedCount / currentPlannedCount) * 100) : 0;
    const previousRate = previousPlannedCount > 0 ? Math.round((previousCompletedPlannedCount / previousPlannedCount) * 100) : 0;

    // 5. Agrupar por Categorias e calcular planejadas vs concluídas
    const catCompletions = {};
    const catPlanned = {};
    
    currentPlannedOccurrences.forEach(occurrence => {
        const categoryName = occurrence.task.category || "Sem categoria";
        catPlanned[categoryName] = (catPlanned[categoryName] || 0) + 1;
        if (currentCompletionKeys.has(occurrence.key)) {
            catCompletions[categoryName] = (catCompletions[categoryName] || 0) + 1;
        }
    });

    const categoryNames = Object.keys(catPlanned);
    const activeCats = categoryNames
        .filter(name => catPlanned[name] > 0)
        .map(name => categories.find(cat => cat.name === name) || { id: name, name, type: "Não classificada" });

    // 5.1. Ler a função executada dentro de cada categoria/setor.
    const functionStatsByCategory = {};
    currentReportCorrectionTasks = {};
    currentPlannedOccurrences.forEach(occurrence => {
        if (!currentCompletionKeys.has(occurrence.key)) return;
        const categoryName = occurrence.task.category || "Sem categoria";
        if (!currentReportCorrectionTasks[categoryName]) currentReportCorrectionTasks[categoryName] = [];
        if (!currentReportCorrectionTasks[categoryName].some(task => String(task.id) === String(occurrence.task.id))) {
            currentReportCorrectionTasks[categoryName].push(occurrence.task);
        }
        const functionInfo = classifyTaskFunction(occurrence.task);
        if (!functionStatsByCategory[categoryName]) functionStatsByCategory[categoryName] = {};
        if (!functionStatsByCategory[categoryName][functionInfo.singular]) {
            functionStatsByCategory[categoryName][functionInfo.singular] = { ...functionInfo, count: 0 };
        }
        functionStatsByCategory[categoryName][functionInfo.singular].count += 1;
    });

    const functionSummaries = Object.entries(functionStatsByCategory)
        .sort((a, b) => (catCompletions[b[0]] || 0) - (catCompletions[a[0]] || 0))
        .map(([categoryName, stats]) => {
            const category = categories.find(cat => cat.name === categoryName);
            const categoryType = category?.type ? ` — ${category.type}` : "";
            const functions = Object.values(stats)
                .sort((a, b) => b.count - a.count)
                .map(item => formatReportFunctionCount(item, item.count));
            return `**${categoryName}**${categoryType}: ${functions.join(", ")}.
                <button type="button" class="btn-correct-report-function" data-category="${encodeURIComponent(categoryName)}"><i data-lucide="pencil"></i> Corrigir</button>`;
        });

    // 6. Principais destaques (Máximo 3)
    const highlights = [];
    
    // Destaque 1: Conclusão perfeita
    const perfectCat = activeCats.find(cat => catCompletions[cat.name] === catPlanned[cat.name]);
    if (perfectCat) {
        highlights.push(`Conclusão de 100% na guia **${perfectCat.name}** (${perfectCat.type || 'Não classificada'}), realizando todas as ${catPlanned[perfectCat.name]} tarefas.`);
    }

    // Destaque 2: Maior volume de conclusões
    const maxVolumeCat = activeCats
        .filter(cat => !perfectCat || cat.id !== perfectCat.id)
        .sort((a, b) => catCompletions[b.name] - catCompletions[a.name])[0];
    if (maxVolumeCat && catCompletions[maxVolumeCat.name] > 0) {
        highlights.push(`Maior volume de atividades na guia **${maxVolumeCat.name}** (${maxVolumeCat.type || 'Não classificada'}), com ${catCompletions[maxVolumeCat.name]} conclusões.`);
    }

    // Destaque 3: Comparação com período anterior
    if (previousPlannedCount > 0 && highlights.length < 3) {
        const rateDiff = currentRate - previousRate;
        if (rateDiff > 0) {
            highlights.push(`Aumento de **+${rateDiff} pontos percentuais** no aproveitamento em relação ao período anterior (${previousRate}% para ${currentRate}%).`);
        }
    }
    
    if (currentPlannedCount === 0) {
        highlights.push("Não houve ocorrências planejadas neste período para gerar destaques de produtividade.");
    } else if (highlights.length === 0) {
        highlights.push("Consistência geral mantida nas tarefas planejadas.");
    }
    const finalHighlights = highlights.slice(0, 3);

    // 7. Pontos de atenção (Máximo 2)
    const attentions = [];
    
    // Ponto 1: Baixo aproveitamento
    const lowCompletionCat = activeCats
        .filter(cat => catCompletions[cat.name] < catPlanned[cat.name])
        .sort((a, b) => {
            const rateA = catCompletions[a.name] / catPlanned[a.name];
            const rateB = catCompletions[b.name] / catPlanned[b.name];
            return rateA - rateB;
        })[0];
    if (lowCompletionCat) {
        const rate = Math.round((catCompletions[lowCompletionCat.name] / catPlanned[lowCompletionCat.name]) * 100);
        attentions.push(`Menor aproveitamento em **${lowCompletionCat.name}** (${lowCompletionCat.type || 'Não classificada'}): apenas **${rate}%** concluídas (${catCompletions[lowCompletionCat.name]} de ${catPlanned[lowCompletionCat.name]}).`);
    }

    // Ponto 2: Pendência importante
    const importantPendingOccurrences = currentPlannedOccurrences.filter(occurrence => {
        const context = occurrence.task.context || {};
        const isImportant = context.important === true || context.important === "true";
        return isImportant && !currentCompletionKeys.has(occurrence.key);
    });
    const importantPending = importantPendingOccurrences.length > 0 ? importantPendingOccurrences[0].task : null;
    if (importantPending) {
        attentions.push(`Pendência importante: a tarefa **"${importantPending.title}"** (guia ${importantPending.category}) teve ocorrência planejada não concluída.`);
    }

    // Ponto 3: Tarefas puladas
    if (attentions.length < 2) {
        const skippedTaskCounts = {};
        currentPlannedOccurrences.forEach(occurrence => {
            if (!currentCompletionKeys.has(occurrence.key)) {
                skippedTaskCounts[occurrence.task.id] = (skippedTaskCounts[occurrence.task.id] || 0) + 1;
            }
        });
        const worstSkipped = Object.entries(skippedTaskCounts).sort((a, b) => b[1] - a[1])[0];
        if (worstSkipped) {
            const task = reportTasks.find(t => String(t.id) === String(worstSkipped[0]));
            if (task) {
                attentions.push(`Tarefa adiada: **"${task.title}"** foi ignorada/pulada ${worstSkipped[1]}x.`);
            }
        }
    }
    
    if (currentPlannedCount === 0) {
        attentions.push("Sem dados suficientes: nenhuma tarefa estava programada no período analisado.");
    } else if (attentions.length === 0) {
        attentions.push("Nenhum desvio detectado. Todas as metas planejadas foram atendidas.");
    }
    const finalAttentions = attentions.slice(0, 2);

    // 8. Recomendação Prática (Exatamente 1)
    let recommendation = "";
    if (currentPlannedCount === 0) {
        recommendation = "Planeje tarefas para o próximo ciclo para que o app consiga calcular evolução, destaques e pontos de atenção.";
    } else if (lowCompletionCat) {
        recommendation = `Dedique atenção prioritária à guia **${lowCompletionCat.name}** no início do seu dia para equilibrar o progresso das atividades.`;
    } else if (importantPending) {
        recommendation = `Priorize e conclua a pendência importante **"${importantPending.title}"** como a primeira ação do próximo ciclo.`;
    } else {
        recommendation = "Mantenha a consistência atual distribuindo uniformemente a conclusão das tarefas ao longo do dia.";
    }

    // A IA recebe apenas fatos já calculados. Ela redige a retrospectiva, mas não calcula métricas.
    const completedOccurrences = currentPlannedOccurrences.filter(occurrence => currentCompletionKeys.has(occurrence.key));
    const pendingOccurrences = currentPlannedOccurrences.filter(occurrence => !currentCompletionKeys.has(occurrence.key));
    const completionCountByDate = {};
    completedOccurrences.forEach(occurrence => {
        completionCountByDate[occurrence.date] = (completionCountByDate[occurrence.date] || 0) + 1;
    });
    const busiestDateEntry = Object.entries(completionCountByDate).sort((a, b) => b[1] - a[1])[0];
    const formatFactDate = dateStr => new Date(`${dateStr}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
    const taskContextObject = task => {
        if (typeof task.context !== "string") return task.context || {};
        try { return JSON.parse(task.context); } catch (_) { return {}; }
    };
    const reportFacts = {
        period: `${periods.currentStartStr} a ${periods.currentEndStr}`,
        periodType: days === 365 ? "anual" : days === 30 ? "mensal" : "semanal",
        planned: currentPlannedCount,
        completed: currentCompletedPlannedCount,
        rate: currentRate,
        previousRate: previousPlannedCount > 0 ? previousRate : null,
        activeDays: Object.keys(completionCountByDate).length,
        busiestDay: busiestDateEntry ? `${formatFactDate(busiestDateEntry[0])}, com ${busiestDateEntry[1]} conclusões` : "",
        categories: activeCats.map(category => {
            const categoryCompleted = completedOccurrences.filter(item => (item.task.category || "Sem categoria") === category.name);
            const categoryPending = pendingOccurrences.filter(item => (item.task.category || "Sem categoria") === category.name);
            return {
                name: category.name,
                context: category.type || getReportTaskContext(categoryCompleted[0]?.task || categoryPending[0]?.task || {}),
                planned: catPlanned[category.name] || 0,
                completed: catCompletions[category.name] || 0,
                completedTasks: categoryCompleted.slice(0, days === 365 ? 30 : 18).map(item => {
                    const context = taskContextObject(item.task);
                    return { title: item.task.title, date: item.date, shift: (context.turnos || []).join(", "), description: getReportTaskDescription(item.task) };
                }),
                pendingTasks: categoryPending.slice(0, 10).map(item => {
                    const context = taskContextObject(item.task);
                    return { title: item.task.title, date: item.date, important: context.important === true || context.important === "true" };
                })
            };
        })
    };
    const reportCacheKey = `${getReportPeriodType(days)}_${periods.currentStartStr}_${periods.currentEndStr}`;
    const humanAnalysis = await generateHumanSmartReport(reportFacts, reportCacheKey);
    const humanAnalysisHtml = renderHumanSmartReport(humanAnalysis);
    const completedWorkHtml = reportFacts.categories.filter(category => category.completedTasks.length).map(category => `
        <article class="human-report-category">
            <header><strong>${escapeHTML(category.name)}</strong><small>${category.completed} ${category.completed === 1 ? "conclusão" : "conclusões"}</small></header>
            <ul>${category.completedTasks.map(task => `<li><span>${escapeHTML(task.title)}</span><small>${escapeHTML(formatFactDate(task.date))}${task.shift ? ` · ${escapeHTML(task.shift)}` : ""}</small>${task.description ? `<p>${escapeHTML(task.description)}</p>` : ""}</li>`).join("")}</ul>
        </article>`).join("");

    // Calcular prazo real de expiração
    let expirationMessage = "";
    if (isDebugMode) {
        expirationMessage = "Prévia parcial do período em andamento; os resultados ainda podem mudar até o fechamento.";
    } else if (days === 7) {
        if (now.getDay() === 6) {
            expirationMessage = "Este relatório expira no fim de domingo (amanhã).";
        } else {
            expirationMessage = "Este relatório expira no fim de hoje.";
        }
    } else if (days === 30) {
        expirationMessage = "Este relatório fica disponível até o fim do dia 3 deste mês.";
    } else {
        expirationMessage = "Este relatório fica disponível até o fim do dia 3 de janeiro.";
    }

    const formatReportDate = date => date.toLocaleDateString("pt-BR");
    const periodRangeLabel = `${formatReportDate(periods.currentStart)} a ${formatReportDate(periods.currentEnd)}`;

    const warningHtml = `
        <div style="background: rgba(245, 158, 11, 0.07); border: 1px solid rgba(245, 158, 11, 0.2); color: #eab308; padding: 12px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 0.82rem; font-weight: 600; display: flex; align-items: center; gap: 8px; line-height: 1.4;">
            <i data-lucide="clock" style="width: 18px; height: 18px; flex-shrink: 0; color: #eab308;"></i>
            <span>⏱️ ${expirationMessage}</span>
        </div>
    `;

    // 9. Construir o relatório final em 4 blocos curtos e diretos
    let contentHtml = `
        ${warningHtml}
        ${humanAnalysisHtml}
        
        <div class="smart-report-container" style="display: flex; flex-direction: column; gap: 16px; text-align: left; line-height: 1.5; color: var(--text-primary); font-size: 0.88rem;">
            
            <!-- 1. RESUMO -->
            <section style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px;">
                <h6 style="margin: 0 0 8px 0; color: var(--primary); font-size: 0.9rem; font-weight: 800; display: flex; align-items: center; gap: 6px;">
                    <i data-lucide="activity" style="width: 14px; height: 14px;"></i> 1. Resumo do Período
                </h6>
                <p style="margin: 0; color: var(--text-secondary); font-size: 0.82rem;">
                    Período analisado: **${periodRangeLabel}**. Você concluiu **${currentCompletedPlannedCount} de ${currentPlannedCount}** ocorrências planejadas (**${currentRate}%** de aproveitamento).
                    ${previousPlannedCount > 0 ? ` No período anterior, o aproveitamento foi de ${previousRate}% (${previousCompletedPlannedCount} de ${previousPlannedCount}).` : ""}
                </p>
            </section>

            <!-- 2. DESTAQUES -->
            <section style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px;">
                <h6 style="margin: 0 0 8px 0; color: #10b981; font-size: 0.9rem; font-weight: 800; display: flex; align-items: center; gap: 6px;">
                    <i data-lucide="trophy" style="width: 14px; height: 14px;"></i> 2. Principais Destaques
                </h6>
                <ul style="margin: 0; padding-left: 18px; color: var(--text-secondary); font-size: 0.82rem; display: flex; flex-direction: column; gap: 4px;">
                    ${finalHighlights.map(h => `<li>${h}</li>`).join("")}
                </ul>
            </section>

            <!-- 3. REALIZAÇÕES REGISTRADAS -->
            <section style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px;">
                <h6 style="margin: 0 0 8px 0; color: #06b6d4; font-size: 0.9rem; font-weight: 800; display: flex; align-items: center; gap: 6px;">
                    <i data-lucide="list-checks" style="width: 14px; height: 14px;"></i> 3. O que você realizou
                </h6>
                <div class="human-report-categories">${completedWorkHtml || "<p style=\"margin:0;color:var(--text-secondary);font-size:.82rem;\">Nenhuma tarefa concluída foi registrada no período.</p>"}</div>
            </section>

            <!-- 4. PONTOS DE ATENÇÃO -->
            <section style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px;">
                <h6 style="margin: 0 0 8px 0; color: #ef4444; font-size: 0.9rem; font-weight: 800; display: flex; align-items: center; gap: 6px;">
                    <i data-lucide="alert-triangle" style="width: 14px; height: 14px;"></i> 4. Pontos de Atenção
                </h6>
                <ul style="margin: 0; padding-left: 18px; color: var(--text-secondary); font-size: 0.82rem; display: flex; flex-direction: column; gap: 4px;">
                    ${finalAttentions.map(a => `<li>${a}</li>`).join("")}
                </ul>
            </section>

            <!-- 5. RECOMENDAÇÃO PRÁTICA -->
            <section style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px;">
                <h6 style="margin: 0 0 8px 0; color: #8b5cf6; font-size: 0.9rem; font-weight: 800; display: flex; align-items: center; gap: 6px;">
                    <i data-lucide="lightbulb" style="width: 14px; height: 14px;"></i> 5. Recomendação Prática
                </h6>
                <p style="margin: 0; color: var(--text-secondary); font-size: 0.82rem;">
                    ${recommendation}
                </p>
            </section>
            
        </div>
    `;

    const renderedReportHtml = contentHtml.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    containerEl.innerHTML = renderedReportHtml;
    lucide.createIcons();
    if (!isDebugMode) {
        const archiveContainer = document.createElement("div");
        archiveContainer.innerHTML = renderedReportHtml;
        archiveContainer.querySelectorAll(".btn-correct-report-function").forEach(button => button.remove());
        saveSmartReportSnapshot({
            days,
            periods,
            html: archiveContainer.innerHTML,
            rate: currentRate,
            completed: currentCompletedPlannedCount,
            planned: currentPlannedCount
        });
    }
}

window.saveCategoryType = function(catId, type, days) {
    const cat = categories.find(c => String(c.id) === String(catId));
    if (cat) {
        updateCategoryFields(cat.id, cat.name, type);
        console.log(`[Learn] Categoria "${cat.name}" associada ao tipo "${type}".`);
    }
    
    // Re-renderiza a aba atual
    if (typeof switchReportTab === "function") {
        setTimeout(() => switchReportTab(days), 100);
    }
};

window.saveTermAssociation = function(term, category, days) {
    const associations = JSON.parse(localStorage.getItem("user_term_associations")) || {};
    associations[term] = category;
    localStorage.setItem("user_term_associations", JSON.stringify(associations));
    console.log(`[Learn] Termo "${term}" associado a "${category}".`);
    
    // Re-renderiza a aba atual
    if (typeof switchReportTab === "function") {
        switchReportTab(days);
    }
};

function checkSaturdayAnimation() {
    const now = new Date();
    // 6 = Sábado
    if (now.getDay() === 6) {
        const todayStr = getLocalDateString(now);
        const animKey = "saturday_anim_shown_" + todayStr;
        if (localStorage.getItem(animKey) !== "true") {
            localStorage.setItem(animKey, "true");
            
            // Exibir a notificação flutuante discreta após 2 segundos
            setTimeout(() => {
                const btnReport = document.getElementById("btn-smart-report");
                if (btnReport) {
                    const rect = btnReport.getBoundingClientRect();
                    const tooltip = document.createElement("div");
                    tooltip.className = "report-tooltip-bubble";
                    tooltip.innerHTML = "Chegou sábado! Veja tudo o que você realizou nesta semana.";
                    tooltip.style.position = "absolute";
                    tooltip.style.top = (rect.bottom + window.scrollY + 10) + "px";
                    tooltip.style.left = (rect.left + rect.width / 2 + window.scrollX - 220) + "px";
                    document.body.appendChild(tooltip);
                    
                    setTimeout(() => tooltip.classList.add("active"), 100);
                    
                    // Sumir após 6 segundos
                    setTimeout(() => {
                        tooltip.classList.remove("active");
                        setTimeout(() => tooltip.remove(), 300);
                    }, 6000);
                }
            }, 2000);
        }
    }
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
let importantNotificationCheckRunning = false;
async function checkImportantTaskNotifications() {
    if (!("Notification" in window) || Notification.permission !== "granted" || importantNotificationCheckRunning) return;
    importantNotificationCheckRunning = true;
    try {

    const now = new Date();
    const todayStr = getLocalDateString(now);

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = getLocalDateString(tomorrow);

    let shownAlerts = JSON.parse(localStorage.getItem("shown_notifications")) || {};
    if (localStorage.getItem("local_reminder_receipt_repaired_v9_26") !== "true") {
        shownAlerts = Object.fromEntries(Object.entries(shownAlerts).filter(([key]) => !key.startsWith("reminder-")));
        localStorage.setItem("shown_notifications", JSON.stringify(shownAlerts));
        localStorage.setItem("local_reminder_receipt_repaired_v9_26", "true");
    }
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

    const notifyOnce = async (key, title, body, taskId, notificationType = null) => {
        if (shownAlerts[key]) return false;
        const displayed = await showWebNotification(title, body, taskId, key, notificationType);
        if (!displayed) return false;
        shownAlerts[key] = true;
        updated = true;
        return true;
    };

    const checkTask = async (task, targetDateStr) => {
        const isImportant = task.context && (task.context.important === true || task.context.important === "true");
        if (!isImportant) return;

        if (task.context.reminder_time) {
            const reminderTime = task.context.reminder_time;
            const offsetDays = Number(task.context.reminder_offset_days) === 1 ? 1 : 0;
            const reminderDateTime = new Date(`${targetDateStr}T${reminderTime}:00`);
            reminderDateTime.setDate(reminderDateTime.getDate() - offsetDays);
            const reminderKey = `reminder-${task.id}-${targetDateStr}-${reminderTime}`;
            if (now >= reminderDateTime && now.getTime() - reminderDateTime.getTime() < 60 * 60 * 1000 && !shownAlerts[reminderKey]) {
                await notifyOnce(reminderKey, "⏰ Lembrete de tarefa", offsetDays === 1 ? `Amanhã: “${task.title}”.` : `Está na hora de “${task.title}”.`, task.id, "task-reminder");
            }
            return;
        }

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
            await notifyOnce(dayBeforeKey,
                "⚠️ Tarefa Importante Amanhã!",
                `A tarefa "${task.title}" está agendada para amanhã no turno da ${turnos.join(', ') || 'Geral'}.`,
                task.id
            );
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

            await notifyOnce(shiftBeforeKey,
                "⏰ Próxima tarefa importante!",
                `A tarefa "${task.title}" está agendada para ${shiftMsg}.`,
                task.id
            );
        }
    };

    for (const task of todayTasks) await checkTask(task, todayStr);
    for (const task of tomorrowTasks) await checkTask(task, tomorrowStr);

    if (updated) {
        localStorage.setItem("shown_notifications", JSON.stringify(shownAlerts));
    }
    } finally {
        importantNotificationCheckRunning = false;
    }
}

async function showWebNotification(title, body, taskId, customTag = null, notificationType = null) {
    if (!areNotificationsEnabled() || !("Notification" in window) || Notification.permission !== "granted") return false;
    try {
        if ("serviceWorker" in navigator) {
            const registration = await navigator.serviceWorker.ready;
            await registration.showNotification(title, {
                    body: body,
                    icon: './icons/icon-192.png',
                    badge: './icons/notification-badge.png',
                    vibrate: [200, 100, 200],
                    data: { taskId: taskId, notificationType },
                    tag: customTag || `task-important-${taskId}`
            });
            return true;
        } else {
            new Notification(title, {
                body: body,
                icon: './icons/icon-192.png'
            });
            return true;
        }
    } catch (error) {
        console.warn("O navegador não confirmou a exibição da notificação:", error.message);
        return false;
    }
}

function getSmartReportAttentionKey(referenceDate = new Date()) {
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth();
    const day = referenceDate.getDate();
    const weekday = referenceDate.getDay();

    if (month === 0 && day <= 3) return `smart_report_seen_yearly_${year}`;
    if (day <= 3) return `smart_report_seen_monthly_${year}-${String(month + 1).padStart(2, "0")}`;
    if (weekday === 6 || weekday === 0) {
        const saturday = new Date(referenceDate);
        if (weekday === 0) saturday.setDate(saturday.getDate() - 1);
        return `smart_report_seen_weekly_${getLocalDateString(saturday)}`;
    }
    if (new URLSearchParams(window.location.search).has("debug")) {
        return `smart_report_seen_debug_${getLocalDateString(referenceDate)}`;
    }
    return null;
}

function getSmartReportReadyPeriod(referenceDate = new Date()) {
    const month = referenceDate.getMonth();
    const day = referenceDate.getDate();
    const weekday = referenceDate.getDay();
    if (month === 0 && day <= 3) return "anual";
    if (day <= 3) return "mensal";
    if (weekday === 6 || weekday === 0) return "semanal";
    return "semanal";
}

function updateSmartReportReadyLabel(referenceDate = new Date()) {
    const label = document.getElementById("smart-report-ready-label");
    if (!label) return;
    const period = getSmartReportReadyPeriod(referenceDate);
    label.textContent = `Seu relatório ${period} já está pronto!`;
}

function wrapReportCanvasText(context, text, maxWidth) {
    const paragraphs = String(text).split("\n");
    const lines = [];
    paragraphs.forEach((paragraph, paragraphIndex) => {
        const words = paragraph.trim().split(/\s+/).filter(Boolean);
        let line = "";
        words.forEach(word => {
            const candidate = line ? `${line} ${word}` : word;
            if (line && context.measureText(candidate).width > maxWidth) {
                lines.push(line);
                line = word;
            } else {
                line = candidate;
            }
        });
        if (line) lines.push(line);
        if (!words.length || paragraphIndex < paragraphs.length - 1) lines.push("");
    });
    return lines;
}

function drawRoundedReportRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
}

async function saveCurrentSmartReport() {
    const content = document.getElementById("report-summary-content");
    const title = document.getElementById("report-summary-title");
    if (!content || !title || content.textContent.includes("Carregando")) return;

    const periodName = activeSmartReportDays === 365 ? "anual" : (activeSmartReportDays === 30 ? "mensal" : "semanal");
    const originalButtonHtml = btnSaveSmartReport.innerHTML;
    btnSaveSmartReport.innerHTML = '<i data-lucide="loader-circle"></i> Gerando imagem…';
    btnSaveSmartReport.disabled = true;
    if (window.lucide) window.lucide.createIcons();

    try {
        const rootStyles = getComputedStyle(document.documentElement);
        const bodyStyles = getComputedStyle(document.body);
        const colors = {
            background: rootStyles.getPropertyValue("--bg-dark").trim() || bodyStyles.backgroundColor || "#0f172a",
            surface: rootStyles.getPropertyValue("--bg-surface-solid").trim() || "#182033",
            primary: rootStyles.getPropertyValue("--primary").trim() || "#8b5cf6",
            text: rootStyles.getPropertyValue("--text-primary").trim() || "#f8fafc",
            secondary: rootStyles.getPropertyValue("--text-secondary").trim() || "#94a3b8",
            border: rootStyles.getPropertyValue("--border-color").trim() || "rgba(148,163,184,.2)"
        };
        const aiStory = content.querySelector(".human-report-story");
        const blocks = aiStory ? [
            { type: "heading", text: aiStory.querySelector("h6")?.innerText.trim() || "Retrospectiva com IA" },
            { type: "body", text: aiStory.querySelector(".human-report-overview")?.innerText.trim() || "" },
            ...Array.from(aiStory.querySelectorAll(".human-report-achievements article")).map(element => ({ type: "list", text: element.innerText.trim() })),
            ...Array.from(aiStory.querySelectorAll(".human-report-note")).map(element => ({ type: "body", text: element.innerText.trim() })),
            { type: "body", text: aiStory.querySelector(".human-report-closing")?.innerText.trim() || "" },
            { type: "body", text: aiStory.querySelector(".human-report-source")?.innerText.trim() || "" }
        ].filter(block => block.text) : [];
        if (!blocks.length) throw new Error("A retrospectiva com IA ainda não terminou de carregar.");

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        const width = 1080;
        const contentWidth = 856;
        context.font = "500 27px Arial, sans-serif";
        let calculatedHeight = 390;
        blocks.forEach(block => {
            context.font = (block.type === "heading" || block.type === "divider") ? "700 30px Arial, sans-serif" : "500 27px Arial, sans-serif";
            const prefixWidth = block.type === "list" ? 34 : 0;
            const lines = wrapReportCanvasText(context, block.text, contentWidth - prefixWidth);
            const headingLike = block.type === "heading" || block.type === "divider";
            calculatedHeight += lines.length * (headingLike ? 42 : 40) + (headingLike ? 30 : 22);
        });
        calculatedHeight += 180;
        canvas.width = width;
        canvas.height = Math.max(1080, calculatedHeight);

        context.fillStyle = colors.background;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = colors.surface;
        drawRoundedReportRect(context, 48, 48, 984, canvas.height - 96, 36);
        context.fill();

        context.fillStyle = colors.primary;
        drawRoundedReportRect(context, 96, 96, 76, 76, 20);
        context.fill();
        context.fillStyle = "#ffffff";
        context.font = "800 36px Arial, sans-serif";
        context.textAlign = "center";
        context.fillText("▥", 134, 146);
        context.textAlign = "left";

        context.fillStyle = colors.text;
        context.font = "800 42px Arial, sans-serif";
        context.fillText("Relatório Inteligente", 196, 128);
        context.fillStyle = colors.secondary;
        context.font = "500 24px Arial, sans-serif";
        context.fillText("Análise automática de rotinas e tarefas concluídas", 196, 164);

        context.strokeStyle = colors.border;
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(96, 205);
        context.lineTo(984, 205);
        context.stroke();

        context.fillStyle = colors.primary;
        context.font = "800 26px Arial, sans-serif";
        context.fillText(title.innerText.trim().toUpperCase(), 112, 264);

        let y = 325;
        blocks.forEach(block => {
            const isHeading = block.type === "heading" || block.type === "divider";
            context.font = isHeading ? "800 30px Arial, sans-serif" : "500 27px Arial, sans-serif";
            context.fillStyle = block.type === "divider" ? colors.primary : (isHeading ? colors.text : colors.secondary);
            if (isHeading) y += 12;
            const textX = block.type === "list" ? 146 : 112;
            const lines = wrapReportCanvasText(context, block.text, contentWidth - (block.type === "list" ? 34 : 0));
            if (block.type === "list") {
                context.fillStyle = colors.primary;
                context.beginPath();
                context.arc(119, y - 8, 6, 0, Math.PI * 2);
                context.fill();
                context.fillStyle = colors.secondary;
            }
            lines.forEach(line => {
                if (line) context.fillText(line, textX, y);
                y += isHeading ? 42 : 40;
            });
            y += isHeading ? 30 : 22;
        });

        context.strokeStyle = colors.border;
        context.beginPath();
        context.moveTo(96, canvas.height - 125);
        context.lineTo(984, canvas.height - 125);
        context.stroke();
        context.fillStyle = colors.secondary;
        context.font = "500 22px Arial, sans-serif";
        context.fillText(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 112, canvas.height - 78);

        const imageBlob = await new Promise((resolve, reject) => {
            canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Não foi possível gerar a imagem.")), "image/png", 1);
        });
        const filename = `relatorio-${periodName}-${getLocalDateString(new Date())}.png`;
        const imageFile = new File([imageBlob], filename, { type: "image/png" });

        const isMobileShare = window.matchMedia("(max-width: 768px) and (pointer: coarse)").matches;
        if (isMobileShare && navigator.share && navigator.canShare && navigator.canShare({ files: [imageFile] })) {
            await navigator.share({ files: [imageFile], title: "Relatório Inteligente" });
        } else {
            const url = URL.createObjectURL(imageBlob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        btnSaveSmartReport.innerHTML = '<i data-lucide="check"></i> Imagem pronta';
    } catch (error) {
        if (error && error.name === "AbortError") {
            btnSaveSmartReport.innerHTML = originalButtonHtml;
        } else {
            console.error("Erro ao salvar relatório como imagem:", error);
            btnSaveSmartReport.innerHTML = '<i data-lucide="triangle-alert"></i> Não foi possível salvar';
        }
    }
    if (window.lucide) window.lucide.createIcons();
    setTimeout(() => {
        btnSaveSmartReport.innerHTML = originalButtonHtml;
        btnSaveSmartReport.disabled = false;
        if (window.lucide) window.lucide.createIcons();
    }, 1800);
}

function updateSmartReportButtonVisibility() {
    const btnReport = document.getElementById("btn-smart-report");
    if (!btnReport) return;

    // Check debug parameter in URL
    const isDebugMode = new URLSearchParams(window.location.search).has("debug");
    if (isDebugMode) {
        btnReport.style.display = "inline-flex";
        updateSmartReportReadyLabel();
        const debugKey = getSmartReportAttentionKey();
        const previewUnread = new URLSearchParams(window.location.search).has("preview-report-animation");
        btnReport.classList.toggle("report-attention", previewUnread || localStorage.getItem(debugKey) !== "true");
        return;
    }

    const now = new Date();
    
    // Check Weekly (Saturday and Sunday)
    const dayOfWeek = now.getDay();
    const hasWeeklyReport = (dayOfWeek === 6 || dayOfWeek === 0);

    // Check Monthly (first 3 days of the month)
    const dayOfMonth = now.getDate();
    const hasMonthlyReport = (dayOfMonth >= 1 && dayOfMonth <= 3);

    // Check Yearly (first 3 days of January)
    const isJanuary = now.getMonth() === 0;
    const hasYearlyReport = (isJanuary && dayOfMonth >= 1 && dayOfMonth <= 3);

    if (hasWeeklyReport || hasMonthlyReport || hasYearlyReport) {
        btnReport.style.display = "inline-flex";
        updateSmartReportReadyLabel(now);
        const attentionKey = getSmartReportAttentionKey(now);
        btnReport.classList.toggle("report-attention", localStorage.getItem(attentionKey) !== "true");
    } else {
        btnReport.style.display = "none";
        btnReport.classList.remove("report-attention");
    }
}

// Atualiza os indicadores e verifica as notificações a cada 60 segundos.
setInterval(() => {
    refreshExpiredReminderIndicators();
    checkImportantTaskNotifications();
}, 60000);
})();
