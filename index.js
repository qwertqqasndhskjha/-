import {
    eventSource,
    event_types,
    saveSettingsDebounced,
} from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { t } from '../../../i18n.js';

const MODULE = 'background_gallery'; // 模块名称变更
const BACKGROUND_LIST_ID = 'backgrounds_list'; // ST原本的背景列表容器ID

/**
 * @typedef {Object} GallerySettings
 * @property {boolean} enabled - 是否启用相册模式
 * @property {number} gridSize - 网格大小 (px)
 */

/**
 * @type {GallerySettings}
 */
const defaultSettings = {
    enabled: true,
    gridSize: 150,
};

let observer = null;
let imageLazyLoader = null;

/**
 * 获取设置
 */
function getSettings() {
    if (extension_settings[MODULE] === undefined) {
        extension_settings[MODULE] = structuredClone(defaultSettings);
    }
    return extension_settings[MODULE];
}

/**
 * 注入扩展设置UI到扩展菜单
 */
function addExtensionSettings() {
    const settings = getSettings();
    const settingsContainer = document.getElementById('extensions_settings');
    if (!settingsContainer) return;

    // 清理旧的（如果有）
    const existingObj = document.getElementById('bg_gallery_settings');
    if (existingObj) existingObj.remove();

    const inlineDrawer = document.createElement('div');
    inlineDrawer.id = 'bg_gallery_settings';
    inlineDrawer.classList.add('inline-drawer');
    
    const inlineDrawerToggle = document.createElement('div');
    inlineDrawerToggle.classList.add('inline-drawer-toggle', 'inline-drawer-header');
    
    const extensionName = document.createElement('b');
    extensionName.textContent = t`Background Gallery (Album View)`; // 扩展显示名称
    
    const inlineDrawerIcon = document.createElement('div');
    inlineDrawerIcon.classList.add('inline-drawer-icon', 'fa-solid', 'fa-circle-chevron-down', 'down');
    
    inlineDrawerToggle.append(extensionName, inlineDrawerIcon);
    
    const inlineDrawerContent = document.createElement('div');
    inlineDrawerContent.classList.add('inline-drawer-content');
    
    inlineDrawer.append(inlineDrawerToggle, inlineDrawerContent);
    settingsContainer.append(inlineDrawer);

    // 1. 启用/禁用 开关
    const enabledLabel = document.createElement('label');
    enabledLabel.classList.add('checkbox_label');
    const enabledInput = document.createElement('input');
    enabledInput.type = 'checkbox';
    enabledInput.checked = settings.enabled;
    enabledInput.addEventListener('change', () => {
        settings.enabled = enabledInput.checked;
        saveSettingsDebounced();
        // 立即应用或移除效果
        if (settings.enabled) {
            initGalleryObserver();
            refreshGallery();
        } else {
            disconnectObserver();
            restoreDefaultView();
        }
    });
    enabledLabel.append(enabledInput, document.createTextNode(t`Enable Gallery Mode`));
    inlineDrawerContent.append(enabledLabel);

    // 2. 网格大小滑块
    const sizeLabel = document.createElement('label');
    sizeLabel.style.display = 'block';
    sizeLabel.style.marginTop = '10px';
    sizeLabel.textContent = `${t`Thumbnail Size`}: ${settings.gridSize}px`;
    
    const sizeInput = document.createElement('input');
    sizeInput.type = 'range';
    sizeInput.min = '100';
    sizeInput.max = '300';
    sizeInput.step = '10';
    sizeInput.value = settings.gridSize;
    sizeInput.style.width = '100%';
    sizeInput.addEventListener('input', () => {
        sizeLabel.textContent = `${t`Thumbnail Size`}: ${sizeInput.value}px`;
    });
    sizeInput.addEventListener('change', () => {
        settings.gridSize = Number(sizeInput.value);
        saveSettingsDebounced();
        updateCSSVariables(); // 更新CSS变量
    });

    inlineDrawerContent.append(sizeLabel, sizeInput);
    
    // 点击切换折叠
    inlineDrawerToggle.addEventListener('click', () => {
        $(inlineDrawerContent).slideToggle();
        inlineDrawerIcon.classList.toggle('down');
        inlineDrawerIcon.classList.toggle('up');
    });
}

/**
 * 注入自定义CSS样式
 */
