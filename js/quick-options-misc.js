/* ============================================================
 * Pick My Card — js/quick-options-misc.js（載入順序 12/12）
 * 區塊目錄（Grep 關鍵字）：
 *  - 快捷選項管理 modal         → "openManageQuickOptionsModal" / "renderQuickOptionsModal"
 *  - 標籤拖曳排序（含觸控）     → "handleDragStart" / "handleTouchStart"
 *  - 快捷選項儲存/重設          → "saveQuickOptionsSelection" / "resetQuickOptionsToDefault"
 *  - 自訂選項＋emoji picker     → "showCustomOptionForm" / "setupEmojiPicker"
 *  - 意見回饋                  → "Feedback System"
 *  - Auth modal（登入/註冊/忘記密碼）→ "Auth Modal System" / "openAuthModal"
 *  - WebView 警告事件綁定       → "WebView Warning Modal Event Listeners"
 *  - GA4 點擊追蹤               → "GA4 Button Click Tracking"
 * ============================================================ */
// ============================================
// Quick Search Options Management
// ============================================

// Temporary state for managing quick options in modal
let tempSelectedOptions = [];
let tempCustomOptions = [];

function openManageQuickOptionsModal() {
    const modal = document.getElementById('manage-quick-options-modal');

    if (!modal) {
        console.error('Quick options modal not found');
        return;
    }

    // Initialize temporary state with current options
    tempSelectedOptions = JSON.parse(JSON.stringify(quickSearchOptions));
    loadUserQuickSearchPrefs().then(prefs => {
        tempCustomOptions = JSON.parse(JSON.stringify(prefs.customQuickOptions || []));
        renderQuickOptionsModal();
    });

    // Setup modal buttons
    setupQuickOptionsModalButtons();

    // Show modal
    modal.style.display = 'flex';
    disableBodyScroll();
}

function renderQuickOptionsModal() {
    renderSelectedTags();
    renderAvailableTags();
    renderCustomOptionsList();
}

function renderSelectedTags() {
    const container = document.getElementById('selected-tags-container');
    if (!container) return;

    container.innerHTML = '';

    tempSelectedOptions.forEach((option, index) => {
        const tag = createTagElement(option, 'selected', index);
        container.appendChild(tag);
    });
}

function renderAvailableTags() {
    const container = document.getElementById('available-tags-container');
    if (!container) return;

    container.innerHTML = '';

    // Get all available options (default + custom)
    const defaultOptions = getDefaultQuickSearchOptions();
    const allOptions = [...defaultOptions, ...tempCustomOptions];

    // Filter out already selected options
    const selectedIds = tempSelectedOptions.map(opt => opt.id || opt.displayName);
    const availableOptions = allOptions.filter(opt => !selectedIds.includes(opt.id || opt.displayName));

    availableOptions.forEach((option) => {
        const tag = createTagElement(option, 'available');
        container.appendChild(tag);
    });
}

function createTagElement(option, type, index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tag-wrapper';

    const tag = document.createElement('div');
    tag.className = 'tag-item';
    tag.dataset.optionId = option.id || option.displayName;
    tag.dataset.isCustom = option.isCustom ? 'true' : 'false';

    // Icon HTML（鐵則 3：icon/displayName 含用戶自訂輸入，必須轉義）
    const iconHtml = option.icon ? `<span class="tag-icon">${escapeHtml(option.icon)}</span>` : '';

    // Expand button (only when merchants exist)
    const hasMerchants = Array.isArray(option.merchants) && option.merchants.length > 1;

    if (type === 'selected') {
        tag.draggable = true;
        tag.dataset.index = index;
        tag.innerHTML = `
            ${iconHtml}
            <span class="tag-name">${escapeHtml(option.displayName)}</span>
            ${hasMerchants ? '<button class="tag-expand-btn" title="查看商家" tabindex="-1">▾</button>' : ''}
            <button class="tag-remove-btn" title="移除">×</button>
        `;

        // Remove button
        const removeBtn = tag.querySelector('.tag-remove-btn');
        const handleRemove = (e) => {
            e.stopPropagation();
            e.preventDefault();
            removeOption(option);
        };
        removeBtn.addEventListener('click', handleRemove);
        removeBtn.addEventListener('touchend', handleRemove);

        // Drag and drop for reordering
        tag.addEventListener('dragstart', handleDragStart);
        tag.addEventListener('dragend', handleDragEnd);
        tag.addEventListener('dragover', handleDragOver);
        tag.addEventListener('drop', handleDrop);

        // Touch events for mobile drag and drop
        tag.addEventListener('touchstart', handleTouchStart, { passive: false });
        tag.addEventListener('touchmove', handleTouchMove, { passive: false });
        tag.addEventListener('touchend', handleTouchEnd);
    } else {
        // Available tag with add button
        tag.innerHTML = `
            <button class="tag-add-btn" title="新增">+</button>
            ${iconHtml}
            <span class="tag-name">${escapeHtml(option.displayName)}</span>
            ${hasMerchants ? '<button class="tag-expand-btn" title="查看商家" tabindex="-1">▾</button>' : ''}
        `;

        const addBtn = tag.querySelector('.tag-add-btn');
        const handleAdd = (e) => {
            e.stopPropagation();
            e.preventDefault();
            addOption(option);
        };
        addBtn.addEventListener('click', handleAdd);
        addBtn.addEventListener('touchend', handleAdd);
    }

    wrapper.appendChild(tag);

    // Merchants panel (collapsed by default)
    if (hasMerchants) {
        const panel = document.createElement('div');
        panel.className = 'tag-merchants-panel';
        panel.textContent = option.merchants.join('、');
        wrapper.appendChild(panel);

        const expandBtn = tag.querySelector('.tag-expand-btn');
        const toggle = (e) => {
            e.stopPropagation();
            e.preventDefault();
            const isOpen = panel.classList.contains('open');
            panel.classList.toggle('open', !isOpen);
            expandBtn.classList.toggle('expanded', !isOpen);
        };
        expandBtn.addEventListener('click', toggle);
        expandBtn.addEventListener('touchend', toggle);
    }

    return wrapper;
}

