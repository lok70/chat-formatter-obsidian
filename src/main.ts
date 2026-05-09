import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFolder } from 'obsidian';

// 1. Интерфейс настроек
interface ChatFormatterSettings {
    targetFolder: string;
    userMarkers: string;
    aiMarkers: string;
}

const DEFAULT_SETTINGS: ChatFormatterSettings = {
    targetFolder: "Ответы ИИ",
    userMarkers: "You, Вы сказали, User:, Вопрос, Вопрос:, )))",
    aiMarkers: "Gemini, ChatGPT сказал, Assistant:, AI:, Ответ ИИ, Ответ ИИ:, ((("
}

export default class ChatFormatterPlugin extends Plugin {
    settings: ChatFormatterSettings;

    async onload() {
        await this.loadSettings();

        // Добавляем вкладку настроек
        this.addSettingTab(new ChatFormatterSettingTab(this.app, this));

        // 2. Регистрируем команду (появится в палитре и можно назначить Hotkey)
        this.addCommand({
            id: 'format-ai-chat-callouts',
            name: 'Оформить чат с ИИ (Callouts)',
            // editorCallback гарантирует, что команда сработает только если открыт редактор
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                await this.formatChat(editor, view);
            }
        });
    }

    // 3. Основная логика (твоя адаптация из Templater)
    async formatChat(editor: Editor, view: MarkdownView) {
        const fullContent = editor.getValue();
        let yaml = "";
        let chatBody = fullContent;

        // Изолируем YAML
        if (fullContent.trimStart().startsWith("---")) {
            const parts = fullContent.split(/^---/m);
            if (parts.length >= 3) {
                yaml = `---${parts[1]}---\n\n`;
                chatBody = parts.slice(2).join("---").trim();
            }
        }

        // Получаем маркеры из настроек и очищаем их от пробелов
        const userMarkers = this.settings.userMarkers.split(',').map(s => s.trim()).filter(s => s.length > 0);
        const aiMarkers = this.settings.aiMarkers.split(',').map(s => s.trim()).filter(s => s.length > 0);

        const lines = chatBody.split("\n");
        let blocks = [];
        let currentRole: "user" | "ai" | null = null;
        let currentText: string[] = [];

        // Парсим текст
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const isUser = userMarkers.some(m => line.startsWith(m));
            const isAi = aiMarkers.some(m => line.startsWith(m));

            if (isUser || isAi) {
                if (currentRole && currentText.length > 0) {
                    blocks.push({ role: currentRole, content: currentText.join("\n").trim() });
                }
                currentRole = isUser ? "user" : "ai";
                currentText = [];
                continue;
            }

            if (currentRole) {
                currentText.push(lines[i]);
            } else if (line !== "") {
                currentRole = "user";
                currentText.push(lines[i]);
            }
        }

        if (currentRole && currentText.length > 0) {
            blocks.push({ role: currentRole, content: currentText.join("\n").trim() });
        }

        // Формирование Markdown (Callouts)
        let finalOutputLines = [];
        for (let block of blocks) {
            if (block.role === "user") {
                finalOutputLines.push("> [!question] Вопрос");
                finalOutputLines.push("> " + block.content.replace(/\n/g, "\n> "));
                finalOutputLines.push("");
            } else {
                finalOutputLines.push("> [!abstract]- Ответ ИИ");
                const aiLines = block.content.split("\n");
                let inCodeBlock = false;

                for (let line of aiLines) {
                    if (line.trim().startsWith("```")) {
                        if (!inCodeBlock) {
                            finalOutputLines.push("> > [!example]- Код");
                            finalOutputLines.push("> > " + line);
                            inCodeBlock = true;
                        } else {
                            finalOutputLines.push("> > " + line);
                            inCodeBlock = false;
                        }
                    } else {
                        finalOutputLines.push(inCodeBlock ? "> > " + line : "> " + line);
                    }
                }
                finalOutputLines.push("\n---");
            }
        }

        // Применяем изменения и перемещаем файл
        if (finalOutputLines.length > 0) {
            const finalOutput = yaml + finalOutputLines.join("\n");
            editor.setValue(finalOutput);

            const currentFile = view.file;
            if (!currentFile) return;

            const targetFolder = this.settings.targetFolder.trim();
            const newPath = `${targetFolder}/${currentFile.name}`;

            if (currentFile.path !== newPath && targetFolder !== "") {
                try {
                    let folder = this.app.vault.getAbstractFileByPath(targetFolder);
                    if (!folder) {
                        await this.app.vault.createFolder(targetFolder);
                    }
                    await this.app.fileManager.renameFile(currentFile, newPath);
                    new Notice(`Готово! Чат оформлен и перемещён в «${targetFolder}».`);
                } catch (err) {
                    console.error(err);
                    new Notice("Чат оформлен, но перенести файл не удалось (возможно, файл с таким именем уже есть).");
                }
            } else {
                new Notice("Готово! Чат оформлен.");
            }
        } else {
            new Notice("Не удалось найти маркеры диалога. Проверьте текст.");
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

// 4. Окно настроек плагина
class ChatFormatterSettingTab extends PluginSettingTab {
    plugin: ChatFormatterPlugin;

    constructor(app: App, plugin: ChatFormatterPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();
        containerEl.createEl('h2', {text: 'Настройки Chat Formatter'});

        new Setting(containerEl)
            .setName('Папка для сохранения')
            .setDesc('Куда перемещать отформатированные файлы (оставьте пустым, чтобы не перемещать)')
            .addText(text => text
                .setPlaceholder('Ответы ИИ')
                .setValue(this.plugin.settings.targetFolder)
                .onChange(async (value) => {
                    this.plugin.settings.targetFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Маркеры пользователя')
            .setDesc('Слова, с которых начинается ваш вопрос (через запятую)')
            .addTextArea(text => text
                .setPlaceholder('You, Вы сказали, User:')
                .setValue(this.plugin.settings.userMarkers)
                .onChange(async (value) => {
                    this.plugin.settings.userMarkers = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Маркеры ИИ')
            .setDesc('Слова, с которых начинается ответ нейросети (через запятую)')
            .addTextArea(text => text
                .setPlaceholder('Gemini, ChatGPT сказал, Assistant:')
                .setValue(this.plugin.settings.aiMarkers)
                .onChange(async (value) => {
                    this.plugin.settings.aiMarkers = value;
                    await this.plugin.saveSettings();
                }));
    }
}