function injectCSS() {
    const styleId = 'bg-gallery-style';
    if (document.getElementById(styleId)) return;

    const css = `
        /* 隐藏原本的列表项，但保留在DOM中以便触发点击 */
        #${BACKGROUND_LIST_ID}.gallery-mode .inline-drawer-toggle:not(.gallery-header) {
            display: none !important;
        }

        /* 标签栏容器 */
        .bg-gallery-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            padding: 5px;
            background: var(--SmartThemeBlurTintColor);
            border-bottom: 1px solid var(--SmartThemeBorderColor);
            margin-bottom: 10px;
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .bg-gallery-tab {
            padding: 4px 10px;
            border-radius: 15px;
            background: var(--black70a);
            color: var(--SmartThemeBodyColor);
            font-size: 0.85em;
            cursor: pointer;
            border: 1px solid transparent;
            opacity: 0.7;
            transition: all 0.2s;
        }

        .bg-gallery-tab:hover {
            opacity: 1;
            background: var(--black50a);
        }

        .bg-gallery-tab.active {
            opacity: 1;
            background: var(--SmartThemeQuoteColor);
            color: var(--white);
            border-color: var(--SmartThemeBorderColor);
            font-weight: bold;
        }

        /* 网格容器 */
        .bg-gallery-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(var(--bg-gallery-size, 150px), 1fr));
            gap: 10px;
            padding: 10px;
        }

        /* 单个图片卡片 */
        .bg-gallery-item {
            position: relative;
            aspect-ratio: 16 / 9;
            border-radius: 8px;
            overflow: hidden;
            cursor: pointer;
            border: 2px solid transparent;
            background-color: var(--black50a);
            transition: transform 0.2s, border-color 0.2s;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        }

        .bg-gallery-item:hover {
            transform: scale(1.05);
            border-color: var(--SmartThemeQuoteColor);
            z-index: 10;
        }
        
        /* 选中状态（如果能检测到） */
        .bg-gallery-item.selected {
            border-color: var(--SmartThemeQuoteColor);
            box-shadow: 0 0 10px var(--SmartThemeQuoteColor);
        }

        /* 图片本体 */
        .bg-gallery-img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            opacity: 0; /* 懒加载前透明 */
            transition: opacity 0.3s;
        }
        
        .bg-gallery-img.loaded {
            opacity: 1;
        }

        /* 文件名覆盖层 */
        .bg-gallery-label {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: linear-gradient(to top, rgba(0,0,0,0.9), transparent);
            color: white;
            font-size: 0.75rem;
            padding: 15px 5px 5px;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            pointer-events: none;
        }
        
        /* 删除按钮代理 */
        .bg-gallery-delete {
            position: absolute;
            top: 5px;
            right: 5px;
            width: 24px;
            height: 24px;
            background: rgba(200, 0, 0, 0.7);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            opacity: 0;
            transition: opacity 0.2s;
        }
        
        .bg-gallery-item:hover .bg-gallery-delete {
            opacity: 1;
        }

        .bg-gallery-delete:hover {
            background: red;
        }
    `;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
    updateCSSVariables();
}

/**
 * 更新CSS变量（如网格大小）
 */
function updateCSSVariables() {
    const settings = getSettings();
    document.documentElement.style.setProperty('--bg-gallery-size', `${settings.gridSize}px`);
}

/**
 * 核心逻辑：读取原有DOM，转换为相册视图
 */