function addOption(option) {
    tempSelectedOptions.push(option);
    renderQuickOptionsModal();
}

function removeOption(option) {
    const optionId = option.id || option.displayName;
    tempSelectedOptions = tempSelectedOptions.filter(opt => (opt.id || opt.displayName) !== optionId);
    renderQuickOptionsModal();
}

// Drag and drop handlers
let draggedElement = null;
let touchDraggedElement = null;
let touchStartY = 0;
let touchStartX = 0;

function handleDragStart(e) {
    draggedElement = e.target;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }

    const dropTarget = e.target.closest?.('.tag-item') || e.target;
    if (draggedElement !== dropTarget && dropTarget.classList.contains('tag-item')) {
        const fromIndex = parseInt(draggedElement.dataset.index);
        const toIndex = parseInt(dropTarget.dataset.index);

        if (!isNaN(fromIndex) && !isNaN(toIndex)) {
            // Reorder array
            const item = tempSelectedOptions.splice(fromIndex, 1)[0];
            tempSelectedOptions.splice(toIndex, 0, item);
            renderQuickOptionsModal();
        }
    }

    return false;
}

// Touch event handlers for mobile drag and drop
function handleTouchStart(e) {
    // Don't interfere with button clicks
    if (e.target.classList.contains('tag-remove-btn') ||
        e.target.classList.contains('tag-add-btn') ||
        e.target.classList.contains('tag-expand-btn')) {
        return;
    }

    touchDraggedElement = e.target.closest('.tag-item');
    if (!touchDraggedElement) return;

    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;

    touchDraggedElement.classList.add('dragging');

    // Prevent default to avoid scrolling while dragging
    e.preventDefault();
}

function handleTouchMove(e) {
    if (!touchDraggedElement) return;

    e.preventDefault();

    const touch = e.touches[0];
    const currentX = touch.clientX;
    const currentY = touch.clientY;

    // Find the element under the touch point
    const elementBelow = document.elementFromPoint(currentX, currentY);
    const targetTag = elementBelow?.closest('.tag-item');

    if (targetTag && targetTag !== touchDraggedElement && targetTag.classList.contains('tag-item')) {
        const fromIndex = parseInt(touchDraggedElement.dataset.index);
        const toIndex = parseInt(targetTag.dataset.index);

        if (!isNaN(fromIndex) && !isNaN(toIndex) && fromIndex !== toIndex) {
            // Reorder array
            const item = tempSelectedOptions.splice(fromIndex, 1)[0];
            tempSelectedOptions.splice(toIndex, 0, item);
            renderQuickOptionsModal();

            // Update the dragged element reference
            const newTags = document.querySelectorAll('.selected-tags-container .tag-item');
            touchDraggedElement = newTags[toIndex];
            if (touchDraggedElement) {
                touchDraggedElement.classList.add('dragging');
            }
        }
    }
}

function handleTouchEnd(e) {
    if (touchDraggedElement) {
        touchDraggedElement.classList.remove('dragging');
        touchDraggedElement = null;
    }
}

