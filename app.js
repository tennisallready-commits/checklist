// Default tasks database for initial setup (offline fallback and reset option)
const DEFAULT_TASKS = [
    { id: 1, title: "Ligar luzes, computadores e ar condicionado", category: "abertura", completed: false },
    { id: 2, title: "Verificar fundo de caixa e troco", category: "abertura", completed: false },
    { id: 3, title: "Abastecer expositores e prateleiras", category: "abertura", completed: false },
    { id: 4, title: "Conferir mercadorias e notas fiscais de entrada", category: "operacao", completed: false },
    { id: 5, title: "Verificar validade e etiquetas dos produtos", category: "operacao", completed: false },
    { id: 6, title: "Realizar limpeza de balcões e áreas de atendimento", category: "limpeza", completed: false },
    { id: 7, title: "Coleta e descarte de lixos", category: "limpeza", completed: false },
    { id: 8, title: "Fechar o caixa e emitir relatórios diários", category: "fechamento", completed: false },
    { id: 9, title: "Verificar e trancar portas, janelas e portões", category: "fechamento", completed: false },
    { id: 10, title: "Desligar luzes internas e equipamentos", category: "fechamento", completed: false }
];

// App State
let tasks = [];
let currentFilter = "all";
let isEditMode = false;
let isHistoryMode = false;

// Selected date format YYYY-MM-DD
let selectedDate = "";

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
const checklistDateInput = document.getElementById("checklist-date");
const categoryChips = document.querySelectorAll(".category-chip");
const orgTagEl = document.getElementById("org-tag");
const appContainer = document.querySelector(".app-container");

// Modals
const modalAddTask = document.getElementById("modal-add-task");
const modalManageTasks = document.getElementById("modal-manage-tasks");

// Forms & Inputs
const formAddTask = document.getElementById("form-add-task");
const inputTaskTitle = document.getElementById("task-title");
const selectTaskCategory = document.getElementById("task-category");
const selectTaskRecurring = document.getElementById("task-recurring");
const inputOrgName = document.getElementById("input-org-name");
const inputSupabaseUrl = document.getElementById("input-supabase-url");
const inputSupabaseKey = document.getElementById("input-supabase-key");

// Action Buttons
const btnResetChecklist = document.getElementById("btn-reset-checklist");
const btnToggleEdit = document.getElementById("btn-toggle-edit");
const btnManageTasks = document.getElementById("btn-manage-tasks");
const btnAddTaskModal = document.getElementById("btn-add-task-modal");
const btnShareReport = document.getElementById("btn-share-report");
const btnCloseAddModal = document.getElementById("btn-close-add-modal");
const btnCloseManageModal = document.getElementById("btn-close-manage-modal");
const btnResetDefault = document.getElementById("btn-reset-default");
const btnClearAll = document.getElementById("btn-clear-all");

// ----------------------------------------------------
// Initialization
// ----------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    initApp();
    setupEventListeners();
});

async function initApp() {
    // Set initial date to today
    selectedDate = getLocalDateString(new Date());
    checklistDateInput.value = selectedDate;
    updateDateDisplay();

    // Load organization name
    const storedOrgName = localStorage.getItem("checklist_org_name");
    if (storedOrgName) {
        orgTagEl.textContent = storedOrgName;
        inputOrgName.value = storedOrgName;
    } else {
        inputOrgName.value = "Checklist Organizacional";
    }

    // Load Supabase credentials
    const storedUrl = localStorage.getItem("supabase_url") || "";
    const storedKey = localStorage.getItem("supabase_key") || "";
    inputSupabaseUrl.value = storedUrl;
    inputSupabaseKey.value = storedKey;

    // Connect to Supabase if config exists
    connectSupabase();

    // Load tasks data and update UI
    await loadChecklistAndProgress();

    // Initialize Lucide Icons
    lucide.createIcons();
}