function refreshGallery() {
    const container = document.getElementById(BACKGROUND_LIST_ID);
    if (!container) return;

    const settings = getSettings();
    if (!settings.enabled) return;

    // 标记容器为相册模式
    container.classList.add('gallery-mode');

    // 1. 获取所有原本的背景列表项
    // ST的背景通常是 div.inline-drawer-toggle
    // 里面包含文件名文本
    const originalItems = Array.from(container.children).filter(el => 
        el.classList.contains('inline-drawer-toggle') && 
        !el.classList.contains('gallery-header') &&
        el.style.display !== 'none' // 忽略已经被过滤掉的
    );

    // 如果还没有生成自定义容器，生成它
    let galleryContainer = container.querySelector('.bg-gallery-grid');
    let tabsContainer = container.querySelector('.bg-gallery-tabs');

    if (!galleryContainer) {
        tabsContainer = document.createElement('div');
        tabsContainer.classList.add('bg-gallery-tabs');
        
        galleryContainer = document.createElement('div');
        galleryContainer.classList.add('bg-gallery-grid');

        // 将新容器插入到列表顶部（搜索栏下方）
        container.insertBefore(tabsContainer, container.firstChild);
        container.insertBefore(galleryContainer, container.firstChild.nextSibling); // 插在tabs后面
    } else {
        galleryContainer.innerHTML = '';
        tabsContainer.innerHTML = '';
    }

    // 2. 解析数据并分类
    const categories = { 'All': [] };
    
    originalItems.forEach(item => {
        // 尝试从原本的DOM中获取信息
        // 通常 ST 会把文件名放在 item 的 textContent 里，或者作为 title
        // 结构通常是: item -> textNode(文件名) + span(删除按钮)
        
        const rawName = item.textContent.trim();
        // 提取图片路径：如果ST没有直接在DOM存路径，通常需要根据上下文推断
        // ST 原生会把 'title' 属性设为文件名，或者我们需要从 DOM 结构里找
        const titleAttr = item.getAttribute('title') || rawName;
        
        // 简单的分类逻辑：检测斜杠
        // Windows/Linux 路径分隔符处理
        const pathParts = titleAttr.split(/[/\\]/);
        let category = 'Root';
        let displayName = titleAttr;

        if (pathParts.length > 1) {
            // 取倒数第二个部分作为文件夹名 (e.g., backgrounds/Fantasy/castle.png -> Fantasy)
            category = pathParts[pathParts.length - 2];
            displayName = pathParts[pathParts.length - 1];
        }

        if (!categories[category]) categories[category] = [];
        
        // 构建数据对象
        const data = {
            element: item, // 原始DOM引用
            fullPath: titleAttr,
            name: displayName,
            category: category
        };

        categories[category].push(data);
        categories['All'].push(data);
    });

    // 3. 渲染标签栏
    const sortedCats = Object.keys(categories).sort((a, b) => {
        if (a === 'All') return -1;
        if (b === 'All') return 1;
        if (a === 'Root') return -1;
        if (b === 'Root') return 1;
        return a.localeCompare(b);
    });

    let activeCategory = 'All';

    const renderItems = (catName) => {
        galleryContainer.innerHTML = '';
        activeCategory = catName;

        // 更新标签高亮
        Array.from(tabsContainer.children).forEach(tab => {
            if (tab.dataset.cat === catName) tab.classList.add('active');
            else tab.classList.remove('active');
        });

        const items = categories[catName];
        const fragment = document.createDocumentFragment();

        items.forEach(imgData => {
            const card = document.createElement('div');
            card.classList.add('bg-gallery-item');
            card.title = imgData.fullPath;

            // 代理点击：点击卡片 = 点击原始列表项
            card.addEventListener('click', (e) => {
                // 如果点击的是删除按钮，不触发背景切换
                if (e.target.closest('.bg-gallery-delete')) return;
                
                // 模拟点击原始元素
                imgData.element.click();
                
                // 视觉反馈
                document.querySelectorAll('.bg-gallery-item').forEach(el => el.classList.remove('selected'));
                card.classList.add('selected');
            });

            // 图像标签
            const img = document.createElement('img');
            img.classList.add('bg-gallery-img');
            img.alt = imgData.name;
            // 关键：不直接设置 src，而是用 data-src 配合 IntersectionObserver
            // 路径通常是 'backgrounds/' + fullPath
            // 需要处理 URL 编码
            const encodedPath = encodeURIComponent(imgData.fullPath).replace(/%2F/g, '/');
            img.dataset.src = `backgrounds/${encodedPath}`; // 假设相对路径

            // 文件名显示
            const label = document.createElement('div');
            label.classList.add('bg-gallery-label');
            label.textContent = imgData.name;

            // 删除按钮代理
            // 查找原始DOM里的删除按钮（通常是一个 font-awesome 图标）
            const originalDeleteBtn = imgData.element.querySelector('.fa-trash, .fa-times, .delete_button');
            if (originalDeleteBtn) {
                const delBtn = document.createElement('div');
                delBtn.classList.add('bg-gallery-delete');
                delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
                delBtn.title = t`Delete`;
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(t`Delete this background?`)) {
                        // 触发原始删除逻辑
                        originalDeleteBtn.click();
                        // 我们的 Observer 会检测到 DOM 变动并重新渲染
                    }
                });
                card.appendChild(delBtn);
            }

            card.append(img, label);
            fragment.appendChild(card);
            
            // 加入懒加载观察
            if (imageLazyLoader) imageLazyLoader.observe(img);
        });

        galleryContainer.appendChild(fragment);
    };

    sortedCats.forEach(cat => {
        // 如果只有 Root 和 All，就不显示标签栏了，或者如果某个分类为空
        if (categories[cat].length === 0) return;

        const tab = document.createElement('div');
        tab.classList.add('bg-gallery-tab');
        tab.textContent = cat === 'All' ? t`All` : cat;
        tab.dataset.cat = cat;
        tab.addEventListener('click', () => renderItems(cat));
        tabsContainer.appendChild(tab);
    });

    // 默认渲染 'All'
    renderItems('All');
}