function setupQuickOptionsModalButtons() {
    const modal = document.getElementById('manage-quick-options-modal');
    const closeBtn = document.getElementById('close-quick-options-modal');
    const cancelBtn = document.getElementById('cancel-quick-options-btn');
    const saveBtn = document.getElementById('save-quick-options-btn');
    const resetBtn = document.getElementById('reset-quick-options-btn');
    const clearAllBtn = document.getElementById('clear-all-quick-options-btn');
    const addCustomBtn = document.getElementById('add-custom-option-btn');

    if (closeBtn) {
        closeBtn.onclick = () => {
            hideCustomOptionForm();
            modal.style.display = 'none';
            enableBodyScroll();
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            hideCustomOptionForm();
            modal.style.display = 'none';
            enableBodyScroll();
        };
    }

    if (saveBtn) {
        saveBtn.onclick = async () => {
            await saveQuickOptionsSelection();
            hideCustomOptionForm();
            modal.style.display = 'none';
            enableBodyScroll();
        };
    }

    if (resetBtn) {
        resetBtn.onclick = () => {
            resetQuickOptionsToDefault();
        };
    }

    if (clearAllBtn) {
        clearAllBtn.onclick = () => {
            clearAllQuickOptions();
        };
    }

    if (addCustomBtn) {
        addCustomBtn.onclick = () => {
            showCustomOptionForm();
        };
    }

    // Custom option form buttons
    setupCustomOptionFormButtons();
}

async function saveQuickOptionsSelection() {
    // Compute new prefs from current modal state
    const defaultOptions = getDefaultQuickSearchOptions();
    const defaultIds = new Set(defaultOptions.map(o => o.id));
    const selectedDefaultIds = new Set(
        tempSelectedOptions.filter(o => defaultIds.has(o.id)).map(o => o.id)
    );

    // Defaults NOT in user's selected list = hidden
    const hiddenDefaultIds = defaultOptions
        .map(o => o.id)
        .filter(id => !selectedDefaultIds.has(id));

    // User's custom options (from tempCustomOptions, the source of truth for customs)
    const customQuickOptions = tempCustomOptions;

    // Preserve user's ordering
    const selectedOrder = tempSelectedOptions.map(o => o.id).filter(Boolean);

    const prefs = { hiddenDefaultIds, customQuickOptions, selectedOrder };
    const saved = await saveUserQuickSearchPrefs(prefs);

    if (saved) {
        // Reload quickSearchOptions from new prefs (which pulls fresh defaults from cards.json)
        await initializeQuickSearchOptions();
        renderQuickSearchButtons();
        console.log('✅ 快捷選項已更新');
    } else {
        console.error('❌ 保存快捷選項失敗');
        alert('保存失敗，請稍後再試');
    }
}

function renderCustomOptionsList() {
    const container = document.getElementById('custom-options-list');
    if (!container) return;

    container.innerHTML = '';

    if (tempCustomOptions.length === 0) {
        return;
    }

    tempCustomOptions.forEach((option) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-option-wrapper';

        const item = document.createElement('div');
        item.className = 'custom-option-item';

        // 構建icon HTML（如果有的話；鐵則 3：用戶自訂輸入必須轉義）
        const iconHtml = option.icon ? `<span class="tag-icon">${escapeHtml(option.icon)}</span>` : '';
        const hasMerchants = Array.isArray(option.merchants) && option.merchants.length > 1;

        item.innerHTML = `
            ${iconHtml}
            <span class="tag-name">${escapeHtml(option.displayName)}</span>
            ${hasMerchants ? '<button class="tag-expand-btn" title="查看商家" tabindex="-1">▾</button>' : ''}
            <button class="custom-option-delete" title="刪除">×</button>
        `;

        const deleteBtn = item.querySelector('.custom-option-delete');
        deleteBtn.onclick = () => { deleteCustomOption(option); };

        wrapper.appendChild(item);

        if (hasMerchants) {
            const panel = document.createElement('div');
            panel.className = 'tag-merchants-panel';
            panel.textContent = option.merchants.join('、');
            wrapper.appendChild(panel);

            const expandBtn = item.querySelector('.tag-expand-btn');
            const toggle = (e) => {
                e.stopPropagation();
                e.preventDefault();
                panel.classList.toggle('open');
                expandBtn.classList.toggle('expanded');
            };
            expandBtn.addEventListener('click', toggle);
            expandBtn.addEventListener('touchend', toggle);
        }

        container.appendChild(wrapper);
    });
}

// Emoji選擇器相關變數
let selectedEmoji = '';
const commonEmojis = ['🏪', '🏬', '🛒', '🍔', '☕', '🍕', '🎬', '✈️', '🚗', '⛽', '🏨', '🎮', '📱', '💻', '👕', '👟', '📚', '💊', '🏥', '🎵', '🎨', '⚽', '🎾', '🏃'];

function showCustomOptionForm() {
    const form = document.getElementById('custom-option-form');
    const addBtn = document.getElementById('add-custom-option-btn');

    if (form && addBtn) {
        form.style.display = 'block';
        addBtn.style.display = 'none';

        // Clear form
        document.getElementById('custom-display-name').value = '';

        // Reset emoji picker
        selectedEmoji = '';
        updateEmojiDisplay();

        // Setup emoji picker
        setupEmojiPicker();
    }
}