// ----------------------------------------------------
// Event Listeners Setup
// ----------------------------------------------------
function setupEventListeners() {
    // Date Picker Input
    checklistDateInput.addEventListener("change", async (e) => {
        selectedDate = e.target.value;
        
        // Check if viewing history
        const todayStr = getLocalDateString(new Date());
        isHistoryMode = (selectedDate !== todayStr);
        
        if (isHistoryMode) {
            appContainer.classList.add("history-mode");
            isEditMode = false; // Turn off editing when viewing history
            btnToggleEdit.classList.remove("active");
            btnToggleEdit.innerHTML = '<i data-lucide="edit-3"></i>';
            btnToggleEdit.title = "Editar Checklist";
        } else {
            appContainer.classList.remove("history-mode");
        }

        updateDateDisplay();
        await loadChecklistAndProgress();
        lucide.createIcons();
    });

    // Category Filter Chips
    categoryChips.forEach(chip => {
        chip.addEventListener("click", () => {
            categoryChips.forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            currentFilter = chip.dataset.category;
            renderChecklist();
        });
    });

    // Toggle Task Complete (using event delegation)
    tasksListEl.addEventListener("click", (e) => {
        if (isEditMode || isHistoryMode) return;
        if (e.target.closest(".btn-task-action")) return;

        const item = e.target.closest(".task-item");
        if (!item) return;
        
        const taskId = parseInt(item.dataset.id) || item.dataset.id; // handle uuid string or int
        toggleTask(taskId);
    });

    // Toggle Edit Mode
    btnToggleEdit.addEventListener("click", () => {
        if (isHistoryMode) return; // Editing not allowed in history mode

        isEditMode = !isEditMode;
        btnToggleEdit.classList.toggle("active", isEditMode);
        
        if (isEditMode) {
            btnToggleEdit.innerHTML = '<i data-lucide="check"></i>';
            btnToggleEdit.title = "Finalizar Edição";
        } else {
            btnToggleEdit.innerHTML = '<i data-lucide="edit-3"></i>';
            btnToggleEdit.title = "Editar Checklist";
        }
        
        renderChecklist();
        lucide.createIcons();
    });

    // Settings Modal
    btnManageTasks.addEventListener("click", () => openModal(modalManageTasks));
    btnCloseManageModal.addEventListener("click", () => closeModal(modalManageTasks));

    // Save Settings
    inputOrgName.addEventListener("input", (e) => {
        const val = e.target.value.trim() || "Checklist Organizacional";
        orgTagEl.textContent = val;
        localStorage.setItem("checklist_org_name", val);
    });

    inputSupabaseUrl.addEventListener("change", async (e) => {
        localStorage.setItem("supabase_url", e.target.value.trim());
        connectSupabase();
        await loadChecklistAndProgress();
    });

    inputSupabaseKey.addEventListener("change", async (e) => {
        localStorage.setItem("supabase_key", e.target.value.trim());
        connectSupabase();
        await loadChecklistAndProgress();
    });

    // Add Task Modal
    btnAddTaskModal.addEventListener("click", () => {
        if (isHistoryMode) {
            alert("Não é possível adicionar tarefas no histórico.");
            return;
        }
        openModal(modalAddTask);
    });
    btnCloseAddModal.addEventListener("click", () => closeModal(modalAddTask));

    // Form Add Task Submit
    formAddTask.addEventListener("submit", async (e) => {
        e.preventDefault();
        await addTask(inputTaskTitle.value.trim(), selectTaskCategory.value, selectTaskRecurring.value);
        inputTaskTitle.value = "";
        closeModal(modalAddTask);
    });

    // Reset Today's Checklist Progress
    btnResetChecklist.addEventListener("click", async () => {
        if (isHistoryMode) {
            alert("Não é possível reiniciar o histórico.");
            return;
        }
        if (confirm("Deseja desmarcar todas as tarefas e reiniciar o progresso de hoje?")) {
            await resetChecklistProgress();
        }
    });

    // Restore default tasks
    btnResetDefault.addEventListener("click", async () => {
        if (confirm("Atenção: Isso ocultará todas as tarefas atuais e restaurará os padrões. Seu histórico passado será mantido. Continuar?")) {
            await restoreDefaultTasks();
            closeModal(modalManageTasks);
        }
    });

    // Clear all tasks
    btnClearAll.addEventListener("click", async () => {
        if (confirm("Atenção: Isso ocultará TODAS as tarefas do checklist ativo para que crie sua própria lista. Deseja continuar?")) {
            await clearAllTasks();
            closeModal(modalManageTasks);
        }
    });

    // Share report via WhatsApp
    btnShareReport.addEventListener("click", shareReport);
}