/**
 * 设置懒加载观察器
 */
function setupLazyLoader() {
    if (imageLazyLoader) imageLazyLoader.disconnect();

    imageLazyLoader = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    img.onload = () => img.classList.add('loaded');
                    img.removeAttribute('data-src');
                    observer.unobserve(img);
                }
            }
        });
    }, {
        root: document.getElementById(BACKGROUND_LIST_ID), // 视口为滚动容器
        rootMargin: '100px', // 提前加载
        threshold: 0.01
    });
}

/**
 * 还原默认视图
 */
function restoreDefaultView() {
    const container = document.getElementById(BACKGROUND_LIST_ID);
    if (!container) return;

    container.classList.remove('gallery-mode');
    
    const gallery = container.querySelector('.bg-gallery-grid');
    const tabs = container.querySelector('.bg-gallery-tabs');
    if (gallery) gallery.remove();
    if (tabs) tabs.remove();
}

/**
 * 初始化 DOM 观察器，当背景列表发生变化时重新渲染相册
 */
function initGalleryObserver() {
    const targetNode = document.getElementById(BACKGROUND_LIST_ID);
    if (!targetNode) return;

    // 如果已经有观察器，先断开
    if (observer) observer.disconnect();

    // 初始化懒加载
    setupLazyLoader();

    // 初次渲染
    // 需要延迟一点点，确保ST已经把列表渲染进去了
    setTimeout(refreshGallery, 100);

    // 监听子节点变化 (列表刷新、删除、添加)
    observer = new MutationObserver((mutationsList) => {
        let shouldRefresh = false;
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                // 忽略我们自己创建的 grid 和 tabs 的变动
                const addedNodes = Array.from(mutation.addedNodes);
                const isInternalChange = addedNodes.some(node => 
                    node.classList && (node.classList.contains('bg-gallery-grid') || node.classList.contains('bg-gallery-tabs'))
                );
                
                if (!isInternalChange) {
                    shouldRefresh = true;
                    break;
                }
            }
        }
        if (shouldRefresh) {
            refreshGallery();
        }
    });

    observer.observe(targetNode, { childList: true });
}

function disconnectObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

/**
 * 初始化扩展
 */
(function () {
    const settings = getSettings();
    injectCSS();
    addExtensionSettings();

    // 监听背景面板的打开事件或者按钮点击
    // 方式1: 监听ST事件
    // event_types.OPENED_BACKGROUNDS_MENU 某些版本可能有，保险起见用点击监听

    const bgToggleBtn = document.querySelector('#backgrounds-drawer-toggle');
    
    if (bgToggleBtn) {
        bgToggleBtn.addEventListener('click', () => {
            if (getSettings().enabled) {
                // 稍微延迟，等待原生列表生成
                setTimeout(() => {
                    initGalleryObserver();
                }, 50);
            }
        });
    }

    // 同时监听全局点击，万一其他方式打开了背景面板
    document.addEventListener('click', (e) => {
        const target = e.target;
        if (target.closest && target.closest('#backgrounds-drawer-toggle')) {
             if (getSettings().enabled) {
                setTimeout(initGalleryObserver, 50);
            }
        }
    });

    // 如果加载时面板已经是打开的
    if (document.getElementById(BACKGROUND_LIST_ID) && document.getElementById(BACKGROUND_LIST_ID).offsetParent !== null) {
        if (getSettings().enabled) {
            initGalleryObserver();
        }
    }
})();