function setupEmojiPicker() {
    const selectedEmojiDiv = document.getElementById('selected-emoji');
    const emojiGrid = document.getElementById('emoji-grid');
    const clearBtn = document.getElementById('clear-emoji-btn');

    // Toggle emoji grid
    selectedEmojiDiv.onclick = () => {
        emojiGrid.style.display = emojiGrid.style.display === 'none' ? 'grid' : 'none';

        // Populate emoji grid if empty
        if (emojiGrid.children.length === 0) {
            commonEmojis.forEach(emoji => {
                const emojiBtn = document.createElement('div');
                emojiBtn.className = 'emoji-option';
                emojiBtn.textContent = emoji;
                emojiBtn.onclick = () => {
                    selectEmoji(emoji);
                };
                emojiGrid.appendChild(emojiBtn);
            });
        }
    };

    // Clear emoji button
    clearBtn.onclick = () => {
        selectedEmoji = '';
        updateEmojiDisplay();
    };
}

function selectEmoji(emoji) {
    selectedEmoji = emoji;
    updateEmojiDisplay();
    // Hide emoji grid after selection
    document.getElementById('emoji-grid').style.display = 'none';
}

function updateEmojiDisplay() {
    const selectedEmojiDiv = document.getElementById('selected-emoji');
    const clearBtn = document.getElementById('clear-emoji-btn');

    if (selectedEmoji) {
        selectedEmojiDiv.innerHTML = selectedEmoji;
        clearBtn.style.display = 'block';
    } else {
        selectedEmojiDiv.innerHTML = '<span class="emoji-placeholder">點擊選擇emoji</span>';
        clearBtn.style.display = 'none';
    }
}

function hideCustomOptionForm() {
    const form = document.getElementById('custom-option-form');
    const addBtn = document.getElementById('add-custom-option-btn');
    const emojiGrid = document.getElementById('emoji-grid');

    if (form && addBtn) {
        form.style.display = 'none';
        addBtn.style.display = 'block';
        // Hide emoji grid
        if (emojiGrid) {
            emojiGrid.style.display = 'none';
        }
    }
}

function setupCustomOptionFormButtons() {
    const saveBtn = document.getElementById('save-custom-option-btn');
    const cancelBtn = document.getElementById('cancel-custom-option-btn');

    if (saveBtn) {
        saveBtn.onclick = () => {
            saveCustomOption();
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            hideCustomOptionForm();
        };
    }
}

function saveCustomOption() {
    const displayName = document.getElementById('custom-display-name').value.trim();

    // Validation
    if (!displayName) {
        alert('請輸入顯示名稱');
        return;
    }

    // Create new custom option - use displayName as the search keyword
    const newOption = {
        id: `custom-${Date.now()}`,
        displayName: displayName,
        icon: selectedEmoji || '', // 使用選擇的emoji，沒選就留空
        merchants: [displayName], // Use display name as the only search keyword
        isCustom: true
    };

    // Add to custom options
    tempCustomOptions.push(newOption);

    // Re-render
    renderQuickOptionsModal();
    hideCustomOptionForm();
}

function deleteCustomOption(option) {
    if (!confirm(`確定要刪除「${option.displayName}」嗎？`)) {
        return;
    }

    const optionId = option.id || option.displayName;

    // Remove from custom options
    tempCustomOptions = tempCustomOptions.filter(opt => (opt.id || opt.displayName) !== optionId);

    // Remove from selected if present
    tempSelectedOptions = tempSelectedOptions.filter(opt => (opt.id || opt.displayName) !== optionId);

    // Re-render
    renderQuickOptionsModal();
}

function clearAllQuickOptions() {
    // Move all selected options back to available
    tempSelectedOptions = [];

    // Re-render the modal to reflect changes
    renderQuickOptionsModal();

    console.log('✅ 已移除所有已選擇的快捷選項');
}

function resetQuickOptionsToDefault() {
    const defaultOptions = getDefaultQuickSearchOptions();

    // Reset temp selected options to default
    tempSelectedOptions = [...defaultOptions];

    // Clear temp custom options
    tempCustomOptions = [];

    // Re-render the modal to reflect changes
    renderQuickOptionsModal();

    console.log('✅ 已恢復為預設快捷選項（需儲存才會生效）');
}

// ============================================
// Feedback System
// ============================================