// ----------------------------------------------------
// Connection setup
// ----------------------------------------------------
function connectSupabase() {
    const url = localStorage.getItem("supabase_url");
    const key = localStorage.getItem("supabase_key");

    if (url && key) {
        try {
            // supabase is globally available from the script tag
            if (typeof supabase !== 'undefined') {
                supabaseClient = supabase.createClient(url, key);
                console.log("Supabase conectado com sucesso.");
            } else {
                console.warn("Script do Supabase SDK não carregou.");
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
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateObj = new Date(selectedDate + "T12:00:00"); // Avoid timezone shifting
    let dateString = dateObj.toLocaleDateString('pt-BR', options);
    dateString = dateString.charAt(0).toUpperCase() + dateString.slice(1);
    currentDateEl.textContent = dateString;
}

async function loadChecklistAndProgress() {
    await loadData();
    renderChecklist();
    updateProgress();
}

async function loadData() {
    if (supabaseClient) {
        try {
            // Online: Fetch active tasks
            const { data: dbTasks, error: errTasks } = await supabaseClient
                .from('tasks')
                .select('*')
                .eq('is_active', true);
            
            if (errTasks) throw errTasks;

            // Fetch completions for today
            const { data: dbCompletionsToday, error: errCompToday } = await supabaseClient
                .from('completions')
                .select('*')
                .eq('date', selectedDate);
                
            if (errCompToday) throw errCompToday;

            // Fetch completions before today
            const { data: dbCompletionsBefore, error: errCompBefore } = await supabaseClient
                .from('completions')
                .select('task_id')
                .lt('date', selectedDate);
                
            if (errCompBefore) throw errCompBefore;

            const completedBeforeIds = new Set(dbCompletionsBefore.map(c => c.task_id));
            const completedTodayIds = new Set(dbCompletionsToday.filter(c => c.completed).map(c => c.task_id));

            // Map tasks with Rollover and Recurrence
            tasks = dbTasks.filter(task => {
                const taskCreatedDate = task.created_at.split('T')[0];
                if (taskCreatedDate > selectedDate) return false; // Task didn't exist yet
                
                if (task.is_recurring) return true; // Recurring tasks are daily
                
                // One-time tasks: show if completed today OR not completed before (rollover)
                const completedToday = completedTodayIds.has(task.id);
                const completedBefore = completedBeforeIds.has(task.id);
                
                return completedToday || !completedBefore;
            }).map(task => ({
                id: task.id,
                title: task.title,
                category: task.category,
                is_recurring: task.is_recurring,
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
    // 1. Fetch active tasks
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

    // 2. Fetch completions
    let localCompletions = JSON.parse(localStorage.getItem("offline_completions")) || [];

    const completedBeforeIds = new Set(
        localCompletions.filter(c => c.date < selectedDate && c.completed).map(c => c.task_id)
    );
    const completedTodayIds = new Set(
        localCompletions.filter(c => c.date === selectedDate && c.completed).map(c => c.task_id)
    );

    // Map tasks with Rollover and Recurrence offline
    tasks = localTasks.filter(task => {
        if (!task.is_active) return false;
        
        const taskCreatedDate = task.created_at.split('T')[0];
        if (taskCreatedDate > selectedDate) return false;
        
        if (task.is_recurring) return true;
        
        const completedToday = completedTodayIds.has(task.id);
        const completedBefore = completedBeforeIds.has(task.id);
        
        return completedToday || !completedBefore;
    }).map(task => ({
        id: task.id,
        title: task.title,
        category: task.category,
        is_recurring: task.is_recurring,
        completed: completedTodayIds.has(task.id)
    }));
}

function renderChecklist() {
    tasksListEl.innerHTML = "";
    
    // Filter tasks
    const filteredTasks = tasks.filter(task => {
        if (currentFilter === "all") return true;
        return task.category === currentFilter;
    });

    // Handle class on list container
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

        // Sort: unchecked first, completed last. Wait, don't sort in edit mode (keeps layout stable)
        const sortedTasks = isEditMode
            ? [...filteredTasks]
            : [...filteredTasks].sort((a, b) => a.completed - b.completed);

        sortedTasks.forEach(task => {
            const taskEl = document.createElement("div");
            taskEl.className = `task-item ${task.completed ? 'completed' : ''}`;
            taskEl.dataset.id = task.id;

            taskEl.innerHTML = `
                <div class="task-checkbox-wrapper">
                    <div class="task-checkbox">
                        <i data-lucide="check"></i>
                    </div>
                </div>
                <div class="task-content">
                    <span class="task-title">${escapeHTML(task.title)}</span>
                    <div class="task-meta">
                        <span class="task-tag tag-${task.category}">${capitalize(task.category)}</span>
                        <span class="task-tag" style="background: rgba(255,255,255,0.02);">${task.is_recurring ? 'Diária' : 'Única'}</span>
                    </div>
                </div>
                <div class="task-edit-actions">
                    <button class="btn-task-action rename" title="Renomear">
                        <i data-lucide="pencil"></i>
                    </button>
                    <button class="btn-task-action delete" title="Excluir">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            `;

            // Setup buttons event listeners inside render
            const btnDelete = taskEl.querySelector(".btn-task-action.delete");
            btnDelete.addEventListener("click", (e) => {
                e.stopPropagation();
                deleteTask(task.id);
            });

            const btnRename = taskEl.querySelector(".btn-task-action.rename");
            btnRename.addEventListener("click", (e) => {
                e.stopPropagation();
                const newTitle = prompt("Editar descrição da tarefa:", task.title);
                if (newTitle && newTitle.trim()) {
                    renameTask(task.id, newTitle.trim());
                }
            });

            tasksListEl.appendChild(taskEl);
        });
        
        lucide.createIcons();
    }
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

    // Check completion state to animate ring icon
    if (percentage === 100 && total > 0) {
        progressRingWrapper.classList.add("completed");
    } else {
        progressRingWrapper.classList.remove("completed");
    }
}

// ----------------------------------------------------
// State Management & Storage
// ----------------------------------------------------
function saveTasks() {
    // Used for offline tasks definition
}

async function toggleTask(id) {
    if (isHistoryMode) return;

    // Toggle local state immediately for visual response
    tasks = tasks.map(t => {
        if (t.id === id) return { ...t, completed: !t.completed };
        return t;
    });
    updateProgress();
    renderChecklist();
    
    if (navigator.vibrate) {
        navigator.vibrate(12);
    }

    const task = tasks.find(t => t.id === id);
    if (!task) return;

    if (supabaseClient) {
        try {
            if (task.completed) {
                // Upsert completion record
                const { error } = await supabaseClient
                    .from('completions')
                    .upsert({
                        task_id: id,
                        date: selectedDate,
                        completed: true
                    }, { onConflict: 'task_id,date' });
                if (error) throw error;
            } else {
                // Remove completion record
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
        }
    } else {
        saveCompletionOffline(id, selectedDate, task.completed);
    }
}

function saveCompletionOffline(taskId, date, completed) {
    let localCompletions = JSON.parse(localStorage.getItem("offline_completions")) || [];
    localCompletions = localCompletions.filter(c => !(c.task_id === taskId && c.date === date));
    
    if (completed) {
        localCompletions.push({
            task_id: taskId,
            date: date,
            completed: true
        });
    }
    localStorage.setItem("offline_completions", JSON.stringify(localCompletions));
}

async function addTask(title, category, isRecurringString) {
    if (!title) return;
    const isRecurring = isRecurringString === "true";
    const tempId = Date.now();
    const createdAt = new Date().toISOString();

    const newTask = {
        title: title,
        category: category,
        is_recurring: isRecurring,
        is_active: true,
        created_at: createdAt
    };

    if (supabaseClient) {
        try {
            const { error } = await supabaseClient
                .from('tasks')
                .insert(newTask);
            if (error) throw error;
            
            await loadChecklistAndProgress();
        } catch (error) {
            console.error("Erro ao inserir no Supabase. Salvando offline.", error);
            addTaskOffline(title, category, isRecurring, tempId, createdAt);
        }
    } else {
        addTaskOffline(title, category, isRecurring, tempId, createdAt);
    }
}

function addTaskOffline(title, category, isRecurring, id, createdAt) {
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    localTasks.push({
        id: id,
        title: title,
        category: category,
        is_recurring: isRecurring,
        is_active: true,
        created_at: createdAt
    });
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
    
    loadDataOffline();
    renderChecklist();
    updateProgress();
}

async function renameTask(id, newTitle) {
    if (!newTitle) return;

    if (supabaseClient) {
        try {
            const { error } = await supabaseClient
                .from('tasks')
                .update({ title: newTitle })
                .eq('id', id);
            if (error) throw error;
            
            await loadChecklistAndProgress();
        } catch (error) {
            console.error("Erro ao renomear no Supabase. Renomeando offline.", error);
            renameTaskOffline(id, newTitle);
        }
    } else {
        renameTaskOffline(id, newTitle);
    }
}

function renameTaskOffline(id, newTitle) {
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    localTasks = localTasks.map(t => {
        if (t.id === id) return { ...t, title: newTitle };
        return t;
    });
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
    
    loadDataOffline();
    renderChecklist();
}

async function deleteTask(id) {
    // Use soft delete (is_active = false) to preserve past daily history!
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
        }
    } else {
        deleteTaskOffline(id);
    }
}

function deleteTaskOffline(id) {
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    localTasks = localTasks.map(t => {
        if (t.id === id) return { ...t, is_active: false };
        return t;
    });
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
    
    loadDataOffline();
    renderChecklist();
    updateProgress();
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
            console.error("Erro ao reiniciar progresso no Supabase. Resetando offline.", e);
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

async function restoreDefaultTasks() {
    if (supabaseClient) {
        try {
            // Soft delete all active tasks
            await supabaseClient.from('tasks').update({ is_active: false }).eq('is_active', true);
            // Insert defaults
            const newDbTasks = DEFAULT_TASKS.map(t => ({
                title: t.title,
                category: t.category,
                is_recurring: true,
                is_active: true
            }));
            await supabaseClient.from('tasks').insert(newDbTasks);
            
            await loadChecklistAndProgress();
        } catch (e) {
            console.error("Erro ao restaurar padrões online. Restaurando offline.", e);
            restoreDefaultTasksOffline();
        }
    } else {
        restoreDefaultTasksOffline();
    }
}

function restoreDefaultTasksOffline() {
    let localTasks = JSON.parse(localStorage.getItem("offline_tasks")) || [];
    // Soft delete current active tasks to preserve history
    localTasks = localTasks.map(t => ({ ...t, is_active: false }));
    
    // Add default tasks
    const createdAt = new Date().toISOString();
    DEFAULT_TASKS.forEach((t, i) => {
        localTasks.push({
            id: Date.now() + i,
            title: t.title,
            category: t.category,
            is_recurring: true,
            is_active: true,
            created_at: createdAt
        });
    });
    localStorage.setItem("offline_tasks", JSON.stringify(localTasks));
    
    loadDataOffline();
    renderChecklist();
    updateProgress();
}

async function clearAllTasks() {
    if (supabaseClient) {
        try {
            // Soft delete all active tasks
            await supabaseClient.from('tasks').update({ is_active: false }).eq('is_active', true);
            await loadChecklistAndProgress();
        } catch (e) {
            console.error("Erro ao apagar tarefas online. Limpando offline.", e);
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

// Automatically called for checking resets offline (only kept for local fallback safety)
function checkDailyReset() {
    // Unnecessary now as the rollover/recurrence checks dates dynamically!
}

// ----------------------------------------------------
// Sharing / Report Logic
// ----------------------------------------------------
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

    const categories = ["abertura", "operacao", "limpeza", "fechamento"];
    
    categories.forEach(cat => {
        const catTasks = tasks.filter(t => t.category === cat);
        if (catTasks.length > 0) {
            reportText += `*${capitalize(cat)}:*\n`;
            catTasks.forEach(task => {
                const mark = task.completed ? "✅" : "❌";
                reportText += `${mark} ${task.title}\n`;
            });
            reportText += `\n`;
        }
    });

    const customCatTasks = tasks.filter(t => !categories.includes(t.category));
    if (customCatTasks.length > 0) {
        reportText += `*Outros:*\n`;
        customCatTasks.forEach(task => {
            const mark = task.completed ? "✅" : "❌";
            reportText += `${mark} ${task.title}\n`;
        });
        reportText += `\n`;
    }

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

// ----------------------------------------------------
// Modal Helpers
// ----------------------------------------------------
function openModal(modalEl) {
    modalEl.classList.add("active");
    document.body.style.overflow = "hidden";
}

function closeModal(modalEl) {
    modalEl.classList.remove("active");
    document.body.style.overflow = "";
}

// Close modals when clicking overlay
document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", () => {
        closeModal(overlay.closest(".modal"));
    });
});

// ----------------------------------------------------
// Helper Utilities
// ----------------------------------------------------
function getLocalDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
