import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

// 1. Настройки плагина
interface ChatFormatterSettings {
    targetFolder: string;
}

const DEFAULT_SETTINGS: ChatFormatterSettings = {
    targetFolder: "Ответы ИИ"
}

export default class ChatFormatterPlugin extends Plugin {
    settings: ChatFormatterSettings;

    async onload() {
        await this.loadSettings();

        // Добавляем вкладку настроек
        this.addSettingTab(new ChatFormatterSettingTab(this.app, this));

        // СПОСОБ 1: Команда (для вызова через Ctrl+P и назначения Горячих клавиш)
        this.addCommand({
            id: 'format-nested-callouts',
            name: 'Оформить вложенные Callout-блоки',
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                await this.formatChat(editor, view);
            }
        });

        // СПОСОБ 2: Пункт в контекстном меню (правый клик мышью по тексту)
        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                menu.addItem((item) => {
                    item
                        .setTitle('Оформить Callout-блоки')
                        .setIcon('list-tree') // Иконка древовидного списка
                        .onClick(() => {
                            this.formatChat(editor, view);
                        });
                });
            })
        );

        // СПОСОБ 3: Иконка на левой боковой панели (Ribbon)
        this.addRibbonIcon('layers', 'Оформить вложенные Callout-блоки', (evt: MouseEvent) => {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (view && view.editor) {
                this.formatChat(view.editor, view);
            } else {
                new Notice('Пожалуйста, откройте заметку для форматирования!');
            }
        });
    }

    // Основная логика обработки текста
    async formatChat(editor: Editor, view: MarkdownView) {
        const fullContent = editor.getValue();
        let yaml = "";
        let chatBody = fullContent;

        // Изолируем YAML-фронтматтер, чтобы не сломать свойства заметки
        if (fullContent.trimStart().startsWith("---")) {
            const parts = fullContent.split(/^---/m);
            if (parts.length >= 3) {
                yaml = `---${parts[1]}---\n\n`;
                chatBody = parts.slice(2).join("---").trim();
            }
        }

        const lines = chatBody.split("\n");
        let finalOutputLines = [];
        let depth = 0; // Отслеживаем уровень вложенности

        // Построчный парсинг
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Если встретили НАЧАЛО блока
            if (trimmed.startsWith("(((")) {
                let title = trimmed.substring(3).trim();
                if (!title) title = "Вложенный блок";
                
                let prefix = "> ".repeat(depth);
                finalOutputLines.push(`${prefix}> [!note] ${title}`);
                depth++;
            } 
            // Если встретили КОНЕЦ блока
            else if (trimmed.startsWith(")))")) {
                if (depth > 0) {
                    depth--;
                }
            } 
            // Обычный текст
            else {
                if (depth > 0) {
                    let prefix = "> ".repeat(depth);
                    if (trimmed === "") {
                        finalOutputLines.push(prefix.trimEnd());
                    } else {
                        finalOutputLines.push(`${prefix}${line}`);
                    }
                } else {
                    finalOutputLines.push(line);
                }
            }
        }

        // Применяем изменения
        if (finalOutputLines.length > 0) {
            const finalOutput = yaml + finalOutputLines.join("\n");
            editor.setValue(finalOutput);

            const currentFile = view.file;
            if (!currentFile) return;

            const targetFolder = this.settings.targetFolder.trim();
            
            // Если папка для сохранения указана, перемещаем файл
            if (targetFolder !== "") {
                const newPath = `${targetFolder}/${currentFile.name}`;
                if (currentFile.path !== newPath) {
                    try {
                        let folder = this.app.vault.getAbstractFileByPath(targetFolder);
                        if (!folder) {
                            await this.app.vault.createFolder(targetFolder);
                        }
                        await this.app.fileManager.renameFile(currentFile, newPath);
                        new Notice(`Готово! Оформлено и перемещено в «${targetFolder}».`);
                    } catch (err) {
                        console.error(err);
                        new Notice("Оформлено, но перенести файл не удалось.");
                    }
                } else {
                    new Notice("Готово! Вложенные блоки оформлены.");
                }
            } else {
                new Notice("Готово! Вложенные блоки оформлены.");
            }
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

// Интерфейс окна настроек
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
            .setDesc('Куда автоматически перемещать отформатированные файлы (оставьте пустым, чтобы файл оставался на месте)')
            .addText(text => text
                .setPlaceholder('Ответы ИИ')
                .setValue(this.plugin.settings.targetFolder)
                .onChange(async (value) => {
                    this.plugin.settings.targetFolder = value;
                    await this.plugin.saveSettings();
                }));
    }
}