// Initialize feedback system when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // State
    let selectedImages = [];
    const MAX_IMAGES = 5;
    const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB

    // DOM Elements
    const feedbackBtn = document.getElementById('feedback-btn');
    const feedbackModal = document.getElementById('feedback-modal');
    const closeFeedbackModal = document.getElementById('close-feedback-modal');
    const cancelFeedbackBtn = document.getElementById('cancel-feedback-btn');
    const submitFeedbackBtn = document.getElementById('submit-feedback-btn');
    const feedbackForm = document.getElementById('feedback-form');
    const feedbackMessage = document.getElementById('feedback-message');
    const feedbackImages = document.getElementById('feedback-images');
    const imageUploadArea = document.getElementById('image-upload-area');
    const uploadPlaceholder = document.getElementById('upload-placeholder');
    const imagePreviewContainer = document.getElementById('image-preview-container');
    const feedbackStatus = document.getElementById('feedback-status');

    // Check if elements exist
    if (!feedbackBtn || !feedbackModal) {
        console.warn('Feedback elements not found');
        return;
    }

    // Image Compression Function
    async function compressImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('讀取圖片失敗：' + (reader.error?.message || 'FileReader error')));
            reader.onload = (e) => {
                const img = new Image();
                img.onerror = () => reject(new Error(`圖片格式不支援或檔案損毀（${file.type || 'unknown type'}）`));
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // Calculate new dimensions (max 1920px)
                    const MAX_WIDTH = 1920;
                    const MAX_HEIGHT = 1920;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // canvas.toBlob with the source mime may return null when the
                    // browser can't encode that type (e.g. image/heic). Fall back
                    // to image/jpeg so the upload still succeeds.
                    const tryEncode = (mime, quality) => new Promise(res => canvas.toBlob(b => res(b), mime, quality));
                    (async () => {
                        let blob = await tryEncode(file.type, 0.85);
                        if (!blob) blob = await tryEncode('image/jpeg', 0.85);
                        if (!blob) return reject(new Error('圖片編碼失敗（canvas.toBlob 回傳 null）'));
                        resolve(blob);
                    })();
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }
    
    // Open Feedback Modal
    feedbackBtn.addEventListener('click', () => {
        // Check if user is logged in
        if (!currentUser) {
            alert('請先登入才能回報問題 🔐\n\n登入後可以幫助我們更好地追蹤您的回報。');
            return;
        }

        feedbackModal.style.display = 'flex';
        disableBodyScroll();
    });

    // Close Feedback Modal
    function closeFeedbackModalHandler() {
        feedbackModal.style.display = 'none';
        enableBodyScroll();
        resetFeedbackForm();
    }
    
    closeFeedbackModal.addEventListener('click', closeFeedbackModalHandler);
    cancelFeedbackBtn.addEventListener('click', closeFeedbackModalHandler);
    
    // Close modal when clicking outside
    feedbackModal.addEventListener('click', (e) => {
        if (e.target === feedbackModal) {
            closeFeedbackModalHandler();
        }
    });
    
    // Reset Form
    function resetFeedbackForm() {
        feedbackForm.reset();
        selectedImages = [];
        renderImagePreviews();
        feedbackStatus.className = 'feedback-status';
        feedbackStatus.textContent = '';
    }
    
    // Image Upload - Click
    imageUploadArea.addEventListener('click', () => {
        feedbackImages.click();
    });
    
    // Image Upload - File Input Change
    feedbackImages.addEventListener('change', (e) => {
        handleImageFiles(e.target.files);
    });
    
    // Image Upload - Drag and Drop
    imageUploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        imageUploadArea.classList.add('drag-over');
    });
    
    imageUploadArea.addEventListener('dragleave', () => {
        imageUploadArea.classList.remove('drag-over');
    });
    
    imageUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        imageUploadArea.classList.remove('drag-over');
        handleImageFiles(e.dataTransfer.files);
    });
    
    // Handle Image Files
    function handleImageFiles(files) {
        const fileArray = Array.from(files);
    
        // Filter valid image files
        const imageFiles = fileArray.filter(file =>
            file.type === 'image/jpeg' ||
            file.type === 'image/png' ||
            file.type === 'image/webp'
        );
    
        // Check total count
        const remainingSlots = MAX_IMAGES - selectedImages.length;
        const filesToAdd = imageFiles.slice(0, remainingSlots);
    
        if (filesToAdd.length === 0 && selectedImages.length >= MAX_IMAGES) {
            showStatus('error', `最多只能上傳 ${MAX_IMAGES} 張圖片`);
            return;
        }
    
        // Add files to selectedImages
        filesToAdd.forEach(file => {
            selectedImages.push({
                file: file,
                preview: URL.createObjectURL(file),
                size: file.size
            });
        });
    
        renderImagePreviews();
    }
    
    // Render Image Previews
    function renderImagePreviews() {
        if (selectedImages.length === 0) {
            imagePreviewContainer.innerHTML = '';
            uploadPlaceholder.style.display = 'flex';
            return;
        }
    
        uploadPlaceholder.style.display = 'none';
    
        imagePreviewContainer.innerHTML = selectedImages.map((img, index) => `
            <div class="image-preview-item">
                <img src="${img.preview}" alt="Preview ${index + 1}">
                <button type="button" class="image-preview-remove" data-index="${index}">×</button>
                ${img.size > MAX_IMAGE_SIZE ? '<div class="image-size-warning">檔案較大</div>' : ''}
            </div>
        `).join('');
    
        // Add remove handlers
        document.querySelectorAll('.image-preview-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                URL.revokeObjectURL(selectedImages[index].preview);
                selectedImages.splice(index, 1);
                renderImagePreviews();
            });
        });
    }
    
    // Show Status Message
    function showStatus(type, message) {
        feedbackStatus.className = `feedback-status ${type}`;
        feedbackStatus.textContent = message;
    }
    
    // Submit Feedback
    submitFeedbackBtn.addEventListener('click', async () => {
        const message = feedbackMessage.value.trim();

        // Validation
        if (!message) {
            showStatus('error', '請填寫問題描述');
            return;
        }

        // Double check user is logged in
        if (!currentUser) {
            showStatus('error', '請先登入才能提交回報');
            return;
        }
    
        // Disable submit button
        submitFeedbackBtn.disabled = true;
        showStatus('loading', '正在上傳...');
    
        try {
            // Upload images to Firebase Storage — each one is wrapped so a single
            // failure (e.g. Storage quota exceeded) doesn't abort the whole
            // submission. Text feedback still goes through with whatever images
            // we managed to upload.
            const imageUrls = [];
            const imageUploadErrors = [];

            if (selectedImages.length > 0) {
                for (let i = 0; i < selectedImages.length; i++) {
                    const imgData = selectedImages[i];
                    showStatus('loading', `正在上傳圖片 ${i + 1}/${selectedImages.length}...`);

                    try {
                        const compressedBlob = await compressImage(imgData.file);
                        const timestamp = Date.now();
                        const userId = currentUser?.uid || 'anonymous';
                        const filename = `feedback/${timestamp}_${userId}_${i}.jpg`;
                        const storageReference = window.storageRef(window.storage, filename);
                        await window.uploadBytes(storageReference, compressedBlob);
                        const downloadUrl = await window.getDownloadURL(storageReference);
                        imageUrls.push(downloadUrl);
                    } catch (imgError) {
                        console.warn(`圖片 ${i + 1} 上傳失敗:`, imgError);
                        imageUploadErrors.push(imgError);
                    }
                }
            }

            // Save text feedback to Firestore even if images failed
            showStatus('loading', '正在儲存...');

            const feedbackData = {
                message: message,
                userName: currentUser.displayName || 'Unknown',
                userId: currentUser.uid,
                userEmail: currentUser.email || '',
                imageUrls: imageUrls,
                timestamp: window.serverTimestamp(),
                createdAt: new Date().toISOString()
            };
            // Record image-upload failure context for triage (quota, mime, etc.)
            if (imageUploadErrors.length > 0) {
                feedbackData.imageUploadFailedCount = imageUploadErrors.length;
                feedbackData.imageUploadFirstError = (imageUploadErrors[0] && (imageUploadErrors[0].code || imageUploadErrors[0].message)) || String(imageUploadErrors[0]);
            }

            await window.addDoc(window.collection(window.db, 'feedback'), feedbackData);

            // Status reflects what actually happened with images
            const total = selectedImages.length;
            const ok = imageUrls.length;
            let successMsg;
            if (total === 0 || imageUploadErrors.length === 0) {
                successMsg = '✅ 回報已送出，感謝您的回饋！';
            } else if (ok === 0) {
                successMsg = '⚠️ 文字回報已送出（圖片暫時無法上傳，已紀錄錯誤）';
            } else {
                successMsg = `⚠️ 已送出（${ok}/${total} 張圖片成功上傳）`;
            }
            showStatus('success', successMsg);

            // Reset form after 2 seconds
            setTimeout(() => {
                closeFeedbackModalHandler();
            }, 2000);

        } catch (error) {
            // Only reached if the Firestore write itself failed — image errors are
            // now handled per-image above and don't get here.
            console.error('Error saving feedback:', error);
            const detail = (error && (error.code || error.message)) || String(error);
            showStatus('error', `❌ 送出失敗：${detail}`);
        } finally {
            submitFeedbackBtn.disabled = false;
        }
    });

}); // End of Feedback System DOMContentLoaded

// ============================================
// Auth Modal System (Login/Register with Email)
// ============================================

let authMode = 'login'; // 'login', 'register', or 'forgotPassword'

function openAuthModal(mode = 'login') {
    authMode = mode;
    const modal = document.getElementById('auth-modal');
    const modalTitle = document.getElementById('auth-modal-title');
    const submitBtn = document.getElementById('auth-submit-btn');
    const switchText = document.getElementById('auth-switch-text');
    const confirmPasswordGroup = document.getElementById('auth-confirm-password-group');
    const passwordGroup = document.querySelector('.form-group:has(#auth-password)');
    const forgotPasswordLink = document.getElementById('forgot-password-link');
    const authError = document.getElementById('auth-error');

    // Clear form
    document.getElementById('auth-form').reset();
    authError.style.display = 'none';

    if (mode === 'register') {
        modalTitle.textContent = '註冊';
        submitBtn.textContent = '註冊';
        switchText.innerHTML = '已經有帳號？<a href="#" id="auth-switch-link">立即登入</a>';
        confirmPasswordGroup.style.display = 'block';
        passwordGroup.style.display = 'block';
        forgotPasswordLink.style.display = 'none';
    } else if (mode === 'forgotPassword') {
        modalTitle.textContent = '忘記密碼';
        submitBtn.textContent = '發送重設密碼郵件';
        switchText.innerHTML = '<a href="#" id="auth-switch-link">返回登入</a>';
        confirmPasswordGroup.style.display = 'none';
        passwordGroup.style.display = 'none';
        forgotPasswordLink.style.display = 'none';
    } else {
        modalTitle.textContent = '登入';
        submitBtn.textContent = '登入';
        switchText.innerHTML = '還沒有帳號？<a href="#" id="auth-switch-link">立即註冊</a>';
        confirmPasswordGroup.style.display = 'none';
        passwordGroup.style.display = 'block';
        forgotPasswordLink.style.display = 'inline-block';
    }

    modal.style.display = 'flex';
    disableBodyScroll();

    // Re-attach event listener for switch link
    document.getElementById('auth-switch-link').addEventListener('click', (e) => {
        e.preventDefault();
        if (authMode === 'forgotPassword') {
            openAuthModal('login');
        } else {
            openAuthModal(authMode === 'login' ? 'register' : 'login');
        }
    });
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    modal.style.display = 'none';
    enableBodyScroll();
    document.getElementById('auth-form').reset();
    document.getElementById('auth-error').style.display = 'none';
}

function showAuthError(message) {
    const authError = document.getElementById('auth-error');
    authError.textContent = message;
    authError.style.display = 'block';
}

// Initialize auth modal event listeners
document.addEventListener('DOMContentLoaded', () => {
    const closeAuthModalBtn = document.getElementById('close-auth-modal');
    const googleSignInBtn = document.getElementById('google-sign-in-btn');
    const authForm = document.getElementById('auth-form');
    const forgotPasswordLink = document.getElementById('forgot-password-link');
    const authModal = document.getElementById('auth-modal');

    // Close modal
    if (closeAuthModalBtn) {
        closeAuthModalBtn.addEventListener('click', closeAuthModal);
    }

    // Close on backdrop click
    if (authModal) {
        authModal.addEventListener('click', (e) => {
            if (e.target === authModal) {
                closeAuthModal();
            }
        });
    }

    // Google sign in
    if (googleSignInBtn) {
        googleSignInBtn.addEventListener('click', async () => {
            // Check if user is in an in-app browser
            if (isInAppBrowser()) {
                console.log('⚠️ Google sign-in blocked: in-app browser detected');
                closeAuthModal();
                showWebViewWarning();
                return;
            }

            try {
                const result = await window.signInWithPopup(auth, window.googleProvider);
                console.log('Google sign in successful:', result.user);
                closeAuthModal();
            } catch (error) {
                console.error('Google sign in failed:', error);
                let errorMessage = '登入失敗，請稍後再試';
                if (error.code === 'auth/popup-closed-by-user') {
                    errorMessage = '登入視窗已關閉';
                } else if (error.code === 'auth/popup-blocked') {
                    errorMessage = '彈出視窗被瀏覽器阻擋，請允許彈出視窗';
                } else if (error.code === 'auth/unauthorized-domain') {
                    errorMessage = '此網域未經授權，請聯絡管理員';
                }
                showAuthError(errorMessage);
            }
        });
    }

    // Email/Password form submission
    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = document.getElementById('auth-email').value.trim();
            const password = document.getElementById('auth-password').value;
            const confirmPassword = document.getElementById('auth-confirm-password').value;
            const submitBtn = document.getElementById('auth-submit-btn');

            // Handle forgot password mode
            if (authMode === 'forgotPassword') {
                if (!email) {
                    showAuthError('請輸入您的 Email');
                    return;
                }

                submitBtn.disabled = true;
                submitBtn.textContent = '發送中...';

                try {
                    await window.sendPasswordResetEmail(auth, email);
                    const authError = document.getElementById('auth-error');
                    authError.textContent = '✅ 密碼重設信已寄出，請檢查您的 Email';
                    authError.style.display = 'block';
                    authError.style.background = '#d4edda';
                    authError.style.color = '#155724';
                } catch (error) {
                    console.error('Password reset error:', error);
                    let errorMessage = '發送失敗，請稍後再試';

                    if (error.code === 'auth/user-not-found') {
                        errorMessage = '找不到此 Email 帳號';
                    } else if (error.code === 'auth/invalid-email') {
                        errorMessage = 'Email 格式不正確';
                    }

                    const authError = document.getElementById('auth-error');
                    authError.textContent = errorMessage;
                    authError.style.display = 'block';
                    authError.style.background = '#fce8e6';
                    authError.style.color = '#c5221f';
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.textContent = '發送重設密碼郵件';
                }
                return;
            }

            // Validation for login/register
            if (!email || !password) {
                showAuthError('請填寫所有欄位');
                return;
            }

            if (password.length < 6) {
                showAuthError('密碼至少需要 6 個字元');
                return;
            }

            if (authMode === 'register' && password !== confirmPassword) {
                showAuthError('密碼不一致，請重新輸入');
                return;
            }

            // Disable submit button
            submitBtn.disabled = true;
            submitBtn.textContent = authMode === 'login' ? '登入中...' : '註冊中...';

            try {
                if (authMode === 'register') {
                    // Register
                    const result = await window.createUserWithEmailAndPassword(auth, email, password);
                    console.log('Registration successful:', result.user);
                    closeAuthModal();
                } else {
                    // Login
                    const result = await window.signInWithEmailAndPassword(auth, email, password);
                    console.log('Login successful:', result.user);
                    closeAuthModal();
                }
            } catch (error) {
                console.error('Auth error:', error);
                let errorMessage = '操作失敗，請稍後再試';

                // Handle specific error codes
                switch (error.code) {
                    case 'auth/email-already-in-use':
                        errorMessage = '此 Email 已被註冊';
                        break;
                    case 'auth/invalid-email':
                        errorMessage = 'Email 格式不正確';
                        break;
                    case 'auth/user-not-found':
                        errorMessage = '找不到此帳號';
                        break;
                    case 'auth/wrong-password':
                        errorMessage = '密碼錯誤';
                        break;
                    case 'auth/too-many-requests':
                        errorMessage = '嘗試次數過多，請稍後再試';
                        break;
                    case 'auth/weak-password':
                        errorMessage = '密碼強度不足';
                        break;
                    case 'auth/invalid-credential':
                        errorMessage = 'Email 或密碼錯誤';
                        break;
                }

                showAuthError(errorMessage);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = authMode === 'login' ? '登入' : '註冊';
            }
        });
    }

    // Forgot password link - switch to forgot password mode
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            openAuthModal('forgotPassword');
        });
    }
}); // End of Auth Modal DOMContentLoaded

// ============================================
// WebView Warning Modal Event Listeners
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const closeWebViewWarningBtn = document.getElementById('close-webview-warning');
    const openInBrowserBtn = document.getElementById('open-in-browser-btn');
    const copyUrlBtn = document.getElementById('copy-url-btn');
    const useEmailLoginBtn = document.getElementById('use-email-login-btn');
    const webviewWarningModal = document.getElementById('webview-warning-modal');

    // Close WebView warning modal
    if (closeWebViewWarningBtn) {
        closeWebViewWarningBtn.addEventListener('click', () => {
            closeWebViewWarning();
        });
    }

    // Close on backdrop click
    if (webviewWarningModal) {
        webviewWarningModal.addEventListener('click', (e) => {
            if (e.target === webviewWarningModal) {
                closeWebViewWarning();
            }
        });
    }

    // Open in browser button
    if (openInBrowserBtn) {
        openInBrowserBtn.addEventListener('click', () => {
            openInBrowser();
        });
    }

    // Copy URL button
    if (copyUrlBtn) {
        copyUrlBtn.addEventListener('click', () => {
            copyUrlToClipboard();
        });
    }

    // Use email login button
    if (useEmailLoginBtn) {
        useEmailLoginBtn.addEventListener('click', () => {
            closeWebViewWarning();
            openAuthModal('login');
        });
    }
}); // End of WebView Warning Modal DOMContentLoaded

// ============================================
// GA4 Button Click Tracking
// ============================================
document.addEventListener('click', function(e) {
    if (!window.logEvent || !window.firebaseAnalytics) return;
    const btn = e.target.closest(
        '.spotlight-compare-btn, .spotlight-info-btn, .card-apply-cta-btn, .promo-apply-cta-btn, .card-detail-apply-header-btn, .card-detail-apply-bar-btn'
    );
    if (!btn) return;

    let buttonType;
    if (btn.classList.contains('spotlight-compare-btn'))        buttonType = 'spotlight_compare';
    else if (btn.classList.contains('spotlight-info-btn'))      buttonType = 'spotlight_info';
    else if (btn.classList.contains('spotlight-apply-cta-btn')) buttonType = 'spotlight_apply';
    else if (btn.classList.contains('card-detail-apply-header-btn')) buttonType = 'detail_header_apply';
    else if (btn.classList.contains('card-detail-apply-bar-btn'))    buttonType = 'detail_sticky_apply';
    else if (btn.classList.contains('card-apply-cta-btn'))      buttonType = 'card_apply';
    else                                                         buttonType = 'search_result_apply';

    window.logEvent(window.firebaseAnalytics, 'button_click', {
        button_type: buttonType,
        card_id:     btn.dataset.cardId   || '',
        card_name:   btn.dataset.cardName || '',
        merchant:    btn.dataset.merchant || '',
    });
});









